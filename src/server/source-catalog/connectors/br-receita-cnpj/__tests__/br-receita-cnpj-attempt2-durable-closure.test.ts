/**
 * BR Receita CNPJ — ATTEMPT #2 DURABLE CLOSURE — tests (BR-SOURCE-ATTEMPT2-CLOSURE § 6).
 *
 * Attempt #2 ran on 2026-08-12, crossed the real-data boundary, and aborted on `maxExternalMemoryBytes`
 * 9,737 ms in. Under § 11 of 14B.0J that spent the attempt. The run could report that — `commitCrossing()`
 * is in-process, and `resultingAttemptsConsumed()` computed the `2` the CLI printed — but nothing in a
 * running process can edit a source constant, so the DURABLE count stayed at `1` until the closure PR.
 *
 * That gap is what this file guards. While the count read `1`,
 * `evaluateBrazilReceitaRealBenchmarkAttemptRequest(2)` returned `eligible: true`: the code would have
 * admitted a second execution of attempt #2, and the only thing in the way was the operator declining to
 * pass the flags again. These tests assert the wall now exists in code:
 *
 *   - the durable count is 2, and attempt #1's frozen record is untouched;
 *   - attempt #2 cannot be requested again, under any flag combination;
 *   - attempt #3 is refused, and no route to it was added anywhere;
 *   - a fresh PROCESS sees the same exhausted budget — the point of a reviewed constant;
 *   - no reset path exists anywhere in the connector;
 *   - the reports an operator actually reads stopped claiming an available attempt.
 *
 * ── Nothing here reads real data, and that is structural ────────────────────────
 * Every module under test is pure. The one test that spawns a process spawns it to import the ledger and
 * print three numbers; it passes no manifest, no dataset root and no grant, and the ledger has no `node:fs`
 * import through which it could read anything even if it wanted to.
 *
 * No real manifest, no dataset, no benchmark, no Supabase, no runtime, no Agent 1, no Agent 2A, no
 * provider, no network, no repository write.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_NATIONAL_RESOLUTION_EXHAUSTED_NEXT_ACTION,
  BRAZIL_RECEITA_NATIONAL_RESOLUTION_NEXT_ACTIONS,
  brazilReceitaNationalResolutionNextAction,
  type BrazilReceitaNationalInventoryResolution,
} from '../br-receita-cnpj-14b0k-national-inventory-resolution';
import {
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_BUDGET_EXHAUSTED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_REJECTION_CODES,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
  brazilReceitaNextRealAttemptIsStructurallySupported,
  brazilReceitaNextRealAttemptNumber,
  brazilReceitaRealBenchmarkAttemptBudgetExhausted,
  brazilReceitaRealBenchmarkAttemptsConsumed,
  brazilReceitaRealBenchmarkExecuted,
  evaluateBrazilReceitaRealBenchmarkAttemptRequest,
  summarizeBrazilReceitaRealBenchmarkAttemptModel,
} from '../br-receita-cnpj-real-benchmark-attempt-ledger';
import { BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED } from '../br-receita-cnpj-full-join-resource-benchmark';
import { summarizeBrazilReceitaRealFullScanReadiness } from '../br-receita-cnpj-real-full-scan-benchmark';

const CONNECTOR_DIR = path.resolve(import.meta.dirname, '..');
const REPO_ROOT = path.resolve(CONNECTOR_DIR, '../../../../..');

/** A connector module's source, comments stripped, so a scan reads CODE and not prose about code. */
function codeOf(moduleBasename: string): string {
  return fs
    .readFileSync(path.join(CONNECTOR_DIR, `${moduleBasename}.ts`), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// ─── § 2 — the durable ledger ─────────────────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-CLOSURE § 2 — the durable ledger records two consumed attempts', () => {
  it('1 — reports attemptsConsumed = 2, from one source, derived everywhere else', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED, 2);
    assert.equal(brazilReceitaRealBenchmarkAttemptsConsumed(), 2);
    // § 4 of 14B.0J: `executed` is the count being positive, not an independent boolean that can drift.
    assert.equal(brazilReceitaRealBenchmarkExecuted(), true);
    assert.equal(
      brazilReceitaRealBenchmarkExecuted(),
      BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED > 0,
    );
    const summary = summarizeBrazilReceitaRealBenchmarkAttemptModel();
    assert.equal(summary.attemptsConsumed, 2);
    assert.equal(summary.attemptHistory.length, 2);
    assert.equal(summary.realBenchmarkExecuted, true);
    assert.equal(summary.automaticRetryCount, 0);
  });

  it('2 — derives the exhausted budget rather than asserting it twice', () => {
    // NEXT_REAL_ATTEMPT_NUMBER is expressed through the contract that already existed: the number a next
    // run would claim (3), paired with the predicate that says it may not (false). § 2 asked for
    // "none / exhausted según contrato existente", and this is that contract — no new sentinel, so no
    // caller doing arithmetic on `nextAttemptNumber` has to learn a second encoding.
    assert.equal(brazilReceitaNextRealAttemptNumber(), 3);
    assert.equal(brazilReceitaNextRealAttemptIsStructurallySupported(), false);
    assert.equal(brazilReceitaRealBenchmarkAttemptBudgetExhausted(), true);
    // The two predicates are the same fact, named oppositely on purpose. They must never disagree.
    assert.equal(
      brazilReceitaRealBenchmarkAttemptBudgetExhausted(),
      !brazilReceitaNextRealAttemptIsStructurallySupported(),
    );
    // And the documented constant tracks the derivation instead of standing beside it.
    assert.equal(
      BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_BUDGET_EXHAUSTED,
      brazilReceitaRealBenchmarkAttemptBudgetExhausted(),
    );
    // The ceiling did NOT move to make room. Raising it is what "adding a route to attempt #3" would be.
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS, 2);
    assert.equal(
      BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
      BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
    );
    assert.equal(summarizeBrazilReceitaRealBenchmarkAttemptModel().attemptBudgetExhausted, true);
  });
});

