/**
 * BR Receita CNPJ — CUMULATIVE SOURCE-FILE-OPEN PREFLIGHT — tests (BR-SOURCE-14B.0M correctness patch).
 *
 * Pure arithmetic over frozen constants. No filesystem access, no row read, no real handle opened.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateBrazilReceitaCumulativeSourceOpenCapPreflight,
  BRAZIL_RECEITA_NATIONAL_MULTIPART_TOTAL_SOURCE_DESCRIPTORS,
} from '../br-receita-cnpj-14b0m-cumulative-source-open-preflight';
import { deriveBrazilReceitaNationalMultipartSourcePassMultiplier } from '../br-receita-cnpj-14b0m-national-source-pass-multiplier';
import { BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS } from '../br-receita-cnpj-real-full-scan-benchmark';
import { BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES } from '../br-receita-cnpj-full-join-partition-handle-pool';

describe('BRAZIL_RECEITA_NATIONAL_MULTIPART_TOTAL_SOURCE_DESCRIPTORS', () => {
  it('is 20 — 10 Empresas + 10 Estabelecimentos parts', () => {
    assert.equal(BRAZIL_RECEITA_NATIONAL_MULTIPART_TOTAL_SOURCE_DESCRIPTORS, 20);
  });
});

describe('evaluateBrazilReceitaCumulativeSourceOpenCapPreflight', () => {
  it('passes for the frozen national input: 20 descriptors × 3-pass multiplier = 60, under the 64 cap', () => {
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxPartitionDepth, 1);
    const result = evaluateBrazilReceitaCumulativeSourceOpenCapPreflight();
    assert.equal(result.determinableMaxCumulativeSourceFileOpens, 60);
    assert.equal(result.cumulativeSourceFileOpenCap, 64);
    assert.equal(result.verdict, 'pass');
  });

  it('never reads or alters the frozen maxFilesOpened cap', () => {
    const result = evaluateBrazilReceitaCumulativeSourceOpenCapPreflight();
    assert.equal(result.cumulativeSourceFileOpenCap, BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxFilesOpened);
  });

  it('regression guard: maxPartitionDepth 2 would push the cumulative bound to 80 and FAIL against the 64 cap', () => {
    // This does NOT change maxPartitionDepth — it demonstrates, via the same pure derivation the
    // evaluator uses, exactly the risk that made this preflight necessary: one more permitted
    // repartition retry than today's frozen caps allow breaches the descriptor-open budget.
    const hypotheticalMultiplier = deriveBrazilReceitaNationalMultipartSourcePassMultiplier(2);
    assert.equal(hypotheticalMultiplier, 4);
    const hypotheticalCumulativeOpens =
      BRAZIL_RECEITA_NATIONAL_MULTIPART_TOTAL_SOURCE_DESCRIPTORS * hypotheticalMultiplier!;
    assert.equal(hypotheticalCumulativeOpens, 80);
    assert.ok(
      hypotheticalCumulativeOpens > BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxFilesOpened,
      'a maxPartitionDepth of 2 must breach the cumulative source-file-open cap, not silently pass',
    );
  });

  it('does not change maxPartitionDepth or maxFilesOpened', () => {
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxPartitionDepth, 1);
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxFilesOpened, 64);
  });
});

describe('GLOBAL_CONCURRENT_HANDLE_WORST_CASE (documentation-level, distinct from the cumulative bound above)', () => {
  it('the concurrent envelope (20 source handles + 32 partition handles = 52) clears the 64 cap', () => {
    // This is the OTHER file-open concept (§ 4): peak SIMULTANEOUS handles, not the cumulative total
    // across repartition retries checked above. It is plain arithmetic over two already-frozen
    // constants — no new preflight module is added for it, only this guard against either constant
    // drifting past the cap unnoticed.
    const concurrentWorstCase =
      BRAZIL_RECEITA_NATIONAL_MULTIPART_TOTAL_SOURCE_DESCRIPTORS +
      BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES;
    assert.equal(concurrentWorstCase, 52);
    assert.ok(concurrentWorstCase <= BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxFilesOpened);
  });
});
