/**
 * apollo-enrichment-eligibility-gate.ts — Cheap gates evaluated BEFORE the paid
 * Apollo Organization Enrichment call.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * The cascade used to select candidates by "does it have a domain, and do we
 * already have evidence" and then spend a credit on each of the first N. Every
 * other check — country, sector, duplicates — ran *after* the money was gone.
 * So a Colombian supermarket search could pay to enrich `falabella.com.pe`
 * (wrong country), `citigroup.com` (wrong sector) or `gmail.com` (not a
 * company at all).
 *
 * The new order is: search → normalize → cheap gates → enrichment eligibility →
 * paid enrichment → legal enrichment → canonical identity → final dedup →
 * persistence. This module is the "enrichment eligibility" step. Everything it
 * rejects costs zero credits.
 *
 * Pure: no I/O, no provider call, no process.env. All state the gate needs
 * (cooldowns, already-processed domains, sector verdict) is injected.
 */

import type { WebSearchResult } from './types';
import {
  evaluateApolloSectorRelevanceForPaidOperation,
  type ApolloPaidSectorRelevanceDecision,
} from './apollo-sector-relevance-gate';

// ─── Skip reasons ─────────────────────────────────────────────────────────────

/**
 * Structured reason a candidate never reached the paid enrichment call.
 * Every value here means: 0 Apollo calls, 0 credits.
 */
export type ApolloEnrichmentIneligibilityReason =
  | 'country_mismatch'
  | 'invalid_domain'
  | 'tld_country_mismatch'
  | 'generic_or_mail_provider_domain'
  | 'ownership_mismatch'
  | 'external_platform_domain'
  | 'cooldown_active'
  | 'preliminary_duplicate'
  | 'organization_already_processed'
  | 'sector_not_mapped'
  | 'sector_relevance_unverified';

/**
 * Evaluation order. Declared as data so the order is testable and so a reader
 * can see the precedence without tracing branches.
 *
 * `invalid_domain` sits one slot earlier than the milestone brief lists it,
 * immediately after the country check: a TLD cannot be compared against a
 * target country until a domain has actually been parsed. Every other position
 * follows the brief.
 */
export const APOLLO_ENRICHMENT_GATE_ORDER: readonly ApolloEnrichmentIneligibilityReason[] = [
  'country_mismatch',
  'invalid_domain',
  'tld_country_mismatch',
  'generic_or_mail_provider_domain',
  'ownership_mismatch',
  'external_platform_domain',
  'cooldown_active',
  'preliminary_duplicate',
  'organization_already_processed',
  'sector_not_mapped',
  'sector_relevance_unverified',
] as const;

// ─── Domain classification data ───────────────────────────────────────────────

/**
 * Free mail providers. A company whose only "domain" is a mail provider is not
 * an organization Apollo can enrich — enriching `gmail.com` bills a credit to
 * learn about Google's mail product.
 */
const MAIL_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.es',
  'ymail.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'mail.com',
  'gmx.com',
  'yandex.com',
]);

/**
 * Platforms that host other companies' presence. A result pointing at one of
 * these describes a profile, not the company's own domain, so enriching it
 * would enrich the platform.
 */
const EXTERNAL_PLATFORM_DOMAINS: ReadonlySet<string> = new Set([
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'crunchbase.com',
  'glassdoor.com',
  'indeed.com',
  'wikipedia.org',
  'google.com',
  'google.com.co',
  'bing.com',
  'amazon.com',
  'mercadolibre.com',
  'blogspot.com',
  'wordpress.com',
  'wix.com',
  'medium.com',
  'github.io',
  'sites.google.com',
]);

/**
 * ccTLD → ISO country. Only country-code TLDs appear here: a generic TLD
 * (.com, .net, .io) carries no country signal and must never be read as a
 * mismatch.
 */
const CCTLD_TO_COUNTRY: Readonly<Record<string, string>> = {
  ar: 'AR',
  bo: 'BO',
  br: 'BR',
  cl: 'CL',
  co: 'CO',
  cr: 'CR',
  cu: 'CU',
  do: 'DO',
  ec: 'EC',
  gt: 'GT',
  hn: 'HN',
  mx: 'MX',
  ni: 'NI',
  pa: 'PA',
  pe: 'PE',
  pr: 'PR',
  py: 'PY',
  sv: 'SV',
  uy: 'UY',
  ve: 'VE',
  es: 'ES',
  us: 'US',
  pt: 'PT',
};

/** Returns the ISO country a domain's ccTLD implies, or null for generic TLDs. */
export function resolveCountryFromDomainTld(domain: string): string | null {
  const normalized = domain.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot < 0) return null;
  const tld = normalized.slice(lastDot + 1);
  return CCTLD_TO_COUNTRY[tld] ?? null;
}

/**
 * Minimal structural validation. A domain must have at least one dot, no
 * whitespace, no scheme or path left over, and a plausible TLD.
 */
