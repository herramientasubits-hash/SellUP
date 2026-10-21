/**
 * Agente 3 · lo que funcionó (puro, sin red ni base).
 *
 * Cada «La usé» guarda qué versión (enfoque) se usó, por qué canal, en qué país y qué
 * pasó. Con eso:
 *   - el tablero de resultados (Uso de IA → Por agente → Rumbo) cuenta por enfoque, canal
 *     y país;
 *   - el redactor, cuando el vendedor deja que el agente elija, recomienda el enfoque que
 *     más respuestas positivas consiguió en ese país y canal (con un mínimo de usos, para
 *     no aprender de la suerte). Las reglas fijas del manual (Perú, sin decisor, evento
 *     sin noticia) no las cambia lo aprendido.
 */

import { APPROACH_DEFINITIONS, FIRST_CONTACT_APPROACHES, FIRST_CONTACT_OUTCOMES, type FirstContactApproach, type FirstContactOutcome } from './approaches';
import { FIRST_CALL_CHANNEL_LABELS, FIRST_CALL_CHANNELS, type FirstCallChannel } from './types';

/** Una preparación tal como la leen el tablero y el redactor. */
export interface ApproachResultRow {
  channel: FirstCallChannel;
  countryCode: string | null;
  /** El enfoque de la versión principal (el que propuso el agente). */
  mainApproach: FirstContactApproach | null;
  status: string;
  /** El enfoque de la versión que usó el vendedor (si dijo cuál). */
  usedApproach: FirstContactApproach | null;
  outcome: FirstContactOutcome | null;
}

/** Usos con resultado de un enfoque antes de creerle (menos es suerte). */
export const PROVEN_MIN_USES = 5;
/** Respuestas positivas mínimas para recomendarlo. */
export const PROVEN_MIN_POSITIVES = 2;
/** Cuánto atrás se mira para aprender. */
export const APPROACH_RESULTS_LOOKBACK_DAYS = 365;

/** Reunión o interés: el primer contacto abrió la conversación. */
export function isPositiveOutcome(outcome: FirstContactOutcome): boolean {
  return outcome === 'meeting_booked' || outcome === 'interested';
}

function asApproach(value: unknown): FirstContactApproach | null {
  return typeof value === 'string' && (FIRST_CONTACT_APPROACHES as readonly string[]).includes(value) ? (value as FirstContactApproach) : null;
}

function asOutcome(value: unknown): FirstContactOutcome | null {
  return typeof value === 'string' && (FIRST_CONTACT_OUTCOMES as readonly string[]).includes(value) ? (value as FirstContactOutcome) : null;
}

/**
 * Una fila de `first_call_packs` (con `approach` = pack->>approach, `outcome` =
 * pack->outcome y el país de la empresa). `null` si el canal no es conocido.
 */
export function mapApproachResultRow(row: Record<string, unknown>): ApproachResultRow | null {
  const channel = row.channel;
  if (typeof channel !== 'string' || !(FIRST_CALL_CHANNELS as readonly string[]).includes(channel)) return null;
  const outcome = row.outcome && typeof row.outcome === 'object' ? (row.outcome as Record<string, unknown>) : null;
  const account = (Array.isArray(row.accounts) ? row.accounts[0] : row.accounts) as { country_code?: unknown } | null | undefined;
  const mainApproach = asApproach(row.approach);
  const result = asOutcome(outcome?.result);
  return {
    channel: channel as FirstCallChannel,
    countryCode: typeof account?.country_code === 'string' ? account.country_code.toUpperCase() : null,
    mainApproach,
    status: typeof row.status === 'string' ? row.status : 'draft',
    // Las preparaciones de antes de guardar la versión usada: se usó la principal.
    usedApproach: result ? asApproach(outcome?.approach) ?? mainApproach : null,
    outcome: result,
  };
}

/** Lo que el tablero muestra de un grupo (un enfoque, un canal o un país). */
export interface ApproachResultStats {
  /** Preparaciones que se pudieron usar (no fallidas). */
  prepared: number;
  used: number;
  /** Usadas con resultado. */
  withOutcome: number;
  outcomes: Record<FirstContactOutcome, number>;
  /** Reunión o interés sobre los resultados que dicen algo del enfoque (sin «No es la persona»). */
  positiveRate: number | null;
}

function emptyOutcomes(): Record<FirstContactOutcome, number> {
  return Object.fromEntries(FIRST_CONTACT_OUTCOMES.map((o) => [o, 0])) as Record<FirstContactOutcome, number>;
}

/** «No es la persona» habla de a quién se llamó, no de cómo: no cuenta para el enfoque. */
function judged(outcomes: Record<FirstContactOutcome, number>): number {
  return FIRST_CONTACT_OUTCOMES.filter((o) => o !== 'wrong_person').reduce((sum, o) => sum + outcomes[o], 0);
}

function positives(outcomes: Record<FirstContactOutcome, number>): number {
  return outcomes.meeting_booked + outcomes.interested;
}

function statsOf(rows: readonly ApproachResultRow[]): ApproachResultStats {
  const outcomes = emptyOutcomes();
  let prepared = 0;
  let used = 0;
  for (const row of rows) {
    if (row.status !== 'failed') prepared += 1;
    if (row.status === 'used' || row.outcome) used += 1;
    if (row.outcome) outcomes[row.outcome] += 1;
  }
  const withOutcome = Object.values(outcomes).reduce((a, b) => a + b, 0);
  const base = judged(outcomes);
  return { prepared, used, withOutcome, outcomes, positiveRate: base > 0 ? positives(outcomes) / base : null };
}

