// ============================================================
// Asistente de Slack — qué quedó hecho DE VERDAD tras confirmar (puro).
// El resultado se decide por el estado leído de la base, no sólo por lo que
// respondió la acción: si la acción respondió error pero la base muestra el
// cambio, quedó hecho (y al revés).
// ============================================================

import type { DecodedAction, ItemOutcome } from './action-proposal';

export interface VerifiedState {
  name: string;
  /** Estado de la candidata (null para empresas). */
  status: string | null;
  /** Responsable: `assigned_to` (prospecto) u `owner_id` (empresa). */
  owner: string | null;
  convertedAccountId: string | null;
}

const APPROVED = new Set(['approved', 'converted_to_account']);

export function verifyOutcomes(
  action: Pick<DecodedAction, 'kind' | 'ids' | 'targetUserId'>,
  state: ReadonlyMap<string, VerifiedState>,
  failures: ReadonlyMap<string, string>,
): ItemOutcome[] {
  return action.ids.map((id) => {
    const row = state.get(id);
    if (!row) return { nombre: id, ok: false, detalle: 'no se encontró' };
    const failure = failures.get(id);
    switch (action.kind) {
      case 'approve':
        return APPROVED.has(row.status ?? '')
          ? { nombre: row.name, ok: true, detalle: row.convertedAccountId ? 'ya está en Empresas' : 'aprobado' }
          : { nombre: row.name, ok: false, detalle: failure ?? 'sigue en Por revisar' };
      case 'discard':
        return row.status === 'discarded'
          ? { nombre: row.name, ok: true, detalle: '' }
          : { nombre: row.name, ok: false, detalle: failure ?? 'no quedó descartado' };
      default:
        return row.owner && row.owner === action.targetUserId
          ? { nombre: row.name, ok: true, detalle: '' }
          : { nombre: row.name, ok: false, detalle: failure ?? 'no cambió de responsable' };
    }
  });
}
