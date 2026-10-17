/**
 * Agente 3 · Primer contacto — el asistente que arma el pedido (puro).
 *
 * Los pasos del panel «Agente IA» (decisores, canales, objetivo, productos y
 * resumen), sus opciones, el pedido que va a la API y la cobertura: qué decisor ×
 * canal ya tiene preparación y qué falta, para preparar «lo que falta» u otra
 * versión de algo que ya se hizo.
 */

import {
  FIRST_CALL_CHANNELS,
  FIRST_CALL_CHANNEL_LABELS,
  FIRST_CALL_GOALS,
  FIRST_CALL_GOAL_LABELS,
  MAX_CONTACTS_PER_RUN,
  orderGoals,
  type FirstCallChannel,
  type FirstCallGoal,
  type FirstCallPack,
} from '@/server/agents/first-call/types';
import { UBITS_PRODUCTS, UBITS_PRODUCT_FAMILY_LABELS, ubitsProductName } from '@/server/agents/first-call/ubits-messaging-library';
import type { FirstCallContactOption } from './first-call-contacts';

export type FirstContactStepId = 'decisores' | 'canales' | 'objetivo' | 'productos' | 'resumen';

export const FIRST_CONTACT_STEPS: ReadonlyArray<{ id: FirstContactStepId; label: string }> = [
  { id: 'decisores', label: 'Decisores' },
  { id: 'canales', label: 'Canales' },
  { id: 'objetivo', label: 'Objetivo' },
  { id: 'productos', label: 'Productos' },
  { id: 'resumen', label: 'Resumen' },
];

/** Opción «sin decisor»: el guion pide averiguar quién decide. Excluye a las demás. */
export const NO_DECISION_MAKER = '__sin_decisor__';

/** Opción «El que mejor conecte» en la lista de productos. Excluye a las demás. */
export const BEST_PRODUCT = '__mejor_producto__';

export interface FirstContactSelection {
  /** Vacío = sin decisor. */
  contactIds: string[];
  channels: FirstCallChannel[];
  /** Uno o varios, en el orden de la conversación. */
  goals: FirstCallGoal[];
  /** Vacío = el que mejor conecte. */
  productKeys: string[];
}

export const DEFAULT_SELECTION: FirstContactSelection = {
  contactIds: [],
  channels: ['call'],
  goals: ['book_meeting'],
  productKeys: [],
};

export interface WizardOption {
  value: string;
  label: string;
  description?: string;
}

const CHANNEL_DESCRIPTIONS: Readonly<Record<FirstCallChannel, string>> = {
  call: 'Guion de 45 a 60 segundos y el mensaje para dejar si no contesta.',
  whatsapp: 'Mensaje de 2 a 4 líneas.',
  email: 'Asunto y un cuerpo breve.',
  linkedin: 'Nota de conexión de menos de 300 caracteres.',
};

const GOAL_DESCRIPTIONS: Readonly<Record<FirstCallGoal, string>> = {
  book_meeting: 'Cerrar con una reunión de 20 minutos.',
  open_conversation: 'Abrir el tema y dejar la puerta abierta.',
  validate_owner: 'Averiguar quién lleva la formación y el talento.',
};

export function decisionMakerOptions(contacts: readonly FirstCallContactOption[]): WizardOption[] {
  return [
    ...contacts.map((c) => ({ value: c.id, label: c.name, description: c.title ?? 'Cargo sin registrar' })),
    { value: NO_DECISION_MAKER, label: 'Sin decisor', description: 'El mensaje pide averiguar quién decide.' },
  ];
}

export function channelOptions(): WizardOption[] {
  return FIRST_CALL_CHANNELS.map((c) => ({ value: c, label: FIRST_CALL_CHANNEL_LABELS[c], description: CHANNEL_DESCRIPTIONS[c] }));
}

export function goalOptions(): WizardOption[] {
  return FIRST_CALL_GOALS.map((g) => ({ value: g, label: FIRST_CALL_GOAL_LABELS[g], description: GOAL_DESCRIPTIONS[g] }));
}

