// Agente 2A — Apollo Phone Reveal: RECOVERY runtime core
// (APOLLO-PHONE-RECOVERY-RUNTIME-1)
//
// Runtime interno ADMIN-ONLY para EJECUTAR el recovery core ya mergeado
// (phone-reveal-recovery-core.ts, PR #139). Igual que el resto del pipeline de
// phone-reveal, la lógica de decisión vive en un núcleo PURO y con dependencias
// inyectadas; el wrapper 'use server' (phone-reveal-recovery-actions.ts) resuelve
// el actor autenticado y cablea las deps reales (Supabase service-role, Apollo GET
// de recuperación, provider_usage_logs).
//
// Este core NO hace red, NO toca Supabase, NO lee env, NO agenda cron y NO
// imprime nada. Solo:
//   1. Aplica el gate de rol ADMIN-only (fail-closed).
//   2. Normaliza la entrada (candidateId, dryRun default true, caps del batch).
//   3. Delega la recuperación real a una dep inyectada (que el action cablea al
//      recovery core con deps reales, o que en tests es un stub/mock).
//   4. Mapea el outcome a un resumen SEGURO, sin PII: estados, conteos, booleanos,
//      phoneType (etiqueta de tipo, nunca el número) y créditos numéricos.
//
// Contrato de seguridad:
//   * NO depende de ENABLE_APOLLO_PHONE_REVEAL: recovery no crea reveals nuevos.
//     Ese flag solo gobierna el START (phone-reveal-core.ts).
//   * ADMIN-only: seller / manager (commercial_manager) / lead / anónimo quedan
//     bloqueados en este hito (a diferencia del START, que permite
//     commercial_manager). No se crean permisos de negocio nuevos.
//   * dryRun por defecto true en single y en batch: para ejecutar escritura real
//     hay que pasar dryRun=false explícito.
//   * La respuesta NUNCA incluye teléfono, raw_number, sanitized_number, email,
//     linkedin, nombre, empresa, API key, token, ni el payload crudo de Apollo.

import {
  DEFAULT_BATCH_MAX_CANDIDATES,
  MAX_BATCH_MAX_CANDIDATES,
  DEFAULT_BATCH_MIN_AGE_MINUTES,
  type RecoverApolloPhoneRevealInput,
  type RecoverApolloPhoneRevealResult,
  type RecoverStaleApolloPhoneRevealInput,
  type StaleRecoverySummary,
} from './phone-reveal-recovery-core';

// ── Autorización (ADMIN-only) ──────────────────────────────────

/**
 * Roles autorizados para EJECUTAR el recovery runtime. Solo `admin` en este hito.
 * NO incluye `commercial_manager` (a diferencia del START): manager, seller y lead
 * quedan bloqueados hasta una decisión de negocio aparte.
 */
export const RECOVERY_RUNTIME_AUTHORIZED_ROLE_KEYS: readonly string[] = ['admin'];

/** Actor resuelto por el wrapper 'use server' (id opaco + role key). Sin PII. */
export interface RecoveryRuntimeActor {
  /** id del internal_user (opaco, para auditoría). null si no se resolvió. */
  internalUserId: string | null;
  /** role key del actor (`admin`, `commercial_manager`, `seller`, …) o null. */
  roleKey: string | null;
}

/**
 * Decide si el actor puede ejecutar el recovery runtime: ADMIN-only y con un id
 * de usuario resuelto. Fail-closed: sin role key conocido ⇒ no autorizado.
 */
export function isRecoveryRuntimeAuthorized(actor: RecoveryRuntimeActor): boolean {
  if (!actor.internalUserId) return false;
  if (!actor.roleKey) return false;
  return RECOVERY_RUNTIME_AUTHORIZED_ROLE_KEYS.includes(actor.roleKey);
}

// ── Estados seguros de salida ──────────────────────────────────

/** Estado seguro del resultado single (sin PII). */
export type SingleRecoveryRuntimeStatus =
  | 'revealed'
  | 'still_pending'
  | 'no_phone_found'
  | 'skipped'
  | 'error';

// ── Modo 1: recuperación de UN candidato ───────────────────────

export interface SingleRecoveryRuntimeInput {
  candidateId: string;
  /** Default true. false ⇒ ejecución real (poll + escritura) vía el recovery core. */
  dryRun?: boolean;
  /** Motivo libre (no se persiste el texto; solo su presencia). Opaco. */
  reason?: string | null;
}

