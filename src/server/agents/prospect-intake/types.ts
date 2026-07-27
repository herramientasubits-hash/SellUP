/**
 * Q3F-5BB.10B1 — Provider-agnostic Agent 1 intake contracts.
 *
 * These are the shared, provider-neutral types every prospect discovery source
 * (Lusha, Apollo, Tavily / Web AI, and future providers) maps INTO before the
 * rest of the Agent 1 pipeline (mandatory gate → source-catalog enrichment →
 * duplicate check → persistence → human approval) runs on a common shape.
 *
 * SCOPE (this slice ONLY): pure types + pure adapters + normalization. No
 * runtime wiring, no DB, no provider calls, no I/O, no env, no fetch. Nothing
 * here is connected to the live pipeline yet — that is the next slice (10B2).
 *
 * Naming note: the codebase already uses `ProspectDiscoveryProvider` in
 * `src/modules/prospect-batches/prospect-discovery-provider.ts` for a DIFFERENT
 * concept (which provider the wizard should RUN: 'lusha' | 'default_ai'). To
 * avoid a collision, the source-identity enum here is named
 * `ProspectIntakeProvider`.
 */

// ============================================================
// Provider identity
// ============================================================

/**
 * The discovery source a raw company record originated from. The known members
 * are enumerated for autocomplete + exhaustiveness; the `(string & {})` arm
 * keeps the type open for future providers without a breaking change.
 */
export type ProspectIntakeProvider =
  | 'lusha'
  | 'apollo'
  | 'tavily'
  | 'web_ai'
  | (string & {});

// ============================================================
// Shared value objects
// ============================================================

/**
 * Industry classification codes as reported by a provider. All optional — a
 * provider may supply none, some, or all. Never invented by the normalizer.
 */
export interface IntakeIndustryCodes {
  /** North American Industry Classification System codes. */
  naics?: string[];
  /** Standard Industrial Classification codes. */
  sic?: string[];
  /** Provider-native industry identifiers (e.g. Lusha `mainIndustriesIds`). */
  providerIndustryIds?: string[];
}

/**
 * The search intent that produced a discovery result. Mirrors the wizard
 * criteria but in a provider-neutral shape. `rawWizardCriteriaSafe` may carry a
 * sanitized snapshot of the original wizard input — never secrets, never raw
 * provider payloads.
 */
export interface ProspectSearchCriteria {
  countryCode?: string | null;
  country?: string | null;
  sector?: string | null;
  subindustry?: string | null;
  minEmployees?: number | null;
  maxEmployees?: number | null;
  employeeBand?: string | null;
  keywords?: string[];
  sourceProvider?: ProspectIntakeProvider | null;
  requestedBy?: string | null;
  rawWizardCriteriaSafe?: Record<string, unknown>;
}

// ============================================================
// Provider-discovered company (adapter OUTPUT / normalizer INPUT)
// ============================================================

/**
 * A single company as discovered by a provider, already mapped by a provider
 * adapter into a common shape but NOT yet normalized.
 *
 * HARD RULE: this contract must never carry a raw provider payload. Adapters put
 * only safe, useful fields in `providerMetadataSafe`; a raw blob (if it must be
 * referenced at all) is addressed indirectly by `rawPayloadRef`, never inlined.
 */
export interface ProviderDiscoveredCompany {
  provider: ProspectIntakeProvider;
  providerRecordId?: string | null;
  providerRequestId?: string | null;

  companyName: string | null;
  commercialName?: string | null;
  legalName?: string | null;

  websiteUrl?: string | null;
  domain?: string | null;
  linkedinUrl?: string | null;

  country?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;

  industry?: string | null;
  subindustry?: string | null;
  industryCodes?: IntakeIndustryCodes;

  employeeCount?: number | null;
  employeeRange?: string | null;
  revenue?: string | number | null;

  description?: string | null;
  sourceUrl?: string | null;
  sourceConfidence?: number | null;

  searchCriteria?: Record<string, unknown>;

  /** Safe, curated provider metadata. NEVER a raw payload dump. */
  providerMetadataSafe?: Record<string, unknown>;
  /** Opaque reference to a raw payload stored elsewhere. Never the payload. */
  rawPayloadRef?: string | null;
}

// ============================================================
// Normalization diagnostics
// ============================================================

/**
 * Soft signals — the candidate can still proceed to review, but a human (or a
 * future soft gate) may want to look closer.
 */
export type IntakeNormalizationWarning =
  | 'missing_domain'
  | 'missing_corporate_linkedin'
  | 'employee_count_unknown'
  | 'sector_pending_review'
  | 'ambiguous_sector'
  | 'low_provider_confidence'
  | 'source_catalog_unavailable';

/**
 * Hard signals — a future mandatory gate is expected to block or quarantine on
 * these. This slice only ACCUMULATES them; it never excludes a candidate yet.
 */
export type IntakeNormalizationIssue =
  | 'missing_name'
  | 'country_mismatch'
  | 'known_employee_count_below_min'
  | 'unsupported_country';

// ============================================================
// Normalized candidate (normalizer OUTPUT)
// ============================================================

/** Deterministic, side-effect-free provenance for a normalized candidate. */
export interface IntakeTrace {
  sourceProvider: ProspectIntakeProvider;
  providerRecordId: string | null;
  providerRequestId: string | null;
  sourceUrl: string | null;
}

/**
 * The provider-neutral candidate the rest of the Agent 1 pipeline consumes.
 * Produced only by `normalizeProviderDiscoveredCompany`.
 */
export interface NormalizedProspectCandidate {
  sourceProvider: ProspectIntakeProvider;
  providerRecordId: string | null;
  providerRequestId: string | null;

  canonicalName: string | null;
  normalizedName: string | null;
  commercialName: string | null;
  legalName: string | null;

  websiteUrl: string | null;
  domain: string | null;
  corporateLinkedinUrl: string | null;

  country: string | null;
  countryCode: string | null;
  requestedCountryCode: string | null;
  region: string | null;
  city: string | null;

  industry: string | null;
  subindustry: string | null;
  industryCodes: IntakeIndustryCodes;

  employeeCount: number | null;
  employeeRange: string | null;

  sourceUrl: string | null;
  sourceConfidence: number | null;

  searchCriteria: ProspectSearchCriteria;

  warnings: IntakeNormalizationWarning[];
  issues: IntakeNormalizationIssue[];

  providerMetadataSafe: Record<string, unknown>;
  trace: IntakeTrace;
}

// ============================================================
// Adapter context (shared)
// ============================================================

/**
 * Cross-cutting context every provider adapter may use to enrich mapping. All
 * optional so adapters degrade gracefully when the wizard omits a field.
 */
export interface ProviderAdapterContext {
  /** Provider request id (batch / run correlation). */
  requestId?: string | null;
  /** The search intent that produced this discovery result. */
  searchCriteria?: ProspectSearchCriteria;
}
