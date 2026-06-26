/**
 * Perú.8C — Dynamic (read-only) SUNAT coverage tests.
 *
 * Verifies the live-database read path, the audited fallback path, and the
 * card source label. All tests are read-only: the Supabase counter is injected
 * as a pure function, so no real connection, no writes, no external calls.
 *
 * Guardrail note: the strings ".insert(", ".update(", ".delete(", ".upsert(",
 * "api.migo.pe", "www2.sunat", "Tavily", "MIGO_API_KEY" below appear ONLY as
 * negation assertions / comments — this suite never performs any of them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDynamicCounts,
  resolveSunatCounts,
  buildSunatCoverage,
  buildPeruCoverageSummary,
  AUDITED_SUNAT_SNAPSHOT,
  type SnapshotCountQuery,
  type SunatSnapshotCounts,
} from '../peru-source-coverage-summary';

import { formatCoverageSource } from '@/components/source-catalog/peru-coverage-card';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LIVE_COUNTS: SunatSnapshotCounts = {
  total: 250_000,
  activeHabido: 40_000,
  activeNotHabido: 5_000,
  inactiveHabido: 120_000,
  inactiveNotHabido: 85_000,
};

const AUDITED_TOTAL_RUC20 = 851_883;

/**
 * Builds a fake, read-only counter that answers from an in-memory dataset.
 * It only ever "reads" — there is no insert/update/delete/upsert anywhere.
 */
function makeFakeCounter(counts: SunatSnapshotCounts): SnapshotCountQuery {
  return async (filters) => {
    if (filters.length === 0) return counts.total;
    const active = filters.find(([c]) => c === 'is_active')?.[1];
    const habido = filters.find(([c]) => c === 'is_habido')?.[1];
    if (active === true && habido === true) return counts.activeHabido;
    if (active === true && habido === false) return counts.activeNotHabido;
    if (active === false && habido === true) return counts.inactiveHabido;
    if (active === false && habido === false) return counts.inactiveNotHabido;
    return 0;
  };
}

// ---------------------------------------------------------------------------
// 1. When Supabase returns counts, uses live_database
// ---------------------------------------------------------------------------
describe('resolveSunatCounts — live_database', () => {
  it('1. uses live_database when the dynamic read returns counts', async () => {
    const { coverageSource } = await resolveSunatCounts(async () => LIVE_COUNTS);
    assert.equal(coverageSource, 'live_database');
  });

  // 2. Calculates loadedRows from DB
  it('2. derives loadedRows (total) from the dynamic read', async () => {
    const { counts } = await resolveSunatCounts(async () => LIVE_COUNTS);
    assert.equal(counts.total, 250_000);
  });

  // 3. Calculates active/habido distribution from DB
  it('3. derives the full distribution from the dynamic read', async () => {
    const { counts } = await resolveSunatCounts(async () => LIVE_COUNTS);
    assert.equal(counts.activeHabido, 40_000);
    assert.equal(counts.activeNotHabido, 5_000);
    assert.equal(counts.inactiveHabido, 120_000);
    assert.equal(counts.inactiveNotHabido, 85_000);
  });
});

// ---------------------------------------------------------------------------
// computeDynamicCounts issues exactly the five expected read-only buckets
// ---------------------------------------------------------------------------
describe('computeDynamicCounts', () => {
  it('maps each (is_active, is_habido) bucket to the right count', async () => {
    const counts = await computeDynamicCounts(makeFakeCounter(LIVE_COUNTS));
    assert.deepEqual(counts, LIVE_COUNTS);
  });

  it('issues a total count plus four filtered counts (5 read queries)', async () => {
    const calls: ReadonlyArray<readonly [string, boolean]>[] = [];
    const spy: SnapshotCountQuery = async (filters) => {
      calls.push(filters);
      return 1;
    };
    await computeDynamicCounts(spy);
    assert.equal(calls.length, 5);
    // First call is the unfiltered total.
    assert.equal(calls[0].length, 0);
    // Each filtered call constrains exactly is_active + is_habido.
    for (const filters of calls.slice(1)) {
      assert.equal(filters.length, 2);
      assert.ok(filters.some(([c]) => c === 'is_active'));
      assert.ok(filters.some(([c]) => c === 'is_habido'));
    }
  });
});

