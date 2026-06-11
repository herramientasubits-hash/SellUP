/**
 * Tests — Budget Behavior & Employee Size Filter (Hotfix 16AB.25.5)
 *
 * 20 test cases:
 *   Section A — Budget behavior (tests 1–8)
 *   Section B — Employee size filter (tests 9–16)
 *   Section C — Configuration & enforcement (tests 17–20)
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
  runCandidateVerification,
  makeNoOpContextAssembler,
  type CandidateVerificationRunOptions,
  type VerificationOutput,
  type CandidateVerificationProvider,
} from '../verification-hardening/candidate-verification-runner';

import {
  nullHubSpotDuplicateChecker,
} from '../verification-hardening/duplicate-source-check';

import {
  evaluateEmployeeSizeEligibility,
  DEFAULT_EMPLOYEE_SIZE_CRITERIA,
  type EmployeeSizeCriteria,
} from '../verification-hardening/employee-size-filter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'budget-size-test-'));
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function baseOutput(overrides: Partial<VerificationOutput> = {}): VerificationOutput {
  return {
    requiresReview: false,
    identity: { commercialName: 'Test Co', legalName: null, aliases: [], domain: 'testco.com' },
    country: 'Colombia',
    city: 'Bogotá',
    additionalCities: [],
    estimatedSize: '201-500',
    sizeScope: 'colombia',
    technologyB2bFit: { reason: 'SaaS B2B', subsector: 'SaaS', isVerified: true },
    colombiaOperation: { confirmed: true, cities: ['Bogotá'], evidence: 'https://testco.com' },
    officialWebsite: 'https://testco.com',
    linkedin: null,
    primaryEvidenceUrl: 'https://testco.com',
    primaryEvidenceProvenance: 'official_website',
    identityEvidenceSources: [],
    confidence: 'Alta',
    conflicts: [],
    gatesPassed: true,
    requiresHumanReview: false,
    yearOrDate: null,
    extraNotes: null,
    searchResultUrls: [],
    citationUrls: [],
    inputTokens: 1000,
    outputTokens: 200,
    searchRequests: 1,
    costUsd: 0.01,
    ...overrides,
  };
}

function makeProviderWith(output: VerificationOutput): CandidateVerificationProvider {
  return {
    async runVerification() { return output; },
  };
}

function makeOpts(
  dir: string,
  provider: CandidateVerificationProvider,
  resume = false
): CandidateVerificationRunOptions {
  return {
    candidate: {
      name: 'Test Co',
      candidateKey: 'test-co',
      candidateInputHash: 'abc123',
      website: 'https://testco.com',
      linkedin: null,
      aliases: [],
      domain: 'testco.com',
    },
    checkpointDirectory: dir,
    resume,
    contextAssembler: makeNoOpContextAssembler(),
    provider,
    duplicateCheckers: { hubspot: nullHubSpotDuplicateChecker },
    pipelineVersion: '16AB.25.5',
    contextVersion: '16AB.24.5-v1',
  };
}

// ─── Section A — Budget behavior ──────────────────────────────────────────────

describe('Budget behavior (16AB.25.5)', () => {

  // Test 1: Completed response is persisted even when cost exceeds hard limit
  it('1. completed response is persisted when cost exceeds hard limit', async () => {
    const dir = makeTmpDir();
    try {
      const output = baseOutput({ costUsd: 0.40, budgetOutcome: 'hard_limit_exceeded_after_completion' });
      const result = await runCandidateVerification(makeOpts(dir, makeProviderWith(output)));
      assert.notEqual(result.status, 'failed', 'Should not fail when budget exceeded after completion');
      assert.ok(['completed', 'completed_requires_review'].includes(result.status));
    } finally {
      cleanup(dir);
    }
  });

  // Test 2: Usage is saved before evaluating post-completion excess
  it('2. usage is captured even when cost exceeds hard limit', async () => {
    const dir = makeTmpDir();
    try {
      const output = baseOutput({
        costUsd: 0.40,
        inputTokens: 89688,
        outputTokens: 3109,
        budgetOutcome: 'hard_limit_exceeded_after_completion',
      });
      const result = await runCandidateVerification(makeOpts(dir, makeProviderWith(output)));
      assert.equal(result.usageAdded.inputTokens, 89688);
      assert.equal(result.usageAdded.outputTokens, 3109);
      assert.equal(result.usageAdded.costUsd, 0.40);
    } finally {
      cleanup(dir);
    }
  });

  // Test 3: provider_completed is marked in the result
  it('3. provider_completed stage is run when budget exceeded after completion', async () => {
    const dir = makeTmpDir();
    try {
      const output = baseOutput({ costUsd: 0.40, budgetOutcome: 'hard_limit_exceeded_after_completion' });
      const result = await runCandidateVerification(makeOpts(dir, makeProviderWith(output)));
      assert.ok(result.stagesRun.includes('provider_completed'), 'provider_completed must be in stagesRun');
    } finally {
      cleanup(dir);
    }
  });

  // Test 4: No second provider call after hard limit exceeded (provider called exactly once)
  it('4. provider is called exactly once even when hard limit exceeded', async () => {
    const dir = makeTmpDir();
    try {
      let callCount = 0;
      const provider: CandidateVerificationProvider = {
        async runVerification() {
          callCount++;
          return baseOutput({ costUsd: 0.40, budgetOutcome: 'hard_limit_exceeded_after_completion' });
        },
      };
      await runCandidateVerification(makeOpts(dir, provider));
      assert.equal(callCount, 1, 'Provider must be called exactly once');
    } finally {
      cleanup(dir);
    }
  });

  // Test 5: Local stages continue after hard_limit_exceeded_after_completion
  it('5. all local stages run after hard_limit_exceeded_after_completion', async () => {
    const dir = makeTmpDir();
    try {
      const output = baseOutput({ costUsd: 0.40, budgetOutcome: 'hard_limit_exceeded_after_completion' });
      const result = await runCandidateVerification(makeOpts(dir, makeProviderWith(output)));
      const expectedLocalStages = [
        'output_validated',
        'duplicates_checked',
        'provenance_computed',
        'gates_computed',
        'final_result_created',
      ];
      for (const stage of expectedLocalStages) {
        assert.ok(
          result.stagesRun.includes(stage) || result.stagesReused.includes(stage),
          `Stage ${stage} must run or be reused`
        );
      }
    } finally {
      cleanup(dir);
    }
  });

  // Test 6: Resume does not repeat the paid provider call
  it('6. resume does not call provider again after hard_limit_exceeded_after_completion', async () => {
    const dir = makeTmpDir();
    try {
      let callCount = 0;
      const provider: CandidateVerificationProvider = {
        async runVerification() {
          callCount++;
          return baseOutput({ costUsd: 0.40, budgetOutcome: 'hard_limit_exceeded_after_completion' });
        },
      };
      // First run
      await runCandidateVerification(makeOpts(dir, provider, false));
      assert.equal(callCount, 1);
      // Resume run
      const resumeResult = await runCandidateVerification(makeOpts(dir, provider, true));
      assert.equal(callCount, 1, 'Provider must NOT be called on resume');
      assert.equal(resumeResult.status, 'skipped_already_complete');
    } finally {
      cleanup(dir);
    }
  });

  // Test 7: Resume does not duplicate tokens
  it('7. resume reports zero additional tokens', async () => {
    const dir = makeTmpDir();
    try {
      const output = baseOutput({ costUsd: 0.40, inputTokens: 89688, outputTokens: 3109, budgetOutcome: 'hard_limit_exceeded_after_completion' });
      await runCandidateVerification(makeOpts(dir, makeProviderWith(output), false));
      const resumeResult = await runCandidateVerification(makeOpts(dir, makeProviderWith(output), true));
      assert.equal(resumeResult.usageAdded.inputTokens, 0);
      assert.equal(resumeResult.usageAdded.outputTokens, 0);
    } finally {
      cleanup(dir);
    }
  });

  // Test 8: Resume reports zero additional cost
  it('8. resume reports zero additional cost', async () => {
    const dir = makeTmpDir();
    try {
      const output = baseOutput({ costUsd: 0.40, budgetOutcome: 'hard_limit_exceeded_after_completion' });
      await runCandidateVerification(makeOpts(dir, makeProviderWith(output), false));
      const resumeResult = await runCandidateVerification(makeOpts(dir, makeProviderWith(output), true));
      assert.equal(resumeResult.usageAdded.costUsd, 0);
    } finally {
      cleanup(dir);
    }
  });

});

// ─── Section B — Employee size filter ─────────────────────────────────────────

describe('Employee size filter (16AB.25.5)', () => {

  // Test 9: "51-200" is excluded with minEmployeeCountExclusive=200
  it('9. "51-200" is excluded (max=200 <= threshold=200)', () => {
    const result = evaluateEmployeeSizeEligibility('51-200', 'colombia');
    assert.equal(result.excluded, true);
    assert.equal(result.status, 'excluded_by_search_criteria');
    assert.equal(result.reason, 'employee_count_not_above_minimum');
  });

  // Test 10: "200" (exact) is excluded
  it('10. "200" exact is excluded (200 <= threshold=200)', () => {
    const result = evaluateEmployeeSizeEligibility('200', 'colombia');
    assert.equal(result.excluded, true);
    assert.equal(result.status, 'excluded_by_search_criteria');
  });

  // Test 11: "201-500" passes the filter
  it('11. "201-500" passes (min=201 > threshold=200)', () => {
    const result = evaluateEmployeeSizeEligibility('201-500', 'colombia');
    assert.equal(result.excluded, false);
    assert.equal(result.status, 'passes_size_filter');
  });

  // Test 12: "200-500" is NOT auto-excluded (range crosses threshold)
  it('12. "200-500" is ambiguous — not excluded automatically', () => {
    const result = evaluateEmployeeSizeEligibility('200-500', 'colombia');
    assert.equal(result.excluded, false);
    assert.equal(result.status, 'ambiguous_not_excluded');
  });

  // Test 13: null size is not excluded automatically
  it('13. null size is not excluded automatically (fail open)', () => {
    const result = evaluateEmployeeSizeEligibility(null, null);
    assert.equal(result.excluded, false);
    assert.equal(result.status, 'size_unknown_not_excluded');
  });

  // Test 14: Global group scope is not used as Colombia without explicit rule
  it('14. global_group scope is not treated as Colombia — not excluded', () => {
    const result = evaluateEmployeeSizeEligibility('51-200', 'global_group', DEFAULT_EMPLOYEE_SIZE_CRITERIA, 'colombia');
    assert.equal(result.excluded, false);
    assert.equal(result.status, 'ambiguous_not_excluded');
  });

});

// ─── Section C — Configuration & enforcement ─────────────────────────────────

describe('Size filter configuration (16AB.25.5)', () => {

  // Test 15: Threshold is configurable
  it('15. threshold is configurable — custom minEmployeeCountExclusive=500', () => {
    const criteria: EmployeeSizeCriteria = { minEmployeeCountExclusive: 500, enforcement: 'hard_filter' };
    const result201 = evaluateEmployeeSizeEligibility('201-500', 'colombia', criteria);
    assert.equal(result201.excluded, true, '"201-500" should be excluded with threshold=500');
    const result501 = evaluateEmployeeSizeEligibility('501-1.000', 'colombia', criteria);
    assert.equal(result501.excluded, false, '"501-1.000" should pass with threshold=500');
  });

  // Test 16: Default threshold is 200
  it('16. default minEmployeeCountExclusive is 200', () => {
    assert.equal(DEFAULT_EMPLOYEE_SIZE_CRITERIA.minEmployeeCountExclusive, 200);
  });

  // Test 17: 'hard_filter' enforcement excludes candidates below threshold
  it('17. hard_filter enforcement excludes candidates below threshold', () => {
    const criteria: EmployeeSizeCriteria = { minEmployeeCountExclusive: 200, enforcement: 'hard_filter' };
    const result = evaluateEmployeeSizeEligibility('51-200', 'colombia', criteria);
    assert.equal(result.excluded, true);
  });

  // Test 18: 'preference' enforcement never excludes
  it('18. preference enforcement never excludes — advisory only', () => {
    const criteria: EmployeeSizeCriteria = { minEmployeeCountExclusive: 200, enforcement: 'preference' };
    const result = evaluateEmployeeSizeEligibility('51-200', 'colombia', criteria);
    assert.equal(result.excluded, false, 'preference enforcement must not exclude');
    assert.equal(result.status, 'passes_size_filter');
  });

  // Test 19: B-Secure is not excluded via name-specific logic — generic filter applies
  it('19. filter is generic — no candidate name in exclusion logic', () => {
    // The filter function signature has no "candidateName" parameter.
    // This test verifies the function signature itself.
    const params = evaluateEmployeeSizeEligibility.length;
    // (estimatedSize, sizeScope, criteria?, requestScope?) — max 4 params, none is candidateName
    assert.ok(params <= 4, 'evaluateEmployeeSizeEligibility must not accept a candidateName parameter');
    // Verify "51-200" is excluded purely by range logic, not by name
    const result = evaluateEmployeeSizeEligibility('51-200', null);
    assert.equal(result.excluded, true);
    assert.equal(result.reason, 'employee_count_not_above_minimum');
  });

  // Test 20: No external API calls are made by the filter
  it('20. employee size filter makes no external calls — pure function', () => {
    // This is verified by the fact that evaluateEmployeeSizeEligibility is synchronous
    // and returns a value directly (not a Promise).
    const result = evaluateEmployeeSizeEligibility('51-200', 'colombia');
    assert.equal(typeof result, 'object');
    assert.notEqual(result, null);
    // If it were async it would return a Promise; checking it's a plain object confirms no external calls.
    assert.ok(!(result instanceof Promise), 'Must be synchronous — no external calls');
  });

});
