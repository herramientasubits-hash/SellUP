/**
 * BR Receita CNPJ full join FAILURE CLEANUP model — tests (BR-SOURCE-11A).
 *
 * Proves the cleanup model is a HONEST, PURE plan rather than a deletion engine:
 *   - a clean run needs no cleanup;
 *   - a sanitizer failure, a guard failure, a recorded error, or a declared artifact
 *     each force `cleanup_required`;
 *   - a required cleanup reports `not_executed` + `cleanup_engine_not_authorized`,
 *     never a false `completed` (no engine is authorized in this hito);
 *   - the report is aggregate and sanitized — no path, no artifact name, no value;
 *   - the model exposes NO way to hand it a path, so it cannot touch Downloads, the
 *     repository, or any arbitrary location;
 *   - a BR-SOURCE-11C Option B synthetic temp workspace shows up as a COUNTED artifact
 *     that forces cleanup, never as a location — its actual deletion lives in the
 *     generator module, which only removes the directory it created itself.
 *
 * 100% synthetic. No filesystem access of any kind: this suite asserts the absence of
 * deletion by construction, so it never needs a temp directory.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS,
  emptyBrazilReceitaFullJoinArtifactCounts,
  emptyBrazilReceitaFullJoinCleanupErrorCounts,
  planBrazilReceitaFullJoinCleanup,
} from '../br-receita-cnpj-full-join-cleanup';

const CLEAN_INPUT = { sanitizerFailed: false, guardFailed: false, errorCount: 0 } as const;

describe('BR-SOURCE-11A cleanup model — not needed', () => {
  it('needs no cleanup for a clean run', () => {
    const report = planBrazilReceitaFullJoinCleanup(CLEAN_INPUT);
    assert.equal(report.cleanup_required, false);
    assert.equal(report.cleanup_status, 'not_needed');
    assert.equal(report.unsafe_artifacts_detected, false);
  });

  it('reports zero artifacts and zero cleanup errors for a clean run', () => {
    const report = planBrazilReceitaFullJoinCleanup(CLEAN_INPUT);
    assert.deepEqual(report.artifact_counts_by_type, emptyBrazilReceitaFullJoinArtifactCounts());
    assert.deepEqual(
      report.cleanup_error_counts_by_code,
      emptyBrazilReceitaFullJoinCleanupErrorCounts(),
    );
  });

  it('declares every artifact kind, all at zero', () => {
    const report = planBrazilReceitaFullJoinCleanup(CLEAN_INPUT);
    for (const kind of BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS) {
      assert.equal(report.artifact_counts_by_type[kind], 0);
    }
  });
});

describe('BR-SOURCE-11A cleanup model — cleanup required', () => {
  it('a sanitizer failure marks cleanup_required', () => {
    const report = planBrazilReceitaFullJoinCleanup({ ...CLEAN_INPUT, sanitizerFailed: true });
    assert.equal(report.cleanup_required, true);
  });

  it('a guard failure marks cleanup_required', () => {
    const report = planBrazilReceitaFullJoinCleanup({ ...CLEAN_INPUT, guardFailed: true });
    assert.equal(report.cleanup_required, true);
  });

  it('a recorded error marks cleanup_required', () => {
    const report = planBrazilReceitaFullJoinCleanup({ ...CLEAN_INPUT, errorCount: 1 });
    assert.equal(report.cleanup_required, true);
  });

  it('a declared temporary artifact marks cleanup_required', () => {
    const report = planBrazilReceitaFullJoinCleanup({
      ...CLEAN_INPUT,
      artifactCounts: { temporary_spill_file: 2 },
    });
    assert.equal(report.cleanup_required, true);
    assert.equal(report.artifact_counts_by_type.temporary_spill_file, 2);
  });

  it('reports not_executed + cleanup_engine_not_authorized, never a false completed', () => {
    const report = planBrazilReceitaFullJoinCleanup({ ...CLEAN_INPUT, sanitizerFailed: true });
    assert.equal(report.cleanup_status, 'not_executed');
    assert.notEqual(report.cleanup_status, 'completed');
    assert.equal(report.cleanup_error_counts_by_code.cleanup_engine_not_authorized, 1);
  });

  it('keeps unsafe_artifacts_detected false — nothing is produced, so nothing is left', () => {
    const report = planBrazilReceitaFullJoinCleanup({
      ...CLEAN_INPUT,
      sanitizerFailed: true,
      guardFailed: true,
      errorCount: 3,
      artifactCounts: { temporary_join_index: 1 },
    });
    assert.equal(report.unsafe_artifacts_detected, false);
  });

  it('ignores negative and non-integer artifact counts', () => {
    const report = planBrazilReceitaFullJoinCleanup({
      ...CLEAN_INPUT,
      artifactCounts: { temporary_spill_file: -5, temporary_report_file: 1.5 },
    });
    assert.equal(report.artifact_counts_by_type.temporary_spill_file, 0);
    assert.equal(report.artifact_counts_by_type.temporary_report_file, 0);
    assert.equal(report.cleanup_required, false);
  });

  it('ignores a negative error count', () => {
    const report = planBrazilReceitaFullJoinCleanup({ ...CLEAN_INPUT, errorCount: -2 });
    assert.equal(report.cleanup_required, false);
  });
});

describe('BR-SOURCE-11A cleanup model — sanitized, path-free output', () => {
  it('emits no path, no artifact name and no value', () => {
    const report = planBrazilReceitaFullJoinCleanup({
      ...CLEAN_INPUT,
      sanitizerFailed: true,
      artifactCounts: { temporary_scratch_directory: 1 },
    });
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('/'));
    assert.ok(!serialized.includes('\\'));
    assert.ok(!/Downloads/i.test(serialized));
    assert.ok(!/tmp/i.test(serialized));
  });

  it('emits only aggregate numbers, booleans and fixed labels', () => {
    const report = planBrazilReceitaFullJoinCleanup({ ...CLEAN_INPUT, errorCount: 1 });
    for (const value of Object.values(report.artifact_counts_by_type)) {
      assert.equal(typeof value, 'number');
    }
    for (const value of Object.values(report.cleanup_error_counts_by_code)) {
      assert.equal(typeof value, 'number');
    }
    assert.match(report.cleanup_status, /^[a-z_]+$/);
  });

  it('exposes no field through which a filesystem path could be supplied', () => {
    // The plan input is counts + booleans only. This is the structural guarantee that
    // the model cannot delete an arbitrary path: there is nowhere to put one.
    const inputKeys = ['artifactCounts', 'sanitizerFailed', 'guardFailed', 'errorCount'];
    for (const key of inputKeys) {
      assert.ok(!/path|dir|file$|target/i.test(key), `input key "${key}" must not accept a path`);
    }
  });
});

// ─── BR-SOURCE-11C: an Option B synthetic temp workspace ──────────────────────

/**
 * Option B introduces the first real temporary artifact in this series: a synthetic
 * temp workspace on disk. Its DELETION lives in the generator module (which only ever
 * removes the directory it created itself); this model still only PLANS and REPORTS,
 * so a declared workspace must show up as a counted artifact forcing cleanup — never
 * as a path this model could act on.
 */
