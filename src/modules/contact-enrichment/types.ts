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

// ── Candidatos por revisar (Hito 17A.4A) ────────────────────────
// Veredicto de relevancia/calidad escrito por el filtro 17A.3B dentro de
// `contact_enrichment_candidates.enrichment_metadata.relevance`. Espejo del
// shape producido por `relevanceMetadata()` en apollo-enrichment-runner.ts.

export type ContactRelevanceStatus =
  | 'high_relevance'
  | 'medium_relevance'
  | 'low_relevance'
  | 'not_relevant'
  | 'insufficient_data';

export interface ContactCandidateRelevanceMetadata {
  status?: ContactRelevanceStatus;
  score?: number;
  quality_score?: number;
  matched_keywords?: string[];
  matched_category?: string | null;
  rejection_reasons?: string[];
}

export interface ContactCandidateEnrichmentMetadata {
  relevance?: ContactCandidateRelevanceMetadata;
  apollo_search_attempt?: string | null;
  [key: string]: unknown;
}

/**
 * Candidato en staging listo para revisión humana, con el contexto de empresa
 * resuelto desde `contact_enrichment_runs`. Es una proyección de solo lectura:
 * no incluye payloads crudos del proveedor. Aprobar/rechazar llega en 17A.4B.
 */
export interface PendingContactCandidate {
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
  // Contexto de empresa (desde el run que originó al candidato)
  company_name: string | null;
  company_domain: string | null;
  account_id: string | null;
  hubspot_company_id: string | null;
}
