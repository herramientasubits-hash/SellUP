// Agente 2A — Contact Enrichment Types
// Hito 17A.2A — Snapshot de contactos existentes

// Type-only import (borrado en compilación): el contrato de evidencia de
// identidad vive junto a su lógica pura en el toolkit del servidor. No
// arrastra código de servidor al bundle del cliente.
import type { LushaPersonIdentityEvidenceV1 } from '@/server/agents/contact-enrichment-toolkit/lusha-person-identity-evidence';
import type { ApolloPersonIdentityObservationV1 } from '@/server/agents/contact-enrichment-toolkit/apollo-person-identity-observation';

export type { LushaPersonIdentityEvidenceV1, ApolloPersonIdentityObservationV1 };

export type ContactEnrichmentRunStatus =
  | 'pending'
  | 'resolving'
  | 'ready_to_enrich'
  | 'enriching'
  | 'ready_for_review'
  | 'completed'
  | 'failed'
  | 'superseded';

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

// ── Company consistency metadata (Hito 17A.9G) ──────────────────

export type CompanyConsistencyStatus =
  | 'match'
  | 'possible_mismatch'
  | 'possible_related_domain'
  | 'unknown';

export interface ContactCandidateCompanyConsistency {
  status: CompanyConsistencyStatus;
  email_domain: string | null;
  expected_domain: string | null;
  organization_name: string | null;
  organization_domain: string | null;
  signals: string[];
  review_required: boolean;
  explanation: string;
}

export interface ContactCandidateEnrichmentMetadata {
  relevance?: ContactCandidateRelevanceMetadata;
  apollo_search_attempt?: string | null;
  company_consistency?: ContactCandidateCompanyConsistency | null;
  /**
   * Evidencia de consistencia de identidad de persona para candidatos Lusha
   * company-first (17B.4W.6). Ausente en candidatos legacy previos al hito.
   */
  person_identity?: LushaPersonIdentityEvidenceV1 | null;
  /**
   * Observación (no bloqueante) de identidad de persona search→match para
   * candidatos Apollo (17B.4X.3). Modo OBSERVATION_FIRST: no participa en el
   * gate de identidad de aprobación, que solo lee `person_identity`.
   */
  apollo_person_identity_observation?: ApolloPersonIdentityObservationV1 | null;
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
  enrichment_run_id: string | null;
  created_at: string;
  // Contexto de empresa (desde el run que originó al candidato)
  company_name: string | null;
  company_domain: string | null;
  account_id: string | null;
  hubspot_company_id: string | null;
}
