/**
 * BR Receita CNPJ — `br-source:receita-real-benchmark`: the PURE-MEASUREMENT OPERATOR ALIAS.
 *
 * The operator asked for a "new CLI" for a real benchmark that measures and writes nothing. The audit
 * that preceded this suite found that CLI already built — `run-br-receita-cnpj-real-full-scan-resource-
 * benchmark.ts`, which already runs the same manifest, the same filesystem, the same inventory
 * fingerprint and the same full-join engine into a NULL sink. What was missing was only a name: it had
 * no entry in `package.json`, so the only `npm run` an operator could find whose mode is called
 * `benchmark` was `br-source:operator-chunk`, and THAT one commits rows.
 *
 * So this milestone adds an ALIAS, not an engine. That distinction is the whole point of this suite,
 * because the alternative — a second CLI over the same engine — would have been a route to real
 * attempt #3, which the attempt ledger refuses unconditionally. A new entry point that did not consult
 * the ledger would not be a new benchmark; it would be the old one with its budget control removed.
 *
 * ── What this suite pins ────────────────────────────────────────────────────────
 *   · the alias EXISTS and resolves to the pre-existing operator script, not to a new one.
 *   · the alias hard-codes NO approval flag and NO attempt number, so naming it cannot pre-authorize.
 *   · the operator it names still measures into a null sink: `maxOutputRows: 0`,
 *     `sinkMaterializesRows: false`, and a tally whose `rowsEmitted` is a `0` literal.
 *   · the operator reaches no writer, no snapshot gateway method, no chunk loader and no Agent 1.
 *   · the attempt ledger is UNTOUCHED by this milestone: 2 consumed, 2 supported, attempt 3 forbidden,
 *     budget exhausted — and a request for #3 is still refused by code, not by comment.
 *
 * Pure: no network, no Supabase, no provider, no real Receita data, no benchmark execution, no
 * filesystem write. The only I/O is reading this repository's own sources for the static guards.
 * 0 credits, 0 writes, 0 migrations, 0 flags, 0 rows.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createBrazilReceitaFullJoinNullBenchmarkSink } from '../br-receita-cnpj-full-join-engine-contract';
import {
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_BUDGET_EXHAUSTED,
  BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
  evaluateBrazilReceitaRealBenchmarkAttemptRequest,
} from '../br-receita-cnpj-real-benchmark-attempt-ledger';

// ─── Static-guard plumbing ────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '../../../../../..');

/** The alias the operator asked for. */
const ALIAS = 'br-source:receita-real-benchmark';

/** The suite script that must be a required CI step. */
const TEST_SCRIPT = 'test:br-source:receita-real-benchmark-alias';

/** The pre-existing operator the alias must resolve to. Relative, so the assertion names one file. */
const OPERATOR_SCRIPT =
  'scripts/source-catalog/run-br-receita-cnpj-real-full-scan-resource-benchmark.ts';

const BENCHMARK_MODULE =
  'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-real-full-scan-benchmark.ts';

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Comments are removed before every absence assertion.
 *
 * A raw grep cannot tell NAMING a forbidden call from CALLING it, and both of these files describe at
 * length what they refuse to do — so a raw search for `commitFinalBatchAndPublish` would fail on the
 * header that promises never to reach it.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

function scripts(): Record<string, string> {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  return pkg.scripts;
}

// ─── The alias ────────────────────────────────────────────────────────────────

