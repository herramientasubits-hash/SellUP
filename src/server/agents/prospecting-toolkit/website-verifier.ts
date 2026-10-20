/**
 * Prospecting Toolkit — Website Verifier (Hito 3B)
 *
 * Verifica si un sitio web existe y corresponde razonablemente a una empresa candidata.
 *
 * Reglas críticas:
 * - No llama a Apollo, Lusha ni HubSpot.
 * - No usa proveedor IA.
 * - No modifica datos.
 * - No hace crawling profundo (solo extrae title y meta description).
 * - Máximo 3 redirects.
 * - Bloquea URLs locales, privadas, protocolos inseguros: decide por la dirección
 *   (ip-safety.ts) y resuelve el DNS antes de cada salto.
 * - No rompe el build si un sitio no responde.
 * - No imprime headers sensibles.
 * - No guarda HTML completo.
 */

import type { WebsiteVerificationInput, WebsiteVerificationOutput, WebsiteVerificationStatus } from './types';
import { normalizeDomain, normalizeCompanyName } from './normalization';
import { isBlockedHostname, isBlockedIpAddress, isIpLiteralHostname } from './ip-safety';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 50_000; // Solo los primeros 50 KB para extraer signals

const USER_AGENT = 'SellUp-WebVerifier/1.0 (website verification; non-commercial)';

// Palabras comunes a ignorar en matching de nombre de empresa
const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'del', 'en', 'y', 'e', 'a', 'con',
  'the', 'and', 'of', 'for', 'in', 'at', 'by', 'to',
  'colombia', 'mexico', 'peru', 'chile', 'argentina', 'brasil', 'brazil',
  'sa', 'sas', 'srl', 'ltda', 'inc', 'llc', 'corp', 'ag', 'sl',
]);

// ─── Seguridad: bloqueo de hosts/protocolos inseguros ─────────────────────────

const BLOCKED_PROTOCOLS = new Set(['file:', 'javascript:', 'data:', 'ftp:', 'blob:']);

/**
 * Devuelve true si el hostname apunta a una dirección local o privada.
 * Protege contra SSRF. Decide por la DIRECCIÓN (IPv4, IPv6, IPv4 mapeada o
 * embebida en IPv6, ULA…), no por el texto: ver `ip-safety.ts`.
 */
function isPrivateOrLocalHost(hostname: string): boolean {
  return isBlockedHostname(hostname);
}

// ─── Resolución DNS antes de conectar (anti-SSRF) ─────────────────────────────

/** Direcciones IP a las que resuelve un nombre. Inyectable en pruebas. */
export type HostLookup = (hostname: string) => Promise<string[]>;

/** Tope de la consulta DNS: un resolvedor lento no puede comerse el tiempo de la descarga. */
const DNS_LOOKUP_TIMEOUT_MS = 3_000;

