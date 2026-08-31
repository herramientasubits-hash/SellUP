/**
 * AGENT1-LUSHA-CUT-L3 — la frontera de I/O de la OPERACIÓN LÓGICA durable.
 *
 * TRANSPORTE. No decide nada: no calcula firmas, no elige estado, no autoriza ni
 * bloquea. Traduce las dos RPC de operación de la migración 135 al contrato puro
 * de `lusha-prospecting-operation.ts` y clasifica sus averías.
 *
 * Misma credencial y misma postura que la valla de petición: `service_role`, y
 * `capability_absent` cuando la 135 no está aplicada. Un cliente de sesión que
 * pudiera acuñar o cerrar operaciones podría fabricar el estado que autoriza —o
 * suprime— una búsqueda pagada, o cerrar a mano una operación sin reconciliar
 * para desbloquearse el gasto.
 *
 * 🔴 La ausencia NO abre desvío: el llamador falla CERRADO y no reserva ni
 * despacha. Degradar abierto reabriría la ventana de replay justo cuando no hay
 * testigo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  LushaOperationClaimResult,
  LushaOperationCompleteResult,
  LushaProspectingOperationIdentity,
  LushaProspectingOperationState,
  LushaProspectingOperationStore,
} from './lusha-prospecting-operation';
import { LUSHA_PROSPECTING_OPERATION_STATES } from './lusha-prospecting-operation';
import { createLushaRequestFenceServiceClient } from './lusha-request-fence-store';

/** Las dos funciones de operación de la migración 135. */
export const LUSHA_OPERATION_CLAIM_RPC = 'claim_or_resume_lusha_prospecting_operation';
export const LUSHA_OPERATION_COMPLETE_RPC = 'complete_lusha_prospecting_operation';

function isMissingOperationCapabilityError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42883' || code === 'PGRST202';
}

function readErrorCode(error: unknown, fallback: string): string {
  if (error !== null && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return fallback;
}

type OperationPayload = {
  status: string;
  operationId: string | null;
  state: string | null;
  unsettled: number | null;
};

function readPayload(payload: unknown): OperationPayload | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const status = record['status'];
  if (typeof status !== 'string' || status.length === 0) return null;
  const operationId = record['operation_id'];
  const state = record['state'];
  const unsettled = record['unsettled'];
  return {
    status,
    operationId: typeof operationId === 'string' && operationId.length > 0 ? operationId : null,
    state: typeof state === 'string' && state.length > 0 ? state : null,
    unsettled: typeof unsettled === 'number' && Number.isFinite(unsettled) ? unsettled : null,
  };
}

/**
 * Estado leído de la base.
 *
 * 🔴 Un estado que este código no reconoce NO se descarta: se degrada a
 * `reconciliation_required`, que es el que BLOQUEA. Leerlo como «no pasa nada»
 * convertiría un despliegue por delante del código en una autorización de gasto.
 */
function coerceOperationState(value: string | null): LushaProspectingOperationState {
  if (value !== null && (LUSHA_PROSPECTING_OPERATION_STATES as readonly string[]).includes(value)) {
    return value as LushaProspectingOperationState;
  }
  return 'reconciliation_required';
}

export function createSupabaseLushaProspectingOperationStore(
  client: SupabaseClient,
): LushaProspectingOperationStore {
  return {
    async claimOrResume(
      identity: LushaProspectingOperationIdentity,
    ): Promise<LushaOperationClaimResult> {
      try {
        const { data, error } = await client.rpc(LUSHA_OPERATION_CLAIM_RPC, {
          p_actor_scope: identity.actorScope,
          p_request_signature_version: identity.signatureVersion,
          p_request_signature_hash: identity.signatureHash,
          // TRAZA. La RPC no la usa para decidir nada.
          p_client_request_id: identity.clientRequestId,
        });
        if (error) {
          if (isMissingOperationCapabilityError(error)) return { status: 'capability_absent' };
          return { status: 'failed', code: readErrorCode(error, 'operation_claim_rpc_error') };
        }
        const parsed = readPayload(data);
        if (parsed === null) return { status: 'failed', code: 'operation_claim_unreadable_payload' };
        if (parsed.status === 'created') {
          // Sin id no hay identidad, y sin identidad no se puede vallar ninguna
          // petición. Se falla CERRADO en vez de gastar contra un id ausente.
          if (parsed.operationId === null) {
            return { status: 'failed', code: 'operation_claim_missing_operation_id' };
          }
          return { status: 'created', operationId: parsed.operationId };
        }
        if (parsed.status === 'resumed_unresolved') {
          return {
            status: 'resumed_unresolved',
            operationId: parsed.operationId ?? '',
            state: coerceOperationState(parsed.state),
          };
        }
        return { status: 'failed', code: `operation_claim_${parsed.status}` };
      } catch (err: unknown) {
        if (isMissingOperationCapabilityError(err)) return { status: 'capability_absent' };
        return { status: 'failed', code: 'operation_claim_rpc_threw' };
      }
    },

    async complete(operationId: string): Promise<LushaOperationCompleteResult> {
      try {
        const { data, error } = await client.rpc(LUSHA_OPERATION_COMPLETE_RPC, {
          p_operation_id: operationId,
        });
        if (error) {
          if (isMissingOperationCapabilityError(error)) return { status: 'capability_absent' };
          return { status: 'failed', code: readErrorCode(error, 'operation_complete_rpc_error') };
        }
        const parsed = readPayload(data);
        if (parsed === null) {
          return { status: 'failed', code: 'operation_complete_unreadable_payload' };
        }
        if (parsed.status === 'completed') return { status: 'completed' };
        if (parsed.status === 'already_completed') return { status: 'already_completed' };
        if (parsed.status === 'blocked_unsettled_requests') {
          return { status: 'blocked_unsettled_requests', unsettled: parsed.unsettled ?? 0 };
        }
        if (parsed.status === 'not_found') return { status: 'not_found' };
        return { status: 'failed', code: `operation_complete_${parsed.status}` };
      } catch (err: unknown) {
        if (isMissingOperationCapabilityError(err)) return { status: 'capability_absent' };
        return { status: 'failed', code: 'operation_complete_rpc_threw' };
      }
    },
  };
}

/**
 * La operación que usa la ruta de producción.
 *
 * Reutiliza el MISMO constructor de credencial que la valla de petición: son la
 * misma capacidad de seguridad de gasto y tenerlas resueltas por dos caminos
 * distintos habría dejado dos formas de que una fallara sin la otra.
 */
export function resolveLushaProspectingOperationStore(): LushaProspectingOperationStore {
  return createSupabaseLushaProspectingOperationStore(createLushaRequestFenceServiceClient());
}