describe('br-source:receita-real-benchmark — the alias', () => {
  it('exists and resolves to the PRE-EXISTING pure-measurement operator', () => {
    const command = scripts()[ALIAS];
    assert.ok(command, `${ALIAS} must exist in package.json`);
    assert.ok(
      command.includes(OPERATOR_SCRIPT),
      `${ALIAS} must invoke ${OPERATOR_SCRIPT}, so there is exactly one measurement operator`,
    );
  });

  it('does not point at the chunk operator, whose --mode benchmark commits rows', () => {
    const command = scripts()[ALIAS]!;
    for (const forbidden of [
      'br-receita-operator-chunk',
      'br-receita-operator-chunk-runtime',
      '--mode',
    ]) {
      assert.ok(
        !command.includes(forbidden),
        `${ALIAS} must not reference ${forbidden}: that is the row-committing loader`,
      );
    }
  });

  it('hard-codes no approval flag and no attempt number, so the name cannot authorize', () => {
    const command = scripts()[ALIAS]!;
    for (const flag of [
      '--second-real-attempt-owner-authorized',
      '--temporary-storage-policy-approved',
      '--cap-input-policy-approved',
      '--real-attempt-number',
      '--real-full-scan-resource-benchmark',
    ]) {
      assert.ok(
        !command.includes(flag),
        `${ALIAS} must not bake in ${flag}: every approval stays a per-invocation operator argument`,
      );
    }
  });

  it('is wired into the required CI workflow, and re-runs the closure suites', () => {
    const workflow = read('.github/workflows/automatic-routing-tests.yml');
    assert.ok(
      workflow.includes(`run: npm run ${TEST_SCRIPT}`),
      `${TEST_SCRIPT} must be invoked by a run: line in the required workflow`,
    );
    // The alias suite alone would pass while the controls it depends on rotted, so the test script
    // re-runs the durable-closure and no-write suites that own those controls.
    const command = scripts()[TEST_SCRIPT];
    assert.ok(command, `${TEST_SCRIPT} must exist in package.json`);
    for (const suite of [
      'br-receita-cnpj-receita-real-benchmark-cli-alias.test.ts',
      'br-receita-cnpj-attempt2-durable-closure.test.ts',
      'br-receita-cnpj-real-full-scan-execution-path.test.ts',
      'br-receita-cnpj-full-join-no-write-guard.test.ts',
    ]) {
      assert.ok(command.includes(suite), `the script must re-run ${suite}`);
    }
  });

  it('carries no connection string, credential or environment file', () => {
    const command = scripts()[ALIAS]!;
    for (const forbidden of ['DATABASE_URL', '--env-file', 'SUPABASE', 'postgres://', 'TOKEN']) {
      assert.ok(!command.includes(forbidden), `${ALIAS} must not carry ${forbidden}`);
    }
  });
});

// ─── What the aliased operator still is ───────────────────────────────────────

describe('br-source:receita-real-benchmark — the operator it names measures and writes nothing', () => {
  it('declares a non-materializing sink and a zero output ceiling', () => {
    const source = stripComments(read(BENCHMARK_MODULE));
    assert.ok(source.includes('maxOutputRows: 0'), 'the benchmark must pin maxOutputRows to 0');
    assert.ok(
      source.includes('sinkMaterializesRows: false'),
      'the benchmark must declare a non-materializing sink',
    );
    assert.ok(
      source.includes('createBrazilReceitaFullJoinNullBenchmarkSink()'),
      'the benchmark must build the null sink',
    );
  });

  it('reaches no writer, no snapshot gateway method and no chunk loader', () => {
    const operator = stripComments(read(OPERATOR_SCRIPT));
    const benchmark = stripComments(read(BENCHMARK_MODULE));
    for (const forbidden of [
      'commitFinalBatchAndPublish',
      'beginPeriodRun',
      'discardRunRows',
      'upsertBatch',
      'failPeriod',
      'createBrReceitaExistingRunChunkWriter',
      'loadBrReceitaNationalChunk',
      'createBrReceitaSqlWriteGateway',
      'source_company_snapshots',
      '@supabase',
      'DATABASE_URL',
    ]) {
      assert.ok(
        !operator.includes(forbidden),
        `the operator must not reference ${forbidden}`,
      );
      assert.ok(
        !benchmark.includes(forbidden),
        `the benchmark entry point must not reference ${forbidden}`,
      );
    }
  });

  it('reaches no Agent 1, provider, HubSpot or feature flag', () => {
    const operator = stripComments(read(OPERATOR_SCRIPT));
    for (const forbidden of [
      'prospecting-toolkit',
      'prospect-batches',
      'prospect-intake',
      'hubspot',
      'apollo',
      'lusha',
      'feature-flags',
    ]) {
      assert.ok(
        !operator.toLowerCase().includes(forbidden.toLowerCase()),
        `the operator must not reference ${forbidden}`,
      );
    }
  });

  it('the null sink retains nothing and reports rowsEmitted as a literal zero', () => {
    const sink = createBrazilReceitaFullJoinNullBenchmarkSink();
    // Two matches in one partition, so the bucket count moves and the row count cannot.
    for (const partitionOrdinal of [7, 7]) {
      void sink.onMatch({ partitionOrdinal } as never);
    }
    void sink.onPartitionComplete?.({ partitionOrdinal: 7 } as never);
    void sink.finalize();

    const tally = sink.tally();
    assert.equal(tally.rowsEmitted, 0, 'a benchmark sink must emit zero rows');
    assert.equal(tally.recordsRetained, 0, 'a benchmark sink must retain zero records');
    assert.equal(tally.partitionsCompleted, 1);
    assert.equal(tally.finalized, true);
    assert.deepEqual(tally.matchBuckets, { partition_00007: 2 }, 'counts, never records');
    // The tally is the sink's whole surface: no field on it may carry a record.
    assert.deepEqual(
      Object.keys(tally).sort(),
      ['finalized', 'matchBuckets', 'partitionsCompleted', 'recordsRetained', 'rowsEmitted'],
      'the tally must expose no field that could hold a row',
    );
  });
});

