/**
 * BR-SOURCE-FUNCTIONAL-CUT-A — monthly Receita snapshot identity foundation.
 *
 * The claim under test is a DATA MODEL claim: that Brazil can now have a safe monthly snapshot.
 * That splits into four things a reader should be able to check independently:
 *
 *   1. a period is physical, required, and canonical `YYYY-MM`;
 *   2. the identity is ONE exact establishment CNPJ and the uniqueness protecting it is
 *      period-aware and cannot be defeated by a NULL;
 *   3. the exact CNPJ is internal — it is absent from every projection, payload and diagnostic;
 *   4. a period is published as a whole or not at all.
 *
 * Plus the boundary this cut must NOT cross: no application of the migration, no runtime
 * registration, no engine bridge, no execution authorization.
 *
 * NOTHING here touches Supabase, the network, a provider or the real Receita dataset. Every CNPJ is
 * synthetic and DV-valid by construction via `sampleFullCnpj`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import {
  parseSourcePeriod,
  isValidSourcePeriod,
  assertValidSourcePeriod,
  sourcePeriodYear,
  compareSourcePeriods,
  InvalidSourcePeriodError,
  SOURCE_PERIOD_PATTERN,
  SOURCE_PERIOD_SQL_PATTERN,
} from '../../../source-period';
import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import {
  sampleParserInput,
  sampleFullCnpj,
  RAIZ_TECNOLOGIA,
  RAIZ_EDUCACAO,
  SAMPLE_SOURCE_PERIOD,
} from '../br-receita-cnpj-fixtures';
import {
  toBrReceitaPersistedSnapshot,
  toBrReceitaPublicSnapshotProjection,
  brReceitaLogicalSnapshotIdentity,
  BR_RECEITA_PERIOD_EXACT_LOOKUP_COLUMNS,
  BR_RECEITA_SNAPSHOT_TABLE,
  type BrReceitaPersistedSnapshot,
} from '../br-receita-cnpj-monthly-snapshot-identity';
import {
  planBrReceitaMonthlySnapshotWrite,
  planBrReceitaSnapshotRunDiscard,
  BR_RECEITA_SNAPSHOT_BATCH_ROWS,
  BR_RECEITA_SNAPSHOT_PUBLISH_STATES,
  BR_RECEITA_DISCARDABLE_PUBLISH_STATES,
  BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
  BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
  BR_RECEITA_PERIOD_LOGICAL_IDENTITY_COLUMNS,
  BrReceitaSnapshotStreamError,
  type BrReceitaSnapshotWriteOperation,
  type BrReceitaSnapshotWritePlan,
  type BrReceitaRunScopedSnapshotRow,
  type UpsertBatchOperation,
} from '../br-receita-cnpj-monthly-snapshot-write-plan';
import {
  createSnapshotRunHandle,
  parseSnapshotRunId,
  assertRunIdIsNotDerivedFrom,
  InvalidSnapshotRunIdError,
  SnapshotRunHandleUnresolvedError,
  SnapshotRunHandleReassignedError,
  SNAPSHOT_RUN_ID_COLUMN,
} from '../br-receita-cnpj-monthly-snapshot-run-handle';
import {
  classifyBrReceitaSnapshotRead,
  BR_RECEITA_FUTURE_READER_CONTRACT,
  BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS,
  BR_RECEITA_RUN_SCOPED_READ_COLUMNS,
} from '../br-receita-cnpj-monthly-snapshot-read-contract';
import {
  BRAZIL_RECEITA_GATE4_STATUS,
  BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS,
  BRAZIL_RECEITA_GATE4_NON_PERSISTABLE_FIELDS,
  BRAZIL_RECEITA_GATE4_PERSISTED_IDENTITY_FIELDS,
  BRAZIL_RECEITA_GATE4A_APPROVAL,
  BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION,
  BrazilReceitaGate4NonPersistableRowError,
  findBrazilReceitaSnapshotRowPersistabilityViolations,
  assertBrazilReceitaSnapshotRowIsPersistable,
} from '../br-receita-cnpj-gate4-recorded-identity-grain';
import {
  brazilReceitaGateGlobalVerdict,
  brazilReceitaApprovedGateCount,
  BRAZIL_RECEITA_GATE_GO_MEANS,
  BRAZIL_RECEITA_GATE8_APPROVAL_IS_PERMISSION_TO_WRITE_RUNNER,
} from '../br-receita-cnpj-gate-status-current-state';
import { BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED } from '../br-receita-cnpj-real-benchmark-attempt-ledger';
import {
  BRAZIL_RECEITA_GATE5_ENGINE_REPORT_PROJECTION_REQUIRED,
  BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTED,
  BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED,
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS,
} from '../br-receita-cnpj-gate5-engine-report-boundary';
import { SOURCE_FAMILY_BY_SOURCE_KEY } from '../../../record-identity/source-family-registry';
import { BR_RECEITA_CNPJ_SOURCE_KEY } from '../br-receita-cnpj-types';

// ─── helpers ────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = new URL('../../../../../../supabase/migrations/', import.meta.url);
const CUT_A_MIGRATION = '125_br_receita_monthly_snapshot_identity.sql';

function migrationSql(name = CUT_A_MIGRATION): string {
  return fs.readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8');
}

/**
 * Strips SQL comments before asserting. The migration's own header DESCRIBES the hazards it closes,
 * so a raw scan would happily match the prose that rules a thing out and call it the violation.
 */
function sqlWithoutComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

function connectorSource(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}

/**
 * The EXECUTABLE body of a TypeScript module, with comment lines removed.
 *
 * 🔴 Required for any guard that asserts a symbol is ABSENT. These modules document the hazards
 * they close, so a raw scan confuses "names it in code" with "cites it in prose" and reports the
 * explanation as the violation. Every absence assertion below runs against this, never the raw file.
 */