export function isStructurallyValidDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const normalized = domain.trim().toLowerCase();
  if (normalized === '' || /\s/.test(normalized)) return false;
  if (normalized.includes('/') || normalized.includes('@') || normalized.includes(':')) {
    return false;
  }
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(
    normalized,
  );
}

/** Strips a leading `www.` so `www.acme.com` and `acme.com` compare equal. */
function stripWww(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

/**
 * Registrable-domain approximation: the last two labels, or the last three when
 * the second-to-last is a well-known second level (`com.co`, `com.pe`).
 */
export function toRegistrableDomain(domain: string): string {
  const parts = stripWww(domain).split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const secondLevel = parts[parts.length - 2];
  const SECOND_LEVELS = new Set(['com', 'co', 'net', 'org', 'gob', 'gov', 'edu', 'ind']);
  if (secondLevel && SECOND_LEVELS.has(secondLevel)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// ─── Gate input / output ──────────────────────────────────────────────────────

export type ApolloEnrichmentEligibilityContext = {
  /** ISO country the wizard is searching in. Null disables the country checks. */
  targetCountryCode: string | null;
  /** Sector requested by the wizard, for the fail-closed relevance check. */
  sector: string | null;
  /** Primary subindustry, when the search has one. */
  subindustry?: string | null;
  /**
   * Domains under cooldown, lowercase and `www.`-stripped.
   *
   * Keyed by the FULL domain, not the registrable one: Apollo's enrichment is
   * keyed by the exact domain sent, so `a.example.com` and `b.example.com` are
   * two different organizations and two different charges. Collapsing them
   * would silently skip real candidates that merely share a parent domain.
   */
  domainsInCooldown?: ReadonlySet<string>;
  /** Full domains already enriched in a previous run. Lowercase. */
  alreadyProcessedDomains?: ReadonlySet<string>;
  /**
   * Full domains already accepted earlier in THIS run. The gate treats a repeat
   * as a preliminary duplicate — the definitive dedup still runs later on
   * canonical identity; this one only prevents paying twice for the same domain
   * inside one execution.
   */
  seenDomainsInRun?: ReadonlySet<string>;
};

export type ApolloEnrichmentEligibility =
  | {
      eligible: true;
      domain: string;
      registrableDomain: string;
      /** Either a positive match or "the provider said nothing about sector". */
      sectorDecision: Extract<
        ApolloPaidSectorRelevanceDecision,
        'relevant' | 'sector_relevance_indeterminate'
      >;
      matchedSectorTerms: string[];
    }
  | {
      eligible: false;
      domain: string | null;
      registrableDomain: string | null;
      skipReason: ApolloEnrichmentIneligibilityReason;
      detail: string | null;
    };

/** Reads the country Apollo reported for the organization, when present. */
function readOrganizationCountry(result: WebSearchResult): string | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  for (const key of ['country_code', 'country']) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim() !== '') {
      const normalized = value.trim().toUpperCase();
      // Only 2-letter ISO codes are comparable; a country *name* is ambiguous
      // across languages and must not produce a mismatch on its own.
      if (/^[A-Z]{2}$/.test(normalized)) return normalized;
    }
  }
  return null;
}

/**
 * Reads the candidate's domain: the declared `metadata.domain` first, then the
 * URL hostname.
 *
 * Deliberately local rather than imported from the cascade: the cascade imports
 * this gate, and a two-way import would make the module graph circular for the
 * sake of six lines.
 */
function readCandidateDomain(result: WebSearchResult): string | null {
  const declared = readDeclaredDomain(result);
  if (declared) return stripWww(declared);
  const host = readUrlHost(result);
  return host ? stripWww(host) : null;
}

/** Reads the domain the result itself declares, independent of its URL. */
function readDeclaredDomain(result: WebSearchResult): string | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  const declared = meta?.['domain'];
  return typeof declared === 'string' && declared.trim() !== '' ? declared.trim() : null;
}

/** Reads the hostname of the result URL, when it parses. */
function readUrlHost(result: WebSearchResult): string | null {
  if (!result.url) return null;
  try {
    return new URL(result.url).hostname;
  } catch {
    return null;
  }
}

/**
 * Decides whether one candidate may be sent to the paid Apollo Organization
 * Enrichment endpoint.
 *
 * Checks run in APOLLO_ENRICHMENT_GATE_ORDER and stop at the first rejection,
 * so the reported reason is always the earliest — and cheapest — one that
 * applies. Nothing here calls a provider.
 */
