/**
 * AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1
 *
 * Runtime-level test suite for the Apollo → shared intake seam bridge
 * (`apollo-shared-intake-bridge.ts` + `apollo-official-source-resolvers.ts`).
 *
 * Complements `src/server/agents/prospect-intake/__tests__/apollo-adoption.test.ts`
 * (pure adapter/normalize/enrich coverage) with:
 *   - the Apollo `WebSearchResult` → `ApolloRawOrganization` mapping
 *   - offline replay of two real batch companies (Novo Nordisk, Cruz Verde)
 *     using injected fixture data — NO Apollo/Lusha/Tavily calls
 *   - the strong-identity duplicate recheck contract
 *   - a static regression guard (§ 34): fails if the Apollo production runner
 *     ever again has zero connection to the shared seam.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mapApolloWebSearchResultToRawOrganization,
  deriveOfficialIdentityForApolloCandidate,
} from '../apollo-shared-intake-bridge';
import type {
  ProspectingPipelineCandidate,
  WebSearchResult,
} from '../../types';
import type { ProspectSearchCriteria } from '@/server/agents/prospect-intake';
import type {
  OfficialSourceResolver,
  OfficialSourceResolverInput,
  OfficialSourceEnrichmentResult,
} from '@/server/agents/prospect-intake';

// ── Offline fixtures ────────────────────────────────────────────────────────
// Shaped exactly like what `apollo-organizations-search-provider.ts` stamps
// onto `WebSearchResult.metadata.apollo_profile` (see `ApolloProfileMetadata`).
// No live Apollo call is made to produce these — they are hand-built to match
// the documented shape for batch 9dd605fc-fa49-49f7-bb68-29e2ed32d007.

function buildApolloWebSearchResult(overrides: {
  title: string;
  url: string;
  domain: string;
  country: string;
  city?: string;
  employees?: number;
  linkedinUrl?: string;
}): WebSearchResult {
  return {
    title: overrides.title,
    url: overrides.url,
    snippet: null,
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `org-${overrides.domain}`,
      domain: overrides.domain,
      website: overrides.url,
      industry: 'Test Industry',
      employee_count: overrides.employees ?? null,
      city: overrides.city ?? null,
      country: overrides.country,
      linkedin_url: overrides.linkedinUrl ?? null,
      keywords: [],
      short_description: null,
      source_provider: 'apollo',
      source_key: 'apollo_organizations',
      source_type: 'structured_company_database',
      apollo_profile: {
        organization_id: `org-${overrides.domain}`,
        website_url: overrides.url,
        primary_domain: overrides.domain,
        linkedin_url: overrides.linkedinUrl ?? null,
        industry: 'Test Industry',
        industries: [],
        keywords: [],
        organization_keywords: [],
        estimated_num_employees: overrides.employees ?? null,
        employee_count_source: overrides.employees ? 'estimated_num_employees' : 'none',
        city: overrides.city ?? null,
        country: overrides.country,
        short_description: null,
        seo_description: null,
        description: null,
        raw_fields_present: [],
        mapping_version: 'test-fixture-v1',
      },
    },
  };
}

const NOVO_NORDISK_RESULT = buildApolloWebSearchResult({
  title: 'Novo Nordisk A/S',
  url: 'https://www.novonordisk.com',
  domain: 'novonordisk.com',
  country: 'Denmark',
  city: 'Bagsværd',
  employees: 48000,
  linkedinUrl: 'https://www.linkedin.com/company/novo-nordisk/',
});

const CRUZ_VERDE_RESULT = buildApolloWebSearchResult({
  title: 'Cruz Verde',
  url: 'https://www.cruzverde.com.co',
  domain: 'cruzverde.com.co',
  country: 'Colombia',
  city: 'Bogotá',
  employees: 5000,
  linkedinUrl: 'https://www.linkedin.com/company/cruz-verde/',
});

const CO_CRITERIA: ProspectSearchCriteria = {
  countryCode: 'CO',
  country: 'Colombia',
  sector: 'Healthcare',
};

class FixtureColombiaResolver implements OfficialSourceResolver {
  countryCode = 'CO';
  sourceKey = 'co_siis_fixture';

  canResolve(input: OfficialSourceResolverInput): boolean {
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

class ErrorResolver implements OfficialSourceResolver {
  countryCode = 'CO';
  sourceKey = 'co_siis_error';
  canResolve(): boolean {
    return true;
  }
  async resolve(): Promise<OfficialSourceEnrichmentResult> {
    throw new Error('simulated resolver failure');
  }
}

function buildBaseCandidate(
  overrides: Partial<ProspectingPipelineCandidate>,
): ProspectingPipelineCandidate {
  return {
    name: 'Test Co',
    website: 'https://test.co',
    domain: 'test.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Healthcare',
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 0,
      input: { name: 'Test Co' },
      matches: [],
      summary: 'new',
      checkedSources: [],
    },
    scoring: {
      confidenceScore: 50,
      fitScore: 50,
      dataCompletenessScore: 50,
      qualityLabel: 'needs_review',
      recommendedAction: 'review_manually',
      breakdown: {
        existenceSignals: 0,
        websiteSignals: 0,
        duplicateSignals: 0,
        sourceSignals: 0,
        fitSignals: 0,
        completenessSignals: 0,
        penalties: 0,
      },
      reasons: [],
      warnings: [],
      blockers: [],
    },
    ...overrides,
  };
}

describe('AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — bridge runtime', () => {
  it('maps an Apollo WebSearchResult (with apollo_profile) to ApolloRawOrganization', () => {
    const raw = mapApolloWebSearchResultToRawOrganization(CRUZ_VERDE_RESULT);
    assert.strictEqual(raw.name, 'Cruz Verde');
    assert.strictEqual(raw.primary_domain, 'cruzverde.com.co');
    assert.strictEqual(raw.linkedin_url, 'https://www.linkedin.com/company/cruz-verde/');
    assert.strictEqual(raw.estimated_num_employees, 5000);
  });

  it('degrades gracefully when apollo_profile metadata is absent', () => {
    const bare: WebSearchResult = {
      title: 'Some Co',
      url: 'https://some.co',
      rank: 1,
      provider: 'apollo_organizations',
    };
    const raw = mapApolloWebSearchResultToRawOrganization(bare);
    assert.strictEqual(raw.name, 'Some Co');
    assert.strictEqual(raw.primary_domain, null);
  });

  describe('Novo Nordisk offline replay (§ 17)', () => {
    it('no CO match — candidate continues, no fabricated identity', async () => {
      const candidate = buildBaseCandidate({
        name: 'Novo Nordisk A/S',
        domain: 'novonordisk.com',
        website: 'https://www.novonordisk.com',
        country: 'Denmark',
        countryCode: 'DK',
      });

      const outcome = await deriveOfficialIdentityForApolloCandidate({
        candidate,
        webSearchResult: NOVO_NORDISK_RESULT,
        criteria: CO_CRITERIA, // wizard was searching CO — Novo Nordisk is DK, not_found
        resolvers: [new FixtureColombiaResolver()],
      });

      assert.strictEqual(outcome.strongIdentityAvailable, false);
      assert.strictEqual(outcome.typedColumns.tax_identifier, null);
      assert.strictEqual(outcome.strongDuplicateRecheck, null);
      assert.strictEqual(outcome.officialSourceMetadata.status, 'not_found');
    });
  });

  describe('Cruz Verde offline replay (§ 18)', () => {
    it('strong CO match — tax identifier and legal name projected', async () => {
      const candidate = buildBaseCandidate({
        name: 'Cruz Verde',
        domain: 'cruzverde.com.co',
        website: 'https://www.cruzverde.com.co',
        country: 'Colombia',
        countryCode: 'CO',
      });

      const outcome = await deriveOfficialIdentityForApolloCandidate({
        candidate,
        webSearchResult: CRUZ_VERDE_RESULT,
        criteria: CO_CRITERIA,
        resolvers: [new FixtureColombiaResolver()],
      });

      assert.strictEqual(outcome.strongIdentityAvailable, true);
      assert.strictEqual(outcome.typedColumns.tax_identifier, '860-123-456-7');
      assert.strictEqual(outcome.typedColumns.tax_identifier_type, 'NIT');
      assert.strictEqual(outcome.typedColumns.legal_name, 'Cruz Verde Farmaceutica S.A.S.');
      assert.strictEqual(outcome.officialSourceMetadata.status, 'matched');
      assert.strictEqual(outcome.officialSourceMetadata.confidence, 0.95);
    });

    it('strong match triggers a duplicate recheck (non-null result)', async () => {
      const candidate = buildBaseCandidate({
        name: 'Cruz Verde',
        domain: 'cruzverde.com.co',
        website: 'https://www.cruzverde.com.co',
        country: 'Colombia',
        countryCode: 'CO',
      });

      const outcome = await deriveOfficialIdentityForApolloCandidate({
        candidate,
        webSearchResult: CRUZ_VERDE_RESULT,
        criteria: CO_CRITERIA,
        resolvers: [new FixtureColombiaResolver()],
      });

      // § 12 — strong identity unlocks the tax-aware recheck. This suite runs
      // fully offline: `checkCompanyDuplicate` here hits whatever SellUp/HubSpot
      // client is configured in this environment (no admin creds in CI), so we
      // assert the CONTRACT (a recheck happened, using the tax identifier),
      // not a specific duplicate verdict.
      assert.notStrictEqual(outcome.strongDuplicateRecheck, null);
      assert.strictEqual(outcome.strongDuplicateRecheck?.input.taxIdentifier, '860-123-456-7');
    });
  });

  describe('Resolver error is fail-soft (§ 20)', () => {
    it('candidate continues, no crash, explicit error status', async () => {
      const candidate = buildBaseCandidate({ domain: 'cruzverde.com.co', countryCode: 'CO' });
      const outcome = await deriveOfficialIdentityForApolloCandidate({
        candidate,
        webSearchResult: CRUZ_VERDE_RESULT,
        criteria: CO_CRITERIA,
        resolvers: [new ErrorResolver()],
      });

      assert.strictEqual(outcome.strongIdentityAvailable, false);
      assert.strictEqual(outcome.officialSourceMetadata.status, 'error');
      assert.ok(outcome.officialSourceMetadata.issues.includes('official_source_error'));
    });
  });

  describe('No resolvers registered (§ 32 — no dependence on Apollo exposing fiscal fields)', () => {
    it('degrades to unavailable, never throws', async () => {
      const candidate = buildBaseCandidate({ domain: 'cruzverde.com.co', countryCode: 'CO' });
      const outcome = await deriveOfficialIdentityForApolloCandidate({
        candidate,
        webSearchResult: CRUZ_VERDE_RESULT,
        criteria: CO_CRITERIA,
        resolvers: [],
      });

      assert.strictEqual(outcome.strongIdentityAvailable, false);
      assert.strictEqual(outcome.strongDuplicateRecheck, null);
    });
  });

  describe('Macro-v2 / target contract untouched (§ 24, § 25)', () => {
    it('outcome carries no target or macro-taxonomy fields', async () => {
      const candidate = buildBaseCandidate({ domain: 'cruzverde.com.co', countryCode: 'CO' });
      const outcome = await deriveOfficialIdentityForApolloCandidate({
        candidate,
        webSearchResult: CRUZ_VERDE_RESULT,
        criteria: CO_CRITERIA,
        resolvers: [new FixtureColombiaResolver()],
      });

      assert.ok(!('countsTowardTarget' in outcome));
      assert.ok(!('macroIndustry' in outcome));
      assert.ok(!('subindustry' in outcome));
    });
  });
});

// ============================================================
// § 34 — Static regression guard
// ============================================================

describe('AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — static regression guard (§ 34)', () => {
  const productionRunnerPath = join(
    __dirname,
    '..',
    'production-runner.server.ts',
  );
  const source = readFileSync(productionRunnerPath, 'utf8');

  it('imports the shared-intake bridge (adapter + normalizer + official enrichment)', () => {
    assert.match(
      source,
      /from ['"]\.\/apollo-shared-intake-bridge['"]/,
      'production-runner.server.ts must import deriveOfficialIdentityForApolloCandidate ' +
        'from ./apollo-shared-intake-bridge — if this import is removed, Apollo has ' +
        'regressed to bypassing the shared official-source intake seam (the exact ' +
        'regression this adoption closes).',
    );
  });

  it('actually calls the bridge function, not just imports it', () => {
    assert.match(
      source,
      /deriveOfficialIdentityForApolloCandidate\(/,
      'production-runner.server.ts imports but never CALLS ' +
        'deriveOfficialIdentityForApolloCandidate — an unused import would not ' +
        'catch a regression back to the bypass.',
    );
  });

  it('wires the official-source resolvers (not a hardcoded empty array)', () => {
    assert.match(
      source,
      /buildApolloOfficialSourceResolvers\(\)/,
      'production-runner.server.ts must call buildApolloOfficialSourceResolvers() — ' +
        'passing resolvers: [] unconditionally would silently disable the seam.',
    );
  });

  it('the bridge module itself imports the shared adapter, normalizer, and enrichment', () => {
    const bridgePath = join(__dirname, '..', 'apollo-shared-intake-bridge.ts');
    const bridgeSource = readFileSync(bridgePath, 'utf8');
    assert.match(bridgeSource, /mapApolloCompanyToProviderDiscoveredCompany/);
    assert.match(bridgeSource, /normalizeProviderDiscoveredCompany/);
    assert.match(bridgeSource, /enrichNormalizedProspectWithOfficialSources/);
    // Must import from the shared prospect-intake tree, not a local reimplementation.
    assert.match(bridgeSource, /@\/server\/agents\/prospect-intake/);
  });
});
