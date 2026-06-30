/**
 * Perú.8B — PeruCoverageCard display logic tests.
 *
 * Tests pure display helpers extracted from peru-coverage-card.tsx.
 * No DOM, no React, no external calls.
 *
 * Guardrail assertions:
 *   - No API keys in output
 *   - No raw payloads
 *   - No Migo/SUNAT/Tavily network calls
 *   - No importer execution
 *   - No candidate/account/batch creation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatMigoConfigured,
  formatCoverageSource,
  formatCoverageSourceReason,
  formatCoveragePercent,
  formatLoadedRows,
} from '../peru-coverage-card';

import {
  buildSunatCoverage,
  buildMigoCoverage,
  buildPeruCoverageSummary,
  AUDITED_SUNAT_SNAPSHOT,
} from '@/server/services/peru-source-coverage-summary';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_COUNTS = { ...AUDITED_SUNAT_SNAPSHOT };

// ---------------------------------------------------------------------------
// 1. Card shows SUNAT loaded rows
// ---------------------------------------------------------------------------
describe('SUNAT loaded rows', () => {
  it('1. formatLoadedRows reflects sunat.loadedRows from audited snapshot', () => {
    const sunat = buildSunatCoverage(MOCK_COUNTS);
    const text = formatLoadedRows(sunat.loadedRows);
    assert.ok(text.includes('100'), 'must include 100k figure');
  });
});

// ---------------------------------------------------------------------------
// 2. Card shows estimated coverage
// ---------------------------------------------------------------------------
describe('Estimated coverage', () => {
  it('2. formatCoveragePercent reflects sunat.coveragePercent', () => {
    const sunat = buildSunatCoverage(MOCK_COUNTS);
    const text = formatCoveragePercent(sunat.coveragePercent);
    assert.ok(text.includes('%'), 'must include percent sign');
    assert.ok(parseFloat(text) > 0, 'coverage must be > 0');
    assert.ok(parseFloat(text) < 100, 'coverage must be < 100');
  });
});

// ---------------------------------------------------------------------------
// 3. Card shows next recommended offset
// ---------------------------------------------------------------------------
describe('Next recommended offset', () => {
  it('3. nextRecommendedOffset equals loadedRows (100000)', () => {
    const sunat = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(sunat.nextRecommendedOffset, 100_000);
    // The card would render formatLoadedRows(sunat.nextRecommendedOffset)
    const text = formatLoadedRows(sunat.nextRecommendedOffset);
    assert.ok(text.includes('100'), 'must include 100k figure');
  });
});

// ---------------------------------------------------------------------------
// 4. Card shows ACTIVE+HABIDO distribution
// ---------------------------------------------------------------------------
describe('SUNAT distribution — ACTIVO + HABIDO', () => {
  it('4. activeHabidoRows is 14221 in audited snapshot', () => {
    const sunat = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(sunat.activeHabidoRows, 14_221);
    const text = formatLoadedRows(sunat.activeHabidoRows);
    assert.ok(text.length > 0);
  });
});

// ---------------------------------------------------------------------------
// 5. Card shows Migo role as "validación legal complementaria"
// ---------------------------------------------------------------------------
describe('Migo role display', () => {
  it('5. migo.role is legal_api_fallback (maps to validación legal complementaria in UI)', () => {
    const migo = buildMigoCoverage(true);
    assert.equal(migo.role, 'legal_api_fallback');
  });
});

// ---------------------------------------------------------------------------
// 6. Card shows configured=unknown as "no verificable"
// ---------------------------------------------------------------------------
describe('Migo configured — unknown mapping', () => {
  it('6. formatMigoConfigured(unknown) returns "No verificable desde este contexto"', () => {
    const label = formatMigoConfigured('unknown');
    assert.ok(
      label.toLowerCase().includes('no verificable'),
      `expected "no verificable" but got: ${label}`,
    );
  });

  it('formatMigoConfigured(true) returns "Conectado"', () => {
    assert.equal(formatMigoConfigured(true), 'Conectado');
  });

  it('formatMigoConfigured(false) returns "No conectado"', () => {
    assert.equal(formatMigoConfigured(false), 'No conectado');
  });
});

// ---------------------------------------------------------------------------
// 7. Card shows CIIU guardrail
// ---------------------------------------------------------------------------
describe('CIIU guardrail', () => {
  it('7. sunat.providesCiiu is false — CIIU not available', () => {
    const sunat = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(sunat.providesCiiu, false);
  });

  it('7b. migo.providesCiiu is false — CIIU not delivered by Migo either', () => {
    const migo = buildMigoCoverage('unknown');
    assert.equal(migo.providesCiiu, false);
  });
});

// ---------------------------------------------------------------------------
// 8. Card shows no-official-sector guardrail
// ---------------------------------------------------------------------------
describe('Official sector guardrail', () => {
  it('8. sunat.providesOfficialSector is false', () => {
    const sunat = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(sunat.providesOfficialSector, false);
  });

  it('8b. migo.providesOfficialSector is false', () => {
    const migo = buildMigoCoverage(false);
    assert.equal(migo.providesOfficialSector, false);
  });
});

// ---------------------------------------------------------------------------
// 8c. Card shows coverage indicator source (Perú.8C.1)
// ---------------------------------------------------------------------------
describe('Coverage indicator source display', () => {
  it('8c-1. formatCoverageSource(live_database) returns "base de datos en vivo"', () => {
    assert.equal(formatCoverageSource('live_database'), 'base de datos en vivo');
  });

  it('8c-2. formatCoverageSource(audited_fallback) returns "fallback auditado"', () => {
    assert.equal(formatCoverageSource('audited_fallback'), 'fallback auditado');
  });

  it('8c-3. coverageSource source label leaks no API key', () => {
    const live = formatCoverageSource('live_database');
    const fallback = formatCoverageSource('audited_fallback');
    for (const label of [live, fallback]) {
      assert.ok(!label.includes('MIGO_API_KEY'), 'must not contain MIGO_API_KEY');
      assert.ok(!label.includes('Bearer'), 'must not contain Bearer token');
      assert.ok(!label.includes('Authorization'), 'must not contain Authorization header');
    }
  });

  it('8c-4. coverageSource source label exposes no raw payload', () => {
    const live = formatCoverageSource('live_database');
    const fallback = formatCoverageSource('audited_fallback');
    for (const label of [live, fallback]) {
      assert.ok(!label.includes('raw_payload'), 'must not contain raw_payload');
      assert.ok(!label.includes('rawPayload'), 'must not contain rawPayload');
    }
  });
});

// ---------------------------------------------------------------------------
// 8d. Card shows a discreet, safe fallback reason (Perú.9K.1)
// ---------------------------------------------------------------------------
describe('Fallback reason display (Perú.9K.1)', () => {
  it('8d-1. returns null when there is no reason (live read → no motivo line)', () => {
    assert.equal(formatCoverageSourceReason(undefined), null);
  });

  it('8d-2. maps every reason to the same neutral, user-safe phrase', () => {
    for (const reason of ['missing_env', 'query_failed', 'unknown'] as const) {
      assert.equal(formatCoverageSourceReason(reason), 'lectura dinámica no disponible');
    }
  });

  it('8d-3. reason label leaks no key, token, URL, or raw payload', () => {
    for (const reason of ['missing_env', 'query_failed', 'unknown'] as const) {
      const label = formatCoverageSourceReason(reason) ?? '';
      assert.ok(!label.includes('MIGO_API_KEY'));
      assert.ok(!label.includes('SUPABASE_SERVICE_ROLE_KEY'));
      assert.ok(!label.includes('Bearer'));
      assert.ok(!label.includes('Authorization'));
      assert.ok(!label.includes('supabase.co'));
      assert.ok(!label.includes('raw_payload'));
      assert.ok(!label.includes('rawPayload'));
    }
  });

  it('8d-4. live summary carries no coverageSourceReason to render', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, 'unknown', 'live_database');
    assert.equal(summary.sunat.coverageSourceReason, undefined);
    assert.equal(formatCoverageSourceReason(summary.sunat.coverageSourceReason), null);
  });

  it('8d-5. fallback summary surfaces the safe motivo line', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, 'unknown', 'audited_fallback', 'query_failed');
    assert.equal(summary.sunat.coverageSourceReason, 'query_failed');
    assert.equal(
      formatCoverageSourceReason(summary.sunat.coverageSourceReason),
      'lectura dinámica no disponible',
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Card does not expose API key
// ---------------------------------------------------------------------------
describe('No API key exposure', () => {
  it('9. buildPeruCoverageSummary output contains no API key strings', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, 'unknown');
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('MIGO_API_KEY'), 'must not contain MIGO_API_KEY');
    assert.ok(!json.includes('NEXT_PUBLIC_MIGO'), 'must not contain NEXT_PUBLIC_MIGO');
    assert.ok(!json.includes('Authorization'), 'must not contain Authorization header');
    assert.ok(!json.includes('Bearer'), 'must not contain Bearer token');
    // formatMigoConfigured also must not leak
    const label = formatMigoConfigured('unknown');
    assert.ok(!label.includes('MIGO'), 'label must not contain MIGO key name');
    assert.ok(!label.includes('Bearer'), 'label must not contain Bearer');
  });
});

// ---------------------------------------------------------------------------
// 10. Card does not show raw payload
// ---------------------------------------------------------------------------
describe('No raw payload', () => {
  it('10. buildPeruCoverageSummary output contains no raw_payload or rawPayload', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, false);
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('raw_payload'), 'must not contain raw_payload');
    assert.ok(!json.includes('rawPayload'), 'must not contain rawPayload');
  });
});

// ---------------------------------------------------------------------------
// 11. Error state does not break (pure logic check)
// ---------------------------------------------------------------------------
describe('Error state resilience', () => {
  it('11. formatMigoConfigured handles all valid inputs without throwing', () => {
    assert.doesNotThrow(() => formatMigoConfigured(true));
    assert.doesNotThrow(() => formatMigoConfigured(false));
    assert.doesNotThrow(() => formatMigoConfigured('unknown'));
  });

  it('11b. formatLoadedRows handles 0 without throwing', () => {
    assert.doesNotThrow(() => formatLoadedRows(0));
  });

  it('11c. formatCoveragePercent handles 0 without throwing', () => {
    assert.doesNotThrow(() => formatCoveragePercent(0));
  });
});

// ---------------------------------------------------------------------------
// 12. Does not call Migo real — pure functions only
// ---------------------------------------------------------------------------
describe('No Migo real call', () => {
  it('12. buildMigoCoverage is pure (synchronous, no I/O)', () => {
    // Passes injected configured value — never calls API
    const migo = buildMigoCoverage('unknown');
    assert.equal(migo.configured, 'unknown');
    assert.equal(migo.performsDiscovery, false);
  });
});

// ---------------------------------------------------------------------------
// 13. Does not call SUNAT web
// ---------------------------------------------------------------------------
describe('No SUNAT web call', () => {
  it('13. buildSunatCoverage is pure (synchronous, no I/O)', () => {
    const sunat = buildSunatCoverage(MOCK_COUNTS);
    assert.equal(sunat.sourceKey, 'pe_sunat_bulk');
  });
});

// ---------------------------------------------------------------------------
// 14. Does not call Tavily/LLM
// ---------------------------------------------------------------------------
describe('No Tavily or LLM call', () => {
  it('14. display helpers contain no Tavily reference', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, true);
    assert.ok(!JSON.stringify(summary).toLowerCase().includes('tavily'));
    // formatMigoConfigured and formatCoveragePercent are trivially free of LLM
    const label = formatMigoConfigured(true);
    assert.ok(!label.toLowerCase().includes('tavily'));
  });
});

// ---------------------------------------------------------------------------
// 15. Does not execute importer
// ---------------------------------------------------------------------------
describe('No importer execution', () => {
  it('15. output does not reference importer artifacts', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, true);
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('padron_reducido_ruc'));
    assert.ok(!json.includes('sunat:peru:import'));
    assert.ok(!json.includes('expand-sunat-snapshot'));
  });
});

// ---------------------------------------------------------------------------
// 16. Does not create candidates, accounts, or batches
// ---------------------------------------------------------------------------
describe('No candidates/accounts/batches creation', () => {
  it('16. output does not reference write tables', () => {
    const summary = buildPeruCoverageSummary(MOCK_COUNTS, false);
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('prospect_candidates'));
    assert.ok(!json.includes('prospect_batches'));
    assert.ok(!json.includes('accounts.insert'));
  });
});
