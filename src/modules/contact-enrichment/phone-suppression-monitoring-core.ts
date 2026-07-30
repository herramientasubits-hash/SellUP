// Agente 2A — Apollo Phone Reveal: MONITOREO de supresiones no evaluables
// (APOLLO-PHONE-CACHE-1b, FIX 5)
//
// FIX 4 hizo que un caso sin clave de tombstone —sin Apollo person id resoluble,
// o sin cuenta— deje de ser invisible: se emite un evento de auditoría PII-free y
// el mismo desenlace viaja en `provider_usage_logs.metadata.suppression_state`.
// Faltaba lo operativo: ese rastro solo se podía leer fila por fila.
//
// Este módulo agrega ese rastro. Lo que NO hace, y no es un olvido:
//   * NO empareja por teléfono, email, nombre ni LinkedIn (sin fuzzy matching);
//   * NO rellena el `apollo_person_id` que falta (sin backfill);
//   * NO cambia el reveal: no bloquea, no desbloquea, no llama a ningún
//     proveedor, no escribe nada. Es una LECTURA agregada.
//
// El módulo es PURO y por inyección de dependencias, igual que el resto del
// flujo: no hace I/O, no lee env ni flags, no usa `Date.now()` (el instante
// entra como `nowIso`) y no imprime. El wrapper server-only
// (`phone-suppression-monitoring-queries.ts`) cablea el cliente real.
//
// Superficie de salida: SOLO conteos, un booleano y una fecha. Nunca el person
// id (ni hasheado), nunca candidato ni cuenta, nunca metadata cruda. El evento de
// FIX 4 sí lleva `candidate_id`/`account_id` porque sirve para investigar UN
// caso; un panel agregado no los necesita, así que no los publica.

import {
  PHONE_SUPPRESSION_NOT_EVALUABLE_STATES,
  type PhoneSuppressionCheckPhase,
  type PhoneSuppressionNotEvaluableState,
} from './phone-reveal-suppression-audit';
import { RECOVERY_REVEAL_PHASE } from './phone-reveal-recovery-core';

// ── Ventanas y tope de lectura ─────────────────────────────────

/** Ventana "reciente": lo que importa justo después de una activación. */
export const NOT_EVALUABLE_RECENT_WINDOW_HOURS = 24;

/** Ventana de contexto: tendencia de la semana. También es la ventana leída. */
export const NOT_EVALUABLE_WINDOW_DAYS = 7;

/**
 * Tope de filas de la lectura. Un `not_evaluable_*` es un caso excepcional (lo
 * esperado es 0), así que 1000 en 7 días es holgado; si aun así se alcanza, el
 * resumen lo declara en `read_truncated` en vez de presentar un conteo corto como
 * si fuera completo.
 */
export const NOT_EVALUABLE_ROW_LIMIT = 1000;

// ── Entrada ────────────────────────────────────────────────────

/**
 * Proyección MÍNIMA de `provider_usage_logs` que necesita la agregación. El
 * lector descarta el resto de la metadata antes de llamar aquí: así ni el
 * candidato, ni la cuenta, ni la traza de Apollo entran en este módulo.
 */
export interface PhoneSuppressionNotEvaluableLogRow {
  readonly created_at: string | null;
  readonly suppression_state: string | null;
  readonly reveal_phase: string | null;
}

// ── Salida (sin PII) ───────────────────────────────────────────

export interface PhoneSuppressionNotEvaluableSummary {
  /** Eventos en las últimas 24 h. El umbral de alerta post-activación. */
  readonly total_24h: number;
  /** Eventos en los últimos 7 días (la ventana completa que se lee). */
  readonly total_7d: number;
  /** Desglose por fase del reveal en la ventana de 7 días. */
  readonly by_phase_7d: Readonly<Record<PhoneSuppressionCheckPhase, number>>;
  /** Desglose por motivo en la ventana de 7 días. */
  readonly by_state_7d: Readonly<Record<PhoneSuppressionNotEvaluableState, number>>;
  /**
   * Eventos de la ventana cuya fase no se pudo clasificar. Existe para que la
   * suma de `by_phase_7d` nunca sea menor que `total_7d` sin decirlo: un evento
   * mal etiquetado se ve, no se pierde.
   */
  readonly unclassified_phase_7d: number;
  /** Fecha del evento más reciente DENTRO de la ventana leída; null si no hay. */
  readonly last_seen_at: string | null;
  /** true si la lectura llegó al tope de filas y el conteo es un mínimo. */
  readonly read_truncated: boolean;
}

// ── Clasificación de la fase ───────────────────────────────────

