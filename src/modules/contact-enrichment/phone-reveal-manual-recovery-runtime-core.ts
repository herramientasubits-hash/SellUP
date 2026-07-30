// Agente 2A — Apollo Phone Reveal: RECOVERY L3 (runtime PURO)
// (APOLLO-PHONE-RECOVERY-L3)
//
// Orquestador PURO y con dependencias inyectadas de la revisión manual de UN
// candidato desde el sidepanel. Mismo patrón que el resto del pipeline de
// phone-reveal: aquí vive toda la decisión; el wrapper 'use server'
// (phone-reveal-manual-recovery-actions.ts) resuelve el actor autenticado y cablea
// el I/O real (Supabase service-role, Apollo GET de recuperación,
// provider_usage_logs) reutilizando `buildRecoveryCoreDeps`.
//
// Este módulo NO hace red, NO toca Supabase, NO lee env, NO agenda nada y NO
// imprime. Solo:
//   1. Valida el candidateId y aplica los gates de elegibilidad L3 (rol, proveedor,
//      estado en vuelo, teléfono ausente, id de recuperación, ventana de 2 min,
//      anti-abuso de 60 s) ANTES de tocar ninguna dep de I/O.
//   2. Llama EXACTAMENTE UNA VEZ al recovery core ya mergeado
//      (recoverApolloPhoneRevealForCandidate) con `dryRun: false`. Ese core es el
//      que hace el único `GET /webhook_result/{apollo_http_request_id}`, comprueba
//      la supresión, persiste y registra el usage-log `recovery_poll`.
//   3. Reduce el resultado a un resumen SEGURO para la UI: estado, banderas,
//      `retryAfterSeconds`, etiqueta de tipo de teléfono y créditos.
//
// LO QUE NUNCA HACE (heredado del recovery core; aquí no se relaja)
//   * NO inicia un reveal nuevo: no llama /people/match, no manda
//     `reveal_phone_number`, no consume créditos nuevos.
//   * NO procesa lotes: un solo candidato por invocación, sin retry ni loop.
//   * NO toca Lusha, NO escribe HubSpot, NO crea contactos, NO aprueba candidatos.
//   * NO devuelve teléfono, raw_number, sanitized_number, email, linkedin, nombre,
//     empresa, API key, token, request id ni payload crudo.

import {
  evaluateManualRecoveryEligibility,
  type ManualRecoveryActor,
  type ManualRecoveryBlockReason,
  type ManualRecoveryCandidateSnapshot,
} from './phone-reveal-manual-recovery-core';
import type {
  RecoverApolloPhoneRevealInput,
  RecoverApolloPhoneRevealResult,
} from './phone-reveal-recovery-core';

// ── Entrada / salida ───────────────────────────────────────────

export interface ManualRecoveryRuntimeInput {
  candidateId: string;
}

/** Estado seguro para la UI (sin PII). */
export type ManualRecoveryRuntimeStatus =
  | 'revealed'
  | 'no_phone_found'
  | 'still_pending'
  | 'blocked_suppressed'
  | 'not_eligible'
  | 'error';

export interface ManualRecoveryRuntimeResult {
  /** true cuando el poll llegó a ejecutarse y produjo una disposición conocida. */
  ok: boolean;
  mode: 'manual_single';
  status: ManualRecoveryRuntimeStatus;
  /**
   * Estado del reveal del candidato tras la revisión, tal como lo verá la UI al
   * recargar. En los caminos no terminales conserva el estado en vuelo.
   */
  phoneRevealStatus: string | null;
  /** true solo cuando el poll entregó un teléfono y el core lo persistió. */
  phoneRevealed: boolean;
  /** true cuando Apollo entregó el resultado y NO había teléfono. */
  noPhoneFound: boolean;
  /** true cuando Apollo sigue procesando: nada terminal se persistió. */
  stillPending: boolean;
  /**
   * Segundos sugeridos antes de volver a revisar. Viene del `retry_after_seconds`
   * de Apollo cuando el payload dice "pendiente", o de la ventana pendiente cuando
   * el bloqueo es temporal (aún no han pasado 2 min / 60 s). null si no aplica.
   */
  retryAfterSeconds: number | null;
  /** Etiqueta de tipo (mobile / direct_dial / work …). NUNCA el número. */
  phoneType: string | null;
  /** Créditos reportados por el payload recuperado; null si no aplican. */
  creditsUsed: number | null;
  /** Mensaje MECÁNICO (código, sin PII): la UI traduce a copy en español. */
  message: string;
}

