// ============================================================
// Asistente de Slack — acciones con confirmación (puro).
// Claude NUNCA ejecuta: propone. La propuesta viaja en el botón «Confirmar» del
// mensaje y vuelve en la interacción firmada por Slack. Al confirmar se
// comprueba que quien pulsa es quien pidió, que no venció y se ejecuta con la
// sesión de esa persona (mismas acciones y permisos que la pantalla).
// ============================================================

import { DISCARD_REASONS, type DiscardReasonKey } from '@/modules/prospect-batches/types';

export type ActionKind = 'approve' | 'discard' | 'assign_prospects' | 'assign_accounts';

/** Tope por confirmación: cabe en el botón y es una selección razonable. */
export const MAX_ACTION_ITEMS = 25;
/** La propuesta vence: confirmar algo de hace horas no es una decisión actual. */
export const ACTION_TTL_SECONDS = 30 * 60;
export const CONFIRM_ACTION_ID = 'sellup_action_confirm';
export const CANCEL_ACTION_ID = 'sellup_action_cancel';
/** Slack admite hasta 2.000 caracteres en `value`. */
const MAX_VALUE_CHARS = 2000;

export interface ActionItem {
  id: string;
  nombre: string;
  /** Advertencias que la persona confirma al pulsar (posible duplicado, ya en HubSpot). */
  posibleDuplicado?: boolean;
  enHubSpot?: boolean;
}

export interface ActionProposal {
  kind: ActionKind;
  items: ActionItem[];
  /** internal_users.id de quien pidió (sólo esa persona puede confirmar). */
  askerId: string;
  askerSlackId: string;
  /** Asignar: a quién. */
  targetUserId?: string;
  targetName?: string;
  /** Descartar: motivo ya validado. */
  reason?: string;
  /** Vence (segundos epoch). */
  expiresAt: number;
}

/** Lo mínimo que viaja en el botón (los nombres van en el texto del mensaje). */
interface ButtonPayload {
  v: 1;
  k: ActionKind;
  ids: string[];
  /** Posiciones (en `ids`) con posible duplicado / ya en HubSpot: más cortas que repetir ids. */
  dup?: number[];
  hs?: number[];
  a: string;
  s: string;
  t?: string;
  r?: string;
  e: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ReadonlySet<string> = new Set(['approve', 'discard', 'assign_prospects', 'assign_accounts']);

export const ACTION_VERBS: Record<ActionKind, string> = {
  approve: 'Aprobar',
  discard: 'Descartar',
  assign_prospects: 'Asignar',
  assign_accounts: 'Asignar',
};

export function encodeActionValue(proposal: ActionProposal): string {
  const payload: ButtonPayload = {
    v: 1,
    k: proposal.kind,
    ids: proposal.items.map((i) => i.id),
    ...(proposal.items.some((i) => i.posibleDuplicado)
      ? { dup: proposal.items.flatMap((i, index) => (i.posibleDuplicado ? [index] : [])) }
      : {}),
    ...(proposal.items.some((i) => i.enHubSpot) ? { hs: proposal.items.flatMap((i, index) => (i.enHubSpot ? [index] : [])) } : {}),
    a: proposal.askerId,
    s: proposal.askerSlackId,
    ...(proposal.targetUserId ? { t: proposal.targetUserId } : {}),
    ...(proposal.reason ? { r: proposal.reason } : {}),
    e: proposal.expiresAt,
  };
  const value = JSON.stringify(payload);
  if (value.length > MAX_VALUE_CHARS) throw new Error('La propuesta es demasiado grande para un botón de Slack.');
  return value;
}

export interface DecodedAction {
  kind: ActionKind;
  ids: string[];
  possibleDuplicateIds: Set<string>;
  hubSpotMatchIds: Set<string>;
  askerId: string;
  askerSlackId: string;
  targetUserId: string | null;
  reason: string | null;
  expiresAt: number;
}

/** Lee el botón; `null` si no tiene la forma esperada (nunca se ejecuta algo raro). */
export function decodeActionValue(raw: unknown): DecodedAction | null {
  if (typeof raw !== 'string' || raw.length > MAX_VALUE_CHARS) return null;
  let p: Partial<ButtonPayload>;
  try {
    p = JSON.parse(raw) as Partial<ButtonPayload>;
  } catch {
    return null;
  }
  const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && UUID_PATTERN.test(x));
  if (p.v !== 1 || typeof p.k !== 'string' || !KINDS.has(p.k)) return null;
  if (!isIds(p.ids) || p.ids.length === 0 || p.ids.length > MAX_ACTION_ITEMS) return null;
  if (typeof p.a !== 'string' || !UUID_PATTERN.test(p.a) || typeof p.s !== 'string' || !p.s) return null;
  if (typeof p.e !== 'number' || !Number.isFinite(p.e)) return null;
  const ids = p.ids;
  const isPositions = (v: unknown): v is number[] =>
    Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 0 && x < ids.length);
  if (p.dup !== undefined && !isPositions(p.dup)) return null;
  if (p.hs !== undefined && !isPositions(p.hs)) return null;
  const kind = p.k as ActionKind;
  if ((kind === 'assign_prospects' || kind === 'assign_accounts') && (typeof p.t !== 'string' || !UUID_PATTERN.test(p.t))) return null;
  if (kind === 'discard' && (typeof p.r !== 'string' || p.r.trim().length < 3)) return null;
  return {
    kind,
    ids: [...new Set(ids)],
    possibleDuplicateIds: new Set((p.dup ?? []).map((index) => ids[index])),
    hubSpotMatchIds: new Set((p.hs ?? []).map((index) => ids[index])),
    askerId: p.a,
    askerSlackId: p.s,
    targetUserId: p.t ?? null,
    reason: p.r ?? null,
    expiresAt: p.e,
  };
}

