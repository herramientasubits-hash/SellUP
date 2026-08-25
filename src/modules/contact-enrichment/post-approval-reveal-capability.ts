// Agente 2A — capability gate REAL de la RPC de la migración 128
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 · CORRECCIÓN)
//
// ═══════════════════════════════════════════════════════════════════
// EL DEFECTO QUE ESTE ARCHIVO CIERRA
// ═══════════════════════════════════════════════════════════════════
//
// El código de este hito puede llegar a Producción ANTES de que la migración 128 se aplique: se
// mergea, se despliega, y `project_approved_candidate_phones_onto_contact` todavía no existe en
// el esquema. Sin esta comprobación, un clic de compra podía reservar créditos y llamar a un
// proveedor (Apollo, y en cascada Lusha) y sólo DESPUÉS, al proyectar, descubrir que no había
// ninguna RPC donde escribir el resultado. El gasto ya habría ocurrido.
//
// ═══════════════════════════════════════════════════════════════════
// CÓMO SE COMPRUEBA, Y POR QUÉ ES REAL Y NO UN PROXY
// ═══════════════════════════════════════════════════════════════════
//
// Ni un número de migración, ni un flag, ni la suposición de que la RPC existe. La sonda hace la
// MISMA llamada que un cliente real haría, con los parámetros que la propia 128 declara
// inofensivos: `p_candidate_id IS NULL` es el PRIMER `IF` de su cuerpo (Step 0, validación, ANTES
// de tocar una fila o abrir un lock), así que:
//
//   * si la función NO existe, PostgREST responde con el código que el resto del subsistema ya
//     usa para lo mismo (`batch-identity-fence.ts`, CUT-3B4/B5): `PGRST202`, o `42883` si el
//     error llega desde el motor;
//   * si la función SÍ existe, devuelve `{status: 'invalid_input', detail: 'candidate_id_missing'}`
//     — CERO filas leídas, CERO locks, CERO escrituras — parseado con el MISMO parser que la
//     llamada real, así que un sobre con forma inesperada también se lee como «no disponible» en
//     vez de como éxito.
//
// FAIL-CLOSED en cada rama: un error de transporte, un sobre irreconocible o una excepción se
// leen todos como `false`. Nunca `true` por omisión.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  PROJECT_APPROVED_CANDIDATE_PHONES_FN,
  parseProjectApprovedCandidatePhonesEnvelope,
} from './post-approval-reveal-core';

/**
 * `true` sólo cuando la RPC de la 128 existe Y contesta con el sobre que ella misma declara para
 * una llamada sin candidato. Cualquier otra cosa —función ausente, error real, sobre
 * irreconocible, excepción— es `false`: fail-closed, nunca «se puede gastar».
 */
export async function checkProjectApprovedCandidatePhonesCapability(): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(PROJECT_APPROVED_CANDIDATE_PHONES_FN, {
      p_candidate_id: null,
      p_contact_id: null,
      p_scalar_fallback: null,
      p_actor_id: null,
      p_now: null,
    });
    if (error) return false;
    return parseProjectApprovedCandidatePhonesEnvelope(data).status === 'invalid_input';
  } catch {
    return false;
  }
}
