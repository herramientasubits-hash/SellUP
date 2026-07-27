/**
 * Q3F-5BB.10B1 — Provider-agnostic intake contract tests.
 *
 * Exercises the three pure adapters (Lusha, Apollo, Tavily/Web AI) and the
 * shared normalizer. No runtime, no I/O, no provider calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapLushaCompanyToProviderDiscoveredCompany } from '../adapters/lusha';
import { mapApolloCompanyToProviderDiscoveredCompany } from '../adapters/apollo';
import { mapWebAiCompanyToProviderDiscoveredCompany } from '../adapters/tavily';
import { normalizeProviderDiscoveredCompany } from '../normalize';
import type { ProspectSearchCriteria, ProviderDiscoveredCompany } from '../types';

import {
  lushaCompanyFixture,
  lushaCompanyPersonalLinkedinFixture,
} from './fixtures/lusha-company';
import {
  apolloOrganizationFixture,
  apolloOrganizationAltShapeFixture,
} from './fixtures/apollo-company';
import {
  webAiCompanyFixture,
  webAiSparseCompanyFixture,
} from './fixtures/tavily-company';

const NO_CRITERIA: ProspectSearchCriteria = {};

/** No raw payload keys should leak into safe provider metadata. */
function assertNoRawPayload(meta: Record<string, unknown> | undefined) {
  assert.ok(meta, 'providerMetadataSafe should be present');
  const forbidden = ['raw', 'rawPayload', 'payload', 'response', 'body', 'data'];
  for (const key of forbidden) {
    assert.ok(!(key in (meta as Record<string, unknown>)), `metadata must not carry "${key}"`);
  }
}

// ─── A. Lusha ────────────────────────────────────────────────────────────────
describe('A. Lusha adapter', () => {
  it('maps name/domain/website/id and provider', () => {
    const mapped = mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyFixture);
    assert.equal(mapped.provider, 'lusha');
    assert.equal(mapped.providerRecordId, 'lusha-co-001');
    assert.equal(mapped.companyName, 'Acme Widgets SAS');
    assert.equal(mapped.domain, 'acmewidgets.co');
    assert.equal(mapped.websiteUrl, 'https://www.acmewidgets.co/co');
    assert.equal(mapped.employeeCount, 240);
  });

  it('normalizes to a corporate LinkedIn /company/ URL', () => {
    const normalized = normalizeProviderDiscoveredCompany(
      mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyFixture),
      NO_CRITERIA,
    );
    assert.equal(normalized.corporateLinkedinUrl, 'https://www.linkedin.com/company/acme-widgets');
    assert.ok(!normalized.warnings.includes('missing_corporate_linkedin'));
  });

  it('rejects a personal /in/ LinkedIn as corporate + warns', () => {
    const normalized = normalizeProviderDiscoveredCompany(
      mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyPersonalLinkedinFixture),
      NO_CRITERIA,
    );
    assert.equal(normalized.corporateLinkedinUrl, null);
    assert.ok(normalized.warnings.includes('missing_corporate_linkedin'));
  });

  it('keeps employeeCount numeric and provider industry ids', () => {
    const mapped = mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyFixture);
    assert.equal(typeof mapped.employeeCount, 'number');
    assert.deepEqual(mapped.industryCodes?.providerIndustryIds, ['12', '34']);
  });

  it('carries no raw payload in providerMetadataSafe', () => {
    const mapped = mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyFixture);
    assertNoRawPayload(mapped.providerMetadataSafe);
    assert.equal(mapped.providerMetadataSafe?.endpoint, 'company/prospecting');
  });
});

// ─── B. Apollo ───────────────────────────────────────────────────────────────
describe('B. Apollo adapter', () => {
  it('maps organization id, domain/website and provider', () => {
    const mapped = mapApolloCompanyToProviderDiscoveredCompany(apolloOrganizationFixture);
    assert.equal(mapped.provider, 'apollo');
    assert.equal(mapped.providerRecordId, 'apollo-org-001');
    assert.equal(mapped.domain, 'globex-industrial.example');
    assert.equal(mapped.websiteUrl, 'https://www.globex-industrial.example');
  });

  it('maps NAICS/SIC codes when present', () => {
    const mapped = mapApolloCompanyToProviderDiscoveredCompany(apolloOrganizationFixture);
    assert.deepEqual(mapped.industryCodes?.naics, ['333120', '333']);
    assert.deepEqual(mapped.industryCodes?.sic, ['3531']);
  });

  it('maps employee count and range', () => {
    const mapped = mapApolloCompanyToProviderDiscoveredCompany(apolloOrganizationFixture);
    assert.equal(mapped.employeeCount, 1200);
    assert.equal(mapped.employeeRange, '1001-5000');
  });

  it('handles the alt shape (organization_id + range array)', () => {
    const mapped = mapApolloCompanyToProviderDiscoveredCompany(apolloOrganizationAltShapeFixture);
    assert.equal(mapped.providerRecordId, 'apollo-org-002');
    assert.equal(mapped.employeeRange, '201-500');
    assert.equal(mapped.employeeCount, null);
  });

  it('uses mixed_companies/search endpoint, never People Search, no raw payload', () => {
    const mapped = mapApolloCompanyToProviderDiscoveredCompany(apolloOrganizationFixture);
    assert.equal(mapped.providerMetadataSafe?.endpoint, 'mixed_companies/search');
    assert.notEqual(mapped.providerMetadataSafe?.endpoint, 'people/search');
    assertNoRawPayload(mapped.providerMetadataSafe);
  });
});

