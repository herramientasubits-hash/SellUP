/**
 * apollo-enrichment-eligibility-gate.ts — Cheap gates evaluated BEFORE the paid
 * Apollo Organization Enrichment call.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * The cascade used to select candidates by "does it have a domain, and do we
 * already have evidence", then spend a credit on each of the first N. Every
 * other check — country, sector, duplicates — ran *after* the money was gone.
 * A Colombian supermarket search could therefore pay to enrich
 * `falabella.com.pe` (wrong country), `citigroup.com` (wrong sector) or
 * `gmail.com` (not a company at all).
 *
 * The order is now: search → normalization → cheap gates → eligibility → paid
 * Organization Enrichment → legal enrichment → canonical identity → definitive
 * dedup → persistence. This module is the eligibility step. Everything it
 * rejects costs zero credits, and rejecting the ENRICHMENT does not discard the
 * candidate: it continues to the sector gate un-enriched.
 *
 * Pure: no I/O, no provider call, no process.env. All state the gate needs
 * (cooldowns, already-processed domains, sector verdict) is injected.
 */

import type { WebSearchResult } from './types';
import {
  evaluateApolloSectorRelevanceForPaidOperationAnyOf,
  type ApolloPaidSectorRelevanceDecision,
} from './apollo-sector-relevance-gate';
import type { ApolloSectorEvidenceBootstrapAuthorization } from './apollo-sector-evidence-bootstrap';

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
  | 'inferred_domain_ownership_mismatch'
  | 'external_platform_domain'
  | 'cooldown_active'
  | 'preliminary_duplicate'
  | 'organization_already_processed'
  | 'sector_not_mapped'
  | 'sector_relevance_contradicted';

/**
 * Evaluation order, declared as data so precedence is testable and readable
 * without tracing branches.
 *
 * `invalid_domain` sits one slot earlier than the milestone brief lists it,
 * right after the country check: a TLD cannot be compared against a target
 * country until a domain has actually been parsed. Every other position follows
 * the brief.
 */
export const APOLLO_ENRICHMENT_GATE_ORDER: readonly ApolloEnrichmentIneligibilityReason[] = [
  'country_mismatch',
  'invalid_domain',
  'tld_country_mismatch',
  'generic_or_mail_provider_domain',
  'inferred_domain_ownership_mismatch',
  'external_platform_domain',
  'cooldown_active',
  'preliminary_duplicate',
  'organization_already_processed',
  'sector_not_mapped',
  'sector_relevance_contradicted',
] as const;

/**
 * Non-blocking observations. These never stop a paid call on their own; they
 * are recorded so a pattern can be reviewed later.
 */
export type ApolloEnrichmentEligibilityWarning =
  /**
   * Apollo ASSERTED a primary_domain that does not look like the company name.
   * Deliberately not a rejection: the name↔domain similarity heuristic was
   * written for inferred Tavily URLs, and applied to a domain Apollo states as
   * fact it rejects correct pairs (`Bancolombia S.A.` / `grupobancolombia.com`).
   */
  'asserted_domain_name_mismatch';

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
 * (.com, .net, .io) carries no country signal and must never read as a mismatch.
 */
const CCTLD_TO_COUNTRY: Readonly<Record<string, string>> = {
  ar: 'AR', bo: 'BO', br: 'BR', cl: 'CL', co: 'CO', cr: 'CR', cu: 'CU',
  do: 'DO', ec: 'EC', gt: 'GT', hn: 'HN', mx: 'MX', ni: 'NI', pa: 'PA',
  pe: 'PE', pr: 'PR', py: 'PY', sv: 'SV', uy: 'UY', ve: 'VE',
  es: 'ES', us: 'US', pt: 'PT',
};

/** Returns the ISO country a domain's ccTLD implies, or null for generic TLDs. */
export function resolveCountryFromDomainTld(domain: string): string | null {
  const normalized = domain.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot < 0) return null;
  return CCTLD_TO_COUNTRY[normalized.slice(lastDot + 1)] ?? null;
}

/**
 * Minimal structural validation: at least one dot, no whitespace, no leftover
 * scheme or path, plausible TLD.
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

const SECOND_LEVEL_LABELS = new Set(['com', 'co', 'net', 'org', 'gob', 'gov', 'edu', 'ind']);

/**
 * Registrable-domain approximation: the last two labels, or the last three when
 * the second-to-last is a well-known second level (`com.co`, `com.pe`).
 */
