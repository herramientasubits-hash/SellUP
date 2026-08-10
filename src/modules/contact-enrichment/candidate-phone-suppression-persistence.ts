// Agente 2A — Escritura CONDICIONAL del cierre terminal por supresión
// (AGENT2A-PHONE-REVEAL-4O-E1)
//
// Implementación server-only del contrato `PersistTerminalPhoneSuppression`
// (phone-reveal-suppression-guard.ts). Es el ÚNICO sitio del repositorio que marca
// un candidato como `error` + `blocked_suppressed` a raíz de una supresión
// detectada por la transacción de la colección: el webhook, la recuperación y la
// pata Lusha del waterfall la inyectan, y ninguno arma la escritura por su cuenta.
//
// ── POR QUÉ CONDICIONAL ────────────────────────────────────────
//
// Entre que la transacción (migraciones 110/111) responde `suppressed` y que este
// UPDATE llega, la fila puede haber cambiado: otro callback pudo revelarla, la
// recuperación pudo cerrarla, o un actor legítimo pudo terminalizarla de otra
// forma. Un `UPDATE ... WHERE id = ?` a secas pisaría ese resultado y convertiría
// un teléfono ya revelado en un `error`. Por eso la escritura exige, en el mismo
// statement, que la fila SIGA en uno de los estados que el caller observó, y
// además que no tenga teléfono visible: si alguna de las dos condiciones ya no se
// cumple, se actualizan 0 filas y el caller conserva su camino fail-closed.
//
// ── LO QUE NO HACE ─────────────────────────────────────────────
//   * NO escribe tombstones nuevos (ni en la caché ni en la colección canónica).
//   * NO toca `phone`, `enrichment_metadata` ni la colección: una supresión no
//     borra aquí lo que ya hubiera, solo impide añadir y deja constancia.
//   * NO llama a ningún proveedor y NO consume créditos.
//   * NO crea contactos, no aprueba candidatos y no escribe HubSpot.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada y no recibe ningún número: el patch solo lleva estados, fechas y
// cifras de crédito. El error del driver se propaga como excepción y quien la
// consume (`applyTerminalPhoneSuppression`) la traduce a un código mecánico.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type {
  PersistTerminalPhoneSuppression,
  TerminalPhoneSuppressionPatch,
} from './phone-reveal-suppression-guard';

export const CONTACT_ENRICHMENT_CANDIDATES_TABLE = 'contact_enrichment_candidates';

/**
 * Marca el candidato como terminal por supresión, SOLO si sigue en uno de los
 * estados esperados y sigue sin teléfono visible.
 *
 * Devuelve `applied: true` únicamente cuando el UPDATE afectó exactamente una
 * fila. `select('id')` es lo que permite contarlas: sin él, PostgREST no informa
 * de cuántas filas casaron y «no casó ninguna» sería indistinguible de «se
 * escribió», que es justo la ambigüedad que este hito no puede permitirse.
 *
 * LANZA si el driver falla. El caller lo trata como no aplicado.
 */
export const persistTerminalPhoneSuppression: PersistTerminalPhoneSuppression =
  async (
    candidateId: string,
    patch: TerminalPhoneSuppressionPatch,
  ): Promise<{ applied: boolean }> => {
    // Sin estados que exigir no hay escritura segura posible: se rechaza en vez de
    // degradar el UPDATE a incondicional.
    if (patch.expectedStatuses.length === 0) return { applied: false };

    const update: Record<string, unknown> = {
      phone_reveal_status: patch.phone_reveal_status,
      phone_reveal_error_code: patch.phone_reveal_error_code,
      phone_reveal_completed_at: patch.phone_reveal_completed_at,
    };
    // Las columnas de costo solo se tocan cuando el patch las trae. Ausentes ⇒ el
    // candidato conserva la cifra de la pata que realmente describe: sobrescribirla
    // con la de otra pata (o con null) borraría un gasto real ya incurrido.
    if (patch.phone_reveal_cost_credits !== undefined) {
      update.phone_reveal_cost_credits = patch.phone_reveal_cost_credits;
    }
    if (patch.phone_reveal_cost_source !== undefined) {
      update.phone_reveal_cost_source = patch.phone_reveal_cost_source;
    }
    if (patch.phone_reveal_provider !== undefined) {
      update.phone_reveal_provider = patch.phone_reveal_provider;
    }
    if (patch.phone_reveal_webhook_received_at !== undefined) {
      update.phone_reveal_webhook_received_at = patch.phone_reveal_webhook_received_at;
    }
    if (patch.phone_reveal_last_checked_at !== undefined) {
      update.phone_reveal_last_checked_at = patch.phone_reveal_last_checked_at;
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(CONTACT_ENRICHMENT_CANDIDATES_TABLE)
      .update(update)
      .eq('id', candidateId)
      // La condición de pertenencia: la fila tiene que seguir donde el caller la vio.
      .in('phone_reveal_status', patch.expectedStatuses as string[])
      // Defensa en profundidad: nunca se marca terminal por supresión una fila que
      // ya está mostrando un número. Ese caso lo resuelve una DSAR, no este cierre.
      .is('phone', null)
      .select('id');
    if (error) throw new Error(error.message);
    return { applied: Array.isArray(data) && data.length === 1 };
  };
