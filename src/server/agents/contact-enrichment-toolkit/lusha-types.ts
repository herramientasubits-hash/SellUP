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

// ── Contact Prospecting V3 types — 17B.4W / 17B.4W.2 ────────────

/**
 * Input for company-first Lusha contact discovery.
 * Not interchangeable with /v3/contacts/search contacts[] items by construction:
 * no person fields, so it cannot accidentally be serialized as a search item.
 */
export type LushaContactProspectingInput = {
  companyName: string;
  companyDomain?: string | null;
  companyCountryCode?: string | null;
};

/**
 * jobTitle object shape confirmed from live V3 response (17B.4W.2).
 * The API returns an object, not a string.
 */
export type LushaContactProspectingJobTitleV3 = {
  title?: string | null;
  departments?: string[];
  seniority?: string | null;
};

/**
 * company object shape confirmed from live V3 response (17B.4W.2).
 */
export type LushaContactProspectingCompanyV3 = {
  id?: string | null;
  name?: string | null;
  domain?: string | null;
};

/**
 * canReveal item shape confirmed from live V3 response (17B.4W.2).
 * credits: 0 means the field is revealable with zero cost reported by provider.
 */
export type LushaContactProspectingCanRevealItem = {
  field: string;
  credits: number;
};

/**
 * Filter shape for POST /v3/contacts/prospecting.
 *
 * Derivation sources (17B.4W):
 *   - Endpoint confirmed: Lusha API V3 Migration Guide (V2 /prospecting/contact/search → V3 /v3/contacts/prospecting).
 *   - Contact filter field names confirmed: Lusha Prospecting Reference (departments, seniority,
 *     jobTitles, locations, existingDataPoints, linkedinUrls, searchText).
 *   - Nesting pattern (filters.contacts.include / filters.companies.include) derived from
 *     analogous /v3/companies/prospecting confirmed in Q3F (live evidence).
 *   - Company filter field names (names, domains) derived from /v3/companies/prospecting
 *     include.names pattern + REST convention. NOT confirmed from live contact prospecting.
 */
export type LushaContactProspectingFilters = {
  contacts?: {
    include?: {
      /** Confirmed from official Prospecting Reference. */
      departments?: string[];
      /** Confirmed from official Prospecting Reference. */
      seniority?: string[];
      /** Confirmed from official Prospecting Reference. */
      jobTitles?: string[];
      /** Confirmed from official Prospecting Reference. */
      locations?: Array<{ country?: string; state?: string; city?: string }>;
      /** Confirmed from official Prospecting Reference. */
      existingDataPoints?: string[];
      /** Confirmed from official Prospecting Reference. */
      linkedinUrls?: string[];
    };
  };
  companies?: {
    include?: {
      /**
       * Company name filter.
       * Field name derived from analogous companies prospecting include.names.
       * NOT confirmed from live contact prospecting evidence as of 17B.4W.
       */
      names?: string[];
      /**
       * Company FQDN / domain filter.
       * Field name "domains" derived from response field "fqdn" + REST convention.
       * NOT confirmed from live contact prospecting evidence as of 17B.4W.
       */
      domains?: string[];
    };
  };
};

/**
 * Request body for POST /v3/contacts/prospecting.
 * Endpoint confirmed from Lusha V3 Migration Guide.
 */
export type LushaContactProspectingRequest = {
  filters: LushaContactProspectingFilters;
  /** Pattern derived from /v3/companies/prospecting (confirmed Q3F). */
  pagination?: {
    page: number;
    size: number;
  };
};

/**
 * Single contact entry in POST /v3/contacts/prospecting response.
 *
 * V3 live shape confirmed from live call (17B.4W.2):
 *   id (person ID), firstName, lastName, jobTitle (object), company (object),
 *   location, socialLinks, has (string[]), canReveal ({field, credits}[]).
 *
 * Documented/assumed fields kept as optional for backward compatibility.
 * Normalizer uses V3 live fields with documented fields as fallbacks.
 */
export type LushaContactProspectingPerson = {
  // ── V3 live confirmed fields (17B.4W.2) ─────────────────────
  /** Person identifier — confirmed live as "id" (NOT "contactId"). */
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** V3 live: object with title/departments/seniority (NOT a string). */
  jobTitle?: LushaContactProspectingJobTitleV3 | string | null;
  /** V3 live: object with id/name/domain. */
  company?: LushaContactProspectingCompanyV3 | null;
  location?: { country?: string | null; city?: string | null } | null;
  socialLinks?: { linkedin?: string | null } | null;
  /** Available data fields list — e.g. ["firstName","emails","phones"]. */
  has?: string[] | null;
  /** Revealable fields with per-field credit cost. credits=0 means eligible. */
  canReveal?: LushaContactProspectingCanRevealItem[] | null;

  // ── Documented / assumed fields (kept as fallbacks) ─────────
  /** Documented field name for person ID — fallback if "id" absent. */
  contactId?: string | null;
  name?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  /** Fully qualified domain name of company — fallback if company.domain absent. */
  fqdn?: string | null;
  isShown?: boolean | null;
  hasDepartment?: boolean | null;
  hasSeniority?: boolean | null;
  hasSocialLink?: boolean | null;
  hasEmails?: boolean | null;
  hasWorkEmail?: boolean | null;
  hasPhones?: boolean | null;
};

/**
 * Root response for POST /v3/contacts/prospecting.
 * Fields confirmed from Lusha Prospecting Reference (17B.4W).
 */
export type LushaContactProspectingResponse = {
  requestId?: string | null;
  currentPage?: number | null;
  pageLength?: number | null;
  totalResults?: number | null;
  contacts?: LushaContactProspectingPerson[];
};

/**
 * Normalized prospecting contact (pre-enrich).
 * No email — email requires /v3/contacts/enrich.
 *
 * Fields aligned with V3 live shape (17B.4W.2).
 * contactId is the stable identifier used for enrich calls.
 * canRevealEmail: true when canReveal includes field="emails" (credits=0 is still eligible).
 */
export type LushaProspectingNormalizedContact = {
  contactId: string;
  name: string | null;
  jobTitle: string | null;
  companyName: string | null;
  fqdn: string | null;
  linkedinUrl: string | null;
  hasWorkEmail: boolean;
  /** True when canReveal list includes field="emails". credits=0 is eligible. */
  canRevealEmail: boolean;
  /** First department string from jobTitle.departments, if present. */
  department: string | null;
  /** Seniority string from jobTitle.seniority, if present. */
  seniority: string | null;
  raw: LushaContactProspectingPerson;
};

export type LushaContactProspectingResult = {
  ok: boolean;
  status:
    | 'success'
    | 'no_results'
    | 'provider_auth_error'
    | 'insufficient_credits'
    | 'feature_unavailable'
    | 'rate_limited'
    | 'compliance_blocked'
    | 'provider_error'
    | 'provider_timeout';
  httpStatus?: number;
  requestId?: string | null;
  resultsReturned: number;
  totalAvailable?: number | null;
  contacts: LushaProspectingNormalizedContact[];
  /** Credits charged for this prospecting call (from response billing object). */
  prospectingCreditsCharged?: number | null;
  errorMessage?: string;
  errorCode?: string;
};

// ── Capability routing ──────────────────────────────────────────

/**
 * Discovery mode resolved from available search context.
 *
 * person_known_search    — caller has a person identifier; use /v3/contacts/search.
 * company_first_discovery — company identity only, no person identifier;
 *                           use /v3/contacts/prospecting (17B.4W).
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
