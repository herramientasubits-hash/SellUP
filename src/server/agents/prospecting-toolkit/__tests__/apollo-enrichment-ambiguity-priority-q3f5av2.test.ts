/**
 * Tests — Apollo Enrichment Ambiguity-First Prioritization (Q3F-5AV.2)
 *
 * Post-mortem Q3F-5AV.1: first-N selection con cap bajo podía gastar el único
 * enrichment en un candidato que ya tenía evidencia sectorial suficiente
 * (Terpel) mientras un candidato ambiguo sin evidencia (Platzi) quedaba sin
 * enriquecer y era rechazado por insufficient_sector_evidence — starvation
 * de evidencia inducida por el orden de selección, no un falso negativo real
 * del gate.
 *
 * Casos:
 *   T1. [hasEvidenceOrg, bareOrg] cap=1 → bareOrg se enriquece, hasEvidenceOrg
 *       queda cap_reached, orden final preservado.
 *   T2. Regresión Terpel/Platzi — Terpel con evidencia pre-enrichment,
 *       Platzi bare, cap=1 → Platzi recibe el enrichment.
 *   T3. Post-gate: Terpel puede rechazarse con su evidencia pre-enrichment;
 *       Platzi enriquecido puede pasar el gate de formación corporativa.
 *   T4. Todos bare → se enriquece el primero del bucket bare (orden interno
 *       preservado, cap=1).
 *   T5. Todos con evidencia → se enriquece el primero del array (paridad con
 *       comportamiento pre-Q3F-5AV.2).
 *   T6. missing_domain → nunca llama enrichOrg, priority_bucket=missing_domain.
 *   T7. cap_reached → entries posteriores conservan skip_reason=cap_reached
 *       y su priority_bucket original.
 *   T8. Flag OFF (buildDisabledCascadeMeta) no cambia — bucket_counts en cero.
 *
 * Sin llamadas reales. Sin API keys. Sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationEnrichmentCascade,
  buildDisabledCascadeMeta,
  detectPreEnrichmentEvidenceFields,
  hasPreEnrichmentEvidence,
} from '../apollo-organization-enrichment-cascade';
import { applyApolloSectorRelevanceGate } from '../apollo-sector-relevance-gate';
import { mapApolloOrganizationToSearchResult } from '../web-search-providers/apollo-organizations-search-provider';
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
    industries: org.industries,
    keywords: org.keywords,
    organization_keywords: org.organization_keywords,
    short_description: org.short_description,
    seo_description: org.seo_description,
    description: org.description,
    estimated_num_employees: org.estimated_num_employees,
    country: org.country,
  };
  return mapApolloOrganizationToSearchResult(normalized as Parameters<typeof mapApolloOrganizationToSearchResult>[0], rank);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Terpel real-world scenario: the raw Organization Search result ALREADY
// carries sector evidence (industry + keywords) sufficient for the gate to
// decide without enrichment. This is the pre-enrichment state — no Apollo
// /organizations/enrich call has happened yet.
const ORG_TERPEL_WITH_PRE_EVIDENCE: ApolloOrganization = makeOrg({
  id: 'apollo-terpel',
  name: 'Terpel',
  website_url: 'https://terpel.com',
  primary_domain: 'terpel.com',
  industry: 'Oil & Energy',
  keywords: ['fuel', 'petroleum', 'energy', 'gas station'],
  short_description: 'Terpel distributes fuel and energy products across Latin America.',
  estimated_num_employees: 8000,
});

// Platzi real-world scenario: bare search result, no industry/keywords/
// description yet — genuinely ambiguous without enrichment.
const ORG_PLATZI_BARE: ApolloOrganization = makeOrg({
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

// Generic bare/has-evidence fixtures for the non-domain-specific scenarios.
function makeBareOrg(id: string, name: string): ApolloOrganization {
  return makeOrg({ id, name, industry: null, keywords: [] });
}

function makeEvidenceOrg(id: string, name: string): ApolloOrganization {
  return makeOrg({
    id,
    name,
    industry: 'Oil & Energy',
    keywords: ['fuel', 'petroleum'],
    short_description: 'A generic energy company.',
  });
}

// ─── T1: [hasEvidence, bare] cap=1 → bare gets enrichment ────────────────────

describe('Q3F-5AV.2-T1: ambiguity-first selection over first-N', () => {
  it('enriches the bare candidate, not the one with pre-enrichment evidence, cap=1', async () => {
    let calledDomain: string | null = null;
    const enrichFn = async ({ domain }: { domain: string }) => {
      calledDomain = domain;
      return { success: true as const, data: makeEvidenceOrg('has-evidence', 'HasEvidence Co') };
    };

    const hasEvidenceResult = orgToResult(makeEvidenceOrg('has-evidence', 'HasEvidence Co'), 1);
    const bareResult = orgToResult(makeBareOrg('bare', 'Bare Co'), 2);

    const { results, meta } = await runApolloOrganizationEnrichmentCascade(
      [hasEvidenceResult, bareResult],
      1,
      { enrichOrg: enrichFn as never },
    );

    assert.equal(calledDomain, 'bare.example.com', 'enrichOrg must be called for the bare candidate, not the evidence one');
    assert.equal(meta.attempted_count, 1);
    assert.equal(meta.enriched_count, 1);

    const hasEvidenceEntry = meta.entries[0]!;
    const bareEntry = meta.entries[1]!;
    assert.equal(hasEvidenceEntry.skip_reason, 'cap_reached', 'hasEvidenceOrg must be cap_reached, not enriched');
    assert.equal(hasEvidenceEntry.priority_bucket, 'has_pre_enrichment_evidence');
    assert.equal(bareEntry.enriched, true, 'bareOrg must be enriched');
    assert.equal(bareEntry.priority_bucket, 'no_pre_enrichment_evidence');

    // Final order preserved: [hasEvidenceOrg, bareOrg]
    assert.equal(results[0]!.title, 'HasEvidence Co');
    assert.equal(results[1]!.title, 'Bare Co');
  });
});

// ─── T2: Terpel/Platzi regression ────────────────────────────────────────────

describe('Q3F-5AV.2-T2: Terpel/Platzi regression', () => {
  it('Platzi (bare) receives the enrichment slot, Terpel (pre-evidenced) does not', async () => {
    const enrichMap: Record<string, ApolloOrganization> = {
      'platzi.com': ORG_PLATZI_ENRICHED,
    };
    let enrichCallCount = 0;
    const enrichFn = async ({ domain }: { domain: string }) => {
      enrichCallCount++;
      const org = enrichMap[domain];
      if (org) return { success: true as const, data: org };
      return { success: false as const, error: { error: 'unexpected_call', message: `unexpected enrichOrg call for ${domain}` } };
    };

    const terpelResult = orgToResult(ORG_TERPEL_WITH_PRE_EVIDENCE, 1);
    const platziResult = orgToResult(ORG_PLATZI_BARE, 2);

    const { results, meta } = await runApolloOrganizationEnrichmentCascade(
      [terpelResult, platziResult],
      1,
      { enrichOrg: enrichFn as never },
    );

    assert.equal(enrichCallCount, 1, 'exactly one enrichOrg call with cap=1');
    assert.equal(meta.enriched_domains_sample.includes('platzi.com'), true, 'Platzi must be the enriched domain');
    assert.equal(meta.enriched_domains_sample.includes('terpel.com'), false, 'Terpel must not consume the enrichment slot');

    const terpelEntry = meta.entries[0]!;
    const platziEntry = meta.entries[1]!;
    assert.equal(terpelEntry.skip_reason, 'cap_reached');
    assert.equal(terpelEntry.priority_bucket, 'has_pre_enrichment_evidence');
    assert.ok(terpelEntry.pre_enrichment_evidence_fields && terpelEntry.pre_enrichment_evidence_fields.length > 0);
    assert.equal(platziEntry.enriched, true);
    assert.equal(platziEntry.priority_bucket, 'no_pre_enrichment_evidence');

    // Final order preserved: [Terpel, Platzi]
    assert.equal(results[0]!.title, 'Terpel');
    assert.equal(results[1]!.title, 'Platzi');
  });
});

// ─── T3: Post-gate expected behavior ─────────────────────────────────────────

describe('Q3F-5AV.2-T3: post-gate behavior with prioritized enrichment', () => {
  it('Terpel (pre-evidenced, unenriched) is rejected by the formacion corporativa gate', async () => {
    const enrichFn = async () => ({ success: true as const, data: ORG_PLATZI_ENRICHED });
    const terpelResult = orgToResult(ORG_TERPEL_WITH_PRE_EVIDENCE, 1);
    const platziResult = orgToResult(ORG_PLATZI_BARE, 2);

    const { results } = await runApolloOrganizationEnrichmentCascade(
      [terpelResult, platziResult],
      1,
      { enrichOrg: enrichFn as never },
    );

    const gateResult = applyApolloSectorRelevanceGate(
      results, 'Educación', 'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );

    const passedNames = gateResult.passed.map(r => r.title);
    assert.ok(!passedNames.includes('Terpel'), `Terpel must be rejected. Passed: ${JSON.stringify(passedNames)}`);
  });

  it('Platzi (bare, enriched via ambiguity-first) passes the formacion corporativa gate', async () => {
    const enrichFn = async () => ({ success: true as const, data: ORG_PLATZI_ENRICHED });
    const terpelResult = orgToResult(ORG_TERPEL_WITH_PRE_EVIDENCE, 1);
    const platziResult = orgToResult(ORG_PLATZI_BARE, 2);

    const { results } = await runApolloOrganizationEnrichmentCascade(
      [terpelResult, platziResult],
      1,
      { enrichOrg: enrichFn as never },
    );

    const gateResult = applyApolloSectorRelevanceGate(
      results, 'Educación', 'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );

    const passedNames = gateResult.passed.map(r => r.title);
    assert.ok(passedNames.includes('Platzi'), `Platzi must pass after ambiguity-first enrichment. Passed: ${JSON.stringify(passedNames)}`);
  });
});

// ─── T4: All bare → preserves order within bucket ────────────────────────────

describe('Q3F-5AV.2-T4: all-bare candidates preserve original relative order', () => {
  it('only the first bare candidate is enriched with cap=1', async () => {
    let enrichCallCount = 0;
    let lastDomain: string | null = null;
    const enrichFn = async ({ domain }: { domain: string }) => {
      enrichCallCount++;
      lastDomain = domain;
      return { success: true as const, data: makeBareOrg('x', 'X') };
    };

    const results = [
      orgToResult(makeBareOrg('org-a', 'Org A'), 1),
      orgToResult(makeBareOrg('org-b', 'Org B'), 2),
      orgToResult(makeBareOrg('org-c', 'Org C'), 3),
    ];

    const { meta } = await runApolloOrganizationEnrichmentCascade(
      results, 1, { enrichOrg: enrichFn as never },
    );

    assert.equal(enrichCallCount, 1);
    assert.equal(lastDomain, 'org-a.example.com', 'first bare candidate in original order must be enriched');
    assert.equal(meta.bucket_counts.no_evidence, 3);
    assert.equal(meta.bucket_counts.has_evidence, 0);
  });
});

// ─── T5: All with evidence → parity with pre-Q3F-5AV.2 behavior ─────────────

describe('Q3F-5AV.2-T5: all-evidence candidates parity with first-N behavior', () => {
  it('enriches the first candidate in the array when all have pre-enrichment evidence', async () => {
    let enrichCallCount = 0;
    let lastDomain: string | null = null;
    const enrichFn = async ({ domain }: { domain: string }) => {
      enrichCallCount++;
      lastDomain = domain;
      return { success: true as const, data: makeEvidenceOrg('x', 'X') };
    };

    const results = [
      orgToResult(makeEvidenceOrg('org-a', 'Org A'), 1),
      orgToResult(makeEvidenceOrg('org-b', 'Org B'), 2),
      orgToResult(makeEvidenceOrg('org-c', 'Org C'), 3),
    ];

    const { results: updated, meta } = await runApolloOrganizationEnrichmentCascade(
      results, 1, { enrichOrg: enrichFn as never },
    );

    assert.equal(enrichCallCount, 1);
    assert.equal(lastDomain, 'org-a.example.com', 'first evidence candidate in original order must be enriched');
    assert.equal(meta.bucket_counts.has_evidence, 3);
    assert.equal(meta.bucket_counts.no_evidence, 0);
    // Final order preserved
    assert.deepEqual(updated.map(r => r.title), ['Org A', 'Org B', 'Org C']);
  });
});

// ─── T6: missing_domain ───────────────────────────────────────────────────────

describe('Q3F-5AV.2-T6: missing_domain never calls enrichOrg', () => {
  it('result without domain gets priority_bucket=missing_domain, enrichOrg not called', async () => {
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
      [noDomainResult], 1, { enrichOrg: enrichFn as never },
    );

    assert.equal(called, false);
    const entry = meta.entries[0]!;
    assert.equal(entry.skip_reason, 'missing_domain');
    assert.equal(entry.priority_bucket, 'missing_domain');
    assert.equal(entry.priority_reason, 'missing_domain');
    assert.equal(meta.bucket_counts.missing_domain, 1);
  });
});

// ─── T7: cap_reached preserves bucket info ───────────────────────────────────

describe('Q3F-5AV.2-T7: cap_reached entries retain their original priority bucket', () => {
  it('entries beyond cap keep skip_reason=cap_reached and their bucket', async () => {
    const enrichFn = async () => ({ success: true as const, data: makeBareOrg('x', 'X') });
    const results = [
      orgToResult(makeBareOrg('org-a', 'Org A'), 1),
      orgToResult(makeBareOrg('org-b', 'Org B'), 2),
      orgToResult(makeEvidenceOrg('org-c', 'Org C'), 3),
    ];

    const { meta } = await runApolloOrganizationEnrichmentCascade(
      results, 1, { enrichOrg: enrichFn as never },
    );

    const entryB = meta.entries[1]!; // second bare — cap_reached within no_evidence bucket
    const entryC = meta.entries[2]!; // has evidence — cap_reached, never reached in selection order

    assert.equal(entryB.skip_reason, 'cap_reached');
    assert.equal(entryB.priority_bucket, 'no_pre_enrichment_evidence');
    assert.equal(entryC.skip_reason, 'cap_reached');
    assert.equal(entryC.priority_bucket, 'has_pre_enrichment_evidence');
  });
});

// ─── T8: Flag OFF unaffected ──────────────────────────────────────────────────

describe('Q3F-5AV.2-T8: disabled cascade path unaffected', () => {
  it('buildDisabledCascadeMeta returns zeroed bucket_counts, enabled=false', () => {
    const meta = buildDisabledCascadeMeta();
    assert.equal(meta.enabled, false);
    assert.deepEqual(meta.bucket_counts, { no_evidence: 0, has_evidence: 0, missing_domain: 0 });
  });
});

// ─── Evidence detection helpers ──────────────────────────────────────────────

describe('Q3F-5AV.2: detectPreEnrichmentEvidenceFields / hasPreEnrichmentEvidence', () => {
  it('returns field paths, not values, and empty array for bare results', () => {
    const bareResult = orgToResult(ORG_PLATZI_BARE, 1);
    assert.deepEqual(detectPreEnrichmentEvidenceFields(bareResult), []);
    assert.equal(hasPreEnrichmentEvidence(bareResult), false);
  });

  it('detects flat metadata.industry and metadata.keywords as evidence', () => {
    const evidencedResult = orgToResult(ORG_TERPEL_WITH_PRE_EVIDENCE, 1);
    const fields = detectPreEnrichmentEvidenceFields(evidencedResult);
    assert.ok(fields.includes('metadata.industry'));
    assert.ok(fields.includes('metadata.keywords'));
    assert.equal(hasPreEnrichmentEvidence(evidencedResult), true);
    // Only field NAMES — never raw values — are exposed.
    for (const f of fields) {
      assert.ok(!f.includes('Oil'), 'must not leak industry value');
      assert.ok(!f.includes('fuel'), 'must not leak keyword value');
    }
  });

  it('name/domain/country alone do not count as evidence', () => {
    const nameOnlyResult: WebSearchResult = {
      title: 'Name Only Co',
      url: 'https://nameonly.com',
      provider: 'apollo_organizations',
      rank: 1,
      metadata: { domain: 'nameonly.com', country: 'Colombia', city: 'Bogotá', linkedin_url: 'https://linkedin.com/company/nameonly' },
    };
    assert.deepEqual(detectPreEnrichmentEvidenceFields(nameOnlyResult), []);
  });
});
