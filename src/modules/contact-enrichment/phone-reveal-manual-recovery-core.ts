// Agente 2A — Apollo Phone Reveal: RECOVERY L3 (elegibilidad PURA)
// (APOLLO-PHONE-RECOVERY-L3)
//
// POR QUÉ EXISTE ESTE HITO
// El recovery L1 (1 GET a `webhook_result/{apollo_http_request_id}`) ya existe y
// funciona, y el L2 (cron) ya lo dispara sin humano — pero su cadencia es DIARIA
// (el plan de Vercel rechaza cadencias sub-diarias). Para el operador eso significa
// que un reveal cuyo webhook se perdió puede quedarse "Revelación en proceso"
// hasta 24 h. Apollo confirmó que el resultado se puede consultar a los 1–2 min y
// que `webhook_result` sigue disponible 30 días, así que este hito añade el nivel
// L3: que la persona que está mirando el candidato pueda pedir "revisar el
// resultado ahora" desde el sidepanel — SIN iniciar un reveal nuevo.
//
// QUÉ ES ESTE MÓDULO
// El núcleo PURO de la elegibilidad del L3. No hace red, no toca Supabase, no lee
// env, no imprime y NO tiene imports en tiempo de ejecución: es seguro importarlo
// tanto desde el servidor como desde el componente cliente del sidepanel, para que
// la UI y el backend compartan LA MISMA definición de la ventana (y no se
// desincronicen). Solo decide, a partir de una foto de solo lectura del candidato:
//   1. Rol autorizado (mismo criterio que el Phone Reveal: admin / manager comercial).
//   2. Candidato en vuelo (requested / pending) de proveedor Apollo, sin teléfono.
//   3. Con id de correlación de recuperación presente.
//   4. Con la ventana mínima cumplida: nunca antes de 2 min desde la solicitud (se
//      le concede al webhook su oportunidad) y nunca dos comprobaciones en menos
//      de 60 s (anti-abuso por clics repetidos).
//
// LO QUE ESTE CAMINO NUNCA HABILITA
//   * NO inicia reveals (no /people/match, no `reveal_phone_number`), NO consume
//     créditos nuevos, NO toca Lusha, NO escribe HubSpot, NO procesa lotes.
//   * NO relaja ninguna validación del recovery core: es una capa ADICIONAL de
//     gates por delante. El recovery core vuelve a validar todo (defensa en
//     profundidad) y sigue siendo la única autoridad de la persistencia.
//   * NO introduce polling automático: cada evaluación responde a un acto humano.

// ── Constantes de la ventana ───────────────────────────────────

/**
 * Antigüedad mínima de la solicitud para permitir una revisión manual. Apollo
 * indicó que a partir de 1–2 min es razonable consultar `webhook_result`; se toma
 * el extremo conservador (2 min) para no competir con una entrega de webhook
 * legítima que todavía puede llegar.
 */
export const MANUAL_RECOVERY_MIN_REQUEST_AGE_SECONDS = 120;

/**
 * Intervalo mínimo entre dos revisiones manuales del MISMO candidato. Es el freno
 * anti-abuso del backend: cada poll sella `phone_reveal_last_checked_at`, así que
 * un segundo clic dentro de la ventana queda rechazado sin llamar a Apollo.
 */
export const MANUAL_RECOVERY_MIN_RECHECK_INTERVAL_SECONDS = 60;

/**
 * Estados en vuelo que admiten revisión manual. Espejo de `POLLABLE_STATUSES` del
 * poll core; se declara aquí para que este módulo siga sin imports (y por tanto
 * importable desde el bundle cliente). Un test estático verifica que no derive.
 */
export const MANUAL_RECOVERY_IN_FLIGHT_STATUSES: readonly string[] = [
  'requested',
  'pending',
];

