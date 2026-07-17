/**
 * Tests — pa-panamacompra-convenio-lookup.ts
 *
 * Centroamérica.5F original behaviour + EC4D5.APP-C5-R2 native contract migration.
 *
 * pa_panamacompra_convenio is NATIVE_RECORD_GRAIN: a single fiscal identity (RUC)
 * can legitimately map to more than one record. This reader was migrated away
 * from `.limit(1).maybeSingle()` (silent pick) onto the cardinality-aware native
 * snapshot-read contract:
 *   - exact year   → probeNativeSnapshotsByTaxId
 *   - latest (no year, production path) → probeLatestNativeSnapshotsByTaxId
 *
 * These tests verify:
 * - matched / not_found / snapshot_unavailable / invalid_ruc external shape
 * - native multi-record ambiguity is OBSERVABLE (never a silent match)
 * - latest-year resolution picks the most recent source_year unambiguously
 * - DB errors surface as query_error, NOT not-found
 * - the reader uses the native contract, not the TAX_GRAIN contract, and no
 *   longer does `.limit(1).maybeSingle()`
 * - the reader does not import panamacompra builders/writers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lookupPanamaCompraConvenioByRuc,
} from '../pa-panamacompra-convenio-lookup';
import type { PaPanamaCompraLookupResult } from '../pa-panamacompra-convenio-lookup';
import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from '../../source-catalog/snapshot-read/__tests__/snapshot-read-fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_KEY = 'pa_panamacompra_convenio';
const COUNTRY_CODE = 'PA';
const RUC = '8-123-456789';

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: 2024,
    normalized_tax_id: RUC,
    legal_name: 'EMPRESA TEST SA',
    record_identity_key: null,
    raw_data: {
      representative_name: 'Juan Pérez',
      phone: '6000-0000',
      email: 'contacto@empresa.com',
      address: 'Ciudad de Panamá',
      convenios: ['CONVENIO-001'],
      branches: [],
    },
    ...overrides,
  };
}

function fake(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  return createFakeSnapshotSupabaseClient(rows) as unknown as SupabaseClient;
}

/**
 * Minimal client whose list resolution returns a PostgREST error, so the reader
 * exercises its DB-error path. The APP-C2 fake never errors on the list path.
 */
function erroringClient(): SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.then = (onfulfilled: (v: unknown) => unknown) =>
    Promise.resolve({
      data: null,
      error: { code: 'XX000', message: 'boom' },
    }).then(onfulfilled);
  return { from: () => builder } as unknown as SupabaseClient;
}

// ── invalid RUC ───────────────────────────────────────────────────────────────

describe('lookupPanamaCompraConvenioByRuc — invalid RUC', () => {
  it('empty string → matched=false, reason=invalid_ruc_format', async () => {
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '' }, fake([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_ruc_format');
  });
});

// ── snapshot unavailable ──────────────────────────────────────────────────────

describe('lookupPanamaCompraConvenioByRuc — snapshot unavailable', () => {
  it('no override and no service key → matched=false, reason=snapshot_unavailable', async () => {
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: RUC });
    process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_unavailable');
  });
});

// ── exact-year path (probeNativeSnapshotsByTaxId) ─────────────────────────────

describe('lookupPanamaCompraConvenioByRuc — exact year', () => {
  it('0 rows → no-match (no_snapshot_match_by_ruc)', async () => {
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: RUC, year: 2024 },
      fake([]),
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match_by_ruc');
    assert.equal(result.procurement_summary, null);
  });

  it('1 row → match with preserved shape', async () => {
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: RUC, year: 2024 },
      fake([row()]),
    );
    assert.equal(result.matched, true);
    assert.equal(result.reason, null);
    assert.equal(result.source_year, 2024);
    assert.equal(result.legal_name, 'EMPRESA TEST SA');
    assert.equal(result.normalized_tax_id, RUC);
    assert.ok(result.procurement_summary);
    assert.equal(result.procurement_summary.coverage_scope, 'convenio_marco');
    assert.deepEqual(result.procurement_summary.convenios, ['CONVENIO-001']);
  });

  it('2 rows same tax/year → MULTI observable (snapshot_cardinality_violation)', async () => {
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: RUC, year: 2024 },
      fake([
        row({ record_identity_key: 'pa:a' }),
        row({ record_identity_key: 'pa:b' }),
      ]),
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
    assert.equal(result.procurement_summary, null);
  });
});

