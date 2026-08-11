/**
 * BR Receita CNPJ — STATIC NATIONAL SIZE PREFLIGHT (BR-SOURCE-14B.0M § 14, § 15).
 *
 * Answers one question using ONLY filesystem metadata (`fs.stat`-shaped sizes the caller already
 * holds) and NEVER a row read: if a second real benchmark traversed all 20 national source
 * descriptors (10 Empresas + 10 Estabelecimentos), would the unavoidable minimum bytes read blow
 * `maxBytesRead` before anything else about the run even started?
 *
 * ── Extracted bytes, never compressed bytes (§ 15) ──────────────────────────────
 * The engine reads EXTRACTED `.csv`/`.txt` source files, never the publisher's `.zip`. A caller
 * that fed this module a ZIP's compressed size would understate the real read volume, so every
 * entry here is documented as the EXTRACTED file's size — this module has no way to enforce that
 * from a number alone, which is why the doc says it plainly instead.
 *
 * ── Two honest bounds, not one invented number ──────────────────────────────────
 * `minimumRequiredReadBytes` is the sum of every source file's bytes — the engine's reference pass
 * (`empresas_reference_pass` / `estabelecimentos_reference_pass`) streams each source descriptor
 * exactly once, sequentially, with no retry (`br-receita-cnpj-full-join-engine.ts`: one
 * `readBrazilReceitaFullJoinFileSequentially` call per descriptor, inside the per-family loop).
 * That is the LOWEST possible `bytesRead` any real attempt could achieve.
 *
 * `determinableMaxReadBytes` accounts for TWO distinct sources of repeat reads, not just one:
 *   1. The partitioned join's per-reference row refetch (`keyOf()` in the engine re-opens the
 *      ORIGINAL source file and reads exactly one row per spilled reference). Each row is spilled as
 *      at most one reference during the reference pass and refetched at most once during the join
 *      pass, so this source alone never reads a given row's bytes more than twice.
 *   2. Controlled repartition (`br-receita-cnpj-full-join-engine.ts` § 6.2, `mayRepartition`): when a
 *      partition overflows, the engine discards the coarser map and restarts the ENTIRE reference
 *      pass from source at a finer partition count, up to `maxPartitionDepth` times. A caller that
 *      ignores this and hardcodes `minimumRequiredReadBytes * 2` is only correct when
 *      `maxPartitionDepth` is `0` — with the frozen `maxPartitionDepth: 1` this proposal actually
 *      carries, one retry is possible, so the true worst case is `minimumRequiredReadBytes * 3`
 *      (two full reference passes + one refetch pass), not `* 2`. See
 *      `deriveBrazilReceitaNationalMultipartSourcePassMultiplier` for the general derivation.
 *
 * A verdict of `pass` therefore requires the WORST case to still clear the cap; a verdict of `fail`
 * requires the BEST case to already miss it. Anything in between — where the run's actual position
 * between those two bounds depends on real match counts this module never reads — is `indeterminate`,
 * on purpose (same discipline as `br-receita-cnpj-national-input-completeness.ts`: no verdict from
 * absence of evidence). The same discipline applies when the multiplier itself cannot be derived (an
 * invalid `maxPartitionDepth`) — this module reports `indeterminate` rather than assume one.
 *
 * ── Extracted bytes and hardlinks (§ 15, addendum) ──────────────────────────────
 * A caller that holds both a `manifest-input` hardlink and its `extracted` counterpart for the same
 * physical file must supply the size ONCE, not once per path — the two paths name the same bytes on
 * disk, and counting both would double every total this module computes.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens, reads, or stats a file itself. Every size is a caller-supplied number.
 *   - reads a row, computes a match count, or estimates one.
 *   - raises, lowers, or otherwise touches `maxBytesRead` or `maxPartitionDepth` — both are frozen
 *     imports (§ 30).
 */

import { deriveBrazilReceitaNationalMultipartSourcePassMultiplier } from './br-receita-cnpj-14b0m-national-source-pass-multiplier';
import { BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS } from './br-receita-cnpj-real-full-scan-benchmark';

export const BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY = 10 as const;

/** One installed source descriptor's EXTRACTED size, as filesystem metadata only. */
export interface BrazilReceitaNationalMultipartSourceSize {
  readonly family: 'empresas' | 'estabelecimentos';
  readonly partOrdinal: number;
  /** The EXTRACTED `.csv`/`.txt` file's size, in bytes. Never a `.zip` size (§ 15). */
  readonly extractedSizeBytes: number;
}

export interface BrazilReceitaNationalMultipartSourceByteTotals {
  readonly totalEmpresasSourceBytes: number;
  readonly totalEstabelecimentosSourceBytes: number;
  readonly totalFullNationalSourceBytes: number;
  /** True only when exactly 10 distinct, valid Empresas AND 10 distinct Estabelecimentos entries were given. */
  readonly completeNationalInventory: boolean;
}

