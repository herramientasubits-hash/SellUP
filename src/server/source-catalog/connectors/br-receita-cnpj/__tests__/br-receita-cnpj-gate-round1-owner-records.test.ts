/**
 * BR-SOURCE-GATE-ROUND-1 — the three recorded owner decisions, and the lines they must not cross.
 *
 * Round 1 records GATE-2 (`approved`), the GATE-3 field policy (`not_approved`, blocked on the CNPJ
 * snapshot blocker) and GATE-8 (`APPROVED_AS_CONTRACT`). This suite exists because each of those has
 * a way of quietly becoming something bigger than it is:
 *
 *   · GATE-2 could look like it enabled temporary storage. It must not: its own *Relation to flags*
 *     clause says it "flips **no** operational flag", and the tracked policy constant and the
 *     standing cap proposal are asserted UNCHANGED here, against their real owners.
 *   · GATE-3 could look approved because a policy was recorded. It is not, and the residual blockers
 *     that keep it shut are asserted present rather than described in prose.
 *   · GATE-8 could look like permission to write the runner. `APPROVED_AS_CONTRACT` is the value
 *     precisely so it cannot, and every preserved invariant is asserted against the module that
 *     really owns it — never against this record's own copy, which would be circular.
 *
 * And the whole-artifact verdict is asserted `invalid` / `NO_GO`, because five gates are still
 * `not_started`. That is the CORRECT outcome, not a failure of these records.
 *
 * Pure: no network, no filesystem beyond reading this repository's own sources for the static
 * guards, no database, no provider. 0 credits.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { validateBrazilReceitaOwnerDecisionArtifact } from '../br-receita-cnpj-owner-decision-validator';
import { buildBrazilReceitaGate1RecordedOwnerDecisionArtifact } from '../br-receita-cnpj-gate1-recorded-owner-decision';
import {
  buildBrazilReceitaGate2RecordedOwnerDecisionArtifact,
  BRAZIL_RECEITA_GATE2_APPROVED_CAPS,
  BRAZIL_RECEITA_GATE2_APPROVED_STORAGE_OPTION,
  BRAZIL_RECEITA_GATE2_APPROVAL_IS_JOINT,
  BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION,
  BRAZIL_RECEITA_GATE2_CAPS_STILL_UNSUPPLIED,
  BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT,
  BRAZIL_RECEITA_GATE2_MAX_ROWS_READ_CLASSIFICATION,
  BRAZIL_RECEITA_GATE2_OPTION_C_ENCRYPTION,
  BRAZIL_RECEITA_GATE2_PRIVACY_APPROVER_ROLE,
  BRAZIL_RECEITA_GATE2_STORAGE_OPTIONS,
  BRAZIL_RECEITA_GATE2_TEMPORARY_MATERIAL_TTL,
  BRAZIL_RECEITA_GATE2_TIGHTER_THAN_STANDING_PROPOSAL,
  BRAZIL_RECEITA_GATE2_WORKSPACE_CONSTRAINTS,
} from '../br-receita-cnpj-gate2-recorded-owner-decision';
import {
  BRAZIL_RECEITA_GATE3_DISCHARGED_BY_THIS_WORKSTREAM,
  BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION,
  BRAZIL_RECEITA_GATE3_FIELDS_PRESENT_BUT_NOT_IN_INCLUDE_SET,
  BRAZIL_RECEITA_GATE3_INCLUDED,
  BRAZIL_RECEITA_GATE3_PROHIBITED_OUTPUT,
  BRAZIL_RECEITA_GATE3_RAW_DATA_DISPOSITION,
  BRAZIL_RECEITA_GATE3_REPORT_MARKER_VALUE,
  BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS,
  BRAZIL_RECEITA_GATE3_STATUS,
  BRAZIL_RECEITA_GATE3_TRADE_NAME_DISPOSITION,
} from '../br-receita-cnpj-gate3-recorded-field-policy';
import {
  BRAZIL_RECEITA_GATE8_AUTHORIZES_OPERATIONS,
  BRAZIL_RECEITA_GATE8_APPROVAL_IS_JOINT,
  BRAZIL_RECEITA_GATE8_POST_GATE_ENGINEERING,
  BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS,
  BRAZIL_RECEITA_GATE8_REQUIRED_IMPLEMENTATION_PROOFS,
  BRAZIL_RECEITA_GATE8_STATUS,
} from '../br-receita-cnpj-gate8-recorded-contract-approval';

// The real owners of the invariants GATE-8 claims to preserve.
import {
  BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS,
  brazilReceitaProposedFullScanResourceCaps,
} from '../br-receita-cnpj-real-full-scan-benchmark';
import { createBrazilReceitaFullJoinNullBenchmarkSink } from '../br-receita-cnpj-full-join-engine-contract';
import { BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED } from '../br-receita-cnpj-full-join-partition-workspace';
import {
  BRAZIL_RECEITA_FULL_JOIN_OPERATOR_SUPPLIED_CAP_KEYS,
  BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL,
} from '../br-receita-cnpj-full-join-resource-envelope';
import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import { sampleParserInput } from '../br-receita-cnpj-fixtures';

// ─── Static-guard plumbing ────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '../../../../../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * 🔴 Comments stripped before every static guard. These record modules NAME the flags and constants
 * they must never touch — that is the point of their headers — and a guard reading the raw body
 * would turn "documented as forbidden" into "used". That exact false positive has bitten this
 * repository before.
 */
