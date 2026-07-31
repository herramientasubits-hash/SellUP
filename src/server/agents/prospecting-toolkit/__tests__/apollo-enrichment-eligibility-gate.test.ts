/**
 * Tests — apollo-enrichment-eligibility-gate.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * Every rejection here costs 0 Apollo calls and 0 credits. The three cases from
 * the real QA batch — falabella.com.pe in a Colombian search, Citigroup in a
 * supermarket search, and gmail/Google — must all be blocked before payment.
 *
 * Pure module: no network, no provider call, no process.env.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { WebSearchResult } from '../types';
import {
  APOLLO_ENRICHMENT_GATE_ORDER,
  buildEmptyEnrichmentGateCounts,
  evaluateApolloEnrichmentEligibility,
  isStrongNameDomainMismatch,
  isStructurallyValidDomain,
  resolveCountryFromDomainTld,
  toRegistrableDomain,
} from '../apollo-enrichment-eligibility-gate';

/** Builds a candidate. `domain` in metadata = Apollo ASSERTED it. */
function candidate(over: {
  title?: string;
  url?: string | null;
  domain?: string | null;
  country?: string | null;
  industry?: string | null;
  keywords?: string[];
  description?: string | null;
} = {}): WebSearchResult {
  const metadata: Record<string, unknown> = {};
  if (over.domain !== undefined) metadata['domain'] = over.domain;
  if (over.country !== undefined) metadata['country_code'] = over.country;
  if (over.industry !== undefined) metadata['industry'] = over.industry;
  if (over.keywords !== undefined) metadata['keywords'] = over.keywords;
  if (over.description !== undefined) metadata['short_description'] = over.description;

  return {
    title: over.title ?? 'Acme Supermercados',
    url: over.url === undefined ? 'https://acme.com' : (over.url ?? undefined),
    snippet: '',
    metadata,
  } as unknown as WebSearchResult;
}

const SUPERMARKET_SEARCH = {
  targetCountryCode: 'CO',
  sector: 'Retail y Consumo',
  subindustry: 'Supermercados e Hipermercados',
};

describe('A. The three real QA cases are blocked before payment', () => {
  it('falabella.com.pe is rejected for a Colombian search (wrong market)', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Falabella Retail Colombia',
        domain: 'falabella.com.pe',
        url: 'https://falabella.com.pe',
      }),
      SUPERMARKET_SEARCH,
    );

    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.skipReason, 'tld_country_mismatch');
    assert.equal(result.eligible === false && result.detail, 'PE!=CO');
  });

  it('Citigroup is rejected for a supermarket search (evidence contradicts)', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Citigroup',
        domain: 'citigroup.com',
        url: 'https://citigroup.com',
        industry: 'banking',
        keywords: ['retail banking', 'financial services'],
      }),
      SUPERMARKET_SEARCH,
    );

    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.skipReason, 'sector_relevance_contradicted');
  });

  it('"retail banking" alone never satisfies a retail search', () => {
    // The bare token `retail` is a substring of `retail banking`; if it were a
    // signal, Citigroup would pass. It must not be.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ title: 'Citigroup', domain: 'citigroup.com', industry: 'retail banking' }),
      { targetCountryCode: 'CO', sector: 'Retail y Consumo' },
    );
    assert.equal(result.eligible, false);
  });

  it('gmail.com is rejected as a mail provider', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ title: 'Some Company', domain: 'gmail.com', url: 'https://gmail.com' }),
      SUPERMARKET_SEARCH,
    );

    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.skipReason, 'generic_or_mail_provider_domain');
  });

  it('google.com is rejected as an external platform', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ title: 'Google', domain: 'google.com', url: 'https://google.com' }),
      SUPERMARKET_SEARCH,
    );

    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.skipReason, 'external_platform_domain');
  });
});

describe('B. A real supermarket IS eligible', () => {
  it('accepts a Colombian supermarket with matching sector evidence', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Supermercados Olimpica',
        domain: 'olimpica.com',
        url: 'https://olimpica.com',
        country: 'CO',
        industry: 'retail',
        keywords: ['supermercado', 'grocery'],
      }),
      SUPERMARKET_SEARCH,
    );

    assert.equal(result.eligible, true, 'a real supermarket must not be gated out');
    assert.ok(result.eligible === true && result.matchedSectorTerms.length > 0);
  });

  it('a supermarket whose Apollo industry is "retail" is not treated as a buyer', () => {
    // The buyer/vendor exclusion was written for the corporate-training gate.
    // Applied here it would reject every real supermarket.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Grupo Exito',
        domain: 'grupoexito.com.co',
        url: 'https://grupoexito.com.co',
        industry: 'retail',
        keywords: ['hipermercado'],
      }),
      SUPERMARKET_SEARCH,
    );
    assert.equal(result.eligible, true);
  });
});

describe('C. Sector policy for paid operations', () => {
  it('an unmapped sector fails closed — no policy, no spend', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ title: 'Acme', domain: 'acme.com', industry: 'software' }),
      { targetCountryCode: 'CO', sector: 'SectorQueNoExiste2099' },
    );

    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.skipReason, 'sector_not_mapped');
  });

  it('no sector at all is the extreme case of unmapped', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ title: 'Acme', domain: 'acme.com' }),
      { targetCountryCode: null, sector: null },
    );

    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.skipReason, 'sector_not_mapped');
  });

  it('a mapped sector with NO evidence is eligible, with a structured reason', () => {
    // Buying that description is what the enrichment cascade is for. This is
    // deliberately not a generic passthrough.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ title: 'Bare Co', domain: 'bareco.com', url: 'https://bareco.com' }),
      SUPERMARKET_SEARCH,
    );

    assert.equal(result.eligible, true);
    assert.equal(
      result.eligible === true && result.sectorDecision,
      'sector_evidence_missing_needs_enrichment',
    );
  });
});

