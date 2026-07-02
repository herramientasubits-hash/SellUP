/**
 * Tests — cr-sicop-lookup.ts — Centroamérica.4F
 *
 * Verifica:
 * - Normalización de cédula jurídica
 * - Guard de persona jurídica vs física
 * - Query local source_company_snapshots (source_key=cr_sicop, country_code=CR)
 * - matched / not_found / snapshot_unavailable
 * - Que NO se llama datos.go.cr ni Hacienda CR
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCostaRicaCedulaForSicop,
  isLikelyCostaRicaLegalEntity,
  lookupCostaRicaSicopByCedula,
} from '../cr-sicop-lookup';
import type { CrSicopLookupResult } from '../cr-sicop-lookup';

// ── normalizeCostaRicaCedulaForSicop ─────────────────────────────────────────

describe('normalizeCostaRicaCedulaForSicop', () => {
  it('strips dashes', () => {
    assert.equal(normalizeCostaRicaCedulaForSicop('3-101-123456'), '3101123456');
  });

  it('strips dots', () => {
    assert.equal(normalizeCostaRicaCedulaForSicop('3.101.123456'), '3101123456');
  });

  it('strips spaces', () => {
    assert.equal(normalizeCostaRicaCedulaForSicop('3 101 123456'), '3101123456');
  });

  it('returns digits-only unchanged', () => {
    assert.equal(normalizeCostaRicaCedulaForSicop('3101123456'), '3101123456');
  });

  it('returns empty string for empty input', () => {
    assert.equal(normalizeCostaRicaCedulaForSicop(''), '');
  });
});

// ── isLikelyCostaRicaLegalEntity ─────────────────────────────────────────────

describe('isLikelyCostaRicaLegalEntity', () => {
  it('returns true for 10-digit starting with 3', () => {
    assert.equal(isLikelyCostaRicaLegalEntity('3101123456'), true);
  });

  it('returns false for cédula física starting with 1', () => {
    assert.equal(isLikelyCostaRicaLegalEntity('1234567890'), false);
  });

  it('returns false for cédula física starting with 2', () => {
    assert.equal(isLikelyCostaRicaLegalEntity('2345678901'), false);
  });

  it('returns false for less than 10 digits', () => {
    assert.equal(isLikelyCostaRicaLegalEntity('310112345'), false);
  });

  it('returns false for more than 10 digits', () => {
    assert.equal(isLikelyCostaRicaLegalEntity('31011234567'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(isLikelyCostaRicaLegalEntity(''), false);
  });

  it('returns false for non-numeric', () => {
    assert.equal(isLikelyCostaRicaLegalEntity('3ABC123456'), false);
  });
});

// ── lookupCostaRicaSicopByCedula — matched ────────────────────────────────────

describe('lookupCostaRicaSicopByCedula — matched', () => {
  it('queries source_key=cr_sicop and country_code=CR', async () => {
    const captured: Record<string, unknown>[] = [];

    const mockSb = {
      from: (table: string) => {
        captured.push({ table });
        return {
          select: () => ({
            eq: (_f: string, v: string) => {
              captured.push({ eq: v });
              return {
                eq: (_f2: string, v2: string) => {
                  captured.push({ eq: v2 });
                  return {
                    eq: (_f3: string, v3: string) => {
                      captured.push({ eq: v3 });
                      return {
                        order: () => ({
                          limit: () => ({
                            maybeSingle: async () => ({
                              data: {
                                source_year: 2024,
                                legal_name: 'EMPRESA TEST SA',
                                normalized_tax_id: '3101123456',
                                priority_score: 50,
                                signals: { total_records_year: 5, datasets_seen: ['ofertas_2024'], last_event_date: '2024-06-01' },
                                raw_data: { source_type: 'procurement_signal' },
                              },
                              error: null,
                            }),
                          }),
                        }),
                      };
                    },
                  };
                },
              };
            },
          }),
        };
      },
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const result = await lookupCostaRicaSicopByCedula({ cedula: '3101123456' }, mockSb);

    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2024);
    assert.equal(result.legal_name, 'EMPRESA TEST SA');
    assert.equal(result.normalized_tax_id, '3101123456');
    assert.equal(result.total_records_year, 5);
    assert.deepEqual(result.datasets_seen, ['ofertas_2024']);
    assert.equal(result.last_event_date, '2024-06-01');
    assert.equal(result.reason, null);

    // Verify source_key and country_code were queried
    assert.ok(captured.some((c) => c.eq === 'cr_sicop'), 'debe buscar source_key=cr_sicop');
    assert.ok(captured.some((c) => c.eq === 'CR'), 'debe buscar country_code=CR');
    assert.ok(captured.some((c) => c.eq === '3101123456'), 'debe buscar normalized_tax_id');
  });
});

// ── lookupCostaRicaSicopByCedula — not_found ──────────────────────────────────

describe('lookupCostaRicaSicopByCedula — not_found', () => {
  it('returns matched=false when no row exists', async () => {
    const mockSb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const result = await lookupCostaRicaSicopByCedula({ cedula: '3999999999' }, mockSb);

    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match_by_cedula');
    assert.equal(result.source_year, null);
  });
});

// ── lookupCostaRicaSicopByCedula — snapshot_unavailable ───────────────────────

describe('lookupCostaRicaSicopByCedula — no supabase client', () => {
  it('returns snapshot_unavailable when service_role key absent', async () => {
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const result = await lookupCostaRicaSicopByCedula({ cedula: '3101123456' });
      assert.equal(result.matched, false);
      assert.equal(result.reason, 'snapshot_unavailable');
    } finally {
      if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    }
  });
});

// ── lookupCostaRicaSicopByCedula — query error ────────────────────────────────

describe('lookupCostaRicaSicopByCedula — query error', () => {
  it('returns matched=false with reason=snapshot_query_error on DB error', async () => {
    const mockSb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: new Error('DB error') }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const result = await lookupCostaRicaSicopByCedula({ cedula: '3101123456' }, mockSb);

    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_query_error');
  });
});