/**
 * `metadata.reveal_phase` → fase de la comprobación. El vocabulario del usage-log
 * y el del evento de auditoría no son idénticos: el recovery escribe
 * `recovery_poll` en el log y `recovery` en el evento, así que ambos se aceptan.
 * Cualquier otro valor (o su ausencia) NO se fuerza a una fase: cae en
 * `unclassified_phase_7d`.
 */
export function classifySuppressionCheckPhase(
  revealPhase: string | null | undefined,
): PhoneSuppressionCheckPhase | null {
  const value = typeof revealPhase === 'string' ? revealPhase.trim() : '';
  if (value === 'start') return 'start';
  if (value === 'webhook') return 'webhook';
  if (value === RECOVERY_REVEAL_PHASE || value === 'recovery') return 'recovery';
  return null;
}

function asNotEvaluableState(
  state: string | null | undefined,
): PhoneSuppressionNotEvaluableState | null {
  const value = typeof state === 'string' ? state.trim() : '';
  return (
    PHONE_SUPPRESSION_NOT_EVALUABLE_STATES.find((known) => known === value) ?? null
  );
}

function parseIsoMillis(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

// ── Agregación ─────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function emptySummary(readTruncated: boolean): PhoneSuppressionNotEvaluableSummary {
  return {
    total_24h: 0,
    total_7d: 0,
    by_phase_7d: { start: 0, webhook: 0, recovery: 0 },
    by_state_7d: {
      not_evaluable_missing_provider_person_id: 0,
      not_evaluable_missing_account_id: 0,
    },
    unclassified_phase_7d: 0,
    last_seen_at: null,
    read_truncated: readTruncated,
  };
}

/**
 * Agrega las filas leídas en el resumen PII-free.
 *
 * Reglas deliberadas:
 *   * una fila cuyo `suppression_state` no sea `not_evaluable_*` se IGNORA — la
 *     misma columna guarda `checked_not_suppressed` / `blocked_suppressed` /
 *     `check_unavailable`, que no son huecos de identificación;
 *   * una fila sin `created_at` interpretable se ignora: sin instante no puede
 *     atribuirse a una ventana, y contarla en 7d pero no en 24h sería inventar;
 *   * el recorte por ventana se hace aquí, no solo en la consulta, para que el
 *     resumen sea correcto aunque el lector traiga un rango más amplio.
 */
export function summarizePhoneSuppressionNotEvaluable(args: {
  rows: readonly PhoneSuppressionNotEvaluableLogRow[];
  nowIso: string;
  rowLimit?: number;
}): PhoneSuppressionNotEvaluableSummary {
  const limit = args.rowLimit ?? NOT_EVALUABLE_ROW_LIMIT;
  const readTruncated = args.rows.length >= limit;
  const nowMillis = parseIsoMillis(args.nowIso);
  if (nowMillis === null) return emptySummary(readTruncated);

  const windowStart = nowMillis - NOT_EVALUABLE_WINDOW_DAYS * DAY_MS;
  const recentStart = nowMillis - NOT_EVALUABLE_RECENT_WINDOW_HOURS * HOUR_MS;

  let total24h = 0;
  let total7d = 0;
  let unclassifiedPhase = 0;
  let lastSeenMillis: number | null = null;
  let lastSeenAt: string | null = null;
  const byPhase: Record<PhoneSuppressionCheckPhase, number> = {
    start: 0,
    webhook: 0,
    recovery: 0,
  };
  const byState: Record<PhoneSuppressionNotEvaluableState, number> = {
    not_evaluable_missing_provider_person_id: 0,
    not_evaluable_missing_account_id: 0,
  };

  for (const row of args.rows) {
    const state = asNotEvaluableState(row.suppression_state);
    if (state === null) continue;

    const createdMillis = parseIsoMillis(row.created_at);
    if (createdMillis === null) continue;
    if (createdMillis < windowStart || createdMillis > nowMillis) continue;

    total7d += 1;
    byState[state] += 1;
    if (createdMillis >= recentStart) total24h += 1;

    const phase = classifySuppressionCheckPhase(row.reveal_phase);
    if (phase === null) unclassifiedPhase += 1;
    else byPhase[phase] += 1;

    if (lastSeenMillis === null || createdMillis > lastSeenMillis) {
      lastSeenMillis = createdMillis;
      lastSeenAt = row.created_at;
    }
  }

  return {
    total_24h: total24h,
    total_7d: total7d,
    by_phase_7d: byPhase,
    by_state_7d: byState,
    unclassified_phase_7d: unclassifiedPhase,
    last_seen_at: lastSeenAt,
    read_truncated: readTruncated,
  };
}

// ── Lectura (por inyección de dependencias) ────────────────────