export function evaluateApolloEnrichmentEligibility(
  result: WebSearchResult,
  context: ApolloEnrichmentEligibilityContext,
): ApolloEnrichmentEligibility {
  const target = context.targetCountryCode?.trim().toUpperCase() || null;

  // 1. Country the provider itself reported disagrees with the search country.
  const organizationCountry = readOrganizationCountry(result);
  if (target && organizationCountry && organizationCountry !== target) {
    return {
      eligible: false,
      domain: null,
      registrableDomain: null,
      skipReason: 'country_mismatch',
      detail: `${organizationCountry}!=${target}`,
    };
  }

  // 2. A domain must exist and be structurally sane before anything else can
  //    be derived from it.
  const rawDomain = readCandidateDomain(result);
  if (!isStructurallyValidDomain(rawDomain)) {
    return {
      eligible: false,
      domain: rawDomain,
      registrableDomain: null,
      skipReason: 'invalid_domain',
      detail: null,
    };
  }
  const domain = stripWww(rawDomain as string);
  const registrableDomain = toRegistrableDomain(domain);

  // 3. ccTLD contradicts the search country. `falabella.com.pe` in a Colombian
  //    search is the canonical case: a real company, wrong market.
  const tldCountry = resolveCountryFromDomainTld(domain);
  if (target && tldCountry && tldCountry !== target) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      skipReason: 'tld_country_mismatch',
      detail: `${tldCountry}!=${target}`,
    };
  }

  // 4. Free mail providers are not enrichable organizations.
  if (MAIL_PROVIDER_DOMAINS.has(registrableDomain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      skipReason: 'generic_or_mail_provider_domain',
      detail: registrableDomain,
    };
  }

  // 5. The result's declared domain and its URL host describe different
  //    companies — we cannot tell which one a paid enrichment would return.
  const declaredDomain = readDeclaredDomain(result);
  const urlHost = readUrlHost(result);
  if (declaredDomain && urlHost) {
    const declaredRegistrable = toRegistrableDomain(declaredDomain);
    const urlRegistrable = toRegistrableDomain(urlHost);
    const urlIsPlatform = EXTERNAL_PLATFORM_DOMAINS.has(urlRegistrable);
    if (!urlIsPlatform && declaredRegistrable !== urlRegistrable) {
      return {
        eligible: false,
        domain,
        registrableDomain,
        skipReason: 'ownership_mismatch',
        detail: `${declaredRegistrable}!=${urlRegistrable}`,
      };
    }
  }

  // 6. The domain is a platform profile, not the company's own site.
  if (EXTERNAL_PLATFORM_DOMAINS.has(registrableDomain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      skipReason: 'external_platform_domain',
      detail: registrableDomain,
    };
  }

  // 7-9 are keyed by the FULL domain: Apollo bills per exact domain, so
  // `a.example.com` and `b.example.com` are different organizations.

  // 7. Recently attempted — a cooldown exists precisely so we stop re-paying.
  if (context.domainsInCooldown?.has(domain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      skipReason: 'cooldown_active',
      detail: null,
    };
  }

  // 8. Already accepted earlier in this same run.
  if (context.seenDomainsInRun?.has(domain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      skipReason: 'preliminary_duplicate',
      detail: null,
    };
  }

  // 9. Enriched in an earlier run — the data is already ours.
  if (context.alreadyProcessedDomains?.has(domain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      skipReason: 'organization_already_processed',
      detail: null,
    };
  }

  // 10/11. Sector relevance, fail-closed where failing closed is meaningful.
  //
  //   sector_not_mapped            → reject. No policy exists for this sector,
  //                                  so nothing authorises paying for it. This
  //                                  is the passthrough the display gate keeps
  //                                  and a paid operation must not.
  //   sector_relevance_unverified  → reject. Apollo described this company's
  //                                  sector and it is not the one searched —
  //                                  Citigroup in a supermarket search.
  //   sector_relevance_indeterminate → ALLOW. Apollo described no sector at
  //                                  all. Buying that description is exactly
  //                                  what the enrichment cascade is for, and
  //                                  its ambiguity-first ordering enriches
  //                                  these candidates first by design. If the
  //                                  enriched profile still does not match, the
  //                                  display gate rejects it afterwards.
  const sectorRelevance = evaluateApolloSectorRelevanceForPaidOperation(
    result,
    context.sector,
    context.subindustry ?? null,
  );
  if (
    sectorRelevance.decision === 'sector_not_mapped' ||
    sectorRelevance.decision === 'sector_relevance_unverified'
  ) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      skipReason: sectorRelevance.decision,
      detail: null,
    };
  }

  return {
    eligible: true,
    domain,
    registrableDomain,
    sectorDecision: sectorRelevance.decision,
    matchedSectorTerms: sectorRelevance.matchedTerms,
  };
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export type ApolloEnrichmentGateCounts = Record<
  ApolloEnrichmentIneligibilityReason | 'eligible',
  number
>;

/** Zeroed counter map. Callers increment as they evaluate. */
export function buildEmptyEnrichmentGateCounts(): ApolloEnrichmentGateCounts {
  const counts = { eligible: 0 } as ApolloEnrichmentGateCounts;
  for (const reason of APOLLO_ENRICHMENT_GATE_ORDER) counts[reason] = 0;
  return counts;
}