// ─── C. Tavily / Web AI ──────────────────────────────────────────────────────
describe('C. Tavily / Web AI adapter', () => {
  it('normalizes inferred company name and derives domain from URL', () => {
    const normalized = normalizeProviderDiscoveredCompany(
      mapWebAiCompanyToProviderDiscoveredCompany(webAiCompanyFixture),
      NO_CRITERIA,
    );
    assert.equal(normalized.canonicalName, 'Umbrella Logistics Ltda');
    assert.equal(normalized.domain, 'umbrella-logistics.example');
    assert.equal(normalized.sourceUrl, 'https://umbrella-logistics.example/about');
  });

  it('defaults provider to web_ai, honors tavily via context', () => {
    const webAi = mapWebAiCompanyToProviderDiscoveredCompany(webAiCompanyFixture);
    assert.equal(webAi.provider, 'web_ai');
    const tavily = mapWebAiCompanyToProviderDiscoveredCompany(webAiCompanyFixture, {
      provider: 'tavily',
    });
    assert.equal(tavily.provider, 'tavily');
  });

  it('warns when no LinkedIn and no employee count', () => {
    const normalized = normalizeProviderDiscoveredCompany(
      mapWebAiCompanyToProviderDiscoveredCompany(webAiSparseCompanyFixture),
      NO_CRITERIA,
    );
    assert.ok(normalized.warnings.includes('missing_corporate_linkedin'));
    assert.ok(normalized.warnings.includes('employee_count_unknown'));
  });
});

// ─── D. normalizeProviderDiscoveredCompany ────────────────────────────────────
describe('D. normalizeProviderDiscoveredCompany', () => {
  const base: ProviderDiscoveredCompany = { provider: 'lusha', companyName: 'Test Co' };

  it('derives domain from websiteUrl', () => {
    const n = normalizeProviderDiscoveredCompany(
      { ...base, websiteUrl: 'https://www.test-co.example/x' },
      NO_CRITERIA,
    );
    assert.equal(n.domain, 'test-co.example');
  });

  it('derives websiteUrl from domain', () => {
    const n = normalizeProviderDiscoveredCompany({ ...base, domain: 'test-co.example' }, NO_CRITERIA);
    assert.equal(n.websiteUrl, 'https://test-co.example');
  });

  it('accepts /company/ LinkedIn and rejects /in/', () => {
    const company = normalizeProviderDiscoveredCompany(
      { ...base, linkedinUrl: 'https://linkedin.com/company/test-co' },
      NO_CRITERIA,
    );
    assert.equal(company.corporateLinkedinUrl, 'https://linkedin.com/company/test-co');
    const personal = normalizeProviderDiscoveredCompany(
      { ...base, linkedinUrl: 'https://linkedin.com/in/someone' },
      NO_CRITERIA,
    );
    assert.equal(personal.corporateLinkedinUrl, null);
  });

  it('missing name produces missing_name issue', () => {
    const n = normalizeProviderDiscoveredCompany({ provider: 'lusha', companyName: null }, NO_CRITERIA);
    assert.ok(n.issues.includes('missing_name'));
  });

  it('missing domain produces missing_domain warning', () => {
    const n = normalizeProviderDiscoveredCompany(base, NO_CRITERIA);
    assert.ok(n.warnings.includes('missing_domain'));
  });

  it('country mismatch produces country_mismatch issue', () => {
    const n = normalizeProviderDiscoveredCompany(
      { ...base, countryCode: 'MX' },
      { countryCode: 'CO' },
    );
    assert.ok(n.issues.includes('country_mismatch'));
  });

  it('employee count below min produces known_employee_count_below_min issue', () => {
    const n = normalizeProviderDiscoveredCompany(
      { ...base, employeeCount: 5 },
      { minEmployees: 50 },
    );
    assert.ok(n.issues.includes('known_employee_count_below_min'));
  });

  it('null employee count produces employee_count_unknown warning', () => {
    const n = normalizeProviderDiscoveredCompany({ ...base, employeeCount: null }, NO_CRITERIA);
    assert.ok(n.warnings.includes('employee_count_unknown'));
  });

  it('does not mutate the input', () => {
    const input: ProviderDiscoveredCompany = {
      provider: 'apollo',
      companyName: 'Frozen Co',
      industryCodes: { naics: ['111'] },
      providerMetadataSafe: { provider: 'apollo' },
    };
    const snapshot = JSON.stringify(input);
    const n = normalizeProviderDiscoveredCompany(input, { countryCode: 'CO' });
    // Mutating the output must not touch the input.
    n.industryCodes.naics?.push('999');
    n.providerMetadataSafe.injected = true;
    assert.equal(JSON.stringify(input), snapshot);
  });

  it('is deterministic (same input → same output)', () => {
    const a = normalizeProviderDiscoveredCompany(
      mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyFixture),
      { countryCode: 'CO', minEmployees: 10 },
    );
    const b = normalizeProviderDiscoveredCompany(
      mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyFixture),
      { countryCode: 'CO', minEmployees: 10 },
    );
    assert.deepEqual(a, b);
  });
});
