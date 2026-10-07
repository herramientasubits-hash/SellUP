/**
 * AGENT1-RESCUED-FREE-LAYER-KEEPS-DATA-1 — el tamaño oficial de una fila de
 * Descartadas del buscador gratuito, listo para el candidato que nace al enviarla
 * a revisión.
 *
 * Desde SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 la empresa que entra DIRECTO llega con
 * los trabajadores que publica la fuente (Supercias, SUNAT, SII…). La que llega
 * por Descartadas (sin web → rescate de Claude) los perdía. Prod 07-10, Ecuador ×
 * Retail (2aab8384): Corporación Favorita (12.033) y TIA (9.501) llegaron «por
 * validar». Ecuador 0 de 38, Chile 18 de 47 en los últimos 3 días.
 *
 * Mismas reglas que el escritor estructurado (`resolveOfficialEmployeeCount`):
 * entero positivo, estado `estimated_*` (nunca `confirmed_*`), procedencia
 * «Supercias 2025», confianza 90. Sólo filas de fuente oficial (`public_source`).
 *
 * Puro: sin env, sin I/O.
 */

/** Clave de la evidencia de la fila de Descartadas. */
export const FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY = 'official_workforce';

/** La MISMA confianza que `OFFICIAL_EMPLOYEE_COUNT_CONFIDENCE` del escritor estructurado. */
const OFFICIAL_EMPLOYEE_COUNT_CONFIDENCE = 90;
const ICP_SIZE_LINE = 100;

export type CandidateOfficialWorkforceColumns = {
  employee_count: number;
  employee_count_status: 'estimated_100_plus' | 'estimated_under_100';
  employee_count_source: string;
  employee_count_confidence: number;
};

/** Columnas de tamaño del candidato, o `{}` si la fila no trae un tamaño oficial válido. */
export function officialWorkforceFromDisposition(disposition: {
  sourcePrimary: string | null | undefined;
  evidence: Readonly<Record<string, unknown>> | null | undefined;
}): CandidateOfficialWorkforceColumns | Record<string, never> {
  if (disposition.sourcePrimary !== 'public_source') return {};
  const raw = disposition.evidence?.[FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY];
  if (!raw || typeof raw !== 'object') return {};
  const { workers, year, source_label: sourceLabel } = raw as Record<string, unknown>;
  if (typeof workers !== 'number' || !Number.isInteger(workers) || workers < 1) return {};
  const label = typeof sourceLabel === 'string' ? sourceLabel.trim() : '';
  if (label === '') return {};
  const validYear = typeof year === 'number' && Number.isInteger(year) ? year : null;
  return {
    employee_count: workers,
    employee_count_status: workers >= ICP_SIZE_LINE ? 'estimated_100_plus' : 'estimated_under_100',
    employee_count_source: validYear !== null ? `${label} ${validYear}` : label,
    employee_count_confidence: OFFICIAL_EMPLOYEE_COUNT_CONFIDENCE,
  };
}