// ─── § 3 — attempt #1 preserved ───────────────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-CLOSURE § 3 — attempt #1 survives the closure untouched', () => {
  it('3 — keeps attempt #1 first, frozen, and carrying exactly its original fields', () => {
    const [attempt1, attempt2] = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY;
    // Appended, not prepended and not rewritten: the reader of a history expects chronology.
    assert.equal(attempt1.attemptNumber, 1);
    assert.equal(attempt2.attemptNumber, 2);
    assert.equal(attempt1.milestone, 'BR-SOURCE-14B.0G');
    assert.equal(attempt1.terminalStatus, 'resource_cap_breached');
    assert.equal(attempt1.crossedRealDataBoundary, true);
    assert.equal(attempt1.inputScope, 'staged_subset');
    assert.equal(attempt1.rowsEmitted, 0);
    assert.equal(
      attempt1.evidenceDocument,
      'br-receita-cnpj-14b0g-real-full-scan-benchmark-evidence',
    );
    // The closure's three new fields are OPTIONAL so that attempt #1's record stays exactly what 14B.0J
    // froze. Reconstructing them for attempt #1 out of the 14B.0G document would be rebuilding an attempt
    // record from a second source — the failure mode the ledger was built to prevent.
    assert.equal(attempt1.abortStage, undefined);
    assert.equal(attempt1.failureClassification, undefined);
    assert.equal(attempt1.resourceObservation, undefined);
    assert.equal(Object.isFrozen(attempt1), true);
    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- probing immutability on purpose
      (attempt1 as any).inputScope = 'full_national';
    });
  });

  it('4 — distinguishes the two attempts by scope and by cause, not just by number', () => {
    const [attempt1, attempt2] = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY;
    // Both breached a cap. That is the ONLY thing they have in common, and reading the shared terminal
    // code as a shared diagnosis is the § 5 misreading.
    assert.equal(attempt1.terminalStatus, attempt2.terminalStatus);
    assert.notEqual(attempt1.inputScope, attempt2.inputScope);
    assert.equal(attempt1.inputScope, 'staged_subset');
    assert.equal(attempt2.inputScope, 'full_national');
    assert.notEqual(attempt1.milestone, attempt2.milestone);
    assert.notEqual(attempt1.evidenceDocument, attempt2.evidenceDocument);
    // Neither spent the attempt on output: both emitted zero rows.
    assert.equal(attempt1.rowsEmitted, 0);
    assert.equal(attempt2.rowsEmitted, 0);
  });
});

