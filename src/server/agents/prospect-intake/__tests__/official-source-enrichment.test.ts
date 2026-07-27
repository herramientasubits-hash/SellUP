/**
 * Q3F-5BB.10C1 — Official-source enrichment abstraction tests.
 *
 * Exercises the pure orchestrator + projection helpers with FAKE injected
 * resolvers only. No runtime, no I/O, no provider calls, no DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichNormalizedProspectWithOfficialSources,
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  OFFICIAL_SOURCE_WARNING,
  OFFICIAL_SOURCE_ISSUE,
  type OfficialSourceResolver,
  type OfficialSourceEnrichmentResult,
} from '../source-enrichment';
import type {
  NormalizedProspectCandidate,
  ProspectSearchCriteria,
} from '../types';
import { normalizeProviderDiscoveredCompany } from '../normalize';
import { mapLushaCompanyToProviderDiscoveredCompany } from '../adapters/lusha';
import { mapApolloCompanyToProviderDiscoveredCompany } from '../adapters/apollo';
import { mapWebAiCompanyToProviderDiscoveredCompany } from '../adapters/tavily';

import { lushaCompanyFixture } from './fixtures/lusha-company';
import { apolloOrganizationFixture } from './fixtures/apollo-company';
import { webAiCompanyFixture } from './fixtures/tavily-company';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build a minimal, valid NormalizedProspectCandidate for a given country. */
function makeCandidate(
  overrides: Partial<NormalizedProspectCandidate> = {},
): NormalizedProspectCandidate {
  return {
    sourceProvider: 'lusha',
    providerRecordId: 'rec-1',
    providerRequestId: 'req-1',
    canonicalName: 'Acme Widgets SAS',
    normalizedName: 'acme widgets sas',
    commercialName: 'Acme Widgets',
    legalName: 'Acme Widgets SAS',
    websiteUrl: 'https://acmewidgets.co',
    domain: 'acmewidgets.co',
    corporateLinkedinUrl: 'https://www.linkedin.com/company/acme-widgets',
    country: 'Colombia',
    countryCode: 'CO',
    requestedCountryCode: 'CO',
    region: 'Cundinamarca',
    city: 'Bogotá',
    industry: 'Manufacturing',
    subindustry: null,
    industryCodes: {},
    employeeCount: 240,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: {
      sourceProvider: 'lusha',
      providerRecordId: 'rec-1',
      providerRequestId: 'req-1',
      sourceUrl: null,
    },
    ...overrides,
  };
}

const CO_CRITERIA: ProspectSearchCriteria = { countryCode: 'CO' };

/** A fake resolver whose `resolve` returns a fixed result. */
function fakeResolver(
  countryCode: string,
  sourceKey: string,
  result: OfficialSourceEnrichmentResult | (() => OfficialSourceEnrichmentResult),
  canResolve = true,
): OfficialSourceResolver {
  return {
    countryCode,
    sourceKey,
    canResolve: () => canResolve,
    resolve: () => (typeof result === 'function' ? result() : result),
  };
}

const strongCoResult: OfficialSourceEnrichmentResult = {
  status: 'matched',
  countryCode: 'CO',
  sourceKey: 'co_siis',
  confidence: 0.92,
  matchMethod: 'tax_id',
  taxIdentifier: '900123456',
  taxIdentifierType: 'NIT',
  legalName: 'ACME WIDGETS SAS',
  legalStatus: 'ACTIVA',
  economicActivity: 'C2599',
  registryStatus: 'ACTIVE',
  warnings: [],
  issues: [],
  safeMetadata: { matchedTokens: 3 },
};

// ─── A. Colombia strong match ────────────────────────────────────────────────
describe('A. Colombia strong match', () => {
  it('promotes tax_identifier + legal_name and exposes source_key', async () => {
    const resolvers = [fakeResolver('CO', 'co_siis', strongCoResult)];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      resolvers,
    );

    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.officialSource.status, 'matched');
    assert.equal(enriched.taxIdentifier, '900123456');
    assert.equal(enriched.taxIdentifierType, 'NIT');
    assert.equal(enriched.legalName, 'ACME WIDGETS SAS');

    const columns = buildOfficialSourceTypedColumns(enriched);
    assert.equal(columns.tax_identifier, '900123456');
    assert.equal(columns.tax_identifier_type, 'NIT');
    assert.equal(columns.legal_name, 'ACME WIDGETS SAS');
    assert.equal(columns.legal_status, 'ACTIVA');

    const metadata = buildOfficialSourceEnrichmentMetadata(enriched);
    assert.equal(metadata.sourceKey, 'co_siis');
    assert.equal(metadata.countryCode, 'CO');
    assert.equal(metadata.taxIdentifierPresent, true);
    assert.equal(metadata.strongIdentityAvailable, true);
  });
});

