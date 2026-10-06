/**
 * rues-name-live-query.ts — Colombia: nombre → NIT EN VIVO contra el registro de
 * las cámaras de comercio publicado en datos.gov.co (dataset c82u-588k).
 *
 * SOURCES-CO-RUES-LIVE-NIT-1. Gratuito, público y de sólo lectura (GET). Es la
 * segunda fuente de Colombia en la corrida del Agente 1: sólo se consulta cuando la
 * instantánea de Supersociedades (co_siis) no dio un NIT fuerte.
 *
 * Qué se pide: sociedades con NIT (`clase_identificacion = 'NIT'`), no canceladas,
 * cuya razón social EMPIEZA por el núcleo del nombre (búsqueda por prefijo, con
 * índice: ~0,4 s por empresa medido sobre 206 empresas reales). El núcleo de cada
 * fila se recalcula aquí con las mismas formas societarias, y el resolver sólo
 * acepta filas cuyo núcleo es IGUAL al del candidato: el prefijo nunca da una
 * coincidencia parcial.
 *
 * Tiempo acotado, porque la corrida es secuencial:
 *   - cada consulta tiene un tope de 4 s;
 *   - tras 3 fallos seguidos (caída, lentitud, HTTP) la fuente se apaga el resto de
 *     la corrida;
 *   - como mucho 60 consultas por corrida.
 * Cualquier error → vacío: el candidato sigue sin NIT, como hoy.
 */

import type {
  SnapshotNameQuery,
  SnapshotNameRow,
} from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { normalizeColombiaCompanyNameCore } from './co-company-name-core';

/** `source_key` que declara esta fuente (la misma del adaptador por NIT). */
export const CO_RUES_LIVE_SOURCE_KEY = 'co_personas_juridicas_cc' as const;

export const CO_RUES_DATASET_URL = 'https://www.datos.gov.co/resource/c82u-588k.json';
export const CO_RUES_REQUEST_TIMEOUT_MS = 4_000;
export const CO_RUES_MAX_CONSECUTIVE_FAILURES = 3;
export const CO_RUES_MAX_LOOKUPS_PER_RUN = 60;
export const CO_RUES_ROW_LIMIT = 20;

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/**
 * Núcleo del nombre con las formas societarias de Colombia, reconocidas por su
 * estructura (SOURCES-CO-CLOSE-1: «S AS», «S. EN C.», «E.S.E.»…).
 */
export function normalizeColombiaCompanyCore(name: string | null | undefined): string {
  return normalizeColombiaCompanyNameCore(name);
}

/** URL de la consulta por prefijo. El núcleo sólo contiene [A-Z0-9& ]. */
export function buildRuesPrefixUrl(core: string): string {
  const safe = core.replace(/'/g, "''");
  const where =
    `starts_with(razon_social,'${safe}') AND clase_identificacion='NIT' ` +
    `AND estado_matricula!='CANCELADA'`;
  const params = new URLSearchParams({
    $select: 'razon_social,numero_identificacion,estado_matricula',
    $where: where,
    $limit: String(CO_RUES_ROW_LIMIT),
  });
  return `${CO_RUES_DATASET_URL}?${params.toString()}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Fila cruda → fila del resolver (con el núcleo recalculado). */
export function toRuesNameRow(raw: Record<string, unknown>): SnapshotNameRow {
  const legalName = text(raw['razon_social']);
  return {
    taxId: text(raw['numero_identificacion'])?.replace(/\D/g, '') ?? null,
    legalName,
    normalizedLegalName: normalizeColombiaCompanyCore(legalName) || null,
  };
}

/** Consulta en vivo nombre → filas, con tope de tiempo y apagado por fallos. */
export function buildRuesNameLiveQuery(deps: { fetchImpl?: Fetch } = {}): SnapshotNameQuery {
  const doFetch: Fetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  let lookups = 0;
  let consecutiveFailures = 0;

  return async (core: string) => {
    if (typeof core !== 'string' || core.trim().length === 0) return [];
    if (consecutiveFailures >= CO_RUES_MAX_CONSECUTIVE_FAILURES) return [];
    if (lookups >= CO_RUES_MAX_LOOKUPS_PER_RUN) return [];
    lookups += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CO_RUES_REQUEST_TIMEOUT_MS);
    try {
      const response = await doFetch(buildRuesPrefixUrl(core.trim()), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        consecutiveFailures += 1;
        return [];
      }
      const body = await response.json();
      if (!Array.isArray(body)) {
        consecutiveFailures += 1;
        return [];
      }
      consecutiveFailures = 0;
      return body
        .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object')
        .map(toRuesNameRow);
    } catch {
      consecutiveFailures += 1;
      return [];
    } finally {
      clearTimeout(timer);
    }
  };
}
