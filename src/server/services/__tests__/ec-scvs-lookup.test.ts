/**
 * Tests — ec-scvs-lookup.ts (EC-SCVS-4).
 *
 * ec_scvs is NATIVE_RECORD_GRAIN: the physical row identity is `expediente`,
 * and a single fiscal identity (RUC) can legitimately map to more than one
 * expediente. The reader is built on the cardinality-aware snapshot-read
 * contract:
 *   - by expediente (exact record identity) → readSnapshotByRecordIdentityKey
 *   - by RUC + year                          → probeNativeSnapshotsByTaxId
 *   - by RUC latest (no year)                → probeLatestNativeSnapshotsByTaxId
 *
 * These tests verify:
 * - matched / not_found / snapshot_unavailable / invalid-input external shape
 * - exact expediente lookup returns exactly its row, never an arbitrary one
 * - a RUC mapping to multiple expedientes is OBSERVABLE (multiplicity, never a
 *   silent pick), exposing record_count + record_identity_keys
 * - latest-year RUC resolution picks the most recent source_year unambiguously
 * - DB errors surface as snapshot_query_error, NOT not-found
 * - the reader uses the native + record-identity contracts, not TAX_GRAIN, and
 *   never does `.limit(1).maybeSingle()`
 * - the reader does not import SCVS builders/writers (no write path)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lookupEcScvsByExpediente,
  lookupEcScvsByRuc,
  lookupLatestEcScvsByRuc,
} from '../ec-scvs-lookup';
import type { EcScvsLookupResult } from '../ec-scvs-lookup';
import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from '../../source-catalog/snapshot-read/__tests__/snapshot-read-fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_KEY = 'ec_scvs';
const COUNTRY_CODE = 'EC';
const RUC = '1790013731001';
const EXPEDIENTE = '90210';
const YEAR = 2026;

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: YEAR,
    normalized_tax_id: RUC,
    legal_name: 'COMPANIA DE PRUEBA SA',
    record_identity_key: `expediente:${EXPEDIENTE}`,
    raw_data: {
      source_type: 'official_company_registry',
      legal_validation_status: 'not_applicable',
      tax_validation_status: 'not_applicable',
      human_review_required: true,
      source_status: 'active_or_listed',
      expediente: EXPEDIENTE,
      ruc: RUC,
      nombre: 'COMPANIA DE PRUEBA SA',
      tipo: 'ANONIMA',
      pro_codigo: '17',
      provincia: 'PICHINCHA',
      ruc_normalization_status: 'valid',
      source_row_index: 0,
    },
    ...overrides,
  };
}

function fake(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  return createFakeSnapshotSupabaseClient(rows) as unknown as SupabaseClient;
}

/**
 * Minimal client whose list/single resolution returns a PostgREST error, so the
 * reader exercises its DB-error path. The APP-C2 fake never errors on read.
 */
function erroringClient(): SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.maybeSingle = () =>
    Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } });
  builder.then = (onfulfilled: (v: unknown) => unknown) =>
    Promise.resolve({
      data: null,
      error: { code: 'XX000', message: 'boom' },
    }).then(onfulfilled);
  return { from: () => builder } as unknown as SupabaseClient;
}

// ── invalid input ───────────────────────────────────────────────────────────

