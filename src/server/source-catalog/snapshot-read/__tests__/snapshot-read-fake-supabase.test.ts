/**
 * Tests para snapshot-read-fake-supabase.ts
 * Hito: EC4D5.APP-C2 — Test infra for cardinality-aware snapshot readers.
 *
 * These tests pin the cardinality semantics APP-C readers depend on, and in
 * particular contrast the DANGEROUS `.limit(1).maybeSingle()` (silent pick)
 * against the SAFE `.limit(2)` probe that surfaces PGRST116.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED_TABLE,
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from './snapshot-read-fake-supabase';

const SOURCE_KEY = 'cr_sicop';
const COUNTRY_CODE = 'CR';
const TAX_ID = '3101123456';

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: 2026,
    normalized_tax_id: TAX_ID,
    record_identity_key: null,
    ...overrides,
  };
}

function baseQuery(client: ReturnType<typeof createFakeSnapshotSupabaseClient>) {
  return client
    .from(SUPPORTED_TABLE)
    .select('source_year, normalized_tax_id, record_identity_key')
    .eq('source_key', SOURCE_KEY)
    .eq('country_code', COUNTRY_CODE)
    .eq('normalized_tax_id', TAX_ID);
}

describe('createFakeSnapshotSupabaseClient · maybeSingle', () => {
  it('0 filas: data null, error null', async () => {
    const client = createFakeSnapshotSupabaseClient([]);
    const { data, error } = await baseQuery(client).maybeSingle();
    assert.equal(data, null);
    assert.equal(error, null);
  });

  it('1 fila: devuelve esa fila sin error', async () => {
    const client = createFakeSnapshotSupabaseClient([
      row({ record_identity_key: 'cr:only' }),
    ]);
    const { data, error } = await baseQuery(client).maybeSingle();
    assert.equal(error, null);
    assert.equal(data?.record_identity_key, 'cr:only');
  });

  it('2 filas SIN limit: PGRST116', async () => {
    const client = createFakeSnapshotSupabaseClient([
      row({ record_identity_key: 'cr:a' }),
      row({ record_identity_key: 'cr:b' }),
    ]);
    const { data, error } = await baseQuery(client).maybeSingle();
    assert.equal(data, null);
    assert.equal(error?.code, 'PGRST116');
  });
});

describe('createFakeSnapshotSupabaseClient · limit + maybeSingle (bug vs fix)', () => {
  it('limit(1).maybeSingle() con 2 filas: una fila y NO error (silent pick)', async () => {
    const client = createFakeSnapshotSupabaseClient([
      row({ record_identity_key: 'cr:a' }),
      row({ record_identity_key: 'cr:b' }),
    ]);
    const { data, error } = await baseQuery(client).limit(1).maybeSingle();
    // Peligroso: la cardinalidad real (2) queda oculta por el truncado.
    assert.equal(error, null);
    assert.notEqual(data, null);
  });

  it('limit(2).maybeSingle() con 2 filas: PGRST116 (probe seguro)', async () => {
    const client = createFakeSnapshotSupabaseClient([
      row({ record_identity_key: 'cr:a' }),
      row({ record_identity_key: 'cr:b' }),
    ]);
    const { data, error } = await baseQuery(client).limit(2).maybeSingle();
    assert.equal(data, null);
    assert.equal(error?.code, 'PGRST116');
  });

  it('limit(2) sin maybeSingle: lista awaitable con las 2 filas', async () => {
    const client = createFakeSnapshotSupabaseClient([
      row({ record_identity_key: 'cr:a' }),
      row({ record_identity_key: 'cr:b' }),
    ]);
    const { data, error } = await baseQuery(client).limit(2);
    assert.equal(error, null);
    assert.equal(data?.length, 2);
  });
});

describe('createFakeSnapshotSupabaseClient · single', () => {
  it('0 filas: error PGRST116', async () => {
    const client = createFakeSnapshotSupabaseClient([]);
    const { data, error } = await baseQuery(client).single();
    assert.equal(data, null);
    assert.equal(error?.code, 'PGRST116');
  });

  it('1 fila: devuelve la fila', async () => {
    const client = createFakeSnapshotSupabaseClient([
      row({ record_identity_key: 'cr:only' }),
    ]);
    const { data, error } = await baseQuery(client).single();
    assert.equal(error, null);
    assert.equal(data?.record_identity_key, 'cr:only');
  });

  it('2 filas: error PGRST116', async () => {
    const client = createFakeSnapshotSupabaseClient([
      row({ record_identity_key: 'cr:a' }),
      row({ record_identity_key: 'cr:b' }),
    ]);
    const { data, error } = await baseQuery(client).single();
    assert.equal(data, null);
    assert.equal(error?.code, 'PGRST116');
  });
});

describe('createFakeSnapshotSupabaseClient · eq filters', () => {
  const client = () =>
    createFakeSnapshotSupabaseClient([
      row({ source_key: 'cr_sicop', country_code: 'CR', source_year: 2025, normalized_tax_id: '111', record_identity_key: 'k1' }),
      row({ source_key: 'cr_sicop', country_code: 'CR', source_year: 2026, normalized_tax_id: '222', record_identity_key: 'k2' }),
      row({ source_key: 'do_dgcp', country_code: 'DO', source_year: 2026, normalized_tax_id: '111', record_identity_key: 'k3' }),
    ]);

  it('eq(source_key) filtra por fuente', async () => {
    const { data } = await client().from(SUPPORTED_TABLE).select('*').eq('source_key', 'do_dgcp');
    assert.equal(data?.length, 1);
    assert.equal(data?.[0]?.record_identity_key, 'k3');
  });

  it('eq(normalized_tax_id) filtra por identidad fiscal', async () => {
    const { data } = await client().from(SUPPORTED_TABLE).select('*').eq('normalized_tax_id', '111');
    assert.equal(data?.length, 2);
  });

  it('eq(record_identity_key) filtra por identidad de registro', async () => {
    const { data } = await client().from(SUPPORTED_TABLE).select('*').eq('record_identity_key', 'k2');
    assert.equal(data?.length, 1);
    assert.equal(data?.[0]?.normalized_tax_id, '222');
  });

  it('eq(country_code) filtra por país', async () => {
    const { data } = await client().from(SUPPORTED_TABLE).select('*').eq('country_code', 'DO');
    assert.equal(data?.length, 1);
    assert.equal(data?.[0]?.record_identity_key, 'k3');
  });

  it('eq(source_year) filtra por año', async () => {
    const { data } = await client().from(SUPPORTED_TABLE).select('*').eq('source_year', 2025);
    assert.equal(data?.length, 1);
    assert.equal(data?.[0]?.record_identity_key, 'k1');
  });
});

describe('createFakeSnapshotSupabaseClient · order + limit', () => {
  const rows = [
    row({ source_year: 2024, record_identity_key: 'y2024' }),
    row({ source_year: 2026, record_identity_key: 'y2026' }),
    row({ source_year: 2025, record_identity_key: 'y2025' }),
  ];

  it('order(source_year desc).limit(1) devuelve el año más reciente', async () => {
    const client = createFakeSnapshotSupabaseClient(rows);
    const { data } = await client
      .from(SUPPORTED_TABLE)
      .select('source_year, record_identity_key')
      .eq('normalized_tax_id', TAX_ID)
      .order('source_year', { ascending: false })
      .limit(1);
    assert.equal(data?.length, 1);
    assert.equal(data?.[0]?.source_year, 2026);
  });

  it('order(source_year asc).limit(1) devuelve el año más antiguo', async () => {
    const client = createFakeSnapshotSupabaseClient(rows);
    const { data } = await client
      .from(SUPPORTED_TABLE)
      .select('source_year, record_identity_key')
      .eq('normalized_tax_id', TAX_ID)
      .order('source_year', { ascending: true })
      .limit(1);
    assert.equal(data?.length, 1);
    assert.equal(data?.[0]?.source_year, 2024);
  });

  it('order + limit(1).maybeSingle() elige la fila del año esperado sin error', async () => {
    const client = createFakeSnapshotSupabaseClient(rows);
    const { data, error } = await client
      .from(SUPPORTED_TABLE)
      .select('source_year, record_identity_key')
      .eq('normalized_tax_id', TAX_ID)
      .order('source_year', { ascending: false })
      .limit(1)
      .maybeSingle();
    assert.equal(error, null);
    assert.equal(data?.source_year, 2026);
  });
});

describe('createFakeSnapshotSupabaseClient · tabla no soportada', () => {
  it('from(otra_tabla) lanza error claro', () => {
    const client = createFakeSnapshotSupabaseClient([]);
    assert.throws(
      () => client.from('accounts'),
      /only "source_company_snapshots" is supported/,
    );
  });
});