export interface SingleRecoveryRuntimeResult {
  ok: boolean;
  mode: 'single';
  status: SingleRecoveryRuntimeStatus;
  /** true solo cuando el poll entregó un teléfono y se persistió revealed. */
  phonePersisted: boolean;
  /** Etiqueta de tipo (mobile / direct_dial / work / other …) o null. NO es el número. */
  phoneType: string | null;
  /** Créditos numéricos del payload recuperado; null si no aplican / no reportados. */
  creditsUsed: number | null;
  /** true si se resolvió un recovery id (apollo_http_request_id). Sin PII. */
  recoveryRequestIdPresent: boolean;
  /** true cuando la corrida fue simulación (no se consultó Apollo ni se escribió). */
  dryRun: boolean;
  /** Mensaje mecánico seguro (sin PII): describe el outcome, nunca datos del contacto. */
  message: string;
}

export interface SingleRecoveryRuntimeDeps {
  actor: RecoveryRuntimeActor;
  /**
   * Ejecuta el recovery core (recoverApolloPhoneRevealForCandidate) con deps
   * reales cableadas por el action, o un stub en tests. Recibe dryRun ya
   * normalizado; NUNCA se invoca si el actor no está autorizado o el candidateId
   * es inválido (fail-closed antes de cualquier I/O).
   */
  recoverCandidate: (
    input: RecoverApolloPhoneRevealInput,
  ) => Promise<RecoverApolloPhoneRevealResult>;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Mapea el outcome del recovery core a un estado seguro de salida. */
function statusForOutcome(
  result: RecoverApolloPhoneRevealResult,
): SingleRecoveryRuntimeStatus {
  switch (result.outcome) {
    case 'revealed':
      return 'revealed';
    case 'no_phone_found':
      return 'no_phone_found';
    case 'still_pending':
    case 'not_found_or_pending_ambiguous':
      return 'still_pending';
    case 'possible_missing_webhook_result_read_scope':
    case 'provider_error_transient':
    case 'invalid_candidate':
    case 'candidate_not_found':
      return 'error';
    // dry_run_eligible + inelegibles de negocio (ya terminal, sin recovery id, no
    // apollo, ya tiene teléfono, no en vuelo): no se ejecutó nada terminal.
    default:
      return 'skipped';
  }
}

function safeSingle(
  status: SingleRecoveryRuntimeStatus,
  message: string,
  extra: Partial<
    Omit<SingleRecoveryRuntimeResult, 'mode' | 'status' | 'message' | 'ok'>
  > = {},
  ok = true,
): SingleRecoveryRuntimeResult {
  return {
    ok,
    mode: 'single',
    status,
    phonePersisted: extra.phonePersisted ?? false,
    phoneType: extra.phoneType ?? null,
    creditsUsed: extra.creditsUsed ?? null,
    recoveryRequestIdPresent: extra.recoveryRequestIdPresent ?? false,
    dryRun: extra.dryRun ?? true,
    message,
  };
}

/**
 * Modo 1 (ADMIN-only). Recupera UN candidato en vuelo. Fail-closed:
 *   1. Rol no autorizado ⇒ error, sin tocar deps.
 *   2. candidateId vacío ⇒ error, sin tocar deps.
 *   3. dryRun default true.
 * Solo tras pasar 1–2 se llama a `recoverCandidate`. El resultado se reduce a un
 * resumen seguro (sin PII): estado, phonePersisted, phoneType, créditos, dryRun.
 */
export async function runAdminSingleCandidateRecovery(
  input: SingleRecoveryRuntimeInput,
  deps: SingleRecoveryRuntimeDeps,
): Promise<SingleRecoveryRuntimeResult> {
  if (!isRecoveryRuntimeAuthorized(deps.actor)) {
    return safeSingle('error', 'unauthorized', { dryRun: true }, false);
  }

  const candidateId = cleanText(input.candidateId);
  if (!candidateId) {
    return safeSingle('error', 'invalid_candidate', { dryRun: true }, false);
  }

  const dryRun = input.dryRun !== false; // default true (seguro)

  const result = await deps.recoverCandidate({
    candidateId,
    dryRun,
    actorUserId: deps.actor.internalUserId,
    reason: cleanText(input.reason),
  });

  const status = statusForOutcome(result);
  return safeSingle(status, result.outcome, {
    phonePersisted: result.phoneRevealed,
    phoneType: result.phoneType,
    creditsUsed: result.creditsUsed,
    recoveryRequestIdPresent: result.recoveryRequestIdPresent,
    dryRun,
  });
}

// ── Modo 2: recuperación batch de reveals stale ────────────────

export interface BatchRecoveryRuntimeInput {
  /** Default true. false ⇒ ejecución real (poll + escritura) por candidato. */
  dryRun?: boolean;
  /** Tope de candidatos por corrida. Default 5; hard cap 10 (lo aplica el core). */
  maxCandidates?: number;
  /** Antigüedad mínima (min) para considerar stale. Default 15 (lo aplica el core). */
  minAgeMinutes?: number;
  /** Motivo libre (no se persiste el texto). Opaco. */
  reason?: string | null;
}

export interface BatchRecoveryRuntimeResult {
  ok: boolean;
  mode: 'batch';
  checked: number;
  recovered: number;
  stillPending: number;
  noPhoneFound: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  maxCandidates: number;
  minAgeMinutes: number;
  message: string;
}

export interface BatchRecoveryRuntimeDeps {
  actor: RecoveryRuntimeActor;
  /**
   * Ejecuta el batch del recovery core (recoverStaleApolloPhoneRevealRequests) con
   * deps reales, o un stub en tests. NUNCA se invoca si el actor no está
   * autorizado.
   */
  recoverStale: (
    input: RecoverStaleApolloPhoneRevealInput,
  ) => Promise<StaleRecoverySummary>;
}

/** Espeja los caps del recovery core para reportarlos sin depender del summary. */
export const RECOVERY_RUNTIME_DEFAULT_MAX_CANDIDATES = DEFAULT_BATCH_MAX_CANDIDATES;
export const RECOVERY_RUNTIME_MAX_CANDIDATES_CAP = MAX_BATCH_MAX_CANDIDATES;
export const RECOVERY_RUNTIME_DEFAULT_MIN_AGE_MINUTES = DEFAULT_BATCH_MIN_AGE_MINUTES;

function unauthorizedBatch(): BatchRecoveryRuntimeResult {
  return {
    ok: false,
    mode: 'batch',
    checked: 0,
    recovered: 0,
    stillPending: 0,
    noPhoneFound: 0,
    failed: 0,
    skipped: 0,
    dryRun: true,
    maxCandidates: RECOVERY_RUNTIME_DEFAULT_MAX_CANDIDATES,
    minAgeMinutes: RECOVERY_RUNTIME_DEFAULT_MIN_AGE_MINUTES,
    message: 'unauthorized',
  };
}

/**
 * Modo 2 (ADMIN-only). Recupera en lote reveals stale. Fail-closed: rol no
 * autorizado ⇒ nada de I/O. dryRun default true. Los caps (default 5, hard cap 10,
 * minAge default 15) los aplica el recovery core; aquí se pasan tal cual y el
 * resumen refleja los valores ya normalizados por el core. Solo conteos, sin PII.
 */
export async function runAdminStaleBatchRecovery(
  input: BatchRecoveryRuntimeInput,
  deps: BatchRecoveryRuntimeDeps,
): Promise<BatchRecoveryRuntimeResult> {
  if (!isRecoveryRuntimeAuthorized(deps.actor)) {
    return unauthorizedBatch();
  }

  const dryRun = input.dryRun !== false; // default true (seguro)

  const summary = await deps.recoverStale({
    maxCandidates: input.maxCandidates,
    minAgeMinutes: input.minAgeMinutes,
    dryRun,
    actorUserId: deps.actor.internalUserId,
  });

  return {
    ok: true,
    mode: 'batch',
    checked: summary.checked,
    recovered: summary.recovered,
    stillPending: summary.still_pending,
    noPhoneFound: summary.no_phone_found,
    failed: summary.failed,
    skipped: summary.skipped,
    dryRun: summary.dryRun,
    maxCandidates: summary.maxCandidates,
    minAgeMinutes: summary.minAgeMinutes,
    message: summary.dryRun ? 'dry_run' : 'executed',
  };
}
