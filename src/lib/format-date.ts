/**
 * Formato de fechas con zona horaria fija.
 *
 * Una fecha formateada sin `timeZone` usa la zona de quien la pinta: el
 * servidor (UTC) y el navegador (hora local) escriben días distintos para el
 * mismo instante cerca de la medianoche, y React rechaza la hidratación
 * (error #418). Aquí la zona es siempre la de la operación comercial — la
 * misma que ya usan `prospect-date-utils` y `candidate-date-utils` para
 * decidir qué es «hoy» —, así servidor y navegador escriben lo mismo.
 */

export const APP_TIME_ZONE = 'America/Bogota';
export const APP_LOCALE = 'es-CO';

export type DateInput = string | number | Date | null | undefined;

/** Lo que se pinta cuando no hay fecha o no se puede leer. */
export const EMPTY_DATE_LABEL = '—';

function toValidDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Las opciones que llegan, con la zona de la aplicación si no traen una. */
export function withAppTimeZone(
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormatOptions {
  return { timeZone: APP_TIME_ZONE, ...options };
}

/**
 * Formatea un instante en la zona de la aplicación. Sustituye a
 * `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` sobre fechas.
 * Las opciones mandan sobre el estilo (fecha, hora o ambas), igual que en
 * `Intl.DateTimeFormat`.
 */
export function formatInAppZone(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
  locale: string = APP_LOCALE,
  fallback: string = EMPTY_DATE_LABEL,
): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(locale, withAppTimeZone(options)).format(date);
}

/** «26 sept 2026». */
export function formatAppDate(value: DateInput, fallback?: string): string {
  return formatInAppZone(
    value,
    { day: 'numeric', month: 'short', year: 'numeric' },
    APP_LOCALE,
    fallback,
  );
}

/** «26 sept 2026, 7:05 p. m.». */
export function formatAppDateTime(value: DateInput, fallback?: string): string {
  return formatInAppZone(
    value,
    { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' },
    APP_LOCALE,
    fallback,
  );
}

/** «7:05 p. m.». */
export function formatAppTime(value: DateInput, fallback?: string): string {
  return formatInAppZone(value, { hour: 'numeric', minute: '2-digit' }, APP_LOCALE, fallback);
}

/** El día de calendario (`AAAA-MM-DD`) en la zona de la aplicación. */
export function appDayKey(value: DateInput): string | null {
  const date = toValidDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(date);
}
