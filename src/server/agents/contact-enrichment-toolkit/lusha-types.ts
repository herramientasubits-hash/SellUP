/**
 * Lusha Types — Agente 2A · Hito 17B.3
 *
 * Tipos base para el provider Lusha. En v1 phone reveal está hardcoded false.
 * NormalizedLushaContact.phone es siempre null — nunca se persiste teléfono.
 */

export type LushaProviderStatus =
  | 'success'
  | 'no_results'
  | 'error'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'feature_unavailable'
  | 'compliance_blocked'
  | 'provider_timeout';

export type LushaRawDecisionMaker = {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  name?: string | null;
  title?: string | null;
  jobTitle?: string | null;
  email?: string | null;
  /** Phone intentionally ignored in v1. Never persist. */
  phone?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  country?: string | null;
  raw?: unknown;
};

export type NormalizedLushaContact = {
  provider: 'lusha';
  providerPersonId: string | null;
  fullName: string | null;
  title: string | null;
  email: string | null;
  /** Always null in v1. Phone reveal is disabled. */
  phone: null;
  linkedinUrl: string | null;
  companyName: string | null;
  companyDomain: string | null;
  countryCode: string | null;
  raw: unknown;
  metadata: Record<string, unknown>;
};

export type LushaUsageMetadataInput = {
  endpoint: 'decision_makers' | 'contact_search' | 'contact_enrich';
  companyName: string;
  companyDomain: string | null;
  rawResultsCount: number;
  normalizedCount: number;
  insertedCandidatesCount: number;
  billing?: unknown;
  requestId?: string | null;
};

export type LushaUsageMetadata = {
  provider: 'lusha';
  endpoint: LushaUsageMetadataInput['endpoint'];
  company_name: string;
  company_domain: string | null;
  raw_results_count: number;
  normalized_count: number;
  inserted_candidates_count: number;
  phone_reveal_enabled: false;
  billing: unknown;
  request_id: string | null;
};
