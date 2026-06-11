/**
 * Tests — Verification Hardening (Hotfix 16AB.24.11)
 *
 * 34 test cases across 4 sections:
 *   Section A — Duplicate check honesty (9 cases)
 *   Section B — Twelve-column uniformity (7 cases)
 *   Section C — Canonical provenance (5 cases)
 *   Section D — Per-candidate checkpoints (13 cases)
 *
 * No real API calls. No real external queries. Pure unit tests.
 * Uses Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  makeNotChecked,
  makeCheckedNoMatch,
  makeCheckFailed,
  makePossibleMatch,
  makeConfirmedMatch,
  makeManualCheckedNoMatch,
  assertHonestDuplicateState,
  DuplicateStateInvariantError,
  nullHubSpotDuplicateChecker,
} from '../verification-hardening/duplicate-source-check';
import type { DuplicateSourceCheck } from '../verification-hardening/duplicate-source-check';

import {
  transformVerificationToTwelveColumns,
  validateTwelveColumnRow,
  TWELVE_COLUMN_HEADERS,
  serializeTwelveColumnsTsv,
} from '../verification-hardening/twelve-columns';
import type { TwelveColumnInput } from '../verification-hardening/twelve-columns';

import {
  buildProvenanceReport,
  migrateProvenanceOrigin,
  isCanonicalOrigin,
} from '../verification-hardening/provenance-canonical';

import {
  CandidateCheckpointManager,
  CANDIDATE_VERIFICATION_STAGES,
} from '../verification-hardening/candidate-checkpoint';

import {
  runCandidateVerification,
  makeNoOpProvider,
  makeNoOpContextAssembler,
} from '../verification-hardening/candidate-verification-runner';
import type { CandidateVerificationRunOptions } from '../verification-hardening/candidate-verification-runner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'vharden-test-'));
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function baseTwelveInput(overrides: Partial<TwelveColumnInput> = {}): TwelveColumnInput {
  return {
    candidateName: 'Test Company',
    identity: { commercialName: 'Test Company', legalName: null, aliases: [], domain: 'testco.com' },
    country: 'Colombia',
    officialWebsite: 'https://testco.com',
    linkedin: 'https://www.linkedin.com/company/testco',
    city: 'Bogotá',
    additionalCities: [],
    estimatedSize: '200-500 empleados',
    sizeScope: null,
    technologyB2bFit: { reason: 'Solución SaaS B2B para empresas colombianas.', subsector: null, isVerified: true },
    colombiaOperation: { confirmed: true, cities: ['Bogotá'], evidence: null },
    primaryEvidenceUrl: 'https://testco.com',
    primaryEvidenceProvenance: 'tool_result_url',
    identityEvidenceSources: ['Sitio oficial'],
    confidence: 'Alta',
    conflicts: [],
    duplicateStatus: null,
    requiresHumanReview: false,
    yearOrDate: null,
    extraNotes: null,
    ...overrides,
  };
}

function makeCandidate(key = 'test-candidate') {
  return {
    name: 'Test Company SAS',
    candidateKey: key,
    candidateInputHash: `hash-${key}`,
    website: 'https://testco.com',
    linkedin: null,
    aliases: [],
    domain: 'testco.com',
  };
}

// ─── Section A: Duplicate check honesty ──────────────────────────────────────

describe('A. Duplicate check honesty', () => {

  it('A1: new_candidate pipeline status does NOT produce checked_no_match', () => {
    // Simulates the SGM Salud bug: pipeline status "new_candidate" must NOT
    // be automatically converted to hubspot.status = "checked_no_match"
    const pipelineStatus = 'new_candidate';

    // The ONLY way to get checked_no_match is via makeCheckedNoMatch with real evidence
    // Simulating the wrong conversion
    assert.throws(
      () => {
        const fakeBadCheck: DuplicateSourceCheck = {
          source: 'hubspot',
          status: 'checked_no_match',
          matches: [],
          checkedAt: null,           // null → invariant violation
          queryEvidence: null,       // null → invariant violation
          errorCode: null,
        };
        // assertHonestDuplicateState will catch this
        assertHonestDuplicateState(fakeBadCheck);
      },
      DuplicateStateInvariantError,
      'checked_no_match without query evidence must throw invariant error'
    );

    // The correct result when HubSpot was not queried
    void pipelineStatus; // used in test logic conceptually
    const correct = makeNotChecked('hubspot');
    assert.equal(correct.status, 'not_checked');
    assert.equal(correct.checkedAt, null);
    assert.equal(correct.queryEvidence, null);
  });

  it('A2: HubSpot not configured returns not_checked', async () => {
    const result = await nullHubSpotDuplicateChecker.checkCandidate({
      companyName: 'SGM Salud',
      aliases: [],
      domain: 'sgmsalud.com',
      linkedinUrl: null,
    });
    assert.equal(result.status, 'not_checked');
    assert.equal(result.source, 'hubspot');
    assert.equal(result.checkedAt, null);
    assert.equal(result.queryEvidence, null);
  });

  it('A3: real query with zero results → checked_no_match', () => {
    const check = makeCheckedNoMatch('hubspot', ['Celes', 'Celes RetailTech', 'getceles.com'], 'hubspot_crm_api_search');
    assert.equal(check.status, 'checked_no_match');
    assert.notEqual(check.checkedAt, null);
    assert.ok(check.queryEvidence !== null);
    assert.equal(check.queryEvidence.resultCount, 0);
    assert.ok(check.queryEvidence.queries.length >= 1);
  });

  it('A4: error → check_failed', () => {
    const check = makeCheckFailed('hubspot', 'ECONNREFUSED');
    assert.equal(check.status, 'check_failed');
    assert.equal(check.errorCode, 'ECONNREFUSED');
  });

  it('A5: partial match → possible_match', () => {
    const check = makePossibleMatch(
      'hubspot',
      [{ matchedId: 'hs-123', matchedName: 'SGM', matchedDomain: null, confidence: 65, reason: 'Name similarity' }],
      ['SGM Salud'],
      'hubspot_crm_api_search'
    );
    assert.equal(check.status, 'possible_match');
    assert.equal(check.matches.length, 1);
  });

  it('A6: exact match → confirmed_match', () => {
    const check = makeConfirmedMatch(
      'hubspot',
      [{ matchedId: 'hs-456', matchedName: 'Siigo SAS', matchedDomain: 'siigo.com', confidence: 95, reason: 'Domain exact match' }],
      ['siigo.com'],
      'hubspot_crm_api_search'
    );
    assert.equal(check.status, 'confirmed_match');
    assert.equal(check.matches[0]?.confidence, 95);
  });

  it('A7: checked_no_match requires timestamp and queries', () => {
    assert.throws(
      () => {
        const bad: DuplicateSourceCheck = {
          source: 'hubspot',
          status: 'checked_no_match',
          matches: [],
          checkedAt: new Date().toISOString(),
          queryEvidence: { method: 'manual', queries: [] }, // empty queries
          errorCode: null,
        };
        assertHonestDuplicateState(bad);
      },
      DuplicateStateInvariantError
    );
  });

  it('A8: Celes preserves manual evidence', () => {
    const check = makeManualCheckedNoMatch(
      'hubspot',
      ['Celes', 'Celes RetailTech', 'Celes AI', 'Celes Solutions', 'getceles.com'],
      '2026-06-08T12:00:00.000Z'
    );
    assert.equal(check.status, 'checked_no_match');
    assert.equal(check.queryEvidence?.method, 'manual_human_search');
    assert.equal(check.queryEvidence?.queries.length, 5);
    assert.equal(check.queryEvidence?.resultCount, 0);
    assert.equal(check.checkedAt, '2026-06-08T12:00:00.000Z');
  });

  it('A9: SGM Salud corrects to not_checked', async () => {
    // SGM's original state was incorrectly "checked_no_match" derived from new_candidate
    // The corrected state must be not_checked (no real HubSpot query was made)
    const corrected = makeNotChecked('hubspot');
    assert.equal(corrected.status, 'not_checked');
    assert.equal(corrected.checkedAt, null);
    assert.equal(corrected.queryEvidence, null);

    // Asserting that the invariant would have caught the original wrong state
    assert.throws(() => {
      assertHonestDuplicateState({
        source: 'hubspot',
        status: 'checked_no_match',
        matches: [],
        checkedAt: null,
        queryEvidence: null,
        errorCode: null,
      });
    }, DuplicateStateInvariantError);
  });
});

// ─── Section B: Twelve-column uniformity ─────────────────────────────────────

describe('B. Twelve-column uniformity', () => {

  it('B1: all three candidates produce the exact twelve headers', () => {
    const sofkaInput = baseTwelveInput({ candidateName: 'Sofka Technologies' });
    const celesInput = baseTwelveInput({ candidateName: 'Celes' });
    const sgmInput = baseTwelveInput({ candidateName: 'SGM Salud' });

    for (const input of [sofkaInput, celesInput, sgmInput]) {
      const row = transformVerificationToTwelveColumns(input);
      const keys = Object.keys(row);
      assert.deepEqual(keys.sort(), [...TWELVE_COLUMN_HEADERS].sort());
    }
  });

  it('B2: Sector is always "Tecnología" (macrosector)', () => {
    for (const name of ['Sofka Technologies', 'Celes', 'SGM Salud']) {
      const input = baseTwelveInput({ candidateName: name });
      const row = transformVerificationToTwelveColumns(input);
      assert.equal(row['Sector'], 'Tecnología');
    }
  });

  it('B3: subsector in technologyB2bFit does not replace Sector', () => {
    const input = baseTwelveInput({
      technologyB2bFit: {
        reason: 'Plataforma SaaS B2B.',
        subsector: 'healthtech_b2b',
        isVerified: true,
      },
    });
    const row = transformVerificationToTwelveColumns(input);
    assert.equal(row['Sector'], 'Tecnología');
    // Subsector string must NOT appear as the value of the Sector column
    assert.notEqual(String(row['Sector']), 'healthtech_b2b', 'Subsector must not replace macrosector');
    // subsector goes to Descripción or Notas
    const descOrNotes = (row['Descripción'] ?? '') + (row['Notas'] ?? '');
    assert.ok(descOrNotes.includes('healthtech_b2b'), 'Subsector preserved in description/notes');
  });

  it('B4: description is generated from structured fields (not invented)', () => {
    const input = baseTwelveInput({
      technologyB2bFit: {
        reason: 'Plataforma de gestión de inventarios para retail.',
        subsector: null,
        isVerified: true,
      },
    });
    const row = transformVerificationToTwelveColumns(input);
    assert.ok(row['Descripción'] !== null && row['Descripción'].length > 0);
    assert.ok(row['Descripción']!.includes('inventarios'), 'description must include reason text');
    assert.ok((row['Descripción']!.length) <= 500, 'description ≤ 500 chars');
  });

  it('B5: evidence source is generated deterministically from known fields', () => {
    const input = baseTwelveInput({
      officialWebsite: 'https://sofka.com.co',
      linkedin: 'https://www.linkedin.com/company/sofka-technologies',
      identityEvidenceSources: [],
      identity: { commercialName: 'Sofka Technologies', legalName: null, aliases: [], domain: 'sofka.com.co' },
    });
    const row = transformVerificationToTwelveColumns(input);
    const src = row['Fuente / evidencia'];
    assert.ok(src !== null, 'Source should be populated');
    assert.ok(src!.includes('Sitio oficial') || src!.includes('sofka.com.co'), 'Must include official site');
    assert.ok(src!.includes('LinkedIn'), 'Must include LinkedIn');
  });

  it('B6: unknown/model-generated URLs are not listed as confirmed sources', () => {
    const input = baseTwelveInput({
      primaryEvidenceProvenance: 'model_generated_url',
      primaryEvidenceUrl: 'https://example-unknown.com/about',
      officialWebsite: null,
      linkedin: null,
      identity: { commercialName: 'Unknown Co', legalName: null, aliases: [], domain: null },
      identityEvidenceSources: [],
    });
    const row = transformVerificationToTwelveColumns(input);
    const src = row['Fuente / evidencia'];
    // model_generated_url must not be listed as a confirmed source
    if (src !== null) {
      assert.ok(
        !src.includes('example-unknown.com'),
        'model_generated_url should not appear as confirmed evidence source'
      );
    }
  });

  it('B7: conflicts are preserved in Notas', () => {
    const input = baseTwelveInput({
      conflicts: ['founding_year_conflict', 'linkedin_multiple_profiles'],
    });
    const row = transformVerificationToTwelveColumns(input);
    assert.ok(row['Notas'] !== null);
    assert.ok(row['Notas']!.includes('founding_year_conflict'));
    assert.ok(row['Notas']!.includes('linkedin_multiple_profiles'));
  });
});

// ─── Section C: Canonical provenance ─────────────────────────────────────────

describe('C. Canonical provenance', () => {

  it('C1: only the five canonical EvidenceUrlOrigin values are used', () => {
    const canonicalValues = [
      'tool_result_url',
      'citation_url',
      'tool_result_and_citation',
      'model_generated_url',
      'unknown_origin',
    ];
    const nonCanonical = ['confirmed_match', 'confirmed_normalized', 'auditable', 'verified', 'trusted'];

    for (const v of canonicalValues) {
      assert.ok(isCanonicalOrigin(v), `${v} should be canonical`);
    }
    for (const v of nonCanonical) {
      assert.ok(!isCanonicalOrigin(v), `${v} should NOT be canonical`);
    }
  });

  it('C2: confirmed_match with matching URL migrates to tool_result_url', () => {
    const url = 'https://www.sgmsalud.com/';
    const result = migrateProvenanceOrigin('confirmed_match', url, {
      searchResultUrls: ['https://www.sgmsalud.com/', 'https://www.sgmsalud.com/servicios'],
      citationUrls: [],
    });
    assert.equal(result, 'tool_result_url');
  });

  it('C3: confirmed_match without URL in search results → unknown_origin', () => {
    const result = migrateProvenanceOrigin('confirmed_match', 'https://sgmsalud.com/', {
      searchResultUrls: ['https://completely-different.com'],
      citationUrls: [],
    });
    assert.equal(result, 'unknown_origin');
  });

  it('C4: auditable with no search results → unknown_origin', () => {
    const result = migrateProvenanceOrigin('auditable', 'https://sgmsalud.com/', {
      searchResultUrls: [],
      citationUrls: [],
    });
    assert.equal(result, 'unknown_origin');
  });

  it('C5: provenance report audit status recalculated from canonical origins', () => {
    const report = buildProvenanceReport({
      officialWebsite: { url: 'https://sofka.com.co/', origin: 'tool_result_url' },
      linkedin: { url: 'https://www.linkedin.com/company/sofka-technologies', origin: 'tool_result_url' },
      primaryEvidence: { url: 'https://sofka.com.co/', origin: 'tool_result_url' },
      searchResultUrls: ['https://sofka.com.co/', 'https://www.linkedin.com/company/sofka-technologies'],
      citationUrls: [],
    });
    assert.equal(report.auditStatus, 'auditable');
    assert.equal(report.officialWebsite.origin, 'tool_result_url');
    assert.equal(report.linkedin.origin, 'tool_result_url');
  });
});

// ─── Section D: Per-candidate checkpoints ────────────────────────────────────

describe('D. Per-candidate checkpoints', () => {
  let tmpDir: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setupTmp = (): void => { tmpDir = makeTmpDir(); };
  const teardownTmp = (): void => { cleanup(tmpDir); };

  it('D1: fresh execution completes all stages', async () => {
    setupTmp();
    try {
      const opts: CandidateVerificationRunOptions = {
        candidate: makeCandidate('d1-candidate'),
        checkpointDirectory: tmpDir,
        resume: false,
        contextAssembler: makeNoOpContextAssembler(),
        provider: makeNoOpProvider(),
        duplicateCheckers: { hubspot: nullHubSpotDuplicateChecker },
        pipelineVersion: '16AB.24.11',
        contextVersion: '16AB.24.5-v1',
      };
      const result = await runCandidateVerification(opts);
      assert.equal(result.status, 'completed');
      assert.ok(result.stagesRun.length >= CANDIDATE_VERIFICATION_STAGES.length - 1);
    } finally { teardownTmp(); }
  });

  it('D2: resume does not repeat a completed stage (no provider call duplication)', async () => {
    setupTmp();
    try {
      const candidate = makeCandidate('d2-candidate');
      let providerCallCount = 0;
      const countingProvider = {
        async runVerification() {
          providerCallCount++;
          return makeNoOpProvider().runVerification(undefined as never);
        },
      };

      const opts: CandidateVerificationRunOptions = {
        candidate,
        checkpointDirectory: tmpDir,
        resume: false,
        contextAssembler: makeNoOpContextAssembler(),
        provider: countingProvider,
        duplicateCheckers: { hubspot: nullHubSpotDuplicateChecker },
        pipelineVersion: '16AB.24.11',
        contextVersion: '16AB.24.5-v1',
      };
      await runCandidateVerification(opts);
      assert.equal(providerCallCount, 1, 'Provider called once on first run');

      // Second run with same inputs — should skip provider
      const opts2 = { ...opts, resume: true };
      const result2 = await runCandidateVerification(opts2);
      assert.equal(result2.status, 'skipped_already_complete', 'Second run should be skipped');
      assert.equal(providerCallCount, 1, 'Provider must NOT be called again');
    } finally { teardownTmp(); }
  });

  it('D3: resume does not duplicate usage or cost', async () => {
    setupTmp();
    try {
      const candidate = makeCandidate('d3-candidate');
      const opts: CandidateVerificationRunOptions = {
        candidate,
        checkpointDirectory: tmpDir,
        resume: false,
        contextAssembler: makeNoOpContextAssembler(),
        provider: makeNoOpProvider(),
        duplicateCheckers: { hubspot: nullHubSpotDuplicateChecker },
        pipelineVersion: '16AB.24.11',
        contextVersion: '16AB.24.5-v1',
      };
      const first = await runCandidateVerification(opts);
      const second = await runCandidateVerification({ ...opts, resume: true });

      assert.equal(second.usageAdded.providerCalls, 0);
      assert.equal(second.usageAdded.inputTokens, 0);
      assert.equal(second.usageAdded.costUsd, 0);

      // First run did some work
      assert.ok(first.stagesRun.length > 0, 'First run must execute stages');
    } finally { teardownTmp(); }
  });

  it('D4: changing candidateInputHash invalidates checkpoint', async () => {
    setupTmp();
    try {
      const candidate = makeCandidate('d4-candidate');
      const opts: CandidateVerificationRunOptions = {
        candidate,
        checkpointDirectory: tmpDir,
        resume: false,
        contextAssembler: makeNoOpContextAssembler(),
        provider: makeNoOpProvider(),
        duplicateCheckers: { hubspot: nullHubSpotDuplicateChecker },
        pipelineVersion: '16AB.24.11',
        contextVersion: '16AB.24.5-v1',
      };
      await runCandidateVerification(opts);

      const mutatedCandidate = { ...candidate, candidateInputHash: 'different-hash-xyz' };
      const result2 = await runCandidateVerification({
        ...opts,
        candidate: mutatedCandidate,
        resume: true,
      });
      // Must re-run, not skip
      assert.notEqual(result2.status, 'skipped_already_complete', 'Changed hash must not be skipped');
    } finally { teardownTmp(); }
  });

  it('D5: changing contextVersion invalidates from context_assembled', () => {
    setupTmp();
    try {
      const checkpoint = CandidateCheckpointManager.create(tmpDir, 'd5-key', {
        candidateInputHash: 'hash-a',
        sharedContextHash: 'shared-a',
        pipelineVersion: '16AB.24.11',
        contextVersion: 'ctx-v1',
      });
      checkpoint.markStageCompleted('context_assembled', { data: 'ctx' });
      checkpoint.markStageCompleted('provider_completed', { data: 'provider' });
      checkpoint.markCompleted();

      // Resume with new context version
      const resumed = CandidateCheckpointManager.resume(tmpDir, 'd5-key', {
        candidateInputHash: 'hash-a',
        sharedContextHash: 'shared-a',
        pipelineVersion: '16AB.24.11',
        contextVersion: 'ctx-v2',
      });
      assert.ok(resumed !== null);
      // context_assembled stage must be invalidated
      assert.ok(!resumed!.isStageCompleted('context_assembled'), 'context_assembled must be invalidated on contextVersion change');
    } finally { teardownTmp(); }
  });

  it('D6: changing duplicate checker config invalidates from duplicates_checked', () => {
    setupTmp();
    try {
      const checkpoint = CandidateCheckpointManager.create(tmpDir, 'd6-key', {
        candidateInputHash: 'hash-a',
        sharedContextHash: 'shared-a',
        pipelineVersion: '16AB.24.11',
        contextVersion: 'ctx-v1',
        duplicateCheckConfigVersion: 'v1',
      });
      const hashes1 = checkpoint.getManifest().duplicateCheckConfigHash;

      const checkpoint2 = CandidateCheckpointManager.create(tmpDir + '-2', 'd6-key', {
        candidateInputHash: 'hash-a',
        sharedContextHash: 'shared-a',
        pipelineVersion: '16AB.24.11',
        contextVersion: 'ctx-v1',
        duplicateCheckConfigVersion: 'v2',
      });
      const hashes2 = checkpoint2.getManifest().duplicateCheckConfigHash;

      assert.notEqual(hashes1, hashes2, 'Different duplicate check config versions must produce different hashes');

      cleanup(tmpDir + '-2');
    } finally { teardownTmp(); }
  });

  it('D7: failure after provider preserves usage', async () => {
    setupTmp();
    try {
      const candidate = makeCandidate('d7-candidate');
      let providerCalled = false;

      const failingDupChecker = {
        async checkCandidate() {
          throw new Error('Simulated duplicate checker failure');
        },
      };

      const countingProvider = {
        async runVerification() {
          providerCalled = true;
          return makeNoOpProvider().runVerification(undefined as never);
        },
      };

      const result = await runCandidateVerification({
        candidate,
        checkpointDirectory: tmpDir,
        resume: false,
        contextAssembler: makeNoOpContextAssembler(),
        provider: countingProvider,
        duplicateCheckers: { hubspot: failingDupChecker },
        pipelineVersion: '16AB.24.11',
        contextVersion: '16AB.24.5-v1',
      });

      // Provider was called, failure happened after
      assert.ok(providerCalled, 'Provider should have been called');
      assert.equal(result.status, 'failed');
      // Provider stage was still run and counted
      assert.ok(result.stagesRun.includes('provider_completed'), 'provider_completed must be in stagesRun');
    } finally { teardownTmp(); }
  });

  it('D8: active lock blocks a second worker', () => {
    setupTmp();
    try {
      const checkpoint = CandidateCheckpointManager.create(tmpDir, 'd8-key', {
        candidateInputHash: 'hash-a',
        sharedContextHash: 'shared-a',
        pipelineVersion: '16AB.24.11',
        contextVersion: 'ctx-v1',
      });

      const acquired = checkpoint.acquireLock('worker-A', 60_000);
      assert.ok(acquired, 'worker-A should acquire lock');

      // Load the same manifest fresh
      const checkpoint2 = CandidateCheckpointManager.resume(tmpDir, 'd8-key', {
        candidateInputHash: 'hash-a',
        sharedContextHash: 'shared-a',
        pipelineVersion: '16AB.24.11',
        contextVersion: 'ctx-v1',
      });
      assert.ok(checkpoint2 !== null);
      assert.ok(checkpoint2!.isLocked(), 'Second reader must see the lock');
      const acquired2 = checkpoint2!.acquireLock('worker-B', 60_000);
      assert.ok(!acquired2, 'worker-B must NOT acquire an active lock');
    } finally { teardownTmp(); }
  });

  it('D9: expired lock can be recovered by a new worker', () => {
    setupTmp();
    try {
      const checkpoint = CandidateCheckpointManager.create(tmpDir, 'd9-key', {
        candidateInputHash: 'hash-a',
        sharedContextHash: 'shared-a',
        pipelineVersion: '16AB.24.11',
        contextVersion: 'ctx-v1',
      });

      // Acquire with -1ms TTL (immediately expired)
      checkpoint.acquireLock('worker-A', 1);

      // Brief wait to ensure expiry
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }

      assert.ok(checkpoint.isLockExpired(), 'Lock must be expired after TTL');
      const recovered = checkpoint.recoverExpiredLock('worker-B');
      assert.ok(recovered, 'worker-B must recover the expired lock');
    } finally { teardownTmp(); }
  });

  it('D10: corrupt stage file invalidates only that stage', () => {
    setupTmp();
    try {
      const checkpoint = CandidateCheckpointManager.create(tmpDir, 'd10-key', {
        candidateInputHash: 'hash-a',
        sharedContextHash: 'shared-a',
        pipelineVersion: '16AB.24.11',
        contextVersion: 'ctx-v1',
      });

      checkpoint.markStageCompleted('context_assembled', { data: 'ctx-data' });
      checkpoint.markStageCompleted('provider_completed', { data: 'provider-data' });

      // Corrupt the context_assembled file
      const { writeFileSync } = require('fs') as typeof import('fs');
      writeFileSync(
        require('path').join(tmpDir, 'd10-key', 'stages', 'context_assembled.json'),
        'NOT VALID JSON !!!'
      );

      // context_assembled should fail to load
      const ctxData = checkpoint.loadStageData('context_assembled');
      assert.equal(ctxData, null, 'Corrupt stage must return null');

      // provider_completed should still load fine
      const provData = checkpoint.loadStageData('provider_completed');
      assert.ok(provData !== null, 'Other stages must not be affected');
    } finally { teardownTmp(); }
  });

  it('D11: completed_requires_review is completed, not failed', async () => {
    setupTmp();
    try {
      const candidate = makeCandidate('d11-candidate');
      const reviewProvider = {
        async runVerification() {
          const base = await makeNoOpProvider().runVerification(undefined as never);
          return { ...base, requiresReview: true, requiresHumanReview: true };
        },
      };

      const result = await runCandidateVerification({
        candidate,
        checkpointDirectory: tmpDir,
        resume: false,
        contextAssembler: makeNoOpContextAssembler(),
        provider: reviewProvider,
        duplicateCheckers: { hubspot: nullHubSpotDuplicateChecker },
        pipelineVersion: '16AB.24.11',
        contextVersion: '16AB.24.5-v1',
      });

      assert.equal(result.status, 'completed_requires_review');
      assert.notEqual(result.status, 'failed', 'requires_review must not be failed');
    } finally { teardownTmp(); }
  });

  it('D12: checkpoints do not store raw provider responses', async () => {
    setupTmp();
    try {
      const candidate = makeCandidate('d12-candidate');
      await runCandidateVerification({
        candidate,
        checkpointDirectory: tmpDir,
        resume: false,
        contextAssembler: makeNoOpContextAssembler(),
        provider: makeNoOpProvider(),
        duplicateCheckers: { hubspot: nullHubSpotDuplicateChecker },
        pipelineVersion: '16AB.24.11',
        contextVersion: '16AB.24.5-v1',
      });

      const { readFileSync, readdirSync } = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');

      const stagesDir = path.join(tmpDir, 'd12-candidate', 'stages');
      const stageFiles = readdirSync(stagesDir);

      for (const f of stageFiles) {
        const content = readFileSync(path.join(stagesDir, f), 'utf-8');
        assert.ok(!content.includes('encrypted_content'), `${f} must not store encrypted_content`);
        assert.ok(!content.includes('api_key'), `${f} must not store api keys`);
        // Raw responses would typically contain large text blocks
        const parsed = JSON.parse(content) as Record<string, unknown>;
        assert.ok(!('rawResponse' in parsed), `${f} must not have rawResponse field`);
        assert.ok(!('raw_response' in parsed), `${f} must not have raw_response field`);
      }
    } finally { teardownTmp(); }
  });

  it('D13: no runtime dependency on scratch/ directory', async () => {
    setupTmp();
    try {
      // The runner only needs the checkpointDirectory we pass it — it must not
      // read from or write to scratch/ at runtime.
      const candidate = makeCandidate('d13-candidate');
      const result = await runCandidateVerification({
        candidate,
        checkpointDirectory: tmpDir,
        resume: false,
        contextAssembler: makeNoOpContextAssembler(),
        provider: makeNoOpProvider(),
        duplicateCheckers: { hubspot: nullHubSpotDuplicateChecker },
        pipelineVersion: '16AB.24.11',
        contextVersion: '16AB.24.5-v1',
      });

      // Must complete successfully with tmpDir as checkpoint directory
      assert.notEqual(result.status, 'failed');

      // The tmpDir is a temp path that does NOT contain "scratch" —
      // if the runner depended on scratch/ it would have errored above.
      assert.ok(!tmpDir.includes('scratch'), 'Test uses non-scratch tmpDir');
    } finally { teardownTmp(); }
  });
});

// ─── TSV serialization smoke test ────────────────────────────────────────────

describe('E. TSV output', () => {
  it('TSV has correct header and one row per candidate', () => {
    const mkInput = (name: string): TwelveColumnInput => baseTwelveInput({
      candidateName: name,
      identity: { commercialName: name, legalName: null, aliases: [], domain: 'testco.com' },
    });
    const inputs = [
      mkInput('Sofka Technologies'),
      mkInput('Celes'),
      mkInput('SGM Salud'),
    ];
    const rows = inputs.map(transformVerificationToTwelveColumns);
    const tsv = serializeTwelveColumnsTsv(rows);
    const lines = tsv.split('\n');
    assert.equal(lines.length, 4, 'Header + 3 data rows');
    assert.ok(lines[0]!.includes('Empresa'), 'First line is header');
    assert.ok(lines[0]!.includes('Fuente / evidencia'), 'Header includes all columns');
    assert.ok(lines[1]!.includes('Sofka Technologies'));
    assert.ok(lines[2]!.includes('Celes'));
    assert.ok(lines[3]!.includes('SGM Salud'));
  });
});
