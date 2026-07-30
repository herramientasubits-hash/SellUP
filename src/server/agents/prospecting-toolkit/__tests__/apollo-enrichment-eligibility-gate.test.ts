/**
 * Tests — apollo-enrichment-eligibility-gate.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * Every rejection this gate produces is a credit not spent. The three cases the
 * milestone was opened for are asserted by name: Falabella `.com.pe` in a
 * Colombian search, Citigroup in a supermarket search, and `gmail.com`.
 *
 * A. Domain helpers
 * B. The three canonical zero-credit rejections
 * C. Country checks
 * D. Domain quality checks
 * E. Cooldown / duplicate / already-processed
 * F. Sector gates (fail-closed where failing closed is meaningful)
 * G. Precedence — the earliest and cheapest reason wins
 * H. Eligible candidates
 * I. Diagnostics
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_ENRICHMENT_GATE_ORDER,
  buildEmptyEnrichmentGateCounts,
  evaluateApolloEnrichmentEligibility,
  isStructurallyValidDomain,
  resolveCountryFromDomainTld,
  toRegistrableDomain,
} from '../apollo-enrichment-eligibility-gate';
import type { WebSearchResult } from '../types';

function candidate(overrides: Partial<WebSearchResult> = {}): WebSearchResult {
  const metadata = overrides.metadata ?? { domain: 'acme.com' };
  const declared = typeof metadata['domain'] === 'string' ? metadata['domain'] : null;
  return {
    title: 'Acme SAS',
    // The URL host follows the declared domain unless a test sets it on purpose.
    // A fixture whose declared domain and URL host name different companies IS
    // an ownership mismatch, so a fixed default would make every candidate that
    // only overrides `metadata.domain` fail for the wrong reason.
    url: declared ? `https://${declared}` : 'https://acme.com',
    rank: 1,
    provider: 'apollo_organizations',
    ...overrides,
    metadata,
  };
}

/** A search for Colombian supermarkets — the QA scenario. */
const CO_SUPERMARKETS = {
  targetCountryCode: 'CO',
  sector: 'Retail y Consumo',
  subindustry: 'Supermercados e Hipermercados',
} as const;

// ── A. Domain helpers ─────────────────────────────────────────────────────────

describe('A — domain helpers', () => {
  it('A1: a ccTLD resolves to its country', () => {
    assert.equal(resolveCountryFromDomainTld('falabella.com.pe'), 'PE');
    assert.equal(resolveCountryFromDomainTld('exito.com.co'), 'CO');
    assert.equal(resolveCountryFromDomainTld('empresa.mx'), 'MX');
  });

  it('A2: a generic TLD carries no country signal', () => {
    // Reading .com as "not Colombia" would reject most real candidates.
    for (const domain of ['acme.com', 'acme.net', 'acme.io', 'acme.org']) {
      assert.equal(resolveCountryFromDomainTld(domain), null, domain);
    }
  });

  it('A3: a domain without a dot has no TLD country', () => {
    assert.equal(resolveCountryFromDomainTld('localhost'), null);
  });

  it('A4: structural validation rejects URLs, emails and whitespace', () => {
    assert.equal(isStructurallyValidDomain('acme.com'), true);
    assert.equal(isStructurallyValidDomain('sub.acme.com.co'), true);
    for (const bad of [
      null,
      undefined,
      '',
      '   ',
      'acme',
      'https://acme.com',
      'acme.com/path',
      'user@acme.com',
      'acme.com:443',
      'acme .com',
      'acme.c',
      '-acme.com',
    ]) {
      assert.equal(isStructurallyValidDomain(bad), false, String(bad));
    }
  });

  it('A5: registrable domain collapses www and subdomains', () => {
    assert.equal(toRegistrableDomain('www.acme.com'), 'acme.com');
    assert.equal(toRegistrableDomain('careers.acme.com'), 'acme.com');
  });

  it('A6: registrable domain keeps three labels for compound second levels', () => {
    assert.equal(toRegistrableDomain('www.exito.com.co'), 'exito.com.co');
    assert.equal(toRegistrableDomain('tienda.falabella.com.pe'), 'falabella.com.pe');
  });
});

// ── B. The three canonical zero-credit rejections ─────────────────────────────