/** Productos en el orden del menú de UBITS, con su familia delante; primero «El que mejor conecte». */
export function productOptions(): WizardOption[] {
  return [
    { value: BEST_PRODUCT, label: 'El que mejor conecte', description: 'El agente elige según lo que encuentre de la empresa.' },
    ...productModuleOptions(),
  ];
}

function productModuleOptions(): WizardOption[] {
  return UBITS_PRODUCTS.map((p) => ({
    value: p.key,
    label: p.name,
    description: `${UBITS_PRODUCT_FAMILY_LABELS[p.family]} · ${p.pitch}`,
  }));
}

/**
 * Lo marcado en «Decisores» → ids. «Sin decisor» excluye a los demás: si se marcó
 * lo último, gana; si se marcó un decisor estando «Sin decisor», se quita «Sin decisor».
 */
export function normalizeDecisionMakerSelection(previous: readonly string[], next: readonly string[]): string[] {
  return normalizeExclusiveSelection(previous, next, NO_DECISION_MAKER, MAX_CONTACTS_PER_RUN);
}

/** Igual para productos: «El que mejor conecte» excluye a los demás y al revés. */
export function normalizeProductSelection(previous: readonly string[], next: readonly string[]): string[] {
  return normalizeExclusiveSelection(previous, next, BEST_PRODUCT);
}

/** Lo marcado en «Productos» → claves (vacío = el que mejor conecte). */
export function productKeysFrom(marked: readonly string[]): string[] {
  return marked.filter((v) => v !== BEST_PRODUCT);
}

/** Una opción que excluye a las demás: si se marcó al final gana; si se marca otra, se quita. */
function normalizeExclusiveSelection(previous: readonly string[], next: readonly string[], exclusive: string, max?: number): string[] {
  const added = next.filter((v) => !previous.includes(v));
  if (added.includes(exclusive)) return [exclusive];
  const rest = next.filter((v) => v !== exclusive);
  return max === undefined ? rest : rest.slice(0, max);
}

export function contactIdsFrom(marked: readonly string[]): string[] {
  return marked.filter((v) => v !== NO_DECISION_MAKER);
}

/** Cuántas preparaciones salen: una por decisor (o una sin decisor) y canal. */
export function preparationsCount(selection: Pick<FirstContactSelection, 'contactIds' | 'channels'>): number {
  return Math.max(1, selection.contactIds.length) * selection.channels.length;
}

/** Cuánto tarda, en palabras: la investigación ~1 min y cada tanda de 2 decisores ~20 s. */
export function estimatedDuration(selection: Pick<FirstContactSelection, 'contactIds'>, willResearch: boolean): string {
  const writerRounds = Math.ceil(Math.max(1, selection.contactIds.length) / 2);
  const seconds = (willResearch ? 70 : 0) + writerRounds * 25;
  if (seconds < 60) return 'menos de un minuto';
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? 'cerca de un minuto' : `unos ${minutes} minutos`;
}

