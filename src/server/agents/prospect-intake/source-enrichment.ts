/**
 * Q3F-5BB.10C1 — Shared, provider-agnostic official-source enrichment abstraction.
 *
 * This is the pipeline stage that sits AFTER discovery + normalization and BEFORE
 * dedup:
 *
 *   NormalizedProspectCandidate
 *     → Official Source Enrichment   (this module)
 *     → EnrichedProspectCandidateIdentity
 *
 * The discovery PROVIDER (Lusha / Apollo / Tavily / Web AI / future) is irrelevant
 * here: whatever produced the `NormalizedProspectCandidate`, the official-source
 * enrichment step is common. A per-country / per-source lookup against an official
 * registry (Colombia RUES/SIIS, Ecuador SCVS, Mexico DENUE, …) is expressed as an
 * injected `OfficialSourceResolver`; this module only orchestrates them.
 *
 * PURE / INJECTED: no I/O of its own. No Supabase client, no `process.env`, no
 * `fetch`, no provider clients, no HubSpot, no DB access, no migrations, no
 * `identity_key`. Every future side effect arrives through an injected resolver.
 * The same (candidate, criteria, resolvers, policy) always yields the same result.
 *
 * SCOPE (this slice ONLY): the pure types + the orchestrator + two bounded,
 * writer-safe projection helpers. NOTHING here is wired into the live Agent 1
 * pipeline (Lusha / Apollo / Tavily runtime, `candidate-writer`, duplicate
 * checker, approval, UI, source-catalog runtime that builds a service-role
 * client). Wiring is a later slice (10C2 — Lusha adoption).
 */

import type { NormalizedProspectCandidate, ProspectSearchCriteria } from './types';

// ============================================================
// Status + match-method enums
// ============================================================

/** Outcome of trying to enrich a candidate against an official source. */
export type OfficialSourceEnrichmentStatus =
  | 'matched'
  | 'not_found'
  | 'unsupported_country'
  | 'source_catalog_unavailable'
  | 'low_confidence_match'
  | 'error';

/** How an official-source record was matched to the candidate. */
export type OfficialSourceMatchMethod =
  | 'tax_id'
  | 'exact_name'
  | 'normalized_name'
  | 'domain'
  | 'manual'
  | 'provider_external_id'
  | 'unknown';

// ============================================================
// Canonical, bounded warning / issue tokens
// ============================================================

/**
 * Canonical soft-signal tokens the orchestrator appends. Resolvers MAY add extra
 * safe string tokens; these are the ones the rest of the pipeline can rely on.
 */
export const OFFICIAL_SOURCE_WARNING = {
  notFound: 'official_source_not_found',
  lowConfidence: 'low_confidence_official_source_match',
  catalogUnavailable: 'source_catalog_unavailable',
  unsupportedCountry: 'official_source_unsupported_country',
} as const;

/** Canonical hard-signal tokens the orchestrator appends. */
export const OFFICIAL_SOURCE_ISSUE = {
  error: 'official_source_error',
  unsupportedCountryBlocked: 'official_source_unsupported_country',
} as const;

// ============================================================
// Result / policy types
// ============================================================

/**
 * A single official-source enrichment outcome. Produced by a resolver and then
 * canonicalized by the orchestrator (status downgrades + standard warning/issue
 * tokens applied). `safeMetadata` is BOUNDED — never a raw registry payload.
 */
export interface OfficialSourceEnrichmentResult {
  status: OfficialSourceEnrichmentStatus;
  countryCode: string | null;
  sourceKey?: string | null;
  confidence?: number | null;
  matchMethod?: OfficialSourceMatchMethod | null;

  taxIdentifier?: string | null;
  taxIdentifierType?: string | null;
  legalName?: string | null;
  legalStatus?: string | null;
  economicActivity?: string | null;
  registryStatus?: string | null;
  address?: string | null;
  matchedAt?: string | null;

  warnings: string[];
  issues: string[];

  /** Small, curated signal fields only. NEVER a raw payload dump. */
  safeMetadata?: Record<string, unknown>;
}

/**
 * Configurable enrichment behaviour. Every field has a conservative default (see
 * `DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY`). Callers override only what they
 * need.
 */
export interface OfficialSourceEnrichmentPolicy {
  /** A `matched` result at or above this confidence is a STRONG identity. */
  minimumStrongMatchConfidence: number;
  /** Keep low-confidence match data as a signal (metadata) instead of dropping it. */
  allowLowConfidenceAsSignal: boolean;
  /** No official source for the country → soft warning, or a hard issue. */
  unsupportedCountryMode: 'warning' | 'block';
  /** A resolver that throws → swallow into an `error` result, or re-throw. */
  errorMode: 'fail_soft' | 'fail_closed';
}