describe('B — the rejections this milestone was opened for', () => {
  it('B1: falabella.com.pe in a Colombian search — wrong market, 0 credits', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Falabella',
        url: 'https://www.falabella.com.pe',
        metadata: { domain: 'falabella.com.pe' },
      }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.skipReason, 'tld_country_mismatch');
    assert.equal(result.eligible === false && result.detail, 'PE!=CO');
  });

  it('B2: Citigroup in a supermarket search — wrong sector, 0 credits', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Citigroup',
        url: 'https://www.citigroup.com',
        metadata: { domain: 'citigroup.com', industry: 'banking' },
      }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, false);
    assert.equal(
      result.eligible === false && result.skipReason,
      'sector_relevance_unverified',
    );
  });

  it('B3: gmail.com — not an organization at all, 0 credits', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ title: 'Contacto', url: 'https://gmail.com', metadata: { domain: 'gmail.com' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, false);
    assert.equal(
      result.eligible === false && result.skipReason,
      'generic_or_mail_provider_domain',
    );
  });

  it('B4: a real Colombian supermarket in the same search is eligible', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        title: 'Grupo Exito',
        url: 'https://www.exito.com.co',
        metadata: { domain: 'exito.com.co', industry: 'supermercados' },
      }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, true);
    assert.equal(result.eligible === true && result.registrableDomain, 'exito.com.co');
  });
});

// ── C. Country checks ─────────────────────────────────────────────────────────

describe('C — country', () => {
  it('C1: a provider-reported country that disagrees rejects before parsing a domain', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'acme.com', country_code: 'US' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible === false && result.skipReason, 'country_mismatch');
    // No domain work happened yet, so none is reported.
    assert.equal(result.eligible === false && result.domain, null);
  });

  it('C2: a matching provider country passes the check', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'exito.com.co', country_code: 'co', industry: 'supermercados' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, true);
  });

  it('C3: a country NAME is ambiguous and never produces a mismatch on its own', () => {
    // 'Colombia' / 'Kolumbien' / 'Colômbia' are the same country; comparing
    // free text would reject candidates for being described in another language.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'exito.com.co', country: 'Colombia', industry: 'supermercados' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, true);
  });

  it('C4: no target country disables both country checks', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        url: 'https://falabella.com.pe',
        metadata: { domain: 'falabella.com.pe', country_code: 'PE', industry: 'supermercados' },
      }),
      { ...CO_SUPERMARKETS, targetCountryCode: null },
    );
    assert.equal(result.eligible, true);
  });

  it('C5: the target country is compared case-insensitively', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'exito.com.co', country_code: 'CO', industry: 'supermercados' } }),
      { ...CO_SUPERMARKETS, targetCountryCode: ' co ' },
    );
    assert.equal(result.eligible, true);
  });
});

// ── D. Domain quality ─────────────────────────────────────────────────────────

describe('D — domain quality', () => {
  it('D1: an unparseable URL with no declared domain is invalid_domain', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ url: 'not a url', metadata: {} }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible === false && result.skipReason, 'invalid_domain');
  });

  it('D2: a LinkedIn profile is an external platform, not the company site', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        url: 'https://www.linkedin.com/company/acme',
        metadata: { domain: 'linkedin.com' },
      }),
      CO_SUPERMARKETS,
    );
    assert.equal(
      result.eligible === false && result.skipReason,
      'external_platform_domain',
    );
  });

  it('D3: a declared domain that contradicts the URL host is an ownership mismatch', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ url: 'https://www.other-company.com/acme', metadata: { domain: 'acme.com' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible === false && result.skipReason, 'ownership_mismatch');
    assert.equal(result.eligible === false && result.detail, 'acme.com!=other-company.com');
  });

  it('D4: a platform URL does not count as an ownership mismatch', () => {
    // A company's own domain plus a LinkedIn URL is normal Apollo output, not a
    // contradiction — rejecting it would discard valid candidates.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        url: 'https://www.linkedin.com/company/exito',
        metadata: { domain: 'exito.com.co', industry: 'supermercados' },
      }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, true);
  });

  it('D5: a subdomain of the declared domain is the same owner', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        url: 'https://tienda.exito.com.co/productos',
        metadata: { domain: 'exito.com.co', industry: 'supermercados' },
      }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, true);
  });

  it('D6: the URL host is used when no domain is declared', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ url: 'https://www.exito.com.co/', metadata: { industry: 'supermercados' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, true);
    assert.equal(result.eligible === true && result.domain, 'exito.com.co');
  });
});

// ── E. Cooldown / duplicate / already processed ────────────────────────────────