// ─── § 5 — classification ─────────────────────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-CLOSURE § 5 — the failure is an envelope breach, not a throughput verdict', () => {
  it('5 — refuses to record a national throughput failure, and proves why from the numbers', () => {
    const attempt2 = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY[1];
    assert.equal(attempt2.failureClassification, 'resource_envelope_external_memory');
    assert.ok(
      !BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.some(
        (entry) => entry.failureClassification === 'national_throughput_failure',
      ),
    );
    const observation = attempt2.resourceObservation;
    assert.ok(observation);
    // The runtime budget was 21,600,000 ms. The run used 9,737 — 0.05 %. Whatever attempt #2 measured, it
    // was not the six-hour feasibility question, and it did not reach the join.
    assert.ok(observation.durationMs < 10_000);
    assert.equal(attempt2.abortStage, 'empresas_reference_pass');
    // 205,520,896 bytes of a 22,254,270,713-byte national volume is under one per cent.
    assert.ok(observation.bytesRead / 22_254_270_713 < 0.01);
    assert.equal(observation.throughputEvidenceProduced, false);
    // The breach itself is narrow — 616,895 bytes over a 67,108,864-byte cap — which is what makes this a
    // dimensioning question rather than an architectural one.
    assert.equal(observation.breachedCapKey, 'maxExternalMemoryBytes');
    assert.ok(observation.breachedCapOverage < observation.breachedCapLimitValue / 50);
  });

  it('6 — records the structural driver: partition handles sat exactly on their cap', () => {
    const observation = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY[1].resourceObservation;
    assert.ok(observation);
    // 32 handles held open against a 32 handle ceiling, with 1,024 partitions created. The external
    // memory the breach measured is dominated by those buffers, which is why no amount of runtime would
    // have changed the outcome — and why this is evidence about caps, not about the dataset.
    assert.equal(observation.partitionHandlesPeak, 32);
    assert.equal(observation.partitionsCreated, 1_024);
    assert.ok(observation.filesOpenedPeakConcurrent >= observation.partitionHandlesPeak);
    // Storage and output were never the constraint: temp storage peaked at ~1 % of its cap, output at zero.
    assert.ok(observation.temporaryStoragePeakBytes < 4_294_967_296 / 50);
    assert.equal(observation.materializedOutputRows, 0);
    // Hygiene, as the run reported it.
    assert.equal(observation.sanitizerPassed, true);
    assert.equal(observation.cleanupPassed, true);
  });
});

// ─── § 6 — no third attempt, and no second run of the second ──────────────────