describe('ec-scvs-lookup — invalid input', () => {
  it('empty expediente → matched=false, reason=invalid_expediente', async () => {
    const result = await lookupEcScvsByExpediente({ expediente: '', year: YEAR }, fake([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_expediente');
  });

  it('empty RUC (exact year) → matched=false, reason=invalid_ruc', async () => {
    const result = await lookupEcScvsByRuc({ ruc: '', year: YEAR }, fake([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_ruc');
  });

  it('malformed RUC (wrong length) → invalid_ruc', async () => {
    const result = await lookupLatestEcScvsByRuc({ ruc: '123' }, fake([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_ruc');
  });
});

// ── snapshot unavailable ──────────────────────────────────────────────────────

describe('ec-scvs-lookup — snapshot unavailable', () => {
  it('no override and no service key → snapshot_unavailable', async () => {
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await lookupEcScvsByRuc({ ruc: RUC, year: YEAR });
    process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_unavailable');
  });
});

// ── exact lookup by expediente ────────────────────────────────────────────────

describe('lookupEcScvsByExpediente', () => {
  it('0 rows → no_snapshot_match', async () => {
    const result = await lookupEcScvsByExpediente(
      { expediente: EXPEDIENTE, year: YEAR },
      fake([]),
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match');
    assert.equal(result.company_summary, null);
  });

  it('1 row → match with company summary + identity echoed', async () => {
    const result = await lookupEcScvsByExpediente(
      { expediente: EXPEDIENTE, year: YEAR },
      fake([row()]),
    );
    assert.equal(result.matched, true);
    assert.equal(result.reason, null);
    assert.equal(result.record_identity_key, `expediente:${EXPEDIENTE}`);
    assert.equal(result.source_year, YEAR);
    assert.equal(result.legal_name, 'COMPANIA DE PRUEBA SA');
    assert.equal(result.normalized_tax_id, RUC);
    assert.ok(result.company_summary);
    assert.equal(result.company_summary.source_type, 'official_company_registry');
    assert.equal(result.company_summary.expediente, EXPEDIENTE);
    assert.equal(result.company_summary.provincia, 'PICHINCHA');
    assert.equal(result.company_summary.human_review_required, true);
  });

  it('trims the expediente before building the identity key', async () => {
    const result = await lookupEcScvsByExpediente(
      { expediente: `  ${EXPEDIENTE}  `, year: YEAR },
      fake([row()]),
    );
    assert.equal(result.matched, true);
    assert.equal(result.record_identity_key, `expediente:${EXPEDIENTE}`);
  });

  it('does NOT return a row from a different year (year is part of identity tuple)', async () => {
    const result = await lookupEcScvsByExpediente(
      { expediente: EXPEDIENTE, year: 2099 },
      fake([row()]),
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match');
  });

  it('DB error → snapshot_query_error, NOT not-found', async () => {
    const result = await lookupEcScvsByExpediente(
      { expediente: EXPEDIENTE, year: YEAR },
      erroringClient(),
    );
    assert.equal(result.reason, 'snapshot_query_error');
    assert.notEqual(result.reason, 'no_snapshot_match');
  });
});

// ── lookup by RUC (exact year) ────────────────────────────────────────────────

describe('lookupEcScvsByRuc — exact year', () => {
  it('0 rows → no_snapshot_match', async () => {
    const result = await lookupEcScvsByRuc({ ruc: RUC, year: YEAR }, fake([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match');
  });

  it('1 row → match', async () => {
    const result = await lookupEcScvsByRuc({ ruc: RUC, year: YEAR }, fake([row()]));
    assert.equal(result.matched, true);
    assert.equal(result.source_year, YEAR);
    assert.equal(result.normalized_tax_id, RUC);
  });

  it('2 expedientes, same RUC/year → multiplicity observable (never a silent pick)', async () => {
    const result = await lookupEcScvsByRuc(
      { ruc: RUC, year: YEAR },
      fake([
        row({ record_identity_key: 'expediente:A' }),
        row({ record_identity_key: 'expediente:B' }),
      ]),
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'multiple_records_same_ruc');
    assert.equal(result.company_summary, null);
    assert.equal(result.record_count, 2);
    assert.deepEqual([...(result.record_identity_keys ?? [])].sort(), [
      'expediente:A',
      'expediente:B',
    ]);
  });

  it('normalizes the RUC (strips dashes/spaces) before lookup', async () => {
    const result = await lookupEcScvsByRuc(
      { ruc: ' 1790-013731-001 ', year: YEAR },
      fake([row()]),
    );
    assert.equal(result.matched, true);
    assert.equal(result.normalized_tax_id, RUC);
  });

  it('DB error → snapshot_query_error', async () => {
    const result = await lookupEcScvsByRuc({ ruc: RUC, year: YEAR }, erroringClient());
    assert.equal(result.reason, 'snapshot_query_error');
  });
});

// ── lookup by RUC (latest year) ───────────────────────────────────────────────

describe('lookupLatestEcScvsByRuc — latest year', () => {
  it('0 rows → no_snapshot_match', async () => {
    const result = await lookupLatestEcScvsByRuc({ ruc: RUC }, fake([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match');
  });

  it('1 row → match', async () => {
    const result = await lookupLatestEcScvsByRuc({ ruc: RUC }, fake([row()]));
    assert.equal(result.matched, true);
    assert.equal(result.source_year, YEAR);
  });

  it('2 rows different years → FOUND the latest year', async () => {
    const result = await lookupLatestEcScvsByRuc(
      { ruc: RUC },
      fake([
        row({ source_year: 2024, record_identity_key: 'expediente:2024' }),
        row({ source_year: 2026, record_identity_key: 'expediente:2026' }),
      ]),
    );
    assert.equal(result.matched, true);
    assert.equal(result.reason, null);
    assert.equal(result.source_year, 2026);
    assert.equal(result.record_identity_key, 'expediente:2026');
  });

  it('2 rows same latest year → multiplicity observable', async () => {
    const result = await lookupLatestEcScvsByRuc(
      { ruc: RUC },
      fake([
        row({ source_year: 2026, record_identity_key: 'expediente:A' }),
        row({ source_year: 2026, record_identity_key: 'expediente:B' }),
      ]),
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'multiple_records_same_ruc');
    assert.equal(result.record_count, 2);
  });

  it('DB error → snapshot_query_error', async () => {
    const result = await lookupLatestEcScvsByRuc({ ruc: RUC }, erroringClient());
    assert.equal(result.reason, 'snapshot_query_error');
  });
});

// ── guardrails ────────────────────────────────────────────────────────────────

describe('ec-scvs-lookup — guardrails', () => {
  it('reads source_key ec_scvs + country_code EC (mismatch → no match)', async () => {
    const result = await lookupEcScvsByRuc(
      { ruc: RUC, year: YEAR },
      fake([row({ source_key: 'other_source', country_code: 'CO' })]),
    );
    assert.equal(result.matched, false);
  });

  it('a RUC-null row is only reachable by expediente, not by RUC', async () => {
    // 18 production rows have normalized_tax_id null; a RUC probe never surfaces
    // them, but their expediente identity still resolves.
    const rucNullRow = row({ normalized_tax_id: null as unknown as string });
    const byExpediente = await lookupEcScvsByExpediente(
      { expediente: EXPEDIENTE, year: YEAR },
      fake([rucNullRow]),
    );
    assert.equal(byExpediente.matched, true);
  });
});

// ── static contract usage ───────────────────────────────────────────────────

describe('ec-scvs-lookup — static contract usage', () => {
  const readerSource = readFileSync(
    fileURLToPath(new URL('../ec-scvs-lookup.ts', import.meta.url)),
    'utf8',
  );

  it('does NOT use .limit(1).maybeSingle()', () => {
    assert.ok(!/limit\(\s*1\s*\)/.test(readerSource));
  });

  it('does NOT use TAX_GRAIN helpers', () => {
    assert.ok(!readerSource.includes('readTaxGrainSnapshotByTaxId'));
    assert.ok(!readerSource.includes('readLatestTaxGrainSnapshotByTaxId'));
  });

  it('uses readSnapshotByRecordIdentityKey for the expediente path', () => {
    assert.ok(readerSource.includes('readSnapshotByRecordIdentityKey'));
  });

  it('uses probeNativeSnapshotsByTaxId + probeLatestNativeSnapshotsByTaxId for RUC paths', () => {
    assert.ok(readerSource.includes('probeNativeSnapshotsByTaxId'));
    assert.ok(readerSource.includes('probeLatestNativeSnapshotsByTaxId'));
  });

  it('does not import SCVS builders or writers (read-only)', () => {
    assert.ok(!/snapshot-builder/.test(readerSource));
    assert.ok(!/snapshot-writer/.test(readerSource));
    assert.ok(!/-writer/.test(readerSource));
  });

  it('external result shape keys are preserved', () => {
    const sample: EcScvsLookupResult = {
      matched: false,
      record_identity_key: null,
      source_year: null,
      legal_name: null,
      normalized_tax_id: null,
      company_summary: null,
      raw_data: null,
      record_count: null,
      record_identity_keys: null,
      reason: null,
    };
    assert.deepEqual(Object.keys(sample).sort(), [
      'company_summary',
      'legal_name',
      'matched',
      'normalized_tax_id',
      'raw_data',
      'reason',
      'record_count',
      'record_identity_key',
      'record_identity_keys',
      'source_year',
    ]);
  });
});
