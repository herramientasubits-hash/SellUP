/**
 * Tests for DGCP RD lookup service — RepúblicaDominicana.2D + EC4D5.APP-C4B
 *
 * Covers the pre-migration contract (match / not-found / invalid RNC / query
 * error / procurement summary) plus the APP-C4B migration to the cardinality-
 * aware snapshot read contract:
 *   · 0 filas → no match (reason preservada)
 *   · 1 fila → match (shape externo preservado)
 *   · 2 filas mismo tax/source/year → cardinality violation (no pick arbitrario)
 *   · latest-year con 2 años distintos → escoge el más reciente
 *   · latest-year con 2 filas mismo año → cardinality violation
 *   · DB error → snapshot_query_error (comportamiento preservado)
 *   · el reader ya NO usa .limit(1).maybeSingle
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { lookupDominicanDgcpByRnc } from '../rd-dgcp-lookup';
import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from '../../source-catalog/snapshot-read/__tests__/snapshot-read-fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const SOURCE_KEY = 'do_dgcp';
const COUNTRY_CODE = 'DO';
const RNC = '123456789';

const SAMPLE_SIGNALS = {
  total_contracts_year: 3,
  total_awarded_amount_dop: 73000,
  last_award_date: '2026-02-15',
  currency: 'DOP',
};

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: 2026,
    normalized_tax_id: RNC,
    legal_name: 'EMPRESA DOMINICANA SRL',
    priority_score: 0.7,
    signals: SAMPLE_SIGNALS,
    raw_data: { supplier_slug: 'empresa-dominicana' },
    record_identity_key: null,
    ...overrides,
  };
}

function fakeClient(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  return createFakeSnapshotSupabaseClient(rows) as unknown as SupabaseClient;
}

describe('lookupDominicanDgcpByRnc', () => {
  it('finds snapshot by normalized RNC', async () => {
    const result = await lookupDominicanDgcpByRnc({ rnc: RNC }, fakeClient([row()]));
    assert.equal(result.matched, true);
    assert.equal(result.legal_name, 'EMPRESA DOMINICANA SRL');
    assert.equal(result.source_year, 2026);
    assert.equal(result.normalized_tax_id, RNC);
    assert.equal(result.priority_score, 0.7);
  });

  it('RNC with dashes normalizes and matches', async () => {
    const result = await lookupDominicanDgcpByRnc({ rnc: '123-456-789' }, fakeClient([row()]));
    assert.equal(result.matched, true);
    assert.equal(result.normalized_tax_id, RNC);
  });

  it('extracts procurement summary from signals', async () => {
    const result = await lookupDominicanDgcpByRnc({ rnc: RNC }, fakeClient([row()]));
    assert.equal(result.total_contracts_year, 3);
    assert.equal(result.total_awarded_amount_dop, 73000);
    assert.equal(result.last_award_date, '2026-02-15');
    assert.equal(result.currency, 'DOP');
  });

  it('returns most recent year when year not passed', async () => {
    const client = fakeClient([
      row({ source_year: 2024, legal_name: 'VIEJO' }),
      row({ source_year: 2026, legal_name: 'NUEVO' }),
      row({ source_year: 2025, legal_name: 'MEDIO' }),
    ]);
    const result = await lookupDominicanDgcpByRnc({ rnc: RNC }, client);
    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2026);
    assert.equal(result.legal_name, 'NUEVO');
  });

  it('exact year filters to that year even when others exist', async () => {
    const client = fakeClient([
      row({ source_year: 2024, legal_name: 'VIEJO' }),
      row({ source_year: 2026, legal_name: 'NUEVO' }),
    ]);
    const result = await lookupDominicanDgcpByRnc({ rnc: RNC, year: 2024 }, client);
    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2024);
    assert.equal(result.legal_name, 'VIEJO');
  });

  it('returns matched=false with reason when no row', async () => {
    const result = await lookupDominicanDgcpByRnc({ rnc: '999999999' }, fakeClient([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match_by_rnc');
  });

  it('returns matched=false for empty RNC', async () => {
    const result = await lookupDominicanDgcpByRnc({ rnc: '' }, fakeClient([row()]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_rnc_format');
  });
});

// ── cardinality violation (APP-C4B) ──────────────────────────────────────────

describe('lookupDominicanDgcpByRnc — cardinality violation', () => {
  it('exact year: 2 rows same tax/source/year → no arbitrary pick', async () => {
    const client = fakeClient([
      row({ source_year: 2026, record_identity_key: 'a', legal_name: 'A' }),
      row({ source_year: 2026, record_identity_key: 'b', legal_name: 'B' }),
    ]);
    const result = await lookupDominicanDgcpByRnc({ rnc: RNC, year: 2026 }, client);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
    assert.equal(result.legal_name, null);
    assert.equal(result.source_year, null);
  });

  it('latest-year: 2 rows within the most recent year → cardinality violation', async () => {
    const client = fakeClient([
      row({ source_year: 2026, record_identity_key: 'a' }),
      row({ source_year: 2026, record_identity_key: 'b' }),
    ]);
    const result = await lookupDominicanDgcpByRnc({ rnc: RNC }, client);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
  });
});

// ── query error surfaces as snapshot_query_error ─────────────────────────────

describe('lookupDominicanDgcpByRnc — query error', () => {
  it('returns snapshot_query_error on DB error', async () => {
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

    const result = await lookupDominicanDgcpByRnc({ rnc: RNC }, erroringClient);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_query_error');
  });
});

// ── static: reader no longer uses .limit(1).maybeSingle ──────────────────────

describe('rd-dgcp-lookup — migrated off .limit(1).maybeSingle', () => {
  it('reader code (comments stripped) contains neither maybeSingle nor .limit(1)', () => {
    const raw = readFileSync(new URL('../rd-dgcp-lookup.ts', import.meta.url), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(!code.includes('maybeSingle'), 'reader must not call maybeSingle directly');
    assert.ok(!code.includes('.limit(1)'), 'reader must not call .limit(1) directly');
  });
});
