// ============================================================
// Recordatorios y resúmenes por Slack (dueña 11-11) — textos (puro).
// ============================================================

export interface PendingSummary {
  total: number;
  /** Días del pendiente más antiguo. */
  oldestDays: number | null;
  olderThan7: number;
  sample: string[];
}

export function reminderText(input: {
  personName: string | null;
  pending: PendingSummary;
  fromName?: string | null;
  note?: string | null;
}): string {
  const hello = input.personName ? `Hola, ${input.personName.split(/\s+/)[0]}.` : 'Hola.';
  const who = input.fromName ? `${input.fromName} te recuerda que ` : 'Te recuerdo que ';
  const p = input.pending;
  const main =
    p.total === 0
      ? 'no tienes empresas por revisar. ¡Al día!'
      : `tienes *${p.total}* ${p.total === 1 ? 'empresa' : 'empresas'} por revisar en SellUp` +
        (p.olderThan7 > 0 ? ` (${p.olderThan7} con más de 7 días)` : '') +
        '.';
  const sample = p.sample.length ? `\nEntre ellas: ${p.sample.slice(0, 3).join(', ')}${p.total > 3 ? '…' : ''}` : '';
  const note = input.note?.trim() ? `\n_Nota: ${input.note.trim().slice(0, 300)}_` : '';
  return `${hello} ${who}${main}${sample}${note}`;
}

export interface TeamWeekRow {
  name: string;
  approved: number;
  discarded: number;
  pending: number;
  oldestDays: number | null;
}

export function weeklySummaryText(input: {
  leaderName: string | null;
  rows: readonly TeamWeekRow[];
  usageUsd: number | null;
  usageCredits: number;
}): string {
  const hello = input.leaderName ? `Hola, ${input.leaderName.split(/\s+/)[0]}.` : 'Hola.';
  const totals = input.rows.reduce((s, r) => ({ a: s.a + r.approved, d: s.d + r.discarded, p: s.p + r.pending }), { a: 0, d: 0, p: 0 });
  const lines = [
    `${hello} Así le fue a tu equipo en SellUp la última semana:`,
    `• Aprobadas: *${totals.a}* · Descartadas: *${totals.d}* · Por revisar hoy: *${totals.p}*`,
  ];
  const behind = [...input.rows]
    .filter((r) => r.pending > 0)
    .sort((x, y) => (y.oldestDays ?? 0) - (x.oldestDays ?? 0))
    .slice(0, 5);
  if (behind.length) {
    lines.push('*Con más pendientes:*');
    for (const r of behind) lines.push(`• ${r.name}: ${r.pending} por revisar${r.oldestDays ? ` (la más antigua de hace ${r.oldestDays} días)` : ''}`);
  }
  const cost = input.usageUsd !== null ? `US$${input.usageUsd.toFixed(2)}` : `${input.usageCredits} créditos`;
  lines.push(`• Consumo de IA y proveedores del equipo en la semana: ${cost}`);
  return lines.join('\n');
}

/** Lunes a viernes en Bogotá (los recordatorios diarios no salen el fin de semana). */
export function isBogotaWeekday(now: Date): boolean {
  const d = new Date(now.getTime() - 5 * 3_600_000).getUTCDay();
  return d >= 1 && d <= 5;
}

export function isBogotaMonday(now: Date): boolean {
  return new Date(now.getTime() - 5 * 3_600_000).getUTCDay() === 1;
}

/** Interruptor encendido sólo con `on`/`true` (los recordatorios automáticos salen apagados). */
export function digestFlagOn(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === 'on' || v === 'true';
}
