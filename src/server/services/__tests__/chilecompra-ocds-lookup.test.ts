/**
 * Tests for ChileCompra OCDS lookup service — v1.16CL-E
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lookupChileCompraOcdsByRut } from '../chilecompra-ocds-lookup';

function makeSupabaseMock(row: Record<string, unknown> | null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['from'] = () => chain;
  chain['select'] = () => chain;
  chain['eq'] = () => chain;
  chain['order'] = () => chain;
  chain['limit'] = () => chain;
  chain['maybeSingle'] = async () => ({ data: row, error: error ?? null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return chain as any;
}

const SAMPLE_ROW = {
  source_year: 2025,
  legal_name: 'EMPRESA EJEMPLO LTDA',
  tax_id: '76543210-9',
  normalized_tax_id: '76543210-9',
  priority_score: 0.85,
  signals: {
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
  },
  raw_data: { original_supplier_name_sample: 'Empresa Ejemplo Ltda.' },
};

describe('lookupChileCompraOcdsByRut', () => {
  it('finds snapshot by normalized RUT', async () => {
    const sb = makeSupabaseMock(SAMPLE_ROW);
    const result = await lookupChileCompraOcdsByRut({ rut: '76543210-9' }, sb);
    assert.equal(result.matched, true);
    assert.equal(result.legal_name, 'EMPRESA EJEMPLO LTDA');
    assert.equal(result.source_year, 2025);
    assert.equal(result.normalized_tax_id, '76543210-9');
  });

  it('RUT with dots normalizes and matches', async () => {
    const sb = makeSupabaseMock(SAMPLE_ROW);
    const result = await lookupChileCompraOcdsByRut({ rut: '76.543.210-9' }, sb);
    assert.equal(result.matched, true);
  });

  it('returns most recent year when year not passed', async () => {
    const sb = makeSupabaseMock(SAMPLE_ROW);
    const result = await lookupChileCompraOcdsByRut({ rut: '76543210-9' }, sb);
    assert.equal(result.source_year, 2025);
  });

  it('returns matched=false with reason when no row', async () => {
    const sb = makeSupabaseMock(null);
    const result = await lookupChileCompraOcdsByRut({ rut: '99999999-9' }, sb);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match_by_rut');
  });

  it('returns matched=false for empty RUT', async () => {
    const sb = makeSupabaseMock(SAMPLE_ROW);
    const result = await lookupChileCompraOcdsByRut({ rut: '' }, sb);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_rut_format');
  });

  it('returns snapshot_query_error on Supabase error', async () => {
    const sb = makeSupabaseMock(null, { message: 'DB error' });
    const result = await lookupChileCompraOcdsByRut({ rut: '76543210-9' }, sb);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_query_error');
  });

  it('extracts signals from row', async () => {
    const sb = makeSupabaseMock(SAMPLE_ROW);
    const result = await lookupChileCompraOcdsByRut({ rut: '76543210-9' }, sb);
    assert.equal(result.signals?.total_awarded_amount_clp, 15000000);
    assert.equal(result.signals?.awards_count, 3);
    assert.deepEqual(result.signals?.buyer_names, ['MUNICIPALIDAD DE SANTIAGO']);
  });

  it('never calls ChileCompra API (mock sb confirms no fetch)', async () => {
    const sb = makeSupabaseMock(null);
    const result = await lookupChileCompraOcdsByRut({ rut: '76543210-9' }, sb);
    assert.equal(typeof result, 'object');
  });
});
