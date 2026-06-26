/**
 * Tests — v1.16K-M-B buildSearchQueriesByIntent country-aware
 *
 * Verifies that buildSearchQueriesByIntent generates queries using the correct
 * country context for each country. Non-CO countries must never produce queries
 * containing "Colombia", "NIT", or "RUES".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQueriesByIntent } from '../web-evidence-scorer';
import type { CandidateBasicInfo } from '../web-evidence-scorer';

function makeCandidate(countryCode: string | null, overrides: Partial<CandidateBasicInfo> = {}): CandidateBasicInfo {
  return {
    name: 'Empresa Ejemplo',
    legal_name: 'Empresa Ejemplo S.A.',
    tax_identifier: '12345678',
    city: 'Ciudad Test',
    industry: 'Tecnología',
    country_code: countryCode,
    ...overrides,
  };
}

function allQueryStrings(queries: ReturnType<typeof buildSearchQueriesByIntent>): string {
  return queries.map(q => q.query).join(' | ');
}

describe('WEBQ1 — CO: Colombia/NIT/RUES preserved', () => {
  const candidate = makeCandidate('CO');
  const queries = buildSearchQueriesByIntent(candidate, 'Tecnología');

  it('returns at least 3 queries', () => {
    assert.ok(queries.length >= 3, `Expected ≥3 queries, got ${queries.length}`);
  });

  it('all query strings contain Colombia', () => {
    const joined = allQueryStrings(queries);
    assert.ok(joined.includes('Colombia'), `Expected "Colombia" in queries: ${joined}`);
  });

  it('official_website query contains NIT', () => {
    const websiteQ = queries.find(q => q.intent === 'official_website');
    assert.ok(websiteQ, 'Expected an official_website query');
    assert.ok(websiteQ.query.includes('NIT'), `Expected "NIT" in official_website query: ${websiteQ.query}`);
  });

  it('public_evidence query contains RUES or CIIU', () => {
    const pubQ = queries.find(q => q.intent === 'public_evidence');
    assert.ok(pubQ, 'Expected a public_evidence query');
    const hasRuesOrCiiu = pubQ.query.includes('RUES') || pubQ.query.toLowerCase().includes('ciiu');
    assert.ok(hasRuesOrCiiu, `Expected "RUES" or "ciiu" in public_evidence query: ${pubQ.query}`);
  });

  it('has official_website, linkedin_company, and public_evidence intents', () => {
    const intents = queries.map(q => q.intent);
    assert.ok(intents.includes('official_website'), 'Missing official_website');
    assert.ok(intents.includes('linkedin_company'), 'Missing linkedin_company');
    assert.ok(intents.includes('public_evidence'), 'Missing public_evidence');
  });
});

describe('WEBQ2 — MX: México/RFC/DENUE — NO Colombia/NIT/RUES', () => {
  const candidate = makeCandidate('MX');
  const queries = buildSearchQueriesByIntent(candidate, 'Tecnología');
  const joined = allQueryStrings(queries);

  it('returns at least 3 queries', () => {
    assert.ok(queries.length >= 3, `Expected ≥3 queries, got ${queries.length}`);
  });

  it('queries do NOT contain "Colombia"', () => {
    assert.ok(!joined.includes('Colombia'), `"Colombia" found in MX queries: ${joined}`);
  });

  it('queries do NOT contain "NIT"', () => {
    assert.ok(!joined.includes('NIT'), `"NIT" found in MX queries: ${joined}`);
  });

  it('queries do NOT contain "RUES"', () => {
    assert.ok(!joined.includes('RUES'), `"RUES" found in MX queries: ${joined}`);
  });

  it('queries contain "México"', () => {
    assert.ok(joined.includes('México'), `Expected "México" in MX queries: ${joined}`);
  });

  it('queries contain "RFC"', () => {
    assert.ok(joined.includes('RFC'), `Expected "RFC" in MX queries: ${joined}`);
  });

  it('queries contain DENUE or SAT in at least one query', () => {
    const hasDenueOrSat = joined.includes('DENUE') || joined.includes('SAT');
    assert.ok(hasDenueOrSat, `Expected "DENUE" or "SAT" in MX queries: ${joined}`);
  });

  it('has official_website, linkedin_company, and public_evidence intents', () => {
    const intents = queries.map(q => q.intent);
    assert.ok(intents.includes('official_website'), 'Missing official_website');
    assert.ok(intents.includes('linkedin_company'), 'Missing linkedin_company');
    assert.ok(intents.includes('public_evidence'), 'Missing public_evidence');
  });
});

describe('WEBQ3 — CL: Chile/RUT — NO Colombia/NIT/RUES', () => {
  const candidate = makeCandidate('CL');
  const queries = buildSearchQueriesByIntent(candidate, 'Tecnología');
  const joined = allQueryStrings(queries);

  it('returns at least 3 queries', () => {
    assert.ok(queries.length >= 3, `Expected ≥3 queries, got ${queries.length}`);
  });

  it('queries do NOT contain "Colombia"', () => {
    assert.ok(!joined.includes('Colombia'), `"Colombia" found in CL queries: ${joined}`);
  });

  it('queries do NOT contain "NIT"', () => {
    assert.ok(!joined.includes('NIT'), `"NIT" found in CL queries: ${joined}`);
  });

  it('queries do NOT contain "RUES"', () => {
    assert.ok(!joined.includes('RUES'), `"RUES" found in CL queries: ${joined}`);
  });

  it('queries contain "Chile"', () => {
    assert.ok(joined.includes('Chile'), `Expected "Chile" in CL queries: ${joined}`);
  });

  it('queries contain "RUT"', () => {
    assert.ok(joined.includes('RUT'), `Expected "RUT" in CL queries: ${joined}`);
  });
});

describe('WEBQ4 — PE: Perú/RUC/SUNAT — NO Colombia/NIT/RUES', () => {
  const candidate = makeCandidate('PE');
  const queries = buildSearchQueriesByIntent(candidate, 'Tecnología');
  const joined = allQueryStrings(queries);

  it('returns at least 3 queries', () => {
    assert.ok(queries.length >= 3, `Expected ≥3 queries, got ${queries.length}`);
  });

  it('queries do NOT contain "Colombia"', () => {
    assert.ok(!joined.includes('Colombia'), `"Colombia" found in PE queries: ${joined}`);
  });

  it('queries do NOT contain "NIT"', () => {
    assert.ok(!joined.includes('NIT'), `"NIT" found in PE queries: ${joined}`);
  });

  it('queries do NOT contain "RUES"', () => {
    assert.ok(!joined.includes('RUES'), `"RUES" found in PE queries: ${joined}`);
  });

  it('queries contain "Perú"', () => {
    assert.ok(joined.includes('Perú'), `Expected "Perú" in PE queries: ${joined}`);
  });

  it('queries contain "RUC"', () => {
    assert.ok(joined.includes('RUC'), `Expected "RUC" in PE queries: ${joined}`);
  });

  it('queries contain "SUNAT"', () => {
    assert.ok(joined.includes('SUNAT'), `Expected "SUNAT" in PE queries: ${joined}`);
  });
});

describe('WEBQ5 — EC: Ecuador/RUC/SRI — NO Colombia/NIT/RUES', () => {
  const candidate = makeCandidate('EC');
  const queries = buildSearchQueriesByIntent(candidate, 'Tecnología');
  const joined = allQueryStrings(queries);

  it('returns at least 3 queries', () => {
    assert.ok(queries.length >= 3, `Expected ≥3 queries, got ${queries.length}`);
  });

  it('queries do NOT contain "Colombia"', () => {
    assert.ok(!joined.includes('Colombia'), `"Colombia" found in EC queries: ${joined}`);
  });

  it('queries do NOT contain "NIT"', () => {
    assert.ok(!joined.includes('NIT'), `"NIT" found in EC queries: ${joined}`);
  });

  it('queries do NOT contain "RUES"', () => {
    assert.ok(!joined.includes('RUES'), `"RUES" found in EC queries: ${joined}`);
  });

  it('queries contain "Ecuador"', () => {
    assert.ok(joined.includes('Ecuador'), `Expected "Ecuador" in EC queries: ${joined}`);
  });

  it('queries contain "RUC"', () => {
    assert.ok(joined.includes('RUC'), `Expected "RUC" in EC queries: ${joined}`);
  });

  it('queries contain "SRI"', () => {
    assert.ok(joined.includes('SRI'), `Expected "SRI" in EC queries: ${joined}`);
  });
});

describe('WEBQ6 — Unknown country: generic terms, NO Colombia/NIT/RUES', () => {
  const candidateNull = makeCandidate(null);
  const candidateAR = makeCandidate('AR');

  it('null country: queries do NOT contain "Colombia"', () => {
    const queries = buildSearchQueriesByIntent(candidateNull, '');
    const joined = allQueryStrings(queries);
    assert.ok(!joined.includes('Colombia'), `"Colombia" found in null-country queries: ${joined}`);
  });

  it('null country: queries do NOT contain "NIT"', () => {
    const queries = buildSearchQueriesByIntent(candidateNull, '');
    const joined = allQueryStrings(queries);
    assert.ok(!joined.includes('NIT'), `"NIT" found in null-country queries: ${joined}`);
  });

  it('null country: queries do NOT contain "RUES"', () => {
    const queries = buildSearchQueriesByIntent(candidateNull, '');
    const joined = allQueryStrings(queries);
    assert.ok(!joined.includes('RUES'), `"RUES" found in null-country queries: ${joined}`);
  });

  it('unknown country (AR): queries do NOT contain "Colombia"', () => {
    const queries = buildSearchQueriesByIntent(candidateAR, '');
    const joined = allQueryStrings(queries);
    assert.ok(!joined.includes('Colombia'), `"Colombia" found in AR-country queries: ${joined}`);
  });

  it('unknown country (AR): queries do NOT contain "NIT"', () => {
    const queries = buildSearchQueriesByIntent(candidateAR, '');
    const joined = allQueryStrings(queries);
    assert.ok(!joined.includes('NIT'), `"NIT" found in AR-country queries: ${joined}`);
  });

  it('unknown country (AR): queries do NOT contain "RUES"', () => {
    const queries = buildSearchQueriesByIntent(candidateAR, '');
    const joined = allQueryStrings(queries);
    assert.ok(!joined.includes('RUES'), `"RUES" found in AR-country queries: ${joined}`);
  });

  it('returns at least 3 queries for null country', () => {
    const queries = buildSearchQueriesByIntent(candidateNull, '');
    assert.ok(queries.length >= 3, `Expected ≥3 queries, got ${queries.length}`);
  });
});