const defaultHostLookup: HostLookup = async (hostname) => {
  // Import dinámico: este módulo no debe arrastrar `node:dns` a ningún bundle de cliente.
  const { lookup } = await import('node:dns/promises');
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

/**
 * ¿El nombre resuelve a alguna dirección interna? Un nombre público que apunta a
 * 127.0.0.1 o a 169.254.169.254 (metadatos de la nube) se bloquea igual que la IP.
 *
 * Si el DNS falla o tarda, NO se bloquea aquí: la descarga fallará por su cuenta
 * con el mismo error de siempre (un dominio inexistente sigue siendo «no existe»).
 *
 * Queda un riesgo residual de DNS rebinding (el DNS cambia entre esta consulta y
 * la conexión): cerrarlo exige fijar la IP en la conexión con un dispatcher propio.
 */
async function resolvesToBlockedAddress(hostname: string, lookupHost: HostLookup): Promise<boolean> {
  if (isIpLiteralHostname(hostname)) return false; // ya lo juzgó isBlockedHostname
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookupHost(hostname),
      new Promise<string[]>((resolve) => {
        timer = setTimeout(() => resolve([]), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
    return addresses.some((address) => isBlockedIpAddress(address));
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Construye y valida la URL segura para hacer fetch.
 * Retorna null si el input es inseguro o inválido.
 */
function buildSafeUrl(
  rawInput: string,
  options: { upgradeHttp?: boolean } = {},
): { url: URL; reason?: string } | { url: null; reason: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) return { url: null, reason: 'empty_input' };

  // Añadir protocolo si falta
  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { url: null, reason: 'invalid_url' };
  }

  // Bloquear protocolos no permitidos
  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
    return { url: null, reason: `blocked_protocol_${parsed.protocol}` };
  }

  // Solo http y https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: null, reason: `unsupported_protocol_${parsed.protocol}` };
  }

  // Bloquear hosts privados/locales (anti-SSRF)
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return { url: null, reason: 'blocked_private_or_local_host' };
  }

  // Preferir https sobre http cuando sea posible. AUDIT-A1-WS7 — sólo en la
  // entrada: un redirect que manda EXPLÍCITAMENTE a http se respeta (antes se
  // volvía a subir a https en cada salto y un sitio sólo-http entraba en bucle
  // hasta agotar los redirects).
  if (parsed.protocol === 'http:' && options.upgradeHttp !== false) {
    const httpsUrl = new URL(withProtocol.replace(/^http:\/\//, 'https://'));
    return { url: httpsUrl };
  }

  return { url: parsed };
}

// ─── Extracción de signals de página ─────────────────────────────────────────

export type PageSignals = {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
};

export function extractPageSignals(html: string): PageSignals {
  // Extraer solo los primeros MAX_HTML_BYTES caracteres para no guardar todo el HTML
  const slice = html.slice(0, MAX_HTML_BYTES);

  // Title
  const titleMatch = /<title[^>]*>([^<]{0,300})<\/title>/i.exec(slice);
  const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : null;

  // Meta description
  const metaMatch = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i.exec(slice)
    ?? /<meta[^>]+content=["']([^"']{0,500})["'][^>]+name=["']description["']/i.exec(slice);
  const metaDescription = metaMatch ? metaMatch[1].trim().replace(/\s+/g, ' ') : null;

  // Canonical
  const canonicalMatch = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']{0,500})["']/i.exec(slice)
    ?? /<link[^>]+href=["']([^"']{0,500})["'][^>]+rel=["']canonical["']/i.exec(slice);
  const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : null;

  return { title, metaDescription, canonicalUrl };
}

// ─── Scoring de nombre de empresa vs página ───────────────────────────────────

/**
 * Tokeniza un texto para matching: minúsculas, sin diacríticos, sin stopwords.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Calcula un score (0–100) de qué tan bien el nombre de empresa
 * coincide con las señales de la página (domain, title, metaDescription).
 *
 * No usa IA. Matching léxico por tokens significativos.
 */
export function scoreCompanyNameAgainstPage(
  candidateName: string,
  domain: string | null,
  title: string | null,
  metaDescription: string | null,
): { score: number; evidence: string[] } {
  const evidence: string[] = [];
  const normalized = normalizeCompanyName(candidateName);
  const tokens = tokenize(normalized);

  if (tokens.length === 0) return { score: 0, evidence: ['no_tokens_from_name'] };

  // Campos a comparar con sus pesos
  const fields: Array<{ label: string; value: string | null; weight: number }> = [
    { label: 'domain', value: domain, weight: 40 },
    { label: 'title', value: title, weight: 40 },
    { label: 'metaDescription', value: metaDescription, weight: 20 },
  ];

  let totalWeight = 0;
  let weightedScore = 0;

  for (const { label, value, weight } of fields) {
    if (!value) continue;
    totalWeight += weight;

    const fieldTokens = tokenize(value);
    const matched = tokens.filter((t) => fieldTokens.some((ft) => ft === t || ft.startsWith(t) || t.startsWith(ft)));

    const ratio = matched.length / tokens.length;
    const fieldScore = ratio * weight;
    weightedScore += fieldScore;

    if (matched.length > 0) {
      evidence.push(`${label}_match:${matched.join(',')}`);
    } else {
      evidence.push(`${label}_no_match`);
    }
  }

  if (totalWeight === 0) return { score: 0, evidence: ['no_fields_available'] };

  // Normalizar sobre el peso disponible
  const score = Math.round((weightedScore / totalWeight) * 100);
  return { score, evidence };
}

// ─── Clasificación final ──────────────────────────────────────────────────────

function classifyStatus(params: {
  httpStatus: number | null;
  redirected: boolean;
  redirectChain: string[];
  inputDomain: string | null;
  finalDomain: string | null;
  nameScore: number;
  fetchError: boolean;
}): { status: WebsiteVerificationStatus; confidence: number } {
  const { httpStatus, inputDomain, finalDomain, nameScore, fetchError } = params;

  if (fetchError) {
    return { status: 'error', confidence: 5 };
  }

  if (httpStatus === null || httpStatus >= 400) {
    return { status: 'not_found', confidence: 10 };
  }

  // Detectar mismatch de dominio: redirect a dominio muy distinto
  const domainMismatch =
    inputDomain &&
    finalDomain &&
    inputDomain !== finalDomain &&
    !finalDomain.endsWith(`.${inputDomain}`) &&
    !inputDomain.endsWith(`.${finalDomain}`);

  // Si score de nombre es muy bajo y hay mismatch de dominio → mismatch
  if (nameScore < 20 && domainMismatch) {
    return { status: 'mismatch', confidence: 25 };
  }

  // Si mismatch de dominio pero nombre coincide un poco → inferred
  if (domainMismatch && nameScore < 50) {
    return { status: 'mismatch', confidence: Math.max(20, nameScore) };
  }

  // Score alto → verified
  if (nameScore >= 60) {
    const confidence = Math.min(95, 60 + nameScore * 0.35);
    return { status: 'verified', confidence: Math.round(confidence) };
  }

  // Score medio → inferred
  if (nameScore >= 25) {
    const confidence = Math.min(79, 40 + nameScore * 0.5);
    return { status: 'inferred', confidence: Math.round(confidence) };
  }

  // Score bajo pero sitio responde → inferred con baja confianza
  return { status: 'inferred', confidence: 40 };
}

// ─── Lectura acotada y decodificación (AUDIT-A1-WS7) ─────────────────────────

/**
 * Lee el cuerpo de a trozos y CORTA al llegar a `maxBytes` (antes se bajaba la
 * página entera con `arrayBuffer()` y luego se recortaba: una página de 30 MB se
 * descargaba completa para usar 50 KB).
 */
export async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const limit = Math.max(0, Math.trunc(maxBytes));
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.byteLength, limit - total);
      chunks.push(take === value.byteLength ? value : value.subarray(0, take));
      total += take;
    }
  } finally {
    // Lo que queda no se descarga.
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function charsetFromContentType(contentType: string | null): string | null {
  const match = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '');
  return match ? match[1].toLowerCase() : null;
}