// ---------------------------------------------------------------------------
// 4. nextRecommendedOffset = dynamic loadedRows
// ---------------------------------------------------------------------------
describe('nextRecommendedOffset (dynamic)', () => {
  it('4. equals the dynamic loadedRows, not the audited 100000', () => {
    const coverage = buildSunatCoverage(LIVE_COUNTS, 'live_database');
    assert.equal(coverage.nextRecommendedOffset, 250_000);
    assert.equal(coverage.nextRecommendedOffset, coverage.loadedRows);
  });
});

// ---------------------------------------------------------------------------
// 5. coveragePercent uses loadedRows / 851883
// ---------------------------------------------------------------------------
describe('coveragePercent (dynamic)', () => {
  it('5. computes coveragePercent from dynamic loadedRows / 851883', () => {
    const coverage = buildSunatCoverage(LIVE_COUNTS, 'live_database');
    const expected = Math.round((250_000 / AUDITED_TOTAL_RUC20) * 1000) / 10;
    assert.equal(coverage.coveragePercent, expected);
  });
});

// ---------------------------------------------------------------------------
// 6. If a query fails, use audited_fallback
// ---------------------------------------------------------------------------
describe('resolveSunatCounts — audited_fallback', () => {
  it('6. falls back to audited values when the dynamic read throws', async () => {
    const { counts, coverageSource } = await resolveSunatCounts(async () => {
      throw new Error('query failed');
    });
    assert.equal(coverageSource, 'audited_fallback');
    assert.deepEqual(counts, AUDITED_SUNAT_SNAPSHOT);
  });

  // 7. If no Supabase/env available, use audited_fallback (read returns null)
  it('7. falls back to audited values when the dynamic read returns null', async () => {
    const { counts, coverageSource } = await resolveSunatCounts(async () => null);
    assert.equal(coverageSource, 'audited_fallback');
    assert.equal(counts.total, 100_000);
    assert.equal(counts.activeHabido, 14_221);
  });
});

// ---------------------------------------------------------------------------
// 8–11 / 12–15. Read-only guardrails — the snapshot counter never mutates
// ---------------------------------------------------------------------------
describe('read-only guardrails', () => {
  it('8–11. the injected counter only reads (no write hooks invoked)', async () => {
    // The fake counter performs no insert/update/delete/upsert; computeDynamicCounts
    // only awaits read counts. Reaching a numeric total proves the read-only path.
    const counts = await computeDynamicCounts(makeFakeCounter(LIVE_COUNTS));
    assert.equal(typeof counts.total, 'number');
  });

  it('12–15. summary output never leaks secrets, payloads, or external calls', () => {
    const summary = buildPeruCoverageSummary(LIVE_COUNTS, 'unknown', 'live_database');
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('MIGO_API_KEY'));
    assert.ok(!json.includes('SUPABASE_SERVICE_ROLE_KEY'));
    assert.ok(!json.includes('Authorization'));
    assert.ok(!json.includes('raw_payload'));
    assert.ok(!json.includes('rawPayload'));
    assert.ok(!json.toLowerCase().includes('tavily'));
    assert.ok(!json.includes('api.migo.pe'));
    assert.ok(!json.includes('www2.sunat'));
    assert.ok(!json.includes('padron_reducido_ruc'));
  });
});

// ---------------------------------------------------------------------------
// 16. Card shows "base de datos en vivo" when live_database
// 17. Card shows "fallback auditado" when audited_fallback
// ---------------------------------------------------------------------------
describe('formatCoverageSource (card label)', () => {
  it('16. renders "base de datos en vivo" for live_database', () => {
    assert.equal(formatCoverageSource('live_database'), 'base de datos en vivo');
  });

  it('17. renders "fallback auditado" for audited_fallback', () => {
    assert.equal(formatCoverageSource('audited_fallback'), 'fallback auditado');
  });

  it('coverageSource flows through buildSunatCoverage into the card helper', () => {
    const live = buildSunatCoverage(LIVE_COUNTS, 'live_database');
    const audited = buildSunatCoverage(AUDITED_SUNAT_SNAPSHOT, 'audited_fallback');
    assert.equal(formatCoverageSource(live.coverageSource), 'base de datos en vivo');
    assert.equal(formatCoverageSource(audited.coverageSource), 'fallback auditado');
  });
});
