// Agente 2A — Automatic Routing Request Action: Core (Hito 17B.4X.7C.5C)
//
// Pure, DI-testable core for the new dark automatic-routing action. Adds
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
  };
}

/**
 * Single core entry point for the automatic-routing request action. No
 * caller in this codebase invokes this yet — see automatic-routing-
 * actions.ts's module header. With the automatic-routing flag off (the
 * production default, verified by the orchestrator's own first check),
 * `deps` is never exercised beyond `getConfig`: no attempt is created, no
 * provider is called, no telemetry is written.
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
  };
}