function charsetFromMeta(bytes: Uint8Array): string | null {
  // El <meta charset> va en el <head>: basta con los primeros KB leídos como ASCII.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const match = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  return match ? match[1].toLowerCase() : null;
}

function decodeWith(label: string, bytes: Uint8Array, fatal: boolean): string | null {
  try {
    // `stream: true` ⇒ un carácter multibyte cortado al final por el tope no es un error.
    return new TextDecoder(label, { fatal }).decode(bytes, { stream: true });
  } catch {
    return null;
  }
}

/**
 * Decodifica el HTML con el charset del `Content-Type` o del `<meta charset>`; sin
 * declaración, UTF-8, y si los bytes no son UTF-8 válido, windows-1252 (los sitios
 * viejos de la región en latin-1 salían con «Ã±» en vez de «ñ»).
 */
export function decodeHtmlBytes(bytes: Uint8Array, contentType: string | null): string {
  const declared = charsetFromContentType(contentType) ?? charsetFromMeta(bytes);
  if (declared && declared !== 'utf-8' && declared !== 'utf8') {
    const decoded = decodeWith(declared, bytes, false);
    if (decoded !== null) return decoded;
  }
  return decodeWith('utf-8', bytes, true) ?? decodeWith('windows-1252', bytes, false) ?? decodeWith('utf-8', bytes, false) ?? '';
}

/**
 * ¿El fallo es de CONEXIÓN o TLS (y no un timeout ni una respuesta HTTP)? Sólo
 * entonces vale la pena reintentar por http.
 */
function isConnectionOrTlsError(err: unknown): boolean {
  if (!(err instanceof Error) || err.name === 'AbortError') return false;
  const cause = (err as { cause?: { code?: unknown; message?: unknown } }).cause;
  const text = `${err.message} ${typeof cause?.code === 'string' ? cause.code : ''} ${typeof cause?.message === 'string' ? cause.message : ''}`;
  // DNS (ENOTFOUND / EAI_AGAIN) no: el host no existe tampoco por http.
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return false;
  return /ECONNREFUSED|ECONNRESET|EPROTO|UND_ERR_SOCKET|CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF[_ -]SIGNED|HANDSHAKE/i.test(text);
}

// ─── Fetch con límite de redirects ────────────────────────────────────────────