/**
 * Trae las filas candidatas de `provider_usage_logs`. La inyecta el wrapper
 * server-only; aquí solo se declara el contrato para poder probar el camino
 * completo sin Supabase. Debe devolver como máximo `rowLimit` filas, ya
 * proyectadas a la forma mínima.
 */
export type PhoneSuppressionNotEvaluableRowFetcher = (args: {
  sinceIso: string;
  states: readonly PhoneSuppressionNotEvaluableState[];
  rowLimit: number;
}) => Promise<readonly PhoneSuppressionNotEvaluableLogRow[]>;

export interface PhoneSuppressionMonitoringDeps {
  /** Instante de referencia. Inyectado para que el core siga siendo puro. */
  readonly nowIso: string;
  readonly fetchRows: PhoneSuppressionNotEvaluableRowFetcher;
  /**
   * Autorización del lector. `false` ⇒ se devuelve null SIN leer nada: el panel
   * muestra "sin permisos" en vez de un cero que parecería "no hay casos".
   */
  readonly isAllowed: boolean;
  readonly rowLimit?: number;
}

/**
 * Resumen agregado de las supresiones NO evaluables de los últimos 7 días.
 *
 * Devuelve null cuando el lector no está autorizado. Un fallo de lectura NO se
 * convierte en ceros: se propaga, porque "no pude leer" y "no hay eventos" son
 * conclusiones opuestas y confundirlas es exactamente el silencio que FIX 4 vino
 * a eliminar.
 */
export async function loadPhoneSuppressionNotEvaluableSummary(
  deps: PhoneSuppressionMonitoringDeps,
): Promise<PhoneSuppressionNotEvaluableSummary | null> {
  if (!deps.isAllowed) return null;

  const rowLimit = deps.rowLimit ?? NOT_EVALUABLE_ROW_LIMIT;
  const nowMillis = parseIsoMillis(deps.nowIso);
  const sinceMillis =
    nowMillis === null ? null : nowMillis - NOT_EVALUABLE_WINDOW_DAYS * DAY_MS;
  const sinceIso =
    sinceMillis === null ? deps.nowIso : new Date(sinceMillis).toISOString();

  const rows = await deps.fetchRows({
    sinceIso,
    states: PHONE_SUPPRESSION_NOT_EVALUABLE_STATES,
    rowLimit,
  });

  return summarizePhoneSuppressionNotEvaluable({
    rows,
    nowIso: deps.nowIso,
    rowLimit,
  });
}

// ── Criterio de alerta (documentado y comprobable, sin canal) ───
//
// v1 NO manda Slack ni email: no existe en el repo un patrón trivial de alerta
// para este flujo, y montarlo aquí abriría alcance. Lo que sí queda es el
// CRITERIO, ejecutable y probado, para que quien lo cablee después no tenga que
// reinterpretarlo:
//
//   TODO operativo (post-activación de ENABLE_APOLLO_PHONE_CACHE):
//   revisar este resumen y avisar al equipo cuando `phoneSuppressionMonitoringAlerts`
//   devuelva algo. Frecuencia sugerida: diaria mientras el flag esté encendido.

/** Motivos de alerta. Códigos estables (no texto de UI). */
export type PhoneSuppressionMonitoringAlert =
  /** Cualquier caso nuevo tras la activación merece mirada: lo esperado es 0. */
  | 'not_evaluable_seen_last_24h'
  /**
   * En vuelo es más grave que en START: el teléfono YA llegó de Apollo y se
   * persistió sin haber podido comprobar el tombstone.
   */
  | 'not_evaluable_in_flight'
  /**
   * Con la migración 098 aplicada, un candidato nuevo debería tener
   * `apollo_person_id`. Que siga faltando apunta a un hueco de escritura, no a
   * datos heredados.
   */
  | 'missing_provider_person_id_after_migration_098'
  /** La lectura tocó el tope: el conteo es un mínimo, no el total. */
  | 'read_truncated';

/**
 * Evalúa el criterio de alerta sobre un resumen. Puro: no notifica a nadie.
 * Devolver `[]` significa "nada que reportar", que es el estado esperado.
 */
export function phoneSuppressionMonitoringAlerts(
  summary: PhoneSuppressionNotEvaluableSummary,
): readonly PhoneSuppressionMonitoringAlert[] {
  const alerts: PhoneSuppressionMonitoringAlert[] = [];
  if (summary.total_24h > 0) alerts.push('not_evaluable_seen_last_24h');
  if (summary.by_phase_7d.webhook > 0 || summary.by_phase_7d.recovery > 0) {
    alerts.push('not_evaluable_in_flight');
  }
  if (summary.by_state_7d.not_evaluable_missing_provider_person_id > 0) {
    alerts.push('missing_provider_person_id_after_migration_098');
  }
  if (summary.read_truncated) alerts.push('read_truncated');
  return alerts;
}
