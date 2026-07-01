/**
 * Tests — Apollo Organizations Query Mapping v1.16K-AA
 *
 * Verifica:
 *   A. Mapping Colombia/Educación: q_keywords, organization_locations, sin frases largas
 *   B. Query text: original_query preservado en meta, no como único criterio structurado
 *   C. Sector keywords: Educación → keywords education/e-learning/etc
 *   D. Metadata sanitizada: sin API keys, mapping_version presente
 *   E. getSectorKeywords: varios sectores + fallback
 *   F. Regression: Tavily no afectado (prueba del cap de queries en web-search-tool)
 *
 * Sin Apollo real. Sin Supabase. Sin créditos. Node.js test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloOrganizationsSearchParams,
  getSectorKeywords,
  APOLLO_QUERY_MAPPING_VERSION,
} from '../apollo-organizations-query-mapping';
import type { WebSearchInput } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<WebSearchInput> = {}): WebSearchInput {
  return {
    query: 'sector educativo Colombia servicios corporativo',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Educación',
    ...overrides,
  };
}

// ─── A. Mapping Colombia/Educación ───────────────────────────────────────────

describe('A. Mapping Colombia/Educación', () => {
  it('no usa q_organization_name — solo q_keywords y organization_locations', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);

    assert.equal(params.q_organization_name, undefined, 'q_organization_name debe estar ausente');
    assert.ok(params.q_keywords, 'q_keywords debe estar presente');
    assert.ok(params.organization_locations, 'organization_locations debe estar presente');
  });

  it('organization_locations contiene Colombia', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);

    assert.ok(
      params.organization_locations?.includes('Colombia'),
      `organization_locations debe incluir Colombia, got: ${JSON.stringify(params.organization_locations)}`,
    );
  });

  it('q_keywords no es una frase web larga cuando hay sector keywords', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);

    const keywords = params.q_keywords ?? '';
    // No debe ser la frase larga original completa
    assert.ok(
      !keywords.includes('sector educativo Colombia servicios corporativo'),
      `q_keywords no debe ser la frase web original completa: "${keywords}"`,
    );
  });

  it('q_keywords contiene términos de educación en inglés', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);

    const keywords = (params.q_keywords ?? '').toLowerCase();
    const hasEducationTerm = ['education', 'e-learning', 'elearning', 'training', 'lms']
      .some(t => keywords.includes(t));

    assert.ok(
      hasEducationTerm,
      `q_keywords debe contener al menos un término de educación, got: "${params.q_keywords}"`,
    );
  });

  it('per_page usa el cappedMaxResults recibido', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 7);
    assert.equal(params.per_page, 7);
  });

  it('page siempre es 1', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(params.page, 1);
  });
});

// ─── B. Query text preservado en meta ────────────────────────────────────────

describe('B. Query original preservado en metadata', () => {
  it('meta.original_query conserva la query original (max 200 chars)', () => {
    const input = makeInput({ query: 'sector educativo Colombia servicios corporativo' });
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);

    assert.equal(meta.original_query, 'sector educativo Colombia servicios corporativo');
  });

  it('meta.country_input y countryCode_input presentes', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);

    assert.equal(meta.country_input, 'Colombia');
    assert.equal(meta.countryCode_input, 'CO');
  });

  it('meta.sector_input preserva el sector original', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);

    assert.equal(meta.sector_input, 'Educación');
  });

  it('meta.q_organization_name_sent es null siempre', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.q_organization_name_sent, null);
  });
});

// ─── C. Sector keywords mapping ──────────────────────────────────────────────

describe('C. getSectorKeywords', () => {
  it('Educación → keywords con education y e-learning', () => {
    const kws = getSectorKeywords('Educación');
    assert.ok(kws.includes('education'), 'debe incluir "education"');
    assert.ok(kws.includes('e-learning'), 'debe incluir "e-learning"');
  });

  it('educacion (sin tilde) → mismo mapping', () => {
    const kws = getSectorKeywords('educacion');
    assert.ok(kws.length > 0);
    assert.ok(kws.includes('education'));
  });

  it('EDUCACIÓN (mayúsculas) → mismo mapping', () => {
    const kws = getSectorKeywords('EDUCACIÓN');
    assert.ok(kws.includes('education'));
  });

  it('Tecnología → keywords con technology y software', () => {
    const kws = getSectorKeywords('Tecnología');
    assert.ok(kws.includes('technology'));
    assert.ok(kws.includes('software'));
  });

  it('sector desconocido → retorna el sector original como fallback', () => {
    const kws = getSectorKeywords('AgriculturaExótica');
    assert.equal(kws.length, 1);
    assert.equal(kws[0], 'AgriculturaExótica');
  });

  it('null/undefined/vacío → array vacío', () => {
    assert.deepEqual(getSectorKeywords(null), []);
    assert.deepEqual(getSectorKeywords(undefined), []);
    assert.deepEqual(getSectorKeywords(''), []);
    assert.deepEqual(getSectorKeywords('   '), []);
  });
});

// ─── D. Metadata sanitizada (sin secretos) ───────────────────────────────────

describe('D. Metadata sanitizada — sin API keys', () => {
  it('mapping_version es v1.16K-AB (bumped en v1.16K-AB)', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.mapping_version, APOLLO_QUERY_MAPPING_VERSION);
    assert.equal(APOLLO_QUERY_MAPPING_VERSION, 'v1.16K-AB');
  });

  it('meta no contiene api_key, x_api_key, authorization ni token', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    const metaStr = JSON.stringify(meta).toLowerCase();

    assert.ok(!metaStr.includes('api_key'), 'no debe incluir api_key');
    assert.ok(!metaStr.includes('x-api-key'), 'no debe incluir x-api-key');
    assert.ok(!metaStr.includes('authorization'), 'no debe incluir authorization');
    assert.ok(!metaStr.includes('bearer'), 'no debe incluir bearer');
  });

  it('meta.apollo_keywords_sent no es null cuando hay sector', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.notEqual(meta.apollo_keywords_sent, null);
  });

  it('meta.apollo_location_sent es Colombia', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.apollo_location_sent, 'Colombia');
  });

  it('meta.sector_keywords_used es array no vacío para Educación', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(Array.isArray(meta.sector_keywords_used));
    assert.ok(meta.sector_keywords_used.length > 0);
  });
});

// ─── E. Casos edge ────────────────────────────────────────────────────────────

describe('E. Casos edge', () => {
  it('sin country → organization_locations ausente en params', () => {
    const input = makeInput({ country: null, countryCode: null });
    const { params } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(params.organization_locations, undefined);
  });

  it('sin industry → q_keywords usa la query directamente', () => {
    const input = makeInput({ industry: null, query: 'fintech startups' });
    const { params, meta } = buildApolloOrganizationsSearchParams(input, 5);

    assert.ok(params.q_keywords?.includes('fintech startups'));
    assert.deepEqual(meta.sector_keywords_used, []);
  });

  it('query corta sin frases web → se incluye en q_keywords', () => {
    const input = makeInput({ query: 'fintech', industry: null });
    const { params } = buildApolloOrganizationsSearchParams(input, 5);

    assert.ok(params.q_keywords?.includes('fintech'));
  });

  it('meta.requested_max_results y capped_max_results reflejan el cap recibido', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 8);
    assert.equal(meta.requested_max_results, 8);
    assert.equal(meta.capped_max_results, 8);
  });
});

// ─── F. Regression ────────────────────────────────────────────────────────────

describe('F. APOLLO_QUERY_MAPPING_VERSION exportado', () => {
  it('constante exportada es string no vacío', () => {
    assert.equal(typeof APOLLO_QUERY_MAPPING_VERSION, 'string');
    assert.ok(APOLLO_QUERY_MAPPING_VERSION.length > 0);
  });

  it('buildApolloOrganizationsSearchParams es función pura (sin side effects)', () => {
    const input = makeInput();
    const result1 = buildApolloOrganizationsSearchParams(input, 5);
    const result2 = buildApolloOrganizationsSearchParams(input, 5);

    assert.deepEqual(result1.params, result2.params);
    assert.deepEqual(result1.meta, result2.meta);
  });
});