export interface ManualRecoveryRuntimeDeps {
  actor: ManualRecoveryActor;
  /** Timestamp ISO estable (inyectado para tests deterministas). */
  nowIso: string;
  /**
   * Carga la foto de solo lectura del candidato (sin PII). null si no existe.
   * Se invoca solo tras validar el candidateId; NUNCA si el actor no está
   * autorizado (fail-closed antes de cualquier I/O).
   */
  loadSnapshot: (
    candidateId: string,
  ) => Promise<ManualRecoveryCandidateSnapshot | null>;
  /**
   * Ejecuta el recovery core con deps reales (o un stub en tests). Se invoca UNA
   * sola vez y solo cuando la elegibilidad es `true`.
   */
  recoverCandidate: (
    input: RecoverApolloPhoneRevealInput,
  ) => Promise<RecoverApolloPhoneRevealResult>;
}

// ── Helpers ────────────────────────────────────────────────────

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Motivo de la recuperación manual. Su TEXTO no se persiste (solo su presencia). */
const MANUAL_RECOVERY_REASON = 'manual_ui_recovery';

/**
 * Foto neutra usada solo para probar el gate de rol antes de leer nada. Es
 * estructuralmente elegible en todo lo demás, así que el ÚNICO motivo de bloqueo
 * que puede producir es `unauthorized_role`.
 */
const NEUTRAL_SNAPSHOT: ManualRecoveryCandidateSnapshot = {
  phoneRevealProvider: 'apollo',
  phoneRevealStatus: 'requested',
  hasPhone: false,
  recoveryIdPresent: true,
  requestedAtIso: '1970-01-01T00:00:00.000Z',
  lastCheckedAtIso: null,
};

function safeResult(
  status: ManualRecoveryRuntimeStatus,
  message: string,
  extra: Partial<
    Omit<ManualRecoveryRuntimeResult, 'mode' | 'status' | 'message' | 'ok'>
  > = {},
  ok = true,
): ManualRecoveryRuntimeResult {
  return {
    ok,
    mode: 'manual_single',
    status,
    phoneRevealStatus: extra.phoneRevealStatus ?? null,
    phoneRevealed: extra.phoneRevealed ?? false,
    noPhoneFound: extra.noPhoneFound ?? false,
    stillPending: extra.stillPending ?? false,
    retryAfterSeconds: extra.retryAfterSeconds ?? null,
    phoneType: extra.phoneType ?? null,
    creditsUsed: extra.creditsUsed ?? null,
    message,
  };
}

/**
 * Traduce un bloqueo de elegibilidad a estado seguro. Los bloqueos temporales
 * (ventana de 2 min / anti-abuso de 60 s) siguen siendo `not_eligible`: no fallaron,
 * simplemente todavía no toca — y llevan los segundos que faltan.
 */
function blockedResult(
  reason: ManualRecoveryBlockReason,
  retryAfterSeconds: number | null,
  phoneRevealStatus: string | null,
): ManualRecoveryRuntimeResult {
  const isTemporary =
    reason === 'requested_too_recently' || reason === 'checked_too_recently';
  return safeResult(
    reason === 'unauthorized_role' ? 'error' : 'not_eligible',
    reason,
    {
      retryAfterSeconds: isTemporary ? retryAfterSeconds : null,
      phoneRevealStatus,
    },
    false,
  );
}

