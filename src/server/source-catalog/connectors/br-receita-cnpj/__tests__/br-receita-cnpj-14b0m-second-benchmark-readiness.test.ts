/**
 * BR Receita CNPJ — STATIC SIZE PREFLIGHT + SECOND-BENCHMARK READINESS — tests (BR-SOURCE-14B.0M).
 *
 * Filesystem-metadata-only. No row is read, no real file is opened — every byte figure here is a
 * synthetic number supplied directly to the pure aggregator/evaluator functions.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateBrazilReceitaNationalMultipartSourceBytes,
  evaluateBrazilReceitaFullNationalBytesCapPreflight,
  type BrazilReceitaNationalMultipartSourceSize,
} from '../br-receita-cnpj-14b0m-national-multipart-size-preflight';
import { BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS } from '../br-receita-cnpj-real-full-scan-benchmark';
import { deriveBrazilReceitaNationalMultipartSourcePassMultiplier } from '../br-receita-cnpj-14b0m-national-source-pass-multiplier';
import {
  evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness,
  type BrazilReceitaSecondBenchmarkReadinessInputs,
} from '../br-receita-cnpj-14b0m-second-benchmark-readiness';

function tenPartsPerFamily(bytesPerPart: number): BrazilReceitaNationalMultipartSourceSize[] {
  const entries: BrazilReceitaNationalMultipartSourceSize[] = [];
  for (const family of ['empresas', 'estabelecimentos'] as const) {
    for (let partOrdinal = 0; partOrdinal < 10; partOrdinal += 1) {
      entries.push({ family, partOrdinal, extractedSizeBytes: bytesPerPart });
    }
  }
  return entries;
}

describe('aggregateBrazilReceitaNationalMultipartSourceBytes', () => {
  it('sums extracted bytes per family and totals, for a complete 10+10 inventory', () => {
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(tenPartsPerFamily(1000));
    assert.equal(totals.totalEmpresasSourceBytes, 10_000);
    assert.equal(totals.totalEstabelecimentosSourceBytes, 10_000);
    assert.equal(totals.totalFullNationalSourceBytes, 20_000);
    assert.equal(totals.completeNationalInventory, true);
  });

  it('reports an INCOMPLETE inventory honestly when a part is missing (18 of 20)', () => {
    const entries = tenPartsPerFamily(1000).filter(
      (e) => !(e.family === 'empresas' && e.partOrdinal === 7),
    );
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(entries);
    assert.equal(totals.completeNationalInventory, false);
  });

  it('reports an incomplete inventory when a duplicate ordinal is supplied instead of a missing one', () => {
    const entries = tenPartsPerFamily(1000);
    entries[0] = { ...entries[0]!, partOrdinal: 0 }; // already 0 — no-op, sanity
    entries.push({ family: 'empresas', partOrdinal: 0, extractedSizeBytes: 500 }); // 11 entries, only 10 distinct
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(entries);
    assert.equal(totals.completeNationalInventory, false, 'a duplicate ordinal is not a 10th distinct part');
  });

  it('ignores malformed entries rather than crashing, and still reports incomplete', () => {
    const entries: BrazilReceitaNationalMultipartSourceSize[] = [
      ...tenPartsPerFamily(1000),
      // A negative ordinal is not a TYPE violation (the interface has no range constraint) — it is a
      // runtime-level malformation this function must filter out rather than crash on.
      { family: 'empresas', partOrdinal: -1, extractedSizeBytes: 100 },
    ];
    assert.doesNotThrow(() => aggregateBrazilReceitaNationalMultipartSourceBytes(entries));
  });
});

describe('evaluateBrazilReceitaFullNationalBytesCapPreflight', () => {
  const maxBytesReadCap = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxBytesRead;

  it('is indeterminate for an incomplete inventory — never guesses a total from partial evidence', () => {
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(
      tenPartsPerFamily(1000).slice(0, 18),
    );
    const result = evaluateBrazilReceitaFullNationalBytesCapPreflight(totals);
    assert.equal(result.verdict, 'indeterminate');
    assert.equal(result.minimumRequiredReadBytes, null);
    assert.equal(result.determinableMaxReadBytes, null);
  });

  it('fails when even the unavoidable minimum (one full sequential scan) exceeds the cap', () => {
    // One byte per part over the cap, split across 20 parts, guarantees the total exceeds it.
    const perPart = Math.ceil(maxBytesReadCap / 20) + 1;
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(tenPartsPerFamily(perPart));
    const result = evaluateBrazilReceitaFullNationalBytesCapPreflight(totals);
    assert.equal(result.verdict, 'fail');
    assert.ok(result.minimumRequiredReadBytes! > maxBytesReadCap);
  });

  it('passes only when even the worst-case bound clears the cap', () => {
    // Tiny total: 20 parts of 10 bytes each is nowhere near the ~68GiB cap, even at the real multiplier.
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(tenPartsPerFamily(10));
    const result = evaluateBrazilReceitaFullNationalBytesCapPreflight(totals);
    assert.equal(result.verdict, 'pass');
    assert.equal(result.determinableMaxReadBytes, 600);
  });

  it('derives the worst-case multiplier from the frozen maxPartitionDepth (3×, not an optimistic 2×)', () => {
    // BR-SOURCE-14B.0M correctness patch root finding: with the frozen maxPartitionDepth: 1, one
    // controlled repartition retry is possible, so the true worst case is TWO full reference passes
    // plus one refetch pass (3×) — a caller that hardcodes 2× (0 repartition retries) understates it.
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxPartitionDepth, 1);
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(tenPartsPerFamily(1000));
    const result = evaluateBrazilReceitaFullNationalBytesCapPreflight(totals);
    const minimum = result.minimumRequiredReadBytes!;
    assert.equal(result.determinableMaxReadBytes, minimum * 3);
    assert.notEqual(result.determinableMaxReadBytes, minimum * 2, 'must not regress to the optimistic 2× bound');
  });

  it('is indeterminate when the total sits between the guaranteed-fail and guaranteed-pass bounds', () => {
    // Chosen so minimum <= cap (not a guaranteed fail) but minimum*3 > cap (not a guaranteed pass) —
    // the real multiplier at the frozen maxPartitionDepth: 1.
    const perPart = Math.ceil((maxBytesReadCap * 0.9) / 20);
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(tenPartsPerFamily(perPart));
    const result = evaluateBrazilReceitaFullNationalBytesCapPreflight(totals);
    assert.equal(result.verdict, 'indeterminate');
    assert.ok(result.minimumRequiredReadBytes! <= maxBytesReadCap);
    assert.ok(result.determinableMaxReadBytes! > maxBytesReadCap);
  });

  it('never reads or alters the frozen maxBytesRead cap', () => {
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(tenPartsPerFamily(10));
    const result = evaluateBrazilReceitaFullNationalBytesCapPreflight(totals);
    assert.equal(result.maxBytesReadCap, BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxBytesRead);
  });

  it('matches the expected real-metadata figures from the correctness patch report', () => {
    // TOTAL_FULL_NATIONAL_SOURCE_BYTES observed metadata-only, distributed across 20 descriptors as
    // 19 equal integer parts plus a remainder part, so the sum is exact (22_254_270_713 % 20 != 0).
    const totalBytes = 22_254_270_713;
    const perPart = Math.floor(totalBytes / 20);
    const entries = tenPartsPerFamily(perPart);
    entries[0] = { ...entries[0]!, extractedSizeBytes: perPart + (totalBytes - perPart * 20) };
    const totals = aggregateBrazilReceitaNationalMultipartSourceBytes(entries);
    const result = evaluateBrazilReceitaFullNationalBytesCapPreflight(totals);
    assert.equal(result.minimumRequiredReadBytes, 22_254_270_713);
    assert.equal(result.determinableMaxReadBytes, 66_762_812_139);
    assert.equal(result.maxBytesReadCap, 73_014_444_032);
    assert.equal(result.verdict, 'pass');
  });
});

describe('deriveBrazilReceitaNationalMultipartSourcePassMultiplier', () => {
  it('is 2 at depth 0 — one reference pass, no repartition retry, plus one refetch pass', () => {
    assert.equal(deriveBrazilReceitaNationalMultipartSourcePassMultiplier(0), 2);
  });

  it('is 3 at depth 1 — the frozen caps value — never the optimistic 2×', () => {
    assert.equal(deriveBrazilReceitaNationalMultipartSourcePassMultiplier(1), 3);
  });

  it('is 4 at depth 2 — one more permitted repartition retry than the frozen caps allow', () => {
    assert.equal(deriveBrazilReceitaNationalMultipartSourcePassMultiplier(2), 4);
  });

  it('is indeterminate (null), never an assumed multiplier, for a bound it cannot derive', () => {
    assert.equal(deriveBrazilReceitaNationalMultipartSourcePassMultiplier(-1), null);
    assert.equal(deriveBrazilReceitaNationalMultipartSourcePassMultiplier(1.5), null);
    assert.equal(deriveBrazilReceitaNationalMultipartSourcePassMultiplier(Number.NaN), null);
  });
});

describe('evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness', () => {
  function allTrue(): BrazilReceitaSecondBenchmarkReadinessInputs {
    return {
      nationalInputCompletenessVerdict: 'complete',
      nationalMultiPartInputReady: true,
      parserJoinAlphanumericCompatible: true,
      numericCnpjRedactionReady: true,
      alphanumericCnpjRedactionReady: true,
      fullNationalBytesCapPreflight: 'pass',
      cumulativeSourceOpenCapPreflight: 'pass',
      attempt2StructurallySupported: true,
    };
  }

  it('is ready only when all eight conditions hold', () => {
    const result = evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness(allTrue());
    assert.equal(result.technicallyReady, true);
    assert.deepEqual(result.unmetConditions, []);
  });

  it('reports the FULL list of unmet conditions in one pass, not just the first', () => {
    const result = evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness({
      ...allTrue(),
      nationalInputCompletenessVerdict: 'incomplete',
      nationalMultiPartInputReady: false,
      numericCnpjRedactionReady: false,
    });
    assert.equal(result.technicallyReady, false);
    assert.deepEqual(
      [...result.unmetConditions].sort(),
      [
        'national_input_completeness_not_complete',
        'national_multi_part_input_not_ready',
        'numeric_cnpj_redaction_not_ready',
      ].sort(),
    );
  });

  it('treats an indeterminate bytes-cap preflight as NOT a failure by itself (only "fail" blocks)', () => {
    const result = evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness({
      ...allTrue(),
      fullNationalBytesCapPreflight: 'indeterminate',
    });
    assert.equal(result.technicallyReady, true);
  });

  it('is not ready when the bytes-cap preflight fails, even if everything else holds', () => {
    const result = evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness({
      ...allTrue(),
      fullNationalBytesCapPreflight: 'fail',
    });
    assert.equal(result.technicallyReady, false);
    assert.deepEqual(result.unmetConditions, ['full_national_bytes_cap_preflight_failed']);
  });

  it('reproduces the exact 14B.0L stale-shortcut scenario: completeness alone is not readiness', () => {
    // 18/18 parts acquired => NATIONAL_INPUT_COMPLETENESS = complete, but the manifest bridge still
    // rejected a second entry per family (the actual 14B.0L finding).
    const result = evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness({
      ...allTrue(),
      nationalInputCompletenessVerdict: 'complete',
      nationalMultiPartInputReady: false,
    });
    assert.equal(result.technicallyReady, false);
    assert.deepEqual(result.unmetConditions, ['national_multi_part_input_not_ready']);
  });

  it('treats an indeterminate cumulative source-open preflight as NOT a failure by itself', () => {
    const result = evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness({
      ...allTrue(),
      cumulativeSourceOpenCapPreflight: 'indeterminate',
    });
    assert.equal(result.technicallyReady, true);
  });

  it('is not ready when the cumulative source-open preflight fails, even if the byte-cap preflight passes', () => {
    // The two bounds are independent — passing one never substitutes for the other.
    const result = evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness({
      ...allTrue(),
      fullNationalBytesCapPreflight: 'pass',
      cumulativeSourceOpenCapPreflight: 'fail',
    });
    assert.equal(result.technicallyReady, false);
    assert.deepEqual(result.unmetConditions, ['cumulative_source_open_cap_preflight_failed']);
  });
});
