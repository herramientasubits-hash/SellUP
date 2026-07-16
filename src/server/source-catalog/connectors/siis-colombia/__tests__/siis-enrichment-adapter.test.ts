// Tests — SIIS Colombia enrichment adapter
//
// Verifica buildSiisMatchResult, guard clauses y — tras EC4D5.APP-C4C — el
// contrato cardinality-aware para el tax-id path y el fallback por nombre
// scoped. Sin llamadas reales a Supabase. Sin internet.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildSiisMatchResult,
  enrichCoSiisCandidate,
  siisEnrichmentAdapter,
} from '../siis-enrichment-adapter';
import type { SourceEnrichmentInput } from '../../../enrichment/types';
import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from '../../../snapshot-read/__tests__/snapshot-read-fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function coSiisRow(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: 'co_siis',
    country_code: 'CO',
    source_year: 2024,
    normalized_tax_id: '900123456',
    normalized_legal_name: 'tecnologia avanzada',
    legal_name: 'Tecnología Avanzada SAS',
    priority_score: 7,
    sector: 'Servicios',
    city: 'Bogotá',
    department: 'Cundinamarca',
    financials: { operatingRevenueCurrent: 50 },
    signals: { supervisor: 'Supersociedades', ciiu: '6201' },
    imported_at: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

function fakeClient(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  return createFakeSnapshotSupabaseClient(rows) as unknown as SupabaseClient;
}

function input(overrides: Partial<SourceEnrichmentInput> = {}): SourceEnrichmentInput {
  return {
    candidateName: 'Tecnología Avanzada',
    countryCode: 'CO',
    capability: 'enrichment_after_discovery',
    ...overrides,
  };
}

/**
 * Local ilike-aware fake: the shared APP-C2 snapshot fake models the exact
 * `eq/order/limit/maybeSingle` chain the cardinality-aware contract uses, but
 * deliberately does NOT support `.ilike`. The name fallback needs it, so this
 * minimal fake supports the fallback's exact chain
 * (eq → ilike → limit → thenable) and nothing else.
 */
function fakeNameClient(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  const snapshot = rows.map((r) => ({ ...r }));
  return {
    from() {
      const filters: Array<[string, unknown]> = [];
      const ilikes: Array<[string, string]> = [];
      let limitCount: number | null = null;
      const resolve = (): FakeSnapshotRow[] => {
        let matched = snapshot.filter((row) =>
          filters.every(([col, val]) => row[col] === val),
        );
        for (const [col, pattern] of ilikes) {
          const needle = pattern.replace(/%/g, '').toLowerCase();
          matched = matched.filter((row) =>
            String(row[col] ?? '').toLowerCase().includes(needle),
          );
        }
        if (limitCount !== null) matched = matched.slice(0, limitCount);
        return matched;
      };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, val: unknown) => {
        filters.push([col, val]);
        return q;
      };
      q.ilike = (col: string, pattern: string) => {
        ilikes.push([col, pattern]);
        return q;
      };
      q.order = () => q;
      q.limit = (n: number) => {
        limitCount = n;
        return q;
      };
      q.then = (onf: (v: { data: FakeSnapshotRow[]; error: null }) => unknown) =>
        Promise.resolve({ data: resolve(), error: null }).then(onf);
      return q as unknown as ReturnType<SupabaseClient['from']>;
    },
  } as unknown as SupabaseClient;
}

// ─── 1. buildSiisMatchResult ─────────────────────────────────────────────────

