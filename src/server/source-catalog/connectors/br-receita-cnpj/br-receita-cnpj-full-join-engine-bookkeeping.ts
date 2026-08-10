/**
 * BR Receita CNPJ — STREAMING FULL-JOIN ENGINE BOOKKEEPING (BR-SOURCE-14B.0D § 5, § 11).
 *
 * The engine's non-I/O accounting: its counters, its input validation, and — the interesting one — the
 * schedule that decides how often a long pass re-checks the resource envelope.
 *
 * ── Why the re-check interval WIDENS ────────────────────────────────────────────
 * 14B.0C's enforcer appends to a `checkpointsEvaluated` list on every `checkpoint()` call. That is
 * exactly right for a run with seven named instants, and exactly wrong for a loop that wants to
 * re-check time every few thousand rows: a FIXED interval over 60 million rows would append tens of
 * thousands of entries, so peak memory would grow with the dataset — in the module whose entire
 * purpose is to prevent that. Not checking at all is worse: `maxRuntimeMs` would then be enforced only
 * at phase boundaries, and a pass that overran would not be stopped until it finished overrunning.
 *
 * So the interval starts small and multiplies once a fixed budget of re-checks has been spent at it.
 * Total re-checks are O(log rows) — a handful for a fixture, a few hundred for a real family — and the
 * loop never stops re-checking. The pacing is deliberately in its own function so the arithmetic can
 * be tested directly rather than inferred from a run.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - performs I/O, samples the clock, or samples memory. It counts, and it says WHEN to ask.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - reads an environment variable, or writes to stdout or stderr.
 */

import type { BrazilReceitaFullJoinSourceFileDescriptor } from './br-receita-cnpj-full-join-engine-contract';

// ─── Periodic re-check schedule ───────────────────────────────────────────────

/** The first periodic re-check interval, in rows. */
export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_FIRST_CHECKPOINT_ROWS = 4_096 as const;

/** How many re-checks are spent at one interval before the interval widens. */
export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_CHECKPOINTS_PER_INTERVAL = 64 as const;

/** The factor the interval widens by. Keeps the total re-check count logarithmic in the row count. */
export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_CHECKPOINT_INTERVAL_GROWTH = 4 as const;

/**
 * Returns a predicate that answers "is a re-check due at this row count?".
 *
 * Stateful by design: one schedule per pass, so the two reference passes do not share a budget and a
 * long Estabelecimentos pass is not starved by a short Empresas one.
 */
export function createBrazilReceitaFullJoinPeriodicCheckpointSchedule(): (
  rowsSoFar: number,
) => boolean {
  let interval: number = BRAZIL_RECEITA_FULL_JOIN_ENGINE_FIRST_CHECKPOINT_ROWS;
  let spentAtInterval = 0;
  let nextAt = interval;
  return (rowsSoFar: number): boolean => {
    if (rowsSoFar < nextAt) return false;
    spentAtInterval += 1;
    if (spentAtInterval >= BRAZIL_RECEITA_FULL_JOIN_ENGINE_CHECKPOINTS_PER_INTERVAL) {
      interval *= BRAZIL_RECEITA_FULL_JOIN_ENGINE_CHECKPOINT_INTERVAL_GROWTH;
      spentAtInterval = 0;
    }
    nextAt = rowsSoFar + interval;
    return true;
  };
}

// ─── Tallies ──────────────────────────────────────────────────────────────────

/**
 * The engine's mutable counters for ONE attempt.
 *
 * Counts only — there is no field here that could hold a key, a row, a path or a reference, so the
 * accounting cannot become a place where dataset content accumulates. The fields the repartition path
 * resets are the ones that describe a DISCARDED pass; see `resetBrazilReceitaFullJoinPassTallies`.
 */
export interface BrazilReceitaFullJoinEngineTallies {
  empresaRows: number;
  estabelecimentoRows: number;
  references: number;
  matches: number;
  orphans: number;
  companiesWithoutEstablishment: number;
  invalidKeys: number;
  malformedRows: number;
  duplicateKeys: number;
  peakKeyWindow: number;
  largestPartition: number;
  filesToEof: number;
}

export function emptyBrazilReceitaFullJoinEngineTallies(): BrazilReceitaFullJoinEngineTallies {
  return {
    empresaRows: 0,
    estabelecimentoRows: 0,
    references: 0,
    matches: 0,
    orphans: 0,
    companiesWithoutEstablishment: 0,
    invalidKeys: 0,
    malformedRows: 0,
    duplicateKeys: 0,
    peakKeyWindow: 0,
    largestPartition: 0,
    filesToEof: 0,
  };
}

/**
 * Clears the counters that describe a reference pass that is being REDONE at a finer partition map.
 *
 * Only those. `matches`, `orphans`, `companiesWithoutEstablishment` and `duplicateKeys` are join-stage
 * figures and are necessarily still zero here — a repartition may only happen before any match is
 * emitted — so touching them would suggest a rollback that never has to occur.
 */
export function resetBrazilReceitaFullJoinPassTallies(
  tallies: BrazilReceitaFullJoinEngineTallies,
): void {
  tallies.empresaRows = 0;
  tallies.estabelecimentoRows = 0;
  tallies.references = 0;
  tallies.invalidKeys = 0;
  tallies.malformedRows = 0;
  tallies.largestPartition = 0;
  tallies.filesToEof = 0;
}

// ─── Source descriptor validation ─────────────────────────────────────────────

/**
 * Validates the resolved input descriptors.
 *
 * The non-obvious rule is the last one: BOTH families must be declared. A "join" handed only Empresas
 * would traverse cleanly and report zero matches, and that result is indistinguishable from a real
 * dataset in which no company has an establishment. Refusing is the only way the two stay different.
 *
 * Ordinals must be unique because they are what a partition reference carries INSTEAD of a file name.
 * Two files sharing an ordinal would make a reference ambiguous, and the row it pointed at would be
 * read from whichever file happened to be found first.
 */
export function validateBrazilReceitaFullJoinSourceDescriptors(
  sources: readonly BrazilReceitaFullJoinSourceFileDescriptor[] | null | undefined,
): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  const ordinals = new Set<number>();
  let empresas = 0;
  let estabelecimentos = 0;
  for (const source of sources) {
    if (typeof source?.filePath !== 'string' || source.filePath.length === 0) return false;
    if (source.family !== 'empresas' && source.family !== 'estabelecimentos') return false;
    if (!Number.isInteger(source.sourceFileOrdinal) || source.sourceFileOrdinal < 0) return false;
    if (ordinals.has(source.sourceFileOrdinal)) return false;
    ordinals.add(source.sourceFileOrdinal);
    if (source.encoding !== 'latin1' && source.encoding !== 'utf8') return false;
    if (source.family === 'empresas') empresas += 1;
    else estabelecimentos += 1;
  }
  return empresas > 0 && estabelecimentos > 0;
}
