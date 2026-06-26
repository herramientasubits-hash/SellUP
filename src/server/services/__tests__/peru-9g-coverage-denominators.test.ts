/**
 * Perú.9G — Honest SUNAT coverage denominators.
 *
 * Verifies the corrected coverage semantics:
 *   - loadedRowsCoveragePercent   = loadedRows      / 2_317_298 (full RUC-20 universe)
 *   - activeHabidoCoveragePercent = activeHabidoRows / 851_883   (ACTIVO + HABIDO universe)
 *
 * The pre-9G bug used loadedRows / 851_883, which overstated coverage (~88.0%
 * for 750k loaded) and could exceed 100% as more rows loaded. These tests lock
 * the honest denominators and the new card labels in place.
 *
 * All tests are read-only and pure: no Supabase, no SUNAT web, no Migo, no
 * Tavily, no LLM, no importer, no candidate/account/batch creation. The strings
 * ".insert(", ".update(", "api.migo.pe", "Tavily", "MIGO_API_KEY" below appear
 * ONLY inside negation assertions / comments — never executed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildSunatCoverage,
  buildPeruCoverageSummary,
  AUDITED_TOTAL_RUC20_ROWS,
  AUDITED_ACTIVE_HABIDO_RUC20_ROWS,
  type SunatSnapshotCounts,
} from '../peru-source-coverage-summary';

import {
  formatCoveragePercent,
  formatLoadedRows,
  formatLoadedSnapshotDetail,
  formatActiveHabidoDetail,
} from '@/components/source-catalog/peru-coverage-card';

// ---------------------------------------------------------------------------
// Fixtures — the real Perú.9F end state (750k loaded).
// ---------------------------------------------------------------------------

const PERU_9F_COUNTS: SunatSnapshotCounts = {
  total: 750_000,
  activeHabido: 136_099,
  activeNotHabido: 8_286,
  inactiveHabido: 335_743,
  inactiveNotHabido: 269_872,
};

const CARD_SOURCE = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../components/source-catalog/peru-coverage-card.tsx',
  ),
  'utf8',
);

// ---------------------------------------------------------------------------
// 1–2. Denominators are the audited universes.
// ---------------------------------------------------------------------------
describe('audited denominators (Perú.9G)', () => {
  it('1. loadedRowsCoveragePercent uses loadedRows / 2_317_298', () => {
    assert.equal(AUDITED_TOTAL_RUC20_ROWS, 2_317_298);
    const coverage = buildSunatCoverage(PERU_9F_COUNTS, 'live_database');
    const expected = Math.round((750_000 / 2_317_298) * 1000) / 10;
    assert.equal(coverage.loadedRowsCoveragePercent, expected);
    assert.equal(coverage.auditedTotalRuc20Rows, 2_317_298);
  });

  it('2. activeHabidoCoveragePercent uses activeHabidoRows / 851_883', () => {
    assert.equal(AUDITED_ACTIVE_HABIDO_RUC20_ROWS, 851_883);
    const coverage = buildSunatCoverage(PERU_9F_COUNTS, 'live_database');
    const expected = Math.round((136_099 / 851_883) * 1000) / 10;
    assert.equal(coverage.activeHabidoCoveragePercent, expected);
    assert.equal(coverage.auditedActiveHabidoRuc20Rows, 851_883);
  });
});

// ---------------------------------------------------------------------------
// 3–4. Expected values for the Perú.9F end state.
// ---------------------------------------------------------------------------
describe('expected percentages for 750k loaded', () => {
  it('3. loadedRowsCoveragePercent ≈ 32.4 for loadedRows=750000', () => {
    const coverage = buildSunatCoverage(PERU_9F_COUNTS, 'live_database');
    assert.equal(coverage.loadedRowsCoveragePercent, 32.4);
  });

  it('4. activeHabidoCoveragePercent ≈ 16.0 for activeHabidoRows=136099', () => {
    const coverage = buildSunatCoverage(PERU_9F_COUNTS, 'live_database');
    assert.equal(coverage.activeHabidoCoveragePercent, 16);
  });
});

// ---------------------------------------------------------------------------
// 5–6. Card labels.
// ---------------------------------------------------------------------------
describe('card labels (Perú.9G)', () => {
  it('5. card renders "Cobertura snapshot RUC-20"', () => {
    assert.ok(CARD_SOURCE.includes('Cobertura snapshot RUC-20'));
  });

  it('6. card renders "ACTIVO + HABIDO cargados"', () => {
    assert.ok(CARD_SOURCE.includes('ACTIVO + HABIDO cargados'));
  });

  it('detail helpers produce the honest denominator copy', () => {
    const coverage = buildSunatCoverage(PERU_9F_COUNTS, 'live_database');
    const snapshotDetail = formatLoadedSnapshotDetail(
      coverage.loadedRows,
      coverage.auditedTotalRuc20Rows,
    );
    const activeDetail = formatActiveHabidoDetail(
      coverage.activeHabidoRows,
      coverage.auditedActiveHabidoRuc20Rows,
    );
    assert.ok(snapshotDetail.includes(formatLoadedRows(2_317_298)));
    assert.ok(activeDetail.includes(formatLoadedRows(851_883)));
    assert.ok(activeDetail.includes('ACTIVO + HABIDO'));
  });
});

// ---------------------------------------------------------------------------
// 7. Card never shows 88.0% as the general coverage for 750k.
// ---------------------------------------------------------------------------
describe('no misleading 88.0% (Perú.9G)', () => {
  it('7. card does not hardcode a generic "Cobertura estimada" label', () => {
    assert.ok(!CARD_SOURCE.includes('Cobertura estimada'));
  });

  it('8. computed coverage for 750k is not the old ~88.0% figure', () => {
    const coverage = buildSunatCoverage(PERU_9F_COUNTS, 'live_database');
    assert.notEqual(coverage.loadedRowsCoveragePercent, 88);
    assert.notEqual(formatCoveragePercent(coverage.loadedRowsCoveragePercent), '88.0%');
    // The old bug: loadedRows / 851_883 ≈ 88.0 — must NOT match any surfaced field.
    const oldBuggyPercent = Math.round((750_000 / 851_883) * 1000) / 10;
    assert.notEqual(coverage.loadedRowsCoveragePercent, oldBuggyPercent);
    assert.notEqual(coverage.activeHabidoCoveragePercent, oldBuggyPercent);
    assert.notEqual(coverage.coveragePercent, oldBuggyPercent);
  });
});

// ---------------------------------------------------------------------------
// 9–10. Preserved fields.
// ---------------------------------------------------------------------------
describe('preserved fields (Perú.9G)', () => {
  it('9. nextRecommendedOffset is preserved (= loadedRows)', () => {
    const coverage = buildSunatCoverage(PERU_9F_COUNTS, 'live_database');
    assert.equal(coverage.nextRecommendedOffset, 750_000);
  });

  it('10. coverageSource is preserved', () => {
    const live = buildSunatCoverage(PERU_9F_COUNTS, 'live_database');
    const fallback = buildSunatCoverage(PERU_9F_COUNTS, 'audited_fallback');
    assert.equal(live.coverageSource, 'live_database');
    assert.equal(fallback.coverageSource, 'audited_fallback');
  });
});

// ---------------------------------------------------------------------------
// 11–17. Read-only guardrails — output leaks nothing and references nothing.
// ---------------------------------------------------------------------------
describe('guardrails (Perú.9G)', () => {
  it('11–17. summary leaks no secrets/payloads and references no writes/externals', () => {
    const summary = buildPeruCoverageSummary(PERU_9F_COUNTS, 'unknown', 'live_database');
    const json = JSON.stringify(summary);
    // 11. No API key
    assert.ok(!json.includes('MIGO_API_KEY'));
    assert.ok(!json.includes('NEXT_PUBLIC_MIGO'));
    assert.ok(!json.includes('SUPABASE_SERVICE_ROLE_KEY'));
    assert.ok(!json.includes('Authorization'));
    assert.ok(!json.includes('Bearer'));
    // 12. No raw payload
    assert.ok(!json.includes('raw_payload'));
    assert.ok(!json.includes('rawPayload'));
    // 13–15. No Migo / SUNAT web / Tavily / LLM endpoints
    assert.ok(!json.includes('api.migo.pe'));
    assert.ok(!json.includes('www2.sunat'));
    assert.ok(!json.toLowerCase().includes('tavily'));
    // 16. No importer artifacts
    assert.ok(!json.includes('padron_reducido_ruc'));
    assert.ok(!json.includes('sunat:peru:import'));
    // 17. No candidate/account/batch write tables
    assert.ok(!json.includes('prospect_candidates'));
    assert.ok(!json.includes('prospect_batches'));
    assert.ok(!json.includes('accounts.insert'));
  });
});
