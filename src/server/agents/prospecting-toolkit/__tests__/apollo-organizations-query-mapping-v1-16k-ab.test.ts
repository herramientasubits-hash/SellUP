/**
 * Tests — Apollo Organizations Query Mapping v1.16K-AB
 *
 * Verifica el hardening de relevancia del sector Educación:
 *   A. Educación: "education" genérico no está entre las primeras keywords
 *   B. No se usa q_organization_name con frases largas
 *   C. Metadata v1.16K-AB: mapping_version, relevance_strategy, generic_keywords_deprioritized
 *   D. Fallback seguro para sectores no mapeados
 *   E. Sin secretos en metadata
 *   F. Cap de queries Apollo sigue vigente (MAX_APOLLO_ORGANIZATIONS_QUERIES_PER_RUN = 3)
 *   G. Regression: provider Tavily no usa mapping Apollo
 *
 * Sin Apollo real. Sin Supabase. Sin créditos.
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

/** Extrae las keywords individuales enviadas a Apollo como array. */
function sentKeywords(input: WebSearchInput): string[] {
  const { params } = buildApolloOrganizationsSearchParams(input, 5);
  return (params.q_keywords ?? '').split(' ').filter(Boolean);
}

// ─── A. Educación: señales específicas primero ────────────────────────────────

describe('A. Educación: "education" genérico no priorizado', () => {
  it('q_keywords del slice inicial contiene learning management system', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(
      params.q_keywords?.includes('learning management system'),
      `q_keywords debe incluir "learning management system", got: "${params.q_keywords}"`,
    );
  });

  it('q_keywords del slice inicial contiene lms', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(
      params.q_keywords?.toLowerCase().includes('lms'),
      `q_keywords debe incluir "lms", got: "${params.q_keywords}"`,
    );
  });

  it('q_keywords del slice inicial contiene corporate training', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(
      params.q_keywords?.includes('corporate training'),
      `q_keywords debe incluir "corporate training", got: "${params.q_keywords}"`,
    );
  });

  it('q_keywords del slice inicial contiene e-learning', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(
      params.q_keywords?.includes('e-learning'),
      `q_keywords debe incluir "e-learning", got: "${params.q_keywords}"`,
    );
  });

  it('q_keywords del slice inicial contiene online learning', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(
      params.q_keywords?.includes('online learning'),
      `q_keywords debe incluir "online learning", got: "${params.q_keywords}"`,
    );
  });

  it('"education" genérico NO está en el q_keywords enviado (queda fuera del slice inicial)', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    const kws = params.q_keywords ?? '';
    // "education" sola no debe aparecer; los términos enviados son los 5 primeros del array reordenado
    const words = kws.split(' ');
    assert.ok(
      !words.includes('education'),
      `"education" genérico no debe estar en q_keywords enviado, got: "${kws}"`,
    );
  });

  it('array completo de keywords de Educación tiene >5 elementos (education queda en posición 11)', () => {
    const kws = getSectorKeywords('Educación');
    assert.ok(kws.length > 5, `debe haber >5 keywords en Educación, got: ${kws.length}`);
    const educationIdx = kws.indexOf('education');
    assert.ok(educationIdx >= 5, `"education" debe estar en posición ≥5, got: ${educationIdx}`);
  });

  it('Colombia sigue como filtro estructurado, no dentro de q_keywords', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(
      params.organization_locations?.includes('Colombia'),
      'organization_locations debe contener Colombia',
    );
    const kws = params.q_keywords ?? '';
    assert.ok(
      !kws.toLowerCase().includes('colombia'),
      `q_keywords no debe contener "colombia", got: "${kws}"`,
    );
  });
});

// ─── B. No se usa q_organization_name con frases largas ───────────────────────

describe('B. q_organization_name ausente — sin frases largas', () => {
  it('q_organization_name no está definido para Educación Colombia', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(
      params.q_organization_name,
      undefined,
      'q_organization_name debe estar ausente',
    );
  });

  it('Colombia no aparece dentro de q_keywords como sustituto de location', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(
      !(params.q_keywords ?? '').toLowerCase().includes('colombia'),
      'Colombia no debe estar en q_keywords',
    );
  });

  it('la frase web larga del wizard no se reenvía como q_organization_name', () => {
    const input = makeInput({ query: 'sector educativo Colombia servicios corporativo' });
    const { params } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(params.q_organization_name, undefined);
  });
});

// ─── C. Metadata v1.16K-AB ───────────────────────────────────────────────────

describe('C. Metadata v1.16K-AB', () => {
  it('mapping_version es v1.16K-AB', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.mapping_version, 'v1.16K-AB');
    assert.equal(APOLLO_QUERY_MAPPING_VERSION, 'v1.16K-AB');
  });

  it('relevance_strategy es "sector_specific_keywords" cuando hay sector mapeado', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.relevance_strategy, 'sector_specific_keywords');
  });

  it('relevance_strategy es "query_fallback" cuando no hay sector', () => {
    const input = makeInput({ industry: null, query: 'empresas de agua' });
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(meta.relevance_strategy, 'query_fallback');
  });

  it('generic_keywords_deprioritized es true para Educación (>5 keywords, específicas primero)', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.generic_keywords_deprioritized, true);
  });

  it('generic_keywords_deprioritized es false cuando no hay sector mapeado', () => {
    const input = makeInput({ industry: null });
    const { meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.equal(meta.generic_keywords_deprioritized, false);
  });

  it('apollo_location_sent es ["Colombia"] / "Colombia"', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.apollo_location_sent, 'Colombia');
  });

  it('sector_keywords_used incluye los términos específicos en orden correcto', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.sector_keywords_used[0], 'learning management system');
    assert.equal(meta.sector_keywords_used[1], 'lms');
    assert.equal(meta.sector_keywords_used[2], 'corporate training');
  });
});