describe('BR-SOURCE-ATTEMPT2-CLOSURE § 6 — the attempt budget cannot be resurrected', () => {
  it('7 — refuses attempt #2 as already consumed, which is the gap this milestone closed', () => {
    const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(2);
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.rejectionCode, 'real_attempt_number_already_consumed');
    assert.equal(eligibility.attemptNumber, null);
    assert.equal(eligibility.attemptsConsumed, 2);
    assert.equal(eligibility.nextAttemptNumber, 3);
    // Eligibility never says yes to permission, whatever it says about the number.
    assert.equal(eligibility.authorized, false);
  });

  it('8 — refuses attempt #3 and everything above it, with the limit code', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
    for (const requested of [3, 4, 5, 99, 1_000_000]) {
      const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested);
      assert.equal(eligibility.eligible, false);
      assert.equal(eligibility.rejectionCode, 'real_benchmark_attempt_limit_reached');
    }
    // And no NUMBER at all is eligible now — the refusal is total, not a gap in a range.
    for (const requested of [-1, 0, 1, 1.5, 2, 3, Number.NaN, '2', null, undefined, true, {}]) {
      assert.equal(evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested).eligible, false);
    }
  });

  it('9 — leaves the rejection vocabulary unchanged: no softer code was introduced', () => {
    // A closure that needed a new "budget exhausted, ask nicely" code would be a closure with a door in it.
    assert.deepEqual([...BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_REJECTION_CODES], [
      'real_attempt_number_invalid',
      'real_attempt_number_already_consumed',
      'real_attempt_number_not_next',
      'real_benchmark_attempt_limit_reached',
    ]);
  });

  it('10 — keeps the tracked authorization false, and reachable by nothing', () => {
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
    // The attempt model deliberately has no `authorized` field to be misread as one.
    assert.ok(!Object.keys(summarizeBrazilReceitaRealBenchmarkAttemptModel()).includes('authorized'));
    // No module in the closure's blast radius flips an authorization or reads the environment for one.
    for (const moduleName of [
      'br-receita-cnpj-real-benchmark-attempt-ledger',
      'br-receita-cnpj-real-full-scan-benchmark',
      'br-receita-cnpj-14b0k-national-inventory-resolution',
      'br-receita-cnpj-full-join-resource-benchmark',
    ]) {
      const code = codeOf(moduleName);
      assert.ok(!code.includes('AUTHORIZED = true'), `${moduleName} must not authorize anything`);
      assert.ok(!code.includes('process.env'), `${moduleName} must not read the environment`);
    }
  });

  it('11 — exposes no reset path, on the ledger or anywhere it is consumed', () => {
    assert.equal(summarizeBrazilReceitaRealBenchmarkAttemptModel().resetPathExists, false);
    // Writer-shaped tokens only. A looser pattern would trip on legitimate local reads, which is how a
    // guard like this gets weakened instead of fixed.
    const forbidden = [
      'reset(',
      'setAttempts',
      'clearAttempts',
      'rollbackAttempt',
      'decrementAttempt',
      'ATTEMPTS_CONSUMED = 0',
      'ATTEMPTS_CONSUMED = 1',
      'ATTEMPTS_CONSUMED -',
      'consumed--',
      'consumed -=',
    ];
    for (const moduleName of [
      'br-receita-cnpj-real-benchmark-attempt-ledger',
      'br-receita-cnpj-real-full-scan-benchmark',
      'br-receita-cnpj-14b0k-national-inventory-resolution',
    ]) {
      const code = codeOf(moduleName);
      for (const token of forbidden) {
        assert.ok(!code.includes(token), `${moduleName} must not contain "${token}"`);
      }
    }
    // The ledger's own history is frozen at both levels: the array and every record in it.
    assert.equal(Object.isFrozen(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY), true);
    for (const entry of BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY) {
      assert.equal(Object.isFrozen(entry), true);
    }
  });

  it('12 — shows a FRESH PROCESS the same exhausted budget', () => {
    // The reason the record is a reviewed source constant rather than a file or a row: a counter the run
    // can write is a counter the run can reset, and an in-process closure dies with the process. This test
    // is the claim's only honest form — spawn a new interpreter, import the ledger, read it back.
    const probe = [
      "import { brazilReceitaRealBenchmarkAttemptsConsumed, brazilReceitaNextRealAttemptNumber,",
      "  brazilReceitaRealBenchmarkAttemptBudgetExhausted, evaluateBrazilReceitaRealBenchmarkAttemptRequest }",
      `  from ${JSON.stringify(path.join(CONNECTOR_DIR, 'br-receita-cnpj-real-benchmark-attempt-ledger.ts'))};`,
      'process.stdout.write(JSON.stringify({',
      '  consumed: brazilReceitaRealBenchmarkAttemptsConsumed(),',
      '  next: brazilReceitaNextRealAttemptNumber(),',
      '  exhausted: brazilReceitaRealBenchmarkAttemptBudgetExhausted(),',
      '  two: evaluateBrazilReceitaRealBenchmarkAttemptRequest(2).rejectionCode,',
      '  three: evaluateBrazilReceitaRealBenchmarkAttemptRequest(3).rejectionCode,',
      '}));',
    ].join('\n');

    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', probe],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    assert.deepEqual(JSON.parse(stdout), {
      consumed: 2,
      next: 3,
      exhausted: true,
      two: 'real_attempt_number_already_consumed',
      three: 'real_benchmark_attempt_limit_reached',
    });
  });
});

