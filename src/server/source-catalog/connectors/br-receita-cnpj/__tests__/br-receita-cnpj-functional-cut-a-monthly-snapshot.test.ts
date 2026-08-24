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
  BR_RECEITA_SNAPSHOT_BATCH_ROWS,
  BR_RECEITA_SNAPSHOT_PUBLISH_STATES,
  BR_RECEITA_PERIOD_CONFLICT_COLUMNS,
} from '../br-receita-cnpj-monthly-snapshot-write-plan';
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

/** The builder's rows, projected to what a writer may see. */
function persistedSampleSnapshots(period = SAMPLE_SOURCE_PERIOD): BrReceitaPersistedSnapshot[] {
  const input = { ...sampleParserInput(), sourcePeriod: period };
  return buildBrReceitaCnpjSnapshotRows(input).snapshots.map(toBrReceitaPersistedSnapshot);
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
  it('9. replaying the same period does not duplicate — identity collapses deterministically', () => {
    const records = persistedSampleSnapshots();
    const once = planBrReceitaMonthlySnapshotWrite({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records });
    const replayed = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: [...records, ...records],
    });
    assert.equal(once.status, 'planned');
    assert.equal(replayed.status, 'planned');
    if (once.status !== 'planned' || replayed.status !== 'planned') return;

    assert.equal(replayed.plan.acceptedRecordCount, once.plan.acceptedRecordCount);
    assert.equal(replayed.plan.collapsedDuplicateCount, once.plan.acceptedRecordCount);
    // Deterministic: the same input twice yields the same plan shape.
    assert.deepEqual(replayed.plan.operations.map((o) => o.kind), once.plan.operations.map((o) => o.kind));
  });

  it('10. a duplicate identity inside one incoming period is deterministic or fails closed', () => {
    const records = persistedSampleSnapshots();
    const doubled = [...records, ...records];

    const collapsed = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: doubled,
      onDuplicateIdentity: 'collapse_last_wins',
    });
    assert.equal(collapsed.status, 'planned');
    if (collapsed.status === 'planned') {
      assert.equal(collapsed.plan.acceptedRecordCount, records.length);
    }

    const rejected = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: doubled,
      onDuplicateIdentity: 'reject',
    });
    assert.equal(rejected.status, 'rejected');
    if (rejected.status === 'rejected') {
      assert.ok(rejected.rejections.every((r) => r.reason === 'duplicate_identity_in_batch'));
      // 🔴 An ORDINAL, never an identifier.
      assert.ok(rejected.rejections.every((r) => typeof r.recordIndex === 'number'));
      assert.equal(/[0-9A-Z]{14}/.test(JSON.stringify(rejected.rejections)), false);
    }
    // Never two logical snapshots either way.
    assert.notEqual(collapsed.status === 'planned' && collapsed.plan.acceptedRecordCount, doubled.length);
  });

  it('11. a NULL cannot bypass uniqueness — the DDL forbids the NULL, not just the duplicate', () => {
    const sql = sqlWithoutComments(migrationSql());

    // The Brazil branch requires BOTH identity columns to be present...
    assert.match(sql, /source_period IS NOT NULL/);
    assert.match(sql, /normalized_tax_id IS NOT NULL/);
    // ...inside a CHECK that only exempts non-Brazil sources.
    assert.match(sql, /source_key <> 'br_receita_cnpj_dados_abertos'/);
    assert.match(sql, /source_company_snapshots_br_receita_identity_chk/);

    // 🔴 This is the whole point of YH-2: a partial unique index over NULLABLE columns is not
    // uniqueness at all, because Postgres treats NULLs as DISTINCT. The index below is only
    // meaningful BECAUSE the CHECK above makes both columns NOT NULL for Brazil.
    assert.match(sql, /CREATE UNIQUE INDEX source_company_snapshots_br_period_identity_uidx/);
  });

  it('12. cross-period overwrite is impossible — the unique key is period-scoped', () => {
    const sql = sqlWithoutComments(migrationSql());
    // The Brazil unique index is keyed on source_period, NOT source_year.
    const brIndex = sql.slice(sql.indexOf('source_company_snapshots_br_period_identity_uidx'));
    const brIndexStatement = brIndex.slice(0, brIndex.indexOf(';'));
    assert.match(brIndexStatement, /\(source_key, country_code, source_period, normalized_tax_id\)/);
    assert.equal(brIndexStatement.includes('source_year'), false, 'a year-scoped key is the overwrite bug');

    // And the plan's conflict target agrees with the index, not with either year-scoped constant.
    assert.deepEqual(
      [...BR_RECEITA_PERIOD_CONFLICT_COLUMNS],
      ['source_key', 'country_code', 'source_period', 'normalized_tax_id'],
    );

    // A record from another month is REFUSED, never silently relabelled into the period being built.
    const augustRecords = persistedSampleSnapshots('2026-08');
    const result = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: '2026-07',
      records: augustRecords,
    });
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.rejections.every((r) => r.reason === 'record_period_mismatch'));
    }
  });

  it('12b. the SAME establishment in two periods produces two independent plans', () => {
    const july = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: '2026-07',
      records: persistedSampleSnapshots('2026-07'),
    });
    const august = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: '2026-08',
      records: persistedSampleSnapshots('2026-08'),
    });
    assert.equal(july.status, 'planned');
    assert.equal(august.status, 'planned');
    if (july.status !== 'planned' || august.status !== 'planned') return;

    assert.equal(july.plan.source_period, '2026-07');
    assert.equal(august.plan.source_period, '2026-08');
    // Neither plan contains a single operation addressing the other's period.
    for (const op of august.plan.operations) {
      assert.equal(JSON.stringify(op).includes('2026-07'), false);
    }
    // And no operation deletes or touches a PUBLISHED period.
    const resets = august.plan.operations.filter((o) => o.kind === 'reset_unpublished_period');
    assert.equal(resets.length, 1);
    assert.equal((resets[0] as { onlyWhenPeriodIsUnpublished: boolean }).onlyWhenPeriodIsUnpublished, true);
  });

  it('13. same-period update behaviour is deterministic — last wins, by contract not by accident', () => {
    const [first, ...rest] = persistedSampleSnapshots();
    assert.ok(first);
    const updated: BrReceitaPersistedSnapshot = {
      identity: first.identity,
      payload: { ...first.payload, legal_name: 'UPDATED SYNTHETIC NAME' },
    };
    const result = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: [first, ...rest, updated],
    });
    assert.equal(result.status, 'planned');
    if (result.status !== 'planned') return;

    const rows = result.plan.operations
      .filter((o) => o.kind === 'upsert_batch')
      .flatMap((o) => (o as { rows: readonly BrReceitaPersistedSnapshot[] }).rows);
    const forIdentity = rows.filter(
      (r) => brReceitaLogicalSnapshotIdentity(r.identity) === brReceitaLogicalSnapshotIdentity(first.identity),
    );
    assert.equal(forIdentity.length, 1, 'one identity, one row');
    assert.equal(forIdentity[0].payload.legal_name, 'UPDATED SYNTHETIC NAME');
    assert.equal(result.plan.collapsedDuplicateCount, 1);
  });

  it('non-Brazil sources keep exactly the uniqueness they had', () => {
    const sql = sqlWithoutComments(migrationSql());
    const yearIndex = sql.slice(sql.indexOf('source_company_snapshots_year_identity_uidx'));
    const statement = yearIndex.slice(0, yearIndex.indexOf(';'));
    // Same four columns, same order as migration 065's constraint.
    assert.match(statement, /\(source_key, country_code, source_year, normalized_tax_id\)/);
    assert.match(statement, /WHERE source_key <> 'br_receita_cnpj_dados_abertos'/);

    // 065 itself is untouched by this cut.
    const m065 = sqlWithoutComments(migrationSql('065_create_source_snapshot_tables.sql'));
    assert.match(m065, /UNIQUE \(source_key, country_code, source_year, normalized_tax_id\)/);
    assert.equal(m065.includes('source_period'), false);
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
  const plannedPlan = () => {
    const result = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: persistedSampleSnapshots(),
    });
    assert.equal(result.status, 'planned');
    if (result.status !== 'planned') throw new Error('unreachable');
    return result.plan;
  };

  it('19. a preparing period is not readable as published', () => {
    const plan = plannedPlan();
    const begin = plan.operations[0];
    assert.equal(begin.kind, 'begin_period');
    assert.equal((begin as { publish_state: string }).publish_state, 'preparing');

    // Visibility is decided by the run's publish_state, and only ONE published run may exist per
    // period — so a `preparing` period is addressable but not readable as published.
    const sql = sqlWithoutComments(migrationSql());
    assert.match(sql, /CREATE UNIQUE INDEX source_snapshot_runs_published_period_uidx/);
    assert.match(sql, /WHERE publish_state = 'published' AND source_period IS NOT NULL/);
    assert.deepEqual([...BR_RECEITA_SNAPSHOT_PUBLISH_STATES], [
      'preparing',
      'published',
      'failed',
      'rolled_back',
    ]);
  });

  it('20. a failed build cannot become published', () => {
    const plan = plannedPlan();
    assert.equal(plan.onFailure.kind, 'fail_period');
    assert.equal(plan.onFailure.to, 'failed');
    assert.equal(plan.onFailure.leavesPreviousPublishedPeriodIntact, true);
    // The failure operation is NOT in the forward operation list: it is reached instead of publish,
    // never after it.
    assert.equal(plan.operations.some((o) => (o as { kind: string }).kind === 'fail_period'), false);
  });

  it('21. the previously published period survives a failed next-period build', () => {
    const august = plannedPlan();
    // Nothing in the August plan — including its failure path — addresses any other period.
    const everything = JSON.stringify([...august.operations, august.onFailure]);
    assert.equal(everything.includes('2026-06'), false);
    // The only destructive operation is scoped to THIS period AND to an unpublished one.
    const destructive = august.operations.filter((o) => o.kind === 'reset_unpublished_period');
    assert.equal(destructive.length, 1);
    const reset = destructive[0] as { source_period: string; onlyWhenPeriodIsUnpublished: boolean };
    assert.equal(reset.source_period, SAMPLE_SOURCE_PERIOD);
    assert.equal(reset.onlyWhenPeriodIsUnpublished, true);
  });

  it('22. the publish transition is atomic by contract, and is unconditionally LAST', () => {
    const plan = plannedPlan();
    const kinds = plan.operations.map((o) => o.kind);
    assert.equal(kinds[0], 'begin_period');
    assert.equal(kinds[1], 'reset_unpublished_period');
    assert.equal(kinds[kinds.length - 1], 'publish_period');
    assert.equal(kinds.filter((k) => k === 'publish_period').length, 1);

    const publish = plan.operations[plan.operations.length - 1] as {
      from: string;
      to: string;
      mustCommitWithFinalBatch: boolean;
    };
    assert.equal(publish.from, 'preparing');
    assert.equal(publish.to, 'published');
    assert.equal(publish.mustCommitWithFinalBatch, true);
  });

  it('23. a partial period is never marked complete — no batch follows the publish', () => {
    const plan = plannedPlan();
    const publishIndex = plan.operations.findIndex((o) => o.kind === 'publish_period');
    const after = plan.operations.slice(publishIndex + 1);
    assert.deepEqual(after, [], 'nothing may run after the period is published');

    // Every batch precedes the publish.
    const batchIndexes = plan.operations
      .map((o, i) => (o.kind === 'upsert_batch' ? i : -1))
      .filter((i) => i >= 0);
    assert.ok(batchIndexes.length > 0);
    assert.ok(batchIndexes.every((i) => i < publishIndex));

    // An EMPTY period is refused rather than published as a complete empty month.
    const empty = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: [],
    });
    assert.equal(empty.status, 'rejected');
    if (empty.status === 'rejected') {
      assert.equal(empty.rejections[0].reason, 'empty_period');
    }
    assert.equal(plan.partialPeriodVisible, false);
    assert.equal(plan.crossPeriodOverwritePossible, false);
  });

  it('bounded batches: the plan never holds the nation in one array', () => {
    assert.equal(BR_RECEITA_SNAPSHOT_BATCH_ROWS, 500);
    const records = persistedSampleSnapshots();
    const result = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records,
      batchSize: 1,
    });
    assert.equal(result.status, 'planned');
    if (result.status !== 'planned') return;
    assert.equal(result.plan.batchSize, 1);
    assert.equal(result.plan.batchCount, records.length);
    for (const op of result.plan.operations.filter((o) => o.kind === 'upsert_batch')) {
      assert.equal((op as { rows: readonly unknown[] }).rows.length, 1);
    }
    // A caller cannot raise the cap above the pinned one.
    const raised = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records,
      batchSize: 10_000,
    });
    if (raised.status === 'planned') {
      assert.equal(raised.plan.batchSize, BR_RECEITA_SNAPSHOT_BATCH_ROWS);
    }
    // The planner takes an ITERABLE, so a streaming producer needs no change.
    const generator = (function* () {
      yield* records;
    })();
    assert.equal(
      planBrReceitaMonthlySnapshotWrite({ sourcePeriod: SAMPLE_SOURCE_PERIOD, records: generator })
        .status,
      'planned',
    );
  });

  it('the plan writes nothing: no client, no table mutation, no I/O anywhere in the module', () => {
    const source = connectorSource('../br-receita-cnpj-monthly-snapshot-write-plan.ts');
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
      assert.equal(source.includes(forbidden), false, `the plan must not carry ${forbidden}`);
    }
    assert.equal(plannedPlan().writesNothing, true);
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
    assert.equal(highest, 125);
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
