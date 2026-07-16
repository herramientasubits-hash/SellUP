/**
 * Tests para snapshot-read-contract.ts
 * Hito: EC4D5.APP-C3 — Snapshot read contract implementation.
 *
 * Exercises the three cardinality-aware lookups against the APP-C2 fake:
 *  - readSnapshotByRecordIdentityKey (exact CN1 identity, maybeSingle)
 *  - readTaxGrainSnapshotByTaxId    (TAX_GRAIN, limit(2) probe)
 *  - probeNativeSnapshotsByTaxId    (NATIVE_RECORD_GRAIN, bounded probe)
 *
 * A thin spy client wraps the fake so we can assert the *shape* of the query
 * (eq columns, limit values, whether maybeSingle was used) on top of the
 * behavioral outcome.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from './snapshot-read-fake-supabase';
import {
  DEFAULT_SNAPSHOT_SELECT_COLUMNS,
  SnapshotReadQueryError,
  probeNativeSnapshotsByTaxId,
  readSnapshotByRecordIdentityKey,
  readTaxGrainSnapshotByTaxId,
  type SnapshotReadClient,
  type SnapshotReadFilterableQuery,
  type SnapshotReadListResponse,
  type SnapshotReadPostgrestError,
} from '../snapshot-read-contract';
import type { SnapshotReadResult } from '../snapshot-read-types';

const TAX_SOURCE = 'cr_sicop'; // TAX_GRAIN
const NATIVE_SOURCE = 'pa_panamacompra_convenio'; // NATIVE_RECORD_GRAIN
const COUNTRY = 'CR';
const YEAR = 2026;
const TAX_ID = '3101123456';

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: TAX_SOURCE,
    country_code: COUNTRY,
    source_year: YEAR,
    normalized_tax_id: TAX_ID,
    record_identity_key: null,
    ...overrides,
  };
}

// ── spy client: wraps the fake and records the query shape ───────────────────

interface QueryCallLog {
  selectColumns: string[];
  eq: Array<[string, unknown]>;
  limit: number[];
  maybeSingleCalls: number;
}

function createSpyClient(rows: readonly FakeSnapshotRow[]): {
  client: SnapshotReadClient<FakeSnapshotRow>;
  log: QueryCallLog;
} {
  const fake = createFakeSnapshotSupabaseClient(rows);
  const log: QueryCallLog = { selectColumns: [], eq: [], limit: [], maybeSingleCalls: 0 };

  function wrap(
    underlying: ReturnType<ReturnType<typeof createFakeSnapshotSupabaseClient>['from']>,
  ): SnapshotReadFilterableQuery<FakeSnapshotRow> {
    const wrapped: SnapshotReadFilterableQuery<FakeSnapshotRow> = {
      eq(column, value) {
        log.eq.push([column, value]);
        underlying.eq(column, value);
        return wrapped;
      },
      limit(count) {
        log.limit.push(count);
        underlying.limit(count);
        return wrapped;
      },
      maybeSingle() {
        log.maybeSingleCalls += 1;
        return underlying.maybeSingle();
      },
      then<TResult1 = SnapshotReadListResponse<FakeSnapshotRow>, TResult2 = never>(
        onfulfilled?:
          | ((value: SnapshotReadListResponse<FakeSnapshotRow>) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        return underlying.then(onfulfilled, onrejected);
      },
    };
    return wrapped;
  }

  const client: SnapshotReadClient<FakeSnapshotRow> = {
    from(table) {
      const tableQuery = fake.from(table);
      return {
        select(columns) {
          log.selectColumns.push(columns ?? '<default>');
          return wrap(tableQuery.select(columns));
        },
      };
    },
  };

  return { client, log };
}

// ── erroring client: always returns a PostgREST error (never rows) ──────────

function createErroringClient(
  error: SnapshotReadPostgrestError,
): SnapshotReadClient<FakeSnapshotRow> {
  const query: SnapshotReadFilterableQuery<FakeSnapshotRow> = {
    eq: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: null, error }),
    then<TResult1 = SnapshotReadListResponse<FakeSnapshotRow>, TResult2 = never>(
      onfulfilled?:
        | ((value: SnapshotReadListResponse<FakeSnapshotRow>) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve<SnapshotReadListResponse<FakeSnapshotRow>>({
        data: null,
        error,
      }).then(onfulfilled, onrejected);
    },
  };
  return { from: () => ({ select: () => query }) };
}

// ── 1. readSnapshotByRecordIdentityKey ───────────────────────────────────────

describe('readSnapshotByRecordIdentityKey', () => {
  it('1: record_identity_key existente → FOUND', async () => {
    const { client } = createSpyClient([row({ record_identity_key: 'tax:3101123456' })]);
    const result = await readSnapshotByRecordIdentityKey({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      recordIdentityKey: 'tax:3101123456',
    });
    assert.equal(result.status, 'FOUND');
    if (result.status === 'FOUND') {
      assert.equal(result.row.record_identity_key, 'tax:3101123456');
    }
  });

  it('2: record_identity_key inexistente → RECORD_IDENTITY_NOT_FOUND', async () => {
    const { client } = createSpyClient([row({ record_identity_key: 'tax:other' })]);
    const result = await readSnapshotByRecordIdentityKey({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      recordIdentityKey: 'tax:missing',
    });
    assert.equal(result.status, 'RECORD_IDENTITY_NOT_FOUND');
  });

  it('3: record_identity_key inválida → IDENTITY_UNAVAILABLE (sin query)', async () => {
    const { client, log } = createSpyClient([]);
    const result = await readSnapshotByRecordIdentityKey({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      recordIdentityKey: 'no-namespace-separator',
    });
    assert.equal(result.status, 'IDENTITY_UNAVAILABLE');
    if (result.status === 'IDENTITY_UNAVAILABLE') {
      assert.equal(result.reason, 'invalid_value');
    }
    // Fails before touching the client.
    assert.equal(log.selectColumns.length, 0);
  });

  it('3b: namespace prohibido "name:" → IDENTITY_UNAVAILABLE forbidden_namespace', async () => {
    const { client } = createSpyClient([]);
    const result = await readSnapshotByRecordIdentityKey({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      recordIdentityKey: 'name:ACME SA',
    });
    assert.equal(result.status, 'IDENTITY_UNAVAILABLE');
    if (result.status === 'IDENTITY_UNAVAILABLE') {
      assert.equal(result.reason, 'forbidden_namespace');
    }
  });

  it('4: filtra por source_key, country_code, source_year y record_identity_key', async () => {
    const { client, log } = createSpyClient([row({ record_identity_key: 'tax:k' })]);
    await readSnapshotByRecordIdentityKey({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      recordIdentityKey: 'tax:k',
    });
    assert.deepEqual(log.eq, [
      ['source_key', TAX_SOURCE],
      ['country_code', COUNTRY],
      ['source_year', YEAR],
      ['record_identity_key', 'tax:k'],
    ]);
    assert.equal(log.maybeSingleCalls, 1);
    assert.deepEqual(log.limit, []);
  });

  it('5: no usa normalized_tax_id — resuelve por identidad aunque el tax id difiera', async () => {
    const { client, log } = createSpyClient([
      // Misma identity key, tax id DISTINTO al del caller.
      row({ record_identity_key: 'tax:target', normalized_tax_id: 'DIFERENTE' }),
      // Mismo tax id del caller pero identity key distinta (no debe elegirse).
      row({ record_identity_key: 'tax:otro', normalized_tax_id: TAX_ID }),
    ]);
    const result = await readSnapshotByRecordIdentityKey({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      recordIdentityKey: 'tax:target',
    });
    assert.equal(result.status, 'FOUND');
    if (result.status === 'FOUND') {
      assert.equal(result.row.normalized_tax_id, 'DIFERENTE');
    }
    assert.ok(!log.eq.some(([column]) => column === 'normalized_tax_id'));
  });

  it('usa el select por defecto explícito y respeta selectColumns', async () => {
    const withDefault = createSpyClient([row({ record_identity_key: 'tax:k' })]);
    await readSnapshotByRecordIdentityKey({
      client: withDefault.client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      recordIdentityKey: 'tax:k',
    });
    assert.deepEqual(withDefault.log.selectColumns, [DEFAULT_SNAPSHOT_SELECT_COLUMNS]);

    const withOverride = createSpyClient([row({ record_identity_key: 'tax:k' })]);
    await readSnapshotByRecordIdentityKey({
      client: withOverride.client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      recordIdentityKey: 'tax:k',
      selectColumns: 'source_year, record_identity_key',
    });
    assert.deepEqual(withOverride.log.selectColumns, ['source_year, record_identity_key']);
  });
});

// ── 2. readTaxGrainSnapshotByTaxId ───────────────────────────────────────────

describe('readTaxGrainSnapshotByTaxId', () => {
  it('6: TAX_GRAIN con 0 filas → RECORD_IDENTITY_NOT_FOUND', async () => {
    const { client } = createSpyClient([]);
    const result = await readTaxGrainSnapshotByTaxId({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      normalizedTaxId: TAX_ID,
    });
    assert.equal(result.status, 'RECORD_IDENTITY_NOT_FOUND');
  });

  it('7: TAX_GRAIN con 1 fila → FOUND', async () => {
    const { client } = createSpyClient([row({ record_identity_key: 'tax:3101123456' })]);
    const result = await readTaxGrainSnapshotByTaxId({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      normalizedTaxId: TAX_ID,
    });
    assert.equal(result.status, 'FOUND');
    if (result.status === 'FOUND') {
      assert.equal(result.row.normalized_tax_id, TAX_ID);
    }
  });

  it('8: TAX_GRAIN con 2 filas mismo tax/year → SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION', async () => {
    const { client } = createSpyClient([
      row({ record_identity_key: 'tax:a' }),
      row({ record_identity_key: 'tax:b' }),
    ]);
    const result = await readTaxGrainSnapshotByTaxId({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      normalizedTaxId: TAX_ID,
    });
    assert.equal(result.status, 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION');
    if (result.status === 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION') {
      assert.equal(result.sourceKey, TAX_SOURCE);
      assert.equal(result.countryCode, COUNTRY);
      assert.equal(result.sourceYear, YEAR);
      assert.equal(result.normalizedTaxId, TAX_ID);
      assert.equal(result.recordCount, 2);
    }
  });

  it('9: NATIVE_RECORD_GRAIN pasado a tax-grain lookup → fail-closed (throw)', async () => {
    const { client } = createSpyClient([]);
    await assert.rejects(
      () =>
        readTaxGrainSnapshotByTaxId({
          client,
          sourceKey: NATIVE_SOURCE,
          countryCode: 'PA',
          sourceYear: YEAR,
          normalizedTaxId: TAX_ID,
        }),
      (err: unknown) =>
        err instanceof SnapshotReadQueryError && /non-TAX_GRAIN/.test(err.message),
    );
  });

  it('9b: source_key desconocido → fail-closed (throw)', async () => {
    const { client } = createSpyClient([]);
    await assert.rejects(
      () =>
        readTaxGrainSnapshotByTaxId({
          client,
          sourceKey: 'unregistered_source',
          countryCode: COUNTRY,
          sourceYear: YEAR,
          normalizedTaxId: TAX_ID,
        }),
      /Unknown source family/,
    );
  });

  it('10: normalizedTaxId vacío/null → IDENTITY_UNAVAILABLE (missing_tax_id)', async () => {
    for (const bad of ['', '   ', null, undefined]) {
      const { client, log } = createSpyClient([]);
      const result = await readTaxGrainSnapshotByTaxId({
        client,
        sourceKey: TAX_SOURCE,
        countryCode: COUNTRY,
        sourceYear: YEAR,
        normalizedTaxId: bad,
      });
      assert.equal(result.status, 'IDENTITY_UNAVAILABLE');
      if (result.status === 'IDENTITY_UNAVAILABLE') {
        assert.equal(result.reason, 'missing_tax_id');
      }
      // No query issued for an unavailable identity.
      assert.equal(log.selectColumns.length, 0);
    }
  });

  it('11: usa limit(2), nunca limit(1).maybeSingle()', async () => {
    const { client, log } = createSpyClient([row({ record_identity_key: 'tax:k' })]);
    await readTaxGrainSnapshotByTaxId({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: YEAR,
      normalizedTaxId: TAX_ID,
    });
    assert.deepEqual(log.limit, [2]);
    assert.equal(log.maybeSingleCalls, 0);
    assert.deepEqual(log.eq, [
      ['source_key', TAX_SOURCE],
      ['country_code', COUNTRY],
      ['source_year', YEAR],
      ['normalized_tax_id', TAX_ID],
    ]);
  });

  it('12: respeta source_year exacto (no mezcla años)', async () => {
    const { client } = createSpyClient([
      row({ source_year: 2025, record_identity_key: 'tax:2025' }),
      row({ source_year: 2026, record_identity_key: 'tax:2026' }),
    ]);
    const result = await readTaxGrainSnapshotByTaxId({
      client,
      sourceKey: TAX_SOURCE,
      countryCode: COUNTRY,
      sourceYear: 2026,
      normalizedTaxId: TAX_ID,
    });
    assert.equal(result.status, 'FOUND');
    if (result.status === 'FOUND') {
      assert.equal(result.row.record_identity_key, 'tax:2026');
    }
  });
});

// ── 3. probeNativeSnapshotsByTaxId ───────────────────────────────────────────

function nativeRow(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return row({
    source_key: NATIVE_SOURCE,
    country_code: 'PA',
    normalized_tax_id: '155-1-1',
    ...overrides,
  });
}

describe('probeNativeSnapshotsByTaxId', () => {
  it('13: NATIVE_RECORD_GRAIN con 0 filas → RECORD_IDENTITY_NOT_FOUND', async () => {
    const { client } = createSpyClient([]);
    const result = await probeNativeSnapshotsByTaxId({
      client,
      sourceKey: NATIVE_SOURCE,
      countryCode: 'PA',
      sourceYear: YEAR,
      normalizedTaxId: '155-1-1',
    });
    assert.equal(result.status, 'RECORD_IDENTITY_NOT_FOUND');
  });

  it('14: NATIVE_RECORD_GRAIN con 1 fila → FOUND', async () => {
    const { client } = createSpyClient([nativeRow({ record_identity_key: 'provider:only' })]);
    const result = await probeNativeSnapshotsByTaxId({
      client,
      sourceKey: NATIVE_SOURCE,
      countryCode: 'PA',
      sourceYear: YEAR,
      normalizedTaxId: '155-1-1',
    });
    assert.equal(result.status, 'FOUND');
    if (result.status === 'FOUND') {
      assert.equal(result.row.record_identity_key, 'provider:only');
    }
  });

  it('15: NATIVE_RECORD_GRAIN con 2 filas mismo tax/year → MULTI_RECORD_SAME_FISCAL_IDENTITY', async () => {
    const { client } = createSpyClient([
      nativeRow({ record_identity_key: 'provider:a' }),
      nativeRow({ record_identity_key: 'provider:b' }),
    ]);
    const result = await probeNativeSnapshotsByTaxId({
      client,
      sourceKey: NATIVE_SOURCE,
      countryCode: 'PA',
      sourceYear: YEAR,
      normalizedTaxId: '155-1-1',
    });
    assert.equal(result.status, 'MULTI_RECORD_SAME_FISCAL_IDENTITY');
    if (result.status === 'MULTI_RECORD_SAME_FISCAL_IDENTITY') {
      assert.equal(result.recordCount, 2);
      assert.deepEqual([...(result.recordIdentityKeys ?? [])].sort(), [
        'provider:a',
        'provider:b',
      ]);
    }
  });

  it('16: TAX_GRAIN pasado al native probe → fail-closed (throw)', async () => {
    const { client } = createSpyClient([]);
    await assert.rejects(
      () =>
        probeNativeSnapshotsByTaxId({
          client,
          sourceKey: TAX_SOURCE,
          countryCode: COUNTRY,
          sourceYear: YEAR,
          normalizedTaxId: TAX_ID,
        }),
      (err: unknown) =>
        err instanceof SnapshotReadQueryError && /non-NATIVE_RECORD_GRAIN/.test(err.message),
    );
  });

  it('17: no elige una fila arbitraria cuando hay múltiples (no maybeSingle, limit≥2)', async () => {
    const { client, log } = createSpyClient([
      nativeRow({ record_identity_key: 'provider:a' }),
      nativeRow({ record_identity_key: 'provider:b' }),
      nativeRow({ record_identity_key: 'provider:c' }),
    ]);
    const result = await probeNativeSnapshotsByTaxId({
      client,
      sourceKey: NATIVE_SOURCE,
      countryCode: 'PA',
      sourceYear: YEAR,
      normalizedTaxId: '155-1-1',
    });
    assert.equal(result.status, 'MULTI_RECORD_SAME_FISCAL_IDENTITY');
    assert.equal(log.maybeSingleCalls, 0);
    assert.ok((log.limit[0] ?? 0) >= 2);
  });

  it('18: recordIdentityKeys acotadas (respeta el probeLimit efectivo)', async () => {
    const many = Array.from({ length: 8 }, (_unused, index) =>
      nativeRow({ record_identity_key: `provider:${index}` }),
    );
    const { client, log } = createSpyClient(many);
    const result = await probeNativeSnapshotsByTaxId({
      client,
      sourceKey: NATIVE_SOURCE,
      countryCode: 'PA',
      sourceYear: YEAR,
      normalizedTaxId: '155-1-1',
      probeLimit: 3,
    });
    assert.equal(result.status, 'MULTI_RECORD_SAME_FISCAL_IDENTITY');
    if (result.status === 'MULTI_RECORD_SAME_FISCAL_IDENTITY') {
      // Query bounded to probeLimit → at most 3 rows/keys reported, never all 8.
      assert.deepEqual(log.limit, [3]);
      assert.ok(result.recordCount <= 3);
      assert.ok((result.recordIdentityKeys ?? []).length <= 3);
    }
  });

  it('18b: probeLimit < 2 se eleva a 2 para distinguir FOUND de multiplicidad', async () => {
    const { client, log } = createSpyClient([
      nativeRow({ record_identity_key: 'provider:a' }),
      nativeRow({ record_identity_key: 'provider:b' }),
    ]);
    const result = await probeNativeSnapshotsByTaxId({
      client,
      sourceKey: NATIVE_SOURCE,
      countryCode: 'PA',
      sourceYear: YEAR,
      normalizedTaxId: '155-1-1',
      probeLimit: 1,
    });
    assert.deepEqual(log.limit, [2]);
    assert.equal(result.status, 'MULTI_RECORD_SAME_FISCAL_IDENTITY');
  });
});

// ── 4. error behavior ────────────────────────────────────────────────────────

describe('error behavior — DB/PostgREST errors never become not-found', () => {
  it('19a: error en tax-grain lookup → throw SnapshotReadQueryError (no NOT_FOUND)', async () => {
    const client = createErroringClient({ code: 'XX000', message: 'boom' });
    await assert.rejects(
      () =>
        readTaxGrainSnapshotByTaxId({
          client,
          sourceKey: TAX_SOURCE,
          countryCode: COUNTRY,
          sourceYear: YEAR,
          normalizedTaxId: TAX_ID,
        }),
      (err: unknown) => err instanceof SnapshotReadQueryError && err.code === 'XX000',
    );
  });

  it('19b: error en native probe → throw SnapshotReadQueryError (no NOT_FOUND)', async () => {
    const client = createErroringClient({ code: 'XX000', message: 'boom' });
    await assert.rejects(
      () =>
        probeNativeSnapshotsByTaxId({
          client,
          sourceKey: NATIVE_SOURCE,
          countryCode: 'PA',
          sourceYear: YEAR,
          normalizedTaxId: '155-1-1',
        }),
      (err: unknown) => err instanceof SnapshotReadQueryError,
    );
  });

  it('19c: PGRST116 en record-identity lookup (CN1 breach) → throw, no silent pick', async () => {
    // Two rows sharing the same record_identity_key make maybeSingle surface
    // PGRST116; the contract must throw, never collapse to FOUND/NOT_FOUND.
    const { client } = createSpyClient([
      row({ record_identity_key: 'tax:dup' }),
      row({ record_identity_key: 'tax:dup' }),
    ]);
    await assert.rejects(
      () =>
        readSnapshotByRecordIdentityKey({
          client,
          sourceKey: TAX_SOURCE,
          countryCode: COUNTRY,
          sourceYear: YEAR,
          recordIdentityKey: 'tax:dup',
        }),
      (err: unknown) => err instanceof SnapshotReadQueryError && err.code === 'PGRST116',
    );
  });
});

// ── 5. exhaustive union typecheck ────────────────────────────────────────────

describe('SnapshotReadResult exhaustiveness', () => {
  it('20: every status is handled (never default unreachable)', () => {
    function summarize(result: SnapshotReadResult<FakeSnapshotRow>): string {
      switch (result.status) {
        case 'FOUND':
          return 'found';
        case 'RECORD_IDENTITY_NOT_FOUND':
          return 'not_found';
        case 'IDENTITY_UNAVAILABLE':
          return `unavailable:${result.reason}`;
        case 'MULTI_RECORD_SAME_FISCAL_IDENTITY':
          return `multi:${result.recordCount}`;
        case 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION':
          return `violation:${result.recordCount}`;
        default: {
          const exhaustive: never = result;
          throw new Error(`Unhandled status: ${String(exhaustive)}`);
        }
      }
    }
    assert.equal(summarize({ status: 'RECORD_IDENTITY_NOT_FOUND' }), 'not_found');
  });
});