// ─── § 2, § 5 — the reports an operator actually reads ────────────────────────

describe('BR-SOURCE-ATTEMPT2-CLOSURE — no report offers an attempt that no longer exists', () => {
  it('13 — stops advertising an obtainable authorization in --readiness', () => {
    const readiness = summarizeBrazilReceitaRealFullScanReadiness();
    // Was a hardcoded `true`. With the budget spent there is nothing to be ready FOR, and leaving it
    // `true` would have `--readiness` inviting an authorization the attempt wall refuses two stages into
    // preflight — the closest thing to a route to attempt #3 that file could offer.
    assert.equal(readiness.realFullScanBenchmarkReadyForOwnerAuthorization, false);
    // The controls really are finished, and that is a different claim which stays true.
    assert.equal(readiness.secondRealBenchmarkControlReady, true);
    assert.equal(readiness.realFullScanBenchmarkAuthorized, false);
    assert.equal(readiness.secondRealBenchmarkAuthorized, false);
    assert.equal(readiness.realFullScanBenchmarkExecuted, true);
    assert.equal(readiness.attemptModel.attemptBudgetExhausted, true);
    // GATE-2 stays unapproved. Attempt #2 produced no throughput evidence to approve.
    assert.equal(readiness.gate2ReadyForOwnerReview, false);
  });

  it('14 — routes a complete national input to the resource closure, never to a third attempt', () => {
    // The 14B.0K next-action table used to send a `complete` verdict to "OWNER AUTHORIZATION — SECOND REAL
    // FULL-NATIONAL BENCHMARK". That destination has been reached and spent; continuing to print it would
    // be routing the owner at an attempt that cannot exist.
    const resolution = {
      nationalInputCompleteness: 'complete',
      attemptBudgetExhausted: true,
    } as unknown as BrazilReceitaNationalInventoryResolution;
    assert.equal(
      brazilReceitaNationalResolutionNextAction(resolution),
      BRAZIL_RECEITA_NATIONAL_RESOLUTION_EXHAUSTED_NEXT_ACTION,
    );
    assert.equal(
      BRAZIL_RECEITA_NATIONAL_RESOLUTION_EXHAUSTED_NEXT_ACTION,
      'OWNER REVIEW — EXTERNAL MEMORY RESOURCE CLOSURE',
    );
    // It is a REVIEW, not an authorization request, and it names no attempt number.
    assert.ok(BRAZIL_RECEITA_NATIONAL_RESOLUTION_EXHAUSTED_NEXT_ACTION.startsWith('OWNER REVIEW'));
    assert.ok(!/attempt|THIRD|BENCHMARK/i.test(BRAZIL_RECEITA_NATIONAL_RESOLUTION_EXHAUSTED_NEXT_ACTION));

    // The other two verdicts are untouched: an incomplete or unresolvable inventory is still an inventory
    // problem, whatever the attempt budget says.
    for (const verdict of ['incomplete', 'indeterminate'] as const) {
      const other = {
        nationalInputCompleteness: verdict,
        attemptBudgetExhausted: true,
      } as unknown as BrazilReceitaNationalInventoryResolution;
      assert.equal(
        brazilReceitaNationalResolutionNextAction(other),
        BRAZIL_RECEITA_NATIONAL_RESOLUTION_NEXT_ACTIONS[verdict],
      );
    }
    // And the original table is intact — the exhausted route is an addition, not an overwrite, so the
    // history of what a complete verdict used to mean is still readable.
    assert.equal(
      BRAZIL_RECEITA_NATIONAL_RESOLUTION_NEXT_ACTIONS.complete,
      'OWNER AUTHORIZATION — SECOND REAL FULL-NATIONAL BENCHMARK',
    );
  });
});