describe('D. Ownership policy depends on how the domain was obtained', () => {
  it('an INFERRED domain with a strong mismatch is rejected', () => {
    // No metadata.domain ⇒ the domain is a guess from the URL.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Supermercados Olimpica',
        url: 'https://totallyunrelatedbusiness.com/page',
        keywords: ['supermercado'],
      }),
      SUPERMARKET_SEARCH,
    );

    assert.equal(result.eligible, false);
    assert.equal(
      result.eligible === false && result.skipReason,
      'inferred_domain_ownership_mismatch',
    );
  });

  it('an ASSERTED domain with a name mismatch only WARNS', () => {
    // Apollo states primary_domain as fact; the similarity heuristic was written
    // for inferred URLs and rejects correct pairs when applied here.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Bancolombia S.A.',
        domain: 'grupobancolombia.com',
        url: 'https://grupobancolombia.com',
        keywords: ['supermercado'],
      }),
      SUPERMARKET_SEARCH,
    );

    assert.equal(result.eligible, true, 'an asserted domain is not rejected on similarity');
    assert.equal(result.eligible === true && result.domainSource, 'asserted');
  });

  it('the similarity heuristic itself stays conservative', () => {
    assert.equal(isStrongNameDomainMismatch('Acme Corp', 'acme.com'), false);
    assert.equal(isStrongNameDomainMismatch('Grupo Exito', 'grupoexito.com.co'), false);
    assert.equal(isStrongNameDomainMismatch('Acme Corp', 'zzzunrelated.com'), true);
    // No significant tokens left ⇒ no verdict, never a rejection.
    assert.equal(isStrongNameDomainMismatch('Grupo S.A.', 'zzzunrelated.com'), false);
    assert.equal(isStrongNameDomainMismatch(null, 'anything.com'), false);
  });
});

describe('E. Country, domain shape, cooldown and duplicates', () => {
  it('rejects a provider-reported country different from the search country', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ domain: 'acme.com', country: 'MX', keywords: ['supermercado'] }),
      SUPERMARKET_SEARCH,
    );
    assert.equal(result.eligible === false && result.skipReason, 'country_mismatch');
  });

  it('rejects a structurally invalid domain', () => {
    for (const bad of ['not a domain', 'http://acme.com', 'acme', 'a@b.com', '']) {
      const result = evaluateApolloEnrichmentEligibility(
        candidate({ domain: bad, url: null }),
        SUPERMARKET_SEARCH,
      );
      assert.equal(result.eligible, false, `${bad} must not be enriched`);
      assert.equal(result.eligible === false && result.skipReason, 'invalid_domain');
    }
  });

  it('rejects a domain in cooldown', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ domain: 'olimpica.com', keywords: ['supermercado'] }),
      { ...SUPERMARKET_SEARCH, domainsInCooldown: new Set(['olimpica.com']) },
    );
    assert.equal(result.eligible === false && result.skipReason, 'cooldown_active');
  });

  it('rejects a domain already seen in this run', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ domain: 'olimpica.com', keywords: ['supermercado'] }),
      { ...SUPERMARKET_SEARCH, seenDomainsInRun: new Set(['olimpica.com']) },
    );
    assert.equal(result.eligible === false && result.skipReason, 'preliminary_duplicate');
  });

  it('rejects an organization enriched in a previous run', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ domain: 'olimpica.com', keywords: ['supermercado'] }),
      { ...SUPERMARKET_SEARCH, alreadyProcessedDomains: new Set(['olimpica.com']) },
    );
    assert.equal(result.eligible === false && result.skipReason, 'organization_already_processed');
  });

  it('dedup is keyed by the FULL domain, not the registrable one', () => {
    // Apollo bills per exact domain: a.example.com and b.example.com are two
    // organizations and two charges.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ domain: 'b.example.com', keywords: ['supermercado'] }),
      { ...SUPERMARKET_SEARCH, seenDomainsInRun: new Set(['a.example.com']) },
    );
    assert.equal(result.eligible, true, 'a sibling subdomain is a different company');
  });
});

describe('F. Helpers', () => {
  it('resolves ccTLDs and ignores generic TLDs', () => {
    assert.equal(resolveCountryFromDomainTld('falabella.com.pe'), 'PE');
    assert.equal(resolveCountryFromDomainTld('grupoexito.com.co'), 'CO');
    assert.equal(resolveCountryFromDomainTld('acme.com'), null, 'generic TLD carries no country');
    assert.equal(resolveCountryFromDomainTld('acme.io'), null);
  });

  it('computes registrable domains including second-level suffixes', () => {
    assert.equal(toRegistrableDomain('www.acme.com'), 'acme.com');
    assert.equal(toRegistrableDomain('shop.grupoexito.com.co'), 'grupoexito.com.co');
    assert.equal(toRegistrableDomain('a.example.com'), 'example.com');
  });

  it('validates domain shape', () => {
    assert.equal(isStructurallyValidDomain('acme.com'), true);
    assert.equal(isStructurallyValidDomain('falabella.com.pe'), true);
    assert.equal(isStructurallyValidDomain(null), false);
    assert.equal(isStructurallyValidDomain('acme'), false);
  });

  it('the gate order is declared and the counter map covers it', () => {
    const counts = buildEmptyEnrichmentGateCounts();
    for (const reason of APOLLO_ENRICHMENT_GATE_ORDER) {
      assert.equal(counts[reason], 0, `${reason} must be counted`);
    }
    assert.equal(counts.eligible, 0);
    assert.equal(APOLLO_ENRICHMENT_GATE_ORDER[0], 'country_mismatch', 'cheapest check first');
  });
});
