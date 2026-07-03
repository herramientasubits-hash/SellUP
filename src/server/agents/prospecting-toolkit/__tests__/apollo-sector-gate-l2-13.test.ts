/**
 * Tests — Apollo Sector Gate + Query Mapping (L2.13)
 *
 * Verifica el wiring de subindustria al gate, la activación de Variant A,
 * y la visibilidad de evidencia por resultado Apollo.
 *
 * Escenarios:
 *   A. Runtime gate receives subindustry — subindustry_signal_used = true
 *   B. Runtime handles array subindustries — se toma la primera
 *   C. Variant A payload — formacion_corporativa + LMS criteria → variant_a_current_tags pack
 *   D. Gate no pasa query-tags-only (sin evidencia propia en resultado)
 *   E. Gate pasa CognosOnline con evidence propia (LMS / corporate training en keywords)
 *   F. Gate pasa Platzi con evidence propia (e-learning / lms en keywords)
 *   G. Gate rechaza Politécnico sin corporate evidence (solo higher education)
 *   H. Gate puede pasar Politécnico con corporate evidence
 *   I. Diagnostics include evidence visibility (evidence_fields_present, etc.)
 *   J. Regression L2.11-A — q_keywords no enviado, q_organization_keyword_tags sí
 *   K. Regression L2.12 lab — versión gate actualizada a L2.13-A
 *   L. Tavily intacto — gate no afecta resultados Tavily
 *
 * Sin llamadas reales. Sin API keys. Funciones puras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyApolloSectorRelevanceGate,
  APOLLO_SECTOR_GATE_VERSION,
} from '../apollo-sector-relevance-gate';
import {
  buildApolloOrganizationsSearchParams,
  APOLLO_QUERY_MAPPING_VERSION,
} from '../apollo-organizations-query-mapping';
import type { WebSearchInput, WebSearchResult } from '../types';
import {
  FIXTURE_POLITECNICO,
  FIXTURE_POLITECNICO_CORP,
  FIXTURE_PLATZI,
  FIXTURE_COGNOS,
  FIXTURE_PWC,
  FIXTURE_CITIGROUP,
  FIXTURE_HUAWEI,
} from './fixtures/apollo-org-real-responses';
import type { ApolloOrganization } from '@/server/integrations/apollo-client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function orgToResult(org: ApolloOrganization): WebSearchResult {
  const url = org.website_url ?? `https://${org.primary_domain ?? 'unknown.com'}`;
  return {
    title: org.name ?? 'Unknown',
    url,
    snippet: [
      `Empresa: ${org.name}`,
      org.industry ? `Industria: ${org.industry}` : null,
      org.short_description ?? null,
      org.keywords?.length ? `Keywords: ${org.keywords.join(', ')}` : null,
    ].filter(Boolean).join(' | '),
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    confidence: 0.85,
    metadata: {
      apollo_organization_id: org.id,
      domain: org.primary_domain ?? null,
      website: url,
      industry: org.industry ?? null,
      employee_count: org.estimated_num_employees ?? null,
      country: org.country ?? null,
      linkedin_url: org.linkedin_url ?? null,
      keywords: org.keywords ?? [],
      short_description: org.short_description ?? null,
      source_provider: 'apollo',
      source_key: 'apollo_organizations',
      source_type: 'structured_company_database',
    },
  };
}

function makeInput(overrides: Partial<WebSearchInput> = {}): WebSearchInput {
  return {
    query: 'plataformas lms capacitacion corporativa Colombia',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Educación',
    maxResults: 5,
    provider: 'apollo_organizations',
    subindustries: ['Formación Corporativa y Corporate Training'],
    additionalCriteriaTokens: ['lms', 'plataformas', 'capacitacion', 'comercial'],
    ...overrides,
  };
}

// ─── A. Runtime gate receives subindustry ─────────────────────────────────────

describe('A. Runtime gate receives subindustry — subindustry_signal_used = true', () => {
  it('A1. gate con subindustry activa subindustry_signal_used', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.metadata.subindustry_signal_used, true,
      'subindustry_signal_used debe ser true cuando se pasa subindustria');
  });

  it('A2. subindustry en metadata no es null cuando se pasa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.ok(result.metadata.subindustry !== null,
      'subindustry debe estar en metadata');
    assert.match(result.metadata.subindustry ?? '', /formaci/i);
  });

  it('A3. sin subindustry: subindustry_signal_used = false (comportamiento anterior)', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.metadata.subindustry_signal_used, false);
    assert.equal(result.metadata.subindustry, null);
  });
});

// ─── B. Runtime handles array subindustries ───────────────────────────────────

describe('B. Runtime handles array subindustries — primera subindustria aplica', () => {
  it('B1. primera subindustria del array se usa para gate', () => {
    // Pasamos subindustries[0] como string al gate (simulando el wiring del provider)
    const subindustry = 'Formación Corporativa y Corporate Training';
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
      subindustry,
    );
    assert.equal(result.metadata.subindustry_signal_used, true);
  });
});

// ─── C. Variant A payload ─────────────────────────────────────────────────────

describe('C. Variant A payload — formacion_corporativa + LMS criteria', () => {
  const input = makeInput();

  it('C1. pack seleccionado es variant_a_current_tags', () => {
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(meta.apollo_search_pack?.pack_key, 'variant_a_current_tags',
      `Pack seleccionado debe ser variant_a_current_tags. Got: ${meta.apollo_search_pack?.pack_key}`);
  });

  it('C2. q_organization_keyword_tags incluye corporate training + lms + workforce training', () => {
    const { params } = buildApolloOrganizationsSearchParams(input, 5);
    const tags = params.q_organization_keyword_tags ?? [];
    assert.ok(tags.includes('corporate training'), `Debe incluir "corporate training". Got: ${JSON.stringify(tags)}`);
    assert.ok(tags.includes('corporate learning') || tags.includes('lms') || tags.includes('workforce training'),
      `Debe incluir señales corporativas. Got: ${JSON.stringify(tags)}`);
  });

  it('C3. mapping_version es v1.L2.13', () => {
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(meta.mapping_version, 'v1.L2.13');
  });

  it('C4. apollo_experiment_id es variant_a_current_tags', () => {
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(meta.apollo_experiment_id, 'variant_a_current_tags',
      `apollo_experiment_id debe ser variant_a_current_tags. Got: ${meta.apollo_experiment_id}`);
  });

  it('C5. apollo_experiment_variant es variant_a_current_tags', () => {
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(meta.apollo_experiment_variant, 'variant_a_current_tags');
  });

  it('C6. apollo_experiment_label no es null', () => {
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.ok(meta.apollo_experiment_label !== null, 'apollo_experiment_label debe estar definido');
  });

  it('C7. apollo_keyword_filter_field = q_organization_keyword_tags', () => {
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(meta.apollo_keyword_filter_field, 'q_organization_keyword_tags');
  });

  it('C8. deprecated_q_keywords_sent = false', () => {
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(meta.deprecated_q_keywords_sent, false);
  });

  it('C9. params NO tiene q_keywords', () => {
    const { params } = buildApolloOrganizationsSearchParams(input, 5);
    assert.ok(!('q_keywords' in params), 'q_keywords NO debe estar en params Apollo');
  });
});

// ─── D. Gate no pasa query-tags-only ─────────────────────────────────────────

describe('D. Gate no pasa resultado genérico sin evidencia propia', () => {
  it('D1. org con solo name+domain sin industry/keywords → rechazada con subindustry gate', () => {
    const bareResult: WebSearchResult = {
      title: 'GenericCorp Colombia',
      url: 'https://genericcorp.co',
      snippet: 'Empresa: GenericCorp Colombia',
      source: 'apollo_organizations',
      rank: 1,
      provider: 'apollo_organizations',
      confidence: 0.85,
      metadata: {
        apollo_organization_id: 'test-bare',
        domain: 'genericcorp.co',
        website: 'https://genericcorp.co',
        industry: null,
        employee_count: null,
        country: 'Colombia',
        linkedin_url: null,
        keywords: [],
        short_description: null,
        source_provider: 'apollo',
        source_key: 'apollo_organizations',
        source_type: 'structured_company_database',
      },
    };
    const result = applyApolloSectorRelevanceGate(
      [bareResult],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 0,
      'Org sin evidencia propia debe ser rechazada aunque la query tenía tags LMS');
  });
});

// ─── E. Gate pasa CognosOnline con evidence propia ────────────────────────────

describe('E. Gate pasa CognosOnline con evidence propia', () => {
  it('E1. CognosOnline pasa gate estricto formacion_corporativa (lms + corporate training en keywords)', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 1,
      'CognosOnline debe pasar: tiene "lms" y "corporate training" en keywords');
  });
});

// ─── F. Gate pasa Platzi con evidence propia ─────────────────────────────────

describe('F. Gate pasa Platzi con evidence propia', () => {
  it('F1. Platzi pasa gate estricto formacion_corporativa (e-learning + lms en industry+keywords)', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 1,
      `Platzi debe pasar: industry="e-learning", keywords contienen "lms" y "e-learning". ` +
      `Passed: ${result.passed.length}, rejected_samples: ${JSON.stringify(result.metadata.rejected_samples)}`);
  });
});

// ─── G. Gate rechaza Politécnico sin corporate evidence ───────────────────────

describe('G. Gate rechaza Politécnico sin corporate evidence', () => {
  it('G1. Politécnico rechazado por gate estricto formacion_corporativa (solo higher education)', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 0,
      'Politécnico debe ser rechazado: industry="higher education", sin señales LMS/corporate training');
  });
});

// ─── H. Gate puede pasar Politécnico con corporate evidence ───────────────────

describe('H. Gate puede pasar Politécnico con corporate evidence explícita', () => {
  it('H1. Politécnico con corporate training en keywords → pasa gate formacion_corporativa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO_CORP)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 1,
      'Politécnico con corporate training en keywords debe pasar');
  });
});

// ─── I. Diagnostics include evidence visibility ───────────────────────────────

describe('I. Diagnostics include evidence visibility', () => {
  it('I1. rejected_samples incluye evidence_fields_present', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    const sample = result.metadata.rejected_samples[0];
    assert.ok(sample, 'Debe haber rejected_sample');
    assert.ok(Array.isArray(sample.evidence_fields_present),
      'evidence_fields_present debe ser array');
  });

  it('I2. rejected_samples incluye apollo_industry', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    const sample = result.metadata.rejected_samples[0];
    assert.ok('apollo_industry' in sample, 'apollo_industry debe estar en rejected_sample');
    assert.equal(sample.apollo_industry, 'higher education');
  });

  it('I3. rejected_samples incluye description_present', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    const sample = result.metadata.rejected_samples[0];
    assert.ok('description_present' in sample, 'description_present debe estar en rejected_sample');
  });

  it('I4. passed_samples incluye evidence_fields_present y provider_evidence_used', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    const sample = result.metadata.passed_samples[0];
    assert.ok(sample, 'Debe haber passed_sample');
    assert.ok(Array.isArray(sample.evidence_fields_present), 'evidence_fields_present debe ser array');
    assert.ok(Array.isArray(sample.provider_evidence_used), 'provider_evidence_used debe ser array');
  });

  it('I5. rejected_samples incluye apollo_keywords_sample', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    const sample = result.metadata.rejected_samples[0];
    assert.ok(Array.isArray(sample.apollo_keywords_sample), 'apollo_keywords_sample debe ser array');
  });
});

// ─── J. Regression L2.11-A ───────────────────────────────────────────────────

describe('J. Regression L2.11-A — q_keywords no enviado', () => {
  it('J1. params NO tiene q_keywords en ningún caso', () => {
    const inputs: WebSearchInput[] = [
      makeInput(),
      makeInput({ subindustries: [], additionalCriteriaTokens: [] }),
      makeInput({ industry: 'Tecnología', subindustries: ['SaaS B2B'] }),
    ];
    for (const input of inputs) {
      const { params } = buildApolloOrganizationsSearchParams(input, 5);
      assert.ok(!('q_keywords' in params), `q_keywords NO debe enviarse. Input: ${JSON.stringify(input.industry)}`);
    }
  });

  it('J2. q_organization_keyword_tags siempre es array cuando hay keywords', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(Array.isArray(params.q_organization_keyword_tags), 'debe ser array');
    assert.ok(params.q_organization_keyword_tags!.length > 0);
  });
});

// ─── K. Regression L2.12 lab ─────────────────────────────────────────────────

describe('K. Regression L2.12 lab — versiones actualizadas', () => {
  it('K1. APOLLO_SECTOR_GATE_VERSION es v1.L2.13-A', () => {
    assert.equal(APOLLO_SECTOR_GATE_VERSION, 'v1.L2.13-A');
  });

  it('K2. APOLLO_QUERY_MAPPING_VERSION es v1.L2.13', () => {
    assert.equal(APOLLO_QUERY_MAPPING_VERSION, 'v1.L2.13');
  });

  it('K3. PwC rechazado por gate formacion_corporativa (sin señales corporate training)', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PWC)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 0, 'PwC sigue rechazado');
  });

  it('K4. Citigroup rechazado por gate formacion_corporativa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_CITIGROUP)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 0, 'Citigroup sigue rechazado');
  });

  it('K5. Huawei rechazado por gate formacion_corporativa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_HUAWEI)],
      'Educación',
      'apollo_organizations',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 0, 'Huawei sigue rechazado');
  });
});

// ─── L. Tavily intacto ────────────────────────────────────────────────────────

describe('L. Tavily intacto — gate no aplica a resultados Tavily', () => {
  it('L1. gate con provider=tavily devuelve passthrough (enabled=false)', () => {
    const tavilyResult: WebSearchResult = {
      title: 'Universidad Nacional de Colombia',
      url: 'https://unal.edu.co',
      snippet: 'Universidad pública colombiana',
      source: 'tavily',
      rank: 1,
      provider: 'tavily',
      confidence: 0.9,
      metadata: {},
    };
    const result = applyApolloSectorRelevanceGate(
      [tavilyResult],
      'Educación',
      'tavily',
      'Formación Corporativa y Corporate Training',
    );
    assert.equal(result.passed.length, 1, 'Tavily no afectado');
    assert.equal(result.metadata.enabled, false);
  });
});