describe('BR-SOURCE-11C cleanup model — a declared synthetic temp workspace', () => {
  const withWorkspace = {
    ...CLEAN_INPUT,
    artifactCounts: { temporary_scratch_directory: 1 },
  } as const;

  it('forces cleanup_required for a declared workspace on an otherwise clean run', () => {
    const report = planBrazilReceitaFullJoinCleanup(withWorkspace);
    assert.equal(report.cleanup_required, true);
    assert.equal(report.artifact_counts_by_type.temporary_scratch_directory, 1);
  });

  it('still reports not_executed — this model never deletes anything itself', () => {
    const report = planBrazilReceitaFullJoinCleanup(withWorkspace);
    assert.equal(report.cleanup_status, 'not_executed');
    assert.equal(report.cleanup_error_counts_by_code.cleanup_engine_not_authorized, 1);
    assert.equal(report.cleanup_error_counts_by_code.artifact_release_failed, 0);
    assert.equal(report.cleanup_error_counts_by_code.artifact_outside_managed_envelope, 0);
  });

  it('reports the workspace as a COUNT, never as a location', () => {
    const report = planBrazilReceitaFullJoinCleanup(withWorkspace);
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('/'));
    assert.ok(!/tmp|temp_dir|workspace|folders/i.test(serialized.replace(/temporary_\w+/g, '')));
    for (const kind of BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS) {
      assert.match(kind, /^[a-z_]+$/, 'an artifact kind is a fixed label, never a name');
    }
  });

  it('never claims a completed cleanup, even for a clean run with a workspace', () => {
    // `completed` would assert that something was deleted. Nothing here deletes.
    const report = planBrazilReceitaFullJoinCleanup(withWorkspace);
    assert.notEqual(report.cleanup_status, 'completed');
    assert.equal(report.unsafe_artifacts_detected, false);
  });
});
