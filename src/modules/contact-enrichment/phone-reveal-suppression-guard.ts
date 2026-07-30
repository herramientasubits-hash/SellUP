// Agente 2A — Apollo Phone Reveal: guarda de SUPRESIÓN EN VUELO
// (APOLLO-PHONE-CACHE-1b, FIX 3; alerta de "no evaluable" en FIX 4)
//
// FIX 2 hizo que el START del reveal consulte el tombstone ANTES de llamar a
// Apollo, con `ENABLE_APOLLO_PHONE_CACHE` encendido o apagado. Quedaba un hueco:
// un reveal Apollo es ASÍNCRONO, así que entre el START y la llegada del teléfono
// (webhook, o recovery poll) pasa tiempo real. Si una DSAR/supresión se registra
// EN ESE INTERVALO, el webhook o el recovery persistían el teléfono igual: la
// supresión llegaba tarde y el número acababa escrito.
//
// Este módulo cierra ese hueco. Es PURO y por inyección de dependencias, igual
// que los tres cores del flujo (START / WEBHOOK / RECOVERY):
//   * NO hace I/O: la lectura del tombstone es una dep inyectada;
//   * NO lee env ni flags: la supresión NO depende de
//     `ENABLE_APOLLO_PHONE_CACHE`. Ese flag gobierna la REUTILIZACIÓN de un
//     teléfono cacheado; nunca el cumplimiento de una supresión ya registrada;
//   * NO loguea: devuelve un mensaje YA redactado y quien lo consume decide.
//
// Clave del tombstone: (provider = apollo, provider_person_id, account_id). El
// país NO entra — igual que en FIX 2 — porque una supresión debe bloquear a esa
// persona en esa cuenta aunque el país del candidato cambie o sea desconocido.
//
// Límite deliberado (NO es un bug): sin `provider_person_id` resoluble o sin
// cuenta no hay clave con la que emparejar un tombstone, así que la supresión NO
// se puede evaluar. En ese caso NO se bloquea por inferencia — nunca por
// teléfono, email, nombre ni LinkedIn: un match difuso convertiría la privacidad
// en una adivinanza, y tanto un falso bloqueo como un falso permiso serían
// decididos por azar. El caso se reporta como `not_evaluable` para que quede en
// la auditoría técnica (sin PII) en lugar de desaparecer en silencio.

import {
  evaluatePhoneCacheSuppressionState,
  resolvePhoneCachePersonId,
  PHONE_CACHE_PROVIDER,
  type PhoneCacheSuppressionLookupKey,
  type PhoneCacheSuppressionState,
} from './phone-cache-core';
import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import { redactDriverMessage } from './phone-reveal-core';
import {
  notEvaluableAuditState,
  type PhoneSuppressionAuditState,
  type PhoneSuppressionNotEvaluableReason,
} from './phone-reveal-suppression-audit';

// ── Códigos persistidos / registrados ──────────────────────────

/**
 * `phone_reveal_error_code` cuando un tombstone bloqueó la persistencia tardía.
 *
 * Se emite junto a `phone_reveal_status = 'error'` y NO junto a un estado nuevo:
 * el CHECK `contact_enrichment_candidates_phone_reveal_status_check` (mig. 095,
 * reemplazado por 097) admite exactamente not_requested / requested / pending /
 * revealed / no_phone_found / error. Reutilizar `error` + este código evita
 * ampliar el vocabulario de la columna (y por tanto evita otra migración), y
 * tiene el efecto correcto de forma natural: el recovery ya trata `error` como
 * terminal (`terminal_error_skipped`), así que un candidato bloqueado por
 * supresión NO se vuelve a pollear y su teléfono no puede reaparecer.
 */
export const SUPPRESSION_BLOCKED_ERROR_CODE = 'blocked_suppressed' as const;

/**
 * `phone_reveal_error_code` / error_code del usage-log cuando la supresión NO se
 * pudo verificar. NO es terminal: el candidato se queda en vuelo y sigue siendo
 * recuperable con un poll posterior (0 créditos), porque "no pude comprobarlo"
 * no equivale a "no está suprimido" NI a "este reveal se perdió".
 */
export const SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE =
  'suppression_check_unavailable' as const;

// ── Evaluación ─────────────────────────────────────────────────

/**
 * Alias del motivo definido en `phone-reveal-suppression-audit.ts`. El vocabulario
 * de auditoría vive allí (FIX 4) para que el START pueda emitir el mismo evento
 * sin crear un ciclo de imports con este módulo, que sí depende del core.
 */
export type InFlightSuppressionNotEvaluableReason =
  PhoneSuppressionNotEvaluableReason;

export type InFlightSuppressionEvaluation =
  /** Clave resuelta, tombstone consultado, no hay supresión ⇒ persistir normal. */
  | { kind: 'allowed' }
  /** Sin clave posible: no se puede emparejar tombstone. NO se bloquea por inferencia. */
  | { kind: 'not_evaluable'; reason: InFlightSuppressionNotEvaluableReason }
  /** Existe tombstone ⇒ NO se persiste teléfono, NO se cachea, NO se reintenta. */
  | { kind: 'blocked_suppressed' }
  /** Dep ausente o lectura fallida ⇒ fail-closed, sin teléfono, reintentable. */
  | { kind: 'check_unavailable'; message: string };

