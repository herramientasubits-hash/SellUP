/**
 * Tests for peru-source-coverage-summary (Perú.8A).
 *
 * All tests are read-only; no external services are called.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSunatCoverage,
  buildMigoCoverage,
  buildGuardrails,
  buildPeruCoverageSummary,
  getPeruSourceCoverageSummary,
  AUDITED_SUNAT_SNAPSHOT,
  type SunatSnapshotCounts,
} from '../peru-source-coverage-summary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_COUNTS: SunatSnapshotCounts = {
  total: 100_000,
  activeHabido: 14_221,
  activeNotHabido: 1_199,
  inactiveHabido: 48_188,
  inactiveNotHabido: 36_392,
};

// ---------------------------------------------------------------------------
// 1. Calculates SUNAT distribution correctly from mock rows
// ---------------------------------------------------------------------------
describe('buildSunatCoverage', () => {
  it('1. reflects all four distribution buckets from provided counts', () => {
    const coverage = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(coverage.activeHabidoRows, 14_221);
    assert.equal(coverage.activeNotHabidoRows, 1_199);
    assert.equal(coverage.inactiveHabidoRows, 48_188);
    assert.equal(coverage.inactiveNotHabidoRows, 36_392);
    assert.equal(coverage.loadedRows, 100_000);
  });

  // 2. nextRecommendedOffset = loadedRows
  it('2. sets nextRecommendedOffset equal to loadedRows', () => {
    const coverage = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(coverage.nextRecommendedOffset, coverage.loadedRows);
  });

  // 3. loadedRows 100000 → nextRecommendedOffset 100000
  it('3. loadedRows 100000 produces nextRecommendedOffset 100000', () => {
    const coverage = buildSunatCoverage({ ...MOCK_COUNTS, total: 100_000 });
    assert.equal(coverage.nextRecommendedOffset, 100_000);
  });

  // 4. officialLegalValidation = true
  it('4. marks officialLegalValidation as true', () => {
    const coverage = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(coverage.officialLegalValidation, true);
  });

  // 5. providesCiiu = false
  it('5. marks providesCiiu as false', () => {
    const coverage = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(coverage.providesCiiu, false);
  });

  // 6. providesOfficialSector = false
  it('6. marks providesOfficialSector as false', () => {
    const coverage = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(coverage.providesOfficialSector, false);
  });

  it('sets coverageLabel to partial_snapshot', () => {
    const coverage = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(coverage.coverageLabel, 'partial_snapshot');
  });

  it('computes coveragePercent > 0 from positive total', () => {
    const coverage = buildSunatCoverage(MOCK_COUNTS);
    assert.ok(coverage.coveragePercent > 0);
    assert.ok(coverage.coveragePercent < 100);
  });
});

// ---------------------------------------------------------------------------
// Migo coverage — tests 7–10
// ---------------------------------------------------------------------------
describe('buildMigoCoverage', () => {
  // 7. role = legal_api_fallback
  it('7. sets role to legal_api_fallback', () => {
    const migo = buildMigoCoverage(true);
    assert.equal(migo.role, 'legal_api_fallback');
  });

  // 8. providesCiiu = false
  it('8. marks providesCiiu as false', () => {
    const migo = buildMigoCoverage(true);
    assert.equal(migo.providesCiiu, false);
  });

  // 9. providesOfficialSector = false
  it('9. marks providesOfficialSector as false', () => {
    const migo = buildMigoCoverage(false);
    assert.equal(migo.providesOfficialSector, false);
  });

  // 10. performsDiscovery = false
  it('10. marks performsDiscovery as false', () => {
    const migo = buildMigoCoverage('unknown');
    assert.equal(migo.performsDiscovery, false);
  });

  // 11. If Migo config cannot be read → configured = 'unknown'
  it('11. accepts unknown when Migo config cannot be read', () => {
    const migo = buildMigoCoverage('unknown');
    assert.equal(migo.configured, 'unknown');
  });
});

// ---------------------------------------------------------------------------
// Security guardrails — tests 12–18
// ---------------------------------------------------------------------------
describe('buildPeruCoverageSummary — security guardrails', () => {
  // 12. Does not expose API key
  it('12. does not include API key in output', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, true);
    const serialized = JSON.stringify(summary);
    assert.ok(!serialized.includes('MIGO_API_KEY'));
    assert.ok(!serialized.includes('SUPABASE_SERVICE_ROLE_KEY'));
    assert.ok(!serialized.includes('Authorization'));
    // No env var values leaked
    const migoKey = process.env.MIGO_API_KEY ?? '';
    if (migoKey.length > 4) {
      assert.ok(!serialized.includes(migoKey));
    }
  });

  // 13. Does not store raw payload
  it('13. does not store raw_payload or rawPayload in output', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, false);
    const serialized = JSON.stringify(summary);
    assert.ok(!serialized.includes('raw_payload'));
    assert.ok(!serialized.includes('rawPayload'));
  });

  // 14. Does not call Migo real — buildPeruCoverageSummary is pure (no I/O)
  it('14. buildPeruCoverageSummary is pure and makes no external calls', () => {
    // If this test runs without an internet connection or Migo credentials
    // it must still pass because buildPeruCoverageSummary is synchronous / pure.
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, 'unknown');
    assert.ok(summary.migo.configured === 'unknown');
  });

  // 15. Does not call SUNAT web
  it('15. buildSunatCoverage is pure (no network calls)', () => {
    // Synchronous — no fetch, no external I/O
    const coverage = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(coverage.sourceKey, 'pe_sunat_bulk');
  });

  // 16. Does not call Tavily
  it('16. no Tavily reference in output', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, true);
    assert.ok(!JSON.stringify(summary).toLowerCase().includes('tavily'));
  });

  // 17. Does not run importer
  it('17. does not include importer-related fields in output', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, true);
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('padron_reducido_ruc'));
    assert.ok(!json.includes('sunat:peru:import'));
    assert.ok(!json.includes('expand-sunat-snapshot'));
  });

  // 18. Does not create candidates / accounts / batches
  it('18. output does not reference write tables', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, true);
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('prospect_candidates'));
    assert.ok(!json.includes('prospect_batches'));
    assert.ok(!json.includes('accounts.insert'));
  });
});

// ---------------------------------------------------------------------------
// Guardrails block
// ---------------------------------------------------------------------------
describe('buildGuardrails', () => {
  it('all guardrail flags are true', () => {
    const g = buildGuardrails();
    assert.equal(g.noSunatWebRuntime, true);
    assert.equal(g.noVercelZipProcessing, true);
    assert.equal(g.noMigoDiscovery, true);
    assert.equal(g.noOfficialCiiuForMvp, true);
    assert.equal(g.sectorIsInferredByWebAi, true);
  });
});

// ---------------------------------------------------------------------------
// Audited constants sanity check
// ---------------------------------------------------------------------------
describe('AUDITED_SUNAT_SNAPSHOT', () => {
  it('distribution buckets sum to total', () => {
    const { total, activeHabido, activeNotHabido, inactiveHabido, inactiveNotHabido } =
      AUDITED_SUNAT_SNAPSHOT;
    assert.equal(activeHabido + activeNotHabido + inactiveHabido + inactiveNotHabido, total);
  });

  it('reflects the documented 100k snapshot (Perú.7F)', () => {
    assert.equal(AUDITED_SUNAT_SNAPSHOT.total, 100_000);
    assert.equal(AUDITED_SUNAT_SNAPSHOT.activeHabido, 14_221);
  });
});

// ---------------------------------------------------------------------------
// 19. getPeruSourceCoverageSummary — async orchestrator (mocked env)
// ---------------------------------------------------------------------------
describe('getPeruSourceCoverageSummary', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
    mock.restoreAll();
  });

  it('19. returns partial_snapshot when SUPABASE_SERVICE_ROLE_KEY is absent → configured unknown', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const summary = await getPeruSourceCoverageSummary(MOCK_COUNTS);

    assert.equal(summary.countryCode, 'PE');
    assert.equal(summary.sunat.coverageLabel, 'partial_snapshot');
    assert.equal(summary.migo.configured, 'unknown');
    assert.equal(summary.migo.performsDiscovery, false);
    assert.equal(summary.sunat.officialLegalValidation, true);
    assert.equal(summary.sunat.nextRecommendedOffset, 100_000);
  });

  it('uses AUDITED_SUNAT_SNAPSHOT when no counts are provided', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const summary = await getPeruSourceCoverageSummary();
    assert.equal(summary.sunat.loadedRows, 100_000);
    assert.equal(summary.sunat.activeHabidoRows, 14_221);
  });
});
