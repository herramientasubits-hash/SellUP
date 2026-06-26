// Agente 2A — Contact Enrichment Types
// Hito 17A.2A — Snapshot de contactos existentes

export type ContactEnrichmentRunStatus =
  | 'pending'
  | 'resolving'
  | 'ready_to_enrich'
  | 'enriching'
  | 'ready_for_review'
  | 'completed'
  | 'failed';

export type ContactCandidateStatus =
  | 'pending_review'
  | 'approved'
  | 'discarded'
  | 'duplicate';

export type ContactDuplicateStatus =
  | 'unchecked'
  | 'no_match'
  | 'possible_duplicate'
  | 'exact_duplicate';

export type ContactSource = 'apollo' | 'lusha' | 'hubspot' | 'manual' | 'mock';

export type ContactSeniority =
  | 'c_level'
  | 'vp'
  | 'director'
  | 'manager'
  | 'individual_contributor'
  | 'unknown';

export interface Agent2AInput {
  companyName?: string;
  companyDomain?: string;
  companyCountryCode?: string;
  hubspotCompanyId?: string;
  sellupAccountId?: string;
  linkedinCompanyUrl?: string;
  targetDepartments?: string[];
  targetSeniorities?: ContactSeniority[];
}

export interface CompanyCandidate {
  source: 'sellup' | 'hubspot' | 'manual';
  sellupAccountId?: string;
  hubspotCompanyId?: string;
  name: string;
  domain?: string | null;
  country?: string | null;
  countryCode?: string | null;
  linkedinUrl?: string | null;
  matchConfidence: number;
}

export interface CompanyResolutionResult {
  resolved: boolean;
  singleMatch: boolean;
  candidates: CompanyCandidate[];
  selected?: CompanyCandidate;
  skippedHubSpot: boolean;
  error?: string;
}

export interface ContactEnrichmentProviderResult {
  providerKey: 'apollo' | 'lusha' | 'hubspot' | 'mock';
  success: boolean;
  candidatesReturned: number;
  estimatedCostUsd: number;
  durationMs: number;
  error?: string;
  creditsUsed?: number;
}

export interface ContactEnrichmentSummary {
  totalCandidates: number;
  newCandidates: number;
  alreadyInHubSpot: number;
  possibleDuplicates: number;
  approved: number;
  discarded: number;
  providerResults: ContactEnrichmentProviderResult[];
  totalEstimatedCostUsd: number;
}

// ── Snapshot de contactos existentes (Hito 17A.2A) ──────────────

export interface ExistingContactSnapshot {
  id?: string;
  source: 'sellup' | 'hubspot';
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  title?: string | null;
  completeness: {
    hasEmail: boolean;
    hasPhone: boolean;
    hasLinkedin: boolean;
  };
}

export interface ExistingContactsSourceResult {
  status: 'success' | 'skipped' | 'error';
  contacts: ExistingContactSnapshot[];
  count: number;
  reason?: string;
}

export interface ExistingContactsCombined {
  totalExistingContacts: number;
  existingContactNames: string[];
  existingEmails: string[];
  existingLinkedinUrls: string[];
  incompleteContacts: {
    missingEmail: number;
    missingPhone: number;
    missingLinkedin: number;
  };
  sourceCounts: {
    sellup: number;
    hubspot: number;
  };
}

export interface ExistingContactsSnapshotResult {
  sellup: ExistingContactsSourceResult;
  hubspot: ExistingContactsSourceResult;
  combined: ExistingContactsCombined;
}

// Resultado del runner (Hito 17A.2A — con snapshot de contactos existentes)
export interface ContactEnrichmentRunResult {
  runId: string;
  agentRunId: string;
  status: 'ready_to_enrich';
  candidatesCount: 0;
  existingContactsSnapshot?: ExistingContactsSnapshotResult;
}