/** ¿Puede esta persona confirmar ahora? */
export function confirmationProblem(action: DecodedAction, clickerSlackId: string, nowSeconds: number): string | null {
  if (clickerSlackId !== action.askerSlackId) return 'Sólo quien pidió la acción puede confirmarla.';
  if (nowSeconds > action.expiresAt) return 'Esta propuesta venció (30 minutos). Pídemela de nuevo.';
  return null;
}

export function discardReasonLabel(key: string | undefined): string | null {
  return DISCARD_REASONS.find((r) => r.value === key)?.label ?? null;
}

export const DISCARD_REASON_KEYS = DISCARD_REASONS.map((r) => r.value) as DiscardReasonKey[];

function itemLine(item: ActionItem): string {
  const notes = [item.posibleDuplicado ? 'posible duplicado' : null, item.enHubSpot ? 'ya está en HubSpot' : null].filter(Boolean);
  return `• ${item.nombre}${notes.length ? ` _(${notes.join(', ')})_` : ''}`;
}

/** El texto de la propuesta (lo que la persona confirma). */
export function proposalSummary(proposal: Pick<ActionProposal, 'kind' | 'items' | 'targetName' | 'reason'>): string {
  const n = proposal.items.length;
  const plural = n === 1 ? '' : 's';
  const head =
    proposal.kind === 'approve'
      ? `*Aprobar ${n} prospecto${plural}*: cada uno pasa a Empresas y se crea o enlaza en HubSpot.`
      : proposal.kind === 'discard'
        ? `*Descartar ${n} prospecto${plural}* con el motivo «${proposal.reason ?? ''}».`
        : proposal.kind === 'assign_prospects'
          ? `*Asignar ${n} prospecto${plural} a ${proposal.targetName ?? ''}*.`
          : `*Asignar ${n} empresa${plural} a ${proposal.targetName ?? ''}*.`;
  const warn = proposal.items.some((i) => i.posibleDuplicado || i.enHubSpot)
    ? '\nAl confirmar, confirmas también las advertencias marcadas.'
    : '';
  return `${head}\n${proposal.items.map(itemLine).join('\n')}${warn}`;
}

/** El mensaje con los botones Confirmar / Cancelar. */
export function proposalBlocks(proposal: ActionProposal): { text: string; blocks: Array<Record<string, unknown>> } {
  const summary = proposalSummary(proposal);
  const value = encodeActionValue(proposal);
  return {
    text: summary.replace(/[*_]/g, ''),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: summary } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            style: proposal.kind === 'discard' ? 'danger' : 'primary',
            text: { type: 'plain_text', text: `${ACTION_VERBS[proposal.kind]} (${proposal.items.length})` },
            action_id: CONFIRM_ACTION_ID,
            value,
          },
          { type: 'button', text: { type: 'plain_text', text: 'Cancelar' }, action_id: CANCEL_ACTION_ID, value: 'cancel' },
        ],
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Vence en 30 minutos. Sólo tú puedes confirmarla.' }] },
    ],
  };
}

export type ItemOutcome = { nombre: string; ok: boolean; detalle: string };

/** El resultado final, en el lugar del mensaje con botones. */
export function outcomeText(kind: ActionKind, outcomes: readonly ItemOutcome[], extra?: string): string {
  const ok = outcomes.filter((o) => o.ok);
  const failed = outcomes.filter((o) => !o.ok);
  const verb = kind === 'approve' ? 'Aprobados' : kind === 'discard' ? 'Descartados' : 'Asignados';
  const lines = [`*${verb}: ${ok.length} de ${outcomes.length}.*`];
  for (const o of ok) lines.push(`✓ ${o.nombre}${o.detalle ? ` — ${o.detalle}` : ''}`);
  for (const o of failed) lines.push(`✗ ${o.nombre} — ${o.detalle}`);
  if (extra) lines.push(extra);
  return lines.join('\n');
}