/**
 * Roles autorizados a pedir la revisión manual: los MISMOS que pueden disparar un
 * reveal (Administrador + Manager comercial). No se crean permisos nuevos y no se
 * hereda el gate ADMIN-only del runtime de recovery batch: revisar el resultado de
 * un reveal que uno mismo pidió no es una operación de administración, no gasta
 * créditos y no escribe nada que el reveal no fuera a escribir por webhook.
 * Un test estático verifica que la lista no derive de PHONE_REVEAL_AUTHORIZED_ROLE_KEYS.
 */
export const MANUAL_RECOVERY_AUTHORIZED_ROLE_KEYS: readonly string[] = [
  'admin',
  'commercial_manager',
];

/** Proveedor único del recovery. Apollo-only, sin fallback Lusha (gate legal). */
export const MANUAL_RECOVERY_PROVIDER = 'apollo' as const;

// ── Actor y foto del candidato ─────────────────────────────────

/** Actor resuelto por el wrapper 'use server' (id opaco + role key). Sin PII. */
export interface ManualRecoveryActor {
  /** id del internal_user (opaco, auditoría). null si no se resolvió. */
  internalUserId: string | null;
  /** role key del actor (`admin`, `commercial_manager`, …) o null. */
  roleKey: string | null;
}

/**
 * Foto de solo lectura del candidato para decidir la elegibilidad. Deliberadamente
 * SIN PII: ni teléfono, ni email, ni nombre, ni empresa, ni el id de recuperación
 * (solo su presencia). `hasPhone` es un booleano derivado, no el número.
 */
export interface ManualRecoveryCandidateSnapshot {
  phoneRevealProvider: string | null;
  phoneRevealStatus: string | null;
  /** true si el candidato ya tiene un teléfono persistido (columna o metadata). */
  hasPhone: boolean;
  /** true si existe id de correlación con el que recuperar el resultado. */
  recoveryIdPresent: boolean;
  /** `phone_reveal_requested_at` en ISO. null en filas legacy sin la marca. */
  requestedAtIso: string | null;
  /** `phone_reveal_last_checked_at` en ISO. null si nunca se comprobó. */
  lastCheckedAtIso: string | null;
}

// ── Resultado de la evaluación ─────────────────────────────────

/** Motivo mecánico (sin PII) por el que la revisión manual no procede. */
export type ManualRecoveryBlockReason =
  | 'unauthorized_role'
  | 'not_apollo_provider'
  | 'not_in_flight'
  | 'already_has_phone'
  | 'missing_recovery_request_id'
  | 'requested_too_recently'
  | 'checked_too_recently';

export type ManualRecoveryEligibility =
  | { eligible: true; reason: null; retryAfterSeconds: null }
  | {
      eligible: false;
      reason: ManualRecoveryBlockReason;
      /**
       * Segundos que faltan para que la ventana se abra, cuando el bloqueo es
       * temporal (`requested_too_recently` / `checked_too_recently`). null en los
       * bloqueos estructurales (rol, proveedor, terminal, sin id).
       */
      retryAfterSeconds: number | null;
    };

// ── Helpers puros ──────────────────────────────────────────────

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** ms desde `sinceIso` hasta `nowIso`. null si alguna fecha no es parseable. */
function elapsedMs(sinceIso: string | null, nowIso: string): number | null {
  const since = cleanText(sinceIso);
  if (!since) return null;
  const sinceMs = Date.parse(since);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) return null;
  return nowMs - sinceMs;
}

/** Segundos restantes (redondeo al alza, mínimo 1) para completar `windowSeconds`. */
function remainingSeconds(elapsed: number, windowSeconds: number): number {
  const remaining = Math.ceil((windowSeconds * 1000 - elapsed) / 1000);
  return remaining < 1 ? 1 : remaining;
}

function blocked(
  reason: ManualRecoveryBlockReason,
  retryAfterSeconds: number | null = null,
): ManualRecoveryEligibility {
  return { eligible: false, reason, retryAfterSeconds };
}

// ── Gate de rol ────────────────────────────────────────────────

/**
 * Decide si el actor puede pedir una revisión manual. Fail-closed: sin id de
 * usuario resuelto o sin role key conocido ⇒ no autorizado.
 */