function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const CONNECTOR = 'src/server/source-catalog/connectors/br-receita-cnpj';
const GATE2_MODULE = `${CONNECTOR}/br-receita-cnpj-gate2-recorded-owner-decision.ts`;
const GATE3_MODULE = `${CONNECTOR}/br-receita-cnpj-gate3-recorded-field-policy.ts`;
const GATE8_MODULE = `${CONNECTOR}/br-receita-cnpj-gate8-recorded-contract-approval.ts`;
const RECORD_MODULES = [GATE2_MODULE, GATE3_MODULE, GATE8_MODULE];

// ─── GATE-2 ───────────────────────────────────────────────────────────────────

describe('GATE-ROUND-1 · GATE-2 is approved, and only GATE-2', () => {
  it('13A reads gate1 and gate2 approved, and nothing else', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      buildBrazilReceitaGate2RecordedOwnerDecisionArtifact(),
    );

    assert.equal(result.gate1Approved, true);
    assert.equal(result.gate2Approved, true);
    assert.equal(result.gate7Approved, false);
    assert.equal(result.capInputPolicyApproved, false);
    assert.equal(result.controlledExecutionAttemptAuthorized, false);
  });

  it('🔴 the whole-artifact verdict is still invalid / NO_GO — five gates are not_started', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      buildBrazilReceitaGate2RecordedOwnerDecisionArtifact(),
    );

    assert.equal(result.status, 'invalid');
    assert.equal(result.goNoGo, 'NO_GO');
    assert.equal(result.canProceedToControlledExecutionPreflight, false);
  });

  it('no gate2 field carries unsafe content — no path, host, address or credential', () => {
    const result = validateBrazilReceitaOwnerDecisionArtifact(
      buildBrazilReceitaGate2RecordedOwnerDecisionArtifact(),
    );
    const unsafe = result.findings.filter(
      (finding) => finding.code === 'OWNER_FIELD_FORBIDDEN_CONTENT',
    );
    assert.deepEqual(unsafe, [], 'the record must not embed unsafe content');
  });

  it('the GATE-1 section is COMPOSED, not restated — one source of truth', () => {
    const gate1Only = buildBrazilReceitaGate1RecordedOwnerDecisionArtifact();
    const gate2Artifact = buildBrazilReceitaGate2RecordedOwnerDecisionArtifact();
    assert.deepEqual(gate2Artifact.gate1, gate1Only.gate1);
  });

  it('a fresh object is returned on every call', () => {
    const a = buildBrazilReceitaGate2RecordedOwnerDecisionArtifact();
    const b = buildBrazilReceitaGate2RecordedOwnerDecisionArtifact();
    assert.notEqual(a, b);
    assert.notEqual(a.gate2, b.gate2);
    assert.deepEqual(a, b);
  });

  it('approval is JOINT: technical owner and privacy owner both named in the record', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_APPROVAL_IS_JOINT, true);
    const artifact = buildBrazilReceitaGate2RecordedOwnerDecisionArtifact();
    const ownerRole = artifact.gate2?.ownerRole ?? '';
    assert.match(ownerRole, /technical owner/);
    assert.match(ownerRole, /privacy owner/);
  });

  it('🔴 no personal identity, signature or address in any recorded field', () => {
    const artifact = buildBrazilReceitaGate2RecordedOwnerDecisionArtifact();
    for (const value of Object.values(artifact.gate2 ?? {})) {
      if (typeof value !== 'string') continue;
      assert.equal(value.includes('@'), false, value);
      assert.equal(/signed by/i.test(value), false, value);
    }
  });
});

