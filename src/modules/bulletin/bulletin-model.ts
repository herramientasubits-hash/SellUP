// ============================================================
// Boletín de SellUp para Slack (dueña 11-11) — modelo y dibujo (puro).
// Cada persona recibe lo que pasó en su equipo y, en cascada, en los equipos
// de sus reportes (Leonardo ve a sus líderes y los equipos de cada líder). Es
// gráfico: semáforo, flechas contra el período anterior, barras y embudo.
// El mismo modelo se guarda en el historial y se pinta en la vista previa.
// ============================================================

import type { BulletinFrequency } from '@/modules/notifications/notification-catalog';

export const BULLETIN_VERSION = 1;
const DAY_MS = 86_400_000;
const BOGOTA_OFFSET_MS = -5 * 3_600_000;

// ─── Períodos (en hora de Bogotá) ────────────────────────────────────────────

export interface BulletinPeriod {
  frequency: BulletinFrequency;
  /** Primer día incluido (AAAA-MM-DD, Bogotá). */
  start: string;
  /** Último día incluido. */
  end: string;
  /** Período anterior de la misma forma, para comparar. */
  previousStart: string;
  previousEnd: string;
  label: string;
  previousLabel: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function bogotaDate(now: Date): Date {
  const local = new Date(now.getTime() + BOGOTA_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function shortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function rangeLabel(a: Date, b: Date): string {
  return a.getTime() === b.getTime() ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)} ${b.getUTCFullYear()}`;
}

/**
 * El período que cubre un boletín enviado HOY:
 *  · diario: el día hábil anterior (el lunes cubre viernes a domingo);
 *  · semanal: la semana anterior (lunes a domingo);
 *  · mensual: el mes anterior;
 *  · trimestral: el trimestre anterior.
 */
export function bulletinPeriod(frequency: BulletinFrequency, now: Date): BulletinPeriod {
  const today = bogotaDate(now);
  const dow = today.getUTCDay(); // 0 domingo … 6 sábado
  let start: Date;
  let end: Date;
  let prevStart: Date;
  let prevEnd: Date;
  let label: string;
  let previousLabel: string;

  if (frequency === 'daily') {
    end = addDays(today, -1);
    start = dow === 1 ? addDays(today, -3) : end;
    const length = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    prevEnd = addDays(start, -1);
    prevStart = addDays(prevEnd, -(length - 1));
    label = length > 1 ? rangeLabel(start, end) : `Ayer, ${shortDate(end)}`;
    previousLabel = rangeLabel(prevStart, prevEnd);
  } else if (frequency === 'weekly') {
    const mondayThisWeek = addDays(today, -((dow + 6) % 7));
    start = addDays(mondayThisWeek, -7);
    end = addDays(mondayThisWeek, -1);
    prevStart = addDays(start, -7);
    prevEnd = addDays(start, -1);
    label = `Semana del ${rangeLabel(start, end)}`;
    previousLabel = 'la semana anterior';
  } else {
    const months = frequency === 'monthly' ? 1 : 3;
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const currentStartMonth = frequency === 'monthly' ? m : m - (m % 3);
    start = new Date(Date.UTC(y, currentStartMonth - months, 1));
    end = addDays(new Date(Date.UTC(y, currentStartMonth, 1)), -1);
    prevStart = new Date(Date.UTC(y, currentStartMonth - 2 * months, 1));
    prevEnd = addDays(start, -1);
    label =
      frequency === 'monthly'
        ? `${MONTHS_LONG[start.getUTCMonth()]} ${start.getUTCFullYear()}`
        : `Trimestre ${Math.floor(start.getUTCMonth() / 3) + 1} · ${start.getUTCFullYear()}`;
    previousLabel = frequency === 'monthly' ? 'el mes anterior' : 'el trimestre anterior';
  }
  return { frequency, start: iso(start), end: iso(end), previousStart: iso(prevStart), previousEnd: iso(prevEnd), label, previousLabel };
}

/** ¿Toca enviar este boletín hoy? (el proceso corre a las 8:15 de Bogotá todos los días). */
export function isBulletinDue(frequency: BulletinFrequency, now: Date): boolean {
  const today = bogotaDate(now);
  const dow = today.getUTCDay();
  if (frequency === 'daily') return dow >= 1 && dow <= 5;
  if (frequency === 'weekly') return dow === 1;
  if (frequency === 'monthly') return today.getUTCDate() === 1;
  return today.getUTCDate() === 1 && today.getUTCMonth() % 3 === 0;
}

/** Instantes ISO (UTC) que cubren los días [start, end] de Bogotá. */
export function periodBounds(start: string, end: string): { from: string; to: string } {
  const from = new Date(Date.parse(`${start}T00:00:00Z`) - BOGOTA_OFFSET_MS);
  const to = new Date(Date.parse(`${end}T00:00:00Z`) - BOGOTA_OFFSET_MS + DAY_MS);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ─── Modelo ──────────────────────────────────────────────────────────────────

/** Lo que hizo una persona en un período (y lo que tiene pendiente hoy). */
export interface PersonActivity {
  id: string;
  name: string;
  searches: number;
  found: number;
  approved: number;
  discarded: number;
  contactsApproved: number;
  firstContacts: number;
  firstContactsUsed: number;
  usageUsd: number;
  usageCredits: number;
  /** Foto de hoy: pendientes y antigüedad del más viejo. */
  pending: number;
  oldestPendingDays: number | null;
}

export interface BulletinTeam {
  /** El líder del sub-equipo (un reporte directo de quien recibe) o «Directos». */
  name: string;
  memberIds: string[];
}

export interface PulseMetric {
  key: string;
  label: string;
  emoji: string;
  value: number;
  previous: number;
  /** Más es mejor (aprobadas) o peor (no aplica: todas «más es mejor» salvo consumo). */
  higherIsBetter: boolean;
  format: 'count' | 'usd';
}

export interface BulletinModel {
  version: number;
  frequency: BulletinFrequency;
  period: BulletinPeriod;
  recipientName: string;
  scopeLabel: string;
  teamSize: number;
  moneyVisible: boolean;
  status: 'verde' | 'amarillo' | 'rojo';
  headline: string;
  mainAlert: string | null;
  pulse: PulseMetric[];
  approvalRate: { before: number | null; now: number | null };
  funnel: Array<{ label: string; value: number }>;
  teams: Array<{ name: string; people: number; approved: number; discarded: number; pending: number; oldestDays: number | null; active: number }>;
  behind: Array<{ name: string; pending: number; oldestDays: number | null }>;
  inactive: string[];
  closing: string;
}

const STATUS_EMOJI = { verde: '🟢', amarillo: '🟡', rojo: '🔴' } as const;
const STATUS_TEXT = { verde: 'En buen ritmo', amarillo: 'Para revisar', rojo: 'Atención prioritaria' } as const;

function sum(people: readonly PersonActivity[], key: keyof PersonActivity): number {
  return people.reduce((s, p) => s + (Number(p[key]) || 0), 0);
}

function rate(approved: number, discarded: number): number | null {
  const decided = approved + discarded;
  return decided > 0 ? Math.round((approved / decided) * 1000) / 10 : null;
}

export function deltaPct(value: number, previous: number): number | null {
  if (previous === 0) return value === 0 ? 0 : null;
  return Math.round(((value - previous) / previous) * 1000) / 10;
}

function isActive(p: PersonActivity): boolean {
  return p.searches + p.approved + p.discarded + p.contactsApproved + p.firstContacts > 0;
}

/** Arma el boletín con lo de este período, lo del anterior y los sub-equipos. */
export function buildBulletinModel(input: {
  period: BulletinPeriod;
  recipientName: string;
  scopeLabel: string;
  moneyVisible: boolean;
  current: readonly PersonActivity[];
  previous: readonly PersonActivity[];
  teams: readonly BulletinTeam[];
}): BulletinModel {
  const { current, previous } = input;
  const metric = (key: keyof PersonActivity, label: string, emoji: string, higherIsBetter = true, format: 'count' | 'usd' = 'count'): PulseMetric => ({
    key: String(key),
    label,
    emoji,
    value: Math.round(sum(current, key) * 100) / 100,
    previous: Math.round(sum(previous, key) * 100) / 100,
    higherIsBetter,
    format,
  });
  const pulse: PulseMetric[] = [
    metric('searches', 'Búsquedas lanzadas', '🔎'),
    metric('found', 'Empresas encontradas', '🏢'),
    metric('approved', 'Empresas aprobadas', '✅'),
    metric('discarded', 'Descartadas', '🗑️', false),
    metric('contactsApproved', 'Contactos aprobados', '👤'),
    metric('firstContacts', 'Primeros contactos preparados', '🧭'),
    input.moneyVisible ? metric('usageUsd', 'Consumo de IA y proveedores', '💳', false, 'usd') : metric('usageCredits', 'Créditos usados', '💳', false),
  ];

  const pendingNow = sum(current, 'pending');
  const behind = [...current]
    .filter((p) => p.pending > 0)
    .sort((a, b) => (b.oldestPendingDays ?? 0) - (a.oldestPendingDays ?? 0) || b.pending - a.pending)
    .slice(0, 5)
    .map((p) => ({ name: p.name, pending: p.pending, oldestDays: p.oldestPendingDays }));
  const stale = current.filter((p) => (p.oldestPendingDays ?? 0) > 7).length;
  const inactive = current.filter((p) => !isActive(p)).map((p) => p.name);

  const approvedNow = sum(current, 'approved');
  const approvedBefore = sum(previous, 'approved');
  const activeShare = current.length ? (current.length - inactive.length) / current.length : 1;
  const status: BulletinModel['status'] =
    (approvedBefore > 0 && approvedNow < approvedBefore * 0.7) || activeShare < 0.5 || stale >= Math.max(2, current.length / 3)
      ? 'rojo'
      : approvedNow < approvedBefore || stale > 0 || activeShare < 0.8
        ? 'amarillo'
        : 'verde';

  const approvedDelta = deltaPct(approvedNow, approvedBefore);
  const headline =
    `${current.length - inactive.length} de ${current.length} ${current.length === 1 ? 'persona trabajó' : 'personas trabajaron'} en SellUp · ` +
    `${approvedNow} ${approvedNow === 1 ? 'empresa aprobada' : 'empresas aprobadas'}` +
    (approvedDelta !== null && approvedBefore > 0 ? ` (${approvedDelta >= 0 ? '+' : ''}${approvedDelta}% vs. ${input.period.previousLabel})` : '');
  const mainAlert =
    stale > 0
      ? `${stale} ${stale === 1 ? 'persona tiene' : 'personas tienen'} empresas por revisar con más de 7 días.`
      : inactive.length > 0
        ? `${inactive.length} ${inactive.length === 1 ? 'persona no tuvo' : 'personas no tuvieron'} actividad en el período.`
        : approvedDelta !== null && approvedDelta < 0
          ? `Bajaron las aprobaciones ${Math.abs(approvedDelta)}% frente a ${input.period.previousLabel}.`
          : null;

  const teams = input.teams
    .map((team) => {
      const members = current.filter((p) => team.memberIds.includes(p.id));
      const oldest = members.map((p) => p.oldestPendingDays ?? 0);
      return {
        name: team.name,
        people: members.length,
        approved: sum(members, 'approved'),
        discarded: sum(members, 'discarded'),
        pending: sum(members, 'pending'),
        oldestDays: oldest.length && Math.max(...oldest) > 0 ? Math.max(...oldest) : null,
        active: members.filter(isActive).length,
      };
    })
    .filter((t) => t.people > 0)
    .sort((a, b) => b.approved - a.approved || b.pending - a.pending);

  const closing =
    status === 'rojo'
      ? 'Prioridad: destrabar los pendientes más antiguos y acompañar a quienes no tuvieron actividad.'
      : status === 'amarillo'
        ? 'Revisar los pendientes de más de 7 días y sostener el ritmo de aprobación.'
        : 'Buen ritmo: mantener la revisión diaria y preparar el primer contacto de lo aprobado.';

  return {
    version: BULLETIN_VERSION,
    frequency: input.period.frequency,
    period: input.period,
    recipientName: input.recipientName,
    scopeLabel: input.scopeLabel,
    teamSize: current.length,
    moneyVisible: input.moneyVisible,
    status,
    headline,
    mainAlert,
    pulse,
    approvalRate: { before: rate(approvedBefore, sum(previous, 'discarded')), now: rate(approvedNow, sum(current, 'discarded')) },
    funnel: [
      { label: 'Encontradas', value: sum(current, 'found') },
      { label: 'Aprobadas', value: approvedNow },
      { label: 'Con contactos aprobados', value: sum(current, 'contactsApproved') },
      { label: 'Primer contacto preparado', value: sum(current, 'firstContacts') },
      { label: 'Primer contacto usado', value: sum(current, 'firstContactsUsed') },
    ],
    teams,
    behind,
    inactive,
    closing: pendingNow > 0 ? `${closing} Hoy hay ${pendingNow} por revisar en el equipo.` : closing,
  };
}

// ─── Dibujo para Slack ───────────────────────────────────────────────────────

export const FREQUENCY_TITLE: Readonly<Record<BulletinFrequency, string>> = {
  daily: 'BOLETÍN DIARIO',
  weekly: 'BOLETÍN SEMANAL',
  monthly: 'BOLETÍN MENSUAL',
  quarterly: 'BOLETÍN TRIMESTRAL',
};

/** Barra de 10 bloques: █ lleno, ░ vacío. */
export function bar(value: number, max: number, width = 10): string {
  const filled = max > 0 ? Math.max(0, Math.min(width, Math.round((value / max) * width))) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmt(value: number, format: 'count' | 'usd'): string {
  return format === 'usd' ? `US$${value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value.toLocaleString('es-CO');
}

export function trendText(metric: Pick<PulseMetric, 'value' | 'previous' | 'higherIsBetter' | 'format'>): string {
  const d = deltaPct(metric.value, metric.previous);
  if (d === null) return `🆕 · vs. ${fmt(metric.previous, metric.format)}`;
  if (d === 0) return `➖ 0% · vs. ${fmt(metric.previous, metric.format)}`;
  const good = d > 0 === metric.higherIsBetter;
  return `${good ? '🟢' : '🔴'} ${d > 0 ? '▲ +' : '▼ '}${d}% · vs. ${fmt(metric.previous, metric.format)}`;
}

const DIVIDER = { type: 'divider' };
const section = (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } });

