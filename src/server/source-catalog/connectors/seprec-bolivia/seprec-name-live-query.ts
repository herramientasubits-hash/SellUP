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
 * están ACTIVAS.
 *
 * Tiempo acotado, porque la corrida es secuencial:
 *   - tope de 4 s por petición;
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
export const BO_SEPREC_REQUEST_TIMEOUT_MS = 4_000;
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
  json: () => Promise<unknown>;
}>;

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

/** Ficha de detalle → NIT (sólo dígitos), o `null`. Nada más se lee. */
export function parseSeprecDetailNit(body: unknown): string | null {
  const nit = text((body as { datos?: { nit?: unknown } } | null)?.datos?.nit);
  const digits = nit?.replace(/\D/g, '') ?? '';
  return /^\d{7,13}$/.test(digits) ? digits : null;
}

/** Consulta en vivo nombre → filas (con NIT), con tope de tiempo y apagado por fallos. */
export function buildSeprecNameLiveQuery(deps: { fetchImpl?: Fetch; now?: () => number } = {}): SnapshotNameQuery {
  const doFetch: Fetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => Date.now());
  let lookups = 0;
  let consecutiveFailures = 0;
  let spentMs = 0;
  const budgetLeft = () => spentMs < BO_SEPREC_TOTAL_BUDGET_MS;

  const getJson = async (url: string): Promise<unknown | null> => {
    if (consecutiveFailures >= BO_SEPREC_MAX_CONSECUTIVE_FAILURES || !budgetLeft()) return null;
    const startedAt = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BO_SEPREC_REQUEST_TIMEOUT_MS);
    try {
      const response = await doFetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        consecutiveFailures += 1;
        return null;
      }
      const body = await response.json();
      consecutiveFailures = 0;
      return body;
    } catch {
      consecutiveFailures += 1;
      return null;
    } finally {
      clearTimeout(timer);
      spentMs += Math.max(0, now() - startedAt);
    }
  };

  return async (core: string) => {
    if (typeof core !== 'string' || core.trim().length === 0) return [];
    if (consecutiveFailures >= BO_SEPREC_MAX_CONSECUTIVE_FAILURES) return [];
    if (lookups >= BO_SEPREC_MAX_LOOKUPS_PER_RUN) return [];
    lookups += 1;

    const search = await getJson(buildSeprecSearchUrl(core.trim()));
    const matches = parseSeprecSearch(search).filter((hit) => hit.core === core.trim());
    const rows: SnapshotNameRow[] = [];
    for (const hit of matches.slice(0, BO_SEPREC_MAX_DETAILS_PER_LOOKUP)) {
      const nit = parseSeprecDetailNit(await getJson(buildSeprecDetailUrl(hit.id, hit.establishmentId)));
      if (nit !== null) rows.push({ taxId: nit, legalName: hit.legalName, normalizedLegalName: hit.core });
    }
    return rows;
  };
}