describe('GATE-ROUND-1 · GATE-2 storage envelope', () => {
  it('Option C is approved and A and B are NAMED not-approved', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_APPROVED_STORAGE_OPTION, 'option_c');
    assert.equal(BRAZIL_RECEITA_GATE2_STORAGE_OPTIONS.optionC.approved, true);
    assert.equal(BRAZIL_RECEITA_GATE2_STORAGE_OPTIONS.optionA.approved, false);
    assert.equal(BRAZIL_RECEITA_GATE2_STORAGE_OPTIONS.optionB.approved, false);
  });

  it('the seven decided ceilings are exactly the owner values', () => {
    assert.deepEqual(BRAZIL_RECEITA_GATE2_APPROVED_CAPS, {
      maxHeapUsedBytes: 134_217_728,
      maxExternalMemoryBytes: 67_108_864,
      maxRssBytes: 536_870_912,
      maxRuntimeMs: 21_600_000,
      maxPhaseRuntimeMs: 10_800_000,
      maxTemporaryStorageBytes: 4_294_967_296,
      maxRowsRead: 360_000_000,
    });
  });

  it('🔴 maxRowsRead is classified as a budget ceiling, NOT as an observation', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE2_MAX_ROWS_READ_CLASSIFICATION], [
      'OWNER_BUDGET_CEILING',
      'NOT_OBSERVED',
      'NOT_NATIONAL_ROW_COUNT_EVIDENCE',
    ]);
  });

  it('the three undecided caps are named, and are still operator-supplied and fail-closed', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE2_CAPS_STILL_UNSUPPLIED], [
      'maxFilesOpened',
      'maxBytesRead',
      'maxJoinKeysInMemory',
    ]);
    for (const key of BRAZIL_RECEITA_GATE2_CAPS_STILL_UNSUPPLIED) {
      assert.ok(
        BRAZIL_RECEITA_FULL_JOIN_OPERATOR_SUPPLIED_CAP_KEYS.includes(key),
        `${key} must stay operator-supplied`,
      );
    }
  });

  it('🔴 the GATE-2 envelope is never LOOSER than the standing benchmark proposal', () => {
    // Six of seven match the proposal exactly; `maxPhaseRuntimeMs` is deliberately tighter. The
    // invariant that survives a future alignment of the proposal is "never looser", so that is what
    // is asserted rather than the divergence itself.
    for (const [cap, value] of Object.entries(BRAZIL_RECEITA_GATE2_APPROVED_CAPS)) {
      const proposed = (
        BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS as unknown as Record<string, number>
      )[cap];
      if (typeof proposed !== 'number') continue;
      assert.ok(value <= proposed, `GATE-2 ${cap} (${value}) must not exceed the proposal (${proposed})`);
    }
  });

  it('the recorded conflict names the one cap that diverges, with both figures', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_TIGHTER_THAN_STANDING_PROPOSAL.length, 1);
    const entry = BRAZIL_RECEITA_GATE2_TIGHTER_THAN_STANDING_PROPOSAL[0]!;
    assert.equal(entry.cap, 'maxPhaseRuntimeMs');
    assert.equal(entry.gate2Value, BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxPhaseRuntimeMs);
    assert.equal(
      entry.standingProposalValue,
      BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxPhaseRuntimeMs,
    );
  });

  it('the workspace is constrained, and constrained by RULE rather than by location', () => {
    assert.deepEqual(BRAZIL_RECEITA_GATE2_WORKSPACE_CONSTRAINTS, {
      outsideRepository: true,
      outsideHomeDirectory: true,
      outsideDatasetRoot: true,
      symlinkPermitted: false,
      directoryMode: 0o700,
      fileMode: 0o600,
    });
  });

  it('TTL is the run lifetime, and cleanup is VERIFIED on both paths', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_TEMPORARY_MATERIAL_TTL, 'run_lifetime');
    assert.equal(BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.onSuccess, 'verified_deletion_required');
    assert.equal(BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.onFailure, 'verified_deletion_required');
    assert.equal(BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.cleanupFailedDisposition, 'terminal');
    assert.equal(BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.cleanupNotExecutedDisposition, 'terminal');
    assert.equal(BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT.successWithResiduePermitted, false);
  });

  it('🔴 the encryption disposition is CONDITIONAL, and carries its reopen trigger', () => {
    assert.equal(BRAZIL_RECEITA_GATE2_OPTION_C_ENCRYPTION.requiredNow, false);
    assert.ok(
      BRAZIL_RECEITA_GATE2_OPTION_C_ENCRYPTION.conditionUnderWhichNotRequired.length > 0,
      'a bare "not required" would be a waiver, not a disposition',
    );
    assert.ok(BRAZIL_RECEITA_GATE2_OPTION_C_ENCRYPTION.reopenTrigger.length > 0);
    assert.equal(
      BRAZIL_RECEITA_GATE2_OPTION_C_ENCRYPTION.verifiedDestroyStepRequired,
      true,
      'the destroy step is unconditional; only the encryption trigger is conditional',
    );
  });

  it('🔴 the bucket ordinal disposition is attributed to the PRIVACY OWNER, never to the agent', () => {
    assert.equal(
      BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION.classification,
      'structural_non_invertible_partition_metadata',
    );
    assert.equal(BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION.isJoinKeyMaterial, false);
    assert.equal(
      BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION.attributedTo,
      BRAZIL_RECEITA_GATE2_PRIVACY_APPROVER_ROLE,
    );
    assert.equal(BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION.attributedToAgent, false);
  });
});

