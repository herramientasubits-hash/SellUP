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
 * - Bloquea URLs locales, privadas, protocolos inseguros.
 * - No rompe el build si un sitio no responde.
 * - No imprime headers sensibles.
 * - No guarda HTML completo.
 */

import type { WebsiteVerificationInput, WebsiteVerificationOutput, WebsiteVerificationStatus } from './types';
import { normalizeDomain, normalizeCompanyName } from './normalization';

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
 * Protege contra SSRF.
 */
function isPrivateOrLocalHost(hostname: string): boolean {
  if (!hostname) return true;

  const lower = hostname.toLowerCase();

  // Nombres reservados
  if (lower === 'localhost' || lower === 'localhost.localdomain') return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.localhost')) return true;

  // IPv4 loopback / link-local / privadas / APIPA
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4) {
    const [, a, b, c, d] = ipv4.map(Number);
    if (
      a === 0 ||                          // 0.x.x.x
      a === 127 ||                        // loopback
      a === 10 ||                         // RFC 1918
      (a === 172 && b >= 16 && b <= 31) || // RFC 1918
      (a === 192 && b === 168) ||         // RFC 1918
      (a === 169 && b === 254) ||         // APIPA / link-local
      (a === 100 && b >= 64 && b <= 127) || // Carrier-grade NAT
      a === 192 && b === 0 && c === 0 ||  // IETF protocol assignments
      a === 198 && (b === 18 || b === 19) || // benchmark
      a === 240                            // reserved
    ) {
      void d; // usado solo para desestructurar; lint safe
      return true;
    }
    return false;
  }

  // IPv6 loopback y variantes
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower.startsWith('::ffff:127.') || lower.startsWith('[::1]') || lower.startsWith('[::ffff:127.')) return true;
  // Link-local IPv6
  if (lower.startsWith('fe80') || lower.startsWith('[fe80')) return true;

  return false;
}

/**
 * Construye y valida la URL segura para hacer fetch.
 * Retorna null si el input es inseguro o inválido.
 */
function buildSafeUrl(rawInput: string): { url: URL; reason?: string } | { url: null; reason: string } {
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

  // Preferir https sobre http cuando sea posible
  if (parsed.protocol === 'http:') {
    const httpsUrl = new URL(withProtocol.replace(/^http:\/\//, 'https://'));
    return { url: httpsUrl };
  }

  return { url: parsed };
}

// ─── Extracción de signals de página ─────────────────────────────────────────

type PageSignals = {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
};

function extractPageSignals(html: string): PageSignals {
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
): Promise<FetchResult> {
  const redirectChain: string[] = [];
  let currentUrl = startUrl.toString();
  let httpStatus: number | null = null;
  let html: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Seguimos manualmente hasta MAX_REDIRECTS para controlar la cadena
    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
      const safeResult = buildSafeUrl(currentUrl);
      if (!safeResult.url) {
        return {
          httpStatus: null,
          finalUrl: currentUrl,
          redirectChain,
          html: null,
          fetchError: `blocked_redirect_${safeResult.reason}`,
        };
      }

      const response = await fetch(safeResult.url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es,en;q=0.5',
        },
      });

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
          // Leer solo los primeros MAX_HTML_BYTES para no guardar todo el HTML
          const buffer = await response.arrayBuffer();
          const decoder = new TextDecoder('utf-8', { fatal: false });
          html = decoder.decode(buffer.slice(0, MAX_HTML_BYTES));
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
