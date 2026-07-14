// Pure — classifies a Lusha runner outcome (ok, status) into the UI-facing
// success/providerStatus/error contract. No React, no network.
//
// Hito 17B.4X.7C.3D — extracted because `no_reviewable_candidate` (the
// provider executed correctly but every raw result was filtered out by
// relevance/company-consistency checks) was being folded into the same
// bucket as `missing_api_key`/`provider_error`, which made the UI claim
// Lusha was unavailable when it had, in fact, run successfully.

import type { LushaRunnerStatus } from '@/server/agents/contact-enrichment-toolkit/lusha-enrichment-runner';

export interface LushaRunOutcomeInput {
  ok: boolean;
  status: LushaRunnerStatus;
  message: string;
}

export interface LushaRunOutcomeClassification {
  success: boolean;
  providerStatus: 'success' | 'skipped' | 'error';
  error: string | undefined;
}

export function classifyLushaRunOutcome(
  input: LushaRunOutcomeInput,
): LushaRunOutcomeClassification {
  // The provider call executed successfully whenever the runner reports ok,
  // OR when it ran fine but filtered every candidate out post-execution
  // (`no_reviewable_candidate`). That is a business-logic empty result, not
  // a technical failure, and must never be reported as unavailable/error.
  const executedSuccessfully = input.ok || input.status === 'no_reviewable_candidate';

  const providerStatus: 'success' | 'skipped' | 'error' = executedSuccessfully
    ? 'success'
    : input.status === 'disabled' || input.status === 'missing_api_key'
      ? 'skipped'
      : 'error';

  return {
    success: executedSuccessfully,
    providerStatus,
    error: executedSuccessfully ? undefined : input.message,
  };
}
