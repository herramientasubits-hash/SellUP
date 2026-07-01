const BOGOTA_TZ = 'America/Bogota';

/** Returns a YYYY-MM-DD string for a given Date in the specified timezone. */
function toLocalDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

export function formatProspectDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: BOGOTA_TZ,
  });
}

export function isProspectCreatedToday(createdAt: string, timeZone = BOGOTA_TZ): boolean {
  const now = new Date();
  const todayStr = toLocalDateString(now, timeZone);
  const dateStr = toLocalDateString(new Date(createdAt), timeZone);
  return dateStr === todayStr;
}

/**
 * Returns true if the createdAt timestamp falls within [fromDate, toDate] (inclusive)
 * in the given timezone. fromDate and toDate are YYYY-MM-DD strings.
 */
export function isProspectCreatedWithinDateRange(
  createdAt: string,
  fromDate: string | null | undefined,
  toDate: string | null | undefined,
  timeZone = BOGOTA_TZ,
): boolean {
  if (!fromDate && !toDate) return true;
  const dateStr = toLocalDateString(new Date(createdAt), timeZone);
  if (fromDate && dateStr < fromDate) return false;
  if (toDate && dateStr > toDate) return false;
  return true;
}
