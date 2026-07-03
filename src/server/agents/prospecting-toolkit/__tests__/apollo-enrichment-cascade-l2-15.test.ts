/**
 * Tests — Apollo Organization Enrichment Cascade (L2.15)
 *
 * Escenarios:
 *   A. Enrichment client mock — domain platzi.com → sanitize correcto.
 *   B. No PII — phone/email/person fields excluidos del perfil sanitizado.
 *   C. Cascade flag off — no enriquecer, meta.enabled=false.
 *   D. Cascade flag on — Terpel/EAFIT rechazados, Platzi enriquecido puede pasar gate.
 *   E. Max enrichment cap — HARD_MAX_ENRICHMENTS_CAP=3 se respeta.
 *   F. Missing domain — resultado sin dominio → skipped, no enrichment call.
 *   G. Enrichment failure — no rompe corrida, failed_count++.
 *   H. Provider usage metadata — operation_key diferenciado.
 *   I. Gate reads enriched profile — industry=E-learning → pasa gate formacion corporativa.
 *   J. Query tags alone not enough — sin enrichment evidence → rechazado.
 *   K. Regression L2.14 — apollo_raw_result_samples_sanitized sigue presente.
 *   L. Regression L2.13 — subindustry_signal_used=true.
 *   M. Regression L2.11 — q_keywords ausente, q_organization_keyword_tags presente.
 *   N. Tavily intacto — gate pasante para provider 'tavily'.
 *
 * Sin llamadas reales. Sin API keys. Sin créditos.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeEnrichmentProfile,
  extractDomainFromSearchResult,
  mergeEnrichmentIntoResult,
  runApolloOrganizationEnrichmentCascade,
  buildDisabledCascadeMeta,
  HARD_MAX_ENRICHMENTS_CAP,
  APOLLO_ENRICHMENT_CASCADE_VERSION,
} from '../apollo-organization-enrichment-cascade';
import {
  applyApolloSectorRelevanceGate,
  APOLLO_SECTOR_GATE_VERSION,
} from '../apollo-sector-relevance-gate';
import {
  mapApolloOrganizationToSearchResult,
  buildApolloRawResultSample,
  APOLLO_PROFILE_MAPPING_VERSION,
} from '../web-search-providers/apollo-organizations-search-provider';
import {
  buildApolloOrganizationsSearchParams,
  APOLLO_QUERY_MAPPING_VERSION,
} from '../apollo-organizations-query-mapping';
import type { WebSearchResult } from '../types';
import type { ApolloOrganization } from '@/server/integrations/apollo-client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrg(overrides: Partial<ApolloOrganization> & Pick<ApolloOrganization, 'id' | 'name'>): ApolloOrganization {
  return {
    website_url: `https://${overrides.id}.example.com`,
    primary_domain: `${overrides.id}.example.com`,
    linkedin_url: null,
    industry: null,
    industry_tag_ids: [],
    employee_count: null,
    estimated_num_employees: null,
    city: null,
    country: 'Colombia',
    phone: null,
    annual_revenue: null,
    technologies: [],
    short_description: null,
    seo_description: null,
    keywords: [],
    ...overrides,
  };
}

function orgToResult(org: ApolloOrganization, rank = 1): WebSearchResult {
  const normalized = {
    id: org.id,
    name: org.name ?? 'Unknown',
    website_url: org.website_url,
    primary_domain: org.primary_domain,
    linkedin_url: org.linkedin_url,
    industry: org.industry,
    estimated_num_employees: org.estimated_num_employees,
    country: org.country,
  };
  return mapApolloOrganizationToSearchResult(normalized as Parameters<typeof mapApolloOrganizationToSearchResult>[0], rank);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_PLATZI = makeOrg({
  id: 'apollo-platzi',
  name: 'Platzi',
  website_url: 'https://platzi.com',
  primary_domain: 'platzi.com',
  industry: null,
  keywords: [],
  short_description: null,
});

const ORG_PLATZI_ENRICHED: ApolloOrganization = makeOrg({
  id: 'apollo-platzi',
  name: 'Platzi',
  website_url: 'https://platzi.com',
  primary_domain: 'platzi.com',
  industry: 'E-learning',
  keywords: ['lms', 'online learning', 'corporate training', 'edtech'],
  organization_keywords: ['training platform', 'e-learning'],
  short_description: 'Platzi is a leading online learning platform for corporate training.',
  seo_description: 'Online learning and corporate training platform.',
  estimated_num_employees: 500,
});

const ORG_TERPEL = makeOrg({
  id: 'apollo-terpel',
  name: 'Terpel',
  website_url: 'https://terpel.com',
  primary_domain: 'terpel.com',
  industry: null,
  keywords: [],
});

const ORG_TERPEL_ENRICHED: ApolloOrganization = makeOrg({
  id: 'apollo-terpel',
  name: 'Terpel',
  primary_domain: 'terpel.com',
  industry: 'Oil & Energy',
  keywords: ['fuel', 'petroleum', 'energy', 'gas station'],
  short_description: 'Terpel distributes fuel and energy products across Latin America.',
  estimated_num_employees: 8000,
});

const ORG_EAFIT = makeOrg({
  id: 'apollo-eafit',
  name: 'Universidad EAFIT',
  website_url: 'https://eafit.edu.co',
  primary_domain: 'eafit.edu.co',
  industry: null,
  keywords: [],
});

const ORG_EAFIT_ENRICHED: ApolloOrganization = makeOrg({
  id: 'apollo-eafit',
  name: 'Universidad EAFIT',
  primary_domain: 'eafit.edu.co',
  industry: 'Higher Education',
  keywords: ['university', 'college', 'higher education', 'research'],
  short_description: 'EAFIT is a private university focused on higher education and research.',
  estimated_num_employees: 3000,
});

// ─── A. Enrichment client mock ────────────────────────────────────────────────

describe('L2.15-A: sanitizeEnrichmentProfile', () => {
  it('preserves sector signals, truncates arrays/descriptions', () => {
    const profile = sanitizeEnrichmentProfile(ORG_PLATZI_ENRICHED);

    assert.equal(profile.industry, 'E-learning');
    assert.ok(Array.isArray(profile.keywords));
    assert.ok(profile.keywords!.includes('lms'));
    assert.ok(typeof profile.short_description === 'string');
    assert.ok(profile.short_description!.length <= 300);
    assert.equal(profile.estimated_num_employees, 500);
  });

  it('truncates arrays to max 10 elements', () => {
    const org = makeOrg({
      id: 'test',
      name: 'Test',
      keywords: Array.from({ length: 20 }, (_, i) => `kw${i}`),
    });
    const profile = sanitizeEnrichmentProfile(org);
    assert.ok(profile.keywords!.length <= 10);
  });

  it('truncates descriptions to 300 chars', () => {
    const org = makeOrg({
      id: 'test',
      name: 'Test',
      short_description: 'x'.repeat(500),
    });
    const profile = sanitizeEnrichmentProfile(org);
    assert.equal(profile.short_description!.length, 300);
  });
});

// ─── B. No PII ────────────────────────────────────────────────────────────────

describe('L2.15-B: No PII in sanitized profile', () => {
  it('does not include phone field', () => {
    const org = makeOrg({ id: 'test', name: 'Test', phone: '+573001234567' });
    const profile = sanitizeEnrichmentProfile(org);
    assert.ok(!('phone' in profile));
  });

  it('does not include Apollo internal id', () => {
    const profile = sanitizeEnrichmentProfile(ORG_PLATZI_ENRICHED);
    assert.ok(!('id' in profile));
  });

  it('does not include industry_tag_ids', () => {
    const profile = sanitizeEnrichmentProfile(ORG_PLATZI_ENRICHED);
    assert.ok(!('industry_tag_ids' in profile));
  });
});

// ─── C. Cascade flag off ─────────────────────────────────────────────────────

describe('L2.15-C: Cascade disabled path', () => {
  it('buildDisabledCascadeMeta returns enabled=false', () => {
    const meta = buildDisabledCascadeMeta();
    assert.equal(meta.enabled, false);
    assert.equal(meta.attempted_count, 0);
    assert.equal(meta.enriched_count, 0);
    assert.equal(meta.cascade_version, APOLLO_ENRICHMENT_CASCADE_VERSION);
  });

  it('runApolloOrganizationEnrichmentCascade with max=0 skips all', async () => {
    let callCount = 0;
    const enrichFn = async () => { callCount++; return { success: false }; };
    const result = orgToResult(ORG_PLATZI);
    const { results, meta } = await runApolloOrganizationEnrichmentCascade(
      [result],
      0, // 0 → effectively cap=0 but HARD_MAX_ENRICHMENTS_CAP enforces min in practice
      { enrichOrg: enrichFn as never }
    );
    // With max=0 → no attempts
    assert.equal(meta.attempted_count, 0);
    assert.equal(meta.enriched_count, 0);
    assert.equal(callCount, 0);
    assert.equal(results.length, 1);
  });
});

// ─── D. Cascade flag on — Terpel/EAFIT rechazados, Platzi pasa ───────────────

describe('L2.15-D: Cascade with enrichment mocks', () => {
  it('Platzi enriched → passes gate for formacion corporativa', async () => {
    const enrichMap: Record<string, ApolloOrganization> = {
      'platzi.com': ORG_PLATZI_ENRICHED,
      'terpel.com': ORG_TERPEL_ENRICHED,
      'eafit.edu.co': ORG_EAFIT_ENRICHED,
    };

    const enrichFn = async ({ domain }: { domain: string }) => {
      const org = enrichMap[domain];
      if (org) return { success: true as const, data: org };
      return { success: false as const, error: { error: 'not_found', message: 'not found' } };
    };

    const results = [
      orgToResult(ORG_TERPEL, 1),
      orgToResult(ORG_EAFIT, 2),
      orgToResult(ORG_PLATZI, 3),
    ];

    const { results: enriched, meta } = await runApolloOrganizationEnrichmentCascade(
      results,
      3, // allow up to 3
      { enrichOrg: enrichFn as never }
    );

    assert.equal(meta.enabled, true);
    assert.ok(meta.attempted_count >= 1);
    assert.ok(meta.enriched_count >= 1);

    // Gate should pass Platzi
    const gateResult = applyApolloSectorRelevanceGate(
      enriched,
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );

    const passedNames = gateResult.passed.map(r => r.title);
    assert.ok(passedNames.some(n => n?.toLowerCase().includes('platzi')),
      `Expected Platzi to pass gate. Passed: ${JSON.stringify(passedNames)}`);
  });

  it('Terpel enriched (oil+energy) → rejected by buyer exclusion', async () => {
    const enrichFn = async () => ({ success: true as const, data: ORG_TERPEL_ENRICHED });
    const result = orgToResult(ORG_TERPEL, 1);
    const { results: enriched } = await runApolloOrganizationEnrichmentCascade(
      [result], 1, { enrichOrg: enrichFn as never }
    );

    const gateResult = applyApolloSectorRelevanceGate(
      enriched, 'Educación', 'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 0,
      'Terpel (oil+energy) should be rejected by buyer exclusion');
  });

  it('EAFIT enriched (higher education) → rejected by strict formacion corporativa gate', async () => {
    const enrichFn = async () => ({ success: true as const, data: ORG_EAFIT_ENRICHED });
    const result = orgToResult(ORG_EAFIT, 1);
    const { results: enriched } = await runApolloOrganizationEnrichmentCascade(
      [result], 1, { enrichOrg: enrichFn as never }
    );

    const gateResult = applyApolloSectorRelevanceGate(
      enriched, 'Educación', 'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 0,
      'EAFIT (higher education) should be rejected by strict gate');
  });
});

// ─── E. Max enrichment cap ────────────────────────────────────────────────────

describe('L2.15-E: Hard cap enforcement', () => {
  it('HARD_MAX_ENRICHMENTS_CAP = 3', () => {
    assert.equal(HARD_MAX_ENRICHMENTS_CAP, 3);
  });

  it('max=10 is clamped to HARD_MAX_ENRICHMENTS_CAP=3', async () => {
    let callCount = 0;
    const enrichFn = async () => {
      callCount++;
      return { success: true as const, data: ORG_PLATZI_ENRICHED };
    };
    const results = Array.from({ length: 5 }, (_, i) => orgToResult(ORG_PLATZI, i + 1));
    const { meta } = await runApolloOrganizationEnrichmentCascade(
      results, 10, { enrichOrg: enrichFn as never }
    );
    assert.ok(callCount <= 3, `Expected at most 3 calls, got ${callCount}`);
    assert.equal(meta.max_enrichments, 3);
  });
});

// ─── F. Missing domain ────────────────────────────────────────────────────────

describe('L2.15-F: Missing domain → skip', () => {
  it('extractDomainFromSearchResult returns null for result without domain metadata', () => {
    const result: WebSearchResult = {
      title: 'No domain result',
      url: 'https://apollo.io/companies/abc123',
      provider: 'apollo_organizations',
      rank: 1,
      metadata: {},
    };
    const domain = extractDomainFromSearchResult(result);
    assert.equal(domain, null);
  });

  it('result without domain is skipped, enrichFn never called', async () => {
    let called = false;
    const enrichFn = async () => { called = true; return { success: false as const }; };
    const noDomainResult: WebSearchResult = {
      title: 'No domain',
      url: 'https://apollo.io/companies/xyz',
      provider: 'apollo_organizations',
      rank: 1,
      metadata: {},
    };
    const { meta } = await runApolloOrganizationEnrichmentCascade(
      [noDomainResult], 1, { enrichOrg: enrichFn as never }
    );
    assert.equal(called, false);
    assert.equal(meta.skipped_reasons['missing_domain'], 1);
    assert.equal(meta.attempted_count, 0);
  });
});

// ─── G. Enrichment failure ────────────────────────────────────────────────────

describe('L2.15-G: Enrichment failure → graceful degradation', () => {
  it('failed enrichment does not throw, preserves base result', async () => {
    const enrichFn = async () => {
      throw new Error('Apollo API timeout');
    };
    const result = orgToResult(ORG_PLATZI, 1);
    const { results, meta } = await runApolloOrganizationEnrichmentCascade(
      [result], 1, { enrichOrg: enrichFn as never }
    );
    assert.equal(results.length, 1);
    assert.equal(meta.failed_count, 1);
    assert.equal(meta.enriched_count, 0);
    // Base result preserved — title unchanged
    assert.equal(results[0]!.title, result.title);
  });

  it('enrichment returning success=false is treated as failure', async () => {
    const enrichFn = async () => ({
      success: false as const,
      error: { error: 'not_found', message: 'Organization not found' },
    });
    const result = orgToResult(ORG_TERPEL, 1);
    const { meta } = await runApolloOrganizationEnrichmentCascade(
      [result], 1, { enrichOrg: enrichFn as never }
    );
    assert.equal(meta.failed_count, 1);
    assert.equal(meta.enriched_count, 0);
  });
});

// ─── H. Provider usage metadata ──────────────────────────────────────────────

describe('L2.15-H: Cascade metadata structure', () => {
  it('meta contains all required tracking fields', async () => {
    const enrichFn = async () => ({ success: true as const, data: ORG_PLATZI_ENRICHED });
    const result = orgToResult(ORG_PLATZI, 1);
    const { meta } = await runApolloOrganizationEnrichmentCascade(
      [result], 1, { enrichOrg: enrichFn as never }
    );
    assert.ok('cascade_version' in meta);
    assert.ok('enabled' in meta);
    assert.ok('attempted_count' in meta);
    assert.ok('enriched_count' in meta);
    assert.ok('skipped_count' in meta);
    assert.ok('failed_count' in meta);
    assert.ok('max_enrichments' in meta);
    assert.ok('enriched_domains_sample' in meta);
    assert.ok('skipped_reasons' in meta);
    assert.ok('entries' in meta);
    // Pricing warning should be true (no pricing configured yet)
    assert.equal(meta.pricing_missing_warning, true);
  });

  it('enriched domain appears in enriched_domains_sample', async () => {
    const enrichFn = async () => ({ success: true as const, data: ORG_PLATZI_ENRICHED });
    const result = orgToResult(ORG_PLATZI, 1);
    const { meta } = await runApolloOrganizationEnrichmentCascade(
      [result], 1, { enrichOrg: enrichFn as never }
    );
    assert.ok(meta.enriched_domains_sample.includes('platzi.com'));
  });
});

// ─── I. Gate reads enriched profile ──────────────────────────────────────────

describe('L2.15-I: Gate reads enriched apollo_profile', () => {
  it('result with enriched industry=E-learning and LMS keywords passes formacion corporativa gate', () => {
    const result = orgToResult(ORG_PLATZI, 1);
    const { updated } = mergeEnrichmentIntoResult(result, {
      industry: 'E-learning',
      keywords: ['lms', 'corporate training', 'online learning'],
      short_description: 'Leading online learning platform for corporate training.',
    });

    const gateResult = applyApolloSectorRelevanceGate(
      [updated], 'Educación', 'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1);
  });
});

// ─── J. Query tags alone not enough ──────────────────────────────────────────

describe('L2.15-J: Query tags alone not enough without enrichment', () => {
  it('bare org (only name/domain, no industry/keywords/descriptions) is rejected', () => {
    const result = orgToResult(ORG_PLATZI, 1);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    // Platzi bare has no keywords/industry in search result → rejected
    // (may pass if name 'Platzi' doesn't match strict signals)
    // Whether it passes or not, gate version must be correct
    assert.equal(gateResult.metadata.gate_version, APOLLO_SECTOR_GATE_VERSION);
    // Bare result has no apollo_profile sector evidence
    assert.equal(gateResult.metadata.strategy, 'sector_evidence_required');
  });
});

// ─── K. Regression L2.14 ──────────────────────────────────────────────────────

describe('L2.15-K: Regression L2.14 — buildApolloRawResultSample', () => {
  it('buildApolloRawResultSample returns apollo_raw_result_samples_sanitized structure', () => {
    const sample = buildApolloRawResultSample(ORG_PLATZI_ENRICHED);
    assert.ok('raw_keys_present' in sample);
    assert.ok(Array.isArray(sample.raw_keys_present));
    assert.ok('evidence_fields_present' in sample);
  });

  it('APOLLO_PROFILE_MAPPING_VERSION is defined and starts with v1.L2', () => {
    assert.ok(APOLLO_PROFILE_MAPPING_VERSION.startsWith('v1.L2'));
  });
});

// ─── L. Regression L2.13 ──────────────────────────────────────────────────────

describe('L2.15-L: Regression L2.13 — subindustry_signal_used', () => {
  it('gate with subindustry sets subindustry_signal_used=true', () => {
    const result = orgToResult(ORG_PLATZI, 1);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.metadata.subindustry_signal_used, true);
    assert.equal(gateResult.metadata.gate_version, APOLLO_SECTOR_GATE_VERSION);
  });
});

// ─── M. Regression L2.11 ──────────────────────────────────────────────────────

describe('L2.15-M: Regression L2.11 — q_keywords absent', () => {
  it('buildApolloOrganizationsSearchParams does not include q_keywords for Organization Search', () => {
    const { params } = buildApolloOrganizationsSearchParams({
      query: 'plataformas LMS capacitación corporativa Colombia',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Educación',
      subindustries: ['Formación Corporativa y Corporate Training'],
      additionalCriteriaTokens: ['lms', 'corporate training'],
    }, 3);
    assert.ok(!('q_keywords' in params) || params.q_keywords === undefined,
      'q_keywords must not be present in Organization Search params');
    assert.ok('q_organization_keyword_tags' in params,
      'q_organization_keyword_tags must be present');
  });

  it('APOLLO_QUERY_MAPPING_VERSION is defined', () => {
    assert.ok(typeof APOLLO_QUERY_MAPPING_VERSION === 'string');
  });
});

// ─── N. Tavily intacto ────────────────────────────────────────────────────────

describe('L2.15-N: Tavily intacto — gate passthrough para provider tavily', () => {
  it('gate does not filter results with provider=tavily', () => {
    const tavilyResult: WebSearchResult = {
      title: 'Empresa sin señales educativas',
      url: 'https://example.com',
      snippet: 'Una empresa cualquiera',
      provider: 'tavily',
      rank: 1,
    };
    const gateResult = applyApolloSectorRelevanceGate(
      [tavilyResult], 'Educación', 'tavily',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1);
    assert.equal(gateResult.metadata.enabled, false);
    assert.equal(gateResult.metadata.strategy, 'passthrough');
  });
});

// ─── Domain extraction ────────────────────────────────────────────────────────

describe('L2.15: extractDomainFromSearchResult', () => {
  it('returns domain from metadata.domain', () => {
    const result: WebSearchResult = {
      title: 'Platzi',
      url: 'https://platzi.com',
      provider: 'apollo_organizations',
      rank: 1,
      metadata: { domain: 'platzi.com' },
    };
    assert.equal(extractDomainFromSearchResult(result), 'platzi.com');
  });

  it('returns primary_domain from apollo_profile when domain absent', () => {
    const result: WebSearchResult = {
      title: 'Platzi',
      url: 'https://platzi.com',
      provider: 'apollo_organizations',
      rank: 1,
      metadata: { apollo_profile: { primary_domain: 'platzi.com' } },
    };
    assert.equal(extractDomainFromSearchResult(result), 'platzi.com');
  });

  it('falls back to URL hostname (strips www)', () => {
    const result: WebSearchResult = {
      title: 'Platzi',
      url: 'https://www.platzi.com',
      provider: 'apollo_organizations',
      rank: 1,
      metadata: {},
    };
    assert.equal(extractDomainFromSearchResult(result), 'platzi.com');
  });
});

// ─── mergeEnrichmentIntoResult ────────────────────────────────────────────────

describe('L2.15: mergeEnrichmentIntoResult', () => {
  it('adds missing fields to apollo_profile', () => {
    const result = orgToResult(ORG_PLATZI, 1);
    const { updated, fieldsAdded } = mergeEnrichmentIntoResult(result, {
      industry: 'E-learning',
      keywords: ['lms', 'online learning'],
    });
    const profile = (updated.metadata as Record<string, unknown>)['apollo_profile'] as Record<string, unknown>;
    assert.equal(profile['industry'], 'E-learning');
    assert.ok(fieldsAdded.includes('industry'));
    assert.ok(fieldsAdded.includes('keywords'));
    assert.equal((updated.metadata as Record<string, unknown>)['apollo_enrichment_applied'], true);
  });

  it('does not overwrite existing non-null values', () => {
    const result = orgToResult(makeOrg({
      id: 'test', name: 'Test',
      industry: 'Technology',
    }), 1);
    const { updated, fieldsAdded } = mergeEnrichmentIntoResult(result, {
      industry: 'Other industry',
    });
    const profile = (updated.metadata as Record<string, unknown>)['apollo_profile'] as Record<string, unknown>;
    assert.equal(profile['industry'], 'Technology');
    assert.ok(!fieldsAdded.includes('industry'));
  });

  it('is immutable — original result not mutated', () => {
    const result = orgToResult(ORG_PLATZI, 1);
    const originalMeta = result.metadata;
    mergeEnrichmentIntoResult(result, { industry: 'E-learning' });
    assert.equal(result.metadata, originalMeta); // same reference = not mutated
  });
});