function isValidPartEntry(entry: unknown): entry is BrazilReceitaNationalMultipartSourceSize {
  if (entry === null || typeof entry !== 'object') return false;
  const candidate = entry as Record<string, unknown>;
  return (
    (candidate.family === 'empresas' || candidate.family === 'estabelecimentos') &&
    Number.isInteger(candidate.partOrdinal) &&
    (candidate.partOrdinal as number) >= 0 &&
    (candidate.partOrdinal as number) < BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY &&
    typeof candidate.extractedSizeBytes === 'number' &&
    Number.isFinite(candidate.extractedSizeBytes) &&
    (candidate.extractedSizeBytes as number) >= 0
  );
}

/**
 * Aggregates EXTRACTED source byte sizes across the 20 national descriptors. Pure: no filesystem
 * access, no row read. `completeNationalInventory` is `true` only when the entries given are exactly
 * the 10 distinct partOrdinals (0..9) for EACH family — a caller with 18 of 20 parts gets an honest
 * `false`, not a total computed over what happened to be supplied.
 */
export function aggregateBrazilReceitaNationalMultipartSourceBytes(
  entries: readonly BrazilReceitaNationalMultipartSourceSize[],
): BrazilReceitaNationalMultipartSourceByteTotals {
  const valid = entries.filter(isValidPartEntry);
  const empresasOrdinals = new Set<number>();
  const estabelecimentosOrdinals = new Set<number>();
  let empresasEntryCount = 0;
  let estabelecimentosEntryCount = 0;
  let totalEmpresasSourceBytes = 0;
  let totalEstabelecimentosSourceBytes = 0;

  for (const entry of valid) {
    if (entry.family === 'empresas') {
      empresasOrdinals.add(entry.partOrdinal);
      empresasEntryCount += 1;
      totalEmpresasSourceBytes += entry.extractedSizeBytes;
    } else {
      estabelecimentosOrdinals.add(entry.partOrdinal);
      estabelecimentosEntryCount += 1;
      totalEstabelecimentosSourceBytes += entry.extractedSizeBytes;
    }
  }

  // Both the DISTINCT ordinal count AND the raw entry count must equal 10 per family — a duplicate
  // ordinal (11 entries, 10 distinct) is caught by the entry-count check; a missing ordinal (9
  // entries, 9 distinct) is caught by the ordinal-count check.
  const completeNationalInventory =
    valid.length === entries.length &&
    empresasOrdinals.size === BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY &&
    empresasEntryCount === BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY &&
    estabelecimentosOrdinals.size === BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY &&
    estabelecimentosEntryCount === BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY;

  return {
    totalEmpresasSourceBytes,
    totalEstabelecimentosSourceBytes,
    totalFullNationalSourceBytes: totalEmpresasSourceBytes + totalEstabelecimentosSourceBytes,
    completeNationalInventory,
  };
}

export type BrazilReceitaFullNationalBytesCapPreflightVerdict = 'pass' | 'fail' | 'indeterminate';

export interface BrazilReceitaFullNationalBytesCapPreflightResult {
  readonly verdict: BrazilReceitaFullNationalBytesCapPreflightVerdict;
  readonly minimumRequiredReadBytes: number | null;
  readonly determinableMaxReadBytes: number | null;
  readonly maxBytesReadCap: number;
}

/**
 * Compares the derived bounds against the FROZEN `maxBytesRead` cap. Never mutates or reads an
 * alternate value for either frozen import — the cap is always
 * `BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxBytesRead` and the worst-case multiplier is
 * always derived from `BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxPartitionDepth` (§ 30).
 *
 * A `fail` is reported purely off `minimumRequiredReadBytes` — the unavoidable minimum already
 * exceeding the cap needs no multiplier to be certain. When the multiplier cannot be derived (an
 * invalid `maxPartitionDepth`), the verdict is `indeterminate` rather than an assumed pass.
 */
export function evaluateBrazilReceitaFullNationalBytesCapPreflight(
  totals: BrazilReceitaNationalMultipartSourceByteTotals,
): BrazilReceitaFullNationalBytesCapPreflightResult {
  const maxBytesReadCap = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxBytesRead;

  if (!totals.completeNationalInventory) {
    return {
      verdict: 'indeterminate',
      minimumRequiredReadBytes: null,
      determinableMaxReadBytes: null,
      maxBytesReadCap,
    };
  }

  const minimumRequiredReadBytes = totals.totalFullNationalSourceBytes;
  const multiplier = deriveBrazilReceitaNationalMultipartSourcePassMultiplier(
    BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxPartitionDepth,
  );
  const determinableMaxReadBytes = multiplier === null ? null : minimumRequiredReadBytes * multiplier;

  if (minimumRequiredReadBytes > maxBytesReadCap) {
    return { verdict: 'fail', minimumRequiredReadBytes, determinableMaxReadBytes, maxBytesReadCap };
  }
  if (determinableMaxReadBytes === null) {
    return { verdict: 'indeterminate', minimumRequiredReadBytes, determinableMaxReadBytes: null, maxBytesReadCap };
  }
  if (determinableMaxReadBytes <= maxBytesReadCap) {
    return { verdict: 'pass', minimumRequiredReadBytes, determinableMaxReadBytes, maxBytesReadCap };
  }
  return { verdict: 'indeterminate', minimumRequiredReadBytes, determinableMaxReadBytes, maxBytesReadCap };
}
