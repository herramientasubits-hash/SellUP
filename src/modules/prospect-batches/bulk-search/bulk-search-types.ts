/**
 * Búsqueda masiva de Growth (GROWTH-BULK-SEARCH-1, migración 159).
 *
 * Growth pide «hasta N» empresas. Una búsqueda masiva es un registro PADRE que
 * agrupa N rondas, y cada ronda es una corrida NORMAL del asistente con su
 * propio lote: el núcleo del agente no cambia. El Process Center pide la
 * siguiente ronda mientras quien la lanzó tenga SellUp abierto.
 */

/** Las cuatro cantidades que ofrece la pantalla (CHECK de la migración 159). */
export const BULK_TARGET_OPTIONS = [25, 50, 100, 200] as const;
export type BulkTargetCount = (typeof BULK_TARGET_OPTIONS)[number];

export function isBulkTargetCount(value: unknown): value is BulkTargetCount {
  return typeof value === 'number' && (BULK_TARGET_OPTIONS as readonly number[]).includes(value);
}

export const BULK_SEARCH_STATUSES = [
  'running',
  'paused',
  'completed',
  'exhausted',
  'budget_capped',
  'cancelled',
  'failed',
] as const;
export type BulkSearchStatus = (typeof BULK_SEARCH_STATUSES)[number];

/** Viva = todavía puede lanzar rondas (una sola por persona, índice parcial de la 159). */
export const BULK_SEARCH_LIVE_STATUSES: readonly BulkSearchStatus[] = ['running', 'paused'];

export function isBulkSearchLive(status: BulkSearchStatus): boolean {
  return BULK_SEARCH_LIVE_STATUSES.includes(status);
}

/** Por qué terminó o se pausó: lo dice la fila en palabras del servidor. */
export type BulkStopReason =
  | 'target_reached'
  | 'no_new_companies'
  | 'max_rounds'
  | 'credit_cap'
  | 'monthly_budget'
  | 'paused_by_user'
  | 'cancelled_by_user'
  | 'repeated_failures'
  | 'not_allowed';

export type BulkRoundStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

/** El peor caso de UNA ronda, por proveedor (créditos de cada proveedor). */
export interface BulkRoundWorstCase {
  /** Apollo de dos rondas (`estimateCreditsForProvider('apollo_organizations')`). */
  apollo: number;
  /** Lusha según la macroindustria (2, 4 o 6), o 0 si su cascada está apagada. */
  lusha: number;
  /** Tavily (20, o 25 con la búsqueda de LinkedIn). */
  tavily: number;
}

/** Lo que el servidor lee de la fila para decidir la siguiente ronda. */
export interface BulkSearchProgress {
  status: BulkSearchStatus;
  targetCount: BulkTargetCount;
  deliveredCount: number;
  roundsDone: number;
  maxRounds: number;
  creditCap: number;
  creditsUsed: number;
  consecutiveEmptyRounds: number;
  consecutiveFailedRounds: number;
}