describe('buildSiisMatchResult', () => {
  it('builds matched result with priority boost for high revenue', () => {
    const row = {
      source_year: 2024,
      source_key: 'co_siis',
      legal_name: 'Tecnología Avanzada SAS',
      normalized_tax_id: '900123456',
      priority_score: 7,
      sector: 'Servicios',
      city: 'Bogotá',
      department: 'Cundinamarca',
      financials: {
        operatingRevenueCurrent: 50,
        profitLossCurrent: 5,
      },
      signals: { supervisor: 'Supersociedades', ciiu: '6201' },
    };

    const result = buildSiisMatchResult(row, 'tax_id', 0.95);

    assert.equal(result.sourceKey, 'co_siis');
    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.confidence, 0.95);
    assert.equal(result.sourceYear, 2024);
    assert.equal(result.priorityBoost, 2);
    assert.equal((result.signals as Record<string, unknown>)['sector'], 'Servicios');
    assert.equal((result.signals as Record<string, unknown>)['city'], 'Bogotá');
  });

  it('priority boost 3 for revenue > 100B COP', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 200 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 3);
  });

  it('priority boost 2 for revenue > 10B COP', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 24.75 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 2);
  });

  it('priority boost 1 for revenue > 1B COP', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 5 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 1);
  });

  it('priority boost 0 for revenue <= 1B COP', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 0.5 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 0);
  });

  it('ECOPETROL-like: 113.92 → priority boost 3', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 113.92 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 3);
  });

  it('D1-like: 19.44 → priority boost 2', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 19.44 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 2);
  });

  it('priority boost 0 when no revenue', () => {
    const result = buildSiisMatchResult({}, 'tax_id', 0.95);
    assert.equal(result.priorityBoost, 0);
  });

  it('includes signals and metadata', () => {
    const row = {
      legal_name: 'Empresa Test',
      normalized_tax_id: '800123456',
      priority_score: 5,
      financials: { operatingRevenueCurrent: 2 },
      signals: { supervisor: 'Test', ciiu: '1234' },
    };

    const result = buildSiisMatchResult(row, 'normalized_name', 0.6);
    assert.equal(result.matchedBy, 'normalized_name');
    assert.equal(result.confidence, 0.6);
    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['legal_name'], 'Empresa Test');
    assert.equal(meta['normalized_tax_id'], '800123456');
    assert.equal(meta['priority_score'], 5);
  });
});

// ─── 2. Adapter guard clauses ─────────────────────────────────────────────────

describe('siisEnrichmentAdapter enrichCandidate — guard clauses', () => {
  it('returns skipped for non-CO country', async () => {
    const result = await siisEnrichmentAdapter.enrichCandidate(input({ countryCode: 'MX' }));
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'country_not_supported');
  });

  it('returns skipped when no supabase client available', async () => {
    // Relies on SUPABASE_SERVICE_ROLE_KEY not being set in the test env.
    const result = await siisEnrichmentAdapter.enrichCandidate(
      input({ candidateTaxId: '900123456' }),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'snapshot_not_available');
  });
});

// ─── 3. Tax-id path (cardinality-aware contract) ───────────────────────────────

describe('siisEnrichmentAdapter — tax-id path', () => {
  it('valid tax id + 0 rows for that NIT (snapshot loaded) → no_match', async () => {
    const sb = fakeClient([coSiisRow({ normalized_tax_id: '111111111' })]);
    const result = await enrichCoSiisCandidate(
      input({ candidateTaxId: '900123456' }),
      sb,
    );
    assert.equal(result.status, 'no_match');
    assert.equal(result.matchedBy, null);
  });

  it('valid tax id + 1 row → matched tax_id 0.95', async () => {
    const sb = fakeClient([coSiisRow()]);
    const result = await enrichCoSiisCandidate(
      input({ candidateTaxId: '900.123.456-7' }),
      sb,
    );
    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.confidence, 0.95);
    assert.equal(result.sourceYear, 2024);
  });

  it('valid tax id + 2 rows same source_year → cardinality violation observable', async () => {
    const sb = fakeClient([
      coSiisRow({ source_year: 2024, city: 'Bogotá' }),
      coSiisRow({ source_year: 2024, city: 'Medellín' }),
    ]);
    const result = await enrichCoSiisCandidate(
      input({ candidateTaxId: '900123456' }),
      sb,
    );
    assert.equal(result.status, 'no_match');
    assert.equal(result.reason, 'snapshot_cardinality_violation');
  });

  it('valid tax id across two years → uses most recent year', async () => {
    const sb = fakeClient([
      coSiisRow({ source_year: 2022 }),
      coSiisRow({ source_year: 2024 }),
    ]);
    const result = await enrichCoSiisCandidate(
      input({ candidateTaxId: '900123456' }),
      sb,
    );
    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.sourceYear, 2024);
  });

  it('empty tax id + no name match → no_match (no fiscal lookup)', async () => {
    const sb = fakeClient([coSiisRow()]);
    const result = await enrichCoSiisCandidate(
      input({ candidateTaxId: '', candidateName: 'zz' }),
      sb,
    );
    // '' has no valid tax id → falls to name path; name too short → no_match.
    assert.equal(result.status, 'no_match');
  });

  it('empty snapshot → skipped snapshot_not_available', async () => {
    const sb = fakeClient([]);
    const result = await enrichCoSiisCandidate(
      input({ candidateTaxId: '900123456' }),
      sb,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'snapshot_not_available');
  });

  it('DB error → status error (not no_match/not-found)', async () => {
    const erroringClient = {
      from: () => ({
        select: () => {
          const q: Record<string, unknown> = {};
          q.eq = () => q;
          q.order = () => q;
          q.limit = () => q;
          q.then = (onf: (v: { data: null; error: { code: string; message: string } }) => unknown) =>
            Promise.resolve({ data: null, error: { code: 'XX000', message: 'DB error' } }).then(onf);
          return q;
        },
      }),
    } as unknown as SupabaseClient;

    const result = await enrichCoSiisCandidate(
      input({ candidateTaxId: '900123456' }),
      erroringClient,
    );
    assert.equal(result.status, 'error');
  });
});

