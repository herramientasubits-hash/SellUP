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
//
// AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1 (P0 privacidad): lo de arriba describe
// CÓMO se resuelve la clave, no qué hace el llamador con `not_evaluable`. Hasta
// ese hito los CUATRO llamadores (START, WEBHOOK, RECOVERY y la puerta previa a
// Lusha) trataban `not_evaluable` como "seguir adelante" — auditaban el caso y
// dejaban pasar el reveal igual. Eso era fail-OPEN: "no pude confirmar que NO
// está suprimido" NO equivale a "no está suprimido", y el caso típico sin clave
// resoluble es precisamente un candidato de origen Lusha, que un tombstone Apollo
// real no podía alcanzar por falta de clave. Desde ese hito los cuatro llamadores
// tratan `not_evaluable` igual que `check_unavailable`: bloquean (fail-closed,
// reintentable, 0 créditos nuevos), reutilizando el mismo estado ya existente en
// vez de vocabulario nuevo. Esta guarda sigue devolviendo `not_evaluable` tal
// cual — con su motivo — para que la etiqueta de auditoría (`not_evaluable_*`)
// no se pierda; es el LLAMADOR quien decide bloquear.

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

// ── Terminalización de la supresión (AGENT2A-PHONE-REVEAL-4O-E1) ──
//
// La guarda de arriba resuelve la supresión POR PERSONA y sus dos caminos ya
// terminalizan. Falta el otro sitio donde una supresión puede impedir persistir un
// teléfono: la transacción de la colección (migraciones 110/111) responde
// `status = 'suppressed'` cuando TODOS los números del evento son tombstones, y
// entonces escribe 0 filas y NO cierra el candidato.
//
// Hasta este hito ese resultado se trataba como «no se pudo guardar»: el candidato
// se quedaba en vuelo, el cron lo volvía a seleccionar cada pasada, la corrida
// seguía activa y su reserva seguía `reserved` pese a que el proveedor YA había
// cobrado. Ni la privacidad quedaba registrada ni el gasto liquidado.
//
// Este bloque define el contrato ÚNICO de esa terminalización para las cuatro
// fases (webhook, recovery, pata Lusha del waterfall y gate previo a Lusha), para
// que las cuatro escriban exactamente lo mismo:
//
//   phone_reveal_status     = 'error'
//   phone_reveal_error_code = 'blocked_suppressed'
//
// `error` y no un estado nuevo: es el vocabulario que ya admite el CHECK de la
// columna (mig. 095/097) y el ÚNICO que el recovery, el cron y la revisión manual
// L3 ya tratan como terminal. `no_phone_found` sería peor que no escribir nada —
// es justo el estado que hace ELEGIBLE el fallback pagado de Lusha.
//
// La escritura es CONDICIONAL por contrato: entre que la transacción respondió
// `suppressed` y que este UPDATE llega, otro actor legítimo pudo terminalizar o
// revelar el candidato. Un `UPDATE ... WHERE id = ?` a secas pisaría ese resultado.

/**
 * Estados NO terminales desde los que el webhook y la recuperación pueden
 * terminalizar una supresión. Espejo de `POLLABLE_STATUSES`: son exactamente los
 * dos estados «en vuelo» en los que puede estar un reveal Apollo cuyo resultado
 * acaba de llegar.
 */
export const IN_FLIGHT_TERMINAL_SUPPRESSION_EXPECTED_STATUSES: readonly string[] = [
  'requested',
  'pending',
];

/**
 * UPDATE terminal por supresión. Describe la escritura; no la ejecuta.
 *
 * `expectedStatuses` NO es un adorno: es la condición de la escritura. La fila solo
 * se toca si sigue exactamente en uno de esos estados, de modo que un `revealed`
 * concurrente sobrevive intacto.
 */
export interface TerminalPhoneSuppressionPatch {
  /** Estados en los que la fila DEBE seguir para que esta escritura gane. */
  expectedStatuses: readonly string[];
  phone_reveal_status: 'error';
  phone_reveal_error_code: typeof SUPPRESSION_BLOCKED_ERROR_CODE;
  phone_reveal_completed_at: string;
  /**
   * Créditos que el proveedor reportó por la respuesta que la supresión impidió
   * guardar, y su procedencia. Se conserva el cargo: existió aunque el número no se
   * persistiera, y escribir 0 sería declarar gratis una llamada pagada.
   *
   * Las DOS claves son OPCIONALES y van juntas o no van, porque estas columnas del
   * candidato describen UN reveal, no la suma de varios:
   *
   *   * se escriben cuando esta supresión cierra el reveal EN VUELO del propio
   *     candidato (webhook / recuperación de Apollo), donde no había cifra previa;
   *   * se OMITEN cuando el candidato ya lleva la cifra de otra pata —el gate previo
   *     a Lusha y la supresión posterior a una llamada Lusha ocurren sobre un
   *     candidato que ya cerró su pata Apollo—. Escribirlas ahí borraría un costo
   *     real ya incurrido o lo atribuiría al proveedor equivocado. Ese costo vive,
   *     por pata y sin mezclarse, en `phone_reveal_waterfall_runs`, en la reserva
   *     confirmada y en `provider_usage_logs`.
   */
  phone_reveal_cost_credits?: number | null;
  phone_reveal_cost_source?: 'reported' | 'unknown';
  /**
   * Proveedor que produjo la respuesta suprimida. OPCIONAL: solo se escribe cuando
   * este cierre es el del reveal del propio candidato. En los cierres que ocurren
   * sobre un reveal ya terminalizado por otra pata la columna NO se toca — cambiarla
   * reescribiría de quién era ese reveal.
   */
  phone_reveal_provider?: 'apollo' | 'lusha';
  /** Solo el webhook: sella la llegada del callback. */
  phone_reveal_webhook_received_at?: string;
  /** Solo la recuperación: sella la última comprobación. */
  phone_reveal_last_checked_at?: string;
}