/** What an official-source resolver receives. Read-only; resolvers must not mutate it. */
export interface OfficialSourceResolverInput {
  candidate: NormalizedProspectCandidate;
  criteria: ProspectSearchCriteria;
  policy: OfficialSourceEnrichmentPolicy;
}

/**
 * An injected official-source lookup for one country + one source. In a later
 * slice a concrete resolver will adapt a source-catalog reader (e.g. the Colombia
 * tax-identifier resolver) behind this interface, so its Supabase/env access
 * stays OUT of this pure layer.
 */
export interface OfficialSourceResolver {
  /** ISO country this resolver serves (matched case-insensitively). */
  countryCode: string;
  /** The official source this resolver represents (e.g. `co_siis`). */
  sourceKey: string;
  /** Cheap, pure predicate: can this resolver attempt the given candidate? */
  canResolve(input: OfficialSourceResolverInput): boolean;
  /** Perform the lookup. May be sync or async. Injected side effects live here. */
  resolve(
    input: OfficialSourceResolverInput,
  ): Promise<OfficialSourceEnrichmentResult> | OfficialSourceEnrichmentResult;
}

/**
 * The candidate paired with its official-source identity. The `officialSource`
 * result is always present (a synthetic unavailable/unsupported result when no
 * resolver applied). Top-level `taxIdentifier` / `legalName` / … are populated
 * ONLY when a STRONG identity is available — low-confidence data stays inside
 * `officialSource` as a signal and is never promoted to a strong identity.
 */
export interface EnrichedProspectCandidateIdentity {
  candidate: NormalizedProspectCandidate;
  officialSource: OfficialSourceEnrichmentResult;

  taxIdentifier?: string | null;
  taxIdentifierType?: string | null;
  legalName?: string | null;
  legalStatus?: string | null;

  strongIdentityAvailable: boolean;
  identityWarnings: string[];
  identityIssues: string[];
}

// ============================================================
// Default policy
// ============================================================

export const DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY: OfficialSourceEnrichmentPolicy = {
  minimumStrongMatchConfidence: 0.85,
  allowLowConfidenceAsSignal: true,
  unsupportedCountryMode: 'warning',
  errorMode: 'fail_soft',
};

// ============================================================
// Pure helpers
// ============================================================

function pushUnique(list: string[], token: string): void {
  if (!list.includes(token)) list.push(token);
}

/** Country to resolve against — candidate first, then requested/criteria. */
function resolveTargetCountry(
  candidate: NormalizedProspectCandidate,
  criteria: ProspectSearchCriteria,
): string | null {
  return (
    candidate.countryCode ??
    criteria.countryCode ??
    candidate.requestedCountryCode ??
    null
  );
}

/** Find the first resolver that serves the country AND accepts the candidate. */
function selectResolver(
  resolvers: OfficialSourceResolver[],
  targetCountry: string | null,
  input: OfficialSourceResolverInput,
): { resolver: OfficialSourceResolver | null; countryHasResolver: boolean } {
  if (!targetCountry) return { resolver: null, countryHasResolver: false };
  const target = targetCountry.toUpperCase();
  let countryHasResolver = false;
  for (const resolver of resolvers) {
    if ((resolver.countryCode ?? '').toUpperCase() !== target) continue;
    countryHasResolver = true;
    let accepts = false;
    try {
      accepts = resolver.canResolve(input);
    } catch {
      // A resolver whose predicate throws is treated as "not applicable" here;
      // move on to the next candidate resolver. Errors during resolve() (the real
      // work) are handled by the policy's errorMode instead.
      accepts = false;
    }
    if (accepts) return { resolver, countryHasResolver: true };
  }
  return { resolver: null, countryHasResolver };
}

/** Synthesize the result used when no resolver could run. */
function buildUnavailableResult(
  targetCountry: string | null,
  countryHasResolver: boolean,
  policy: OfficialSourceEnrichmentPolicy,
): OfficialSourceEnrichmentResult {
  const warnings: string[] = [];
  const issues: string[] = [];
  pushUnique(warnings, OFFICIAL_SOURCE_WARNING.catalogUnavailable);

  if (!countryHasResolver) {
    if (policy.unsupportedCountryMode === 'block') {
      pushUnique(issues, OFFICIAL_SOURCE_ISSUE.unsupportedCountryBlocked);
    } else {
      pushUnique(warnings, OFFICIAL_SOURCE_WARNING.unsupportedCountry);
    }
  }

  return {
    status: countryHasResolver ? 'source_catalog_unavailable' : 'unsupported_country',
    countryCode: targetCountry,
    sourceKey: null,
    confidence: null,
    matchMethod: null,
    warnings,
    issues,
  };
}

