import type { BulkRoundResponse } from './bulk-search-engine';
import type { WizardExecutionStatus } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';
import type { BulkSearchView } from './bulk-search-view';

/**
 * Cómo se lee una búsqueda masiva en el Process Center y en Growth, y qué hace
 * el conductor después de cada respuesta. Puro: se prueba solo.
 */

/** Sin una ronda en tanto tiempo, nadie la está conduciendo: quien la lanzó salió. */
export const BULK_AWAY_AFTER_MS = 7 * 60_000;

export type BulkDisplayState =
  | 'searching'
  | 'paused_away'
  | 'paused_by_user'
  | 'completed'
  | 'exhausted'
  | 'budget_capped'
  | 'cancelled'
  | 'failed';

export function bulkDisplayState(view: BulkSearchView, nowMs: number, beingDriven = false): BulkDisplayState {
  if (view.status === 'paused') return 'paused_by_user';
  if (view.status !== 'running') return view.status;
  if (beingDriven || view.roundInFlight) return 'searching';
  const last = view.lastRoundAt ? Date.parse(view.lastRoundAt) : Date.parse(view.createdAt);
  return Number.isFinite(last) && nowMs - last < BULK_AWAY_AFTER_MS ? 'searching' : 'paused_away';
}

/** Lo que dice la fila, en palabras de quien la lanzó. */
export function bulkSearchSummary(view: BulkSearchView, state: BulkDisplayState): string {
  const got = `${view.deliveredCount} de ${view.targetCount}`;
  switch (state) {
    case 'searching':
      return `Buscando · ${got} empresas`;
    case 'paused_away':
      return `En pausa porque saliste · ${got}. Sigue sola al volver.`;
    case 'paused_by_user':
      return `Pausada por ti · ${got}`;
    case 'completed':
      return `Listo: ${view.deliveredCount} empresas para revisar.`;
    case 'exhausted':
      return view.stopReason === 'max_rounds'
        ? `Entregó ${got}: llegó al máximo de rondas.`
        : `Entregó ${got}: no aparecieron más empresas nuevas.`;
    case 'budget_capped':
      return view.stopReason === 'monthly_budget'
        ? `Entregó ${got}: se acabó el presupuesto del mes.`
        : `Entregó ${got}: se acabó el tope de créditos.`;
    case 'cancelled':
      return `Cancelada: entregó ${got}.`;
    case 'failed':
      return `Se detuvo por un error: entregó ${got}.`;
  }
}

export function bulkProgressPercent(view: BulkSearchView): number {
  if (view.targetCount <= 0) return 0;
  return Math.min(100, Math.round((view.deliveredCount / view.targetCount) * 100));
}

/** ¿Sigue pidiendo rondas, espera o para? */
export type BulkDriverStep = { kind: 'again' } | { kind: 'wait'; ms: number } | { kind: 'stop' };

export function nextDriverStep(response: BulkRoundResponse | { ok: false; code: string }): BulkDriverStep {
  if (!response.ok) return { kind: 'stop' };
  if (response.next === 'continue') return { kind: 'again' };
  if (response.next === 'wait') return { kind: 'wait', ms: Math.max(1_000, response.retryAfterMs) };
  return { kind: 'stop' };
}

/** En el tray: las vivas y las que terminaron en el último día (máximo 3). */
export const BULK_TRAY_RECENT_MS = 24 * 60 * 60_000;

export function bulkSearchesForTray(searches: readonly BulkSearchView[], nowMs: number): BulkSearchView[] {
  return searches
    .filter((search) => {
      if (search.status === 'running' || search.status === 'paused') return true;
      const done = search.completedAt ? Date.parse(search.completedAt) : Number.NaN;
      return Number.isFinite(done) && nowMs - done < BULK_TRAY_RECENT_MS;
    })
    .slice(0, 3);
}

/** Cada cuánto el asistente abierto relee la búsqueda masiva que acaba de lanzar. */
export const BULK_WIZARD_POLL_MS = 3_000;

/**
 * Cómo cierra el asistente una búsqueda masiva que terminó (dueña 28-10): con el
 * MISMO panel final que una búsqueda normal, con el estado que le corresponde.
 * `null` mientras sigue (en curso o en pausa).
 */
export function bulkWizardOutcome(
  view: Pick<BulkSearchView, 'status' | 'deliveredCount' | 'targetCount' | 'batchIds'>,
): { status: WizardExecutionStatus; batchId: string } | null {
  if (view.status === 'running' || view.status === 'paused') return null;
  const batchId = view.batchIds[view.batchIds.length - 1] ?? '';
  if (view.deliveredCount >= view.targetCount) return { status: 'success_target_reached', batchId };
  if (view.deliveredCount > 0) return { status: 'success_partial', batchId };
  return { status: 'no_new_candidates', batchId };
}
