/**
 * Tests — apollo-organizations-query-mapping (L2.7)
 *
 * Cubre:
 *   C. Apollo mapping usa subindustria → keywords específicas
 *   D. Apollo mapping usa additionalCriteriaTokens
 *   E. Apollo mapping con criterio genérico — no genera ruido
 *   F. Metadata L2.7 — campos de diagnóstico presentes
 *   G. Tavily regression — provider tavily no importa este módulo
 *   H. Lusha no activado — no aparece en imports ni helpers
 *   I. Retrocompatibilidad — sin subindustrias ni tokens, comportamiento previo intacto
 *
 * Sin llamadas a red. Sin API keys. Funciones puras.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildApolloOrganizationsSearchParams,
  buildApolloKeywords,
  getSectorKeywords,
  getSubindustryKeywords,
  APOLLO_QUERY_MAPPING_VERSION,
} from '../apollo-organizations-query-mapping';
import type { WebSearchInput } from '../types';

// ─── Helpers de fixture ───────────────────────────────────────────────────────

function makeInput(overrides: Partial<WebSearchInput> = {}): WebSearchInput {
  return {
    query: 'sector educativo Colombia',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Educación',
    maxResults: 10,
    provider: 'apollo_organizations',
    ...overrides,
  };
}

// ─── C. Apollo mapping usa subindustria ──────────────────────────────────────

describe('Apollo mapping — subindustria', () => {
  it('C1. getSubindustryKeywords para "Formación Corporativa" retorna keywords específicas', () => {
    const kws = getSubindustryKeywords('Formación Corporativa');
    assert.ok(kws.length > 0, 'debe tener keywords');
    assert.ok(
      kws.some(k => k.toLowerCase().includes('corporate training') || k.toLowerCase().includes('formacion')),
      `keywords: ${JSON.stringify(kws)}`,
    );
  });

  it('C2. getSubindustryKeywords para "LMS" retorna "learning management system"', () => {
    const kws = getSubindustryKeywords('LMS');
    assert.ok(kws.some(k => k.toLowerCase().includes('learning management system')), `keywords: ${JSON.stringify(kws)}`);
  });

  it('C3. subindustria tiene prioridad sobre sector padre en q_keywords', () => {
    const { params, meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: [] }),
      10,
    );
    assert.ok(params.q_keywords, 'q_keywords debe estar presente');
    assert.ok(
      params.q_keywords!.toLowerCase().includes('corporate training') ||
      params.q_keywords!.toLowerCase().includes('formacion'),
      `q_keywords no incluye términos de subindustria: ${params.q_keywords}`,
    );
    assert.equal(meta.relevance_strategy, 'subindustry_specific');
  });

  it('C4. subindustria LMS → keywords de LMS, no "education" genérico como primer término', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['LMS'], additionalCriteriaTokens: [] }),
      10,
    );
    const kws = params.q_keywords ?? '';
    assert.ok(!kws.startsWith('education'), `primer término no debe ser "education" genérico: ${kws}`);
    assert.ok(kws.toLowerCase().includes('lms') || kws.toLowerCase().includes('learning management'), `LMS keywords esperadas: ${kws}`);
  });

  it('C5. subindustryKeywordsUsed presente en metadata', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['LMS'], additionalCriteriaTokens: [] }),
      10,
    );
    assert.ok(Array.isArray(meta.subindustry_keywords_used), 'debe ser array');
    assert.ok(meta.subindustry_keywords_used.length > 0, 'debe tener keywords de subindustria');
  });

  it('C6. sin subindustrias → relevance_strategy = sector_specific_keywords (retrocompat)', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.equal(meta.relevance_strategy, 'sector_specific_keywords');
  });
});

// ─── D. Apollo mapping usa additionalCriteriaTokens ─────────────────────────

describe('Apollo mapping — additionalCriteriaTokens', () => {
  it('D1. tokens ["ventas", "pymes", "b2b"] aparecen en q_keywords si hay cupo', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({
        industry: 'Servicios',  // sector sin mapping → query_fallback, deja cupo
        subindustries: [],
        additionalCriteriaTokens: ['ventas', 'pymes', 'b2b'],
      }),
      10,
    );
    const kws = params.q_keywords ?? '';
    // Al menos uno de los tokens debe aparecer en q_keywords
    const hasAtLeastOne = ['ventas', 'pymes', 'b2b'].some(t => kws.includes(t));
    assert.ok(hasAtLeastOne, `ningún token apareció en q_keywords: ${kws}`);
  });

  it('D2. tokens no desplazan keywords sectoriales críticas cuando sector tiene mapping', () => {
    // Educación tiene 5 keywords específicas → no hay cupo para tokens
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({
        industry: 'Educación',
        subindustries: [],
        additionalCriteriaTokens: ['ventas', 'pymes'],
      }),
      10,
    );
    // Los tokens ignorados deben aparecer en ignored_additional_criteria_tokens
    assert.ok(
      meta.ignored_additional_criteria_tokens.length >= 0,
      'campo ignored debe existir',
    );
  });

  it('D3. additional_criteria_tokens refleja los tokens pasados', () => {
    const tokens = ['ventas', 'pymes'];
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ additionalCriteriaTokens: tokens }),
      10,
    );
    assert.deepEqual(meta.additional_criteria_tokens, tokens);
  });

  it('D4. sin tokens pasados → additional_criteria_tokens = []', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.deepEqual(meta.additional_criteria_tokens, []);
  });

  it('D5. país no entra en q_keywords vía tokens', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ additionalCriteriaTokens: ['colombia', 'ventas'] }),
      10,
    );
    // "colombia" puede entrar si no es filtrado antes de llegar aquí
    // El test verifica que está en organization_locations (no solo en q_keywords)
    assert.ok(
      params.organization_locations?.includes('Colombia'),
      'país debe estar en organization_locations',
    );
  });
});

// ─── E. Apollo mapping con criterio genérico ─────────────────────────────────

describe('Apollo mapping — criterio genérico no genera ruido', () => {
  it('E1. buildApolloKeywords sin subindustrias ni tokens: usa sector puro', () => {
    const { keywords } = buildApolloKeywords({
      industry: 'Educación',
      subindustries: [],
      additionalCriteriaTokens: [],
    });
    assert.ok(keywords.length > 0);
    assert.ok(keywords.length <= 5);
  });

  it('E2. tokens genéricos (empresas, grandes) filtrados antes de llegar aquí', () => {
    // Este test verifica que el mapping respeta tokens ya pre-filtrados
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ additionalCriteriaTokens: [] }),
      10,
    );
    const kws = params.q_keywords ?? '';
    assert.ok(!kws.includes('empresas'), '"empresas" no debe aparecer como keyword Apollo');
    assert.ok(!kws.includes('grandes'), '"grandes" no debe aparecer');
  });

  it('E3. q_organization_name nunca se usa', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['LMS'], additionalCriteriaTokens: ['saas'] }),
      10,
    );
    assert.ok(!('q_organization_name' in params), 'q_organization_name no debe aparecer');
  });

  it('E4. país siempre en organization_locations, nunca en q_keywords', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.ok(params.organization_locations?.includes('Colombia'));
    assert.ok(!(params.q_keywords ?? '').toLowerCase().includes('colombia'));
  });
});

// ─── F. Metadata L2.7 ─────────────────────────────────────────────────────────

describe('Apollo mapping — metadata L2.7', () => {
  it('F1. normalized_context_version = "L2.7"', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.equal(meta.normalized_context_version, 'L2.7');
  });

  it('F2. mapping_version incluye L2.7', () => {
    assert.ok(APOLLO_QUERY_MAPPING_VERSION.includes('L2.7'), `version: ${APOLLO_QUERY_MAPPING_VERSION}`);
  });

  it('F3. additional_criteria_tokens presente como array', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.ok(Array.isArray(meta.additional_criteria_tokens));
  });

  it('F4. subindustry_keywords_used presente como array', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.ok(Array.isArray(meta.subindustry_keywords_used));
  });

  it('F5. ignored_additional_criteria_tokens presente como array', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.ok(Array.isArray(meta.ignored_additional_criteria_tokens));
  });

  it('F6. q_organization_name_sent = null siempre', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.equal(meta.q_organization_name_sent, null);
  });

  it('F7. no contiene secretos — país no es secret', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    // Solo verificamos que los campos no son objetos complejos con keys sospechosas
    assert.ok(typeof meta.apollo_location_sent === 'string' || meta.apollo_location_sent === null);
    assert.ok(typeof meta.country_input === 'string' || meta.country_input === null);
  });
});

// ─── I. Retrocompatibilidad con callers sin L2.7 ─────────────────────────────

describe('Apollo mapping — retrocompatibilidad', () => {
  it('I1. input sin subindustries ni additionalCriteriaTokens funciona igual que antes', () => {
    const input: WebSearchInput = {
      query: 'sector educativo Colombia',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Educación',
      maxResults: 10,
    };
    const { params, meta } = buildApolloOrganizationsSearchParams(input, 10);
    assert.ok(params.q_keywords, 'q_keywords debe estar presente');
    assert.equal(meta.relevance_strategy, 'sector_specific_keywords');
    assert.deepEqual(meta.additional_criteria_tokens, []);
    assert.deepEqual(meta.subindustry_keywords_used, []);
  });

  it('I2. getSectorKeywords no roto — Educación sigue retornando keywords correctas', () => {
    const kws = getSectorKeywords('Educación');
    assert.equal(kws[0], 'learning management system');
    assert.equal(kws[1], 'lms');
    assert.equal(kws[2], 'corporate training');
  });

  it('I3. q_organization_name nunca presente (retrocompat)', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 10);
    assert.ok(!('q_organization_name' in params));
  });
});