export function toRegistrableDomain(domain: string): string {
  const parts = stripWww(domain).split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const secondLevel = parts[parts.length - 2];
  if (secondLevel && SECOND_LEVEL_LABELS.has(secondLevel)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

// ─── Name ↔ domain similarity (inferred domains only) ─────────────────────────

/** Legal-form and filler tokens that carry no identity. */
const NAME_STOPWORDS = new Set([
  'sa', 'sas', 'sac', 'srl', 'sl', 'ltda', 'ltd', 'llc', 'inc', 'corp',
  'corporation', 'company', 'co', 'group', 'grupo', 'holding', 'holdings',
  'the', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'and', 'of',
]);

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

function significantNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

/**
 * True when an INFERRED domain plainly does not belong to the named company.
 *
 * Strict on purpose — it only fires when NO significant token of the name
 * appears anywhere in the domain label, and the domain label appears nowhere in
 * the name. A company with no significant tokens left (e.g. "Grupo S.A.")
 * yields no verdict and is not rejected.
 */
export function isStrongNameDomainMismatch(
  companyName: string | null | undefined,
  domain: string,
): boolean {
  if (!companyName || companyName.trim() === '') return false;

  const tokens = significantNameTokens(companyName);
  if (tokens.length === 0) return false;

  const label = toRegistrableDomain(domain).split('.')[0] ?? '';
  const normalizedLabel = normalizeForComparison(label);
  if (normalizedLabel.length < 3) return false;

  const someTokenInDomain = tokens.some((t) => normalizedLabel.includes(t));
  const normalizedName = normalizeForComparison(companyName);
  const domainInName = normalizedName.includes(normalizedLabel);

  return !someTokenInDomain && !domainInName;
}

// ─── Gate input / output ──────────────────────────────────────────────────────

export type ApolloEnrichmentEligibilityContext = {
  /** ISO country the wizard is searching in. Null disables the country checks. */
  targetCountryCode: string | null;
  /** Sector requested by the wizard, for the fail-closed relevance check. */
  sector: string | null;
  /**
   * Every subindustry the search asked for, evaluated ANY-OF.
   *
   * FINAL MULTI-SUBINDUSTRY SPEND-GATE ADDENDUM § 2 — this used to be a single
   * `subindustry`, and that made the gate order-dependent: the search queries all
   * of them with ANY-OF, so judging a candidate against only the first rejected
   * companies that plainly matched the second. A list is the type-level guarantee
   * that no caller can hand a spend gate one value out of five again.
   */
  subindustries?: readonly (string | null | undefined)[] | null;
  /**
   * SECTOR-EVIDENCE-BOOTSTRAP-1 — whether this run may spend to ACQUIRE the
   * classification evidence the search never returned, for a sector with no
   * signal policy.
   *
   * Absent ⇒ not authorised, so an unmapped sector stays `sector_not_mapped` and
   * every existing caller keeps its exact decisions.
   */
  sectorEvidenceBootstrap?: ApolloSectorEvidenceBootstrapAuthorization | null;
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
   * Full domains already accepted earlier in THIS run. A repeat is a
   * preliminary duplicate — the definitive dedup still runs later on canonical
   * identity; this only prevents paying twice inside one execution.
   */
  seenDomainsInRun?: ReadonlySet<string>;
};

export type ApolloEnrichmentEligibility =
  | {
      eligible: true;
      domain: string;
      registrableDomain: string;
      /** How the domain was obtained. Drives the ownership policy. */
      domainSource: 'asserted' | 'inferred';
      /**
       * A positive match, "the provider said nothing about sector", or — under
       * SECTOR-EVIDENCE-BOOTSTRAP-1 — "there is no policy for this sector and the
       * provider said nothing either, and this run may pay to find out".
       */
      sectorDecision: Extract<
        ApolloPaidSectorRelevanceDecision,
        | 'relevant'
        | 'sector_evidence_missing_needs_enrichment'
        | 'sector_evidence_missing_bootstrap_eligible'
      >;
      matchedSectorTerms: string[];
      /** Non-blocking observations recorded for later review. */
      warnings: ApolloEnrichmentEligibilityWarning[];
    }
  | {
      eligible: false;
      domain: string | null;
      registrableDomain: string | null;
      domainSource: 'asserted' | 'inferred' | null;
      skipReason: ApolloEnrichmentIneligibilityReason;
      detail: string | null;
      warnings: ApolloEnrichmentEligibilityWarning[];
    };

/** Reads the country Apollo reported for the organization, when present. */
function readOrganizationCountry(result: WebSearchResult): string | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  for (const key of ['country_code', 'country']) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim() !== '') {
      const normalized = value.trim().toUpperCase();
      // Only 2-letter ISO codes are comparable; a country NAME is ambiguous
      // across languages and must not produce a mismatch on its own.
      if (/^[A-Z]{2}$/.test(normalized)) return normalized;
    }
  }
  return null;
}

