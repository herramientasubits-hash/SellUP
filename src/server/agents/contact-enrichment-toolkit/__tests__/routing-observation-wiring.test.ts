/**
 * Tests — Observe-Only Routing Policy Wiring (Agente 2A, Hito 17B.4X.7C.4C)
 *
 * Pure wiring layer over the closed 17B.4X.7A evaluator. Verifies: Apollo
 * success never recommends fallback; zero reviewable / provider_error do;
 * a manual Lusha run is never treated as "the policy's primary"; a branch
 * where no real provider call happened produces no observation at all
 * (routing_mode stays 'manual' via migration 091 defaults); and the
 * evaluator is deterministic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoutingObservation,
  CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION,
  type RoutingObservationWiringInput,
} from '../routing-observation-wiring';

function baseInput(
  overrides: Partial<RoutingObservationWiringInput> = {},
): RoutingObservationWiringInput {
  return {
    actualProvider: 'apollo',
    attemptOrder: 1,
    providerCallAttempted: true,
    technicalOutcome: 'technical_success',
    reviewableCandidateCount: 3,
    evaluatedAt: '2026-07-15T00:00:00.000Z',
    evidence: {
      runStatus: 'ready_for_review',
      insertedCandidatesCount: 3,
      duplicatesSkippedCount: 0,
      providerErrorPresent: false,
    },
    ...overrides,
  };
}

describe('buildRoutingObservation', () => {
  it('A — Apollo success with reviewable candidates: no fallback recommended', () => {
    const result = buildRoutingObservation(baseInput());
    assert.ok(result);
    assert.equal(result.runColumns.routing_mode, 'observed');
    assert.equal(result.runColumns.provider_attempt_role, 'manual');
    assert.equal(result.runColumns.fallback_reason, 'not_applicable');
    assert.equal(
      result.runColumns.routing_policy_version,
      CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION,
    );
    assert.equal(result.summaryBlock.would_recommend_fallback, false);
    assert.equal(result.summaryBlock.fallback_executed, false);
    assert.equal(result.summaryBlock.automatic_routing_enabled, false);
    assert.equal(result.summaryBlock.actual_provider_was_policy_primary, true);
    assert.equal(result.summaryBlock.primary_provider, 'apollo');
    assert.equal(result.summaryBlock.fallback_provider, 'lusha');
  });

  it('B — Apollo success with zero reviewable candidates: fallback recommended, not executed', () => {
    const result = buildRoutingObservation(
      baseInput({
        reviewableCandidateCount: 0,
        evidence: {
          runStatus: 'completed',
          insertedCandidatesCount: 0,
          duplicatesSkippedCount: 0,
          providerErrorPresent: false,
        },
      }),
    );
    assert.ok(result);
    assert.equal(result.runColumns.fallback_reason, 'zero_reviewable_candidates');
    assert.equal(result.summaryBlock.would_recommend_fallback, true);
    assert.equal(result.summaryBlock.fallback_executed, false);
    assert.equal(result.summaryBlock.automatic_routing_enabled, false);
  });

  it('B2 — Apollo success with zero reviewable candidates caused entirely by duplicates: still zero_reviewable_candidates (no only_duplicates signal in V1)', () => {
    // Documents the chosen behavior for "only duplicates" (§ 6/§ 9D of the
    // hito prompt): the pure 17B.4X.7A evaluator has no separate
    // only_duplicates reason type, so a run where every actionable contact
    // was an existing duplicate is observed identically to any other
    // zero-reviewable outcome. Not implemented as its own V1 trigger.
    const result = buildRoutingObservation(
      baseInput({
        reviewableCandidateCount: 0,
        evidence: {
          runStatus: 'completed',
          insertedCandidatesCount: 0,
          duplicatesSkippedCount: 4,
          providerErrorPresent: false,
        },
      }),
    );
    assert.ok(result);
    assert.equal(result.runColumns.fallback_reason, 'zero_reviewable_candidates');
    assert.equal(result.summaryBlock.evidence.duplicates_skipped_count, 4);
    assert.equal(result.summaryBlock.evidence.run_status, 'completed');
    assert.equal(result.summaryBlock.evidence.inserted_candidates_count, 0);
    assert.equal(result.summaryBlock.evidence.provider_error_present, false);
  });

  it('C — Apollo provider error (real call attempted): fallback recommended, not executed', () => {
    const result = buildRoutingObservation(
      baseInput({
        technicalOutcome: 'technical_failure',
        reviewableCandidateCount: 0,
        evidence: {
          runStatus: 'failed',
          insertedCandidatesCount: 0,
          duplicatesSkippedCount: 0,
          providerErrorPresent: true,
        },
      }),
    );
    assert.ok(result);
    assert.equal(result.runColumns.fallback_reason, 'provider_error');
    assert.equal(result.summaryBlock.would_recommend_fallback, true);
    assert.equal(result.summaryBlock.fallback_executed, false);
  });

  it('E — manual Lusha run (success): actual provider is not the policy primary, no fallback recommended', () => {
    const result = buildRoutingObservation(
      baseInput({
        actualProvider: 'lusha',
        reviewableCandidateCount: 1,
        evidence: {
          runStatus: 'ready_for_review',
          insertedCandidatesCount: 1,
          duplicatesSkippedCount: 0,
          providerErrorPresent: false,
        },
      }),
    );
    assert.ok(result);
    assert.equal(result.summaryBlock.actual_provider, 'lusha');
    assert.equal(result.summaryBlock.primary_provider, 'apollo');
    assert.equal(result.summaryBlock.actual_provider_was_policy_primary, false);
    assert.equal(result.summaryBlock.provider_attempt_role, 'manual');
    assert.equal(result.runColumns.fallback_reason, 'not_applicable');
    assert.equal(result.summaryBlock.would_recommend_fallback, false);
    assert.equal(result.summaryBlock.fallback_executed, false);
  });

  it('E2 — manual Lusha run that technically failed: still no policy fallback (Lusha was never the policy primary)', () => {
    const result = buildRoutingObservation(
      baseInput({
        actualProvider: 'lusha',
        technicalOutcome: 'technical_failure',
        reviewableCandidateCount: 0,
        evidence: {
          runStatus: 'failed',
          insertedCandidatesCount: 0,
          duplicatesSkippedCount: 0,
          providerErrorPresent: true,
        },
      }),
    );
    assert.ok(result);
    // A signal exists (provider_error) but the policy never executed Lusha
    // as its primary — a fallback FROM a non-primary attempt is never a
    // policy recommendation (17B.4X.7A § 12/§ 17 counterfactual safety).
    assert.equal(result.summaryBlock.would_recommend_fallback, false);
    assert.equal(result.runColumns.fallback_reason, 'not_applicable');
    assert.equal(result.summaryBlock.actual_provider_was_policy_primary, false);
  });

  it('F — no real provider call attempted (missing credentials / insufficient data / disabled): no observation produced', () => {
    const result = buildRoutingObservation(baseInput({ providerCallAttempted: false }));
    assert.equal(result, null);
  });

  it('F2 — no observation means routing stays at migration 091 manual defaults (nothing to merge into the run patch)', () => {
    // Caller pattern used by both runners: `...(observation ? observation.runColumns : {})`
    // — null collapses to an empty spread, so routing_mode/provider_attempt_role/
    // fallback_reason/routing_policy_version are never present in the patch.
    const observation = buildRoutingObservation(baseInput({ providerCallAttempted: false }));
    const patch: Record<string, unknown> = {
      status: 'failed',
      ...(observation ? observation.runColumns : {}),
    };
    assert.deepStrictEqual(patch, { status: 'failed' });
  });

  it('G — deterministic: identical input twice deep-equals', () => {
    const input = baseInput({ technicalOutcome: 'technical_failure', reviewableCandidateCount: 0 });
    const first = buildRoutingObservation({ ...input });
    const second = buildRoutingObservation({ ...input });
    assert.deepStrictEqual(first, second);
  });

  it('never sets fallback_executed or automatic_routing_enabled to true, across every branch', () => {
    const scenarios: RoutingObservationWiringInput[] = [
      baseInput(),
      baseInput({ reviewableCandidateCount: 0 }),
      baseInput({ technicalOutcome: 'technical_failure', reviewableCandidateCount: 0 }),
      baseInput({ actualProvider: 'lusha' }),
      baseInput({ technicalOutcome: 'technical_unknown', reviewableCandidateCount: 0 }),
    ];
    for (const scenario of scenarios) {
      const result = buildRoutingObservation(scenario);
      assert.ok(result);
      assert.equal(result.summaryBlock.fallback_executed, false);
      assert.equal(result.summaryBlock.automatic_routing_enabled, false);
    }
  });
});
