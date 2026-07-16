/**
 * Tests for DGII RD lookup service — Centroamérica.1A.4 + EC4D5.APP-C4B
 *
 * Covers the pre-migration contract (match / not-found / skip reasons / DB
 * error throw) plus the APP-C4B migration to the cardinality-aware snapshot
 * read contract. This reader has NO exact-year input — it always resolves the
 * latest source_year:
 *   · 0 filas → not_found (reason preservada)
 *   · 1 fila → matched (shape externo preservado)
 *   · latest-year con 2 años distintos → escoge el más reciente
 *   · latest-year con 2 filas mismo año → cardinality violation observable
 *   · DB error → THROWS rd_dgii_lookup_db_error (comportamiento preservado)
 *   · el reader ya NO usa .limit(1).maybeSingle
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { lookupDominicanDgiiByRnc } from '../rd-dgii-lookup';
import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from '../../source-catalog/snapshot-read/__tests__/snapshot-read-fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const SOURCE_KEY = 'rd_dgii_bulk';
const COUNTRY_CODE = 'DO';
const RNC = '123456789';

const SAMPLE_RAW = {
  trade_name: 'EMPRESA DOMINICANA',
  taxpayer_status: 'ACTIVO',
  normalized_status: 'active',
  is_active_taxpayer: true,
  economic_activity_text: 'Servicios',
  registration_date: '2010-01-01',
};

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: 2026,
    normalized_tax_id: RNC,
    legal_name: 'EMPRESA DOMINICANA SRL',
    raw_data: SAMPLE_RAW,
    record_identity_key: null,
    ...overrides,
  };
}

function fakeClient(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  return createFakeSnapshotSupabaseClient(rows) as unknown as SupabaseClient;
}

describe('lookupDominicanDgiiByRnc', () => {
  it('finds snapshot by normalized RNC (matched)', async () => {
    const result = await lookupDominicanDgiiByRnc({ rnc: RNC }, fakeClient([row()]));
    assert.equal(result.matched, true);
    assert.equal(result.legal_validation_status, 'matched');
    assert.equal(result.legal_name, 'EMPRESA DOMINICANA SRL');
    assert.equal(result.source_year, 2026);
    assert.equal(result.normalized_rnc, RNC);
    assert.equal(result.trade_name, 'EMPRESA DOMINICANA');
    assert.equal(result.taxpayer_status, 'ACTIVO');
    assert.equal(result.is_active_taxpayer, true);
    assert.equal(result.reason, null);
  });

  it('RNC with dashes normalizes and matches', async () => {
    const result = await lookupDominicanDgiiByRnc({ rnc: '1-23456789' }, fakeClient([row()]));
    assert.equal(result.matched, true);
    assert.equal(result.normalized_rnc, RNC);
  });

  it('returns most recent year when multiple exist', async () => {
    const client = fakeClient([
      row({ source_year: 2024, legal_name: 'VIEJO' }),
      row({ source_year: 2026, legal_name: 'NUEVO' }),
      row({ source_year: 2025, legal_name: 'MEDIO' }),
    ]);
    const result = await lookupDominicanDgiiByRnc({ rnc: RNC }, client);
    assert.equal(result.matched, true);
    assert.equal(result.source_year, 2026);
    assert.equal(result.legal_name, 'NUEVO');
  });

  it('no row → not_found', async () => {
    const result = await lookupDominicanDgiiByRnc({ rnc: RNC }, fakeClient([]));
    assert.equal(result.matched, false);
    assert.equal(result.legal_validation_status, 'not_found');
    assert.equal(result.reason, 'no_snapshot_match_by_rnc');
    assert.equal(result.normalized_rnc, RNC);
  });

  it('empty RNC → skipped/missing_tax_identifier', async () => {
    const result = await lookupDominicanDgiiByRnc({ rnc: '' }, fakeClient([row()]));
    assert.equal(result.matched, false);
    assert.equal(result.legal_validation_status, 'skipped');
    assert.equal(result.skip_reason, 'missing_tax_identifier');
  });

  it('cédula (11 digits) → skipped/person_identifier_out_of_scope', async () => {
    const result = await lookupDominicanDgiiByRnc({ rnc: '12345678901' }, fakeClient([row()]));
    assert.equal(result.matched, false);
    assert.equal(result.legal_validation_status, 'skipped');
    assert.equal(result.skip_reason, 'person_identifier_out_of_scope');
  });

  it('non-9-digit RNC → skipped/person_identifier_out_of_scope', async () => {
    const result = await lookupDominicanDgiiByRnc({ rnc: '12345' }, fakeClient([row()]));
    assert.equal(result.matched, false);
    assert.equal(result.legal_validation_status, 'skipped');
    assert.equal(result.skip_reason, 'person_identifier_out_of_scope');
  });
});

// ── cardinality violation (APP-C4B) ──────────────────────────────────────────

describe('lookupDominicanDgiiByRnc — cardinality violation', () => {
  it('latest-year: 2 rows within the most recent year → observable violation, no pick', async () => {
    const client = fakeClient([
      row({ source_year: 2026, record_identity_key: 'a', legal_name: 'A' }),
      row({ source_year: 2026, record_identity_key: 'b', legal_name: 'B' }),
    ]);
    const result = await lookupDominicanDgiiByRnc({ rnc: RNC }, client);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'snapshot_cardinality_violation');
    assert.equal(result.legal_name, null);
    assert.equal(result.source_year, null);
  });
});

// ── DB error must THROW (preserved behavior) ─────────────────────────────────

describe('lookupDominicanDgiiByRnc — DB error', () => {
  it('throws rd_dgii_lookup_db_error on DB error (not converted to not-found)', async () => {
    const erroringClient = {
      from: () => ({
        select: () => {
          const q: Record<string, unknown> = {};
          q.eq = () => q;
          q.order = () => q;
          q.limit = () => q;
          q.then = (onf: (v: { data: null; error: { code: string; message: string } }) => unknown) =>
            Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } }).then(onf);
          return q;
        },
      }),
    } as unknown as SupabaseClient;

    await assert.rejects(
      () => lookupDominicanDgiiByRnc({ rnc: RNC }, erroringClient),
      /rd_dgii_lookup_db_error/,
    );
  });
});

// ── static: reader no longer uses .limit(1).maybeSingle ──────────────────────

describe('rd-dgii-lookup — migrated off .limit(1).maybeSingle', () => {
  it('reader code (comments stripped) contains neither maybeSingle nor .limit(1)', () => {
    const raw = readFileSync(new URL('../rd-dgii-lookup.ts', import.meta.url), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(!code.includes('maybeSingle'), 'reader must not call maybeSingle directly');
    assert.ok(!code.includes('.limit(1)'), 'reader must not call .limit(1) directly');
  });
});