/** Mapea el outcome del recovery core a un estado seguro de salida. */
function mapOutcome(
  result: RecoverApolloPhoneRevealResult,
  inFlightStatus: string | null,
): ManualRecoveryRuntimeResult {
  switch (result.outcome) {
    case 'revealed':
      return safeResult('revealed', result.outcome, {
        phoneRevealStatus: 'revealed',
        phoneRevealed: true,
        phoneType: result.phoneType,
        creditsUsed: result.creditsUsed,
      });
    case 'no_phone_found':
      return safeResult('no_phone_found', result.outcome, {
        phoneRevealStatus: 'no_phone_found',
        noPhoneFound: true,
        creditsUsed: result.creditsUsed,
      });
    // Apollo sigue procesando (200 pendiente) o 404 ambiguo: nada terminal se
    // persistió y el candidato sigue en vuelo, así que se puede volver a revisar.
    case 'still_pending':
    case 'not_found_or_pending_ambiguous':
      return safeResult('still_pending', result.outcome, {
        phoneRevealStatus: inFlightStatus,
        stillPending: true,
        retryAfterSeconds: result.retryAfterSeconds ?? null,
      });
    // Tombstone de supresión (DSAR): el resultado correcto y deseado, no un fallo.
    case 'blocked_suppressed':
      return safeResult('blocked_suppressed', result.outcome, {
        phoneRevealStatus: 'error',
      });
    // Condiciones técnicas sin resolver: nada se persistió, 0 créditos nuevos y el
    // candidato sigue recuperable más tarde.
    case 'suppression_check_unavailable':
    case 'possible_missing_webhook_result_read_scope':
    case 'provider_error_transient':
      return safeResult(
        'error',
        result.outcome,
        { phoneRevealStatus: inFlightStatus },
        false,
      );
    // Inelegibles revalidados por el core (defensa en profundidad: la foto que vio
    // el runtime pudo quedar obsoleta entre la lectura y el poll).
    default:
      return safeResult(
        'not_eligible',
        result.outcome,
        { phoneRevealStatus: inFlightStatus },
        false,
      );
  }
}

// ── Revisión manual de UN candidato ────────────────────────────

/**
 * Revisa AHORA el resultado de un reveal Apollo en vuelo, a petición explícita de
 * una persona. Fail-closed y en orden barato→caro:
 *   1. candidateId vacío ⇒ error, sin tocar deps.
 *   2. Foto del candidato no encontrada ⇒ `not_eligible`, sin poll.
 *   3. Elegibilidad L3 (rol, proveedor, en vuelo, sin teléfono, id presente,
 *      ventana 2 min, anti-abuso 60 s) ⇒ si falla, `not_eligible`/`error` sin poll.
 *   4. Solo entonces UN llamado al recovery core con `dryRun: false`.
 * El resultado nunca incluye PII ni el payload crudo.
 */
export async function runManualPhoneRevealRecovery(
  input: ManualRecoveryRuntimeInput,
  deps: ManualRecoveryRuntimeDeps,
): Promise<ManualRecoveryRuntimeResult> {
  const candidateId = cleanText(input.candidateId);
  if (!candidateId) {
    return safeResult('error', 'invalid_candidate', {}, false);
  }

  // El gate de rol se evalúa en `evaluateManualRecoveryEligibility`, pero primero
  // hace falta la foto. Para no leer nada con un actor no autorizado se evalúa el
  // rol con una foto neutra: si el rol no pasa, se corta sin tocar Supabase.
  const roleProbe = evaluateManualRecoveryEligibility({
    actor: deps.actor,
    snapshot: NEUTRAL_SNAPSHOT,
    nowIso: deps.nowIso,
  });
  if (!roleProbe.eligible && roleProbe.reason === 'unauthorized_role') {
    return blockedResult('unauthorized_role', null, null);
  }

  const snapshot = await deps.loadSnapshot(candidateId);
  if (!snapshot) {
    return safeResult('not_eligible', 'candidate_not_found', {}, false);
  }

  const eligibility = evaluateManualRecoveryEligibility({
    actor: deps.actor,
    snapshot,
    nowIso: deps.nowIso,
  });
  if (!eligibility.eligible) {
    return blockedResult(
      eligibility.reason,
      eligibility.retryAfterSeconds,
      snapshot.phoneRevealStatus,
    );
  }

  const result = await deps.recoverCandidate({
    candidateId,
    actorUserId: deps.actor.internalUserId,
    reason: MANUAL_RECOVERY_REASON,
    // Explícito: la revisión manual SÍ consulta y persiste. Nunca inicia reveals.
    dryRun: false,
  });

  return mapOutcome(result, snapshot.phoneRevealStatus);
}
