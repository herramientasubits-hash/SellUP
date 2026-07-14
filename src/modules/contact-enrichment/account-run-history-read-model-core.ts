// Agente 2A — Account Agents Tab: Contact Enrichment Run History (Hito 17B.4X.7C.3E.3)
//
// Pure loader for the account "Agentes" tab: lists contact_enrichment_runs
// scoped to account_id plus candidate/provider-usage summaries. No
// Supabase, no network — persistence is injected (mirrors
// run-viewer-read-model-core.ts's DI shape). This core MUST NOT call
// Apollo/Lusha, MUST NOT filter runs by a global pending_review scope, and
// MUST NOT mutate anything — every function here is a read.

import { mapRunDetailRow } from './run-viewer-read-model-core';
import type { ContactEnrichmentRunDetail } from './run-viewer-types';
import type { AccountContactEnrichmentRun } from './account-run-history-types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidAccountIdForRunHistory(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
}

interface CandidateCountAccumulator {
  total: number;
  pendingReview: number;
  approved: number;
}

/** Groups contact_enrichment_candidates rows by enrichment_run_id, counting
 *  totals and the pending_review/approved subsets. */
function accumulateCandidateCounts(rows: unknown[]): Map<string, CandidateCountAccumulator> {
  const byRun = new Map<string, CandidateCountAccumulator>();
  for (const row of rows) {
    const r = asRecord(row);
    const runId = r.enrichment_run_id as string | undefined;
    if (!runId) continue;

    const acc = byRun.get(runId) ?? { total: 0, pendingReview: 0, approved: 0 };
    acc.total += 1;
    if (r.status === 'pending_review') acc.pendingReview += 1;
    if (r.status === 'approved') acc.approved += 1;
    byRun.set(runId, acc);
  }
  return byRun;
}

interface UsageSummaryAccumulator {
  totalCredits: number | null;
  statuses: Set<string>;
}

/** Groups provider_usage_logs rows by agent_run_id, summing credits_used
 *  and collecting distinct statuses. */
function accumulateProviderUsage(rows: unknown[]): Map<string, UsageSummaryAccumulator> {
  const byAgentRun = new Map<string, UsageSummaryAccumulator>();
  for (const row of rows) {
    const r = asRecord(row);
    const agentRunId = r.agent_run_id as string | undefined;
    if (!agentRunId) continue;

    const acc = byAgentRun.get(agentRunId) ?? { totalCredits: null, statuses: new Set<string>() };
    if (r.credits_used != null) {
      acc.totalCredits = (acc.totalCredits ?? 0) + Number(r.credits_used);
    }
    if (typeof r.status === 'string') acc.statuses.add(r.status);
    byAgentRun.set(agentRunId, acc);
  }
  return byAgentRun;
}

export interface LoadContactEnrichmentRunsByAccountIdDeps {
  fetchRunRows: (accountId: string) => Promise<unknown[]>;
  fetchCandidateCountRows: (runIds: string[]) => Promise<unknown[]>;
  fetchProviderUsageSummaryRows: (agentRunIds: string[]) => Promise<unknown[]>;
}

/** Runs scoped to `account_id = accountId`, in the order the caller's query
 *  already produced (the action wires `.order('created_at', {ascending:
 *  false})`), each enriched with candidate counts and provider_usage_logs
 *  summaries. Returns [] for an invalid UUID or an account with no runs —
 *  both are valid, non-error states. Never calls a provider, never mutates. */
export async function loadContactEnrichmentRunsByAccountId(
  accountId: string,
  deps: LoadContactEnrichmentRunsByAccountIdDeps,
): Promise<AccountContactEnrichmentRun[]> {
  if (!isValidAccountIdForRunHistory(accountId)) return [];

  const runRows = await deps.fetchRunRows(accountId.trim());
  if (runRows.length === 0) return [];

  const runs: ContactEnrichmentRunDetail[] = runRows.map(mapRunDetailRow);
  const runIds = runs.map((r) => r.id);
  const agentRunIds = [
    ...new Set(runs.map((r) => r.agentRunId).filter((id): id is string => id != null)),
  ];

  const [candidateRows, usageRows] = await Promise.all([
    runIds.length > 0 ? deps.fetchCandidateCountRows(runIds) : Promise.resolve([]),
    agentRunIds.length > 0 ? deps.fetchProviderUsageSummaryRows(agentRunIds) : Promise.resolve([]),
  ]);

  const candidateCounts = accumulateCandidateCounts(candidateRows);
  const usageSummaries = accumulateProviderUsage(usageRows);

  return runs.map((run) => {
    const candidateAcc = candidateCounts.get(run.id) ?? { total: 0, pendingReview: 0, approved: 0 };
    const usageAcc = run.agentRunId ? usageSummaries.get(run.agentRunId) : undefined;

    return {
      id: run.id,
      accountId: run.accountId ?? accountId.trim(),
      status: run.status,
      companyName: run.companyName,
      companyDomain: run.companyDomain,
      companyCountryCode: run.companyCountryCode,
      intendedProvider: run.intendedProvider,
      providersUsed: run.providersUsed,
      attemptOrder: run.attemptOrder,
      estimatedCostUsd: run.estimatedCostUsd,
      realCostUsd: run.realCostUsd,
      agentRunId: run.agentRunId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      candidateCount: candidateAcc.total,
      pendingReviewCount: candidateAcc.pendingReview,
      approvedCount: candidateAcc.approved,
      totalCreditsUsed: usageAcc?.totalCredits ?? null,
      providerUsageStatuses: usageAcc ? [...usageAcc.statuses] : [],
    };
  });
}