describe('GATE-ROUND-1 · GATE-2 flips NO operational flag', () => {
  it('🔴 the tracked temporary-storage policy constant is STILL false', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED, false);
  });

  it('🔴 the provisional resource-cap proposal was NOT rewritten by this approval', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL.maxTemporaryStorageBytes, 0);
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL.maxOutputRows, 0);
  });

  it('the GATE-2 record does not import a flag, a cap module or the attempt ledger', () => {
    const code = stripTsComments(read(GATE2_MODULE));
    for (const forbidden of [
      'partition-workspace',
      'resource-envelope',
      'real-full-scan-benchmark',
      'attempt-ledger',
      'temporary-storage-approval',
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `the record must not import ${forbidden}: a record that can read a flag can be built to misreport one`,
      );
    }
  });
});

// ─── GATE-3 ───────────────────────────────────────────────────────────────────

describe('GATE-ROUND-1 · GATE-3 records a policy and stays SHUT', () => {
  it('🔴 the status is not approved, and names why', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_STATUS, 'not_approved_pending_cnpj_snapshot_blocker');
  });

  it('🔴 13A never reports a gate3 approval — there is no gate3 section to report', () => {
    // The artifact type has no `gate3`. Recording the policy must not have invented one, because a
    // structural validator reporting `gate3Approved` would be reporting an approval nobody gave.
    const artifact = buildBrazilReceitaGate2RecordedOwnerDecisionArtifact();
    assert.equal('gate3' in artifact, false);
    const result = validateBrazilReceitaOwnerDecisionArtifact(artifact);
    assert.equal('gate3Approved' in result, false);
  });

  it('a field_allowlist_version is assigned, and it is the FIRST one', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION, 'br_receita_cnpj_field_allowlist_v1');
  });

  it('🔴 the REPORT marker still reads not_approved — assigning a version is not releasing it', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_REPORT_MARKER_VALUE, 'not_approved');
    assert.notEqual(
      BRAZIL_RECEITA_GATE3_REPORT_MARKER_VALUE,
      BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION,
    );
  });

  it('the prohibited-output set is closed and carries every owner-named item', () => {
    for (const required of [
      'CNPJ básico',
      'full CNPJ',
      'cnpj_root',
      'cnpj_order',
      'cnpj_dv',
      'reconstructable CNPJ parts',
      'normalized_tax_id snapshot survival',
      'Socios',
      'QSA',
      'CPF',
      'person-linked data',
      'prohibited CNPJ derivatives',
    ]) {
      assert.ok(
        BRAZIL_RECEITA_GATE3_PROHIBITED_OUTPUT.includes(required),
        `missing prohibition: ${required}`,
      );
    }
    assert.equal(BRAZIL_RECEITA_GATE3_PROHIBITED_OUTPUT.length, 12, 'closed set, no silent tail');
  });

  it('the include set is closed and carries every owner-named item', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE3_INCLUDED], [
      'sanitized legal_name',
      'CNAE approved fields',
      'registration status',
      'company size',
      'UF',
      'municipality',
      'opened_at',
      'source period',
      'provenance',
      'capital_social_value',
    ]);
  });

  it('trade_name is EXCLUDED_NOT_IMPLEMENTED and raw_data is a CLOSED_TYPED_ALLOWLIST', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_TRADE_NAME_DISPOSITION, 'EXCLUDED_NOT_IMPLEMENTED');
    assert.equal(BRAZIL_RECEITA_GATE3_RAW_DATA_DISPOSITION, 'CLOSED_TYPED_ALLOWLIST');
  });

  it('🔴 every residual blocker is recorded UNRESOLVED, with a named owner', () => {
    assert.ok(BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS.length >= 3);
    for (const blocker of BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS) {
      assert.equal(blocker.resolvedByThisWorkstream, false, blocker.id);
      assert.ok(blocker.ownedBy.length > 0, blocker.id);
      assert.ok(blocker.detail.length > 0, blocker.id);
    }
    const owners = BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS.map((b) => b.ownedBy);
    assert.ok(
      owners.includes('GATE_4_IDENTITY_GRAIN'),
      'the identity-grain residual must be attributed to GATE-4, not silently resolved here',
    );
  });

  it('the discharged list matches what the hardening actually did', () => {
    assert.equal(BRAZIL_RECEITA_GATE3_DISCHARGED_BY_THIS_WORKSTREAM.length, 5);
    // And the claim is true of the real builder, not merely written down.
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snap of result.snapshots) {
      assert.equal('cnpj_root' in snap.raw_data, false);
      assert.equal('cnpj_order' in snap.raw_data, false);
      assert.equal('cnpj_dv' in snap.raw_data, false);
    }
  });

  it('the four unlabelled fields are carried as OPEN, not deleted', () => {
    const fields = BRAZIL_RECEITA_GATE3_FIELDS_PRESENT_BUT_NOT_IN_INCLUDE_SET.map((f) => f.field);
    assert.ok(fields.some((f) => f.includes('mei_flag')));
    assert.ok(fields.some((f) => f.includes('matrix_branch_flag')));

    // And `mei_flag` is still really there: it is the GATE-1 R5 control marker, and deleting a
    // privacy control for being absent from an include list would weaken what the list protects.
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.ok(result.snapshots.every((snap) => 'mei_flag' in snap.raw_data));
  });
});