function executableSource(relative: string): string {
  return connectorSource(relative)
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

/** The builder's rows, projected to what a writer may see. */
function persistedSampleSnapshots(period = SAMPLE_SOURCE_PERIOD): BrReceitaPersistedSnapshot[] {
  const input = { ...sampleParserInput(), sourcePeriod: period };
  return buildBrReceitaCnpjSnapshotRows(input).snapshots.map(toBrReceitaPersistedSnapshot);
}

/**
 * Two synthetic run ids. Canonical UUIDs, and deliberately NOT derived from anything: the point of
 * the run dimension is that it carries no company material.
 */
const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';

function plannedOrThrow(
  input: Parameters<typeof planBrReceitaMonthlySnapshotWrite>[0],
): BrReceitaSnapshotWritePlan {
  const result = planBrReceitaMonthlySnapshotWrite(input);
  assert.equal(result.status, 'planned');
  if (result.status !== 'planned') throw new Error('unreachable');
  return result.plan;
}

/**
 * Drives the plan the way CUT B's executor must: it feeds the run id back the moment `begin_period`
 * is yielded. A consumer that skips that step cannot get a batch, which is asserted separately.
 */
async function drivePlan(
  plan: BrReceitaSnapshotWritePlan,
  runId = RUN_A,
): Promise<BrReceitaSnapshotWriteOperation[]> {
  const collected: BrReceitaSnapshotWriteOperation[] = [];
  for await (const op of plan.operations()) {
    if (op.kind === 'begin_period') plan.runHandle.resolve(runId);
    collected.push(op);
  }
  return collected;
}

function batchesOf(ops: readonly BrReceitaSnapshotWriteOperation[]): UpsertBatchOperation[] {
  return ops.filter((o): o is UpsertBatchOperation => o.kind === 'upsert_batch');
}

function rowsOf(ops: readonly BrReceitaSnapshotWriteOperation[]): BrReceitaRunScopedSnapshotRow[] {
  return batchesOf(ops).flatMap((o) => [...o.rows]);
}

/** A SYNCHRONOUS producer that reports how many records have actually been pulled from it. */
function countingIterable(records: readonly BrReceitaPersistedSnapshot[]): {
  pulled: () => number;
} & Iterable<BrReceitaPersistedSnapshot> {
  let pulled = 0;
  return {
    pulled: () => pulled,
    [Symbol.iterator](): Iterator<BrReceitaPersistedSnapshot> {
      let cursor = 0;
      return {
        next(): IteratorResult<BrReceitaPersistedSnapshot> {
          if (cursor >= records.length) return { value: undefined, done: true };
          pulled += 1;
          const value = records[cursor];
          cursor += 1;
          return { value, done: false };
        },
      };
    },
  };
}

/** The same, ASYNCHRONOUS — the shape a real streaming file reader has. */
function asyncCountingIterable(records: readonly BrReceitaPersistedSnapshot[]): {
  pulled: () => number;
} & AsyncIterable<BrReceitaPersistedSnapshot> {
  let pulled = 0;
  return {
    pulled: () => pulled,
    async *[Symbol.asyncIterator](): AsyncGenerator<BrReceitaPersistedSnapshot> {
      for (const record of records) {
        pulled += 1;
        yield record;
      }
    },
  };
}

/** N synthetic records for one period, each a distinct DV-valid establishment. */
function manyRecords(count: number, period = SAMPLE_SOURCE_PERIOD): BrReceitaPersistedSnapshot[] {
  const template = persistedSampleSnapshots(period)[0];
  assert.ok(template);
  return Array.from({ length: count }, (_unused, i) => ({
    identity: {
      ...template.identity,
      normalized_tax_id: sampleFullCnpj(RAIZ_TECNOLOGIA, String(i + 1).padStart(4, '0')),
    },
    payload: template.payload,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// IDENTITY / PERIOD
// ════════════════════════════════════════════════════════════════════════════

describe('CUT-A · identity and period', () => {
  it('1. a canonical YYYY-MM period is accepted', () => {
    for (const period of ['2026-07', '2026-08', '2026-01', '2026-12', '1999-06', '2100-11']) {
      const parsed = parseSourcePeriod(period);
      assert.equal(parsed.valid, true, period);
      assert.equal(assertValidSourcePeriod(period), period);
    }
    assert.equal(sourcePeriodYear('2026-07'), 2026);
    // Lexicographic order is chronological order for this grain.
    assert.ok(compareSourcePeriods('2026-07', '2026-08') < 0);
  });

  it('2. malformed periods are rejected, every shape named in the brief', () => {
    const malformed = ['2026', '202607', '2026-7', '26-07', '2026-00', '2026-13', '2026-1', '2026/07'];
    for (const value of malformed) {
      assert.equal(isValidSourcePeriod(value), false, value);
      assert.equal(parseSourcePeriod(value).valid, false, value);
    }
    // 🔴 Padding is REJECTED, not trimmed. A validator that silently repaired its input would make
    // the string that identifies a snapshot different from the string the caller supplied.
    for (const padded of [' 2026-07', '2026-07 ', '\t2026-07']) {
      assert.equal(isValidSourcePeriod(padded), false, JSON.stringify(padded));
    }
  });

  it('3. a missing period is rejected, and rejection is fail-closed', () => {
    for (const value of ['', null, undefined, 0, 202607, {}, []]) {
      assert.equal(isValidSourcePeriod(value), false, String(value));
    }
    assert.equal(parseSourcePeriod(null).valid, false);
    assert.equal(parseSourcePeriod(undefined).valid, false);
    assert.throws(() => assertValidSourcePeriod(undefined), InvalidSourcePeriodError);

    // 🔴 The reason is a CATEGORY, never the rejected value.
    try {
      assertValidSourcePeriod('2026-13');
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof InvalidSourcePeriodError);
      assert.equal(error.message.includes('2026-13'), false, 'must not echo its input');
    }
  });

  it('4. the exact normalized CNPJ is REQUIRED at the persistence boundary', () => {
    const [row] = buildBrReceitaCnpjSnapshotRows(sampleParserInput()).snapshots;
    assert.ok(row);

    // Present and valid → no violation about the identity.
    const clean = findBrazilReceitaSnapshotRowPersistabilityViolations({
      tax_id: '',
      normalized_tax_id: row.normalized_tax_id,
      record_identity_key: '' as never,
      source_period: SAMPLE_SOURCE_PERIOD,
    });
    assert.deepEqual(clean, []);

    // Absent → refused. This is the inversion CUT A introduced: the guard now REQUIRES the one
    // representation it permits, because a NULL identity is what the vacuous uniqueness swallowed.
    const missing = findBrazilReceitaSnapshotRowPersistabilityViolations({
      tax_id: '',
      normalized_tax_id: '',
      record_identity_key: '' as never,
      source_period: SAMPLE_SOURCE_PERIOD,
    });
    assert.deepEqual(missing, [
      { field: 'normalized_tax_id', violation: 'persisted_identity_missing' },
    ]);
  });

  it('5. an invalid CNPJ is rejected — bad DV, wrong length, wrong charset', () => {
    for (const invalid of [
      '11222333000180', // DV tampered
      '1122233300018', // 13 chars
      '112223330001811', // 15 chars
      '11222333/0001-81', // punctuation survives into the identity
      '11222333',       // 8 chars: the CNPJ básico (root) is NOT an operational identity
    ]) {
      const violations = findBrazilReceitaSnapshotRowPersistabilityViolations({
        tax_id: '',
        normalized_tax_id: invalid,
        record_identity_key: '' as never,
        source_period: SAMPLE_SOURCE_PERIOD,
      });
      assert.deepEqual(
        violations,
        [{ field: 'normalized_tax_id', violation: 'persisted_identity_invalid' }],
        invalid,
      );
      // 🔴 The violation never carries the value it refused.
      assert.equal(JSON.stringify(violations).includes(invalid), false);
    }
  });

  it('5b. the identity is 14 CHARACTERS, not 14 decimal digits — alphanumeric CNPJs are valid', () => {
    // 🔴 Alphanumeric CNPJs are official from July 2026 and the first target period IS 2026-07.
    // A decimal-only identity would reject valid establishments in the very first month it ran.
    const alphanumeric = sampleFullCnpj(RAIZ_EDUCACAO, '0001');
    assert.match(alphanumeric, /[A-Z]/, 'the fixture root must actually be alphanumeric');
    assert.deepEqual(
      findBrazilReceitaSnapshotRowPersistabilityViolations({
        tax_id: '',
        normalized_tax_id: alphanumeric,
        record_identity_key: '' as never,
        source_period: SAMPLE_SOURCE_PERIOD,
      }),
      [],
    );
    // And the DDL agrees with the code: positions 1-12 alphanumeric, the DV numeric.
    assert.match(sqlWithoutComments(migrationSql()), /\[A-Z0-9\]\{12\}\[0-9\]\{2\}/);
  });

  it('6. same CNPJ + same period = the SAME logical identity', () => {
    const cnpj = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
    const identity = {
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: 'BR',
      source_period: '2026-07',
      source_year: 2026,
      normalized_tax_id: cnpj,
    } as const;
    assert.equal(
      brReceitaLogicalSnapshotIdentity(identity),
      brReceitaLogicalSnapshotIdentity({ ...identity }),
    );
  });

  it('7. same CNPJ + DIFFERENT period = two DISTINCT logical identities', () => {
    const cnpj = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
    const base = {
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: 'BR',
      source_year: 2026,
      normalized_tax_id: cnpj,
    } as const;
    assert.notEqual(
      brReceitaLogicalSnapshotIdentity({ ...base, source_period: '2026-07' }),
      brReceitaLogicalSnapshotIdentity({ ...base, source_period: '2026-08' }),
    );
  });

  it('8. the CNPJ root is context only — no code derives, returns or accepts it', () => {
    // 🔴 The proof is an ABSENCE. GATE-1 R4 forbids the básico anywhere, so the correct
    // implementation is that no root extractor exists — a root-shaped value simply fails identity
    // validation like any other non-CNPJ string (asserted in test 5).
    for (const modulePath of [
      '../br-receita-cnpj-monthly-snapshot-identity.ts',
      '../br-receita-cnpj-monthly-snapshot-write-plan.ts',
    ]) {
      const source = connectorSource(modulePath);
      for (const forbidden of ['cnpj_basico', 'basico', 'cnpjRoot', 'cnpj_root', 'slice(0, 8)']) {
        assert.equal(source.includes(forbidden), false, `${modulePath} must not reach for ${forbidden}`);
      }
    }
    // The identity dimensions never mention a root.
    assert.deepEqual(
      [...BR_RECEITA_PERIOD_EXACT_LOOKUP_COLUMNS],
      ['source_key', 'country_code', 'source_period', 'normalized_tax_id'],
    );
  });

  it('the builder REJECTS a period-less or malformed-period Brazil build (§ 34)', () => {
    for (const badPeriod of [undefined, '', '2026', '2026-13', '2026-7']) {
      assert.throws(
        () =>
          buildBrReceitaCnpjSnapshotRows({
            ...sampleParserInput(),
            sourcePeriod: badPeriod as never,
          }),
        /sourcePeriod is required/,
        String(badPeriod),
      );
    }
  });

  it('the builder REJECTS a period whose year disagrees with sourceYear', () => {
    assert.throws(
      () => buildBrReceitaCnpjSnapshotRows({ ...sampleParserInput(), sourcePeriod: '2025-07' }),
      /disagrees with the year of sourcePeriod/,
    );
  });

  it('the builder stamps the physical period, and raw_data provenance agrees with it', () => {
    const result = buildBrReceitaCnpjSnapshotRows({
      ...sampleParserInput(),
      sourceYear: 2026,
      sourcePeriod: '2026-08',
    });
    assert.ok(result.snapshots.length > 0);
    for (const row of result.snapshots) {
      assert.equal(row.source_period, '2026-08');
      // One validated value written twice; migration 125 pins the equality as a CHECK.
      assert.equal(row.raw_data.source_period, row.source_period);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// UNIQUENESS / IDEMPOTENCY
// ════════════════════════════════════════════════════════════════════════════

describe('CUT-A · uniqueness and idempotency', () => {
  it('9. replaying the same period does not duplicate — identity collapses deterministically', async () => {
    const records = persistedSampleSnapshots();
    const once = await drivePlan(
      plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records: countingIterable(records) }),
    );
    const replayed = await drivePlan(
      plannedOrThrow({
        sourcePeriod: SAMPLE_SOURCE_PERIOD,
        records: countingIterable([...records, ...records]),
        // One batch, so the duplicate pair is inside it and the exact in-batch guarantee applies.
        batchSize: records.length * 2,
      }),
    );

    assert.equal(rowsOf(replayed).length, rowsOf(once).length, 'a replay adds no rows');
    // Deterministic: the same input twice yields the same operation shape.
    assert.deepEqual(
      replayed.map((o) => o.kind),
      once.map((o) => o.kind),
    );
    assert.equal(
      batchesOf(replayed).reduce((sum, b) => sum + b.collapsedInBatchCount, 0),
      records.length,
    );
  });

  it('10. a duplicate identity inside one batch is deterministic or fails closed', async () => {
    const records = persistedSampleSnapshots();
    const doubled = [...records, ...records];

    const collapsed = await drivePlan(
      plannedOrThrow({
        sourcePeriod: SAMPLE_SOURCE_PERIOD,
        records: doubled,
        batchSize: doubled.length,
        onDuplicateIdentityInBatch: 'collapse_last_wins',
      }),
    );
    assert.equal(rowsOf(collapsed).length, records.length);
    assert.notEqual(rowsOf(collapsed).length, doubled.length, 'never two logical snapshots');

    const rejecting = plannedOrThrow({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: doubled,
      batchSize: doubled.length,
      onDuplicateIdentityInBatch: 'reject',
    });
    await assert.rejects(
      () => drivePlan(rejecting),
      (error: unknown) => {
        assert.ok(error instanceof BrReceitaSnapshotStreamError);
        assert.equal(error.reason, 'duplicate_identity_in_batch');
        // 🔴 An ORDINAL, never an identifier.
        assert.equal(typeof error.recordIndex, 'number');
        assert.equal(/[0-9A-Z]{14}/.test(error.message), false);
        return true;
      },
    );
  });

  it('11. a NULL cannot bypass uniqueness — the DDL forbids the NULL, not just the duplicate', () => {
    const sql = sqlWithoutComments(migrationSql());

    // The Brazil branch requires ALL THREE key columns to be present...
    assert.match(sql, /source_period IS NOT NULL/);
    assert.match(sql, /snapshot_run_id IS NOT NULL/);
    assert.match(sql, /normalized_tax_id IS NOT NULL/);
    // ...inside a CHECK that only exempts non-Brazil sources.
    assert.match(sql, /source_key <> 'br_receita_cnpj_dados_abertos'/);
    assert.match(sql, /source_company_snapshots_br_receita_identity_chk/);

    // 🔴 This is the whole point of YH-2: a partial unique index over NULLABLE columns is not
    // uniqueness at all, because Postgres treats NULLs as DISTINCT. The index below is only
    // meaningful BECAUSE the CHECK above makes every one of its Brazil columns NOT NULL.
    assert.match(sql, /CREATE UNIQUE INDEX source_company_snapshots_br_period_identity_uidx/);
  });

  it('12. cross-period overwrite is impossible — the unique key is period-scoped', async () => {
    const sql = sqlWithoutComments(migrationSql());
    const brIndex = sql.slice(sql.indexOf('source_company_snapshots_br_period_identity_uidx'));
    const brIndexStatement = brIndex.slice(0, brIndex.indexOf(';'));
    assert.match(
      brIndexStatement,
      /\(source_key, country_code, source_period, snapshot_run_id, normalized_tax_id\)/,
    );
    assert.equal(brIndexStatement.includes('source_year'), false, 'a year-scoped key is the overwrite bug');

    // The plan's conflict target agrees with the index, and with neither year-scoped constant.
    assert.deepEqual(
      [...BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS],
      ['source_key', 'country_code', 'source_period', 'snapshot_run_id', 'normalized_tax_id'],
    );
    // 🔴 And the PARTIAL index's predicate is restated, or Postgres cannot infer the arbiter.
    assert.ok(brIndexStatement.includes(BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE));

    // A record from another month is REFUSED, never silently relabelled into the period being built.
    const plan = plannedOrThrow({ sourcePeriod: '2026-07', records: persistedSampleSnapshots('2026-08') });
    await assert.rejects(
      () => drivePlan(plan),
      (error: unknown) =>
        error instanceof BrReceitaSnapshotStreamError && error.reason === 'record_period_mismatch',
    );
  });

  it('12b. the SAME establishment in two periods produces two independent plans', async () => {
    const july = await drivePlan(
      plannedOrThrow({ sourcePeriod: '2026-07', records: persistedSampleSnapshots('2026-07') }),
      RUN_A,
    );
    const august = await drivePlan(
      plannedOrThrow({ sourcePeriod: '2026-08', records: persistedSampleSnapshots('2026-08') }),
      RUN_B,
    );

    assert.ok(july.length > 0);
    // Neither plan contains a single operation addressing the other's period.
    for (const op of august) {
      assert.equal(JSON.stringify(op).includes('2026-07'), false);
    }
    // And the only destructive operation is scoped to a RUN, and refuses a published one.
    const discards = august.filter((o) => o.kind === 'discard_run_rows');
    assert.equal(discards.length, 1);
    const discard = discards[0];
    if (discard.kind !== 'discard_run_rows') assert.fail('expected discard_run_rows');
    assert.equal(discard.snapshot_run_id, RUN_B);
    assert.equal(discard.canDeletePublishedRun, false);
    assert.equal(discard.canDeleteByPeriodAlone, false);
  });

  it('13. same-period update behaviour is deterministic — last wins, by contract not by accident', async () => {
    const [first, ...rest] = persistedSampleSnapshots();
    assert.ok(first);
    const updated: BrReceitaPersistedSnapshot = {
      identity: first.identity,
      payload: { ...first.payload, legal_name: 'UPDATED SYNTHETIC NAME' },
    };
    const records = [first, ...rest, updated];
    const ops = await drivePlan(
      plannedOrThrow({
        sourcePeriod: SAMPLE_SOURCE_PERIOD,
        records,
        batchSize: records.length,
      }),
    );

    const forIdentity = rowsOf(ops).filter(
      (r) =>
        brReceitaLogicalSnapshotIdentity(r.identity) ===
        brReceitaLogicalSnapshotIdentity(first.identity),
    );
    assert.equal(forIdentity.length, 1, 'one identity, one row');
    assert.equal(forIdentity[0].payload.legal_name, 'UPDATED SYNTHETIC NAME');
    assert.equal(batchesOf(ops)[0].collapsedInBatchCount, 1);
  });

  it('the logical read key stays four columns, and is NOT the physical write key', () => {
    // Inside ONE published run an establishment is resolved by the period-scoped identity...
    assert.deepEqual(
      [...BR_RECEITA_PERIOD_LOGICAL_IDENTITY_COLUMNS],
      ['source_key', 'country_code', 'source_period', 'normalized_tax_id'],
    );
    // ...but a WRITE may never use it, or run B's upserts would land on run A's rows.
    assert.notDeepEqual(
      [...BR_RECEITA_PERIOD_LOGICAL_IDENTITY_COLUMNS],
      [...BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS],
    );
    assert.ok(BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS.includes(SNAPSHOT_RUN_ID_COLUMN));
    assert.equal(BR_RECEITA_PERIOD_LOGICAL_IDENTITY_COLUMNS.includes(SNAPSHOT_RUN_ID_COLUMN), false);
  });

  it('non-Brazil sources keep exactly the uniqueness they had', () => {
    const sql = sqlWithoutComments(migrationSql());
    const yearIndex = sql.slice(sql.indexOf('source_company_snapshots_year_identity_uidx'));
    const statement = yearIndex.slice(0, yearIndex.indexOf(';'));
    // Same four columns, same order as migration 065's constraint.
    assert.match(statement, /\(source_key, country_code, source_year, normalized_tax_id\)/);
    assert.match(statement, /WHERE source_key <> 'br_receita_cnpj_dados_abertos'/);
    // 🔴 And the run column is NOT imposed on them: it is nullable at table level for a reason.
    assert.equal(statement.includes('snapshot_run_id'), false);

    // 065 itself is untouched by this cut.
    const m065 = sqlWithoutComments(migrationSql('065_create_source_snapshot_tables.sql'));
    assert.match(m065, /UNIQUE \(source_key, country_code, source_year, normalized_tax_id\)/);
    assert.equal(m065.includes('source_period'), false);
    assert.equal(m065.includes('snapshot_run_id'), false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PRIVACY
// ════════════════════════════════════════════════════════════════════════════

describe('CUT-A · privacy of the exact identity', () => {
  const cnpjOf = (s: BrReceitaPersistedSnapshot): string => s.identity.normalized_tax_id;

  it('14. the exact CNPJ is ABSENT from the public projection', () => {
    for (const snapshot of persistedSampleSnapshots()) {
      const projection = toBrReceitaPublicSnapshotProjection(snapshot);
      const serialized = JSON.stringify(projection);
      assert.equal(serialized.includes(cnpjOf(snapshot)), false, 'full CNPJ leaked');
      // The root is equally forbidden.
      assert.equal(serialized.includes(cnpjOf(snapshot).slice(0, 8)), false, 'CNPJ básico leaked');
      assert.equal('normalized_tax_id' in projection, false);
      assert.equal('tax_id' in projection, false);
      assert.equal('record_identity_key' in projection, false);
      // ...while the business payload survives, so the projection is not vacuously clean.
      assert.equal(projection.source_period, SAMPLE_SOURCE_PERIOD);
      assert.ok('raw_data' in projection);
    }
  });

  it('15. the exact CNPJ is ABSENT from raw_data', () => {
    for (const snapshot of persistedSampleSnapshots()) {
      const rawData = JSON.stringify(snapshot.payload.raw_data);
      assert.equal(rawData.includes(cnpjOf(snapshot)), false);
      assert.equal(rawData.includes(cnpjOf(snapshot).slice(0, 8)), false);
    }
  });

  it('16. the exact CNPJ is ABSENT from plan summaries, rejections and error projections', () => {
    const records = persistedSampleSnapshots();
    const planned = planBrReceitaMonthlySnapshotWrite({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records });
    assert.equal(planned.status, 'planned');
    if (planned.status !== 'planned') return;

    // The control summary carries counts and coordinates only — no identity, no payload.
    const { operations, onFailure, ...summary } = planned.plan;
    void operations;
    void onFailure;
    const serializedSummary = JSON.stringify(summary);
    for (const record of records) {
      assert.equal(serializedSummary.includes(cnpjOf(record)), false);
    }

    // And the guard's own error message names the field and the kind, never the value.
    const row = { ...records[0], normalized_tax_id: '11222333000180' };
    try {
      assertBrazilReceitaSnapshotRowIsPersistable({
        tax_id: '',
        normalized_tax_id: row.normalized_tax_id,
        record_identity_key: '' as never,
        source_period: SAMPLE_SOURCE_PERIOD,
      });
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof BrazilReceitaGate4NonPersistableRowError);
      assert.equal(error.message.includes('11222333000180'), false);
      assert.match(error.message, /normalized_tax_id \(persisted_identity_invalid\)/);
    }
  });

  it('16b. no CUT-A module logs anything, ever', () => {
    for (const modulePath of [
      '../br-receita-cnpj-monthly-snapshot-identity.ts',
      '../br-receita-cnpj-monthly-snapshot-write-plan.ts',
      '../br-receita-cnpj-monthly-snapshot-run-handle.ts',
      '../br-receita-cnpj-monthly-snapshot-read-contract.ts',
      '../../../source-period/source-period.ts',
    ]) {
      const source = connectorSource(modulePath);
      for (const emitter of ['console.', 'process.stdout', 'process.stderr']) {
        assert.equal(source.includes(emitter), false, `${modulePath} must not carry ${emitter}`);
      }
    }
  });

  it('17. SOCIOS / QSA / CPF are still categorically refused', () => {
    const poisoned = { ...sampleParserInput(), sociosRows: [{ cpf: '00000000000' }] };
    assert.throws(
      () => buildBrReceitaCnpjSnapshotRows(poisoned as never),
      /forbidden personal-data source field/,
    );
    // And no CUT-A module names any of the person-linked families.
    for (const modulePath of [
      '../br-receita-cnpj-monthly-snapshot-identity.ts',
      '../br-receita-cnpj-monthly-snapshot-write-plan.ts',
    ]) {
      const source = connectorSource(modulePath).toLowerCase();
      for (const token of ['socio', 'qsa', 'cpf', 'representante']) {
        assert.equal(source.includes(token), false, `${modulePath} must not name ${token}`);
      }
    }
    // Nor does the migration create anywhere to put them.
    const sql = sqlWithoutComments(migrationSql()).toLowerCase();
    for (const token of ['socio', 'qsa', 'cpf']) {
      assert.equal(sql.includes(token), false);
    }
  });

  it('18. the long-digit / CNPJ-shaped sanitizer in the builder remains effective', () => {
    // The builder's raw_data sanitizer inspects KEYS and VALUES and rejects a row that carries its
    // own CNPJ material. Proven by poisoning a value the allowlist permits.
    const input = sampleParserInput();
    const poisonedCnpj = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
    const rows = input.estabelecimentosRows.map((row) =>
      row.cnpj_basico === RAIZ_TECNOLOGIA && row.cnpj_ordem === '0001'
        ? { ...row, uf: poisonedCnpj }
        : row,
    );
    assert.throws(
      () => buildBrReceitaCnpjSnapshotRows({ ...input, estabelecimentosRows: rows }),
      /raw_data sanitization violation/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ATOMICITY
// ════════════════════════════════════════════════════════════════════════════

describe('CUT-A · atomic publish', () => {
  const samplePlan = (extra: Record<string, unknown> = {}) =>
    plannedOrThrow({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: persistedSampleSnapshots(),
      ...extra,
    });

  it('19. a preparing period is not readable as published', async () => {
    const ops = await drivePlan(samplePlan());
    const begin = ops[0];
    assert.equal(begin.kind, 'begin_period');
    if (begin.kind !== 'begin_period') assert.fail('expected begin_period');
    assert.equal(begin.publish_state, 'preparing');
    // 🔴 The run id comes from the DATABASE; the plan never invents one.
    assert.equal(begin.returnsRunId, true);
    assert.equal(begin.resolvesRunHandle, true);

    // Visibility is decided by the run's publish_state, and only ONE published run may exist per
    // period — so a `preparing` run is addressable but not readable as published.
    const sql = sqlWithoutComments(migrationSql());
    assert.match(sql, /CREATE UNIQUE INDEX source_snapshot_runs_published_period_uidx/);
    assert.match(sql, /WHERE publish_state = 'published' AND source_period IS NOT NULL/);
    assert.deepEqual([...BR_RECEITA_SNAPSHOT_PUBLISH_STATES], [
      'preparing',
      'published',
      'superseded',
      'failed',
      'rolled_back',
    ]);
    // The code's state set and the DDL's must be the same set.
    for (const state of BR_RECEITA_SNAPSHOT_PUBLISH_STATES) {
      assert.ok(sql.includes(`'${state}'`), `the DDL must know the ${state} state`);
    }
  });

  it('20. a failed build cannot become published', async () => {
    const plan = samplePlan();
    assert.equal(plan.onFailure.kind, 'fail_period');
    assert.equal(plan.onFailure.to, 'failed');
    assert.equal(plan.onFailure.leavesPreviousPublishedRunIntact, true);
    assert.equal(plan.onFailure.cleanupIsRunScoped, true);
    // The failure operation is NOT in the forward operation stream: it is reached instead of
    // publish, never after it.
    const ops = await drivePlan(plan);
    assert.equal(
      ops.some((o) => (o as { kind: string }).kind === 'fail_period'),
      false,
    );
  });

  it('21. the previously published run survives a failed next build, and is never deleted', async () => {
    const ops = await drivePlan(samplePlan({ supersedesPublishedRunId: RUN_A }), RUN_B);
    const plan = samplePlan({ supersedesPublishedRunId: RUN_A });

    // Nothing — including the failure path — addresses any other period.
    assert.equal(JSON.stringify([...ops, plan.onFailure]).includes('2026-06'), false);

    // The only destructive operation names run B, excludes `published`, and has no period-only form.
    const discards = ops.filter((o) => o.kind === 'discard_run_rows');
    assert.equal(discards.length, 1);
    const discard = discards[0];
    if (discard.kind !== 'discard_run_rows') assert.fail('expected discard_run_rows');
    assert.equal(discard.snapshot_run_id, RUN_B);
    assert.notEqual(discard.snapshot_run_id, RUN_A, 'a rebuild may never target the live run');
    assert.equal(discard.onlyWhenRunPublishStateIn.includes('published'), false);
    assert.deepEqual([...discard.onlyWhenRunPublishStateIn], [...BR_RECEITA_DISCARDABLE_PUBLISH_STATES]);
  });

  it('22. the publish transition is atomic by contract, and is unconditionally LAST', async () => {
    const ops = await drivePlan(samplePlan({ supersedesPublishedRunId: RUN_A }), RUN_B);
    const kinds = ops.map((o) => o.kind);
    assert.equal(kinds[0], 'begin_period');
    assert.equal(kinds[1], 'discard_run_rows');
    assert.equal(kinds[kinds.length - 1], 'publish_period');
    assert.equal(kinds.filter((k) => k === 'publish_period').length, 1);

    const publish = ops[ops.length - 1];
    if (publish.kind !== 'publish_period') assert.fail('expected publish_period');
    assert.equal(publish.from, 'preparing');
    assert.equal(publish.to, 'published');
    assert.equal(publish.snapshot_run_id, RUN_B);
    assert.equal(publish.mustCommitWithFinalBatch, true);
    assert.equal(publish.readerSeesPreviousRunUntilCommit, true);

    // 🔴 ONE transaction, demote BEFORE promote — the published-per-period index is immediate, so
    // the reverse order would collide at the promoting statement.
    assert.deepEqual([...publish.transitionOrder], ['demote_superseded_run', 'promote_preparing_run']);
    assert.deepEqual(publish.supersedes, {
      snapshot_run_id: RUN_A,
      from: 'published',
      to: 'superseded',
    });
  });

  it('a FIRST build of a period supersedes nothing', async () => {
    const ops = await drivePlan(samplePlan(), RUN_A);
    const publish = ops[ops.length - 1];
    if (publish.kind !== 'publish_period') assert.fail('expected publish_period');
    assert.equal(publish.supersedes, null);
  });

  it('23. a partial period is never marked complete — no batch follows the publish', async () => {
    const ops = await drivePlan(samplePlan());
    const publishIndex = ops.findIndex((o) => o.kind === 'publish_period');
    assert.deepEqual(ops.slice(publishIndex + 1), [], 'nothing may run after the period is published');

    const batchIndexes = ops.map((o, i) => (o.kind === 'upsert_batch' ? i : -1)).filter((i) => i >= 0);
    assert.ok(batchIndexes.length > 0);
    assert.ok(batchIndexes.every((i) => i < publishIndex));

    // 🔴 An EMPTY period THROWS mid-stream rather than reaching the publish. Throwing is what makes
    // the publish unreachable — a yielded failure would leave the executor free to carry on.
    const empty = plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records: [] });
    const seen: string[] = [];
    await assert.rejects(
      async () => {
        for await (const op of empty.operations()) {
          if (op.kind === 'begin_period') empty.runHandle.resolve(RUN_A);
          seen.push(op.kind);
        }
      },
      (error: unknown) =>
        error instanceof BrReceitaSnapshotStreamError && error.reason === 'empty_period',
    );
    assert.equal(seen.includes('publish_period'), false);

    const plan = samplePlan();
    assert.equal(plan.partialPeriodVisible, false);
    assert.equal(plan.crossPeriodOverwritePossible, false);
    assert.equal(plan.crossRunOverwritePossible, false);
  });

  it('the plan writes nothing: no client, no table mutation, no I/O anywhere in the module', () => {
    for (const modulePath of [
      '../br-receita-cnpj-monthly-snapshot-write-plan.ts',
      '../br-receita-cnpj-monthly-snapshot-run-handle.ts',
      '../br-receita-cnpj-monthly-snapshot-read-contract.ts',
    ]) {
      const source = connectorSource(modulePath);
      for (const forbidden of [
        'createClient',
        'supabase',
        '.from(',
        '.upsert(',
        '.insert(',
        '.delete(',
        'node:fs',
        'fetch(',
        'process.env',
      ]) {
        assert.equal(source.includes(forbidden), false, `${modulePath} must not carry ${forbidden}`);
      }
    }
    assert.equal(samplePlan().writesNothing, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// STREAMING — planner-owned memory is O(BATCH_SIZE), not O(NATIONAL_ROWS)
// ════════════════════════════════════════════════════════════════════════════

describe('CUT-A · streaming', () => {
  it('plan creation consumes ZERO rows', () => {
    const producer = countingIterable(manyRecords(50));
    const plan = plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records: producer });
    // Building the plan validated a period and minted a handle. It did not look at the data.
    assert.equal(producer.pulled(), 0);
    assert.equal(plan.plannerMemoryBound, 'O(BATCH_SIZE)');
    assert.equal(plan.retainsWholePeriodInMemory, false);
  });

  it('the first yielded batch does NOT exhaust the input', async () => {
    const total = 50;
    const batchSize = 10;
    const producer = countingIterable(manyRecords(total));
    const plan = plannedOrThrow({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: producer,
      batchSize,
    });

    const stream = plan.operations();
    const pulledAt: number[] = [];
    let firstBatch: UpsertBatchOperation | null = null;
    for (;;) {
      const next = await stream.next();
      if (next.done) break;
      if (next.value.kind === 'begin_period') plan.runHandle.resolve(RUN_A);
      pulledAt.push(producer.pulled());
      if (next.value.kind === 'upsert_batch') {
        firstBatch = next.value;
        break;
      }
    }
    assert.ok(firstBatch, 'a batch must be reachable');
    assert.equal(firstBatch.rows.length, batchSize);
    // 🔴 The load-bearing assertion: the whole nation has NOT been read to produce batch 0.
    assert.ok(producer.pulled() < total, 'the input must not be exhausted for the first batch');
    assert.equal(producer.pulled(), batchSize);
    // And the header operations were emitted before ANY row was pulled.
    assert.equal(pulledAt[0], 0, 'begin_period consumes no rows');
    assert.equal(pulledAt[1], 0, 'discard_run_rows consumes no rows');
    await stream.return(undefined);
  });

  it('no batch exceeds the configured cap, and the cap cannot be raised past the pinned one', async () => {
    assert.equal(BR_RECEITA_SNAPSHOT_BATCH_ROWS, 500);
    const records = manyRecords(23);

    const ops = await drivePlan(
      plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records, batchSize: 5 }),
    );
    const batches = batchesOf(ops);
    assert.equal(batches.length, 5, '23 rows at 5 per batch = 4 full + 1 remainder');
    assert.ok(batches.every((b) => b.rows.length <= 5));
    assert.equal(batches[batches.length - 1].rows.length, 3, 'the remainder is flushed');
    assert.equal(rowsOf(ops).length, records.length);
    // Batch indexes are dense and ordered.
    assert.deepEqual(batches.map((b) => b.batchIndex), [0, 1, 2, 3, 4]);

    const raised = plannedOrThrow({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records,
      batchSize: 10_000,
    });
    assert.equal(raised.batchSize, BR_RECEITA_SNAPSHOT_BATCH_ROWS);
  });

  it('a SYNCHRONOUS iterable works', async () => {
    const producer = countingIterable(manyRecords(12));
    const ops = await drivePlan(
      plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records: producer, batchSize: 5 }),
    );
    assert.equal(rowsOf(ops).length, 12);
    assert.equal(producer.pulled(), 12);
  });

  it('an ASYNCHRONOUS iterable works — the shape a real file reader has', async () => {
    const producer = asyncCountingIterable(manyRecords(12));
    const ops = await drivePlan(
      plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records: producer, batchSize: 5 }),
    );
    assert.equal(rowsOf(ops).length, 12);
    assert.equal(producer.pulled(), 12);
    assert.equal(batchesOf(ops).length, 3);
  });

  it('a multi-batch producer stays BOUNDED — no batch retains a previous batch', async () => {
    const batchSize = 4;
    const plan = plannedOrThrow({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: manyRecords(40),
      batchSize,
    });

    let maxRowsHeldByOneOperation = 0;
    let batchCount = 0;
    for await (const op of plan.operations()) {
      if (op.kind === 'begin_period') plan.runHandle.resolve(RUN_A);
      if (op.kind !== 'upsert_batch') continue;
      batchCount += 1;
      maxRowsHeldByOneOperation = Math.max(maxRowsHeldByOneOperation, op.rows.length);
    }
    assert.equal(batchCount, 10);
    // 🔴 No single operation ever carried more than one batch's worth, so nothing accumulated.
    assert.equal(maxRowsHeldByOneOperation, batchSize);
  });

  it('🔴 the planner holds NO whole-period structure — asserted against the source', () => {
    const source = connectorSource('../br-receita-cnpj-monthly-snapshot-write-plan.ts');
    const executable = source
      .split('\n')
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .join('\n');

    // The rejected shapes, named exactly as the review named them.
    assert.equal(executable.includes('[...byIdentity'), false, 'no whole-period Map drain');
    assert.equal(/\bbyIdentity\b/.test(executable), false, 'no period-wide identity Map');
    assert.equal(/const accepted\b/.test(executable), false, 'no accepted whole-period array');
    assert.equal(
      /operations:\s*BrReceitaSnapshotWriteOperation\[\]/.test(executable),
      false,
      'no eager operations array holding every row',
    );
    assert.equal(
      /collapsedDuplicateCount/.test(executable),
      false,
      'no period-wide duplicate metric — it could not be exact without national memory',
    );
    assert.equal(/acceptedRecordCount/.test(executable), false, 'no period-wide accepted count');
    assert.equal(/batchCount/.test(executable), false, 'no period-wide batch count');

    // And the required shape IS present: a lazy async generator.
    assert.match(executable, /async function\* streamOperations/);
    assert.match(executable, /AsyncGenerator<BrReceitaSnapshotWriteOperation/);
    assert.match(executable, /for await \(const record of args\.records\)/);

    // The negative control: this guard must be able to FAIL. If the assertions above matched
    // nothing at all, the executable body would be empty and the guard vacuous.
    assert.ok(executable.includes('planBrReceitaMonthlySnapshotWrite'));
    assert.ok(executable.length > 2_000);
  });

  it('the plan exposes no array of all rows — `operations` is a function, not a document', () => {
    const plan = plannedOrThrow({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: manyRecords(30),
      batchSize: 5,
    });
    assert.equal(typeof plan.operations, 'function');
    assert.equal(Array.isArray((plan as unknown as { operations: unknown }).operations), false);
    // Nothing on the plan is proportional to the period.
    for (const [key, value] of Object.entries(plan)) {
      assert.equal(Array.isArray(value), false, `plan.${key} must not be an array of rows`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN VERSIONING — A/B isolation, atomic cutover, run-scoped cleanup
// ════════════════════════════════════════════════════════════════════════════

describe('CUT-A · run-versioned snapshot isolation', () => {
  it('a Brazil row REQUIRES a snapshot_run_id, in the schema and in the batch', async () => {
    const sql = sqlWithoutComments(migrationSql());
    assert.match(sql, /ADD COLUMN snapshot_run_id uuid NULL/);
    assert.match(sql, /REFERENCES public\.source_snapshot_runs \(id\)/);
    // Required for Brazil by CHECK, nullable at table level for year-grained sources.
    const check = sql.slice(sql.indexOf('source_company_snapshots_br_receita_identity_chk'));
    assert.ok(check.slice(0, check.indexOf(';')).includes('snapshot_run_id IS NOT NULL'));

    const ops = await drivePlan(
      plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records: manyRecords(6), batchSize: 2 }),
    );
    // Every row carries the run, and it is the run begin_period reported.
    for (const row of rowsOf(ops)) {
      assert.equal(row.snapshot_run_id, RUN_A);
    }
    for (const batch of batchesOf(ops)) {
      assert.equal(batch.snapshot_run_id, RUN_A);
      assert.ok(batch.conflictColumns.includes(SNAPSHOT_RUN_ID_COLUMN));
      assert.equal(batch.conflictIndexPredicate, BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE);
    }
  });

  it('🔴 the run id is NOT CNPJ-derived, and cannot be made so', () => {
    const record = persistedSampleSnapshots()[0];
    assert.ok(record);
    const cnpj = record.identity.normalized_tax_id;

    // A canonical UUID is [0-9a-f-] only, so a 14-char alphanumeric CNPJ cannot hide inside one.
    assert.equal(parseSnapshotRunId(cnpj).valid, false);
    assert.equal(parseSnapshotRunId(`tax:${cnpj}`).valid, false);
    assert.equal(parseSnapshotRunId(SAMPLE_SOURCE_PERIOD).valid, false);
    assert.equal(parseSnapshotRunId(1).valid, false);
    assert.equal(parseSnapshotRunId(null).valid, false);
    assert.equal(parseSnapshotRunId(RUN_A).valid, true);

    // And the explicit derivation guard refuses one that did embed it.
    assert.throws(
      () => assertRunIdIsNotDerivedFrom('11222333-0001-4800-8111-111111111111', '11222333000148'),
      (error: unknown) => {
        assert.ok(error instanceof InvalidSnapshotRunIdError);
        assert.equal(error.reason, 'derived_from_forbidden_material');
        // 🔴 The refusal must not echo the material it refused.
        assert.equal(error.message.includes('11222333000148'), false);
        return true;
      },
    );
    // Negative control: a genuine run id passes the same guard.
    assertRunIdIsNotDerivedFrom(RUN_A, cnpj);

    // 🔴 The run-handle module — the one place a run id is minted, validated and handed out —
    // does not reference tax material AT ALL. Asserted against the EXECUTABLE body, because the
    // module explains in prose why it must not and a raw scan would report that explanation as
    // the violation.
    const handleBody = executableSource('../br-receita-cnpj-monthly-snapshot-run-handle.ts');
    assert.equal(handleBody.includes('normalized_tax_id'), false);
    assert.equal(handleBody.includes('cnpj'), false);
    assert.equal(handleBody.includes('Cnpj'), false);
    // Negative control: stripping comments must not have emptied the body.
    assert.ok(handleBody.includes('export function createSnapshotRunHandle'));
    assert.ok(handleBody.length > 1_000);

    // The read-contract module NAMES the identity column once, in its recorded contract, to state
    // which column the single representation is. Naming it is not reading it: it appears in no
    // lookup-column list, no predicate and no request shape.
    const readBody = executableSource('../br-receita-cnpj-monthly-snapshot-read-contract.ts');
    assert.equal(
      readBody.split('normalized_tax_id').length - 1,
      1,
      'the identity column may be named exactly once, as a recorded fact',
    );
    assert.match(readBody, /identityRepresentationColumn: 'normalized_tax_id'/);
    for (const columnList of [
      BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS,
      BR_RECEITA_RUN_SCOPED_READ_COLUMNS,
    ]) {
      assert.equal(columnList.includes('normalized_tax_id'), false);
    }
    // A read request has nowhere to put an identity, so a verdict can never echo one.
    const verdict = classifyBrReceitaSnapshotRead({
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: 'BR',
      source_period: SAMPLE_SOURCE_PERIOD,
      snapshot_run_id: RUN_A,
      resolved_run_publish_state: 'published',
    });
    assert.equal(JSON.stringify(verdict).includes(cnpj), false);
    assert.equal(/[0-9A-Z]{14}/.test(JSON.stringify(verdict)), false);
  });

  it('run A and run B hold the SAME period and the SAME CNPJ, under different run ids', async () => {
    const records = persistedSampleSnapshots();
    const runA = await drivePlan(
      plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records }),
      RUN_A,
    );
    const runB = await drivePlan(
      plannedOrThrow({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records }),
      RUN_B,
    );

    const identitiesA = rowsOf(runA).map((r) => brReceitaLogicalSnapshotIdentity(r.identity));
    const identitiesB = rowsOf(runB).map((r) => brReceitaLogicalSnapshotIdentity(r.identity));
    // Same period, same establishments — the LOGICAL identity is identical...
    assert.deepEqual(identitiesA, identitiesB);
    // ...and yet the PHYSICAL keys differ, purely by run, so both row sets can exist at once.
    assert.notDeepEqual(
      rowsOf(runA).map((r) => r.snapshot_run_id),
      rowsOf(runB).map((r) => r.snapshot_run_id),
    );
    assert.ok(rowsOf(runA).every((r) => r.snapshot_run_id === RUN_A));
    assert.ok(rowsOf(runB).every((r) => r.snapshot_run_id === RUN_B));
  });

  it('a duplicate of (same run + same period + same CNPJ) is impossible', async () => {
    const records = persistedSampleSnapshots();
    const ops = await drivePlan(
      plannedOrThrow({
        sourcePeriod: SAMPLE_SOURCE_PERIOD,
        records: [...records, ...records],
        batchSize: records.length * 2,
      }),
    );
    const physicalKeys = rowsOf(ops).map((r) =>
      [
        r.identity.source_key,
        r.identity.country_code,
        r.identity.source_period,
        r.snapshot_run_id,
        r.identity.normalized_tax_id,
      ].join('|'),
    );
    assert.equal(new Set(physicalKeys).size, physicalKeys.length, 'no repeated physical key');
    // And the DDL is what enforces it beyond one batch.
    assert.match(
      sqlWithoutComments(migrationSql()),
      /CREATE UNIQUE INDEX source_company_snapshots_br_period_identity_uidx/,
    );
  });

  it("run B's staging cannot modify run A's rows", async () => {
    const ops = await drivePlan(
      plannedOrThrow({
        sourcePeriod: SAMPLE_SOURCE_PERIOD,
        records: persistedSampleSnapshots(),
        supersedesPublishedRunId: RUN_A,
      }),
      RUN_B,
    );

    // Not one write operation names run A. The demotion in the publish is a RUN-STATE change on
    // source_snapshot_runs, never a row mutation on source_company_snapshots.
    for (const op of ops) {
      if (op.kind === 'upsert_batch' || op.kind === 'discard_run_rows') {
        assert.equal(op.snapshot_run_id, RUN_B);
        assert.equal(JSON.stringify(op).includes(RUN_A), false, 'a staging write must not name the live run');
      }
    }
    const publish = ops[ops.length - 1];
    if (publish.kind !== 'publish_period') assert.fail('expected publish_period');
    assert.equal(publish.table, 'source_snapshot_runs');
    assert.equal(publish.supersedes?.snapshot_run_id, RUN_A);
  });

  it('a PREPARING run is invisible, and a FAILED B leaves A visible', () => {
    // Visibility is a function of the run's state, resolved through the published-run index.
    for (const state of ['preparing', 'failed', 'rolled_back', 'superseded'] as const) {
      assert.equal(
        classifyBrReceitaSnapshotRead({
          source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
          country_code: 'BR',
          source_period: SAMPLE_SOURCE_PERIOD,
          snapshot_run_id: RUN_B,
          resolved_run_publish_state: state,
        }).isReadable,
        false,
        `a ${state} run must never be readable`,
      );
    }
    // A stays readable throughout, because nothing demoted it: the demotion lives inside the
    // publish transaction that a failed build never reaches.
    const a = classifyBrReceitaSnapshotRead({
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: 'BR',
      source_period: SAMPLE_SOURCE_PERIOD,
      snapshot_run_id: RUN_A,
      resolved_run_publish_state: 'published',
    });
    assert.equal(a.isReadable, true);
    assert.equal(a.classification, 'valid_published_run_scoped');
  });

  it('🔴 a PERIOD-ONLY Brazil read is FORBIDDEN, fail-closed', () => {
    const periodOnly = classifyBrReceitaSnapshotRead({
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: 'BR',
      source_period: SAMPLE_SOURCE_PERIOD,
    });
    assert.equal(periodOnly.isReadable, false);
    assert.equal(periodOnly.classification, 'invalid_period_only');
    assert.equal(periodOnly.reason, 'brazil_snapshot_read_requires_published_snapshot_run_id');

    // Holding a run id is not enough: the state must have been RESOLVED as published.
    assert.equal(
      classifyBrReceitaSnapshotRead({
        source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
        country_code: 'BR',
        source_period: SAMPLE_SOURCE_PERIOD,
        snapshot_run_id: RUN_B,
      }).classification,
      'invalid_unpublished_run',
    );
    // Malformed coordinates fail closed too.
    assert.equal(
      classifyBrReceitaSnapshotRead({
        source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
        country_code: 'BR',
        source_period: '2026-7',
        snapshot_run_id: RUN_A,
        resolved_run_publish_state: 'published',
      }).classification,
      'invalid_coordinates',
    );
  });

  it('the future reader contract requires the published run id, in two steps', () => {
    assert.deepEqual(
      [...BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS],
      ['source_key', 'country_code', 'source_period'],
    );
    assert.deepEqual(
      [...BR_RECEITA_RUN_SCOPED_READ_COLUMNS],
      ['source_key', 'country_code', 'source_period', 'snapshot_run_id'],
    );
    assert.equal(BR_RECEITA_FUTURE_READER_CONTRACT.periodOnlyReadIsValid, false);
    assert.equal(BR_RECEITA_FUTURE_READER_CONTRACT.step1RequiredPublishState, 'published');
    assert.equal(BR_RECEITA_FUTURE_READER_CONTRACT.runtimeRegistered, false);
    // 🔴 The run dimension is not counted as an identity representation.
    assert.equal(BR_RECEITA_FUTURE_READER_CONTRACT.identityRepresentationCount, 1);
    assert.equal(BR_RECEITA_FUTURE_READER_CONTRACT.snapshotRunIdIsAnIdentityRepresentation, false);
  });

  it('cleanup is scoped to a RUN and can never be expressed period-only', () => {
    const discard = planBrReceitaSnapshotRunDiscard({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      snapshotRunId: RUN_B,
    });
    assert.equal(discard.status, 'planned');
    if (discard.status !== 'planned') return;
    assert.equal(discard.operation.snapshot_run_id, RUN_B);
    assert.equal(discard.operation.canDeleteByPeriodAlone, false);
    assert.equal(discard.operation.canDeletePublishedRun, false);
    assert.equal(discard.operation.onlyWhenRunPublishStateIn.includes('published'), false);

    // There is no way to ask for a cleanup without naming a run.
    assert.equal(
      planBrReceitaSnapshotRunDiscard({ sourcePeriod: SAMPLE_SOURCE_PERIOD, snapshotRunId: '' }).status,
      'rejected',
    );
    assert.equal(
      planBrReceitaSnapshotRunDiscard({ sourcePeriod: SAMPLE_SOURCE_PERIOD, snapshotRunId: 'latest' })
        .status,
      'rejected',
    );

    // 🔴 The old period-wide reset is GONE, not renamed.
    const source = connectorSource('../br-receita-cnpj-monthly-snapshot-write-plan.ts');
    assert.equal(source.includes('reset_unpublished_period'), false);
    assert.equal(source.includes('onlyWhenPeriodIsUnpublished'), false);

    // And the FK refuses to let a run be deleted while its rows exist, so cleanup must name rows.
    assert.match(sqlWithoutComments(migrationSql()), /ON DELETE RESTRICT/);
  });

  it('the A→B cutover is ONE transaction, demote-then-promote', () => {
    // The DDL records WHY the order is forced: the published-per-period index is immediate.
    assert.ok(migrationSql().includes('demote first'));
    assert.ok(migrationSql().includes('then promote'));
    // 🔴 And the index really is immediate. Checked on the comment-stripped body, because the
    // header explains the choice in prose and a raw scan would match that explanation.
    const executableSql = sqlWithoutComments(migrationSql());
    assert.equal(
      executableSql.includes('DEFERRABLE'),
      false,
      'an immediate index is the deliberate choice — a deferred one moves the failure to COMMIT',
    );
    assert.ok(
      executableSql.includes('source_snapshot_runs_published_period_uidx'),
      'the guard must not be vacuous',
    );

    // And the plan carries the same order as data, so an executor cannot invert it.
    const plan = plannedOrThrow({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: persistedSampleSnapshots(),
      supersedesPublishedRunId: RUN_A,
    });
    assert.equal(plan.crossRunOverwritePossible, false);
  });

  it('a batch is UNOBTAINABLE until begin_period reports its run id', async () => {
    const plan = plannedOrThrow({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: persistedSampleSnapshots(),
    });
    const stream = plan.operations();
    const first = await stream.next();
    assert.equal(first.value?.kind, 'begin_period');
    assert.equal(plan.runHandle.isResolved, false);

    // 🔴 An executor that ignored the returned run id gets an error, not a period-scoped fallback.
    await assert.rejects(
      () => stream.next(),
      (error: unknown) => error instanceof SnapshotRunHandleUnresolvedError,
    );
  });

  it('a run handle is single-assignment, and rejects a non-uuid', () => {
    const handle = createSnapshotRunHandle();
    assert.equal(handle.isResolved, false);
    assert.throws(() => handle.require(), SnapshotRunHandleUnresolvedError);

    handle.resolve(RUN_A);
    assert.equal(handle.isResolved, true);
    assert.equal(handle.require(), RUN_A);
    // Idempotent for the same run — a retried executor step is not an error.
    handle.resolve(RUN_A);
    assert.equal(handle.require(), RUN_A);
    // But never re-pointed: that would tear one period across two runs.
    assert.throws(() => handle.resolve(RUN_B), SnapshotRunHandleReassignedError);

    assert.throws(() => createSnapshotRunHandle().resolve('not-a-uuid'), InvalidSnapshotRunIdError);
    assert.throws(() => createSnapshotRunHandle().resolve(undefined), InvalidSnapshotRunIdError);
  });

  it('a superseded run id supplied by the caller must be a real uuid', () => {
    assert.equal(
      planBrReceitaMonthlySnapshotWrite({
        sourcePeriod: SAMPLE_SOURCE_PERIOD,
        records: [],
        supersedesPublishedRunId: 'the-current-one',
      }).status,
      'rejected',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MIGRATION
// ════════════════════════════════════════════════════════════════════════════

describe('CUT-A · the migration artifact', () => {
  it('24. it enforces the period SYNTAX, with the same regex the code uses', () => {
    const sql = sqlWithoutComments(migrationSql());
    assert.match(sql, /source_company_snapshots_source_period_format_chk/);
    assert.match(sql, /source_snapshot_runs_source_period_format_chk/);

    // 🔴 One rule, two places. If these ever diverged, a period the app accepts could be one the
    // table rejects — or worse, the reverse.
    assert.ok(
      sql.includes(SOURCE_PERIOD_SQL_PATTERN),
      'the DDL must embed exactly SOURCE_PERIOD_SQL_PATTERN',
    );
    assert.equal(SOURCE_PERIOD_PATTERN.source, SOURCE_PERIOD_SQL_PATTERN);
  });

  it('25. it enforces real NOT-NULL / uniqueness protection, not a decorative one', () => {
    const sql = sqlWithoutComments(migrationSql());
    // The identity CHECK is VALIDATED, not NOT VALID: a NOT VALID check does not constrain the rows
    // that already exist, which is precisely the guarantee this cut needs.
    const checkStart = sql.indexOf('source_company_snapshots_br_receita_identity_chk');
    const checkStatement = sql.slice(checkStart, sql.indexOf(';', checkStart));
    assert.equal(/NOT\s+VALID/i.test(checkStatement), false, 'the identity CHECK must be validated');

    // Exactly one representation, enforced by the schema rather than by convention.
    assert.match(checkStatement, /tax_id IS NULL/);
    assert.match(checkStatement, /record_identity_key IS NULL/);
    // And the year may never disagree with the period.
    assert.match(checkStatement, /source_year::text = substring\(source_period from 1 for 4\)/);
    // And the raw_data provenance copy may never drift from the identity column.
    assert.match(checkStatement, /raw_data ->> 'source_period'\) = source_period/);
  });

  it('26. uniqueness is period-aware, and the year-grained constraint is superseded not merely left', () => {
    const sql = sqlWithoutComments(migrationSql());
    // It is DROPPED, located by column set rather than by a guessed auto-generated name...
    assert.match(sql, /DROP CONSTRAINT %I/);
    assert.match(sql, /ARRAY\['country_code', 'normalized_tax_id', 'source_key', 'source_year'\]/);
    // ...and its absence is a hard error rather than a silent skip.
    assert.match(sql, /RAISE EXCEPTION/);
    // ...and it is replaced, not deleted.
    assert.match(sql, /CREATE UNIQUE INDEX source_company_snapshots_year_identity_uidx/);
    assert.match(sql, /CREATE UNIQUE INDEX source_company_snapshots_br_period_identity_uidx/);

    // 🔴 The drop and both creates are in ONE transaction: any window with no uniqueness at all
    // would be worse than the hazard being fixed. That is also why CONCURRENTLY is absent.
    assert.match(sql, /^BEGIN;$/m);
    assert.match(sql, /^COMMIT;$/m);
    assert.equal(/CONCURRENTLY/i.test(sql), false);
  });

  it('27. it does not weaken unrelated country/source rows', () => {
    const sql = sqlWithoutComments(migrationSql());
    // Every Brazil-specific constraint is guarded by the source_key escape hatch, so a non-Brazil
    // row is never subject to a Brazil rule.
    const brazilChecks = sql
      .split(';')
      .filter((stmt) => /br_receita_cnpj_dados_abertos/.test(stmt) && /CHECK/i.test(stmt));
    assert.ok(brazilChecks.length >= 2);
    for (const stmt of brazilChecks) {
      assert.match(stmt, /source_key <> 'br_receita_cnpj_dados_abertos'/);
    }
    // Nothing is dropped except the one constraint that is immediately replaced.
    assert.equal((sql.match(/DROP CONSTRAINT/g) ?? []).length, 1);
    assert.equal(/DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i.test(sql), false);
    // Existing RLS and grants are untouched.
    assert.equal(/DROP\s+POLICY|REVOKE|DISABLE\s+ROW\s+LEVEL/i.test(sql), false);
  });

  it('28. NOTHING in this repository applies the migration', () => {
    // 🔴 The tokens are ASSEMBLED from parts, never written whole. A guard that greps for a literal
    // it also contains finds itself and fails — the same self-reference trap the `'4'.repeat(14)`
    // convention avoids elsewhere in this suite family. The parts are joined at runtime so the
    // forbidden spelling never appears in this file.
    const APPLY_PATHS = [
      ['apply', 'migration'].join('_'),
      ['execute', 'sql'].join('_'),
      ['supabase', 'db', 'push'].join(' '),
      ['Embedded', 'Postgres'].join(''),
    ];

    // The suite itself reads the migration as TEXT and never executes it.
    const suite = connectorSource('./br-receita-cnpj-functional-cut-a-monthly-snapshot.test.ts');
    for (const forbidden of APPLY_PATHS) {
      assert.equal(suite.includes(forbidden), false, `this suite must not reach for ${forbidden}`);
    }

    // Neither does any CUT-A module, nor the migration's own SQL body.
    for (const modulePath of [
      '../br-receita-cnpj-monthly-snapshot-identity.ts',
      '../br-receita-cnpj-monthly-snapshot-write-plan.ts',
      '../br-receita-cnpj-monthly-snapshot-run-handle.ts',
      '../br-receita-cnpj-monthly-snapshot-read-contract.ts',
      '../../../source-period/source-period.ts',
    ]) {
      const source = connectorSource(modulePath);
      for (const forbidden of [...APPLY_PATHS, 'migrations/']) {
        assert.equal(source.includes(forbidden), false, `${modulePath} must not reach for ${forbidden}`);
      }
    }

    // 🔴 And the guard is proven in the NEGATIVE, so it cannot pass by being vacuous: the token
    // list really does match when the token really is present.
    assert.equal(APPLY_PATHS.length, 4);
    assert.ok(APPLY_PATHS.every((token) => token.length > 0));
    const poisoned = `const x = ${APPLY_PATHS[0]}();`;
    assert.equal(poisoned.includes(APPLY_PATHS[0]), true, 'the guard must detect a real occurrence');

    assert.equal(BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION.migrationApplied, false);
    assert.equal(BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION.migrationAuthored, true);
  });

  it('the migration is the only one this cut adds, and it is numbered 125', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const highest = files
      .map((name) => Number.parseInt(name.slice(0, 3), 10))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0);
    // AGENT1-CUT3B4 took 126 (batch-identity fencing, Agent 1). What this test asserts
    // is that CUT A adds exactly ONE migration and that it is the 125 — both still true.
    // The ceiling moves with the repo; the ownership claim does not.
    assert.equal(highest, 126);
    assert.equal(files.filter((f) => f.startsWith('125')).length, 1);
    assert.ok(files.includes(CUT_A_MIGRATION));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REGRESSION — the boundary CUT A must not cross
// ════════════════════════════════════════════════════════════════════════════

describe('CUT-A · governance and operational boundary', () => {
  it('29. all eight gates are still approved', () => {
    assert.equal(brazilReceitaApprovedGateCount(), 8);
    assert.equal(brazilReceitaGateGlobalVerdict(), 'GO');
    assert.equal(BRAZIL_RECEITA_GATE4_STATUS, 'approved');
  });

  it('30. the governance GO remains narrow — it is not permission to execute', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_APPROVAL_IS_PERMISSION_TO_WRITE_RUNNER, false);
    // The recorded meaning of GO is unchanged by this cut.
    assert.ok(BRAZIL_RECEITA_GATE_GO_MEANS);
    const goMeans = JSON.stringify(BRAZIL_RECEITA_GATE_GO_MEANS).toLowerCase();
    assert.equal(goMeans.includes('authorizes execution'), false);
  });

  it('31. ATTEMPT_3_ALLOWED remains false', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
  });

  it('32. the GATE-5 output boundary stays closed — no report becomes emittable', () => {
    assert.equal(BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS.length, 0);
    assert.equal(BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED, true);
    assert.equal(BRAZIL_RECEITA_GATE5_ENGINE_REPORT_PROJECTION_REQUIRED, true);
    assert.equal(BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTED, false);
  });

  it('33. no operational flag, env read or provider call is added', () => {
    for (const modulePath of [
      '../br-receita-cnpj-monthly-snapshot-identity.ts',
      '../br-receita-cnpj-monthly-snapshot-write-plan.ts',
      '../br-receita-cnpj-monthly-snapshot-run-handle.ts',
      '../br-receita-cnpj-monthly-snapshot-read-contract.ts',
      '../../../source-period/source-period.ts',
    ]) {
      const source = connectorSource(modulePath);
      for (const forbidden of [
        'process.env',
        'ENABLE_',
        'getApolloApiKey',
        'getLushaApiKey',
        'hubspot',
        'HubSpot',
        'fetch(',
        'https://',
      ]) {
        assert.equal(source.includes(forbidden), false, `${modulePath} must not carry ${forbidden}`);
      }
    }
  });

  it('34. a period-less Brazil persistence is no longer representable', () => {
    // Both halves: the builder refuses to produce one (asserted above), and the guard refuses to
    // accept one even if a caller hand-built it.
    const violations = findBrazilReceitaSnapshotRowPersistabilityViolations({
      tax_id: '',
      normalized_tax_id: sampleFullCnpj(RAIZ_TECNOLOGIA, '0001'),
      record_identity_key: '' as never,
      source_period: '' as never,
    });
    assert.deepEqual(violations, [
      { field: 'source_period', violation: 'source_period_missing_or_malformed' },
    ]);
    // And the projection cannot be built from such a row.
    assert.throws(
      () =>
        toBrReceitaPersistedSnapshot({
          source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
          country_code: 'BR',
          source_year: 2026,
          source_period: '2026',
          tax_id: '',
          normalized_tax_id: sampleFullCnpj(RAIZ_TECNOLOGIA, '0001'),
          legal_name: null,
          raw_data: {} as never,
          record_identity_key: '' as never,
        }),
      BrazilReceitaGate4NonPersistableRowError,
    );
  });

  it('exactly ONE identity representation is persistable, and it is the CNPJ column', () => {
    assert.equal(BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS.length, 3);
    assert.deepEqual([...BRAZIL_RECEITA_GATE4_PERSISTED_IDENTITY_FIELDS], ['normalized_tax_id']);
    assert.deepEqual([...BRAZIL_RECEITA_GATE4_NON_PERSISTABLE_FIELDS].sort(), [
      'record_identity_key',
      'tax_id',
    ]);
    assert.equal(BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION.identityRepresentationCount, 1);
    assert.equal(
      BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION.persistedIdentityColumn,
      'source_company_snapshots.normalized_tax_id',
    );

    // 🔴 The second representations stay refused, and the `tax:` namespace is still caught on its
    // own — nulling tax_id must not make a tax-namespaced key look clean.
    const withKey = findBrazilReceitaSnapshotRowPersistabilityViolations({
      tax_id: '',
      normalized_tax_id: sampleFullCnpj(RAIZ_TECNOLOGIA, '0001'),
      record_identity_key: 'tax:11222333000181' as never,
      source_period: SAMPLE_SOURCE_PERIOD,
    });
    assert.deepEqual(withKey, [
      { field: 'record_identity_key', violation: 'prohibited_identity_namespace' },
    ]);
  });

  it('this cut exercises 4A rather than inventing an authorization', () => {
    assert.equal(BRAZIL_RECEITA_GATE4A_APPROVAL.decision, 'yes');
    assert.equal(BRAZIL_RECEITA_GATE4A_APPROVAL.approvedByAgent, false);
    assert.equal(
      BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION.exceptionOwnerReference,
      BRAZIL_RECEITA_GATE4A_APPROVAL.ownerReference,
    );
    assert.equal(BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION.exercisesGate4aException, true);
    // Storage and internal lookup only.
    for (const bound of [
      'authorizesPrinting',
      'authorizesLogging',
      'authorizesReporting',
      'authorizesPublicProjection',
      'authorizesImport',
      'authorizesSupabaseWrite',
      'authorizesRuntimeRegistration',
      'authorizesAgentIntegration',
    ] as const) {
      assert.equal(BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION[bound], false, bound);
    }
  });

  it('the engine bridge is NOT built and Brazil is NOT registered as a runtime source', () => {
    // 🔴 The source family registry still THROWS for Brazil, which is the correct fail-closed
    // answer while the five read primitives remain source_year-scoped.
    assert.equal(BR_RECEITA_CNPJ_SOURCE_KEY in SOURCE_FAMILY_BY_SOURCE_KEY, false);
    assert.equal(
      BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION.registeredInSourceFamilyRegistry,
      false,
    );
    assert.equal(
      BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION.periodAwareReadPrimitiveRequired,
      true,
    );

    // No CUT-A module reaches for the full-join engine or Agent 1.
    for (const modulePath of [
      '../br-receita-cnpj-monthly-snapshot-identity.ts',
      '../br-receita-cnpj-monthly-snapshot-write-plan.ts',
    ]) {
      const source = connectorSource(modulePath);
      for (const forbidden of ['full-join', 'fullJoin', 'agent1', 'Agent1', 'prospecting-toolkit']) {
        assert.equal(source.includes(forbidden), false, `${modulePath} must not reach for ${forbidden}`);
      }
    }
    // The table this cut targets is the existing generic one, not a new parallel store.
    assert.equal(BR_RECEITA_SNAPSHOT_TABLE, 'source_company_snapshots');
  });

  it('no dataset filename or real-data path is introduced', () => {
    const sql = migrationSql();
    for (const artifact of [
      connectorSource('../br-receita-cnpj-monthly-snapshot-identity.ts'),
      connectorSource('../br-receita-cnpj-monthly-snapshot-write-plan.ts'),
      sql,
    ]) {
      for (const forbidden of ['ESTABELECIMENTOS', 'EMPRESAS', '.zip', 'dadosabertos', '/Volumes/', '/Users/']) {
        assert.equal(artifact.includes(forbidden), false, `must not reference ${forbidden}`);
      }
    }
  });
});
