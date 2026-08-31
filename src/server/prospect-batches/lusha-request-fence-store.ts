/**
 * AGENT1-LUSHA-CUT-L3 — la frontera de I/O de la valla durable.
 *
 * TRANSPORTE. No decide nada: no clasifica facturación, no elige estado, no
 * autoriza ni bloquea. Traduce las tres RPC de la migración 135 al contrato puro
 * de `lusha-request-fence.ts` y clasifica sus averías.
 *
 * ── Por qué `service_role` ───────────────────────────────────────────────────
 *
 * `lusha_prospecting_request_fence` sólo concede SELECT/INSERT/UPDATE a
 * `service_role`, y las tres funciones tienen EXECUTE revocado para `anon` y
 * `authenticated`. No es celo: si un cliente de sesión pudiera reclamar, marcar o
 * liquidar una valla, podría fabricar el estado que autoriza —o que suprime— una
 * petición pagada. Es la misma credencial que ya usa la reserva de presupuesto.
 *
 * ── `capability_absent` NO es una preferencia ────────────────────────────────
 *
 * La 135 se entrega SIN aplicar. Cuando las funciones no existen, la base lo dice
 * (SQLSTATE 42883 / PostgREST PGRST202) y esto devuelve `capability_absent`.
 *
 * 🔴 A diferencia de CUT-3B4 —donde la ausencia de la 126 conserva la ruta
 * anterior— aquí la ausencia NO abre ningún desvío: el llamador falla CERRADO y
 * no despacha. Degradar abierto sería reabrir exactamente la ventana de replay
 * que este corte existe para cerrar, y hacerlo justo cuando no hay testigo.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  LushaRequestFenceClaimResult,
  LushaRequestFenceContext,
  LushaRequestFenceDispatchMarkResult,
  LushaRequestFenceIdentity,
  LushaRequestFenceSettlement,
  LushaRequestFenceSettleResult,
  LushaRequestFenceState,
  LushaRequestFenceStore,
} from './lusha-request-fence';
import { buildLushaRequestFenceKey } from './lusha-request-fence';

/** Las tres funciones de la migración 135. */
export const LUSHA_REQUEST_FENCE_CLAIM_RPC = 'claim_lusha_prospecting_request';
export const LUSHA_REQUEST_FENCE_MARK_RPC = 'mark_lusha_prospecting_request_dispatched';
export const LUSHA_REQUEST_FENCE_SETTLE_RPC = 'settle_lusha_prospecting_request';

/**
 * Dos formas, porque hay dos capas: PostgREST responde `PGRST202` cuando no
 * encuentra la función en su caché de esquema, y PostgreSQL responde `42883`
 * cuando la función no existe.
 */
function isMissingFenceCapabilityError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42883' || code === 'PGRST202';
}

function readStatus(payload: unknown): { status: string; state: string | null } | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const status = record['status'];
  if (typeof status !== 'string' || status.length === 0) return null;
  const state = record['state'];
  return { status, state: typeof state === 'string' && state.length > 0 ? state : null };
}

const KNOWN_STATES: readonly string[] = [
  'prepared',
  'dispatch_unsafe',
  'succeeded',
  'definitely_not_charged',
  'indeterminate',
  'unknown',
];

/**
 * Estado leído de la base.
 *
 * 🔴 Un estado que este código no reconoce NO se descarta a `null`: se degrada a
 * `indeterminate`, que es el estado que BLOQUEA. Leerlo como «no hay nada» sería
 * convertir un despliegue por delante del código en una autorización de replay.
 */
function coerceState(value: string | null): LushaRequestFenceState | null {
  if (value === null) return null;
  if (KNOWN_STATES.includes(value)) return value as LushaRequestFenceState;
  return 'indeterminate';
}

/**
 * Cliente `service_role` para la valla.
 *
 * Se construye aparte del de presupuesto a propósito: son dos capacidades
 * distintas y una sesión de pruebas debe poder doblar una sin heredar la otra.
 * Lanza si faltan credenciales — sin cliente no hay valla, y sin valla el
 * llamador no despacha.
 */
export function createLushaRequestFenceServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase service_role credentials required for the Lusha prospecting request fence',
    );
  }
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Evidencia terminal → jsonb plano. Sólo claves conocidas; la RPC ignora el resto. */
function buildEvidencePayload(
  settlement: LushaRequestFenceSettlement,
): Record<string, unknown> {
  return {
    outcome_class: settlement.outcomeClass,
    billing_certainty: settlement.billingCertainty,
    retry_contract: settlement.retryContract,
    http_status: settlement.httpStatus,
    provider_request_id: settlement.providerRequestId,
    credits_charged: settlement.creditsCharged,
    results_returned: settlement.resultsReturned,
    rate_limit_minute_limit: settlement.rateLimit?.minuteLimit ?? null,
    rate_limit_minute_remaining: settlement.rateLimit?.minuteRemaining ?? null,
    rate_limit_daily_limit: settlement.rateLimit?.dailyLimit ?? null,
    rate_limit_daily_remaining: settlement.rateLimit?.dailyRemaining ?? null,
  };
}

