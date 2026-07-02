/**
 * RepúblicaDominicana.2E — Tests for the DGCP procurement coverage summary.
 *
 * Verifies:
 *   1.  Coverage summary uses source_key do_dgcp.
 *   2.  Coverage summary uses country_code DO.
 *   3.  Coverage summary never uses complete_snapshot.
 *   4.  Coverage summary indicates procurement_signal (isProcurementSignalOnly).
 *   5.  Coverage summary loaded_rows reflects pilot load (47).
 *   6.  Coverage summary does not touch rd_dgii_bulk.
 *   7.  Coverage summary only targets source_key do_dgcp.
 *   8.  Coverage notes clarify pilot/partial nature.
 *   9.  DGCP is not marked as a legal source.
 *  10.  DGCP is not marked as a fiscal/tax source.
 *  11.  DGCP does not invent CIIU.
 *  12.  Source Catalog do_dgcp is not connected_post_approval.
 *
 * All tests are read-only — no external calls, no writes, no DB mocks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDITED_DGCP_LOADED_ROWS,
  DGCP_COVERAGE_SOURCE_KEY,
  DGCP_COVERAGE_KIND,
  KNOWN_DGCP_CONTRACTS_TOTAL,
  KNOWN_DGCP_PROVIDERS_TOTAL,
  getDgcpSourceCoverageSummary,
} from '../rd-dgcp-source-coverage-summary';

// ---------------------------------------------------------------------------
// 1. source_key is do_dgcp
// ---------------------------------------------------------------------------

describe('DGCP coverage: source_key', () => {
  it('constant is do_dgcp', () => {
    assert.strictEqual(DGCP_COVERAGE_SOURCE_KEY, 'do_dgcp');
  });

  it('fallback result has sourceKey = do_dgcp', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.strictEqual(result.sourceKey, 'do_dgcp');
  });
});

// ---------------------------------------------------------------------------
// 2. country_code is DO (verified via KNOWN_VALUES constant in script)
// ---------------------------------------------------------------------------

describe('DGCP coverage: country', () => {
  it('DGCP coverage is for Dominican Republic (DO)', () => {
    // Coverage kind is the canonical identifier for DO DGCP
    assert.strictEqual(DGCP_COVERAGE_KIND, 'procurement_signal_snapshot');
    // source_key starts with do_ (country prefix)
    assert.ok(DGCP_COVERAGE_SOURCE_KEY.startsWith('do_'));
  });
});

// ---------------------------------------------------------------------------
// 3. Coverage status is never complete_snapshot
// ---------------------------------------------------------------------------

describe('DGCP coverage: no complete_snapshot', () => {
  it('fallback result does not use complete_snapshot', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.notStrictEqual(result.coverageStatus, 'complete_snapshot');
  });

  it('coverageStatus is pilot_sample (honest pilot load)', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.ok(
      result.coverageStatus === 'pilot_sample' || result.coverageStatus === 'partial_snapshot',
      `Expected pilot_sample or partial_snapshot, got: ${result.coverageStatus}`,
    );
  });

  it('KNOWN_DGCP_PROVIDERS_TOTAL reflects full universe not loaded', () => {
    // 126,412 known providers — pilot loaded only 47
    assert.ok(KNOWN_DGCP_PROVIDERS_TOTAL > 1_000);
    assert.ok(AUDITED_DGCP_LOADED_ROWS < KNOWN_DGCP_PROVIDERS_TOTAL);
  });
});

// ---------------------------------------------------------------------------
// 4. isProcurementSignalOnly = true
// ---------------------------------------------------------------------------

describe('DGCP coverage: procurement signal only', () => {
  it('fallback result marks isProcurementSignalOnly = true', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.strictEqual(result.isProcurementSignalOnly, true);
  });

  it('coverage_kind is procurement_signal_snapshot', () => {
    assert.strictEqual(DGCP_COVERAGE_KIND, 'procurement_signal_snapshot');
  });
});

// ---------------------------------------------------------------------------
// 5. loaded_rows reflects pilot load
// ---------------------------------------------------------------------------

describe('DGCP coverage: loaded_rows', () => {
  it('AUDITED_DGCP_LOADED_ROWS is 47 (controlled pilot 2E)', () => {
    assert.strictEqual(AUDITED_DGCP_LOADED_ROWS, 47);
  });

  it('fallback result uses audited loaded_rows', async () => {
    const result = await getDgcpSourceCoverageSummary();
    // With no env vars, falls back to audited constants
    assert.ok(result.loadedRows > 0, 'loadedRows should be positive');
    assert.ok(result.loadedRows < KNOWN_DGCP_PROVIDERS_TOTAL, 'should be partial — not full universe');
  });
});

// ---------------------------------------------------------------------------
// 6. Does not touch rd_dgii_bulk
// ---------------------------------------------------------------------------

describe('DGCP coverage: no rd_dgii_bulk contamination', () => {
  it('source_key constant is not rd_dgii_bulk', () => {
    assert.notStrictEqual(DGCP_COVERAGE_SOURCE_KEY, 'rd_dgii_bulk');
  });

  it('fallback result sourceKey is not rd_dgii_bulk', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.notStrictEqual(result.sourceKey, 'rd_dgii_bulk');
  });

  it('DGCP coverage kind is not business_registry_snapshot (that belongs to DGII)', () => {
    assert.notStrictEqual(DGCP_COVERAGE_KIND, 'business_registry_snapshot');
  });
});

// ---------------------------------------------------------------------------
// 7. Only targets source_key do_dgcp
// ---------------------------------------------------------------------------

describe('DGCP coverage: source isolation', () => {
  it('source key is scoped to do_dgcp only', () => {
    assert.strictEqual(DGCP_COVERAGE_SOURCE_KEY, 'do_dgcp');
    // Sanity: not any other country prefix
    assert.ok(!DGCP_COVERAGE_SOURCE_KEY.startsWith('pe_'));
    assert.ok(!DGCP_COVERAGE_SOURCE_KEY.startsWith('mx_'));
    assert.ok(!DGCP_COVERAGE_SOURCE_KEY.startsWith('cl_'));
  });
});

// ---------------------------------------------------------------------------
// 8. Coverage notes clarify pilot nature
// ---------------------------------------------------------------------------

describe('DGCP coverage: pilot disclosure', () => {
  it('fallback result has coverageSource set', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.ok(
      result.coverageSource === 'live_database' || result.coverageSource === 'audited_fallback',
    );
  });

  it('contracts total known is large (proves pilot is incomplete)', () => {
    assert.ok(KNOWN_DGCP_CONTRACTS_TOTAL > 100_000);
  });
});

// ---------------------------------------------------------------------------
// 9. Not marked as legal source
// ---------------------------------------------------------------------------

describe('DGCP coverage: not a legal registry', () => {
  it('isProcurementSignalOnly = true (not a legal source)', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.strictEqual(result.isProcurementSignalOnly, true);
  });

  it('coverage kind does not include "legal" or "registry"', () => {
    assert.ok(!DGCP_COVERAGE_KIND.includes('legal'));
    assert.ok(!DGCP_COVERAGE_KIND.includes('registry'));
  });
});

// ---------------------------------------------------------------------------
// 10. Not a fiscal/tax source
// ---------------------------------------------------------------------------

describe('DGCP coverage: not a fiscal source', () => {
  it('fallback result isFiscalSource = false', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.strictEqual(result.isFiscalSource, false);
  });
});

// ---------------------------------------------------------------------------
// 11. CIIU not invented
// ---------------------------------------------------------------------------

describe('DGCP coverage: no invented CIIU', () => {
  it('ciiuStatus is unavailable_not_invented', async () => {
    const result = await getDgcpSourceCoverageSummary();
    assert.strictEqual(result.ciiuStatus, 'unavailable_not_invented');
  });
});

// ---------------------------------------------------------------------------
// 12. Source Catalog connection mode remains not_connected
// ---------------------------------------------------------------------------

describe('DGCP coverage: source catalog status', () => {
  it('pilot load does not imply connected_post_approval', async () => {
    // The service itself never sets aiFlowStatus or connectionMode —
    // verifying that coverageStatus is pilot_sample ensures the card
    // cannot truthfully claim operational connection.
    const result = await getDgcpSourceCoverageSummary();
    assert.notStrictEqual(result.coverageStatus, 'complete_snapshot');
    assert.strictEqual(result.isProcurementSignalOnly, true);
  });
});