// ─── B. Unsupported country ──────────────────────────────────────────────────
describe('B. Unsupported country (no resolver)', () => {
  it('returns unsupported_country + source_catalog_unavailable warning, no tax id', async () => {
    const resolvers = [fakeResolver('CO', 'co_siis', strongCoResult)];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate({ countryCode: 'MX', requestedCountryCode: 'MX', country: 'Mexico' }),
      { countryCode: 'MX' },
      resolvers,
    );

    assert.equal(enriched.officialSource.status, 'unsupported_country');
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.ok(
      enriched.identityWarnings.includes(OFFICIAL_SOURCE_WARNING.catalogUnavailable),
      'must warn source_catalog_unavailable',
    );
    assert.equal(buildOfficialSourceTypedColumns(enriched).tax_identifier, null);
  });
});

// ─── C. Not found ─────────────────────────────────────────────────────────────
describe('C. Not found', () => {
  it('is not strong and warns official_source_not_found', async () => {
    const resolvers = [
      fakeResolver('CO', 'co_siis', {
        status: 'not_found',
        countryCode: 'CO',
        sourceKey: 'co_siis',
        confidence: null,
        warnings: [],
        issues: [],
      }),
    ];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      resolvers,
    );

    assert.equal(enriched.officialSource.status, 'not_found');
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.ok(enriched.identityWarnings.includes(OFFICIAL_SOURCE_WARNING.notFound));
    assert.equal(buildOfficialSourceTypedColumns(enriched).tax_identifier, null);
  });
});

// ─── D. Low confidence ────────────────────────────────────────────────────────
describe('D. Low confidence match', () => {
  it('downgrades to low_confidence_match and never promotes tax_identifier', async () => {
    const resolvers = [
      fakeResolver('CO', 'co_siis', { ...strongCoResult, confidence: 0.6 }),
    ];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      resolvers,
    );

    assert.equal(enriched.officialSource.status, 'low_confidence_match');
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.equal(enriched.taxIdentifier ?? null, null, 'strong identity not promoted');
    assert.ok(enriched.identityWarnings.includes(OFFICIAL_SOURCE_WARNING.lowConfidence));

    // Signal is retained in the officialSource result / safe metadata (default policy).
    assert.equal(enriched.officialSource.taxIdentifier, '900123456');
    assert.deepEqual(enriched.officialSource.safeMetadata, { matchedTokens: 3 });

    // Typed columns stay empty despite the raw signal.
    assert.equal(buildOfficialSourceTypedColumns(enriched).tax_identifier, null);
    assert.equal(buildOfficialSourceTypedColumns(enriched).legal_name, null);
  });

  it('drops the signal entirely when allowLowConfidenceAsSignal is false', async () => {
    const resolvers = [
      fakeResolver('CO', 'co_siis', { ...strongCoResult, confidence: 0.6 }),
    ];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      resolvers,
      { allowLowConfidenceAsSignal: false },
    );

    assert.equal(enriched.officialSource.status, 'low_confidence_match');
    assert.equal(enriched.officialSource.taxIdentifier, null);
    assert.equal(enriched.officialSource.safeMetadata, undefined);
  });
});

// ─── E. Resolver throws with fail_soft ────────────────────────────────────────
describe('E. Resolver throws (fail_soft)', () => {
  it('returns an error result without throwing', async () => {
    const resolvers: OfficialSourceResolver[] = [
      {
        countryCode: 'CO',
        sourceKey: 'co_siis',
        canResolve: () => true,
        resolve: () => {
          throw new Error('boom');
        },
      },
    ];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      resolvers,
    );

    assert.equal(enriched.officialSource.status, 'error');
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.ok(enriched.identityIssues.includes(OFFICIAL_SOURCE_ISSUE.error));
    assert.equal(buildOfficialSourceTypedColumns(enriched).tax_identifier, null);
  });
});

// ─── F. Resolver throws with fail_closed ──────────────────────────────────────
describe('F. Resolver throws (fail_closed)', () => {
  it('re-throws so the caller must handle it', async () => {
    const resolvers: OfficialSourceResolver[] = [
      {
        countryCode: 'CO',
        sourceKey: 'co_siis',
        canResolve: () => true,
        resolve: () => {
          throw new Error('hard boom');
        },
      },
    ];
    await assert.rejects(
      () =>
        enrichNormalizedProspectWithOfficialSources(
          makeCandidate(),
          CO_CRITERIA,
          resolvers,
          { errorMode: 'fail_closed' },
        ),
      /hard boom/,
    );
  });
});

