// Agente 2A — Account Agents Tab: Contact Enrichment Run History (Hito 17B.4X.7C.3E.3)
//
// Read-only projection of contact_enrichment_runs scoped to a single
// account, enriched with candidate counts and provider_usage_logs
// credit/status summaries. No payloads beyond what a human reviewer needs
// on the account's "Agentes" tab — no provider execution, no phone numbers.

import type { ContactEnrichmentRunStatus } from './types';
import type { IntendedProvider } from './request-attempt-types';

export interface AccountContactEnrichmentRun {
  id: string;
  accountId: string;
  status: ContactEnrichmentRunStatus;
  companyName: string;
  companyDomain: string | null;
  companyCountryCode: string | null;
  intendedProvider: IntendedProvider | null;
  providersUsed: string[];
  attemptOrder: number | null;
  estimatedCostUsd: number;
  realCostUsd: number | null;
  agentRunId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Total contact_enrichment_candidates rows for this run, any status. */
  candidateCount: number;
  /** Subset still awaiting human review (status = 'pending_review'). */
  pendingReviewCount: number;
  /** Subset already turned into an official contact (status = 'approved'). */
  approvedCount: number;
  /** Sum of provider_usage_logs.credits_used for this run's agent_run_id — null when there are no usage rows to sum. */
  totalCreditsUsed: number | null;
  /** Distinct provider_usage_logs.status values recorded for this run's agent_run_id. */
  providerUsageStatuses: string[];
}