/**
 * Canonicalize a resolver result: apply the low-confidence downgrade, append the
 * standard warning/issue tokens, and clone into a fresh, bounded object. Never
 * mutates the resolver's returned object.
 */
function canonicalizeResult(
  raw: OfficialSourceEnrichmentResult,
  policy: OfficialSourceEnrichmentPolicy,
): OfficialSourceEnrichmentResult {
  const warnings = [...(raw.warnings ?? [])];
  const issues = [...(raw.issues ?? [])];
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : null;

  let status = raw.status;
  let taxIdentifier = raw.taxIdentifier ?? null;
  let taxIdentifierType = raw.taxIdentifierType ?? null;
  let legalName = raw.legalName ?? null;
  let legalStatus = raw.legalStatus ?? null;
  let economicActivity = raw.economicActivity ?? null;
  let registryStatus = raw.registryStatus ?? null;
  let safeMetadata = raw.safeMetadata ? { ...raw.safeMetadata } : undefined;

  const isStrongMatch =
    status === 'matched' &&
    confidence !== null &&
    confidence >= policy.minimumStrongMatchConfidence;

  if (status === 'matched' && !isStrongMatch) {
    // A match below the strong threshold is never promoted to a strong identity.
    status = 'low_confidence_match';
  }

  switch (status) {
    case 'low_confidence_match': {
      pushUnique(warnings, OFFICIAL_SOURCE_WARNING.lowConfidence);
      if (!policy.allowLowConfidenceAsSignal) {
        // Drop the weak identity entirely — not even a metadata signal.
        taxIdentifier = null;
        taxIdentifierType = null;
        legalName = null;
        legalStatus = null;
        economicActivity = null;
        registryStatus = null;
        safeMetadata = undefined;
      }
      break;
    }
    case 'not_found':
      pushUnique(warnings, OFFICIAL_SOURCE_WARNING.notFound);
      break;
    case 'unsupported_country':
      pushUnique(warnings, OFFICIAL_SOURCE_WARNING.catalogUnavailable);
      if (policy.unsupportedCountryMode === 'block') {
        pushUnique(issues, OFFICIAL_SOURCE_ISSUE.unsupportedCountryBlocked);
      } else {
        pushUnique(warnings, OFFICIAL_SOURCE_WARNING.unsupportedCountry);
      }
      break;
    case 'source_catalog_unavailable':
      pushUnique(warnings, OFFICIAL_SOURCE_WARNING.catalogUnavailable);
      break;
    case 'error':
      pushUnique(issues, OFFICIAL_SOURCE_ISSUE.error);
      break;
    case 'matched':
    default:
      break;
  }

  return {
    status,
    countryCode: raw.countryCode ?? null,
    sourceKey: raw.sourceKey ?? null,
    confidence,
    matchMethod: raw.matchMethod ?? null,
    taxIdentifier,
    taxIdentifierType,
    legalName,
    legalStatus,
    economicActivity,
    registryStatus,
    address: raw.address ?? null,
    matchedAt: raw.matchedAt ?? null,
    warnings,
    issues,
    safeMetadata,
  };
}

/** Pair a canonical result with the promoted (strong-only) identity fields. */
function toEnrichedIdentity(
  candidate: NormalizedProspectCandidate,
  result: OfficialSourceEnrichmentResult,
  policy: OfficialSourceEnrichmentPolicy,
): EnrichedProspectCandidateIdentity {
  const strongIdentityAvailable =
    result.status === 'matched' &&
    typeof result.confidence === 'number' &&
    result.confidence >= policy.minimumStrongMatchConfidence;

  return {
    candidate,
    officialSource: result,
    // Strong identity fields are promoted ONLY on a strong match.
    taxIdentifier: strongIdentityAvailable ? result.taxIdentifier ?? null : null,
    taxIdentifierType: strongIdentityAvailable ? result.taxIdentifierType ?? null : null,
    legalName: strongIdentityAvailable ? result.legalName ?? null : null,
    legalStatus: strongIdentityAvailable ? result.legalStatus ?? null : null,
    strongIdentityAvailable,
    identityWarnings: [...result.warnings],
    identityIssues: [...result.issues],
  };
}

// ============================================================
// Orchestrator
// ============================================================

