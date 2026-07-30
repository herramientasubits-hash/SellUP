// Agente 2A — Apollo Phone Reveal: RECOVERY L2 programado (núcleo PURO)
// (APOLLO-PHONE-RECOVERY-CRON-1)
//
// POR QUÉ EXISTE ESTE HITO
// El webhook de Apollo no está aterrizando: en Producción hay candidatos con
// `phone_reveal_status` en vuelo y `phone_reveal_webhook_received_at` NULL, y los
// únicos casos resueltos lo fueron por recovery MANUAL de un admin. El recovery L1
// (1 GET al `webhook_result`) ya existe y funciona; lo que faltaba era el L2: que
// alguien lo dispare sin humano. Sin eso, un candidato cuyo webhook se pierde se
// queda "Revelación en proceso" para siempre.
//
// QUÉ ES ESTE MÓDULO
// El núcleo PURO del disparador programado. NO hace red, NO toca Supabase, NO lee
// env, NO imprime y NO agenda nada: recibe el secreto ya extraído, el estado del
// flag y una dep que ejecuta el batch del recovery core. Solo decide:
//   1. Autorización por secreto compartido (constant-time, fail-closed).
//   2. Gate de flag (ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON), fail-closed.
//   3. Normalización de la ventana (minAgeMinutes) y del tope (maxCandidates).
//   4. Delegación al batch del recovery core, que ya garantiza 1 GET por candidato
//      por corrida, sin retry y sin reveal nuevo.
//   5. Reducción del resultado a conteos SEGUROS (sin PII) + httpStatus.
//
// LO QUE ESTE CAMINO NUNCA HACE (heredado del recovery core, no se relaja aquí)
//   * NO inicia reveals: no llama /people/match, no manda `reveal_phone_number`.
//     Solo LEE un resultado que un reveal previo YA autorizado produjo.
//   * NO consume créditos nuevos.
//   * NO crea contactos oficiales, NO aprueba candidatos, NO escribe HubSpot,
//     NO toca Lusha.
//   * NO reintenta dentro de la misma corrida (1 GET por candidato; si sigue en
//     vuelo, se resolverá en la corrida siguiente).
//   * NO respeta menos la supresión: el tombstone se comprueba SIEMPRE dentro del
//     recovery core, con la caché encendida o apagada, y bloquea la persistencia.
//   * NO imprime teléfono, raw_number, sanitized_number, email, linkedin, nombre,
//     empresa, API key, token ni payload crudo.
//
// PARA ACTIVARLO hacen falta DOS cosas independientes: el flag en `true` y el cron
// (o un disparo manual) con `CRON_SECRET`. Con el flag apagado — el default — el
// endpoint responde 200 `disabled` y NO consulta Apollo ni escribe: mergear este
// hito no arranca ningún poll por sí solo.

import {
  DEFAULT_BATCH_MAX_CANDIDATES,
  DEFAULT_BATCH_MIN_AGE_MINUTES,
  MAX_BATCH_MAX_CANDIDATES,
  type RecoverStaleApolloPhoneRevealInput,
  type StaleRecoverySummary,
} from './phone-reveal-recovery-core';

// ── Constantes ─────────────────────────────────────────────────

/** Nombre de la env con el secreto del cron (compartida con los demás crons). */
export const RECOVERY_CRON_SECRET_ENV = 'CRON_SECRET';

/** Nombre del flag que habilita el disparo programado. OFF por defecto. */
export const RECOVERY_CRON_FLAG = 'ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON';

/** Tope de candidatos por corrida por defecto (el core hard-capea en 10). */
export const RECOVERY_CRON_DEFAULT_MAX_CANDIDATES = DEFAULT_BATCH_MAX_CANDIDATES;

/** Tope duro por corrida, espejado del recovery core. */
export const RECOVERY_CRON_MAX_CANDIDATES_CAP = MAX_BATCH_MAX_CANDIDATES;

/**
 * Antigüedad mínima (min) para considerar un reveal stale. Es la ventana que se le
 * concede al webhook antes de hacer poll: por debajo de esto NO se toca al
 * candidato, para no competir con una entrega legítima que todavía puede llegar.
 */
