// Agente 2A — Automatic Routing Request Action: Core (Hito 17B.4X.7C.5C)
//
// Pure, DI-testable core for the automatic-routing action. Adds
// nothing but input validation and action-result mapping on top of
// runAutomaticContactEnrichmentFallbackForRequest (17B.4X.7C.5B) — the flag
// check, attempt creation, and provider coordination all live in the
// orchestrator, unchanged. Kept separate from automatic-routing-actions.ts
// (the 'use server' wrapper) so it can be tested without Supabase
// auth/cookies, mirroring candidate-review-core.ts / request-attempt-
// resolution-core.ts in this same module.

import {
  runAutomaticContactEnrichmentFallbackForRequest,
  type AutomaticRoutingOrchestratorDeps,
  type AutomaticRoutingOrchestratorResult,
} from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-routing-orchestrator';

export type RunAutomaticContactEnrichmentForRequestStatus =
  | AutomaticRoutingOrchestratorResult['outcome']
  | 'invalid_request_id';

export interface RunAutomaticContactEnrichmentForRequestResult {
  success: boolean;
  status: RunAutomaticContactEnrichmentForRequestStatus;
  automaticRoutingEnabled: boolean;
  fallbackExecuted: boolean;
  attempt1AttemptId: string | null;
  attempt2AttemptId: string | null;
  blockedReason: string | null;
  /**
   * AGENT2A-LUSHA-LOCAL-REUSE-GATE-1 — count of already-existing actionable
   * pending_review Lusha candidates that made the provider fallback
   * unnecessary. >= 1 only when status is 'fallback_skipped_local_reuse'; 0 on
   * every other branch, including 'invalid_request_id'.
   *
   * Kept strictly separate from any created-candidate count: this milestone
   * does NOT introduce a combined effective-reviewable-count concept, because
   * the reuse branch terminates before attempt #2 and there is no second
   * fallback decision downstream that would need one.
   */
  reusedExistingCandidates: number;
}

function invalidRequestIdResult(): RunAutomaticContactEnrichmentForRequestResult {
  return {
    success: false,
    status: 'invalid_request_id',
    automaticRoutingEnabled: false,
    fallbackExecuted: false,
    attempt1AttemptId: null,
    attempt2AttemptId: null,
    blockedReason: 'invalid_request_id',
    reusedExistingCandidates: 0,
  };
}

/**
 * Single core entry point for the automatic-routing request action. This is
 * LIVE: the contact-enrichment wizard CTA reaches it through
 * automatic-routing-actions.ts (AGENT2-ROUTING-WIRE-1). With the
 * automatic-routing flag off (the production default, verified by the
 * orchestrator's own first check), `deps` is never exercised beyond
 * `getConfig`: no attempt is created, no provider is called, no telemetry is
 * written.
 */
export async function runAutomaticContactEnrichmentForRequestCore(
  requestId: unknown,
  triggeredBy: string,
  evaluatedAt: string,
  deps: AutomaticRoutingOrchestratorDeps = {},
): Promise<RunAutomaticContactEnrichmentForRequestResult> {
  if (typeof requestId !== 'string' || !requestId.trim()) {
    return invalidRequestIdResult();
  }

  const result = await runAutomaticContactEnrichmentFallbackForRequest(
    { requestId: requestId.trim(), triggeredBy, evaluatedAt },
    deps,
  );

  return {
    success: true,
    status: result.outcome,
    automaticRoutingEnabled: result.automaticRoutingEnabled,
    fallbackExecuted: result.fallbackExecuted,
    attempt1AttemptId: result.attempt1?.attemptId ?? null,
    attempt2AttemptId: result.attempt2?.attemptId ?? null,
    blockedReason: result.blockedReason,
    reusedExistingCandidates: result.reusedExistingCandidates,
  };
}