// ─── D. Fallback seguro para sectores no mapeados ────────────────────────────

describe('D. Fallback seguro — sectores no mapeados', () => {
  it('sector desconocido → usa sector como fallback keyword, sin romper', () => {
    const input = makeInput({ industry: 'AgriculturaExótica' });
    const { params, meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.ok(params.q_keywords, 'q_keywords debe estar presente');
    assert.equal(meta.relevance_strategy, 'sector_specific_keywords');
    assert.equal(meta.generic_keywords_deprioritized, false);
  });

  it('sector null → usa query como fallback, sin romper', () => {
    const input = makeInput({ industry: null, query: 'fintech startups colombia' });
    const { params, meta } = buildApolloOrganizationsSearchParams(input, 5);
    assert.ok(params.q_keywords?.includes('fintech'));
    assert.equal(meta.relevance_strategy, 'query_fallback');
  });

  it('Tecnología → keywords con technology y software (no afectado por cambios de Educación)', () => {
    const kws = getSectorKeywords('Tecnología');
    assert.ok(kws.includes('technology'), 'debe incluir technology');
    assert.ok(kws.includes('software'), 'debe incluir software');
  });

  it('Finanzas → keywords con financial services y fintech', () => {
    const kws = getSectorKeywords('Finanzas');
    assert.ok(kws.includes('financial services'));
    assert.ok(kws.includes('fintech'));
  });

  it('Salud → keywords con healthcare y health', () => {
    const kws = getSectorKeywords('Salud');
    assert.ok(kws.includes('healthcare'));
    assert.ok(kws.includes('health'));
  });
});

// ─── E. Sin secretos en metadata ─────────────────────────────────────────────

describe('E. Sin secretos en metadata', () => {
  const FORBIDDEN = ['api_key', 'x-api-key', 'authorization', 'bearer', 'token', 'secret'];

  it('metadata de Educación Colombia no contiene términos de secretos', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    const metaStr = JSON.stringify(meta).toLowerCase();
    for (const term of FORBIDDEN) {
      assert.ok(!metaStr.includes(term), `meta no debe incluir "${term}"`);
    }
  });

  it('q_organization_name_sent siempre es null', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.q_organization_name_sent, null);
  });
});

// ─── F. Cap de queries Apollo vigente ────────────────────────────────────────

describe('F. Cap MAX_APOLLO_ORGANIZATIONS_QUERIES_PER_RUN = 3', () => {
  it('buildApolloOrganizationsSearchParams genera un payload por invocación (cap es responsabilidad del caller)', () => {
    // La función de mapping es pura: genera 1 payload por llamada.
    // El cap de 3 queries es aplicado en web-search-tool.ts antes de invocarla.
    const r1 = buildApolloOrganizationsSearchParams(makeInput(), 5);
    const r2 = buildApolloOrganizationsSearchParams(makeInput(), 5);
    const r3 = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(r1.params.q_keywords);
    assert.ok(r2.params.q_keywords);
    assert.ok(r3.params.q_keywords);
    // La función pura devuelve el mismo resultado para el mismo input
    assert.deepEqual(r1.params, r2.params);
    assert.deepEqual(r1.params, r3.params);
  });

  it('per_page es capado por el caller — mapping respeta el valor recibido', () => {
    // MAX_APOLLO_ORGANIZATIONS_PER_RUN = 10 en el provider; aquí probamos que el mapping
    // no supera el cappedMaxResults que recibe
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.equal(params.per_page, 10);
    const { params: p2 } = buildApolloOrganizationsSearchParams(makeInput(), 3);
    assert.equal(p2.per_page, 3);
  });
});

// ─── G. Regression Tavily ────────────────────────────────────────────────────

describe('G. Regression — mapping Apollo no afecta Tavily', () => {
  it('buildApolloOrganizationsSearchParams es función pura sin side effects globales', () => {
    // Si el mapping tuviese side effects globales afectaría a Tavily.
    // Verificamos idempotencia como proxy de pureza.
    const input = makeInput();
    const a = buildApolloOrganizationsSearchParams(input, 5);
    const b = buildApolloOrganizationsSearchParams(input, 5);
    assert.deepEqual(a.params, b.params);
    assert.deepEqual(a.meta, b.meta);
  });

  it('getSectorKeywords no modifica el input ni tiene estado global', () => {
    const kws1 = getSectorKeywords('Educación');
    const kws2 = getSectorKeywords('Educación');
    assert.deepEqual(kws1, kws2);
  });

  it('mapping_version exportada no es vacía (constante estable)', () => {
    assert.equal(typeof APOLLO_QUERY_MAPPING_VERSION, 'string');
    assert.ok(APOLLO_QUERY_MAPPING_VERSION.length > 0);
  });
});