function listInSpanish(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** El resumen que el agente dice antes de empezar. */
export function summaryText(
  selection: FirstContactSelection,
  contacts: readonly FirstCallContactOption[],
  willResearch: boolean,
): string {
  const names = selection.contactIds
    .map((id) => contacts.find((c) => c.id === id))
    .filter((c): c is FirstCallContactOption => c !== undefined)
    .map((c) => (c.title ? `${c.name} (${c.title})` : c.name));
  const who = names.length > 0 ? listInSpanish(names) : 'sin decisor (el mensaje pide averiguar quién decide)';
  const channels = listInSpanish(selection.channels.map((c) => FIRST_CALL_CHANNEL_LABELS[c]));
  const products =
    selection.productKeys.length > 0
      ? listInSpanish(selection.productKeys.map((k) => ubitsProductName(k) ?? k))
      : 'el que mejor conecte con lo que encuentre';
  const total = preparationsCount(selection);
  return [
    willResearch
      ? 'Primero investigo la empresa: sitio oficial, noticias del último año y lo que ya saben SellUp y HubSpot.'
      : 'Uso la investigación vigente de la empresa (no se paga otra).',
    `Luego preparo ${total === 1 ? 'una preparación' : `${total} preparaciones`}: ${who}, por ${channels}.`,
    `${selection.goals.length > 1 ? 'Objetivos' : 'Objetivo'}: ${listInSpanish(orderGoals(selection.goals).map((g) => FIRST_CALL_GOAL_LABELS[g].toLowerCase()))}. Productos: ${products}.`,
    `Tarda ${estimatedDuration(selection, willResearch)}.`,
  ].join('\n\n');
}

/** El cuerpo del POST a `/api/agent3/first-call`. */
export function buildFirstContactRequestBody(params: {
  accountId: string;
  selection: FirstContactSelection;
  refreshResearch: boolean;
  regenerateFromPackId?: string | null;
  regenerationReason?: string | null;
}) {
  return {
    accountId: params.accountId,
    contactIds: params.selection.contactIds,
    channels: params.selection.channels,
    goals: orderGoals(params.selection.goals),
    productKeys: params.selection.productKeys,
    refreshResearch: params.refreshResearch,
    regenerateFromPackId: params.regenerateFromPackId ?? null,
    regenerationReason: params.regenerationReason?.trim() || null,
  };
}

// ── Cobertura: qué decisor × canal ya está preparado ─────────────────────────

/** Una preparación «cuenta» si se puede usar o ya se usó (no descartada ni fallida). */
function counts(pack: Pick<FirstCallPack, 'status'>): boolean {
  return pack.status === 'draft' || pack.status === 'needs_review' || pack.status === 'used';
}

export interface CoverageRow {
  /** `null` = sin decisor. */
  contactId: string | null;
  name: string;
  title: string | null;
  /** Por canal: la preparación más reciente que cuenta, o `null` si falta. */
  cells: Record<FirstCallChannel, Pick<FirstCallPack, 'id' | 'status' | 'createdAt'> | null>;
}

/**
 * Filas de la cobertura: los decisores elegibles y los que ya tienen preparaciones
 * (aunque hoy no estén activos), más «sin decisor» si se preparó algo así.
 */
export function buildCoverage(
  packs: ReadonlyArray<Pick<FirstCallPack, 'id' | 'status' | 'createdAt' | 'contactId' | 'targetName' | 'targetTitle' | 'channel'>>,
  contacts: readonly FirstCallContactOption[],
): CoverageRow[] {
  const rows = new Map<string, CoverageRow>();
  const emptyCells = () =>
    Object.fromEntries(FIRST_CALL_CHANNELS.map((c) => [c, null])) as CoverageRow['cells'];
  for (const c of contacts) rows.set(c.id, { contactId: c.id, name: c.name, title: c.title, cells: emptyCells() });
  const newestFirst = [...packs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const pack of newestFirst) {
    if (!counts(pack)) continue;
    const key = pack.contactId ?? NO_DECISION_MAKER;
    if (!rows.has(key)) {
      rows.set(key, {
        contactId: pack.contactId,
        name: pack.contactId ? pack.targetName ?? 'Contacto' : 'Sin decisor',
        title: pack.contactId ? pack.targetTitle : null,
        cells: emptyCells(),
      });
    }
    const row = rows.get(key)!;
    if (!row.cells[pack.channel]) row.cells[pack.channel] = { id: pack.id, status: pack.status, createdAt: pack.createdAt };
  }
  return [...rows.values()];
}

/**
 * «Preparar lo que falta»: los decisores con algún canal sin preparar y los canales
 * que les faltan (la unión). `null` si no falta nada o no hay decisores.
 */
export function missingSelection(coverage: readonly CoverageRow[], channels: readonly FirstCallChannel[] = FIRST_CALL_CHANNELS): Pick<
  FirstContactSelection,
  'contactIds' | 'channels'
> | null {
  const withGaps = coverage.filter((row) => row.contactId !== null && channels.some((c) => row.cells[c] === null));
  if (withGaps.length === 0) return null;
  const missingChannels = channels.filter((c) => withGaps.some((row) => row.cells[c] === null));
  return {
    contactIds: withGaps.slice(0, MAX_CONTACTS_PER_RUN).map((row) => row.contactId!),
    channels: missingChannels,
  };
}
