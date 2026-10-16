/**
 * lusha-reservation-state.ts — LEE el estado de una reserva del período global
 * (`wizard_budget_reservations.status`).
 *
 * WS6 · E — cuando `try_reserve_wizard_credits` responde `already_reserved`, la
 * ruta Lusha necesita saber si esa reserva sigue ABIERTA antes de ejecutar: una
 * reserva ya confirmada/liberada/fallida no cubre gasto nuevo
 * (`guardLushaRunBudget` bloquea). Esto vive aparte de la acción a propósito: la
 * superficie de persistencia de la acción sólo toca lote y candidatos.
 *
 * 🔴 Sólo SELECT. No modifica, no libera, no confirma, no vence la reserva.
 * Nunca lanza: un fallo devuelve `null`, que el guardia trata como «no se pudo
 * verificar» ⇒ no ejecuta (fail-closed).
 */

type ReservationStateLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data: { status?: string | null } | null;
          error: unknown;
        }>;
      };
    };
  };
};

export async function readWizardReservationState(
  client: unknown,
  reservationId: string,
): Promise<string | null> {
  try {
    const { data, error } = await (client as ReservationStateLookupClient)
      .from('wizard_budget_reservations')
      .select('status')
      .eq('id', reservationId)
      .maybeSingle();
    if (error || !data) return null;
    return typeof data.status === 'string' ? data.status : null;
  } catch {
    return null;
  }
}