export const RECOVERY_CRON_DEFAULT_MIN_AGE_MINUTES = DEFAULT_BATCH_MIN_AGE_MINUTES;

/** Suelo de la ventana: nunca se hace poll a reveals de menos de 10 minutos. */
export const RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR = 10;

// ── Autorización por secreto compartido ────────────────────────

/** Motivo mecánico del rechazo. Se LOGUEA, nunca se devuelve al llamante. */
export type RecoveryCronDenialCode =
  | 'cron_secret_not_configured'
  | 'cron_secret_missing'
  | 'cron_secret_mismatch';

export interface RecoveryCronAuthorization {
  authorized: boolean;
  /** null cuando `authorized` es true. */
  denialCode: RecoveryCronDenialCode | null;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Autoriza la corrida por secreto compartido. Fail-closed en los tres casos:
 * secreto esperado ausente/vacío (endpoint SIN configurar ⇒ nunca abierto),
 * secreto provisto ausente, o secreto distinto. La comparación es en tiempo
 * constante. El `denialCode` es para el log del servidor: la respuesta HTTP no
 * distingue "no configurado" de "secreto incorrecto".
 */
export function authorizeRecoveryCronRequest(
  providedSecret: string | null | undefined,
  expectedSecret: string | null | undefined,
): RecoveryCronAuthorization {
  const expected = cleanText(expectedSecret);
  if (!expected) {
    return { authorized: false, denialCode: 'cron_secret_not_configured' };
  }
  const provided = cleanText(providedSecret);
  if (!provided) {
    return { authorized: false, denialCode: 'cron_secret_missing' };
  }
  if (!constantTimeEquals(provided, expected)) {
    return { authorized: false, denialCode: 'cron_secret_mismatch' };
  }
  return { authorized: true, denialCode: null };
}

/**
 * Extrae el secreto de un header `Authorization: Bearer <secreto>` (el formato que
 * envía Vercel Cron). Devuelve null si el header falta o no es Bearer. NO imprime
 * el header ni el secreto.
 */
export function extractCronSecretFromAuthorizationHeader(
  authorizationHeader: string | null | undefined,
): string | null {
  const raw = cleanText(authorizationHeader);
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? cleanText(match[1]) : null;
}

// ── Normalización de la ventana y del tope ─────────────────────

/**
 * Normaliza la antigüedad mínima. El recovery core ya aplica sus propios límites;
 * aquí se añade un SUELO propio del cron (10 min) para que ninguna configuración
 * accidental haga poll a reveals recién iniciados. Entrada no finita ⇒ default.
 */
export function clampCronMinAgeMinutes(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return RECOVERY_CRON_DEFAULT_MIN_AGE_MINUTES;
  }
  const floored = Math.floor(value);
  return floored < RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR
    ? RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR
    : floored;
}

/**
 * Normaliza el tope por corrida al rango [1, MAX_BATCH_MAX_CANDIDATES]. Entrada no
 * finita ⇒ default. El recovery core vuelve a capear (defensa en profundidad).
 */
export function clampCronMaxCandidates(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return RECOVERY_CRON_DEFAULT_MAX_CANDIDATES;
  }
  const floored = Math.floor(value);
  if (floored < 1) return 1;
  return floored > RECOVERY_CRON_MAX_CANDIDATES_CAP
    ? RECOVERY_CRON_MAX_CANDIDATES_CAP
    : floored;
}

// ── Corrida programada ─────────────────────────────────────────

export type RecoveryCronStatus =
  | 'executed'
  | 'dry_run'
  | 'disabled'
  | 'unauthorized';

export interface RecoveryCronRunInput {
  /** Secreto que trajo la petición (ya extraído del header/query por la ruta). */
  providedSecret: string | null;
  /**
   * true ⇒ solo SELECCIONA candidatos elegibles y reporta el conteo, sin consultar
   * Apollo y sin escribir. Pensado para el primer QA en Producción.
   */
  dryRun?: boolean;
  maxCandidates?: number | null;
  minAgeMinutes?: number | null;
}