type FetchResult = {
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: string[];
  html: string | null;
  fetchError: string | null;
};

async function fetchWithRedirectTracking(
  startUrl: URL,
  timeoutMs: number,
  maxHtmlBytes: number = MAX_HTML_BYTES,
  lookupHost: HostLookup = defaultHostLookup,
): Promise<FetchResult> {
  const redirectChain: string[] = [];
  let currentUrl = startUrl.toString();
  let httpStatus: number | null = null;
  let html: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const doFetch = (url: string) =>
    fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es,en;q=0.5',
      },
    });

  try {
    // Seguimos manualmente hasta MAX_REDIRECTS para controlar la cadena
    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
      // AUDIT-A1-WS7 — en los saltos se respeta el protocolo del redirect (mismas
      // comprobaciones anti-SSRF en cada salto).
      const safeResult = buildSafeUrl(currentUrl, { upgradeHttp: attempt === 0 });
      if (!safeResult.url) {
        return {
          httpStatus: null,
          finalUrl: currentUrl,
          redirectChain,
          html: null,
          fetchError: `blocked_redirect_${safeResult.reason}`,
        };
      }

      // Antes de conectar: el nombre no puede resolver a una dirección interna.
      if (await resolvesToBlockedAddress(safeResult.url.hostname, lookupHost)) {
        return {
          httpStatus: null,
          finalUrl: currentUrl,
          redirectChain,
          html: null,
          fetchError: attempt === 0 ? 'blocked_url:private_resolution' : 'blocked_redirect_private_resolution',
        };
      }

      let response: Response;
      try {
        response = await doFetch(safeResult.url.toString());
      } catch (err) {
        // AUDIT-A1-WS7 — https forzado sin vuelta atrás: un sitio sólo-http o con
        // certificado roto (frecuente en gobierno de la región) quedaba como error.
        // Un fallo de conexión/TLS en https se reintenta UNA vez por http, con la
        // misma validación anti-SSRF; un timeout no se reintenta.
        if (safeResult.url.protocol !== 'https:' || !isConnectionOrTlsError(err)) throw err;
        const httpUrl = new URL(safeResult.url.toString());
        httpUrl.protocol = 'http:';
        const httpSafe = buildSafeUrl(httpUrl.toString(), { upgradeHttp: false });
        if (!httpSafe.url) throw err;
        response = await doFetch(httpSafe.url.toString());
        currentUrl = httpSafe.url.toString();
      }

      httpStatus = response.status;

      const isRedirect = response.status >= 300 && response.status < 400;
      if (isRedirect) {
        const location = response.headers.get('location');
        if (!location || attempt === MAX_REDIRECTS) {
          // No más redirects disponibles
          break;
        }
        redirectChain.push(currentUrl);
        // Resolver URL relativa si es necesario
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          currentUrl = location;
        }
        continue;
      }

      // Respuesta final
      if (response.status < 400) {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('text/html') || contentType.includes('text/plain')) {
          // Sólo los primeros `maxHtmlBytes`: se deja de leer al llegar al tope.
          const bytes = await readBodyLimited(response, maxHtmlBytes);
          html = decodeHtmlBytes(bytes, contentType);
        }
      }
      break;
    }

    return {
      httpStatus,
      finalUrl: currentUrl,
      redirectChain,
      html,
      fetchError: null,
    };
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      httpStatus: null,
      finalUrl: currentUrl,
      redirectChain,
      html: null,
      fetchError: isAbort ? 'timeout' : 'fetch_error',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Descarga segura de la página (reutilizable) ─────────────────────────────

export type SafePageFetchResult = {
  requestedUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  redirected: boolean;
  /** Primeros 50 KB del HTML (o `maxHtmlBytes`); null si la página no respondió o no es HTML. */
  html: string | null;
  error: string | null;
};

/**
 * Descarga la página con las MISMAS protecciones que `verifyWebsite`
 * (anti-SSRF, redirects manuales ≤3, timeout, tope de 50 KB). No guarda nada.
 *
 * `maxHtmlBytes`: los lectores de Claude piden más (ver
 * `CLAUDE_PAGE_MAX_HTML_BYTES`); el resto sigue con 50 KB.
 */
