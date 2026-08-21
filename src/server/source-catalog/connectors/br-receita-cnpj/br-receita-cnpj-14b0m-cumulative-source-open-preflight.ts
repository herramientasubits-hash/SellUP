/**
 * BR Receita CNPJ — CUMULATIVE SOURCE-FILE-OPEN PREFLIGHT (BR-SOURCE-14B.0M correctness patch, § 4-5).
 *
 * ── Two distinct file-open concepts — do not conflate them ──────────────────────
 * The engine's descriptor budget is bounded by TWO independent numbers, and this module answers only
 * the second one:
 *
 *   A. CONCURRENT handle envelope — how many file descriptors can be open AT THE SAME INSTANT.
 *      `br-receita-cnpj-full-join-partition-workspace.ts` bounds the partition side
 *      (`BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES = 32`) and the join's source-handle
 *      cache (`handleFor()` in `br-receita-cnpj-full-join-engine.ts`) never holds more than one handle
 *      per national source descriptor open at once
 *      (`BRAZIL_RECEITA_NATIONAL_MULTIPART_TOTAL_SOURCE_DESCRIPTORS = 20`). Worst case:
 *      `20 + 32 = 52`, comfortably under `maxFilesOpened: 64`. This module does NOT compute or
 *      re-derive that number — it is simple arithmetic over two already-frozen constants, documented
 *      here only so a reader does not mistake it for the number below.
 *
 *   B. CUMULATIVE source-file-open count — how many times a source descriptor is opened IN TOTAL
 *      across the whole run, counting every close-then-reopen. The join's handle cache
 *      (`handles.values()`) only closes ALL of its handles once, at the very end of
 *      `estabelecimentos_read` — so within a single reference-pass attempt each descriptor opens at
 *      most once. But `mayRepartition` (§ 6.2) discards the workspace and restarts the reference pass
 *      from source on a retry, and each restart is a FRESH set of opens on the same 20 descriptors.
 *      This is the number this module derives and checks, because it is the one no existing check
 *      covers: the concurrent envelope in (A) never sees it, since old handles from a discarded
 *      attempt are closed before the retry's opens begin.
 *
 * The two numbers are unrelated in size and in what breaches them — a low concurrent peak says
 * nothing about a high cumulative total, and vice versa. Never report one as evidence for the other.
 *
 * ── Derivation, not a hardcoded constant ─────────────────────────────────────────
 * Cumulative opens = (national source descriptor count) × (reference-pass + join-stage multiplier),
 * using the SAME `deriveBrazilReceitaNationalMultipartSourcePassMultiplier` derivation the byte-volume
 * preflight uses — the underlying reasoning is identical (one open per descriptor per full pass; the
 * pass count is `maxPartitionDepth + 2`). With the frozen `maxPartitionDepth: 1`, that is
 * `20 * 3 = 60`, under `maxFilesOpened: 64`.
 *
 * ── This module NEVER ────────────────────────────────────────────────────────────
 *   - opens, reads, or stats a file itself.
 *   - performs I/O of any kind.
 *   - raises, lowers, or otherwise touches `maxFilesOpened` or `maxPartitionDepth` — both are frozen
 *     imports (§ 30).
 *   - changes `maxOpenPartitionFiles` or anything about the concurrent handle envelope in (A).
 */

import { deriveBrazilReceitaNationalMultipartSourcePassMultiplier } from './br-receita-cnpj-14b0m-national-source-pass-multiplier';
import { BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY } from './br-receita-cnpj-14b0m-national-multipart-size-preflight';
import { BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS } from './br-receita-cnpj-real-full-scan-benchmark';

/** Empresas + Estabelecimentos, 10 parts each — the full national descriptor count. */
export const BRAZIL_RECEITA_NATIONAL_MULTIPART_TOTAL_SOURCE_DESCRIPTORS =
  BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY * 2;

export type BrazilReceitaCumulativeSourceOpenCapPreflightVerdict = 'pass' | 'fail' | 'indeterminate';

export interface BrazilReceitaCumulativeSourceOpenCapPreflightResult {
  readonly verdict: BrazilReceitaCumulativeSourceOpenCapPreflightVerdict;
  readonly determinableMaxCumulativeSourceFileOpens: number | null;
  readonly cumulativeSourceFileOpenCap: number;
}

/**
 * Evaluates the cumulative source-file-open bound against the FROZEN `maxFilesOpened` cap, for the
 * full 20-descriptor national input. `indeterminate` when the pass multiplier cannot be derived for
 * the frozen `maxPartitionDepth` — never an assumed pass.
 */
export function evaluateBrazilReceitaCumulativeSourceOpenCapPreflight(): BrazilReceitaCumulativeSourceOpenCapPreflightResult {
  const cumulativeSourceFileOpenCap = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxFilesOpened;
  const multiplier = deriveBrazilReceitaNationalMultipartSourcePassMultiplier(
    BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxPartitionDepth,
  );

  if (multiplier === null) {
    return {
      verdict: 'indeterminate',
      determinableMaxCumulativeSourceFileOpens: null,
      cumulativeSourceFileOpenCap,
    };
  }

  const determinableMaxCumulativeSourceFileOpens =
    BRAZIL_RECEITA_NATIONAL_MULTIPART_TOTAL_SOURCE_DESCRIPTORS * multiplier;

  return {
    verdict: determinableMaxCumulativeSourceFileOpens <= cumulativeSourceFileOpenCap ? 'pass' : 'fail',
    determinableMaxCumulativeSourceFileOpens,
    cumulativeSourceFileOpenCap,
  };
}
