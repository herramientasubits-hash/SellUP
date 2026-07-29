// Agente 2A — Apollo Phone Reveal: AUDITORÍA de la comprobación de supresión
// (APOLLO-PHONE-CACHE-1b, FIX 4)
//
// FIX 2 hizo que el START consulte el tombstone antes de llamar a Apollo y FIX 3
// cerró el hueco en vuelo (webhook / recovery). En los tres casos la clave del
// tombstone es (provider = apollo, provider_person_id, account_id), así que queda
// un límite estructural: sin Apollo person id resoluble —o sin cuenta— NO existe
// clave con la que emparejar una supresión y la comprobación no se puede hacer.
//
// Ese límite se mantiene deliberadamente: NO se empareja por teléfono, email,
// nombre ni LinkedIn. Un match difuso convertiría la privacidad en una adivinanza
// y tanto un falso bloqueo como un falso permiso quedarían decididos por azar.
// Tampoco se rellena el id que falta: el backfill está fuera de alcance en v1.
//
// Lo que este módulo añade es que el caso deje de ser INVISIBLE. Cada vez que la
// comprobación no se puede evaluar se emite un evento de auditoría con una forma
// CERRADA y sin PII, idéntica en las tres fases. El evento se construye siempre
// aquí, campo por campo, y nunca por spread de lo que traiga quien llama: así la
// superficie publicable es exactamente la de `PhoneSuppressionNotEvaluableEvent`
// y no puede crecer por accidente desde un core.
//
// Contiene identificadores INTERNOS (candidato, cuenta) y nada del contacto. En
// particular NO lleva el person id, ni hasheado: en `missing_provider_person_id`
// no existe, y en `missing_account_id` publicarlo añadiría un dato de la persona a
// un evento que solo describe un hueco de identificación.
//
// El módulo es PURO: sin I/O, sin env, sin flags, sin console. Igual que la
// guarda, no depende de `ENABLE_APOLLO_PHONE_CACHE` — ese flag gobierna la
// REUTILIZACIÓN de un teléfono cacheado, nunca la auditoría de una comprobación
// de supresión. Vive aparte de `phone-reveal-suppression-guard.ts` para que el
// START (que la guarda importa) pueda usarlo sin crear un ciclo de imports.

import { PHONE_CACHE_PROVIDER } from './phone-cache-core';

/** Fase del reveal en la que se intentó comprobar el tombstone. */
export type PhoneSuppressionCheckPhase = 'start' | 'webhook' | 'recovery';

/** Por qué no se pudo construir la clave del tombstone. */
export type PhoneSuppressionNotEvaluableReason =
  | 'missing_provider_person_id'
  | 'missing_account_id';

/**
 * Etiqueta PII-free del resultado de la comprobación, para `provider_usage_logs`.
 * Deja rastro auditable de que la comprobación se hizo — y de por qué no se pudo
 * hacer — SIN publicar el person id, la cuenta ni ningún dato del contacto.
 */
export type PhoneSuppressionAuditState =
  | 'checked_not_suppressed'
  | 'blocked_suppressed'
  | 'check_unavailable'
  | 'not_evaluable_missing_provider_person_id'
  | 'not_evaluable_missing_account_id';

/**
 * Subconjunto que significa "no se pudo evaluar". Derivado del tipo anterior a
 * propósito: si mañana se añade otro motivo `not_evaluable_*`, entra aquí solo y
 * el evento no queda desfasado.
 */
export type PhoneSuppressionNotEvaluableState = Extract<
  PhoneSuppressionAuditState,
  `not_evaluable_${string}`
>;

/**
 * Evento de auditoría. Forma CERRADA: estas cinco claves y ninguna más. Usan
 * snake_case porque es el vocabulario de `provider_usage_logs` (`candidate_id`,
 * `account_id`, `suppression_state`), donde ya viven las etiquetas de supresión
 * del webhook y del recovery.
 */
export interface PhoneSuppressionNotEvaluableEvent {
  readonly provider: typeof PHONE_CACHE_PROVIDER;
  readonly phase: PhoneSuppressionCheckPhase;
  readonly suppression_state: PhoneSuppressionNotEvaluableState;
  readonly candidate_id: string;
  readonly account_id: string | null;
}

/**
 * Sumidero del evento. Lo inyecta el wrapper (los cores son puros y no loguean).
 * NO decide nada: la evaluación ya ocurrió y el flujo continúa igual con sumidero
 * o sin él.
 */
export type PhoneSuppressionNotEvaluableSink = (
  event: PhoneSuppressionNotEvaluableEvent,
) => void;

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Motivo → etiqueta de auditoría. Único punto donde se hace esa traducción. */
export function notEvaluableAuditState(
  reason: PhoneSuppressionNotEvaluableReason,
): PhoneSuppressionNotEvaluableState {
  return reason === 'missing_account_id'
    ? 'not_evaluable_missing_account_id'
    : 'not_evaluable_missing_provider_person_id';
}

/** Construye el evento con la allowlist de campos. No admite campos extra. */
export function buildPhoneSuppressionNotEvaluableEvent(args: {
  phase: PhoneSuppressionCheckPhase;
  reason: PhoneSuppressionNotEvaluableReason;
  candidateId: string;
  accountId: string | null;
}): PhoneSuppressionNotEvaluableEvent {
  return {
    provider: PHONE_CACHE_PROVIDER,
    phase: args.phase,
    suppression_state: notEvaluableAuditState(args.reason),
    candidate_id: args.candidateId,
    account_id: cleanText(args.accountId),
  };
}

/**
 * Registra el caso no evaluable y devuelve el evento emitido (lo consume el
 * usage-log de la fase y las pruebas).
 *
 * El sumidero se invoca dentro de `try/catch`: un fallo del canal de observación
 * no puede cambiar el desenlace del reveal. Esto es un efecto de AUDITORÍA, no un
 * gate — nunca bloquea, nunca desbloquea, y no llama a ningún proveedor.
 */
export function reportPhoneSuppressionNotEvaluable(args: {
  phase: PhoneSuppressionCheckPhase;
  reason: PhoneSuppressionNotEvaluableReason;
  candidateId: string;
  accountId: string | null;
  sink?: PhoneSuppressionNotEvaluableSink;
}): PhoneSuppressionNotEvaluableEvent {
  const event = buildPhoneSuppressionNotEvaluableEvent(args);
  try {
    args.sink?.(event);
  } catch {
    // Silencio deliberado y acotado: la alerta es observacional. Si el sumidero
    // falla se pierde ese aviso, pero el mismo estado viaja además en el
    // `suppression_state` del usage-log de la fase.
  }
  return event;
}