// ─── 4. Fuzzy-name path (scoped, non-arbitrary) ────────────────────────────────

describe('siisEnrichmentAdapter — name fallback path', () => {
  it('no tax id + name without match → no_match', async () => {
    const sb = fakeNameClient([
      coSiisRow({ source_year: 2024, normalized_legal_name: 'otra empresa' }),
    ]);
    const result = await enrichCoSiisCandidate(
      input({ candidateName: 'Empresa Inexistente' }),
      sb,
    );
    assert.equal(result.status, 'no_match');
  });

  it('no tax id + exactly 1 scoped name match → normalized_name 0.60', async () => {
    const sb = fakeNameClient([coSiisRow({ source_year: 2024 })]);
    const result = await enrichCoSiisCandidate(
      input({ candidateName: 'Tecnología Avanzada SAS' }),
      sb,
    );
    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'normalized_name');
    assert.equal(result.confidence, 0.6);
  });

  it('no tax id + multiple fuzzy matches → ambiguous no_match (no arbitrary pick)', async () => {
    const sb = fakeNameClient([
      coSiisRow({ source_year: 2024, normalized_tax_id: '900000001', normalized_legal_name: 'tecnologia avanzada uno' }),
      coSiisRow({ source_year: 2024, normalized_tax_id: '900000002', normalized_legal_name: 'tecnologia avanzada dos' }),
    ]);
    const result = await enrichCoSiisCandidate(
      input({ candidateName: 'Tecnología Avanzada' }),
      sb,
    );
    assert.equal(result.status, 'no_match');
    assert.equal(result.reason, 'ambiguous_name_match');
  });

  it('name path does NOT run when a valid tax id is present', async () => {
    // Snapshot has a name match but a DIFFERENT NIT than requested. With a valid
    // tax id, the fiscal miss must win (no_match), never the fuzzy name match.
    const sb = fakeClient([
      coSiisRow({ normalized_tax_id: '111111111', normalized_legal_name: 'tecnologia avanzada' }),
    ]);
    const result = await enrichCoSiisCandidate(
      input({ candidateTaxId: '900123456', candidateName: 'Tecnología Avanzada' }),
      sb,
    );
    assert.equal(result.status, 'no_match');
    assert.notEqual(result.matchedBy, 'normalized_name');
  });
});

// ─── 5. Static: migrated off .limit(1).maybeSingle for identity ────────────────

describe('siis-enrichment-adapter — migrated off .limit(1).maybeSingle', () => {
  const raw = readFileSync(new URL('../siis-enrichment-adapter.ts', import.meta.url), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('adapter code contains no maybeSingle call', () => {
    assert.ok(!code.includes('maybeSingle'), 'adapter must not call maybeSingle');
  });

  it('adapter code contains no .limit(1).maybeSingle chain', () => {
    assert.ok(!/\.limit\(1\)\s*\.\s*maybeSingle/.test(code));
  });

  it('tax-id path uses the snapshot-read contract', () => {
    assert.ok(code.includes('readLatestTaxGrainSnapshotByTaxId'));
  });

  it('queries are scoped by source_key and country_code', () => {
    assert.ok(code.includes("'co_siis'"), 'must reference co_siis source_key');
    assert.ok(code.includes("'CO'"), 'must reference CO country_code');
    assert.ok(code.includes("eq('source_key'"), 'raw queries must filter source_key');
    assert.ok(code.includes("eq('country_code'"), 'raw queries must filter country_code');
  });
});