export interface ApproachResultGroup<K extends string> {
  key: K;
  label: string;
  stats: ApproachResultStats;
}

export interface ApproachResultsDashboard {
  total: ApproachResultStats;
  byApproach: ApproachResultGroup<FirstContactApproach>[];
  byChannel: ApproachResultGroup<FirstCallChannel>[];
  byCountry: ApproachResultGroup<string>[];
}

const CHANNEL_LABELS = FIRST_CALL_CHANNEL_LABELS;

function sortGroups<K extends string>(groups: ApproachResultGroup<K>[]): ApproachResultGroup<K>[] {
  // Primero lo que más se usó; a igual uso, lo que más preparó el agente.
  return groups.sort((a, b) => b.stats.withOutcome - a.stats.withOutcome || b.stats.prepared - a.stats.prepared || a.label.localeCompare(b.label));
}

/**
 * El tablero: totales y cortes por enfoque (el de la versión USADA; si aún no se usó,
 * el de la principal, para ver cuánto se prepara de cada uno), canal y país.
 */
export function buildApproachResultsDashboard(rows: readonly ApproachResultRow[], countryLabel: (code: string) => string = (c) => c): ApproachResultsDashboard {
  const group = <K extends string>(keyOf: (row: ApproachResultRow) => K | null, labelOf: (key: K) => string): ApproachResultGroup<K>[] => {
    const buckets = new Map<K, ApproachResultRow[]>();
    for (const row of rows) {
      const key = keyOf(row);
      if (key === null) continue;
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return sortGroups([...buckets].map(([key, list]) => ({ key, label: labelOf(key), stats: statsOf(list) })));
  };
  return {
    total: statsOf(rows),
    byApproach: group((row) => row.usedApproach ?? row.mainApproach, (key) => APPROACH_DEFINITIONS[key].label),
    byChannel: group((row) => row.channel, (key) => CHANNEL_LABELS[key]),
    byCountry: group((row) => row.countryCode ?? 'sin_pais', (key) => (key === 'sin_pais' ? 'Sin país' : countryLabel(key))),
  };
}

/** El enfoque que más funcionó, con lo que lo respalda (va al redactor y al registro de uso). */
export interface ProvenApproach {
  approach: FirstContactApproach;
  uses: number;
  positives: number;
  /** «country» = ese país y ese canal; «region» = ese canal en todos los países. */
  scope: 'country' | 'region';
}

function tally(rows: readonly ApproachResultRow[]): Map<FirstContactApproach, { uses: number; positives: number }> {
  const out = new Map<FirstContactApproach, { uses: number; positives: number }>();
  for (const row of rows) {
    if (!row.outcome || !row.usedApproach || row.outcome === 'wrong_person') continue;
    const current = out.get(row.usedApproach) ?? { uses: 0, positives: 0 };
    out.set(row.usedApproach, { uses: current.uses + 1, positives: current.positives + (isPositiveOutcome(row.outcome) ? 1 : 0) });
  }
  return out;
}

function bestIn(
  rows: readonly ApproachResultRow[],
  candidates: readonly FirstContactApproach[],
  manual: FirstContactApproach,
): { approach: FirstContactApproach; uses: number; positives: number } | null {
  const counts = tally(rows);
  const rate = (c: { uses: number; positives: number }) => c.positives / c.uses;
  const qualified = candidates
    .map((approach) => ({ approach, ...(counts.get(approach) ?? { uses: 0, positives: 0 }) }))
    .filter((c) => c.uses >= PROVEN_MIN_USES && c.positives >= PROVEN_MIN_POSITIVES)
    .sort((a, b) => rate(b) - rate(a) || b.uses - a.uses);
  const best = qualified[0];
  if (!best) return null;
  // Lo del manual se cambia sólo si lo aprendido le gana (con datos suficientes del manual).
  const manualCounts = counts.get(manual);
  if (manualCounts && manualCounts.uses >= PROVEN_MIN_USES && rate(manualCounts) >= rate(best)) return null;
  return best.approach === manual ? null : best;
}

/**
 * El enfoque que conviene recomendar según lo que funcionó, o `null` (se queda el del
 * manual). Primero en ese país y canal; si ahí no hay datos suficientes, en ese canal en
 * todos los países. `candidates` son los enfoques que aplican hoy (los demás no se miran).
 */
export function pickProvenApproach(input: {
  rows: readonly ApproachResultRow[];
  countryCode: string | null;
  channel: FirstCallChannel;
  candidates: readonly FirstContactApproach[];
  manual: FirstContactApproach;
}): ProvenApproach | null {
  const sameChannel = input.rows.filter((r) => r.channel === input.channel);
  const country = input.countryCode?.toUpperCase() ?? null;
  if (country) {
    const local = bestIn(sameChannel.filter((r) => r.countryCode === country), input.candidates, input.manual);
    if (local) return { ...local, scope: 'country' };
  }
  const region = bestIn(sameChannel, input.candidates, input.manual);
  return region ? { ...region, scope: 'region' } : null;
}

/** La línea para el redactor: qué funcionó y con cuántos usos (sin nombres de empresas). */
export function provenApproachNote(proven: ProvenApproach, channel: FirstCallChannel, countryName: string | null): string {
  const where = proven.scope === 'country' && countryName ? `en ${countryName}` : 'en todos los países';
  return `Lo que más funcionó ${where} por ${CHANNEL_LABELS[channel].toLowerCase()}: «${APPROACH_DEFINITIONS[proven.approach].label}» abrió la conversación (reunión o interés) en ${proven.positives} de ${proven.uses} contactos que el equipo marcó con resultado.`;
}
