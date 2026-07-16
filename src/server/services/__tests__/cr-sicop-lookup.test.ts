/**
 * Tests — cr-sicop-lookup.ts — Centroamérica.4F + EC4D5.APP-C4A
 *
 * Verifica:
 * - Normalización de cédula jurídica
 * - Guard de persona jurídica vs física
 * - Query local source_company_snapshots (source_key=cr_sicop, country_code=CR)
 * - matched / not_found / snapshot_unavailable / query_error
 * - Migración APP-C4A a contrato cardinality-aware:
 *   · 0 filas → no match (reason preservada)
 *   · 1 fila → match (shape externo preservado)
 *   · 2 filas mismo tax/source/year → cardinality violation (no pick arbitrario)
 *   · latest-year con 2 años distintos → escoge el más reciente
 *   · latest-year con 2 filas mismo año → cardinality violation
 *   · el reader ya NO usa .limit(1).maybeSingle
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeCostaRicaCedulaForSicop,
  isLikelyCostaRicaLegalEntity,
  lookupCostaRicaSicopByCedula,
} from '../cr-sicop-lookup';
import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from '../../source-catalog/snapshot-read/__tests__/snapshot-read-fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const SOURCE_KEY = 'cr_sicop';
const COUNTRY_CODE = 'CR';
const CEDULA = '3101123456';

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: 2024,
    normalized_tax_id: CEDULA,
    legal_name: 'EMPRESA TEST SA',
    priority_score: 50,
    signals: { total_records_year: 5, datasets_seen: ['ofertas_2024'], last_event_date: '2024-06-01' },
    raw_data: { source_type: 'procurement_signal' },
    record_identity_key: null,
    ...overrides,
  };
}

function fakeClient(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  return createFakeSnapshotSupabaseClient(rows) as unknown as SupabaseClient;
}

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

// ── invalid cédula (early return, no query) ──────────────────────────────────

describe('lookupCostaRicaSicopByCedula — invalid cédula', () => {
  it('returns invalid_cedula_format for empty cédula', async () => {
    const result = await lookupCostaRicaSicopByCedula({ cedula: '' }, fakeClient([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'invalid_cedula_format');
  });
});

// ── matched (1 fila) — shape externo preservado ──────────────────────────────

describe('lookupCostaRicaSicopByCedula — matched (1 row)', () => {
  it('queries source_key=cr_sicop / country_code=CR and returns matched with signals', async () => {
    // Decoys under other source_key / country / tax must not be selected.
    const client = fakeClient([
      row(),
      row({ source_key: 'do_dgcp', country_code: 'DO', normalized_tax_id: CEDULA, legal_name: 'OTRA' }),
      row({ normalized_tax_id: '3999999999', legal_name: 'NO MATCH' }),
    ]);

    const result = await lookupCostaRicaSicopByCedula({ cedula: '3-101-123456' }, client);

    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2024);
    assert.equal(result.legal_name, 'EMPRESA TEST SA');
    assert.equal(result.normalized_tax_id, CEDULA);
    assert.equal(result.total_records_year, 5);
    assert.deepEqual(result.datasets_seen, ['ofertas_2024']);
    assert.equal(result.last_event_date, '2024-06-01');
    assert.deepEqual(result.raw_data, { source_type: 'procurement_signal' });
    assert.equal(result.reason, null);
  });
});

// ── not_found (0 filas) — reason preservada ──────────────────────────────────

describe('lookupCostaRicaSicopByCedula — not_found (0 rows)', () => {
  it('returns matched=false reason=no_snapshot_match_by_cedula when no row exists', async () => {
    const result = await lookupCostaRicaSicopByCedula({ cedula: '3999999999' }, fakeClient([]));
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'no_snapshot_match_by_cedula');
    assert.equal(result.source_year, null);
  });
});

// ── cardinality violation (2 filas mismo tax/source/year) ────────────────────

describe('lookupCostaRicaSicopByCedula — cardinality violation', () => {
  it('exact year: 2 rows same tax/source/year → no arbitrary pick, cardinality violation', async () => {
    const client = fakeClient([
      row({ source_year: 2024, record_identity_key: 'a', legal_name: 'A' }),
      row({ source_year: 2024, record_identity_key: 'b', legal_name: 'B' }),
    ]);
    const result = await lookupCostaRicaSicopByCedula({ cedula: CEDULA, year: 2024 }, client);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
    // Must not leak either arbitrary row.
    assert.equal(result.legal_name, null);
    assert.equal(result.source_year, null);
  });

  it('latest-year: 2 rows within the most recent year → cardinality violation', async () => {
    const client = fakeClient([
      row({ source_year: 2024, record_identity_key: 'a' }),
      row({ source_year: 2024, record_identity_key: 'b' }),
    ]);
    const result = await lookupCostaRicaSicopByCedula({ cedula: CEDULA }, client);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
  });
});

// ── latest-year selection (años distintos) ───────────────────────────────────

describe('lookupCostaRicaSicopByCedula — latest year selection', () => {
  it('picks the most recent source_year when year is omitted', async () => {
    const client = fakeClient([
      row({ source_year: 2023, legal_name: 'VIEJO' }),
      row({ source_year: 2025, legal_name: 'NUEVO' }),
      row({ source_year: 2024, legal_name: 'MEDIO' }),
    ]);
    const result = await lookupCostaRicaSicopByCedula({ cedula: CEDULA }, client);
    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2025);
    assert.equal(result.legal_name, 'NUEVO');
  });

  it('exact year filters to that year even when others exist', async () => {
    const client = fakeClient([
      row({ source_year: 2023, legal_name: 'VIEJO' }),
      row({ source_year: 2025, legal_name: 'NUEVO' }),
    ]);
    const result = await lookupCostaRicaSicopByCedula({ cedula: CEDULA, year: 2023 }, client);
    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2023);
    assert.equal(result.legal_name, 'VIEJO');
  });
});

// ── snapshot_unavailable ─────────────────────────────────────────────────────

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

// ── query error (DB error surfaces as snapshot_query_error) ───────────────────

describe('lookupCostaRicaSicopByCedula — query error', () => {
  it('returns matched=false reason=snapshot_query_error on DB error', async () => {
    // Minimal client whose thenable rejects into the contract's error path.
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

    const result = await lookupCostaRicaSicopByCedula({ cedula: '3101123456' }, erroringClient);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_query_error');
  });
});

// ── static: reader no longer uses .limit(1).maybeSingle ──────────────────────

describe('cr-sicop-lookup — migrated off .limit(1).maybeSingle', () => {
  it('reader code (comments stripped) contains neither maybeSingle nor .limit(1)', () => {
    const raw = readFileSync(new URL('../cr-sicop-lookup.ts', import.meta.url), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(!code.includes('maybeSingle'), 'reader must not call maybeSingle directly');
    assert.ok(!code.includes('.limit(1)'), 'reader must not call .limit(1) directly');
  });
});
