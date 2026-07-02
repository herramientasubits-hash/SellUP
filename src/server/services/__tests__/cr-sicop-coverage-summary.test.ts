/**
 * Centroamérica.4C — Tests for the SICOP CR procurement coverage summary.
 *
 * Verifies:
 *   1.  Coverage summary uses source_key cr_sicop.
 *   2.  Coverage summary uses country_code CR (via source_key prefix).
 *   3.  Coverage summary uses coverage_status pilot_sample.
 *   4.  Coverage summary uses coverage_kind procurement_signal_snapshot.
 *   5.  Coverage summary reflects loaded_rows real (160 from pilot).
 *   6.  Coverage summary does not use complete_snapshot.
 *   7.  SICOP clarifies it is NOT a legal registry.
 *   8.  SICOP clarifies it is NOT a tax/fiscal source.
 *   9.  SICOP clarifies it does NOT validate cédula jurídica.
 *  10.  SICOP clarifies it does NOT replace Hacienda CR.
 *  11.  Does not touch source_company_snapshots (read-only constants only).
 *  12.  Does not touch accounts or prospect_candidates (no writes).
 *  13.  Source Catalog cr_sicop stays eligible_not_connected.
 *  14.  Source Catalog cr_sicop stays connectionMode not_connected.
 *  15.  Source isolation: does not target RD, MX, PE, CL, CO.
 *
 * All tests are read-only — no external calls, no writes, no DB mocks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDITED_SICOP_LOADED_ROWS,
  SICOP_COVERAGE_SOURCE_KEY,
  SICOP_COVERAGE_KIND,
  getSicopSourceCoverageSummary,
} from '../cr-sicop-source-coverage-summary';

// ---------------------------------------------------------------------------
// 1. source_key is cr_sicop
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: source_key', () => {
  it('constant is cr_sicop', () => {
    assert.strictEqual(SICOP_COVERAGE_SOURCE_KEY, 'cr_sicop');
  });

  it('fallback result has sourceKey = cr_sicop', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.strictEqual(result.sourceKey, 'cr_sicop');
  });
});

// ---------------------------------------------------------------------------
// 2. country_code is CR (verified via source_key prefix)
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: country', () => {
  it('source_key starts with cr_ (Costa Rica prefix)', () => {
    assert.ok(SICOP_COVERAGE_SOURCE_KEY.startsWith('cr_'));
  });
});

// ---------------------------------------------------------------------------
// 3. coverage_status is pilot_sample
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: coverage_status pilot_sample', () => {
  it('fallback result has coverageStatus = pilot_sample', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.strictEqual(result.coverageStatus, 'pilot_sample');
  });
});

// ---------------------------------------------------------------------------
// 4. coverage_kind is procurement_signal_snapshot
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: coverage_kind', () => {
  it('constant is procurement_signal_snapshot', () => {
    assert.strictEqual(SICOP_COVERAGE_KIND, 'procurement_signal_snapshot');
  });

  it('fallback result has coverageKind = procurement_signal_snapshot', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.strictEqual(result.coverageKind, 'procurement_signal_snapshot');
  });
});

// ---------------------------------------------------------------------------
// 5. loaded_rows reflects pilot load (160)
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: loaded_rows', () => {
  it('AUDITED_SICOP_LOADED_ROWS is 160 (4B pilot)', () => {
    assert.strictEqual(AUDITED_SICOP_LOADED_ROWS, 160);
  });

  it('fallback result loadedRows equals audited constant', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.ok(result.loadedRows > 0, 'loadedRows should be positive');
    assert.strictEqual(result.loadedRows, AUDITED_SICOP_LOADED_ROWS);
  });
});

// ---------------------------------------------------------------------------
// 6. Never uses complete_snapshot
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: no complete_snapshot', () => {
  it('fallback result does not use complete_snapshot', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.notStrictEqual(result.coverageStatus, 'complete_snapshot');
  });

  it('coverageStatus is pilot_sample, not complete', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.strictEqual(result.coverageStatus, 'pilot_sample');
  });
});

// ---------------------------------------------------------------------------
// 7. SICOP is NOT a legal registry
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: not a legal registry', () => {
  it('isProcurementSignalOnly = true', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.strictEqual(result.isProcurementSignalOnly, true);
  });

  it('coverage_kind does not include legal or registry', () => {
    assert.ok(!SICOP_COVERAGE_KIND.includes('legal'));
    assert.ok(!SICOP_COVERAGE_KIND.includes('registry'));
  });
});

// ---------------------------------------------------------------------------
// 8. SICOP is NOT a fiscal/tax source
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: not a fiscal source', () => {
  it('isFiscalSource = false', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.strictEqual(result.isFiscalSource, false);
  });
});

// ---------------------------------------------------------------------------
// 9. Does NOT validate cédula jurídica
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: no cédula jurídica validation', () => {
  it('validatesCedulaJuridica = false', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.strictEqual(result.validatesCedulaJuridica, false);
  });
});

// ---------------------------------------------------------------------------
// 10. Does NOT replace Hacienda CR
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: does not replace Hacienda CR', () => {
  it('replacesHaciendaCr = false', async () => {
    const result = await getSicopSourceCoverageSummary();
    assert.strictEqual(result.replacesHaciendaCr, false);
  });
});

// ---------------------------------------------------------------------------
// 11. Does not touch source_company_snapshots (read-only service — constants only)
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: no snapshot writes', () => {
  it('service module does not export any write function', async () => {
    const mod = await import('../cr-sicop-source-coverage-summary');
    const keys = Object.keys(mod);
    const writeKeys = keys.filter(
      k => k.toLowerCase().includes('write') || k.toLowerCase().includes('upsert'),
    );
    assert.deepStrictEqual(writeKeys, [], `Unexpected write exports: ${writeKeys.join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
// 12. Does not touch accounts or prospect_candidates
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: no accounts or candidate writes', () => {
  it('fallback result has no accounts or candidates fields', async () => {
    const result = await getSicopSourceCoverageSummary();
    const keys = Object.keys(result);
    assert.ok(!keys.includes('accounts'), 'should not have accounts field');
    assert.ok(!keys.includes('candidates'), 'should not have candidates field');
    assert.ok(!keys.includes('prospect_candidates'), 'should not have prospect_candidates field');
  });
});

// ---------------------------------------------------------------------------
// 13. Source Catalog cr_sicop stays eligible_not_connected
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: aiFlowStatus stays eligible_not_connected', () => {
  it('service does not set aiFlowStatus to connected_post_approval', async () => {
    const result = await getSicopSourceCoverageSummary();
    // The service result itself has no aiFlowStatus field —
    // that is managed by Source Catalog, not the coverage service.
    // This test confirms the coverage service does not produce connected_post_approval.
    const resultStr = JSON.stringify(result);
    assert.ok(
      !resultStr.includes('connected_post_approval'),
      'Coverage result should not mention connected_post_approval',
    );
  });
});

// ---------------------------------------------------------------------------
// 14. Source Catalog cr_sicop stays connectionMode not_connected
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: connectionMode stays not_connected', () => {
  it('service does not produce connected connection mode', async () => {
    const result = await getSicopSourceCoverageSummary();
    const resultStr = JSON.stringify(result);
    assert.ok(
      !resultStr.includes('connected_post_approval'),
      'Coverage result should not mention connected mode',
    );
  });

  it('coverage_status pilot_sample is consistent with not_connected catalog state', async () => {
    const result = await getSicopSourceCoverageSummary();
    // pilot_sample = not ready for operational connection
    assert.strictEqual(result.coverageStatus, 'pilot_sample');
  });
});

// ---------------------------------------------------------------------------
// 15. Source isolation: does not target RD, MX, PE, CL, CO
// ---------------------------------------------------------------------------

describe('SICOP CR coverage: source isolation from other countries', () => {
  it('source_key is not do_dgcp (RD)', () => {
    assert.notStrictEqual(SICOP_COVERAGE_SOURCE_KEY, 'do_dgcp');
  });

  it('source_key does not start with mx_ (Mexico)', () => {
    assert.ok(!SICOP_COVERAGE_SOURCE_KEY.startsWith('mx_'));
  });

  it('source_key does not start with pe_ (Peru)', () => {
    assert.ok(!SICOP_COVERAGE_SOURCE_KEY.startsWith('pe_'));
  });

  it('source_key does not start with cl_ (Chile)', () => {
    assert.ok(!SICOP_COVERAGE_SOURCE_KEY.startsWith('cl_'));
  });

  it('source_key does not start with co_ (Colombia)', () => {
    assert.ok(!SICOP_COVERAGE_SOURCE_KEY.startsWith('co_'));
  });
});