// ── latest path (probeLatestNativeSnapshotsByTaxId) ───────────────────────────

describe('lookupPanamaCompraConvenioByRuc — latest (no year)', () => {
  it('0 rows → no-match (no_snapshot_match_by_ruc)', async () => {
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: RUC }, fake([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match_by_ruc');
  });

  it('1 row → match', async () => {
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: RUC }, fake([row()]));
    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2024);
  });

  it('2 rows different years → FOUND latest year', async () => {
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: RUC },
      fake([
        row({ source_year: 2023, record_identity_key: 'pa:2023' }),
        row({ source_year: 2025, record_identity_key: 'pa:2025' }),
      ]),
    );
    assert.equal(result.matched, true);
    assert.equal(result.reason, null);
    assert.equal(result.source_year, 2025);
  });

  it('2 rows same source_year → MULTI observable (snapshot_cardinality_violation)', async () => {
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: RUC },
      fake([
        row({ source_year: 2025, record_identity_key: 'pa:a' }),
        row({ source_year: 2025, record_identity_key: 'pa:b' }),
      ]),
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
  });
});

// ── DB error ──────────────────────────────────────────────────────────────────

describe('lookupPanamaCompraConvenioByRuc — DB error', () => {
  it('list query error → snapshot_query_error, NOT not-found', async () => {
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: RUC },
      erroringClient(),
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_query_error');
    assert.notEqual(result.reason, 'no_snapshot_match_by_ruc');
  });

  it('exact-year list query error → snapshot_query_error', async () => {
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: RUC, year: 2024 },
      erroringClient(),
    );
    assert.equal(result.reason, 'snapshot_query_error');
  });
});

// ── guardrail: source_key / country_code preserved ────────────────────────────

describe('lookupPanamaCompraConvenioByRuc — guardrails', () => {
  it('reads source_key pa_panamacompra_convenio + country_code PA (mismatch → no match)', async () => {
    // A row under a different source_key must not be returned.
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: RUC },
      fake([row({ source_key: 'other_source', country_code: 'CR' })]),
    );
    assert.equal(result.matched, false);
  });

  it('normalizes RUC by stripping spaces before lookup', async () => {
    const result = await lookupPanamaCompraConvenioByRuc(
      { ruc: ' 8-123-456789 ' },
      fake([row()]),
    );
    assert.equal(result.matched, true);
    assert.equal(result.normalized_tax_id, RUC);
  });
});

// ── static source verification ────────────────────────────────────────────────

describe('pa-panamacompra-convenio-lookup — static contract usage', () => {
  const readerSource = readFileSync(
    fileURLToPath(new URL('../pa-panamacompra-convenio-lookup.ts', import.meta.url)),
    'utf8',
  );

  it('does NOT use .limit(1).maybeSingle()', () => {
    assert.ok(!/limit\(\s*1\s*\)/.test(readerSource));
    assert.ok(!readerSource.includes('maybeSingle'));
  });

  it('does NOT use readTaxGrainSnapshotByTaxId', () => {
    assert.ok(!readerSource.includes('readTaxGrainSnapshotByTaxId'));
  });

  it('does NOT use readLatestTaxGrainSnapshotByTaxId', () => {
    assert.ok(!readerSource.includes('readLatestTaxGrainSnapshotByTaxId'));
  });

  it('uses probeNativeSnapshotsByTaxId for the exact-year path', () => {
    assert.ok(readerSource.includes('probeNativeSnapshotsByTaxId'));
  });

  it('uses probeLatestNativeSnapshotsByTaxId for the production path without year', () => {
    assert.ok(readerSource.includes('probeLatestNativeSnapshotsByTaxId'));
  });

  it('does not import panamacompra builders or writers', () => {
    assert.ok(!/snapshot-builder/.test(readerSource));
    assert.ok(!/snapshot-writer/.test(readerSource));
    assert.ok(!/-writer/.test(readerSource));
  });

  it('external result shape keys are preserved', () => {
    const sample: PaPanamaCompraLookupResult = {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: null,
      procurement_summary: null,
      raw_data: null,
      reason: null,
    };
    assert.deepEqual(Object.keys(sample).sort(), [
      'legal_name',
      'matched',
      'normalized_tax_id',
      'procurement_summary',
      'raw_data',
      'reason',
      'source_year',
    ]);
  });
});