export async function fetchSafePageHtml(
  websiteOrDomain: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  maxHtmlBytes: number = MAX_HTML_BYTES,
  /** `lookupHost`: resolvedor DNS (inyectable en pruebas; por defecto, el del sistema). */
  options: { lookupHost?: HostLookup } = {},
): Promise<SafePageFetchResult> {
  const requestedUrl = websiteOrDomain.trim();
  const safeResult = buildSafeUrl(requestedUrl);
  if (!safeResult.url) {
    return {
      requestedUrl,
      finalUrl: null,
      httpStatus: null,
      redirected: false,
      html: null,
      error: `blocked_url:${safeResult.reason}`,
    };
  }
  const fetchResult = await fetchWithRedirectTracking(safeResult.url, timeoutMs, maxHtmlBytes, options.lookupHost);
  return {
    requestedUrl,
    finalUrl: fetchResult.finalUrl,
    httpStatus: fetchResult.httpStatus,
    redirected: fetchResult.redirectChain.length > 0,
    html: fetchResult.html,
    error: fetchResult.fetchError,
  };
}

// ─── Función pública ──────────────────────────────────────────────────────────

export async function verifyWebsite(
  input: WebsiteVerificationInput,
): Promise<WebsiteVerificationOutput> {
  const { candidateName, websiteOrDomain, timeoutMs = DEFAULT_TIMEOUT_MS } = input;

  // Sin input de website → not_found skipped
  if (!websiteOrDomain || websiteOrDomain.trim().length === 0) {
    return {
      status: 'not_found',
      website: null,
      domain: null,
      finalUrl: null,
      finalDomain: null,
      httpStatus: null,
      redirected: false,
      redirectChain: [],
      title: null,
      metaDescription: null,
      evidence: ['missing_website_or_domain'],
      confidence: 0,
      skipped: true,
      skipReason: 'missing_website_or_domain',
    };
  }

  const rawWebsite = websiteOrDomain.trim();

  // Normalizar dominio de entrada
  const inputDomain = normalizeDomain(rawWebsite);

  // Construir URL segura
  const safeResult = buildSafeUrl(rawWebsite);

  if (!safeResult.url) {
    return {
      status: safeResult.reason?.includes('blocked') ? 'error' : 'not_found',
      website: rawWebsite,
      domain: inputDomain,
      finalUrl: null,
      finalDomain: null,
      httpStatus: null,
      redirected: false,
      redirectChain: [],
      title: null,
      metaDescription: null,
      evidence: [`blocked_url:${safeResult.reason}`],
      confidence: 0,
      skipped: true,
      skipReason: safeResult.reason ?? 'invalid_url',
    };
  }

  const website = safeResult.url.toString();

  // Fetch con tracking de redirects
  const fetchResult = await fetchWithRedirectTracking(safeResult.url, timeoutMs);

  const finalUrl = fetchResult.finalUrl;
  const finalDomain = finalUrl ? normalizeDomain(finalUrl) : null;
  const redirected = fetchResult.redirectChain.length > 0;

  // Extraer signals de la página
  let title: string | null = null;
  let metaDescription: string | null = null;

  if (fetchResult.html) {
    const signals = extractPageSignals(fetchResult.html);
    title = signals.title;
    metaDescription = signals.metaDescription;
  }

  // Score de matching
  const { score: nameScore, evidence: matchEvidence } = scoreCompanyNameAgainstPage(
    candidateName,
    finalDomain ?? inputDomain,
    title,
    metaDescription,
  );

  // Clasificar
  const { status, confidence } = classifyStatus({
    httpStatus: fetchResult.httpStatus,
    redirected,
    redirectChain: fetchResult.redirectChain,
    inputDomain,
    finalDomain,
    nameScore,
    fetchError: fetchResult.fetchError !== null,
  });

  const evidence: string[] = [
    `http_status:${fetchResult.httpStatus ?? 'null'}`,
    redirected ? `redirected_from:${fetchResult.redirectChain[0]}` : 'no_redirect',
    `name_score:${nameScore}`,
    ...matchEvidence,
  ];

  if (fetchResult.fetchError) {
    evidence.push(`fetch_error:${fetchResult.fetchError}`);
  }

  return {
    status,
    website,
    domain: inputDomain,
    finalUrl,
    finalDomain,
    httpStatus: fetchResult.httpStatus,
    redirected,
    redirectChain: fetchResult.redirectChain,
    title,
    metaDescription,
    evidence,
    confidence,
    skipped: false,
    skipReason: null,
    error: fetchResult.fetchError,
    metadata: {
      candidateName,
      nameScore,
      inputDomain,
      finalDomain,
    },
  };
}
