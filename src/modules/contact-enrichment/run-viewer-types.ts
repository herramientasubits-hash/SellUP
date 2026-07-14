// Agente 2A — Read-only Contact Enrichment Run Viewer (Hito 17B.4X.7C.3E.2)
//
// Types for viewing a single historical contact_enrichment_runs row plus its
// candidates and provider_usage_logs. Read-only projection — no payloads
// beyond what a human reviewer needs, no provider execution.

import type {
  ContactCandidateEnrichmentMetadata,
  ContactCandidateStatus,
  ContactDuplicateStatus,
  ContactEnrichmentRunStatus,
  ContactSource,
} from './types';
import type { IntendedProvider } from './request-attempt-types';

export interface ContactEnrichmentRunDetail {
  id: string;
  status: ContactEnrichmentRunStatus;
  companyName: string;
  companyDomain: string | null;
  companyCountryCode: string | null;
  hubspotCompanyId: string | null;
  accountId: string | null;
  agentRunId: string | null;
  requestId: string | null;
  attemptOrder: number | null;
  intendedProvider: IntendedProvider | null;
  providersUsed: string[];
  estimatedCostUsd: number;
  realCostUsd: number | null;
  /** Error reason recorded by the runner when no provider call was ever
   *  attempted (e.g. 'missing_api_key', 'invalid_account'). Only present on
   *  failed runs — never used to imply a failure on a successful run. */
  summaryError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Candidate row scoped to a single run — deliberately not the same type as
 * `PendingContactCandidate` (types.ts): that projection is named for the
 * pending-review list and always carries run-level company context inline.
 * Here the run is already known by the caller, and status is NOT filtered
 * to pending_review (a historical run may have approved/discarded/duplicate
 * candidates, or none at all).
 */
export interface ContactEnrichmentRunCandidate {
  id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  phone: string | null;
  source: ContactSource;
  status: ContactCandidateStatus;
  duplicate_status: ContactDuplicateStatus;
  confidence: number;
  enrichment_metadata: ContactCandidateEnrichmentMetadata;
  created_at: string;
}

export interface ContactEnrichmentRunProviderUsage {
  providerKey: string;
  operationKey: string;
  status: 'success' | 'error' | 'rate_limited' | 'quota_exceeded';
  creditsUsed: number | null;
  resultsReturned: number;
  /** From metadata.raw_results when the runner recorded it — null otherwise. */
  rawResultsCount: number | null;
  /** From metadata.phone_reveal_enabled when the runner recorded it. */
  phoneRevealEnabled: boolean | null;
  errorMessage: string | null;
  createdAt: string;
}