// ─── GATE-8 ───────────────────────────────────────────────────────────────────

describe('GATE-ROUND-1 · GATE-8 is approved AS A CONTRACT and nothing more', () => {
  it('🔴 the status is APPROVED_AS_CONTRACT, never a bare approved', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_STATUS, 'APPROVED_AS_CONTRACT');
    assert.notEqual(BRAZIL_RECEITA_GATE8_STATUS, 'approved');
  });

  it('🔴 it does NOT authorize operations, stated as data', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_AUTHORIZES_OPERATIONS, false);
  });

  it('approval is joint: repo safety owner and technical owner', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_APPROVAL_IS_JOINT, true);
  });

  it('🔴 maxOutputRows is still 0 — asserted against the module that OWNS it', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.maxOutputRows, 0);
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxOutputRows, 0);
    assert.equal(brazilReceitaProposedFullScanResourceCaps().maxOutputRows, 0);
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL.maxOutputRows, 0);
  });

  it('🔴 the null benchmark sink still retains nothing and emits nothing', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.nullBenchmarkSinkActive, true);
    const sink = createBrazilReceitaFullJoinNullBenchmarkSink();
    const tally = sink.tally();
    assert.equal(tally.rowsEmitted, 0);
    assert.equal(tally.recordsRetained, 0);
  });

  it('🔴 snapshot persistence is still false — asserted against the parser summary', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.snapshotPersistence, false);
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.equal(result.summary.snapshot_writes, 0);
    assert.equal(result.summary.db_writes, 0);
    assert.equal(result.summary.dataset_downloads, 0);
  });

  it('runtime, Agent 1 Brazil and production all stay false in the record', () => {
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.runtime, false);
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.agent1Brazil, false);
    assert.equal(BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS.production, false);
  });

  it('the nine deferred implementation proofs are enumerated', () => {
    for (const required of [
      'allowlist-only emit',
      'no prohibited key material',
      'bounded output',
      'staging',
      'atomic publish',
      'rollback',
      'integrity validation',
      'fail-closed runtime',
      'no import or runtime crossing without subsequent authorization',
    ]) {
      assert.ok(
        BRAZIL_RECEITA_GATE8_REQUIRED_IMPLEMENTATION_PROOFS.includes(required),
        `missing deferred proof: ${required}`,
      );
    }
    assert.equal(BRAZIL_RECEITA_GATE8_REQUIRED_IMPLEMENTATION_PROOFS.length, 9);
  });

  it('atomic publish and the engine-to-snapshot bridge stay post-gate engineering', () => {
    assert.deepEqual([...BRAZIL_RECEITA_GATE8_POST_GATE_ENGINEERING], [
      'atomic publish',
      'engine to snapshot bridge',
    ]);
  });

  it('the GATE-8 record has NO imports at all', () => {
    const code = stripTsComments(read(GATE8_MODULE));
    assert.equal(/^\s*import\s/m.test(code), false, 'a record that imports nothing can flip nothing');
  });
});

