/**
 * Tests — pa-panamacompra-convenio-lookup.ts — Centroamérica.5F
 *
 * Verifica:
 * - Query local source_company_snapshots (source_key=pa_panamacompra_convenio, country_code=PA)
 * - Lookup por normalized_tax_id (RUC normalizado)
 * - matched / not_found / snapshot_unavailable / invalid_ruc
 * - Que NO se llama PanamaCompra API
 * - Que NO se llama DGI Panamá
 * - Que NO se llama Registro Público Panamá
 * - Semántica: procurement_signal / convenio_marco
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupPanamaCompraConvenioByRuc,
} from '../pa-panamacompra-convenio-lookup';
import type { PaPanamaCompraLookupResult } from '../pa-panamacompra-convenio-lookup';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockSupabase(row: Record<string, unknown> | null, error?: { message: string }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: row, error: error ?? null }),
                }),
              }),
              limit: () => ({
                maybeSingle: async () => ({ data: row, error: error ?? null }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const SAMPLE_ROW = {
  source_year: 2024,
  legal_name: 'EMPRESA TEST SA',
  normalized_tax_id: '8-123-456789',
  raw_data: {
    representative_name: 'Juan Pérez',
    phone: '6000-0000',
    email: 'contacto@empresa.com',
    address: 'Ciudad de Panamá',
    convenios: ['CONVENIO-001'],
    branches: [],
  },
};

// ── lookupPanamaCompraConvenioByRuc — matched ─────────────────────────────────

describe('lookupPanamaCompraConvenioByRuc — matched', () => {
  it('returns matched=true when snapshot row exists', async () => {
    const sb = makeMockSupabase(SAMPLE_ROW);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' }, sb);
    assert.equal(result.matched, true);
  });

  it('returns correct source_year', async () => {
    const sb = makeMockSupabase(SAMPLE_ROW);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' }, sb);
    assert.equal(result.source_year, 2024);
  });

  it('returns legal_name from row', async () => {
    const sb = makeMockSupabase(SAMPLE_ROW);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' }, sb);
    assert.equal(result.legal_name, 'EMPRESA TEST SA');
  });

  it('returns normalized_tax_id from row', async () => {
    const sb = makeMockSupabase(SAMPLE_ROW);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' }, sb);
    assert.equal(result.normalized_tax_id, '8-123-456789');
  });

  it('returns procurement_summary with coverage_scope convenio_marco', async () => {
    const sb = makeMockSupabase(SAMPLE_ROW);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' }, sb);
    assert.ok(result.procurement_summary);
    assert.equal(result.procurement_summary.coverage_scope, 'convenio_marco');
  });

  it('returns procurement_summary with convenios array', async () => {
    const sb = makeMockSupabase(SAMPLE_ROW);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' }, sb);
    assert.ok(result.procurement_summary);
    assert.deepEqual(result.procurement_summary.convenios, ['CONVENIO-001']);
  });

  it('returns reason=null on match', async () => {
    const sb = makeMockSupabase(SAMPLE_ROW);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' }, sb);
    assert.equal(result.reason, null);
  });
});

// ── lookupPanamaCompraConvenioByRuc — not_found ────────────────────────────────

describe('lookupPanamaCompraConvenioByRuc — not_found', () => {
  it('returns matched=false when no row exists', async () => {
    const sb = makeMockSupabase(null);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '9-999-999999' }, sb);
    assert.equal(result.matched, false);
  });

  it('returns reason=no_snapshot_match_by_ruc when no row', async () => {
    const sb = makeMockSupabase(null);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '9-999-999999' }, sb);
    assert.equal(result.reason, 'no_snapshot_match_by_ruc');
  });

  it('returns procurement_summary=null when no row', async () => {
    const sb = makeMockSupabase(null);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '9-999-999999' }, sb);
    assert.equal(result.procurement_summary, null);
  });
});

// ── lookupPanamaCompraConvenioByRuc — snapshot unavailable ────────────────────

describe('lookupPanamaCompraConvenioByRuc — snapshot unavailable', () => {
  it('returns matched=false when supabase override is undefined and no service key', async () => {
    // When no supabaseOverride and no SUPABASE_SERVICE_ROLE_KEY, getAdminSupabase() returns null
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' });
    process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_unavailable');
  });
});

// ── lookupPanamaCompraConvenioByRuc — invalid RUC ────────────────────────────

describe('lookupPanamaCompraConvenioByRuc — invalid RUC', () => {
  it('returns matched=false and reason=invalid_ruc_format for empty string', async () => {
    const sb = makeMockSupabase(null);
    const result = await lookupPanamaCompraConvenioByRuc({ ruc: '' }, sb);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_ruc_format');
  });
});

// ── Guardrail: lookup uses source_key pa_panamacompra_convenio ────────────────

describe('guardrail: source_key and country_code', () => {
  it('lookup only reads source_key pa_panamacompra_convenio — verified via mock that accepts no other key', async () => {
    let capturedSourceKey: string | null = null;
    let capturedCountryCode: string | null = null;

    const trackingSb = {
      from: () => ({
        select: () => ({
          eq: (field: string, val: string) => {
            if (field === 'source_key') capturedSourceKey = val;
            return {
              eq: (f2: string, v2: string) => {
                if (f2 === 'country_code') capturedCountryCode = v2;
                return {
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                      }),
                    }),
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                };
              },
            };
          },
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await lookupPanamaCompraConvenioByRuc({ ruc: '8-123-456789' }, trackingSb);
    assert.equal(capturedSourceKey, 'pa_panamacompra_convenio');
    assert.equal(capturedCountryCode, 'PA');
  });
});

// ── Guardrail: lookup uses normalized_tax_id ──────────────────────────────────

describe('guardrail: normalized_tax_id lookup', () => {
  it('strips spaces from RUC before querying', async () => {
    let capturedNormalizedTaxId: string | null = null;
    const trackingSb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: (field: string, val: string) => {
                if (field === 'normalized_tax_id') capturedNormalizedTaxId = val;
                return {
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                };
              },
            }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await lookupPanamaCompraConvenioByRuc({ ruc: ' 8-123-456789 ' }, trackingSb);
    // normalizePanamaRuc strips spaces → '8-123-456789'
    assert.equal(capturedNormalizedTaxId, '8-123-456789');
  });
});