/**
 * Enrich a normalized candidate against injected official-source resolvers.
 *
 * Pure orchestration: selects the resolver for the candidate's country, runs it,
 * canonicalizes the outcome, and derives a strong-only identity. Never mutates
 * the candidate or any resolver output; never performs I/O of its own.
 *
 * On a resolver throw: `fail_soft` (default) yields an `error` result; `fail_closed`
 * re-throws so the caller must handle it.
 */
export async function enrichNormalizedProspectWithOfficialSources(
  candidate: NormalizedProspectCandidate,
  criteria: ProspectSearchCriteria,
  resolvers: OfficialSourceResolver[],
  policy: Partial<OfficialSourceEnrichmentPolicy> = {},
): Promise<EnrichedProspectCandidateIdentity> {
  const effective: OfficialSourceEnrichmentPolicy = {
    ...DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    ...policy,
  };

  const targetCountry = resolveTargetCountry(candidate, criteria);
  const input: OfficialSourceResolverInput = { candidate, criteria, policy: effective };

  const { resolver, countryHasResolver } = selectResolver(
    resolvers ?? [],
    targetCountry,
    input,
  );

  if (!resolver) {
    const unavailable = buildUnavailableResult(targetCountry, countryHasResolver, effective);
    return toEnrichedIdentity(candidate, unavailable, effective);
  }

  let raw: OfficialSourceEnrichmentResult;
  try {
    raw = await resolver.resolve(input);
  } catch (error) {
    if (effective.errorMode === 'fail_closed') {
      throw error;
    }
    const errored: OfficialSourceEnrichmentResult = {
      status: 'error',
      countryCode: targetCountry,
      sourceKey: resolver.sourceKey ?? null,
      confidence: null,
      matchMethod: null,
      warnings: [],
      issues: [],
    };
    return toEnrichedIdentity(candidate, canonicalizeResult(errored, effective), effective);
  }

  return toEnrichedIdentity(candidate, canonicalizeResult(raw, effective), effective);
}

// ============================================================
// Writer-safe projection helpers (bounded)
// ============================================================

/**
 * Bounded, PII-safe projection for future
 * `prospect_candidates.metadata.source_enrichment`. Deliberately small: no raw
 * payload, no secrets, no large dumps. `taxIdentifierPresent` is a boolean flag —
 * the value itself is never placed in metadata here.
 */
export function buildOfficialSourceEnrichmentMetadata(
  enriched: EnrichedProspectCandidateIdentity,
): {
  status: OfficialSourceEnrichmentStatus;
  sourceKey: string | null;
  countryCode: string | null;
  confidence: number | null;
  matchMethod: OfficialSourceMatchMethod | null;
  taxIdentifierPresent: boolean;
  taxIdentifierType: string | null;
  legalName: string | null;
  legalStatus: string | null;
  economicActivity: string | null;
  registryStatus: string | null;
  strongIdentityAvailable: boolean;
  warnings: string[];
  issues: string[];
} {
  const source = enriched.officialSource;
  return {
    status: source.status,
    sourceKey: source.sourceKey ?? null,
    countryCode: source.countryCode ?? null,
    confidence: source.confidence ?? null,
    matchMethod: source.matchMethod ?? null,
    taxIdentifierPresent: Boolean(source.taxIdentifier),
    taxIdentifierType: source.taxIdentifierType ?? null,
    legalName: source.legalName ?? null,
    legalStatus: source.legalStatus ?? null,
    economicActivity: source.economicActivity ?? null,
    registryStatus: source.registryStatus ?? null,
    strongIdentityAvailable: enriched.strongIdentityAvailable,
    warnings: [...enriched.identityWarnings],
    issues: [...enriched.identityIssues],
  };
}

/**
 * Typed columns a FUTURE writer can persist alongside a candidate. Populated ONLY
 * when a strong identity is available — a low-confidence match never fills these
 * (its signal stays in metadata). Never touches `identity_key`.
 */
export function buildOfficialSourceTypedColumns(
  enriched: EnrichedProspectCandidateIdentity,
): {
  tax_identifier: string | null;
  tax_identifier_type: string | null;
  legal_name: string | null;
  legal_status: string | null;
} {
  if (!enriched.strongIdentityAvailable) {
    return {
      tax_identifier: null,
      tax_identifier_type: null,
      legal_name: null,
      legal_status: null,
    };
  }
  return {
    tax_identifier: enriched.taxIdentifier ?? null,
    tax_identifier_type: enriched.taxIdentifierType ?? null,
    legal_name: enriched.legalName ?? null,
    legal_status: enriched.legalStatus ?? null,
  };
}