export function isManualRecoveryAuthorized(actor: ManualRecoveryActor): boolean {
  if (!cleanText(actor.internalUserId)) return false;
  const roleKey = cleanText(actor.roleKey);
  if (!roleKey) return false;
  return MANUAL_RECOVERY_AUTHORIZED_ROLE_KEYS.includes(roleKey);
}

// ── Ventana de la UI (compartida con el backend) ───────────────

/**
 * ¿Se cumplió ya la ventana mínima de 2 min desde la solicitud? La UI usa ESTA
 * función para decidir si ofrece el CTA "Revisar resultado ahora", de modo que
 * cliente y servidor no puedan discrepar. Sin marca de solicitud (`null`, filas
 * legacy) devuelve false: fail-closed, se prefiere no ofrecer el CTA antes que
 * ofrecer una revisión que el backend va a rechazar.
 */
export function isManualRecoveryRequestWindowOpen(
  requestedAtIso: string | null,
  nowIso: string,
): boolean {
  const elapsed = elapsedMs(requestedAtIso, nowIso);
  if (elapsed === null) return false;
  return elapsed >= MANUAL_RECOVERY_MIN_REQUEST_AGE_SECONDS * 1000;
}

// ── Evaluación completa (backend) ──────────────────────────────

/**
 * Evalúa la elegibilidad de una revisión manual. Orden barato→caro y fail-closed:
 * rol, proveedor, estado en vuelo, teléfono ya presente, id de recuperación,
 * ventana de 2 min desde la solicitud y ventana anti-abuso de 60 s desde la última
 * comprobación. Solo `eligible: true` autoriza a llamar al recovery core (y por
 * tanto a hacer el único GET a Apollo).
 */
export function evaluateManualRecoveryEligibility(args: {
  actor: ManualRecoveryActor;
  snapshot: ManualRecoveryCandidateSnapshot;
  nowIso: string;
}): ManualRecoveryEligibility {
  const { actor, snapshot, nowIso } = args;

  if (!isManualRecoveryAuthorized(actor)) return blocked('unauthorized_role');

  if (cleanText(snapshot.phoneRevealProvider) !== MANUAL_RECOVERY_PROVIDER) {
    return blocked('not_apollo_provider');
  }

  const status = cleanText(snapshot.phoneRevealStatus);
  if (!status || !MANUAL_RECOVERY_IN_FLIGHT_STATUSES.includes(status)) {
    // Cubre terminales (revealed / no_phone_found / error / blocked) y nulls.
    return blocked('not_in_flight');
  }

  if (snapshot.hasPhone) return blocked('already_has_phone');

  if (!snapshot.recoveryIdPresent) return blocked('missing_recovery_request_id');

  // Ventana de 2 min: sin marca de solicitud no se puede demostrar que pasó, así
  // que se bloquea (fail-closed) en vez de asumir que el reveal es antiguo.
  const sinceRequest = elapsedMs(snapshot.requestedAtIso, nowIso);
  if (sinceRequest === null) return blocked('requested_too_recently');
  if (sinceRequest < MANUAL_RECOVERY_MIN_REQUEST_AGE_SECONDS * 1000) {
    return blocked(
      'requested_too_recently',
      remainingSeconds(sinceRequest, MANUAL_RECOVERY_MIN_REQUEST_AGE_SECONDS),
    );
  }

  // Anti-abuso: dos revisiones del mismo candidato separadas por menos de 60 s.
  // Sin marca previa (nunca comprobado) la ventana está abierta.
  const sinceCheck = elapsedMs(snapshot.lastCheckedAtIso, nowIso);
  if (
    sinceCheck !== null &&
    sinceCheck < MANUAL_RECOVERY_MIN_RECHECK_INTERVAL_SECONDS * 1000
  ) {
    return blocked(
      'checked_too_recently',
      remainingSeconds(sinceCheck, MANUAL_RECOVERY_MIN_RECHECK_INTERVAL_SECONDS),
    );
  }

  return { eligible: true, reason: null, retryAfterSeconds: null };
}
