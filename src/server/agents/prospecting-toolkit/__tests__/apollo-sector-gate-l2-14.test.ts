/**
 * Tests — Apollo Sector Gate + Raw Evidence Audit (L2.14)
 *
 * Verifica la preservación de evidencia raw Apollo, safe sample logging,
 * buyer exclusion y comportamiento esperado por empresa del QA L2.13.
 *
 * Escenarios:
 *   A. Raw Apollo evidence preservation — campos industry/keywords/description
 *      se preservan en apollo_profile normalizado.
 *   B. Safe sample logging — buildApolloRawResultSample captura campos correctos
 *      sin PII (sin emails, teléfonos, personas).
 *   C. Gate reads apollo_profile — keywords en apollo_profile matchean señales.
 *   D. Query tags alone not enough — org sin evidencia propia rechazada.
 *   E. Platzi with apollo_profile edtech passes — evidencia completa.
 *   F. Platzi without apollo_profile evidence rejected — bare como en QA real.
 *   G. CognosOnline with LMS evidence passes.
 *   H. Politécnico higher education rejected por gate estricto.
 *   I. Politécnico corporate training evidence passes.
 *   J. Terpel buyer signal rejected — oil+energy sin señal de producto.
 *   K. Diagnostics evidence visibility — rejected_samples contienen campos completos.
 *   L. Regression L2.13 — subindustry_signal_used, versiones.
 *   M. Regression L2.11 — q_keywords ausente, q_organization_keyword_tags presente.
 *   N. Tavily intacto — gate no afecta resultados Tavily.
 *
 * Sin llamadas reales. Sin API keys. Sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
import {
  FIXTURE_PLATZI,
  FIXTURE_PLATZI_BARE,
  FIXTURE_PLATZI_WITH_EVIDENCE,
  FIXTURE_COGNOS,
  FIXTURE_POLITECNICO,
  FIXTURE_POLITECNICO_CORP,
  FIXTURE_TERPEL,
  FIXTURE_EAFIT_BARE,
} from './fixtures/apollo-org-real-responses';

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
  const input = {
    id: org.id,
    name: org.name,
    website_url: org.website_url,
    primary_domain: org.primary_domain ?? null,
    linkedin_url: org.linkedin_url,
    industry: org.industry,
    industries: org.industries ?? [],
    estimated_num_employees: org.estimated_num_employees ?? org.employee_count,
    city: org.city,
    country: org.country,
    short_description: org.short_description ?? null,
    seo_description: org.seo_description ?? null,
    description: org.description ?? null,
    keywords: org.keywords ?? [],
    organization_keywords: org.organization_keywords ?? [],
  };
  return mapApolloOrganizationToSearchResult(input, rank);
}

// ─── A. Raw Apollo evidence preservation ─────────────────────────────────────

describe('A. Raw Apollo evidence preservation', () => {
  it('A1. apollo_profile contiene industry del raw org', () => {
    const org = makeOrg({ id: 'a1', name: 'LMSCorp', industry: 'E-learning' });
    const result = orgToResult(org);
    const meta = result.metadata as Record<string, unknown>;
    const profile = meta['apollo_profile'] as Record<string, unknown>;
    assert.equal(profile['industry'], 'E-learning');
  });

  it('A2. apollo_profile contiene keywords del raw org (max 10)', () => {
    const org = makeOrg({
      id: 'a2',
      name: 'LMSCorp',
      keywords: ['lms', 'corporate training', 'learning management system'],
    });
    const result = orgToResult(org);
    const meta = result.metadata as Record<string, unknown>;
    const profile = meta['apollo_profile'] as Record<string, unknown>;
    const kws = profile['keywords'] as string[];
    assert.ok(Array.isArray(kws));
    assert.ok(kws.includes('lms'));
    assert.ok(kws.includes('corporate training'));
  });

  it('A3. apollo_profile contiene short_description (max 300 chars)', () => {
    const org = makeOrg({
      id: 'a3',
      name: 'LMSCorp',
      short_description: 'Learning platform for companies',
    });
    const result = orgToResult(org);
    const meta = result.metadata as Record<string, unknown>;
    const profile = meta['apollo_profile'] as Record<string, unknown>;
    assert.equal(profile['short_description'], 'Learning platform for companies');
  });

  it('A4. apollo_profile contiene industries (array alternativo L2.14)', () => {
    const org = makeOrg({
      id: 'a4',
      name: 'LMSCorp',
      industries: ['E-learning', 'EdTech'],
    });
    const result = orgToResult(org);
    const meta = result.metadata as Record<string, unknown>;
    const profile = meta['apollo_profile'] as Record<string, unknown>;
    const inds = profile['industries'] as string[];
    assert.ok(Array.isArray(inds));
    assert.ok(inds.includes('E-learning'));
  });

  it('A5. apollo_profile contiene organization_keywords (array alternativo L2.14)', () => {
    const org = makeOrg({
      id: 'a5',
      name: 'LMSCorp',
      organization_keywords: ['workforce training', 'e-learning'],
    });
    const result = orgToResult(org);
    const meta = result.metadata as Record<string, unknown>;
    const profile = meta['apollo_profile'] as Record<string, unknown>;
    const okws = profile['organization_keywords'] as string[];
    assert.ok(Array.isArray(okws));
    assert.ok(okws.includes('workforce training'));
  });

  it('A6. apollo_profile contiene seo_description y description', () => {
    const org = makeOrg({
      id: 'a6',
      name: 'LMSCorp',
      seo_description: 'SEO description here',
      description: 'Full description here',
    });
    const result = orgToResult(org);
    const meta = result.metadata as Record<string, unknown>;
    const profile = meta['apollo_profile'] as Record<string, unknown>;
    assert.equal(profile['seo_description'], 'SEO description here');
    assert.equal(profile['description'], 'Full description here');
  });

  it('A7. raw_fields_present incluye campos presentes (no campos ausentes)', () => {
    const org = makeOrg({
      id: 'a7',
      name: 'LMSCorp',
      industry: 'E-learning',
      keywords: ['lms'],
    });
    const result = orgToResult(org);
    const meta = result.metadata as Record<string, unknown>;
    const profile = meta['apollo_profile'] as Record<string, unknown>;
    const present = profile['raw_fields_present'] as string[];
    assert.ok(present.includes('industry'));
    assert.ok(present.includes('keywords'));
    assert.ok(!present.includes('short_description'), 'short_description ausente no debe aparecer');
  });

  it('A8. mapping_version es APOLLO_PROFILE_MAPPING_VERSION', () => {
    const org = makeOrg({ id: 'a8', name: 'LMSCorp' });
    const result = orgToResult(org);
    const meta = result.metadata as Record<string, unknown>;
    const profile = meta['apollo_profile'] as Record<string, unknown>;
    assert.equal(profile['mapping_version'], APOLLO_PROFILE_MAPPING_VERSION);
  });
});

// ─── B. Safe sample logging ───────────────────────────────────────────────────

describe('B. Safe sample logging — buildApolloRawResultSample', () => {
  it('B1. sample incluye raw_keys_present y evidence_fields_present', () => {
    const org = makeOrg({
      id: 'b1',
      name: 'LMSCorp',
      industry: 'E-learning',
      keywords: ['lms', 'corporate training'],
      short_description: 'LMS platform for enterprises',
    });
    const sample = buildApolloRawResultSample(org);
    assert.ok(Array.isArray(sample.raw_keys_present));
    assert.ok(Array.isArray(sample.evidence_fields_present));
    assert.ok(sample.raw_keys_present.includes('industry'));
    assert.ok(sample.raw_keys_present.includes('keywords'));
    assert.ok(sample.evidence_fields_present.includes('industry'));
  });

  it('B2. sample incluye keywords_sample (max 5)', () => {
    const org = makeOrg({
      id: 'b2',
      name: 'LMSCorp',
      keywords: ['lms', 'corporate training', 'e-learning', 'edtech', 'blended'],
    });
    const sample = buildApolloRawResultSample(org);
    assert.ok(sample.keywords_sample.length <= 5);
    assert.ok(sample.keywords_sample.includes('lms'));
  });

  it('B3. sample indica has_description correctamente', () => {
    const withDesc = makeOrg({ id: 'b3a', name: 'WithDesc', short_description: 'Desc' });
    const noDesc = makeOrg({ id: 'b3b', name: 'NoDesc' });
    assert.equal(buildApolloRawResultSample(withDesc).has_description, true);
    assert.equal(buildApolloRawResultSample(noDesc).has_description, false);
  });

  it('B4. sample NO incluye emails, teléfonos ni personas', () => {
    const org = makeOrg({ id: 'b4', name: 'LMSCorp', phone: '+57-310-0000000' });
    const sample = buildApolloRawResultSample(org);
    const sampleStr = JSON.stringify(sample);
    assert.ok(!sampleStr.includes('@'), 'no debe incluir emails');
    assert.ok(!sample.raw_keys_present.includes('phone'), 'phone no debe estar en raw_keys_present');
  });

  it('B5. sample de org bare (QA L2.13 simulado) muestra evidence_fields_present vacío', () => {
    const sample = buildApolloRawResultSample(FIXTURE_PLATZI_BARE);
    assert.equal(sample.evidence_fields_present.length, 0,
      'Platzi bare sin fields: evidence_fields_present debe ser vacío');
    assert.equal(sample.has_description, false);
    assert.equal(sample.industry, null);
  });

  it('B6. description_sample limitada a 150 chars', () => {
    const longDesc = 'A'.repeat(300);
    const org = makeOrg({ id: 'b6', name: 'LMSCorp', short_description: longDesc });
    const sample = buildApolloRawResultSample(org);
    assert.ok((sample.description_sample?.length ?? 0) <= 150);
  });
});

// ─── C. Gate reads apollo_profile ────────────────────────────────────────────

describe('C. Gate reads apollo_profile — keywords en profile matchean señales', () => {
  it('C1. org con apollo_profile.keywords=["lms"] pasa gate formacion_corporativa', () => {
    const org = makeOrg({ id: 'c1', name: 'LMSCorp', keywords: ['lms'] });
    const result = orgToResult(org);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1,
      'lms en keywords debe matchear señal del gate');
    const sample = gateResult.metadata.passed_samples[0];
    assert.ok(sample?.matched_terms.includes('lms'));
  });

  it('C2. org con organization_keywords=["corporate training"] pasa gate', () => {
    const org = makeOrg({ id: 'c2', name: 'CorpTrain', organization_keywords: ['corporate training'] });
    const result = orgToResult(org);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1,
      'corporate training en organization_keywords debe matchear señal del gate');
  });

  it('C3. org con industries=["E-learning"] pasa gate (señal en industries array)', () => {
    const org = makeOrg({ id: 'c3', name: 'ELearnCo', industries: ['E-learning'] });
    const result = orgToResult(org);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1,
      'e-learning en industries array debe matchear señal del gate');
  });
});

// ─── D. Query tags alone not enough ──────────────────────────────────────────

describe('D. Query tags alone not enough — org sin evidencia propia rechazada', () => {
  it('D1. org bare (solo name+domain) rechazada aunque la query usó tags LMS', () => {
    const result = orgToResult(FIXTURE_EAFIT_BARE);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 0,
      'Sin evidencia propia debe ser rechazada aunque la query tenía tags LMS');
    const sample = gateResult.metadata.rejected_samples[0];
    assert.equal(sample?.reason, 'insufficient_sector_evidence');
  });
});

// ─── E. Platzi with apollo_profile edtech passes ─────────────────────────────

describe('E. Platzi with apollo_profile edtech passes', () => {
  it('E1. Platzi con industry="e-learning" y keywords lms/edtech pasa gate', () => {
    const result = orgToResult(FIXTURE_PLATZI_WITH_EVIDENCE);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1,
      'Platzi con evidence completa debe pasar gate formacion_corporativa');
  });
});

// ─── F. Platzi without apollo_profile evidence rejected ──────────────────────

describe('F. Platzi without apollo_profile evidence rejected', () => {
  it('F1. Platzi bare (sin industry/keywords/description) rechazada — simula QA L2.13', () => {
    const result = orgToResult(FIXTURE_PLATZI_BARE);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 0,
      'Platzi sin evidencia de Apollo debe ser rechazada (como en QA L2.13)');
    const sample = gateResult.metadata.rejected_samples[0];
    assert.equal(sample?.reason, 'insufficient_sector_evidence');
  });
});

// ─── G. CognosOnline with LMS evidence passes ────────────────────────────────

describe('G. CognosOnline with LMS evidence passes', () => {
  it('G1. CognosOnline con keywords lms+corporate training pasa gate estricto', () => {
    const result = orgToResult(FIXTURE_COGNOS);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1,
      'CognosOnline debe pasar: tiene lms y corporate training');
  });
});

// ─── H. Politécnico higher education rejected ────────────────────────────────

describe('H. Politécnico higher education rejected', () => {
  it('H1. Politécnico con industry="higher education" rechazado por gate estricto', () => {
    const result = orgToResult(FIXTURE_POLITECNICO);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 0,
      'Politécnico sin señales LMS/corporate training debe ser rechazado');
  });
});

// ─── I. Politécnico corporate training evidence passes ───────────────────────

describe('I. Politécnico corporate training evidence can pass', () => {
  it('I1. Politécnico con corporate training en keywords pasa gate', () => {
    const result = orgToResult(FIXTURE_POLITECNICO_CORP);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1,
      'Politécnico con corporate training en keywords debe pasar');
    const sample = gateResult.metadata.passed_samples[0];
    assert.ok((sample?.matched_terms.length ?? 0) > 0, 'debe mostrar matched_terms');
  });
});

// ─── J. Terpel buyer signal rejected ─────────────────────────────────────────

describe('J. Terpel buyer signal rejected', () => {
  it('J1. Terpel (oil+energy) con employee_training keywords rechazado como buyer', () => {
    const result = orgToResult(FIXTURE_TERPEL);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 0,
      'Terpel (oil+energy, sin señal de producto LMS) debe ser rechazado como buyer');
    const sample = gateResult.metadata.rejected_samples[0];
    assert.ok(
      sample?.reason === 'buyer_or_non_vendor_signal' || sample?.reason === 'insufficient_sector_evidence',
      `Terpel debe tener reason buyer_or_non_vendor_signal o insufficient_sector_evidence. Got: ${sample?.reason}`,
    );
  });

  it('J2. Terpel rechazado incluso con matched_terms genéricos (buyer exclusion activa)', () => {
    // Terpel tiene "employee training" y "workforce training" en keywords.
    // Con buyer exclusion activa (subindustry gate), esas señales no bastan.
    const result = orgToResult(FIXTURE_TERPEL);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    // Si pasara el gate, sería un falso positivo: Terpel no es vendor LMS.
    assert.equal(gateResult.passed.length, 0);
  });

  it('J3. Terpel con vendor product signal (lms) SÍ pasaría gate', () => {
    // Si Terpel adquiriera una plataforma LMS y Apollo lo indexara así,
    // debería pasar (es un edge case legítimo).
    const terpelLms = makeOrg({
      id: 'terpel-lms',
      name: 'Terpel Digital',
      industry: 'oil & energy',
      keywords: ['employee training', 'lms', 'e-learning platform'],
    });
    const result = orgToResult(terpelLms);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1,
      'Terpel con "lms" (vendor product signal) debe pasar buyer exclusion');
  });
});

// ─── K. Diagnostics evidence visibility ──────────────────────────────────────

describe('K. Diagnostics evidence visibility', () => {
  it('K1. rejected_samples incluye evidence_fields_present, apollo_industry, description_present', () => {
    const result = orgToResult(FIXTURE_POLITECNICO);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    const sample = gateResult.metadata.rejected_samples[0];
    assert.ok(sample, 'debe haber rejected_sample');
    assert.ok(Array.isArray(sample.evidence_fields_present));
    assert.ok('apollo_industry' in sample);
    assert.ok('description_present' in sample);
    assert.ok(Array.isArray(sample.apollo_keywords_sample));
    assert.ok(Array.isArray(sample.provider_evidence_used));
  });

  it('K2. passed_samples incluye matched_terms y provider_evidence_used', () => {
    const result = orgToResult(FIXTURE_COGNOS);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    const sample = gateResult.metadata.passed_samples[0];
    assert.ok(sample, 'debe haber passed_sample');
    assert.ok(sample.matched_terms.length > 0, 'matched_terms no debe estar vacío');
    assert.ok(Array.isArray(sample.provider_evidence_used));
  });
});

// ─── L. Regression L2.13 ─────────────────────────────────────────────────────

describe('L. Regression L2.13 — subindustry_signal_used, versiones', () => {
  it('L1. APOLLO_SECTOR_GATE_VERSION es v1.L2.14-A', () => {
    assert.equal(APOLLO_SECTOR_GATE_VERSION, 'v1.L2.14-A');
  });

  it('L2. APOLLO_QUERY_MAPPING_VERSION es v1.L2.13 (sin cambio)', () => {
    assert.equal(APOLLO_QUERY_MAPPING_VERSION, 'v1.L2.13');
  });

  it('L3. gate con subindustry activa subindustry_signal_used=true', () => {
    const result = orgToResult(FIXTURE_COGNOS);
    const gateResult = applyApolloSectorRelevanceGate(
      [result], 'Educación', 'apollo_organizations', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.metadata.subindustry_signal_used, true);
  });
});

// ─── M. Regression L2.11 ─────────────────────────────────────────────────────

describe('M. Regression L2.11 — q_keywords ausente, q_organization_keyword_tags presente', () => {
  it('M1. params NO tiene q_keywords', () => {
    const { params } = buildApolloOrganizationsSearchParams({
      query: 'lms colombia',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Educación',
      maxResults: 5,
      provider: 'apollo_organizations',
      subindustries: ['Formación Corporativa y Corporate Training'],
    }, 5);
    assert.ok(!('q_keywords' in params), 'q_keywords NO debe enviarse');
  });

  it('M2. q_organization_keyword_tags es array con elementos', () => {
    const { params } = buildApolloOrganizationsSearchParams({
      query: 'lms colombia',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Educación',
      maxResults: 5,
      provider: 'apollo_organizations',
      subindustries: ['Formación Corporativa y Corporate Training'],
    }, 5);
    assert.ok(Array.isArray(params.q_organization_keyword_tags));
    assert.ok((params.q_organization_keyword_tags?.length ?? 0) > 0);
  });
});

// ─── N. Tavily intacto ────────────────────────────────────────────────────────

describe('N. Tavily intacto — gate no afecta resultados Tavily', () => {
  it('N1. gate con provider=tavily devuelve passthrough (enabled=false)', () => {
    const tavilyResult: WebSearchResult = {
      title: 'Platzi',
      url: 'https://platzi.com',
      snippet: 'Plataforma de educación online',
      source: 'tavily',
      rank: 1,
      provider: 'tavily',
      confidence: 0.9,
      metadata: {},
    };
    const gateResult = applyApolloSectorRelevanceGate(
      [tavilyResult], 'Educación', 'tavily', 'Formación Corporativa y Corporate Training',
    );
    assert.equal(gateResult.passed.length, 1, 'Tavily no afectado');
    assert.equal(gateResult.metadata.enabled, false);
    assert.equal(gateResult.metadata.strategy, 'passthrough');
  });
});