/**
 * Firma de la escritura condicional inyectada. Devuelve `applied: true` SOLO si
 * afectó exactamente una fila. Puede LANZAR: `applyTerminalPhoneSuppression` lo
 * traduce a un resultado mecánico y el caller conserva su camino fail-closed.
 */
export type PersistTerminalPhoneSuppression = (
  candidateId: string,
  patch: TerminalPhoneSuppressionPatch,
) => Promise<{ applied: boolean }>;

/** Por qué la terminalización se aplicó o no. Código mecánico, sin PII. */
export type TerminalPhoneSuppressionReason =
  | 'applied'
  /** El caller no cableó la dep: se conserva su comportamiento anterior al hito. */
  | 'not_wired'
  /** La fila cambió de estado entre la respuesta de la transacción y este UPDATE. */
  | 'concurrent_state_change'
  /** La escritura falló (driver, permisos, timeout). Nada terminal se escribió. */
  | 'write_failed';

export interface TerminalPhoneSuppressionOutcome {
  applied: boolean;
  reason: TerminalPhoneSuppressionReason;
}

/**
 * Construye el patch terminal por supresión. Un único constructor para las cuatro
 * fases: si algún día cambia el estado o el código, cambia en un solo sitio y
 * ninguna fase puede quedarse con el anterior.
 */
export function buildTerminalPhoneSuppressionPatch(args: {
  expectedStatuses: readonly string[];
  nowIso: string;
  /**
   * Costo del reveal que esta supresión cierra. Presente SOLO cuando el reveal es
   * el del propio candidato; ausente cuando el candidato ya lleva la cifra de otra
   * pata (ver `TerminalPhoneSuppressionPatch`).
   */
  cost?: { credits: number | null; source: 'reported' | 'unknown' };
  provider?: 'apollo' | 'lusha';
  webhookReceivedAt?: string;
  lastCheckedAt?: string;
}): TerminalPhoneSuppressionPatch {
  return {
    expectedStatuses: args.expectedStatuses,
    phone_reveal_status: 'error',
    phone_reveal_error_code: SUPPRESSION_BLOCKED_ERROR_CODE,
    phone_reveal_completed_at: args.nowIso,
    ...(args.cost
      ? {
          phone_reveal_cost_credits: args.cost.credits,
          phone_reveal_cost_source: args.cost.source,
        }
      : {}),
    ...(args.provider ? { phone_reveal_provider: args.provider } : {}),
    ...(args.webhookReceivedAt
      ? { phone_reveal_webhook_received_at: args.webhookReceivedAt }
      : {}),
    ...(args.lastCheckedAt ? { phone_reveal_last_checked_at: args.lastCheckedAt } : {}),
  };
}

/**
 * Aplica la terminalización sin poder lanzar. Fail-closed en los tres modos de
 * fallo: dep ausente, 0 filas afectadas y excepción del driver devuelven
 * `applied: false`, y el caller conserva íntegro su camino anterior (no terminal)
 * en vez de dar por cerrado algo que la base no escribió.
 *
 * Filtrar los estados esperados vacíos es deliberado: una lista vacía haría un
 * `IN ()` que no puede casar nada, y peor aún invitaría a un caller a escribir sin
 * condición. Sin estados que exigir, no se escribe.
 */
export async function applyTerminalPhoneSuppression(args: {
  candidateId: string;
  patch: TerminalPhoneSuppressionPatch;
  persist?: PersistTerminalPhoneSuppression;
}): Promise<TerminalPhoneSuppressionOutcome> {
  if (!args.persist) return { applied: false, reason: 'not_wired' };
  if (args.patch.expectedStatuses.length === 0) {
    return { applied: false, reason: 'not_wired' };
  }
  try {
    const { applied } = await args.persist(args.candidateId, args.patch);
    return applied
      ? { applied: true, reason: 'applied' }
      : { applied: false, reason: 'concurrent_state_change' };
  } catch {
    // Silencio acotado: el driver ya describe la operación y volver a formatear su
    // mensaje aquí solo podría añadir PII. El caller sale por su camino fail-closed.
    return { applied: false, reason: 'write_failed' };
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
