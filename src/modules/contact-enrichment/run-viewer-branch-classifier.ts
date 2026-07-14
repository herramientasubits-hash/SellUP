// Agente 2A — Read-only Contact Enrichment Run Viewer (Hito 17B.4X.7C.3E.2)
//
// Pure classifier for how to render a historical Lusha attempt. Mirrors the
// production branch selection in RunResultSnapshot
// (contact-enrichment-chat-result.tsx, validated by
// lusha-empty-vs-unavailable-branch-17b4x7c3d.test.ts), adapted to read from
// persisted contact_enrichment_runs / provider_usage_logs rows instead of
// the live wizard's in-memory LushaEnrichmentUiResult.
//
// contact_enrichment_runs.status alone cannot distinguish "no provider call
// was ever attempted" (missing_api_key, invalid_account — the runner
// returns before calling Lusha) from "the call was attempted and Lusha
// returned an error" (provider_error) — both leave status='failed'. The
// signal is whether a provider_usage_logs row exists for that provider on
// this run's agent_run_id: no-call paths never write one; a real API
// failure always does (status='error'). See lusha-enrichment-runner.ts.
//
// No Supabase, no network — pure decision logic over already-loaded data.

import type { ContactEnrichmentRunDetail, ContactEnrichmentRunProviderUsage } from './run-viewer-types';

export type LushaRunViewerBranch =
  | 'not_lusha'
  | 'credentials_missing'
  | 'company_context_error'
  | 'provider_error'
  | 'empty_after_filtering'
  | 'has_candidates'
  | 'not_yet_executed';

export interface ClassifyLushaRunViewerInput {
  run: Pick<ContactEnrichmentRunDetail, 'intendedProvider' | 'status' | 'summaryError'>;
  /** provider_usage_logs rows for provider_key='lusha' on this run's agent_run_id. */
  lushaUsageRows: ContactEnrichmentRunProviderUsage[];
  candidatesCount: number;
}

const CREDENTIALS_MISSING_REASONS = new Set(['missing_api_key']);
const COMPANY_CONTEXT_ERROR_REASONS = new Set(['invalid_account', 'account_not_found', 'not_found']);

export function classifyLushaRunViewerBranch({
  run,
  lushaUsageRows,
  candidatesCount,
}: ClassifyLushaRunViewerInput): LushaRunViewerBranch {
  if (run.intendedProvider !== 'lusha') return 'not_lusha';

  const latestUsage = lushaUsageRows.at(-1) ?? null;

  if (run.status === 'failed') {
    // A logged usage row always wins: the API call happened and failed for
    // a real technical reason, regardless of what summary.error says.
    if (latestUsage && latestUsage.status === 'error') return 'provider_error';

    if (run.summaryError && CREDENTIALS_MISSING_REASONS.has(run.summaryError)) {
      return 'credentials_missing';
    }
    if (run.summaryError && COMPANY_CONTEXT_ERROR_REASONS.has(run.summaryError)) {
      return 'company_context_error';
    }

    // Failed with no distinguishing signal — never default to the
    // credentials-missing message (Hito 17B.4X.7C.3D's exact regression:
    // an unrelated failure must not be misreported as "no credentials").
    return 'provider_error';
  }

  if (latestUsage && latestUsage.status === 'success') {
    return candidatesCount === 0 ? 'empty_after_filtering' : 'has_candidates';
  }

  return 'not_yet_executed';
}
