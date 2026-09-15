/**
 * Country Evidence Gate — Hito v1.4 / v1.16H-E.2 / X6.2-A
 *
 * Evalúa si hay evidencia real del país objetivo en los datos del candidato
 * (URL, dominio, snippet, título) o si la única señal de país viene de la
 * query que encontró el candidato.
 *
 * Reglas:
 * - strong: TLD del país OR path con señal de país OR snippet/title mencionan país.
 * - query_only: ninguna evidencia en el candidato, pero la query contiene el país.
 * - weak: ninguna evidencia en ningún lado.
 *
 * Países soportados: CO (Colombia), AR (Argentina).
 * Sin llamadas externas. Sin writes. Sin LLM. Determinístico.
 *
 * ── 🔴 AGENT1-COUNTRY-EVIDENCE-CONTRACT-X6.2-A — qué mide y qué NO ───────────
 *
 * Este módulo mide EVIDENCIA A FAVOR: cuánto respaldo hay de que la empresa esté
 * en el país objetivo. NO mide evidencia EN CONTRA, y su `weak` no es un
 * veredicto sobre la empresa: es la descripción de un hueco NUESTRO.
 *
 * La CONTRADICCIÓN de país tiene dueño propio y anterior:
 * `evaluateCountryCompatibility` (`country-compatibility.ts`), invocada por el
 * writer antes que este gate, que descarta con `country_incompatible:*` cuando
 * el TLD o el path sitúan a la empresa en OTRO país. Ese es el gate obligatorio
 * del eje país en el sentido de `candidate-survival.ts`. X6.2-A no lo toca, no
 * lo reimplementa y no lo duplica: precisamente porque ya existe, la ausencia de
 * evidencia medida AQUÍ no puede volver a rechazar a nadie.
 *
 * ── Límite declarado: el ccTLD desnudo de AR ─────────────────────────────────
 *
 * `CO_HOST_SUFFIXES` incluye el ccTLD desnudo `.co`; `AR_URL_SIGNALS` NO incluye
 * `.ar`, y sigue evaluándose por subcadena sobre la URL cruda. Es el MISMO hueco
 * que X6.2-A cierra para Colombia, y queda sin cerrar a propósito: las reglas de
 * registro de segundo nivel de `.ar` son distintas y ampliarlo sale del alcance
 * autorizado de este corte. Se declara aquí, con nombre, para que sea un límite
 * y no un olvido; la suite lo fija con un test que pinne el comportamiento
 * actual de AR, de modo que cambiarlo tenga que ser deliberado.
 */

import { normalizeDomain } from './normalization';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type CountryEvidenceLevel = 'strong' | 'weak' | 'query_only';

export type CountryEvidenceResult = {
  evidenceLevel: CountryEvidenceLevel;
  evidenceSources: string[];
  /** Warning a registrar en metadata del candidato cuando la evidencia es débil. */
  warning: string | null;
};

// ─── Señales Argentina (AR) ──────────────────────────────────────────────────

const AR_URL_SIGNALS = [
  '.com.ar',
  '.net.ar',
  '.org.ar',
  '.gov.ar',
  '.edu.ar',
  '/argentina',
  '/ar-es',
  '/es-ar',
];

const AR_TEXT_SIGNALS = [
  'argentina',
  'buenos aires',
];

// ─── Señales Colombia (CO) ────────────────────────────────────────────────────

/**
 * 🔴 X6.2-A — sufijos de HOSTNAME colombianos.
 *
 * Antes de este corte las señales de dominio y las de path vivían en una sola
 * lista y se comprobaban con `includes()` sobre la URL CRUDA. Esa forma tiene
 * dos defectos, y el segundo ya producía falsos positivos en producción:
 *
 *   1. el ccTLD desnudo `.co` no se podía añadir, porque `includes('.co')` casa
 *      con `.com`, `.company`, `.coop`, `.college` y `.co.uk`. Cuatro de las
 *      nueve empresas que el lote `f6cad05f…` perdió llevaban `.co`
 *      —`caribesupermercados.co`, `sinmente.co`, `misterpollo.co`,
 *      `godomicilios.co`— y el ccTLD SÍ lo reconocen los otros dos módulos que
 *      lo miran (`country-compatibility.ts`, `company-ownership-gate.ts`);
 *   2. `includes('.com.co')` casaba también fuera del host: un path o un
 *      parámetro (`https://x.com/?u=empresa.com.co`) daba evidencia de país
 *      sobre un dominio que no es colombiano.
 *
 * La comprobación es ahora SEMÁNTICA: se extrae el hostname y se compara por
 * SUFIJO. Orden de más largo a más corto para que `empresa.com.co` siga
 * publicando `url:.com.co` y no `url:.co` — las claves de `evidenceSources` ya
 * persistidas no cambian, sólo se añade una nueva, `url:.co`.
 */