describe('E — repeat protection is keyed by the FULL domain', () => {
  const ELIGIBLE = candidate({
    url: 'https://tienda.exito.com.co',
    metadata: { domain: 'tienda.exito.com.co', industry: 'supermercados' },
  });

  it('E1: a domain under cooldown is skipped', () => {
    const result = evaluateApolloEnrichmentEligibility(ELIGIBLE, {
      ...CO_SUPERMARKETS,
      domainsInCooldown: new Set(['tienda.exito.com.co']),
    });
    assert.equal(result.eligible === false && result.skipReason, 'cooldown_active');
  });

  it('E2: a domain already accepted in this run is a preliminary duplicate', () => {
    const result = evaluateApolloEnrichmentEligibility(ELIGIBLE, {
      ...CO_SUPERMARKETS,
      seenDomainsInRun: new Set(['tienda.exito.com.co']),
    });
    assert.equal(result.eligible === false && result.skipReason, 'preliminary_duplicate');
  });

  it('E3: a domain enriched in a previous run is already processed', () => {
    const result = evaluateApolloEnrichmentEligibility(ELIGIBLE, {
      ...CO_SUPERMARKETS,
      alreadyProcessedDomains: new Set(['tienda.exito.com.co']),
    });
    assert.equal(
      result.eligible === false && result.skipReason,
      'organization_already_processed',
    );
  });

  it('E4: a sibling subdomain is a different organization and a different charge', () => {
    // Apollo enrichment is keyed by the exact domain sent, so collapsing
    // a.example.com and b.example.com would silently skip real candidates.
    const result = evaluateApolloEnrichmentEligibility(ELIGIBLE, {
      ...CO_SUPERMARKETS,
      alreadyProcessedDomains: new Set(['corporativo.exito.com.co', 'exito.com.co']),
    });
    assert.equal(result.eligible, true);
  });

  it('E5: cooldown is checked before the in-run duplicate', () => {
    const result = evaluateApolloEnrichmentEligibility(ELIGIBLE, {
      ...CO_SUPERMARKETS,
      domainsInCooldown: new Set(['tienda.exito.com.co']),
      seenDomainsInRun: new Set(['tienda.exito.com.co']),
    });
    assert.equal(result.eligible === false && result.skipReason, 'cooldown_active');
  });
});

// ── F. Sector gates ───────────────────────────────────────────────────────────

describe('F — sector, fail-closed where that is meaningful', () => {
  it('F1: an unmapped sector never authorises spend', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'acme.com' } }),
      { targetCountryCode: 'CO', sector: 'Sector Inexistente' },
    );
    assert.equal(result.eligible === false && result.skipReason, 'sector_not_mapped');
  });

  it('F2: no sector at all is also unmapped — a gap is not an authorisation', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'acme.com' } }),
      { targetCountryCode: 'CO', sector: null },
    );
    assert.equal(result.eligible === false && result.skipReason, 'sector_not_mapped');
  });

  it('F3: contradicting sector evidence rejects', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'acme.com', industry: 'investment banking' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(
      result.eligible === false && result.skipReason,
      'sector_relevance_unverified',
    );
  });

  it('F4: NO sector evidence is allowed through — that is what enrichment buys', () => {
    // The cascade exists to buy sector evidence for candidates that have none,
    // and its ambiguity-first ordering enriches those first. Rejecting them
    // here would make the cascade unable to do the one thing it is for.
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ title: 'Comercial Andina SAS', metadata: { domain: 'comercialandina.com.co' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, true);
    assert.equal(
      result.eligible === true && result.sectorDecision,
      'sector_relevance_indeterminate',
    );
    assert.deepEqual(result.eligible === true && result.matchedSectorTerms, []);
  });

  it('F5: a positive sector match reports the matched terms', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'exito.com.co', industry: 'supermercados' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible === true && result.sectorDecision, 'relevant');
    assert.ok(result.eligible === true && result.matchedSectorTerms.length > 0);
  });

  it('F6: the strict subindustry signals are used when a subindustry is given', () => {
    // 'retail' alone satisfies "Retail y Consumo" but must NOT satisfy
    // "Supermercados e Hipermercados" — that is the Citigroup failure mode.
    const retailOnly = candidate({
      metadata: { domain: 'acme.com.co', industry: 'diversified retail holding' },
    });

    const broad = evaluateApolloEnrichmentEligibility(retailOnly, {
      targetCountryCode: 'CO',
      sector: 'Retail y Consumo',
      subindustry: null,
    });
    assert.equal(broad.eligible, true);

    const strict = evaluateApolloEnrichmentEligibility(retailOnly, CO_SUPERMARKETS);
    assert.equal(
      strict.eligible === false && strict.skipReason,
      'sector_relevance_unverified',
    );
  });
});

// ── G. Precedence ─────────────────────────────────────────────────────────────

