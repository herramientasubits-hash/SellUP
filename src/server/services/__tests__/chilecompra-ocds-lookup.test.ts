/**
 * Tests for ChileCompra OCDS lookup service — v1.16CL-E + EC4D5.APP-C4A
 *
 * Covers the pre-migration contract (match / not-found / invalid RUT / query
 * error / signal extraction) plus the APP-C4A migration to the cardinality-
 * aware snapshot read contract:
 *   · 0 filas → no match (reason preservada)
 *   · 1 fila → match (shape externo preservado)
 *   · 2 filas mismo tax/source/year → cardinality violation (no pick arbitrario)
 *   · latest-year con 2 años distintos → escoge el más reciente
 *   · latest-year con 2 filas mismo año → cardinality violation
 *   · el reader ya NO usa .limit(1).maybeSingle
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { lookupChileCompraOcdsByRut } from '../chilecompra-ocds-lookup';
import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from '../../source-catalog/snapshot-read/__tests__/snapshot-read-fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const SOURCE_KEY = 'cl_chilecompra_ocds';
const COUNTRY_CODE = 'CL';
const RUT = '76543210-9';

const SAMPLE_SIGNALS = {
  total_awarded_amount_clp: 15000000,
  awards_count: 3,
  last_award_date: '2025-04-01',
  buyer_names: ['MUNICIPALIDAD DE SANTIAGO'],
  buyer_ruts: ['69123400-7'],
  unspsc_codes: ['72101501'],
  unspsc_descriptions: ['Construcción'],
  ocids: ['ocds-70d2nz-4280-25-LP25'],
  source_urls: ['https://example.cl/1'],
  procurement_methods: ['open'],
  awards_with_missing_amount: 0,
  awards_in_non_clp_currency: 0,
  currencies_seen: ['CLP'],
};

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: 2025,
    normalized_tax_id: RUT,
    legal_name: 'EMPRESA EJEMPLO LTDA',
    tax_id: RUT,
    priority_score: 0.85,
    signals: SAMPLE_SIGNALS,
    raw_data: { original_supplier_name_sample: 'Empresa Ejemplo Ltda.' },
    record_identity_key: null,
    ...overrides,
  };
}

function fakeClient(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  return createFakeSnapshotSupabaseClient(rows) as unknown as SupabaseClient;
}

describe('lookupChileCompraOcdsByRut', () => {
  it('finds snapshot by normalized RUT', async () => {
    const result = await lookupChileCompraOcdsByRut({ rut: RUT }, fakeClient([row()]));
    assert.equal(result.matched, true);
    assert.equal(result.legal_name, 'EMPRESA EJEMPLO LTDA');
    assert.equal(result.source_year, 2025);
    assert.equal(result.normalized_tax_id, RUT);
    assert.equal(result.tax_id, RUT);
  });

  it('RUT with dots normalizes and matches', async () => {
    const result = await lookupChileCompraOcdsByRut({ rut: '76.543.210-9' }, fakeClient([row()]));
    assert.equal(result.matched, true);
  });

  it('returns most recent year when year not passed', async () => {
    const client = fakeClient([
      row({ source_year: 2023, legal_name: 'VIEJO' }),
      row({ source_year: 2025, legal_name: 'NUEVO' }),
      row({ source_year: 2024, legal_name: 'MEDIO' }),
    ]);
    const result = await lookupChileCompraOcdsByRut({ rut: RUT }, client);
    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2025);
    assert.equal(result.legal_name, 'NUEVO');
  });

  it('exact year filters to that year even when others exist', async () => {
    const client = fakeClient([
      row({ source_year: 2023, legal_name: 'VIEJO' }),
      row({ source_year: 2025, legal_name: 'NUEVO' }),
    ]);
    const result = await lookupChileCompraOcdsByRut({ rut: RUT, year: 2023 }, client);
    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2023);
    assert.equal(result.legal_name, 'VIEJO');
  });

  it('returns matched=false with reason when no row', async () => {
    const result = await lookupChileCompraOcdsByRut({ rut: '99999999-9' }, fakeClient([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match_by_rut');
  });

  it('returns matched=false for empty RUT', async () => {
    const result = await lookupChileCompraOcdsByRut({ rut: '' }, fakeClient([row()]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_rut_format');
  });

  it('extracts signals from row', async () => {
    const result = await lookupChileCompraOcdsByRut({ rut: RUT }, fakeClient([row()]));
    assert.equal(result.signals?.total_awarded_amount_clp, 15000000);
    assert.equal(result.signals?.awards_count, 3);
    assert.deepEqual(result.signals?.buyer_names, ['MUNICIPALIDAD DE SANTIAGO']);
  });
});

// ── cardinality violation (APP-C4A) ──────────────────────────────────────────

describe('lookupChileCompraOcdsByRut — cardinality violation', () => {
  it('exact year: 2 rows same tax/source/year → no arbitrary pick', async () => {
    const client = fakeClient([
      row({ source_year: 2025, record_identity_key: 'a', legal_name: 'A' }),
      row({ source_year: 2025, record_identity_key: 'b', legal_name: 'B' }),
    ]);
    const result = await lookupChileCompraOcdsByRut({ rut: RUT, year: 2025 }, client);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
    assert.equal(result.legal_name, null);
    assert.equal(result.source_year, null);
  });

  it('latest-year: 2 rows within the most recent year → cardinality violation', async () => {
    const client = fakeClient([
      row({ source_year: 2025, record_identity_key: 'a' }),
      row({ source_year: 2025, record_identity_key: 'b' }),
    ]);
    const result = await lookupChileCompraOcdsByRut({ rut: RUT }, client);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
  });
});

// ── query error surfaces as snapshot_query_error ─────────────────────────────

describe('lookupChileCompraOcdsByRut — query error', () => {
  it('returns snapshot_query_error on DB error', async () => {
    const erroringClient = {
      from: () => ({
        select: () => {
          const q: Record<string, unknown> = {};
          q.eq = () => q;
          q.order = () => q;
          q.limit = () => q;
          q.maybeSingle = async () => ({ data: null, error: { code: 'XX000', message: 'DB error' } });
          q.then = (onf: (v: { data: null; error: { code: string; message: string } }) => unknown) =>
            Promise.resolve({ data: null, error: { code: 'XX000', message: 'DB error' } }).then(onf);
          return q;
        },
      }),
    } as unknown as SupabaseClient;

    const result = await lookupChileCompraOcdsByRut({ rut: RUT }, erroringClient);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_query_error');
  });
});

// ── static: reader no longer uses .limit(1).maybeSingle ──────────────────────

describe('chilecompra-ocds-lookup — migrated off .limit(1).maybeSingle', () => {
  it('reader code (comments stripped) contains neither maybeSingle nor .limit(1)', () => {
    const raw = readFileSync(new URL('../chilecompra-ocds-lookup.ts', import.meta.url), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(!code.includes('maybeSingle'), 'reader must not call maybeSingle directly');
    assert.ok(!code.includes('.limit(1)'), 'reader must not call .limit(1) directly');
  });
});