const CO_HOST_SUFFIXES = [
  '.com.co',
  '.net.co',
  '.org.co',
  '.gov.co',
  '.edu.co',
  '.mil.co',
  // 🔴 X6.2-A — el ccTLD nacional. Sólo alcanzable por sufijo de hostname.
  '.co',
] as const;

/**
 * Fragmentos de URL/path. Se comprueban sobre la cadena cruda normalizada —no
 * sobre el hostname— porque eso es exactamente lo que son: señales que viven en
 * el camino (`/colombia`) o en el propio nombre (`acme-colombia.com`).
 */
const CO_URL_FRAGMENTS = [
  '/colombia',
  '/es-co',
  '/co-es',
  '-colombia',
] as const;

const CO_TEXT_SIGNALS = [
  'colombia',
  'colombiano',
  'colombiana',
  'bogotá',
  'bogota',
  'medellín',
  'medellin',
  'cali ',
  'barranquilla',
  'cartagena',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * 🔴 X6.2-A — el hostname con el que se juzga el TLD, o `null`.
 *
 * Precedencia `website` → `domain`, la misma que tenía `website ?? domain`, con
 * una diferencia: si el website no parsea a un hostname, se intenta el dominio
 * en vez de darse por vencido. `normalizeDomain` ya baja a minúsculas, quita
 * `www.` y rechaza `localhost` y las IP desnudas.
 *
 * Exportada porque la suite la ejercita directamente: el contrato de este corte
 * es que el TLD se decide sobre un HOSTNAME y nunca sobre la URL cruda.
 */
export function resolveCountryEvidenceHostname(
  website: string | null,
  domain: string | null,
): string | null {
  const fromWebsite = website ? normalizeDomain(website) : null;
  if (fromWebsite !== null) return fromWebsite;
  return domain ? normalizeDomain(domain) : null;
}

/**
 * 🔴 X6.2-A — sufijo colombiano del hostname, o `null`.
 *
 * `endsWith`, nunca `includes`: `carnesfriascalimas.com` no es colombiano y
 * `empresa.co.uk` tampoco. El TLD DESNUDO no es un hostname de empresa
 * (`co`, `com.co` son del registro), así que se excluye explícitamente.
 */
export function matchColombianHostSuffix(hostname: string | null): string | null {
  if (hostname === null || hostname.length === 0) return null;
  const host = hostname.toLowerCase();
  // El propio sufijo NO es un hostname de empresa: `co` y `com.co` son del
  // registro. Se excluyen ANTES del barrido —y no dentro— porque si no
  // `com.co` caería en la rama `.co` por su propio sufijo.
  for (const suffix of CO_HOST_SUFFIXES) {
    if (host === suffix.slice(1)) return null;
  }
  for (const suffix of CO_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return suffix;
  }
  return null;
}

// ─── Evaluación AR ────────────────────────────────────────────────────────────

function evaluateArgentina(input: {
  website: string | null;
  domain: string | null;
  sourceSnippet: string | null;
  sourceTitle: string | null;
  queryText: string | null;
}): CountryEvidenceResult {
  const sources: string[] = [];

  // 1. URL / dominio
  const urlToCheck = normalizeForSearch(input.website ?? input.domain ?? '');
  for (const signal of AR_URL_SIGNALS) {
    if (urlToCheck.includes(signal)) {
      const sourceKey = signal.startsWith('.') ? 'argentina_domain_com_ar' : 'argentina_path_signal';
      sources.push(sourceKey);
      break;
    }
  }

  // 2. Snippet + title
  const combinedText = normalizeForSearch(
    `${input.sourceSnippet ?? ''} ${input.sourceTitle ?? ''}`,
  );
  for (const signal of AR_TEXT_SIGNALS) {
    const normalized = normalizeForSearch(signal);
    if (combinedText.includes(normalized)) {
      const sourceKey =
        signal === 'argentina' ? 'text_country_mention_argentina' : 'argentina_city_mention';
      sources.push(sourceKey);
      break;
    }
  }

  if (sources.length > 0) {
    return { evidenceLevel: 'strong', evidenceSources: sources, warning: null };
  }

  // 3. ¿El país solo viene de la query?
  const queryLower = normalizeForSearch(input.queryText ?? '');
  if (queryLower.includes('argentina')) {
    return {
      evidenceLevel: 'query_only',
      evidenceSources: ['query_text'],
      warning:
        'País no confirmado por evidencia del sitio — solo presente en la query de búsqueda',
    };
  }

  return {
    evidenceLevel: 'weak',
    evidenceSources: [],
    warning: 'País no confirmado por ninguna evidencia del candidato',
  };
}

// ─── Evaluación CO ────────────────────────────────────────────────────────────

function evaluateColombia(input: {
  website: string | null;
  domain: string | null;
  sourceSnippet: string | null;
  sourceTitle: string | null;
  queryText: string | null;
}): CountryEvidenceResult {
  const sources: string[] = [];

  // 1. URL / dominio — 🔴 X6.2-A: primero el SUFIJO del hostname, después los
  // fragmentos de URL. La precedencia (TLD antes que path) y el máximo de UNA
  // fuente de URL son exactamente los de la lista única que había antes.
  const hostSuffix = matchColombianHostSuffix(
    resolveCountryEvidenceHostname(input.website, input.domain),
  );
  if (hostSuffix !== null) {
    sources.push(`url:${hostSuffix}`);
  } else {
    const urlToCheck = normalizeForSearch(input.website ?? input.domain ?? '');
    for (const fragment of CO_URL_FRAGMENTS) {
      if (urlToCheck.includes(fragment)) {
        sources.push(`url:${fragment}`);
        break;
      }
    }
  }

  // 2. Snippet + title
  const combinedText = normalizeForSearch(
    `${input.sourceSnippet ?? ''} ${input.sourceTitle ?? ''}`,
  );
  for (const signal of CO_TEXT_SIGNALS) {
    const normalized = normalizeForSearch(signal);
    if (combinedText.includes(normalized)) {
      sources.push(`text:${signal.trim()}`);
      break;
    }
  }

  if (sources.length > 0) {
    return { evidenceLevel: 'strong', evidenceSources: sources, warning: null };
  }

  // 3. ¿El país solo viene de la query?
  const queryLower = normalizeForSearch(input.queryText ?? '');
  if (queryLower.includes('colombia')) {
    return {
      evidenceLevel: 'query_only',
      evidenceSources: ['query_text'],
      warning:
        'País no confirmado por evidencia del sitio — solo presente en la query de búsqueda',
    };
  }

  return {
    evidenceLevel: 'weak',
    evidenceSources: [],
    warning: 'País no confirmado por ninguna evidencia del candidato',
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Evalúa el nivel de evidencia de país en los datos del candidato.
 * Soporta Colombia (CO) y Argentina (AR). Para otros países retorna 'weak' sin warning.
 */
export function evaluateCountryEvidence(input: {
  website: string | null;
  domain: string | null;
  sourceSnippet: string | null;
  sourceTitle: string | null;
  queryText: string | null;
  targetCountryCode: string | null;
}): CountryEvidenceResult {
  if (input.targetCountryCode === 'CO') {
    return evaluateColombia(input);
  }

  if (input.targetCountryCode === 'AR') {
    return evaluateArgentina(input);
  }

  // Otros países: no implementado aún — retorna sin penalizar
  return { evidenceLevel: 'weak', evidenceSources: [], warning: null };
}