export interface RecoveryCronRunDeps {
  /** Secreto esperado (la ruta lo lee de env; el core nunca lee env). */
  expectedSecret: string | null;
  /** Estado del flag ya resuelto por la ruta. false ⇒ no se ejecuta nada. */
  enabled: boolean;
  /**
   * Ejecuta el batch del recovery core. NUNCA se invoca si la autorización falla o
   * si el flag está apagado (fail-closed antes de cualquier I/O).
   */
  recoverStale: (
    input: RecoverStaleApolloPhoneRevealInput,
  ) => Promise<StaleRecoverySummary>;
}

export interface RecoveryCronRunResult {
  ok: boolean;
  /** Código HTTP que debe devolver la ruta. */
  httpStatus: number;
  status: RecoveryCronStatus;
  /** Motivo mecánico del rechazo, para el LOG del servidor (no para el body). */
  denialCode: RecoveryCronDenialCode | null;
  checked: number;
  recovered: number;
  stillPending: number;
  noPhoneFound: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  maxCandidates: number;
  minAgeMinutes: number;
}

function emptyRun(
  status: RecoveryCronStatus,
  httpStatus: number,
  ok: boolean,
  denialCode: RecoveryCronDenialCode | null,
  maxCandidates: number,
  minAgeMinutes: number,
): RecoveryCronRunResult {
  return {
    ok,
    httpStatus,
    status,
    denialCode,
    checked: 0,
    recovered: 0,
    stillPending: 0,
    noPhoneFound: 0,
    failed: 0,
    skipped: 0,
    dryRun: true,
    maxCandidates,
    minAgeMinutes,
  };
}

/**
 * Corrida programada del recovery L2. Orden de gates (fail-closed, sin I/O hasta
 * pasarlos todos):
 *   1. Secreto inválido/ausente/no configurado ⇒ 401, `unauthorized`, 0 trabajo.
 *   2. Flag apagado ⇒ 200 `disabled`, 0 trabajo. Es 200 a propósito: es un no-op
 *      sano, no un fallo, y no debe generar ruido de alerta en cada tick.
 *   3. Solo entonces se delega al batch del recovery core con los caps
 *      normalizados.
 *
 * `dryRun` true ⇒ el core selecciona y NO consulta Apollo ni escribe. El default
 * del cron es EJECUTAR (dryRun false): un cron que solo simula nunca desatasca a
 * nadie, que es justo el problema que este hito arregla. El freno real de
 * seguridad es el flag, no el dryRun.
 */
export async function runScheduledStalePhoneRevealRecovery(
  input: RecoveryCronRunInput,
  deps: RecoveryCronRunDeps,
): Promise<RecoveryCronRunResult> {
  const maxCandidates = clampCronMaxCandidates(input.maxCandidates);
  const minAgeMinutes = clampCronMinAgeMinutes(input.minAgeMinutes);

  const auth = authorizeRecoveryCronRequest(input.providedSecret, deps.expectedSecret);
  if (!auth.authorized) {
    return emptyRun(
      'unauthorized',
      401,
      false,
      auth.denialCode,
      maxCandidates,
      minAgeMinutes,
    );
  }

  if (!deps.enabled) {
    return emptyRun('disabled', 200, true, null, maxCandidates, minAgeMinutes);
  }

  const dryRun = input.dryRun === true;
  const summary = await deps.recoverStale({
    maxCandidates,
    minAgeMinutes,
    dryRun,
    actorUserId: null, // cron: no hay actor humano
  });

  return {
    ok: true,
    httpStatus: 200,
    status: summary.dryRun ? 'dry_run' : 'executed',
    denialCode: null,
    checked: summary.checked,
    recovered: summary.recovered,
    stillPending: summary.still_pending,
    noPhoneFound: summary.no_phone_found,
    failed: summary.failed,
    skipped: summary.skipped,
    dryRun: summary.dryRun,
    maxCandidates: summary.maxCandidates,
    minAgeMinutes: summary.minAgeMinutes,
  };
}
