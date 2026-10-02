/**
 * seprec-name-live-query.ts — Bolivia: nombre → NIT EN VIVO contra el registro de
 * comercio (SEPREC, Servicio Plurinacional de Registro de Comercio).
 *
 * SOURCES-BO-NIT-BY-NAME-LIVE-1. Gratuito, sin cuenta ni captcha, sólo lectura
 * (GET). Bolivia no publica un padrón descargable: ésta es la búsqueda por nombre
 * que usa el portal público miempresa.seprec.gob.bo. La dueña autorizó usarla
 * (02-10) sabiendo que no es un servicio documentado para terceros.
 *
 * Dos pasos por empresa:
 *   1. `buscarEmpresas?filtro=<nombre>&tipoFiltro=nombre` → razón social, estado,
 *      tipo de unidad económica e ids.
 *   2. Sólo para las filas cuyo núcleo de nombre es IGUAL al del candidato (como
 *      mucho 2), `informacionBasicaEmpresa/{id}/establecimiento/{idEst}` → `nit`.
 *      De esa ficha se lee SÓLO el NIT y la razón social; los contactos nunca.
 *
 * Quedan fuera las EMPRESAS UNIPERSONALES (código 01: una persona) y las que no
 * están ACTIVAS. Las de matrícula NO renovada salen en la búsqueda, pero el SEPREC
 * no muestra su ficha (responde 412): quedan sin NIT.
 *
 * Tiempo acotado, porque la corrida es secuencial:
 *   - tope de 6 s por petición, y al menos 2,5 s entre peticiones (el SEPREC
 *     responde 429 a las ráfagas; ante un 429 se espera 5 s y se reintenta una vez);
 *   - tras 3 fallos seguidos la fuente se apaga el resto de la corrida;
 *   - como mucho 25 empresas consultadas por corrida;
 *   - y como mucho 45 s en total por corrida (el SEPREC tarda 1,5-4 s por empresa,
 *     medido el 02-10): pasado ese tiempo la fuente deja de preguntar.
 * Cualquier error → vacío: el candidato sigue sin NIT, como hoy.
 */

import type {
  SnapshotNameQuery,
  SnapshotNameRow,
} from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { BOLIVIA_LEGAL_FORMS, normalizeCompanyNameCore } from '@/server/source-catalog/company-name-core';

export const BO_SEPREC_LIVE_SOURCE_KEY = 'bo_seprec_live' as const;

export const BO_SEPREC_API_BASE = 'https://servicios.seprec.gob.bo/api/empresas';
export const BO_SEPREC_REQUEST_TIMEOUT_MS = 6_000;
/**
 * SOURCES-BO-SEPREC-PACING-1 — el SEPREC responde 429 (demasiadas solicitudes) si
 * recibe 4-5 peticiones en pocos segundos (medido el 02-10: con 3 s entre
 * peticiones, 8 de 8 respondieron 200). Se espacian las peticiones y, ante un 429,
 * se espera y se reintenta UNA vez.
 */
export const BO_SEPREC_MIN_INTERVAL_MS = 2_500;
export const BO_SEPREC_RATE_LIMIT_WAIT_MS = 5_000;
export const BO_SEPREC_MAX_CONSECUTIVE_FAILURES = 3;
export const BO_SEPREC_MAX_LOOKUPS_PER_RUN = 25;
export const BO_SEPREC_TOTAL_BUDGET_MS = 45_000;
export const BO_SEPREC_SEARCH_LIMIT = 20;
/** Fichas de detalle pedidas como mucho por empresa (basta para ver homónimos). */
export const BO_SEPREC_MAX_DETAILS_PER_LOOKUP = 2;

/** Tipo «EMPRESA UNIPERSONAL»: una persona, nunca se ofrece. */
const SOLE_TRADER_CODE = '01';

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Núcleo del nombre boliviano: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeBoliviaCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, BOLIVIA_LEGAL_FORMS);
}

export function buildSeprecSearchUrl(core: string): string {
  const params = new URLSearchParams({
    filtro: core,
    tipoFiltro: 'nombre',
    limite: String(BO_SEPREC_SEARCH_LIMIT),
    pagina: '1',
  });
  return `${BO_SEPREC_API_BASE}/buscarEmpresas?${params.toString()}`;
}

export function buildSeprecDetailUrl(id: string, establishmentId: string): string {
  return `${BO_SEPREC_API_BASE}/informacionBasicaEmpresa/${encodeURIComponent(id)}/establecimiento/${encodeURIComponent(establishmentId)}`;
}

type SearchHit = { id: string; establishmentId: string; legalName: string; core: string };

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : null;
}