/** Reads the domain the result itself declares (Apollo's primary_domain). */
function readDeclaredDomain(result: WebSearchResult): string | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  const declared = meta?.['domain'];
  return typeof declared === 'string' && declared.trim() !== '' ? declared.trim() : null;
}

/**
 * Reads the hostname of the result URL, when it parses.
 *
 * AGENT1-APOLLO-NET-NEW-PAGINATION § 20 — a candidate with neither a declared
 * domain nor a website falls back to `https://apollo.io/companies/{id}`
 * (`mapApolloOrganizationToSearchResult`), a synthetic profile URL, never the
 * company's own site. Reading its hostname as the candidate's domain would
 * silently try to enrich "apollo.io" itself. `extractDomainFromSearchResult`
 * (the cascade's own domain reader) already excludes this; this gate did not,
 * so it stays the one path that could still leak it into `invalid_domain`'s
 * sibling — a false `eligible: true`.
 */
function readUrlHost(result: WebSearchResult): string | null {
  if (!result.url) return null;
  try {
    const hostname = new URL(result.url).hostname;
    return hostname === 'apollo.io' || hostname.endsWith('.apollo.io') ? null : hostname;
  } catch {
    return null;
  }
}

/**
 * Resolves the domain and records how it was obtained.
 *
 * `asserted` — Apollo stated a primary_domain. Treated as fact.
 * `inferred` — no declared domain; taken from the result URL, which is a guess
 *              and therefore subject to the ownership check.
 *
 * Deliberately local rather than imported from the cascade: the cascade imports
 * this gate, and a two-way import would make the module graph circular for the
 * sake of six lines.
 */
function resolveCandidateDomain(
  result: WebSearchResult,
): { domain: string; source: 'asserted' | 'inferred' } | null {
  const declared = readDeclaredDomain(result);
  if (declared) return { domain: stripWww(declared), source: 'asserted' };
  const host = readUrlHost(result);
  if (host) return { domain: stripWww(host), source: 'inferred' };
  return null;
}

/**
 * Decides whether one candidate may be sent to the paid Apollo Organization
 * Enrichment endpoint.
 *
 * Checks run in APOLLO_ENRICHMENT_GATE_ORDER and stop at the first rejection,
 * so the reported reason is always the earliest — and cheapest — that applies.
 * Nothing here calls a provider.
 */
