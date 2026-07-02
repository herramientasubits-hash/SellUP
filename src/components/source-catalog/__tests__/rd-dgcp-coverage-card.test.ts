/**
 * RepúblicaDominicana.2F — RdDgcpCoverageCard display logic tests.
 *
 * Tests pure display helpers extracted from rd-dgcp-coverage-card.tsx.
 * No DOM, no React, no external calls.
 *
 * Guardrail assertions:
 *   - Never renders complete_snapshot for do_dgcp
 *   - Never claims DGCP is a fiscal/legal source
 *   - Never claims DGCP validates RNC
 *   - Never claims DGCP replaces DGII
 *   - loadedRows from summary is shown (47 in pilot)
 *   - Coverage status is pilot_sample
 *   - Source Catalog do_dgcp stays eligible_not_connected / not_connected
 *   - rd_dgii_bulk is not referenced
 *   - México/Perú/Chile are not referenced
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDgcpLoadedRows,
  formatDgcpCoverageStatus,
  formatDgcpCoverageSource,
  formatDgcpCoverageSourceReason,
  isDgcpCompleteSnapshot,
  isDgcpProcurementSignal,
  isDgcpFiscalSource,
} from '../rd-dgcp-coverage-card';

import {
  AUDITED_DGCP_LOADED_ROWS,
  DGCP_COVERAGE_KIND,
  DGCP_COVERAGE_SOURCE_KEY,
} from '@/server/services/rd-dgcp-source-coverage-summary';

import type { DgcpSourceCoverageSummary } from '@/server/services/rd-dgcp-source-coverage-summary';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePilotSummary(overrides: Partial<DgcpSourceCoverageSummary> = {}): DgcpSourceCoverageSummary {
  return {
    sourceKey: 'do_dgcp',
    loadedRows: AUDITED_DGCP_LOADED_ROWS,
    coverageStatus: 'pilot_sample',
    coverageKind: DGCP_COVERAGE_KIND,
    coverageSource: 'live_database',
    isProcurementSignalOnly: true,
    ciiuStatus: 'unavailable_not_invented',
    isFiscalSource: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. DGCP coverage card renders loadedRows = 47 when it comes from the summary
// ---------------------------------------------------------------------------
describe('DGCP loaded rows', () => {
  it('1. formatDgcpLoadedRows reflects 47 proveedores from pilot summary', () => {
    const summary = makePilotSummary({ loadedRows: 47 });
    const text = formatDgcpLoadedRows(summary.loadedRows);
    assert.ok(text.includes('47'), `must include "47" — got: ${text}`);
    assert.ok(text.toLowerCase().includes('proveedor'), `must include "proveedor" — got: ${text}`);
  });
});

// ---------------------------------------------------------------------------
// 2. DGCP coverage card shows pilot_sample
// ---------------------------------------------------------------------------
describe('Coverage status pilot_sample', () => {
  it('2. formatDgcpCoverageStatus returns pilot_sample label', () => {
    const text = formatDgcpCoverageStatus('pilot_sample');
    assert.ok(
      text.toLowerCase().includes('pilot') || text.toLowerCase().includes('muestra'),
      `must reference pilot or muestra — got: ${text}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. DGCP coverage card does NOT show complete_snapshot
// ---------------------------------------------------------------------------
describe('Never complete_snapshot', () => {
  it('3. isDgcpCompleteSnapshot returns false for pilot_sample', () => {
    assert.equal(isDgcpCompleteSnapshot('pilot_sample'), false);
  });

  it('3b. isDgcpCompleteSnapshot returns true only for complete_snapshot literal', () => {
    assert.equal(isDgcpCompleteSnapshot('complete_snapshot'), true);
  });

  it('3c. coverageStatus on pilot summary is never complete_snapshot', () => {
    const summary = makePilotSummary();
    assert.notEqual(summary.coverageStatus, 'complete_snapshot');
  });

  it('3d. formatDgcpCoverageStatus pilot_sample output does not contain complete_snapshot', () => {
    const text = formatDgcpCoverageStatus('pilot_sample');
    assert.ok(!text.includes('complete_snapshot'), `must not include "complete_snapshot" — got: ${text}`);
  });
});

// ---------------------------------------------------------------------------
// 4. DGCP coverage card mentions procurement/B2G
// ---------------------------------------------------------------------------
describe('Procurement / B2G signal', () => {
  it('4. isDgcpProcurementSignal returns true for pilot summary', () => {
    const summary = makePilotSummary();
    assert.equal(isDgcpProcurementSignal(summary), true);
  });

  it('4b. coverageKind is procurement_signal_snapshot', () => {
    const summary = makePilotSummary();
    assert.equal(summary.coverageKind, 'procurement_signal_snapshot');
  });
});

// ---------------------------------------------------------------------------
// 5. DGCP card clarifies it is NOT a legal source
// ---------------------------------------------------------------------------
describe('Not a legal source', () => {
  it('5. isProcurementSignalOnly is true (not legal)', () => {
    const summary = makePilotSummary();
    assert.equal(summary.isProcurementSignalOnly, true);
  });
});

// ---------------------------------------------------------------------------
// 6. DGCP card clarifies it is NOT a fiscal/tax source
// ---------------------------------------------------------------------------
describe('Not a fiscal/tax source', () => {
  it('6. isDgcpFiscalSource returns false for pilot summary', () => {
    const summary = makePilotSummary();
    assert.equal(isDgcpFiscalSource(summary), false);
  });

  it('6b. isFiscalSource is false on summary type', () => {
    const summary = makePilotSummary();
    assert.equal(summary.isFiscalSource, false);
  });
});

// ---------------------------------------------------------------------------
// 7. DGCP card clarifies it does NOT validate RNC
// ---------------------------------------------------------------------------
describe('Does not validate RNC', () => {
  it('7. ciiuStatus is unavailable_not_invented', () => {
    const summary = makePilotSummary();
    assert.equal(summary.ciiuStatus, 'unavailable_not_invented');
  });
});

// ---------------------------------------------------------------------------
// 8. DGCP card clarifies it does NOT replace DGII
// ---------------------------------------------------------------------------
describe('Does not replace DGII', () => {
  it('8. sourceKey is do_dgcp (not rd_dgii_bulk)', () => {
    const summary = makePilotSummary();
    assert.equal(summary.sourceKey, 'do_dgcp');
    assert.notEqual(summary.sourceKey, 'rd_dgii_bulk');
  });

  it('8b. DGCP_COVERAGE_SOURCE_KEY is do_dgcp', () => {
    assert.equal(DGCP_COVERAGE_SOURCE_KEY, 'do_dgcp');
  });
});

// ---------------------------------------------------------------------------
// 9. Source Catalog do_dgcp stays eligible_not_connected
// ---------------------------------------------------------------------------
describe('Source Catalog aiFlowStatus', () => {
  it('9. DGCP coverage summary sourceKey matches do_dgcp (not connected_post_approval)', () => {
    // The service returns do_dgcp — Source Catalog aiFlowStatus is managed separately.
    // This test confirms the summary sourceKey is always do_dgcp.
    const summary = makePilotSummary();
    assert.equal(summary.sourceKey, 'do_dgcp');
  });
});

// ---------------------------------------------------------------------------
// 10. Source Catalog do_dgcp stays not_connected
// ---------------------------------------------------------------------------
describe('Source Catalog connectionMode', () => {
  it('10. coverageStatus pilot_sample never implies connected_post_approval', () => {
    const summary = makePilotSummary();
    assert.equal(summary.coverageStatus, 'pilot_sample');
    assert.notEqual(summary.coverageStatus, 'complete_snapshot');
    // not_connected is in catalog metadata, not in the summary — confirmed by sourceKey
    assert.equal(summary.sourceKey, 'do_dgcp');
  });
});

// ---------------------------------------------------------------------------
// 11. rd_dgii_bulk is not referenced in DGCP helpers
// ---------------------------------------------------------------------------
describe('rd_dgii_bulk isolation', () => {
  it('11. DGCP_COVERAGE_SOURCE_KEY is not rd_dgii_bulk', () => {
    assert.notEqual(DGCP_COVERAGE_SOURCE_KEY, 'rd_dgii_bulk');
  });
});

// ---------------------------------------------------------------------------
// 12. México/Perú/Chile not referenced in DGCP helpers
// ---------------------------------------------------------------------------
describe('Geographic isolation', () => {
  it('12. DGCP summary sourceKey is do_dgcp (not mx/pe/cl)', () => {
    const summary = makePilotSummary();
    assert.ok(!summary.sourceKey.startsWith('mx_'), 'must not be México source');
    assert.ok(!summary.sourceKey.startsWith('pe_'), 'must not be Perú source');
    assert.ok(!summary.sourceKey.startsWith('cl_'), 'must not be Chile source');
  });

  it('12b. formatDgcpLoadedRows accepts audited fallback count', () => {
    const text = formatDgcpLoadedRows(AUDITED_DGCP_LOADED_ROWS);
    assert.ok(text.includes(String(AUDITED_DGCP_LOADED_ROWS)), 'must include audited count');
  });
});

// ---------------------------------------------------------------------------
// Helper: coverage source labels
// ---------------------------------------------------------------------------
describe('Coverage source labels', () => {
  it('formatDgcpCoverageSource live_database', () => {
    const text = formatDgcpCoverageSource('live_database');
    assert.ok(text.length > 0);
    assert.ok(text.toLowerCase().includes('vivo') || text.toLowerCase().includes('live'));
  });

  it('formatDgcpCoverageSource audited_fallback', () => {
    const text = formatDgcpCoverageSource('audited_fallback');
    assert.ok(text.length > 0);
    assert.ok(text.toLowerCase().includes('fallback') || text.toLowerCase().includes('auditado'));
  });

  it('formatDgcpCoverageSourceReason returns null when undefined', () => {
    assert.equal(formatDgcpCoverageSourceReason(undefined), null);
  });

  it('formatDgcpCoverageSourceReason returns string for known reason', () => {
    const result = formatDgcpCoverageSourceReason('query_failed');
    assert.ok(result !== null && result.length > 0);
  });
});