/** Filas de la búsqueda → empresas activas, no unipersonales, con su núcleo. */
export function parseSeprecSearch(body: unknown): SearchHit[] {
  const rows = (body as { datos?: { filas?: unknown } } | null)?.datos?.filas;
  if (!Array.isArray(rows)) return [];
  const hits: SearchHit[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const type = (row['codTipoUnidadEconomica'] as { codigo?: unknown } | undefined)?.codigo;
    if (text(type) === SOLE_TRADER_CODE) continue;
    if (text(row['estado'])?.toUpperCase() !== 'ACTIVO') continue;
    const id = text(row['id']);
    const establishmentId = text(row['idEstablecimiento']) ?? id;
    const legalName = text(row['razonSocial']);
    if (id === null || establishmentId === null || legalName === null) continue;
    hits.push({ id, establishmentId, legalName, core: normalizeBoliviaCompanyCore(legalName) });
  }
  return hits;
}

/**
 * Una búsqueda con más resultados que éste no se considera «marca distintiva»:
 * «ORIENTAL» devuelve 193 empresas; «MERSUR», «LOGIBOL» o «DAPIBOL», 1-2.
 */
export const BO_SEPREC_BRAND_MAX_SEARCH_TOTAL = 5;

function searchTotal(body: unknown): number | null {
  const total = (body as { datos?: { total?: unknown } } | null)?.datos?.total;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}

/**
 * La marca (todas las palabras del núcleo buscado, como palabras completas) dentro
 * de la razón social de EXACTAMENTE una sociedad activa no unipersonal, y la
 * búsqueda con pocos resultados. Si no, `null`.
 */
export function findBrandInLegalName(
  wanted: string,
  hits: readonly { id: string; establishmentId: string; legalName: string; core: string }[],
  total: number | null,
): { id: string; establishmentId: string; legalName: string; core: string } | null {
  if (total === null || total > BO_SEPREC_BRAND_MAX_SEARCH_TOTAL) return null;
  const words = wanted.split(' ').filter((word) => word.length > 0);
  if (words.length === 0 || words.join('').length < 4) return null;
  const containing = hits.filter((hit) => {
    const coreWords = new Set(hit.core.split(' '));
    return words.every((word) => coreWords.has(word));
  });
  return containing.length === 1 ? containing[0] : null;
}

/**
 * SOURCES-BO-SECTOR-NAME-VARIANT-1 — aseguradoras y administradoras de fondos usan
 * en su web un nombre corto que el SEPREC escribe largo (medido el 02-10):
 *   «Credifondo SAFI»  → CREDIFONDO SOCIEDAD ADMINISTRADORA DE FONDOS DE INVERSION S.A.
 *   «Alianza Seguros»  → ALIANZA COMPAÑIA DE SEGUROS Y REASEGUROS S.A.
 * La búsqueda del SEPREC busca el texto seguido, así que el nombre corto da 0.
 */
export const BO_SEPREC_SECTOR_NAME_VARIANTS: readonly { trailingWord: string; legalPhrase: string }[] = [
  { trailingWord: 'SAFI', legalPhrase: 'SOCIEDAD ADMINISTRADORA DE FONDOS DE INVERSION' },
  { trailingWord: 'SEGUROS', legalPhrase: 'COMPANIA DE SEGUROS' },
];

/** Nombre corto de sector → cómo lo escribe el SEPREC, o `null` si no aplica. */
export function sectorNameVariant(wanted: string): string | null {
  const words = wanted.split(' ').filter((word) => word.length > 0);
  if (words.length < 2) return null;
  const variant = BO_SEPREC_SECTOR_NAME_VARIANTS.find((entry) => entry.trailingWord === words[words.length - 1]);
  if (!variant) return null;
  return [...words.slice(0, -1), variant.legalPhrase].join(' ');
}

/**
 * SOURCES-BO-COUNTRY-SUFFIX-VARIANT-1 — Tavily y Apollo a veces guardan la marca
 * con el país o el dominio pegados (medido el 02-10, lote 0d4b77fb): «Get Server
 * Bolivia» (SEPREC: GET SERVER S.R.L.), «Cognos.com.bo». Colas que se quitan, de la
 * más larga a la más corta.
 */
export const BO_SEPREC_TRAILING_NOISE: readonly string[][] = [
  ['COM', 'BO'],
  ['ORG', 'BO'],
  ['NET', 'BO'],
  ['BOLIVIA'],
  ['BO'],
];

/** Nombre sin el país ni el dominio pegados al final, o `null` si no aplica. */
export function withoutTrailingCountry(wanted: string): string | null {
  const words = wanted.split(' ').filter((word) => word.length > 0);
  for (const tail of BO_SEPREC_TRAILING_NOISE) {
    if (words.length <= tail.length) continue;
    const end = words.slice(-tail.length);
    if (end.every((word, i) => word === tail[i])) return words.slice(0, -tail.length).join(' ');
  }
  return null;
}

/** Ficha de detalle → NIT (sólo dígitos), o `null`. Nada más se lee. */
export function parseSeprecDetailNit(body: unknown): string | null {
  const nit = text((body as { datos?: { nit?: unknown } } | null)?.datos?.nit);
  const digits = nit?.replace(/\D/g, '') ?? '';
  return /^\d{7,13}$/.test(digits) ? digits : null;
}

