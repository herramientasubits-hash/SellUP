// Agente 2A — Bulk Enrichment Types
// Hito 17A.10B — Backend base: modelo bulk + eligibility checker

export const CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS = 10 as const;

export type ContactEnrichmentBulkStatus =
  | 'created'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export type BulkEnrichmentSkipReason =
  | 'enrichment_in_progress'
  | 'already_ready_for_review'
  | 'pending_candidates_exist'
  | 'missing_country_code'
  | 'insufficient_company_data';

export interface BulkEnrichmentEligibleAccount {
  accountId: string;
  name: string;
  domain: string | null;
  countryCode: string;
}

export interface BulkEnrichmentSkippedAccount {
  accountId: string;
  name: string | null;
  reason: BulkEnrichmentSkipReason;
}

export interface BulkEnrichmentEligibilityResult {
  selectedCount: number;
  eligible: BulkEnrichmentEligibleAccount[];
  skipped: BulkEnrichmentSkippedAccount[];
  estimatedApolloCredits: number;
}