/** La valla real, contra la migración 135. */
export function createSupabaseLushaRequestFenceStore(
  client: SupabaseClient,
): LushaRequestFenceStore {
  return {
    async claim(
      identity: LushaRequestFenceIdentity,
      context: LushaRequestFenceContext,
    ): Promise<LushaRequestFenceClaimResult> {
      let fenceKey: string;
      try {
        fenceKey = buildLushaRequestFenceKey(identity);
      } catch (err: unknown) {
        return {
          status: 'failed',
          code: err instanceof Error ? err.message : 'fence_identity_invalid',
        };
      }
      try {
        const { data, error } = await client.rpc(LUSHA_REQUEST_FENCE_CLAIM_RPC, {
          p_fence_key: fenceKey,
          // 🔴 La identidad DURABLE. Antes viajaba aquí `client_request_id`, que es
          // fresco por clic; la RPC además rechaza reclamar contra una operación
          // que ya no esté abierta (`operation_not_open`).
          p_operation_id: identity.operationId,
          p_branch_index: identity.branchIndex,
          p_page_index: identity.page,
          // TRAZA de correlación. No participa en la identidad.
          p_client_request_id: context.clientRequestId,
          p_triggered_by: context.triggeredByUserId,
          p_reservation_id: context.reservationId,
        });
        if (error) {
          if (isMissingFenceCapabilityError(error)) return { status: 'capability_absent' };
          return { status: 'failed', code: readErrorCode(error, 'fence_claim_rpc_error') };
        }
        const parsed = readStatus(data);
        if (parsed === null) return { status: 'failed', code: 'fence_claim_unreadable_payload' };
        if (parsed.status === 'claimed') return { status: 'claimed' };
        if (parsed.status === 'already_claimed') {
          // Sin estado legible se bloquea igual, en el estado que MÁS restringe.
          return { status: 'already_claimed', state: coerceState(parsed.state) ?? 'indeterminate' };
        }
        return { status: 'failed', code: `fence_claim_${parsed.status}` };
      } catch (err: unknown) {
        if (isMissingFenceCapabilityError(err)) return { status: 'capability_absent' };
        return { status: 'failed', code: 'fence_claim_rpc_threw' };
      }
    },

    async markDispatchUnsafe(fenceKey: string): Promise<LushaRequestFenceDispatchMarkResult> {
      try {
        const { data, error } = await client.rpc(LUSHA_REQUEST_FENCE_MARK_RPC, {
          p_fence_key: fenceKey,
        });
        if (error) {
          if (isMissingFenceCapabilityError(error)) return { status: 'capability_absent' };
          return { status: 'failed', code: readErrorCode(error, 'fence_mark_rpc_error') };
        }
        const parsed = readStatus(data);
        if (parsed === null) return { status: 'failed', code: 'fence_mark_unreadable_payload' };
        if (parsed.status === 'marked') return { status: 'marked' };
        if (parsed.status === 'not_claimable') {
          return { status: 'not_claimable', state: coerceState(parsed.state) };
        }
        return { status: 'failed', code: `fence_mark_${parsed.status}` };
      } catch (err: unknown) {
        if (isMissingFenceCapabilityError(err)) return { status: 'capability_absent' };
        return { status: 'failed', code: 'fence_mark_rpc_threw' };
      }
    },

    async settle(
      fenceKey: string,
      settlement: LushaRequestFenceSettlement,
    ): Promise<LushaRequestFenceSettleResult> {
      try {
        const { data, error } = await client.rpc(LUSHA_REQUEST_FENCE_SETTLE_RPC, {
          p_fence_key: fenceKey,
          p_state: settlement.state,
          p_evidence: buildEvidencePayload(settlement),
        });
        if (error) {
          if (isMissingFenceCapabilityError(error)) return { status: 'capability_absent' };
          return { status: 'failed', code: readErrorCode(error, 'fence_settle_rpc_error') };
        }
        const parsed = readStatus(data);
        if (parsed === null) return { status: 'failed', code: 'fence_settle_unreadable_payload' };
        if (parsed.status === 'settled') return { status: 'settled' };
        if (parsed.status === 'already_terminal') {
          return { status: 'already_terminal', state: coerceState(parsed.state) ?? 'indeterminate' };
        }
        if (parsed.status === 'not_found') return { status: 'not_found' };
        return { status: 'failed', code: `fence_settle_${parsed.status}` };
      } catch (err: unknown) {
        if (isMissingFenceCapabilityError(err)) return { status: 'capability_absent' };
        return { status: 'failed', code: 'fence_settle_rpc_threw' };
      }
    },
  };
}

function readErrorCode(error: unknown, fallback: string): string {
  if (error !== null && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return fallback;
}

/**
 * La valla que usa la ruta de producción. Resolver la credencial aquí —y no en el
 * llamador— mantiene una sola forma de construirla.
 */
export function resolveLushaRequestFenceStore(): LushaRequestFenceStore {
  return createSupabaseLushaRequestFenceStore(createLushaRequestFenceServiceClient());
}