/** Consulta en vivo nombre → filas (con NIT), con tope de tiempo y apagado por fallos. */
export function buildSeprecNameLiveQuery(
  deps: {
    fetchImpl?: Fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** Sólo para pruebas: presupuesto total por corrida. */
    totalBudgetMs?: number;
  } = {},
): SnapshotNameQuery {
  const doFetch: Fetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  let lookups = 0;
  let consecutiveFailures = 0;
  let spentMs = 0;
  let lastRequestAt: number | null = null;
  const totalBudgetMs = deps.totalBudgetMs ?? BO_SEPREC_TOTAL_BUDGET_MS;
  const budgetLeft = () => spentMs < totalBudgetMs;

  /** Espera (contando en el presupuesto) hasta que pase el intervalo mínimo. */
  const pace = async (minGapMs: number) => {
    if (lastRequestAt === null) return;
    const waitMs = lastRequestAt + minGapMs - now();
    if (waitMs <= 0) return;
    await sleep(waitMs);
    spentMs += waitMs;
  };

  /**
   * Una petición: `null` si falla; `'rate_limited'` si el SEPREC respondió 429;
   * `'timed_out'` si superó el tope por petición (el SEPREC a veces tarda > 6 s en
   * una búsqueda que otras veces responde en < 2 s).
   */
  const request = async (url: string): Promise<unknown | null | 'rate_limited' | 'timed_out'> => {
    const startedAt = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BO_SEPREC_REQUEST_TIMEOUT_MS);
    try {
      const response = await doFetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (response.status === 429) return 'rate_limited';
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return controller.signal.aborted ? 'timed_out' : null;
    } finally {
      clearTimeout(timer);
      lastRequestAt = now();
      spentMs += Math.max(0, lastRequestAt - startedAt);
    }
  };

  const getJson = async (url: string): Promise<unknown | null> => {
    if (consecutiveFailures >= BO_SEPREC_MAX_CONSECUTIVE_FAILURES || !budgetLeft()) return null;
    await pace(BO_SEPREC_MIN_INTERVAL_MS);
    if (!budgetLeft()) return null;
    let body = await request(url);
    // Un 429 o un corte por tiempo se reintentan UNA vez, si queda presupuesto.
    if ((body === 'rate_limited' || body === 'timed_out') && budgetLeft()) {
      await pace(body === 'rate_limited' ? BO_SEPREC_RATE_LIMIT_WAIT_MS : BO_SEPREC_MIN_INTERVAL_MS);
      body = budgetLeft() ? await request(url) : null;
    }
    if (body === null || body === 'rate_limited' || body === 'timed_out') {
      consecutiveFailures += 1;
      return null;
    }
    consecutiveFailures = 0;
    return body;
  };

  return async (core: string) => {
    if (typeof core !== 'string' || core.trim().length === 0) return [];
    if (consecutiveFailures >= BO_SEPREC_MAX_CONSECUTIVE_FAILURES) return [];
    if (lookups >= BO_SEPREC_MAX_LOOKUPS_PER_RUN) return [];
    lookups += 1;

    const wanted = core.trim();
    const search = await getJson(buildSeprecSearchUrl(wanted));
    const hits = parseSeprecSearch(search);
    const matches = hits.filter((hit) => hit.core === wanted);
    const rows: SnapshotNameRow[] = [];
    for (const hit of matches.slice(0, BO_SEPREC_MAX_DETAILS_PER_LOOKUP)) {
      const nit = parseSeprecDetailNit(await getJson(buildSeprecDetailUrl(hit.id, hit.establishmentId)));
      if (nit !== null) rows.push({ taxId: nit, legalName: hit.legalName, normalizedLegalName: hit.core });
    }
    if (rows.length > 0 || matches.length > 0) return rows;

    // SOURCES-BO-BRAND-SIGNAL-1 — sin coincidencia exacta: ¿la marca está dentro de
    // la razón social de UNA sola sociedad activa, en una búsqueda con pocos
    // resultados? Entonces se devuelve como PISTA (nunca NIT fuerte).
    let brand = findBrandInLegalName(wanted, hits, searchTotal(search));

    // SOURCES-BO-SECTOR-NAME-VARIANT-1 — sin marca: si el nombre es «X SAFI» o
    // «X Seguros», UNA búsqueda más con la forma larga. También es sólo pista.
    // Como mucho UNA búsqueda más por empresa (el SEPREC es lento): primero sin el
    // país o el dominio pegados; si no aplica, la forma larga del sector.
    const variant = brand === null && hits.length === 0 ? (withoutTrailingCountry(wanted) ?? sectorNameVariant(wanted)) : null;
    if (variant !== null) {
      const variantSearch = await getJson(buildSeprecSearchUrl(variant));
      brand = findBrandInLegalName(variant, parseSeprecSearch(variantSearch), searchTotal(variantSearch));
    }

    if (brand !== null) {
      const nit = parseSeprecDetailNit(await getJson(buildSeprecDetailUrl(brand.id, brand.establishmentId)));
      if (nit !== null) rows.push({ taxId: nit, legalName: brand.legalName, normalizedLegalName: brand.core, brandSignal: true });
    }
    return rows;
  };
}
