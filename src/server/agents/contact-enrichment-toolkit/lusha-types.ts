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

// ── Capability routing ──────────────────────────────────────────

/**
 * Discovery mode resolved from available search context.
 *
 * person_known_search    — caller has a person identifier; use /v3/contacts/search.
 * company_first_discovery — company identity only, no person identifier;
 *                           requires a dedicated endpoint (e.g. /v3/contacts/decision-makers).
 *                           NOT YET IMPLEMENTED — no proven contract in codebase.
 * invalid_search_context — neither person nor company identity is sufficient.
 */
export type LushaDiscoveryMode =
  | 'person_known_search'
  | 'company_first_discovery'
  | 'invalid_search_context';

export type LushaSearchContext = {
  lushaId?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
};

/**
 * Pure function — no side effects, no I/O.
 * Resolves which Lusha capability to use based on available search context.
 *
 * Lusha /v3/contacts/search contract (confirmed live 17B.4D):
 *   Each contact item must have one of:
 *     id | linkedinUrl | email | (firstName + lastName + (companyName | companyDomain))
 * A company-only item (no person fields) violates this contract → HTTP 400.
 */
export function resolveLushaDiscoveryMode(ctx: LushaSearchContext): LushaDiscoveryMode {
  if (ctx.lushaId?.trim()) return 'person_known_search';
  if (ctx.linkedinUrl?.trim()) return 'person_known_search';
  if (ctx.email?.trim()) return 'person_known_search';

  const hasFirst = Boolean(ctx.firstName?.trim());
  const hasLast = Boolean(ctx.lastName?.trim());
  const hasCompanyId = Boolean(ctx.companyName?.trim() || ctx.companyDomain?.trim());

  if (hasFirst && hasLast && hasCompanyId) return 'person_known_search';
  if (hasCompanyId) return 'company_first_discovery';
  return 'invalid_search_context';
}