/** Bloques de Slack del boletín (máx. 50 bloques; cada sección es corta). */
export function renderBulletinBlocks(model: BulletinModel, appUrl: string): { text: string; blocks: Array<Record<string, unknown>> } {
  const base = appUrl.replace(/\/+$/, '');
  const blocks: Array<Record<string, unknown>> = [
    section(
      `📊 *SELLUP · ${FREQUENCY_TITLE[model.frequency]} DE TU EQUIPO*\n📅 ${model.period.label}\n👥 ${model.scopeLabel} · ${model.teamSize} ${model.teamSize === 1 ? 'persona' : 'personas'}`,
    ),
    DIVIDER,
    section(
      `🧭 *LECTURA EJECUTIVA*\n${STATUS_EMOJI[model.status]} ${STATUS_TEXT[model.status]}\n*${model.headline}*` +
        (model.mainAlert ? `\n⚠️ Principal alerta: ${model.mainAlert}` : ''),
    ),
    DIVIDER,
    section(
      '💓 *PULSO DEL PERÍODO*\n' +
        model.pulse.map((m) => `${m.emoji} ${m.label}: *${fmt(m.value, m.format)}* · ${trendText(m)}`).join('\n'),
    ),
  ];

  if (model.approvalRate.now !== null || model.approvalRate.before !== null) {
    const before = model.approvalRate.before ?? 0;
    const now = model.approvalRate.now ?? 0;
    const diff = Math.round((now - before) * 10) / 10;
    blocks.push(
      section(
        `*Tasa de aprobación* (aprobadas sobre decididas)\n` +
          `Antes \`${bar(before, 100)}\` ${model.approvalRate.before ?? '—'}%\n` +
          `Ahora \`${bar(now, 100)}\` ${model.approvalRate.now ?? '—'}%` +
          (model.approvalRate.before !== null && model.approvalRate.now !== null ? ` · ${diff >= 0 ? '▲ +' : '▼ '}${diff} pp` : ''),
      ),
    );
  }

  const funnelMax = Math.max(1, ...model.funnel.map((f) => f.value));
  blocks.push(
    DIVIDER,
    section('🔀 *EMBUDO DEL PERÍODO*\n' + model.funnel.map((f) => `\`${bar(f.value, funnelMax)}\` ${f.label} · *${f.value}*`).join('\n')),
  );

  if (model.teams.length > 0) {
    const teamMax = Math.max(1, ...model.teams.map((t) => t.approved));
    blocks.push(
      DIVIDER,
      section(
        '🧩 *POR EQUIPO*\n' +
          model.teams
            .slice(0, 8)
            .map(
              (t) =>
                `\`${bar(t.approved, teamMax)}\` *${t.name}* · ${t.people} ${t.people === 1 ? 'persona' : 'personas'} (${t.active} activas)\n` +
                `↳ ${t.approved} aprobadas · ${t.discarded} descartadas · ${t.pending} por revisar` +
                (t.oldestDays ? ` · la más antigua de ${t.oldestDays} días` : ''),
            )
            .join('\n'),
      ),
    );
  }

  if (model.behind.length > 0 || model.inactive.length > 0) {
    const lines = model.behind.map(
      (p) => `${(p.oldestDays ?? 0) > 7 ? '🔴' : '🟠'} *${p.name}* · ${p.pending} por revisar${p.oldestDays ? ` · la más antigua de ${p.oldestDays} días` : ''}`,
    );
    if (model.inactive.length) lines.push(`⚪ Sin actividad: ${model.inactive.slice(0, 8).join(', ')}${model.inactive.length > 8 ? '…' : ''}`);
    blocks.push(DIVIDER, section('⚠️ *A QUIÉN ACOMPAÑAR*\n' + lines.join('\n')));
  }

  blocks.push(
    DIVIDER,
    section(`✅ *CIERRE*\n${model.closing}`),
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Ver por revisar' }, url: `${base}/accounts?tab=prospectos`, action_id: 'sellup_bulletin_review' },
        { type: 'button', text: { type: 'plain_text', text: 'Ver uso del equipo' }, url: `${base}/ai-usage?tab=equipo`, action_id: 'sellup_bulletin_usage' },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Boletín de SellUp · cámbialo en Configuración › Avisos de Slack' }] },
  );

  return {
    text: `${FREQUENCY_TITLE[model.frequency]} de SellUp · ${model.period.label}: ${model.headline}`,
    blocks,
  };
}
