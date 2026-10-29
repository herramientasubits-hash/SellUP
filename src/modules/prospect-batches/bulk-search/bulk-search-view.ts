import type { BulkSearchEstimate } from './bulk-search-estimate';
import type { BulkSearchStatus, BulkStopReason, BulkTargetCount } from './bulk-search-types';

/**
 * Lo que la pantalla ve de una búsqueda masiva (Process Center y Growth). Sin
 * los criterios crudos ni el lease: sólo lo que se pinta.
 */
export interface BulkSearchView {
  id: string;
  label: string;
  status: BulkSearchStatus;
  stopReason: BulkStopReason | null;
  targetCount: BulkTargetCount;
  deliveredCount: number;
  creditCap: number;
  creditsUsed: number;
  roundsDone: number;
  maxRounds: number;
  /** Alguien la está conduciendo ahora mismo (una ronda en vuelo). */
  roundInFlight: boolean;
  lastRoundAt: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Los lotes de sus rondas, para enlazarlos en «Por revisar». */
  batchIds: string[];
  /**
   * La identidad de la corrida de la ronda en curso (dueña 28-10): con ella la
   * espera del asistente lee su etapa en vivo, igual que en una búsqueda normal.
   */
  currentRoundRequestId: string | null;
}

/** La fila tal como sale de `prospect_bulk_searches`. */
export interface BulkSearchRow {
  id: string;
  created_by: string;
  status: BulkSearchStatus;
  stop_reason: string | null;
  target_count: number;
  request: Record<string, unknown> | null;
  credit_cap: number | string;
  credit_cap_breakdown: Record<string, unknown> | null;
  credits_used: number | string;
  delivered_count: number;
  rounds_done: number;
  max_rounds: number;
  consecutive_empty_rounds: number;
  consecutive_failed_rounds: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_round_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface BulkSearchRoundRow {
  id: string;
  bulk_search_id: string;
  round_index: number;
  client_request_id: string;
  batch_id: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  delivered_new: number;
  credits_used: number | string;
  outcome_code: string | null;
  started_at: string;
  finished_at: string | null;
}

const num = (value: number | string | null | undefined): number => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : (value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function readBulkLabel(row: Pick<BulkSearchRow, 'request'>): string {
  const label = row.request?.label;
  return typeof label === 'string' && label.trim() ? label : 'Búsqueda masiva';
}

/** El peor caso pago de una ronda, guardado al crearla (no se recalcula a mitad de camino). */
export function readPerRoundPaidCredits(row: Pick<BulkSearchRow, 'credit_cap_breakdown'>): number {
  return num(row.credit_cap_breakdown?.perRoundPaid as number | undefined);
}

/** La ronda en curso: la última que sigue `running`. */
export function currentRoundRequestIdOf(rounds: readonly Pick<BulkSearchRoundRow, 'round_index' | 'status' | 'client_request_id'>[]): string | null {
  const running = rounds.filter((round) => round.status === 'running').sort((a, b) => b.round_index - a.round_index);
  return running[0]?.client_request_id ?? null;
}

export function toBulkSearchView(
  row: BulkSearchRow,
  batchIds: string[],
  nowMs: number,
  currentRoundRequestId: string | null = null,
): BulkSearchView {
  const leaseUntil = row.lease_expires_at ? Date.parse(row.lease_expires_at) : Number.NaN;
  return {
    id: row.id,
    label: readBulkLabel(row),
    status: row.status,
    stopReason: (row.stop_reason as BulkStopReason | null) ?? null,
    targetCount: row.target_count as BulkTargetCount,
    deliveredCount: row.delivered_count,
    creditCap: num(row.credit_cap),
    creditsUsed: num(row.credits_used),
    roundsDone: row.rounds_done,
    maxRounds: row.max_rounds,
    roundInFlight: Number.isFinite(leaseUntil) && leaseUntil > nowMs,
    lastRoundAt: row.last_round_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    batchIds,
    currentRoundRequestId,
  };
}

/** Lo que se guarda del estimado junto al tope: el desglose y la unidad de cada ronda. */
export function toCreditCapBreakdown(estimate: BulkSearchEstimate): Record<string, number> {
  return {
    ...estimate.breakdown,
    perRoundPaid: estimate.perRoundPaidCredits,
    plannedRounds: estimate.plannedRounds,
  };
}
