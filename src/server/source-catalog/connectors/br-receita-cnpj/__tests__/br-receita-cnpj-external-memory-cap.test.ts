/**
 * BR Receita CNPJ FULL JOIN — EXTERNAL-MEMORY CAP, END TO END (BR-SOURCE external-memory closure).
 *
 * The companion to `br-receita-cnpj-external-memory-envelope.test.ts`. That file pins the fix at the
 * level the bug lived at (allocation COUNT, exactly and machine-independently); this one asserts the
 * consequence the owner actually cares about — a representative run of the REAL pipeline finishes
 * inside `maxExternalMemoryBytes`, the one cap that ended attempt #2.
 *
 * ── Why this spawns a child process ─────────────────────────────────────────────
 * The engine's resource enforcer samples PROCESS memory, so it cannot tell the engine's bytes from
 * its host's. Running the pipeline INSIDE `node --test` was measured breaching
 * `maxHeapUsedBytes` (134,217,728) at `before_first_access` with `bytesRead: 0` and no checkpoints
 * evaluated — the test runner's own heap, attributed to an engine that had not yet read a byte.
 * A separate test FILE is not enough either, because the runner's baseline is the problem rather
 * than any sibling test. So the measurement runs where the measurement is meaningful: a clean
 * process, driving the repository's OWN shipped local-performance runner, with this test asserting
 * over what that runner reports.
 *
 * 100 % synthetic and offline: the spawned runner generates its own synthetic fixture and touches no
 * real Receita file, no manifest, no dataset root, no Supabase, no provider and no network. It
 * executes no real benchmark, authorizes none, and spends no attempt — assertions below hold it to
 * exactly that.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS } from '../br-receita-cnpj-real-full-scan-benchmark';

/**
 * The cap attempt #2 breached. A LITERAL, not the imported constant: § 2 of the closure brief
 * forbids raising `maxExternalMemoryBytes`, and a test that followed the constant could not tell
 * that it had moved. The last assertion below ties the two together, so they cannot drift apart
 * silently either.
 */
const EXTERNAL_MEMORY_CAP_BYTES = 64 * 1024 * 1024;

/**
 * The regression tripwire, deliberately far below the official cap.
 *
 * Chosen from measurement, not roundness: over this exact fixture the pre-fix engine measured
 * 42.3–50.7 MiB across repeated runs and the fixed engine 28.6–29.8 MiB. A guard here fails on
 * EVERY observed pre-fix run while leaving the fixed engine ~10 MiB of headroom, so what it detects
 * is the regression rather than the machine it happens to be running on.
 */
const EXTERNAL_MEMORY_REGRESSION_GUARD_BYTES = 40 * 1024 * 1024;

/** Big enough that the pre-fix engine's per-chunk garbage was clearly visible over it. */
const MATCHED_COMPANIES = 480_000;

const RUNNER = path.join(
  process.cwd(),
  'scripts',
  'source-catalog',
  'br-receita-cnpj-14b0i-local-performance.ts',
);

interface RunnerOutput {
  readonly stdout: string;
  readonly peakExternalMemoryBytes: number;
  readonly abortCode: string;
  readonly exitStatus: string;
}

function runInCleanProcess(): RunnerOutput {
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--import',
      'tsx',
      RUNNER,
      '--runs',
      '1',
      '--matched-companies',
      String(MATCHED_COMPANIES),
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
  );

  assert.equal(result.error, undefined, `the runner must start: ${String(result.error)}`);
  assert.equal(result.status, 0, `the runner must exit cleanly:\n${result.stderr}`);
  const stdout = result.stdout;

  const peak = /peakExternalMemoryBytes:\s*(\d+)/.exec(stdout);
  assert.notEqual(peak, null, `the runner must report a peak:\n${stdout}`);
  const status = /exitStatus:\s*(\S+)/.exec(stdout);
  const abort = /abortCode:\s*(\S+)/.exec(stdout);

  return {
    stdout,
    peakExternalMemoryBytes: Number(peak?.[1]),
    exitStatus: status?.[1] ?? 'unknown',
    abortCode: abort?.[1] ?? 'unknown',
  };
}

describe('BR-SOURCE external-memory — the representative scenario stays inside the cap', () => {
  it('completes under the cap that ended attempt #2, with a margin', () => {
    const run = runInCleanProcess();

    assert.equal(run.exitStatus, 'completed', `the run must not abort:\n${run.stdout}`);
    assert.equal(run.abortCode, 'none', `the run must not abort:\n${run.stdout}`);
    // The run must be CORRECT as well as small: a join that lost rows would also use less memory.
    assert.match(run.stdout, /matchCountMatchesOracle:\s*true/, 'the join must still match the oracle');
    assert.match(run.stdout, /sanitizerPassed:\s*true/, 'the report must still pass the sanitizer');

    const observed = run.peakExternalMemoryBytes;
    assert.ok(
      Number.isFinite(observed) && observed > 0,
      `the run must report a measured external-memory peak, saw ${observed}`,
    );
    assert.ok(
      observed <= EXTERNAL_MEMORY_CAP_BYTES,
      `peak external ${observed} must stay inside the ${EXTERNAL_MEMORY_CAP_BYTES}-byte cap`,
    );
    assert.ok(
      observed <= EXTERNAL_MEMORY_REGRESSION_GUARD_BYTES,
      `peak external ${observed} must stay inside the ${EXTERNAL_MEMORY_REGRESSION_GUARD_BYTES}-byte regression guard`,
    );

    // The same run must also prove it never went near real data or a real attempt.
    assert.match(run.stdout, /REAL_DATA_ACCESSED:\s*false/);
    assert.match(run.stdout, /SECOND_REAL_BENCHMARK_EXECUTED:\s*false/);
    assert.match(run.stdout, /REAL_BENCHMARK_AUTHORIZED:\s*false/);
    assert.match(run.stdout, /GATE2_APPROVED:\s*false/);
    assert.match(run.stdout, /GATE7_APPROVED:\s*false/);
  });

  it('gets there without widening a single cap', () => {
    // The whole point of the closure: the envelope is untouched and the fix lives in the engine.
    const caps = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
    assert.equal(caps.maxExternalMemoryBytes, 67_108_864);
    assert.equal(caps.maxHeapUsedBytes, 134_217_728);
    assert.equal(caps.maxRssBytes, 536_870_912);
    assert.equal(caps.maxChunkBytes, 4_194_304);
    assert.equal(caps.maxCarryBytes, 65_536);
    assert.equal(caps.maxRowBytes, 65_536);
    assert.equal(caps.partitionCount, 1_024);
    assert.equal(caps.maxPartitionCount, 2_048);
    assert.equal(caps.maxPartitionDepth, 1);
    assert.equal(caps.maxFilesOpened, 64);
    assert.equal(caps.maxOutputRows, 0);
    // Ties the literal above to the profile, so neither can move without this failing.
    assert.equal(EXTERNAL_MEMORY_CAP_BYTES, caps.maxExternalMemoryBytes);
  });
});
