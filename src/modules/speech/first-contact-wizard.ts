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
import {
  APPROACH_DEFINITIONS,
  FIRST_CONTACT_APPROACHES,
  MAX_APPROACHES,
  RECOMMENDED_APPROACH,
  isApproachAvailable,
  type FirstContactApproach,
} from '@/server/agents/first-call/approaches';

export type FirstContactStepId = 'decisores' | 'canales' | 'objetivo' | 'enfoque' | 'productos' | 'resumen';

export const FIRST_CONTACT_STEPS: ReadonlyArray<{ id: FirstContactStepId; label: string }> = [
  { id: 'decisores', label: 'Decisores' },
  { id: 'canales', label: 'Canales' },
  { id: 'objetivo', label: 'Objetivo' },
  { id: 'enfoque', label: 'Enfoque' },
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
  /** Enfoques para abrir (hasta 3); vacío = el que recomiende el agente. */
  approaches: FirstContactApproach[];
  /** Quién refirió el contacto (sólo con «Por referencia»). */
  referralNote: string | null;
}

export const DEFAULT_SELECTION: FirstContactSelection = {
  contactIds: [],
  channels: ['call'],
  goals: ['book_meeting'],
  approaches: [],
  referralNote: null,
  productKeys: [],
};

export interface WizardOption {
  value: string;
  label: string;
  description?: string;
  hint?: string;
  unavailable?: boolean;
}

/** Enfoques: primero «Todos» (una versión de cada uno); los que aún no se pueden ofrecer, apagados. */
export function approachOptions(): WizardOption[] {
  return [
    { value: RECOMMENDED_APPROACH, label: 'Todos: una versión de cada uno', description: 'El agente marca el que recomienda según el cargo, la noticia y el país; tú eliges cuál usar.' },
    ...FIRST_CONTACT_APPROACHES.map((a) => {
      const def = APPROACH_DEFINITIONS[a];
      return def.unavailableReason
        ? { value: a, label: def.label, description: def.unavailableReason, hint: 'Próximamente', unavailable: true }
        : { value: a, label: def.label, description: def.bestFor };
    }),
  ];
}

/** «Todos» excluye a los demás; elegidos a mano, tope de 3 enfoques. */
export function normalizeApproachSelection(previous: readonly string[], next: readonly string[]): string[] {
  return normalizeExclusiveSelection(
    previous,
    next.filter((v) => v === RECOMMENDED_APPROACH || isApproachAvailable(v as FirstContactApproach)),
    RECOMMENDED_APPROACH,
    MAX_APPROACHES,
  );
}