describe('G — the earliest and cheapest reason wins', () => {
  it('G1: the declared order is the evaluation order', () => {
    assert.deepEqual([...APOLLO_ENRICHMENT_GATE_ORDER], [
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
    ]);
  });

  it('G2: country mismatch outranks a mail-provider domain', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ url: 'https://gmail.com', metadata: { domain: 'gmail.com', country_code: 'US' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible === false && result.skipReason, 'country_mismatch');
  });

  it('G3: a wrong ccTLD outranks a wrong sector', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        url: 'https://citigroup.com.pe',
        metadata: { domain: 'citigroup.com.pe', industry: 'banking' },
      }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible === false && result.skipReason, 'tld_country_mismatch');
  });

  it('G4: a cooldown outranks a sector rejection', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'citigroup.com', industry: 'banking' } }),
      { ...CO_SUPERMARKETS, domainsInCooldown: new Set(['citigroup.com']) },
    );
    assert.equal(result.eligible === false && result.skipReason, 'cooldown_active');
  });

  it('G5: every rejection reason is one of the declared ones', () => {
    const cases: WebSearchResult[] = [
      candidate({ metadata: { domain: 'acme.com', country_code: 'US' } }),
      candidate({ url: 'x', metadata: {} }),
      candidate({ url: 'https://a.com.pe', metadata: { domain: 'a.com.pe' } }),
      candidate({ url: 'https://gmail.com', metadata: { domain: 'gmail.com' } }),
      candidate({ url: 'https://b.com', metadata: { domain: 'a.com' } }),
      candidate({ url: 'https://linkedin.com', metadata: { domain: 'linkedin.com' } }),
      candidate({ metadata: { domain: 'acme.com', industry: 'banking' } }),
    ];
    for (const input of cases) {
      const result = evaluateApolloEnrichmentEligibility(input, CO_SUPERMARKETS);
      if (result.eligible) continue;
      assert.ok(
        APOLLO_ENRICHMENT_GATE_ORDER.includes(result.skipReason),
        `unknown reason: ${result.skipReason}`,
      );
    }
  });
});

// ── H. Eligible candidates ────────────────────────────────────────────────────

describe('H — eligible candidates', () => {
  it('H1: a generic TLD is not penalized for lacking a country signal', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({ metadata: { domain: 'acme.com', industry: 'supermercados' } }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible, true);
  });

  it('H2: www is stripped from the reported domain', () => {
    const result = evaluateApolloEnrichmentEligibility(
      candidate({
        url: 'https://www.exito.com.co',
        metadata: { domain: 'www.exito.com.co', industry: 'supermercados' },
      }),
      CO_SUPERMARKETS,
    );
    assert.equal(result.eligible === true && result.domain, 'exito.com.co');
  });

  it('H3: the evaluation does not mutate its inputs', () => {
    const input = candidate({ metadata: { domain: 'exito.com.co', industry: 'supermercados' } });
    const snapshot = JSON.stringify(input);
    const context = { ...CO_SUPERMARKETS, seenDomainsInRun: new Set<string>() };
    evaluateApolloEnrichmentEligibility(input, context);
    assert.equal(JSON.stringify(input), snapshot);
    // The gate never records the domain itself — the caller owns that set.
    assert.equal(context.seenDomainsInRun.size, 0);
  });

  it('H4: the same input always produces the same verdict', () => {
    const input = candidate({ metadata: { domain: 'exito.com.co', industry: 'supermercados' } });
    assert.deepEqual(
      evaluateApolloEnrichmentEligibility(input, CO_SUPERMARKETS),
      evaluateApolloEnrichmentEligibility(input, CO_SUPERMARKETS),
    );
  });
});

// ── I. Diagnostics ────────────────────────────────────────────────────────────

describe('I — gate counters', () => {
  it('I1: a fresh counter map is zeroed for every reason plus `eligible`', () => {
    const counts = buildEmptyEnrichmentGateCounts();
    assert.equal(counts.eligible, 0);
    for (const reason of APOLLO_ENRICHMENT_GATE_ORDER) {
      assert.equal(counts[reason], 0, reason);
    }
  });

  it('I2: the map has no key beyond the declared reasons', () => {
    assert.deepEqual(
      Object.keys(buildEmptyEnrichmentGateCounts()).sort(),
      ['eligible', ...APOLLO_ENRICHMENT_GATE_ORDER].sort(),
    );
  });

  it('I3: each call returns a fresh map — counters never leak between runs', () => {
    const first = buildEmptyEnrichmentGateCounts();
    first.cooldown_active = 7;
    assert.equal(buildEmptyEnrichmentGateCounts().cooldown_active, 0);
  });
});
