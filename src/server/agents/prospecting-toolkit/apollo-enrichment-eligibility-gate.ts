/**
 * apollo-enrichment-eligibility-gate.ts — Cheap, deterministic gates that run
 * BEFORE the paid Apollo Organization Enrichment call.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§7, §8).
 *
 * The defect this closes
 * ----------------------
 * The provider used to run the enrichment cascade on every mapped result, before
 * any gate. In A1-APOLLO-LIVE-QA-1 (target country CO) the single available
 * enrichment credit was spent on `Falabella Retail Colombia /
 * primary_domain = falabella.com.pe` — a candidate already rejectable by country
 * — while `citi.com` and `google.com` (a mail provider, surfaced as
 * `gmail.com.co`) were only skipped because the cap was already exhausted.
 *
 * New ordering (§7):
 *   Apollo Organization Search
 *     → normalisation
 *     → CHEAP GATES  ← this module
 *     → enrichment eligibility
 *     → Apollo Organization Enrichment (paid)
 *     → per-country legal enrichment
 *     → canonical identity
 *     → definitive deduplication
 *     → pending_review persistence
 *
 * Only the CHEAP half moves earlier. Definitive legal dedup stays after official
 * enrichment — this module's `duplicate_preliminary_domain` is a preliminary,
 * within-run domain check, never a replacement for it.
 *
 * Fail-closed for paid work: a candidate we cannot justify enriching is skipped
 * with a structured reason and zero enrichment credits. Skipping enrichment never
 * discards the candidate — it continues to the sector gate unenriched.
 *
 * Pure: no I/O, no env, no Apollo calls, no clock.
 */

import type { WebSearchResult } from './types';
import { evaluateCountryCompatibility } from './country-compatibility';
import { evaluateCompanyOwnership } from './company-ownership-gate';
import { evaluateExternalPlatformGate } from './external-platform-blocklist';
import { hasCheapSectorEvidence } from './apollo-sector-relevance-gate';

export const APOLLO_ENRICHMENT_ELIGIBILITY_GATE_VERSION = 'apollo_enrichment_eligibility_v1';

/** Why a candidate must not consume a paid enrichment credit. */
export type ApolloEnrichmentSkipReason =
  | 'invalid_domain'
  | 'generic_email_provider_domain'
  | 'country_tld_incompatible'
  | 'external_platform'
  | 'name_domain_ownership_mismatch'
  | 'identity_already_processed'
  | 'identity_cooldown_active'
  | 'duplicate_preliminary_domain'
  | 'sector_not_mapped'
  | 'sector_relevance_unverified';

/**
 * Free mailbox / consumer platform domains. A result whose "company domain" is
 * one of these is a mail provider surfaced as a company, never an enrichment
 * target. `google.com` is included deliberately: Apollo returned it as the
 * primary domain for the result named `gmail.com.co`.
 */
const GENERIC_EMAIL_PROVIDER_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'google.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.es',
  'ymail.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'gmx.com',
  'mail.com',
  'mail.ru',
  'yandex.com',
  'yandex.ru',
  'qq.com',
  '163.com',
  '126.com',
];

/** Domains that are platforms, not candidate companies. */
const NON_COMPANY_PLATFORM_DOMAINS: readonly string[] = [
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'wikipedia.org',
  'crunchbase.com',
  'glassdoor.com',
  'indeed.com',
  'apollo.io',
  'zoominfo.com',
  'bloomberg.com',
];

function normalizeDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return null;
  const withoutProtocol = trimmed.replace(/^[a-z]+:\/\//, '');
  const host = withoutProtocol.split('/')[0]?.replace(/^www\./, '') ?? '';
  if (host === '') return null;
  // A domain must have at least one dot and only domain-legal characters.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    return null;
  }
  return host;
}