export function evaluateApolloEnrichmentEligibility(
  result: WebSearchResult,
  context: ApolloEnrichmentEligibilityContext,
): ApolloEnrichmentEligibility {
  const target = context.targetCountryCode?.trim().toUpperCase() || null;
  const warnings: ApolloEnrichmentEligibilityWarning[] = [];

  // 1. The country the provider itself reported disagrees with the search.
  const organizationCountry = readOrganizationCountry(result);
  if (target && organizationCountry && organizationCountry !== target) {
    return {
      eligible: false,
      domain: null,
      registrableDomain: null,
      domainSource: null,
      skipReason: 'country_mismatch',
      detail: `${organizationCountry}!=${target}`,
      warnings,
    };
  }

  // 2. A domain must exist and be structurally sane before anything can be
  //    derived from it.
  const resolved = resolveCandidateDomain(result);
  if (!resolved || !isStructurallyValidDomain(resolved.domain)) {
    return {
      eligible: false,
      domain: resolved?.domain ?? null,
      registrableDomain: null,
      domainSource: resolved?.source ?? null,
      skipReason: 'invalid_domain',
      detail: null,
      warnings,
    };
  }
  const { domain, source: domainSource } = resolved;
  const registrableDomain = toRegistrableDomain(domain);

  // 3. ccTLD contradicts the search country. `falabella.com.pe` in a Colombian
  //    search is the canonical case: a real company, wrong market.
  const tldCountry = resolveCountryFromDomainTld(domain);
  if (target && tldCountry && tldCountry !== target) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      domainSource,
      skipReason: 'tld_country_mismatch',
      detail: `${tldCountry}!=${target}`,
      warnings,
    };
  }

  // 4. Free mail providers are not enrichable organizations.
  if (MAIL_PROVIDER_DOMAINS.has(registrableDomain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      domainSource,
      skipReason: 'generic_or_mail_provider_domain',
      detail: registrableDomain,
      warnings,
    };
  }

  // 5. Ownership. The policy differs by how the domain was obtained:
  //
    //   inferred + strong mismatch → REJECT. We guessed the domain from a URL and
    //     it plainly is not this company's; paying would enrich someone else.
    //   asserted + name mismatch   → WARN only. Apollo states primary_domain as
    //     fact, and the name↔domain similarity heuristic was written for inferred
    //     Tavily URLs. Applied to an asserted domain it rejects correct pairs —
    //     `Bancolombia S.A.` / `grupobancolombia.com` scores as a mismatch.
  const nameMismatch = isStrongNameDomainMismatch(result.title, domain);
  if (nameMismatch) {
    if (domainSource === 'inferred') {
      return {
        eligible: false,
        domain,
        registrableDomain,
        domainSource,
        skipReason: 'inferred_domain_ownership_mismatch',
        detail: registrableDomain,
        warnings,
      };
    }
    warnings.push('asserted_domain_name_mismatch');
  }

  // 6. The domain is a platform profile, not the company's own site.
  if (EXTERNAL_PLATFORM_DOMAINS.has(registrableDomain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      domainSource,
      skipReason: 'external_platform_domain',
      detail: registrableDomain,
      warnings,
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
      domainSource,
      skipReason: 'cooldown_active',
      detail: null,
      warnings,
    };
  }

  // 8. Already accepted earlier in this same run.
  if (context.seenDomainsInRun?.has(domain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      domainSource,
      skipReason: 'preliminary_duplicate',
      detail: null,
      warnings,
    };
  }

  // 9. Enriched in an earlier run — the data is already ours.
  if (context.alreadyProcessedDomains?.has(domain)) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      domainSource,
      skipReason: 'organization_already_processed',
      detail: null,
      warnings,
    };
  }

  // 10/11. Sector relevance, fail-closed where failing closed is meaningful.
  //
  //   sector_not_mapped              → reject. No policy exists for this sector,
  //                                    so nothing authorises paying for it.
  //   sector_relevance_contradicted  → reject. Apollo described this company's
  //                                    sector and it is not the one searched —
  //                                    Citigroup in a supermarket search.
  //   sector_evidence_missing_
  //     needs_enrichment             → ALLOW under the cap. Apollo described no
  //                                    sector at all; buying that description is
  //                                    exactly what the cascade is for. Not a
  //                                    passthrough — a structured reason.
  // ADDENDUM § 2 — ANY-OF sobre TODAS las subindustrias pedidas. Un candidato
  // plausible para la segunda ya no lo rechaza el veredicto de la primera.
  // SECTOR-EVIDENCE-BOOTSTRAP-1 — la autorización de la corrida viaja al veredicto:
  // es lo único que puede convertir «no hay política» en «se puede preguntar», y
  // sólo cuando el proveedor no declaró NADA que juzgar.
  const sectorRelevance = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
    result,
    context.sector,
    context.subindustries ?? null,
    { sectorEvidenceBootstrap: context.sectorEvidenceBootstrap ?? null },
  );
  if (
    sectorRelevance.decision === 'sector_not_mapped' ||
    sectorRelevance.decision === 'sector_relevance_contradicted'
  ) {
    return {
      eligible: false,
      domain,
      registrableDomain,
      domainSource,
      skipReason: sectorRelevance.decision,
      detail: null,
      warnings,
    };
  }

  return {
    eligible: true,
    domain,
    registrableDomain,
    domainSource,
    sectorDecision: sectorRelevance.decision,
    matchedSectorTerms: sectorRelevance.matchedTerms,
    warnings,
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
