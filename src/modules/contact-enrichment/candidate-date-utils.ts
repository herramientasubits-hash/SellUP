/**
 * Mirrors `isProspectCreatedToday` from `src/modules/prospect-batches/prospect-date-utils.ts`
 * so Agent 2A's "Nuevo" badge shares the exact same semantics as Agent 1's:
 * same calendar day in America/Bogota, derived at render time, never persisted.
 */
const BOGOTA_TZ = 'America/Bogota';

function toLocalDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

export function isCandidateCreatedToday(createdAt: string, timeZone = BOGOTA_TZ): boolean {
  const now = new Date();
  const todayStr = toLocalDateString(now, timeZone);
  const dateStr = toLocalDateString(new Date(createdAt), timeZone);
  return dateStr === todayStr;
}