export type InFlightSuppressionLookup = (
  key: PhoneCacheSuppressionLookupKey,
) => Promise<PhoneCacheSuppressionState | null>;

/**
 * Etiqueta PII-free del resultado, para `provider_usage_logs`. Alias del tipo
 * definido en el módulo de auditoría (FIX 4), que es el único sitio donde vive
 * este vocabulario.
 */
export type InFlightSuppressionAuditState = PhoneSuppressionAuditState;

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resuelve el `provider_person_id` con el que buscar el tombstone de un reveal
 * que ya está en vuelo. Orden de preferencia:
 *
 *   1. el id del payload recuperado (webhook / recovery), que es el que Apollo
 *      acaba de confirmar para esta persona;
 *   2. la columna `apollo_person_id` del candidato (mig. 098, CACHE-1a);
 *   3. `source_contact_id` SOLO si el candidato es de origen Apollo.
 *
 * Los tres pasan por el validador de id Apollo (24 hex), así que un id de otro
 * proveedor — p. ej. un Lusha `v1.*` — nunca se usa como clave. Devuelve null
 * cuando no hay ninguno válido: ese caso es `not_evaluable`, nunca un bloqueo ni
 * un permiso inferido.
 */
export function resolveInFlightSuppressionPersonId(args: {
  payloadPersonId?: string | null;
  candidateApolloPersonId?: string | null;
  candidateSource?: string | null;
  candidateSourceContactId?: string | null;
}): string | null {
  const fromPayload = normalizeApolloPersonId(args.payloadPersonId);
  if (fromPayload) return fromPayload;
  return resolvePhoneCachePersonId({
    apolloPersonId: args.candidateApolloPersonId ?? null,
    sourceProvider: args.candidateSource ?? null,
    sourceContactId: args.candidateSourceContactId ?? null,
  });
}

/**
 * Comprueba el tombstone de (apollo, persona, MISMA cuenta) ANTES de persistir un
 * teléfono que llega tarde. Fail-closed en los dos modos de fallo:
 *
 *   * dep no cableada ⇒ `check_unavailable`. Un wiring incompleto no puede
 *     convertirse en "no hay supresión";
 *   * la lectura lanza (tabla ausente, timeout, permisos) ⇒ `check_unavailable`
 *     con el mensaje del driver YA redactado (Postgres cita valores del payload
 *     en sus mensajes, así que el crudo podría llevar PII).
 *
 * NUNCA lanza: quien la llama decide qué persistir, y el teléfono nunca se
 * escribe salvo con `allowed` o `not_evaluable`.
 */
export async function evaluateInFlightPhoneSuppression(args: {
  personId: string | null;
  accountId: string | null;
  lookup?: InFlightSuppressionLookup;
}): Promise<InFlightSuppressionEvaluation> {
  const providerPersonId = cleanText(args.personId);
  if (!providerPersonId) {
    return { kind: 'not_evaluable', reason: 'missing_provider_person_id' };
  }
  const accountId = cleanText(args.accountId);
  if (!accountId) {
    return { kind: 'not_evaluable', reason: 'missing_account_id' };
  }

  if (!args.lookup) {
    return { kind: 'check_unavailable', message: 'suppression lookup not wired' };
  }

  let state: PhoneCacheSuppressionState | null;
  try {
    state = await args.lookup({
      provider: PHONE_CACHE_PROVIDER,
      providerPersonId,
      accountId,
    });
  } catch (err) {
    return { kind: 'check_unavailable', message: redactDriverMessage(err) };
  }

  return evaluatePhoneCacheSuppressionState(state) === 'suppressed'
    ? { kind: 'blocked_suppressed' }
    : { kind: 'allowed' };
}

/** Traduce la evaluación a la etiqueta PII-free del usage-log. */
export function describeInFlightSuppression(
  evaluation: InFlightSuppressionEvaluation,
): InFlightSuppressionAuditState {
  switch (evaluation.kind) {
    case 'allowed':
      return 'checked_not_suppressed';
    case 'blocked_suppressed':
      return 'blocked_suppressed';
    case 'check_unavailable':
      return 'check_unavailable';
    case 'not_evaluable':
    default:
      return notEvaluableAuditState(evaluation.reason);
  }
}

// ── Alerta de "no evaluable" (APOLLO-PHONE-CACHE-1b, FIX 4) ─────
//
// El límite documentado en la cabecera — sin Apollo person id (o sin cuenta) no
// hay clave con la que emparejar un tombstone — se mantiene tal cual: NO se
// empareja por teléfono, email, nombre ni LinkedIn, y NO se rellena el id que
// falta. Lo que FIX 4 añade es que el caso deje de ser INVISIBLE: se emite un
// evento de auditoría PII-free, con la MISMA forma en las tres fases.
//
// Ese evento vive en `phone-reveal-suppression-audit.ts`, no aquí, porque el
// START también lo emite y este módulo importa del core del START: definirlo
// aquí crearía un ciclo de imports. Se re-exporta para que quien ya use la
// guarda no tenga que conocer los dos módulos.

export {
  buildPhoneSuppressionNotEvaluableEvent,
  notEvaluableAuditState,
  reportPhoneSuppressionNotEvaluable,
  type PhoneSuppressionCheckPhase,
  type PhoneSuppressionNotEvaluableEvent,
  type PhoneSuppressionNotEvaluableSink,
  type PhoneSuppressionNotEvaluableState,
} from './phone-reveal-suppression-audit';