/** Lo marcado en «Enfoque» → enfoques (vacío = el que recomiende el agente). */
export function approachesFrom(marked: readonly string[]): FirstContactApproach[] {
  return marked.filter((v): v is FirstContactApproach => v !== RECOMMENDED_APPROACH);
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
export function estimatedDuration(
  selection: Pick<FirstContactSelection, 'contactIds'> & Partial<Pick<FirstContactSelection, 'approaches'>>,
  willResearch: boolean,
): string {
  const writerRounds = Math.ceil(Math.max(1, selection.contactIds.length) / 2);
  // «Todos» escribe hasta seis versiones de cada mensaje: tarda más (Grupo Ciisa, 1 enfoque: 50 s).
  const perRound = (selection.approaches?.length ?? 0) === 0 ? 75 : 25 + 15 * ((selection.approaches?.length ?? 1) - 1);
  const seconds = (willResearch ? 70 : 0) + writerRounds * perRound;
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
  const approaches =
    selection.approaches.length > 0
      ? listInSpanish(selection.approaches.map((a) => APPROACH_DEFINITIONS[a].label.toLowerCase()))
      : 'todos los que apliquen, una versión de cada uno (el agente marca el que recomienda)';
  return [
    willResearch
      ? 'Primero investigo la empresa: sitio oficial, noticias del último año y lo que ya saben SellUp y HubSpot.'
      : 'Uso la investigación vigente de la empresa (no se paga otra).',
    `Luego preparo ${total === 1 ? 'una preparación' : `${total} preparaciones`}: ${who}, por ${channels}.`,
    `${selection.goals.length > 1 ? 'Objetivos' : 'Objetivo'}: ${listInSpanish(orderGoals(selection.goals).map((g) => FIRST_CALL_GOAL_LABELS[g].toLowerCase()))}. ${selection.approaches.length === 1 ? 'Enfoque' : 'Enfoques'}: ${approaches}${selection.approaches.length > 1 ? ' (una versión de cada uno)' : ''}. Productos: ${products}.`,
    'Cada preparación trae cómo pedir la reunión, qué hacer si dice que no y el mensaje para confirmarla.',
    `Tarda ${estimatedDuration(selection, willResearch)}.`,
  ].join('\n\n');
}

/**
 * El aviso al terminar (como el «¡Objetivo alcanzado!» del Agente 1): confirma
 * que hizo lo que se pidió — cuántas preparaciones, para quién y por dónde — y
 * cuántas tienen avisos o no se pudieron escribir.
 */
export function firstContactDoneToast(
  packStatuses: readonly string[],
  selection: FirstContactSelection,
  contacts: readonly FirstCallContactOption[],
): { tone: 'success' | 'warning'; title: string; description: string } {
  const total = packStatuses.length;
  const failed = packStatuses.filter((s) => s === 'failed').length;
  const toReview = packStatuses.filter((s) => s === 'needs_review').length;
  const usable = total - failed;
  const names = selection.contactIds
    .map((id) => contacts.find((c) => c.id === id)?.name)
    .filter((n): n is string => !!n);
  const who = names.length > 0 ? ` para ${listInSpanish(names)}` : '';
  const channels = listInSpanish(selection.channels.map((c) => FIRST_CALL_CHANNEL_LABELS[c]));
  const count = usable === 0 ? 'Ninguna preparación' : usable === 1 ? 'Una preparación' : `${usable} preparaciones`;
  const parts = [`${count}${who} por ${channels}.`];
  if (toReview > 0) parts.push(toReview === 1 ? 'Una tiene avisos para revisar antes de usarla.' : `${toReview} tienen avisos para revisar antes de usarlas.`);
  else if (usable > 0) parts.push(usable === 1 ? 'Lista para usar.' : 'Listas para usar.');
  if (failed > 0) parts.push(failed === 1 ? 'Una no se pudo escribir: rehazla desde la tarjeta.' : `${failed} no se pudieron escribir: rehazlas desde su tarjeta.`);
  return {
    tone: failed > 0 ? 'warning' : 'success',
    title: failed === 0 ? '¡Primer contacto listo!' : 'Primer contacto preparado a medias',
    description: parts.join(' '),
  };
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
    approaches: params.selection.approaches,
    referralNote: params.selection.approaches.includes('referral') ? params.selection.referralNote?.trim() || null : null,
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
  /** Por canal: la preparación más reciente que cuenta (con su resultado, si se marcó), o `null` si falta. */
  cells: Record<FirstCallChannel, (Pick<FirstCallPack, 'id' | 'status' | 'createdAt'> & { outcome?: FirstCallPack['outcome'] }) | null>;
}

/**
 * Filas de la cobertura: los decisores elegibles y los que ya tienen preparaciones
 * (aunque hoy no estén activos), más «sin decisor» si se preparó algo así.
 */
export function buildCoverage(
  packs: ReadonlyArray<
    Pick<FirstCallPack, 'id' | 'status' | 'createdAt' | 'contactId' | 'targetName' | 'targetTitle' | 'channel'> & {
      outcome?: FirstCallPack['outcome'];
    }
  >,
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
    if (!row.cells[pack.channel]) {
      row.cells[pack.channel] = { id: pack.id, status: pack.status, createdAt: pack.createdAt, outcome: pack.outcome ?? null };
    }
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