// ─── G. canResolve false falls through ────────────────────────────────────────
describe('G. Resolver selection', () => {
  it('skips a resolver whose canResolve is false and uses the next', async () => {
    const resolvers = [
      fakeResolver('CO', 'co_declines', strongCoResult, /* canResolve */ false),
      fakeResolver('CO', 'co_siis', strongCoResult, /* canResolve */ true),
    ];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      resolvers,
    );
    assert.equal(enriched.officialSource.sourceKey, 'co_siis');
    assert.equal(enriched.strongIdentityAvailable, true);
  });

  it('is source_catalog_unavailable when a country resolver exists but none accept', async () => {
    const resolvers = [fakeResolver('CO', 'co_siis', strongCoResult, false)];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      resolvers,
    );
    assert.equal(enriched.officialSource.status, 'source_catalog_unavailable');
    assert.ok(
      enriched.identityWarnings.includes(OFFICIAL_SOURCE_WARNING.catalogUnavailable),
    );
  });

  it('is unsupported_country when there are no resolvers at all', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      [],
    );
    assert.equal(enriched.officialSource.status, 'unsupported_country');
  });

  it('honours unsupportedCountryMode=block as a hard issue', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate({ countryCode: 'MX', requestedCountryCode: 'MX' }),
      { countryCode: 'MX' },
      [fakeResolver('CO', 'co_siis', strongCoResult)],
      { unsupportedCountryMode: 'block' },
    );
    assert.equal(enriched.officialSource.status, 'unsupported_country');
    assert.ok(
      enriched.identityIssues.includes(OFFICIAL_SOURCE_ISSUE.unsupportedCountryBlocked),
    );
  });
});

// ─── H. No mutation ───────────────────────────────────────────────────────────
describe('H. No mutation of inputs', () => {
  it('leaves the candidate unchanged', async () => {
    const candidate = makeCandidate();
    const snapshot = JSON.stringify(candidate);
    await enrichNormalizedProspectWithOfficialSources(candidate, CO_CRITERIA, [
      fakeResolver('CO', 'co_siis', strongCoResult),
    ]);
    assert.equal(JSON.stringify(candidate), snapshot);
    // Original arrays are still the same references and still empty.
    assert.equal(candidate.warnings.length, 0);
    assert.equal(candidate.issues.length, 0);
  });

  it('does not mutate the resolver result object', async () => {
    const result: OfficialSourceEnrichmentResult = {
      ...strongCoResult,
      confidence: 0.6,
      warnings: [],
      issues: [],
    };
    const before = JSON.stringify(result);
    await enrichNormalizedProspectWithOfficialSources(makeCandidate(), CO_CRITERIA, [
      fakeResolver('CO', 'co_siis', result),
    ]);
    assert.equal(JSON.stringify(result), before);
  });
});

// ─── I. Metadata bounded ──────────────────────────────────────────────────────
describe('I. Metadata is bounded', () => {
  it('never carries raw payload keys and exposes only the allowed shape', async () => {
    const resolvers = [fakeResolver('CO', 'co_siis', strongCoResult)];
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      CO_CRITERIA,
      resolvers,
    );
    const metadata = buildOfficialSourceEnrichmentMetadata(enriched);

    for (const forbidden of [
      'raw',
      'rawPayload',
      'payload',
      'response',
      'body',
      'providerMetadataSafe',
      'address',
    ]) {
      assert.ok(!(forbidden in metadata), `metadata must not carry "${forbidden}"`);
    }

    const allowed = new Set([
      'status',
      'sourceKey',
      'countryCode',
      'confidence',
      'matchMethod',
      'taxIdentifierPresent',
      'taxIdentifierType',
      'legalName',
      'legalStatus',
      'economicActivity',
      'registryStatus',
      'strongIdentityAvailable',
      'warnings',
      'issues',
    ]);
    for (const key of Object.keys(metadata)) {
      assert.ok(allowed.has(key), `unexpected metadata key "${key}"`);
    }
    // The raw tax identifier value is NEVER in metadata — only a boolean flag.
    assert.equal(JSON.stringify(metadata).includes('900123456'), false);
  });
});

// ─── J. Provider agnostic ─────────────────────────────────────────────────────
describe('J. Provider agnostic (Lusha / Apollo / Tavily fixtures)', () => {
  const resolvers = [fakeResolver('CO', 'co_siis', strongCoResult)];

  it('enriches a Lusha-normalized CO candidate to a strong identity', async () => {
    const candidate = normalizeProviderDiscoveredCompany(
      mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyFixture),
      CO_CRITERIA,
    );
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate,
      CO_CRITERIA,
      resolvers,
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.officialSource.sourceKey, 'co_siis');
  });

  it('handles an Apollo-normalized non-CO candidate as unsupported', async () => {
    const candidate = normalizeProviderDiscoveredCompany(
      mapApolloCompanyToProviderDiscoveredCompany(apolloOrganizationFixture),
      {},
    );
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate,
      {},
      resolvers,
    );
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.equal(enriched.officialSource.status, 'unsupported_country');
  });

  it('handles a Tavily-normalized non-CO candidate without throwing', async () => {
    const candidate = normalizeProviderDiscoveredCompany(
      mapWebAiCompanyToProviderDiscoveredCompany(webAiCompanyFixture),
      {},
    );
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate,
      {},
      resolvers,
    );
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.ok(enriched.officialSource.countryCode === 'PE' || enriched.officialSource.countryCode === null);
  });
});

// ─── Default policy ───────────────────────────────────────────────────────────
describe('Default policy', () => {
  it('matches the documented defaults', () => {
    assert.deepEqual(DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY, {
      minimumStrongMatchConfidence: 0.85,
      allowLowConfidenceAsSignal: true,
      unsupportedCountryMode: 'warning',
      errorMode: 'fail_soft',
    });
  });
});