function matchesDomainList(domain: string, list: readonly string[]): boolean {
  return list.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

// ── Candidate projection ─────────────────────────────────────────────────────

/** The only candidate facts these gates read — all available pre-enrichment. */
export type ApolloEnrichmentCandidateFacts = {
  name: string | null;
  domain: string | null;
  url: string | null;
  linkedinUrl: string | null;
  /** Apollo organization id when the search returned one. */
  organizationId: string | null;
  /** Free-text signals already present without paying for enrichment. */
  industryHints: readonly string[];
  keywordHints: readonly string[];
};

/** Extracts pre-enrichment facts from a mapped Apollo result. No paid fields. */
export function extractApolloCandidateFacts(
  result: WebSearchResult,
): ApolloEnrichmentCandidateFacts {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  const strArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  const industryHints = [str(meta['industry'])].filter((v): v is string => v !== null);
  const keywordHints = [
    ...strArray(meta['keywords']),
    ...(str(meta['short_description']) !== null ? [str(meta['short_description']) as string] : []),
  ];

  return {
    name: str(result.title),
    domain: str(meta['domain']),
    url: str(result.url),
    linkedinUrl: str(meta['linkedin_url']),
    organizationId: str(meta['apollo_organization_id']) ?? str(meta['organization_id']),
    industryHints,
    keywordHints,
  };
}

// ── Evaluation context ───────────────────────────────────────────────────────

export type ApolloEnrichmentEligibilityContext = {
  /** Target country of the run, e.g. `'CO'`. */
  targetCountryCode: string | null;
  /** Sector requested by the wizard, e.g. `'Retail y Consumo'`. */
  sector: string | null;
  /** Primary subindustry, e.g. `'Supermercados e Hipermercados'`. */
  subindustry: string | null;
  /**
   * Identity keys already processed earlier in THIS run (previous queries or
   * rounds). Accumulated upstream; empty when the caller has no run-level state.
   */
  processedIdentityKeys?: ReadonlySet<string>;
  /** Identity keys under a recent-activity cooldown. */
  identityCooldownKeys?: ReadonlySet<string>;
};

/** Stable identity key for run-level dedup and cooldown lookups. */
export function buildApolloIdentityKey(
  facts: ApolloEnrichmentCandidateFacts,
): string | null {
  if (facts.organizationId !== null) return `apollo_org:${facts.organizationId}`;
  const domain = normalizeDomain(facts.domain) ?? normalizeDomain(facts.url);
  if (domain !== null) return `domain:${domain}`;
  return null;
}

export type ApolloEnrichmentDecision = {
  /** Index in the input array — lets callers merge results back in place. */
  index: number;
  eligible: boolean;
  skipReason: ApolloEnrichmentSkipReason | null;
  /** Secret-free detail, e.g. `foreign_country_tld:.com.pe:PE`. */
  detail: string | null;
  identityKey: string | null;
  domain: string | null;
};

export type ApolloEnrichmentEligibilityMeta = {
  gate_version: string;
  checked_count: number;
  eligible_count: number;
  skipped_count: number;
  skipped_reasons: Record<string, number>;
  target_country_code: string | null;
  sector: string | null;
  subindustry: string | null;
  /** True when neither sector nor subindustry has a signal mapping. */
  sector_mapping_missing: boolean;
};

export type ApolloEnrichmentEligibilityResult = {
  decisions: ApolloEnrichmentDecision[];
  eligibleIndices: number[];
  meta: ApolloEnrichmentEligibilityMeta;
};

/**
 * Evaluates every candidate against the cheap gates, in a fixed order chosen so
 * the most decisive and cheapest checks fire first. The first failing gate wins,
 * which keeps the reported reason stable and explainable.
 */
export function evaluateApolloEnrichmentEligibility(
  results: readonly WebSearchResult[],
  context: ApolloEnrichmentEligibilityContext,
): ApolloEnrichmentEligibilityResult {
  const processed = context.processedIdentityKeys ?? new Set<string>();
  const cooldown = context.identityCooldownKeys ?? new Set<string>();

  // Preliminary within-call duplicate detection: first occurrence wins.
  const seenDomains = new Set<string>();
  const seenIdentities = new Set<string>();

  const decisions: ApolloEnrichmentDecision[] = [];
  const skippedReasons: Record<string, number> = {};
  let sectorMappingMissing = false;

  const record = (
    index: number,
    skipReason: ApolloEnrichmentSkipReason,
    detail: string | null,
    identityKey: string | null,
    domain: string | null,
  ): void => {
    skippedReasons[skipReason] = (skippedReasons[skipReason] ?? 0) + 1;
    decisions.push({ index, eligible: false, skipReason, detail, identityKey, domain });
  };

  for (let index = 0; index < results.length; index += 1) {
    const facts = extractApolloCandidateFacts(results[index]);
    const domain = normalizeDomain(facts.domain) ?? normalizeDomain(facts.url);
    const identityKey = buildApolloIdentityKey(facts);

    // 1. Invalid / absent domain — nothing to enrich against.
    if (domain === null) {
      record(index, 'invalid_domain', 'no_resolvable_domain', identityKey, null);
      continue;
    }

    // 2. Free mailbox / consumer platform posing as a company domain.
    if (matchesDomainList(domain, GENERIC_EMAIL_PROVIDER_DOMAINS)) {
      record(index, 'generic_email_provider_domain', domain, identityKey, domain);
      continue;
    }

    // 3. Country incompatibility, including a foreign ccTLD.
    if (context.targetCountryCode !== null && context.targetCountryCode.trim() !== '') {
      const countryCheck = evaluateCountryCompatibility(
        facts.url ?? domain,
        context.targetCountryCode,
      );
      if (!countryCheck.compatible) {
        record(index, 'country_tld_incompatible', countryCheck.reason, identityKey, domain);
        continue;
      }
    }

    // 4. External platform rather than a candidate company.
    if (matchesDomainList(domain, NON_COMPANY_PLATFORM_DOMAINS)) {
      record(index, 'external_platform', domain, identityKey, domain);
      continue;
    }
    const platformCheck = evaluateExternalPlatformGate(facts.url ?? domain, facts.name);
    if (!platformCheck.allowed) {
      record(
        index,
        'external_platform',
        platformCheck.platformType ?? 'blocked_platform',
        identityKey,
        domain,
      );
      continue;
    }

    // 5. The domain does not plausibly belong to the named company.
    if (facts.name !== null) {
      const ownership = evaluateCompanyOwnership(facts.name, facts.url, domain);
      if (!ownership.allowed) {
        record(
          index,
          'name_domain_ownership_mismatch',
          ownership.confidence,
          identityKey,
          domain,
        );
        continue;
      }
    }

    // 6. Identity already processed earlier in this run.
    if (identityKey !== null && processed.has(identityKey)) {
      record(index, 'identity_already_processed', 'seen_earlier_in_run', identityKey, domain);
      continue;
    }

    // 7. Identity under cooldown.
    if (identityKey !== null && cooldown.has(identityKey)) {
      record(index, 'identity_cooldown_active', 'recent_identity_cooldown', identityKey, domain);
      continue;
    }

    // 8. Preliminary duplicate inside the current result set.
    if (seenDomains.has(domain) || (identityKey !== null && seenIdentities.has(identityKey))) {
      record(index, 'duplicate_preliminary_domain', domain, identityKey, domain);
      continue;
    }

    // 9. Sector relevance from FREE signals only.
    const sectorEvidence = hasCheapSectorEvidence({
      sector: context.sector,
      subindustry: context.subindustry,
      name: facts.name,
      domain,
      url: facts.url,
      linkedinUrl: facts.linkedinUrl,
      industryHints: facts.industryHints,
      keywordHints: facts.keywordHints,
    });
    if (sectorEvidence.outcome === 'sector_not_mapped') {
      sectorMappingMissing = true;
      record(index, 'sector_not_mapped', sectorEvidence.detail, identityKey, domain);
      continue;
    }
    if (sectorEvidence.outcome === 'unverified') {
      record(index, 'sector_relevance_unverified', sectorEvidence.detail, identityKey, domain);
      continue;
    }

    seenDomains.add(domain);
    if (identityKey !== null) seenIdentities.add(identityKey);
    decisions.push({ index, eligible: true, skipReason: null, detail: null, identityKey, domain });
  }

  const eligibleIndices = decisions.filter((d) => d.eligible).map((d) => d.index);

  return {
    decisions,
    eligibleIndices,
    meta: {
      gate_version: APOLLO_ENRICHMENT_ELIGIBILITY_GATE_VERSION,
      checked_count: results.length,
      eligible_count: eligibleIndices.length,
      skipped_count: results.length - eligibleIndices.length,
      skipped_reasons: skippedReasons,
      target_country_code: context.targetCountryCode,
      sector: context.sector,
      subindustry: context.subindustry,
      sector_mapping_missing: sectorMappingMissing,
    },
  };
}