// ─── The control this milestone did NOT touch ─────────────────────────────────

/**
 * These four are an INTENTIONAL TRIPWIRE on a control this milestone promised not to move, not an
 * accident of over-specification.
 *
 * Read them as: "adding a name for the measurement operator did not hand anybody a third attempt."
 * They will therefore FAIL the day the project owner legitimately authorizes attempt #3 — and that is
 * the design. Raising the budget is supposed to be a reviewed source edit with an owner decision
 * attached, so it should cost a deliberate, visible update here rather than sliding in as a side
 * effect. When that decision is really made, update these expectations IN THE SAME CHANGE as the
 * ledger, and never the other way round: a test loosened first would leave the ledger unguarded.
 */
describe('br-source:receita-real-benchmark — the attempt ledger is untouched', () => {
  it('still records two consumed attempts against a ceiling of two', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED, 2);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS, 2);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_BUDGET_EXHAUSTED, true);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
  });

  it('still refuses attempt #3 by code, so naming the alias grants no new attempt', () => {
    const third = evaluateBrazilReceitaRealBenchmarkAttemptRequest(3);
    assert.equal(third.eligible, false);
    assert.equal(third.rejectionCode, 'real_benchmark_attempt_limit_reached');
    assert.equal(third.authorized, false);
    assert.equal(third.attemptNumber, null);
  });

  it('still refuses a re-run impersonating a consumed attempt', () => {
    for (const consumed of [1, 2]) {
      const request = evaluateBrazilReceitaRealBenchmarkAttemptRequest(consumed);
      assert.equal(request.eligible, false);
      assert.equal(request.rejectionCode, 'real_attempt_number_already_consumed');
    }
  });

  it('the alias adds no reset, raise or override path to the ledger', () => {
    const ledger = stripComments(
      read(
        'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-real-benchmark-attempt-ledger.ts',
      ),
    );
    // The ledger states its own immovability, and that statement is asserted rather than assumed.
    assert.ok(
      ledger.includes('resetPathExists: false'),
      'the ledger must keep declaring that no reset path exists',
    );
    // `reset` is deliberately NOT in this list: the only occurrences are `resetPathExists: false`,
    // which is the denial of a reset path, not one. Searching for the word would fail on the denial.
    for (const forbidden of ['process.env', 'override', 'readFileSync', 'require(', 'node:fs']) {
      assert.ok(
        !ledger.includes(forbidden),
        `the ledger must expose no ${forbidden} path`,
      );
    }
    // The consumed count must stay a `const` export: a `let` would make it runtime-assignable.
    assert.ok(
      /export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED = 2 as const/.test(ledger),
      'the consumed count must remain a frozen const literal',
    );
  });
});
