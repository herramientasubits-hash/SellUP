/**
 * AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1
 *
 * Test suite validating Apollo adoption of the shared official-source intake seam.
 * Uses Node's built-in test framework, pure functions only.
 *
 * No Apollo runtime imports. No provider calls. No budget changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { ProspectSearchCriteria } from '../types';
import { mapApolloCompanyToProviderDiscoveredCompany } from '../adapters/apollo';
import { normalizeProviderDiscoveredCompany } from '../normalize';
import {
  enrichNormalizedProspectWithOfficialSources,
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  type OfficialSourceResolver,
  type OfficialSourceResolverInput,
  type OfficialSourceEnrichmentResult,
} from '../source-enrichment';
import type { ApolloRawOrganization } from '../adapters/apollo';

const CRUZ_VERDE: ApolloRawOrganization = {
  id: 'cv-1',
  organization_id: 'apollo-org-cv',
  name: 'Cruz Verde',
  website_url: 'https://www.cruzverde.com.co',
  domain: 'cruzverde.com.co',
  primary_domain: 'cruzverde.com.co',
  linkedin_url: 'https://www.linkedin.com/company/cruz-verde/',
  industry: 'Retail Pharmacy',
  estimated_num_employees: 5000,
  employee_range: '1000-5000',
  country: 'Colombia',
  city: 'Bogotá',
  state: 'Cundinamarca',
  organization_naics_codes: ['446110'],
  short_description: 'Colombian pharmacy chain',
};

const DEFAULT_CRITERIA: ProspectSearchCriteria = {
  countryCode: 'CO',
  country: 'Colombia',
  sector: 'Healthcare',
};

class MockColombiaResolver implements OfficialSourceResolver {
  countryCode = 'CO';
  sourceKey = 'co_siis_mock';

  canResolve(input: OfficialSourceResolverInput): boolean {
    // Mirrors the real Colombia resolver's contract: candidate.countryCode
    // OR criteria.countryCode (Apollo's adapter doesn't populate countryCode
    // today — only the full country name — so criteria is the fallback).
    const country = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
    return country === 'CO' && !!input.candidate.domain;
  }

  resolve(input: OfficialSourceResolverInput): OfficialSourceEnrichmentResult {
    if (input.candidate.domain === 'cruzverde.com.co') {
      return {
        status: 'matched',
        countryCode: 'CO',
        sourceKey: 'co_siis',
        confidence: 0.95,
        matchMethod: 'domain',
        taxIdentifier: '860-123-456-7',
        taxIdentifierType: 'NIT',
        legalName: 'Cruz Verde Farmaceutica S.A.S.',
        legalStatus: 'active',
        warnings: [],
        issues: [],
      };
    }
    return {
      status: 'not_found',
      countryCode: input.candidate.countryCode ?? null,
      sourceKey: this.sourceKey,
      confidence: null,
      matchMethod: null,
      warnings: [],
      issues: [],
    };
  }
}

describe('AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1', () => {
  it('adapter maps Apollo org to ProviderDiscoveredCompany', () => {
    const discovered = mapApolloCompanyToProviderDiscoveredCompany(CRUZ_VERDE);
    assert.strictEqual(discovered.provider, 'apollo');
    assert.strictEqual(discovered.companyName, 'Cruz Verde');
    assert.strictEqual(discovered.domain, 'cruzverde.com.co');
  });

  it('normalizer produces clean NormalizedProspectCandidate', () => {
    const discovered = mapApolloCompanyToProviderDiscoveredCompany(CRUZ_VERDE);
    const normalized = normalizeProviderDiscoveredCompany(discovered, DEFAULT_CRITERIA);
    assert.strictEqual(normalized.sourceProvider, 'apollo');
    assert.strictEqual(normalized.canonicalName, 'Cruz Verde');
    assert.strictEqual(normalized.domain, 'cruzverde.com.co');
  });

  it('strong tax identity projects to top level', async () => {
    const discovered = mapApolloCompanyToProviderDiscoveredCompany(CRUZ_VERDE, {
      searchCriteria: DEFAULT_CRITERIA,
    });
    const normalized = normalizeProviderDiscoveredCompany(discovered, DEFAULT_CRITERIA);
    const resolver = new MockColombiaResolver();
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      normalized,
      DEFAULT_CRITERIA,
      [resolver],
      { minimumStrongMatchConfidence: 0.85 }
    );

    assert.strictEqual(enriched.taxIdentifier, '860-123-456-7');
    assert.strictEqual(enriched.taxIdentifierType, 'NIT');
    assert.strictEqual(enriched.legalName, 'Cruz Verde Farmaceutica S.A.S.');
    assert.strictEqual(enriched.strongIdentityAvailable, true);
  });

  it('unsupported country returns unavailable', async () => {
    // Novo Nordisk (Denmark), searched under a Denmark wizard criteria —
    // the only registered resolver serves CO, so DK has no resolver at all.
    const novo: ApolloRawOrganization = {
      id: 'nn-1',
      name: 'Novo Nordisk A/S',
      website_url: 'https://www.novonordisk.com',
      domain: 'novonordisk.com',
      primary_domain: 'novonordisk.com',
      country: 'Denmark',
      industry: 'Pharmaceuticals',
    };
    const dkCriteria: ProspectSearchCriteria = { countryCode: 'DK', country: 'Denmark' };

    const discovered = mapApolloCompanyToProviderDiscoveredCompany(novo);
    const normalized = normalizeProviderDiscoveredCompany(discovered, dkCriteria);
    const resolver = new MockColombiaResolver();
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      normalized,
      dkCriteria,
      [resolver],
      { unsupportedCountryMode: 'warning' }
    );

    // DK has zero resolvers registered = unsupported_country, not not_found
    assert.strictEqual(enriched.officialSource.status, 'unsupported_country');
    assert.strictEqual(enriched.strongIdentityAvailable, false);
  });

  it('typed columns extracts bounded fields only', async () => {
    const discovered = mapApolloCompanyToProviderDiscoveredCompany(CRUZ_VERDE, {
      searchCriteria: DEFAULT_CRITERIA,
    });
    const normalized = normalizeProviderDiscoveredCompany(discovered, DEFAULT_CRITERIA);
    const resolver = new MockColombiaResolver();
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      normalized,
      DEFAULT_CRITERIA,
      [resolver]
    );

    const typed = buildOfficialSourceTypedColumns(enriched);
    assert('tax_identifier' in typed);
    assert('tax_identifier_type' in typed);
    assert('legal_name' in typed);
  });

  it('enrichment metadata is bounded', async () => {
    const discovered = mapApolloCompanyToProviderDiscoveredCompany(CRUZ_VERDE, {
      searchCriteria: DEFAULT_CRITERIA,
    });
    const normalized = normalizeProviderDiscoveredCompany(discovered, DEFAULT_CRITERIA);
    const resolver = new MockColombiaResolver();
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      normalized,
      DEFAULT_CRITERIA,
      [resolver]
    );

    const meta = buildOfficialSourceEnrichmentMetadata(enriched);
    assert.strictEqual(meta.status, 'matched');
    assert.strictEqual(meta.sourceKey, 'co_siis');
    assert.strictEqual(meta.confidence, 0.95);
    assert.strictEqual(meta.taxIdentifierPresent, true);
    // Verify no raw payload leakage — the metadata projection carries a
    // presence flag only, never the tax identifier value itself.
    assert.ok(!('taxIdentifier' in meta));
  });

  it('static guard: adapter is actually importable', () => {
    assert(typeof mapApolloCompanyToProviderDiscoveredCompany === 'function');
    assert(typeof enrichNormalizedProspectWithOfficialSources === 'function');
    assert(typeof buildOfficialSourceEnrichmentMetadata === 'function');
  });
});
