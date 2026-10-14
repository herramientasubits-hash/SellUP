// ============================================================
// /ai-usage — qué significa cada filtro (funciones puras)
//
// Estado: agent_runs y provider_usage_logs no comparten vocabulario.
//   ejecuciones: pending | running | completed | failed | cancelled
//   consultas:   success | error | rate_limited | quota_exceeded
// Un único filtro de Estado tiene que traducirse a los dos lados; si no,
// «Completado» busca `completed` en los logs y devuelve 0 consultas y $0.
//
// Periodo: los límites se calculan en la zona de la operación
// (America/Bogota), no en la del servidor (UTC).
// ============================================================

import { APP_TIME_ZONE } from '@/lib/format-date';

export type UsagePeriod = '7d' | '30d' | 'current_month' | 'all';

export interface StatusFilterResolution {
  /** Estados de agent_runs que cumplen el filtro; null = sin restricción. */
  runStatuses: string[] | null;
  /** Estados de provider_usage_logs que cumplen el filtro; null = sin restricción por estado del log. */
  logStatuses: string[] | null;
  /**
   * true ⇒ el estado sólo existe en ejecuciones (en curso, pendiente,
   * cancelada): las consultas que cuentan son las de las ejecuciones con ese
   * estado (por agent_run_id).
   */
  logsByRunStatus: boolean;
}

const LOG_ERROR_STATUSES = ['error', 'rate_limited', 'quota_exceeded'];
const RUN_ONLY_STATUSES = new Set(['running', 'pending', 'cancelled']);

export function resolveStatusFilter(status: string | undefined): StatusFilterResolution {
  if (!status) return { runStatuses: null, logStatuses: null, logsByRunStatus: false };

  if (status === 'completed' || status === 'success') {
    return { runStatuses: ['completed'], logStatuses: ['success'], logsByRunStatus: false };
  }
  if (status === 'failed' || status === 'error') {
    return { runStatuses: ['failed'], logStatuses: [...LOG_ERROR_STATUSES], logsByRunStatus: false };
  }
  // Un error concreto del proveedor: en los logs, sólo ese error; en las
  // ejecuciones, su equivalente es una ejecución fallida.
  if (status === 'rate_limited' || status === 'quota_exceeded') {
    return { runStatuses: ['failed'], logStatuses: [status], logsByRunStatus: false };
  }
  if (RUN_ONLY_STATUSES.has(status)) {
    return { runStatuses: [status], logStatuses: null, logsByRunStatus: true };
  }
  // Valor desconocido: se aplica literal a los dos lados, como antes.
  return { runStatuses: [status], logStatuses: [status], logsByRunStatus: false };
}

/**
 * Clave con la que un estado se ofrece en el filtro: `success` y `completed`
 * significan lo mismo para quien filtra (y lo mismo `error` y `failed`), así
 * que se ofrecen una sola vez.
 */
export function canonicalStatusKey(status: string): string {
  if (status === 'success') return 'completed';
  if (status === 'error') return 'failed';
  return status;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Año, mes y día de `instant` vistos en `timeZone`. */
function datePartsInZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

/** Diferencia (ms) entre la hora de pared de `timeZone` y UTC en `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante UTC de las 00:00 del día (year, month, day) en `timeZone`. */
function zonedMidnightToUtc(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}

/**
 * Límite inferior (ISO) del periodo elegido.
 *   - 7d / 30d: ventanas móviles desde `now`.
 *   - current_month: día 1 del mes a las 00:00 en America/Bogota.
 *   - all / sin periodo: null.
 */
export function resolvePeriodStart(
  period: UsagePeriod | undefined,
  now: Date = new Date(),
  timeZone: string = APP_TIME_ZONE,
): string | null {
  if (period === '7d') return new Date(now.getTime() - 7 * DAY_MS).toISOString();
  if (period === '30d') return new Date(now.getTime() - 30 * DAY_MS).toISOString();
  if (period === 'current_month') {
    const { year, month } = datePartsInZone(now, timeZone);
    return zonedMidnightToUtc(year, month, 1, timeZone).toISOString();
  }
  return null;
}