// ─── Static safety across all three records ───────────────────────────────────

describe('GATE-ROUND-1 · the records perform no I/O and authorize nothing', () => {
  it('no record module touches fs, path, process, env, network or Supabase', () => {
    for (const rel of RECORD_MODULES) {
      const code = stripTsComments(read(rel));
      for (const forbidden of [
        'node:fs',
        'node:path',
        'node:process',
        'process.env',
        'fetch(',
        'createClient',
        'supabase',
        'Date.now',
        'new Date',
      ]) {
        assert.equal(code.includes(forbidden), false, `${rel} must stay pure (${forbidden})`);
      }
    }
  });

  it('no record module names a real path, a dataset root or a credential', () => {
    for (const rel of RECORD_MODULES) {
      const code = read(rel);
      for (const forbidden of ['/Users/', 'sellup-source-data', 'raw-zips', 'service_role']) {
        assert.equal(code.includes(forbidden), false, `${rel} carries ${forbidden}`);
      }
    }
  });

  it('no record module carries a CNPJ-shaped or CPF-shaped literal', () => {
    for (const rel of RECORD_MODULES) {
      const code = stripTsComments(read(rel));
      // Underscore separators in the cap figures are deliberate: they also stop a numeric literal
      // from ever reading as a continuous 14- or 11-digit identifier.
      assert.equal(/(?<!\d)\d{14}(?!\d)/.test(code), false, `${rel} carries a 14-digit run`);
      assert.equal(/(?<!\d)\d{11}(?!\d)/.test(code), false, `${rel} carries an 11-digit run`);
    }
  });

  it('🔴 no record module claims to authorize execution, import or a runtime path', () => {
    for (const rel of RECORD_MODULES) {
      const code = stripTsComments(read(rel));
      for (const forbidden of [
        'ENABLE_BRAZIL',
        'ENABLE_BR_SOURCE',
        'importExecuted: true',
        'runtimeIntegration: true',
        'agent1Integration: true',
      ]) {
        assert.equal(code.includes(forbidden), false, `${rel} carries ${forbidden}`);
      }
    }
  });
});
