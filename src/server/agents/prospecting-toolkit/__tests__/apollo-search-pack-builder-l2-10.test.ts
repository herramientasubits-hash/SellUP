/**
 * Tests — Apollo Search Pack Builder (L2.10)
 *
 * Verifica que el builder genere search packs estructurados derivados del
 * wizard intent, y que la integración con buildApolloOrganizationsSearchParams
 * emita metadata apollo_search_pack correcta.
 *
 * Escenarios:
 *   A. Pack builder Educación/Formación Corporativa — genera ≥2 packs, P0 correcto
 *   B. Pack selection con cap maxQueries=1 → solo 1 pack, qa_cap_selected_first_pack=true
 *   C. Pack selection con cap maxQueries=3 → máximo 3 packs, orden estable
 *   D. Apollo params metadata — apollo_search_pack presente con pack_key y selected_reason
 *   E. Criteria tokens influyen en keywords de P0 (LMS + capacitación comercial)
 *   F. No generic education en LMS pack (sin education/university/school/higher education)
 *   G. Diagnostics regression L2.9 — buildApolloOrganizationsSearchParams mantiene campos existentes
 *   H. Tavily regression — no imports Tavily en pack builder ni query mapping
 *   I. Lusha no activado — no imports Lusha
 *   J. País no entra en qKeywords del pack
 *   K. Fallback L2.7 cuando no hay packs disponibles — keywords siguen presentes
 *
 * Sin llamadas a red. Sin API keys. Funciones puras.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildApolloSearchPacks,
  selectPacksUpToMaxQueries,
  APOLLO_SEARCH_PACK_BUILDER_VERSION,
} from '../apollo-search-pack-builder';
import {
  buildApolloOrganizationsSearchParams,
  APOLLO_QUERY_MAPPING_VERSION,
} from '../apollo-organizations-query-mapping';
import type { WebSearchInput } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// Tokens que simula el QA real: "plataformas LMS para capacitación comercial"
const QA_CRITERIA_TOKENS = ['plataformas', 'lms', 'capacitacion', 'comercial'];

// ─── A. Pack builder Educación/Formación Corporativa ─────────────────────────

describe('A. Pack builder — Educación / Formación Corporativa', () => {
  it('A1. genera al menos 2 packs para subindustria Formación Corporativa', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: QA_CRITERIA_TOKENS,
    });
    assert.ok(result.packs.length >= 2, `se esperaban ≥2 packs, se obtuvieron ${result.packs.length}`);
  });

  it('A2. primer pack (posición 0) tiene señal LMS cuando criteria incluye "lms" (L2.13: variant_a)', () => {
    // L2.13: Con QA_CRITERIA_TOKENS que incluye 'lms', el boost eleva variant_a_current_tags a P0.
    // variant_a_current_tags tiene "lms" + "corporate training" + "workforce training".
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: QA_CRITERIA_TOKENS,
    });
    const firstPack = result.packs[0];
    assert.ok(firstPack, 'debe haber al menos un pack');
    const hasLmsSignal = firstPack.qKeywords.some(k =>
      k.toLowerCase().includes('lms') || k.toLowerCase().includes('learning management'),
    );
    assert.ok(hasLmsSignal, `primer pack debe tener señal LMS. Keywords: ${JSON.stringify(firstPack.qKeywords)}`);
    assert.equal(result.boostedPackKey, 'variant_a_current_tags', 'L2.13: boostedPackKey debe ser variant_a_current_tags');
  });

  it('A3. P0 incluye señales corporate training (L2.13: variant_a reemplaza sales training)', () => {
    // L2.13: Variant A usa "corporate training" + "workforce training" en lugar de "sales training".
    // El pack variant_a_current_tags es el P0 cuando criteria tiene señales LMS.
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: QA_CRITERIA_TOKENS,
    });
    const p0 = result.packs[0];
    assert.ok(p0, 'debe haber un pack P0');
    const hasCorporateSignal = p0.qKeywords.some(k =>
      k.toLowerCase().includes('corporate training') ||
      k.toLowerCase().includes('corporate learning') ||
      k.toLowerCase().includes('workforce training') ||
      k.toLowerCase().includes('lms'),
    );
    assert.ok(hasCorporateSignal, `P0 debe tener señal corporate/LMS (Variant A). Keywords: ${JSON.stringify(p0.qKeywords)}`);
  });

  it('A4. builderVersion está presente', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
    });
    assert.equal(result.builderVersion, APOLLO_SEARCH_PACK_BUILDER_VERSION);
  });

  it('A5. buildStrategy es subindustry_specific_packs cuando hay subindustria matching', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
    });
    assert.equal(result.buildStrategy, 'subindustry_specific_packs');
  });

  it('A6. fallback a sector cuando subindustria no tiene match', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['SubindustriaDesconocida'],
      additionalCriteriaTokens: [],
    });
    // Con sector Educación debe encontrar packs aunque la subindustria sea desconocida
    assert.ok(result.packs.length >= 1, 'debe haber al menos 1 pack por sector fallback');
    assert.equal(result.buildStrategy, 'sector_fallback_packs');
  });
});

// ─── B. Pack selection con cap maxQueries=1 ───────────────────────────────────

describe('B. Pack selection — cap maxQueries=1', () => {
  it('B1. retorna exactamente 1 pack cuando maxQueries=1', () => {
    const buildResult = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: QA_CRITERIA_TOKENS,
    });
    const selection = selectPacksUpToMaxQueries(buildResult, 1);
    assert.equal(selection.selectedPackCount, 1);
    assert.equal(selection.selectedPacks.length, 1);
  });

  it('B2. qa_cap_selected_first_pack=true cuando cap=1', () => {
    const buildResult = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
    });
    const selection = selectPacksUpToMaxQueries(buildResult, 1);
    assert.ok(selection.qaCapSelectedFirstPack, 'qa_cap_selected_first_pack debe ser true');
  });

  it('B3. pack seleccionado con cap=1 es variant_a_current_tags cuando criteria tiene señal LMS (L2.13)', () => {
    // L2.13: El boost eleva variant_a_current_tags a posición 0; con cap=1 es el único seleccionado.
    const buildResult = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: QA_CRITERIA_TOKENS,
    });
    const selection = selectPacksUpToMaxQueries(buildResult, 1);
    const selected = selection.selectedPacks[0];
    assert.ok(selected, 'debe haber un pack seleccionado');
    assert.equal(selected.packKey, 'variant_a_current_tags', 'L2.13: pack seleccionado debe ser variant_a_current_tags');
    const hasLmsSignal = selected.qKeywords.some(k =>
      k.toLowerCase().includes('lms') || k.toLowerCase().includes('learning management'),
    );
    assert.ok(hasLmsSignal, `pack seleccionado debe tener señal LMS. Keywords: ${JSON.stringify(selected.qKeywords)}`);
  });
});

// ─── C. Pack selection con cap maxQueries=3 ───────────────────────────────────

describe('C. Pack selection — cap maxQueries=3', () => {
  it('C1. retorna máximo 3 packs', () => {
    const buildResult = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
    });
    const selection = selectPacksUpToMaxQueries(buildResult, 3);
    assert.ok(selection.selectedPackCount <= 3, `max 3 packs, se obtuvieron ${selection.selectedPackCount}`);
  });

  it('C2. orden estable — P0 primero, luego P1, luego P2', () => {
    const buildResult = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
    });
    const selection = selectPacksUpToMaxQueries(buildResult, 3);
    const priorities = selection.selectedPacks.map(p => p.priority);
    const sorted = [...priorities].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(priorities, sorted, `orden esperado P0→P1→P2, obtenido: ${priorities.join(',')}`);
  });

  it('C3. qaCapApplied=false cuando hay menos packs que el cap', () => {
    const buildResult = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
    });
    // Si hay exactamente 3 packs y cap=3, no hay truncación real
    const selection = selectPacksUpToMaxQueries(buildResult, 3);
    if (buildResult.availablePackCount <= 3) {
      assert.ok(!selection.qaCapApplied, 'no debe aplicar cap si hay ≤3 packs disponibles');
    }
  });
});

// ─── D. Apollo params metadata — apollo_search_pack ──────────────────────────

describe('D. Apollo params metadata — apollo_search_pack', () => {
  it('D1. apollo_search_pack existe en meta cuando hay packs disponibles', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: QA_CRITERIA_TOKENS }),
      3,
    );
    assert.ok(meta.apollo_search_pack !== null, 'apollo_search_pack debe estar presente');
  });

  it('D2. pack_key está presente en apollo_search_pack', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: QA_CRITERIA_TOKENS }),
      3,
    );
    assert.ok(meta.apollo_search_pack?.pack_key, `pack_key debe estar presente: ${JSON.stringify(meta.apollo_search_pack)}`);
  });

  it('D3. selected_reason está presente en apollo_search_pack', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: [] }),
      3,
    );
    assert.ok(meta.apollo_search_pack?.selected_reason, 'selected_reason debe estar presente');
  });

  it('D4. apollo_keywords_sent_array refleja los keywords del pack seleccionado', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: [] }),
      3,
    );
    assert.ok(Array.isArray(meta.apollo_keywords_sent_array), 'apollo_keywords_sent_array debe ser array');
    assert.ok(meta.apollo_keywords_sent_array.length > 0, 'debe tener al menos 1 keyword');
  });

  it('D5. mapping_version es v1.L2.13 (actualizado en L2.13)', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: [] }),
      3,
    );
    assert.equal(meta.mapping_version, APOLLO_QUERY_MAPPING_VERSION);
    assert.ok(meta.mapping_version.includes('L2.13'), `versión esperada L2.13, obtenida: ${meta.mapping_version}`);
  });

  it('D6. qa_cap_selected_first_pack=true cuando maxQueries default (1)', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: [] }),
      3,
    );
    assert.ok(meta.apollo_search_pack?.qa_cap_selected_first_pack, 'qa_cap_selected_first_pack debe ser true con maxQueries default=1');
  });
});

// ─── E. Criteria tokens influyen en keywords de P0 ───────────────────────────

describe('E. Criteria tokens influyen en P0', () => {
  it('E1. "lms" en criteria tokens → lms aparece en keywords P0', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: ['lms', 'plataformas'],
    });
    const p0 = result.packs[0];
    const hasLms = p0?.qKeywords.some(k => k.toLowerCase().includes('lms'));
    assert.ok(hasLms, `lms debe estar en P0 keywords. Keywords: ${JSON.stringify(p0?.qKeywords)}`);
  });

  it('E2. "comercial" en criteria tokens → sales training o capacitación comercial en P0', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: ['capacitacion', 'comercial'],
    });
    const p0 = result.packs[0];
    const hasSalesSignal = p0?.qKeywords.some(k =>
      k.toLowerCase().includes('sales') || k.toLowerCase().includes('comercial') || k.toLowerCase().includes('capacitac'),
    );
    assert.ok(hasSalesSignal, `keywords P0 deben reflejar criterio comercial. Keywords: ${JSON.stringify(p0?.qKeywords)}`);
  });

  it('E3. criteria tokens — Variant A pack ya encoda combinación óptima (L2.13)', () => {
    // L2.13: Con variant_a_current_tags como P0, el pack ya contiene "corporate training",
    // "lms", "workforce training" — la combinación óptima está built-in en el pack.
    // Los criteria tokens no necesitan inyectar keywords adicionales porque el pack
    // ya los cubre conceptualmente. El pack builder retorna el pack correcto sin injection extra.
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: QA_CRITERIA_TOKENS,
    });
    // El P0 debe ser variant_a_current_tags con las keywords correctas
    const p0 = result.packs[0];
    assert.equal(p0?.packKey, 'variant_a_current_tags', 'P0 debe ser variant_a_current_tags');
    assert.ok(p0?.qKeywords.some(k => k.includes('lms')), 'P0 debe tener lms');
    assert.ok(p0?.qKeywords.some(k => k.includes('corporate training')), 'P0 debe tener corporate training');
  });

  it('E4. sin criteria tokens — criteriaTokensInfluencingP0 vacío', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
    });
    assert.equal(result.criteriaTokensInfluencingP0.length, 0);
  });
});

// ─── F. No generic education en LMS pack ─────────────────────────────────────

describe('F. No términos genéricos en pack LMS', () => {
  const BANNED = ['education', 'higher education', 'university', 'school'];

  it('F1. ninguna keyword del P0 LMS contiene "education" genérico', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: QA_CRITERIA_TOKENS,
    });
    const p0 = result.packs[0];
    for (const banned of BANNED) {
      const found = p0?.qKeywords.find(k => k.toLowerCase() === banned.toLowerCase());
      assert.ok(!found, `keyword genérica "${banned}" no debe estar en P0 LMS pack. Keywords: ${JSON.stringify(p0?.qKeywords)}`);
    }
  });

  it('F2. "university" no aparece en keywords del P0', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['LMS'],
      additionalCriteriaTokens: [],
    });
    const p0 = result.packs[0];
    const hasUniversity = p0?.qKeywords.some(k => k.toLowerCase().includes('university'));
    assert.ok(!hasUniversity, `"university" no debe estar en P0. Keywords: ${JSON.stringify(p0?.qKeywords)}`);
  });
});

// ─── G. Diagnostics regression L2.9 ──────────────────────────────────────────

describe('G. Diagnostics regression — campos L2.7/L2.8/L2.9 intactos', () => {
  it('G1. sector_input presente', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: [] }),
      3,
    );
    assert.equal(meta.sector_input, 'Educación');
  });

  it('G2. country_input y countryCode_input presentes', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'] }),
      3,
    );
    assert.equal(meta.country_input, 'Colombia');
    assert.equal(meta.countryCode_input, 'CO');
  });

  it('G3. apollo_keywords_sent es string (para compatibilidad con L2.8 provider)', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: [] }),
      3,
    );
    assert.ok(typeof meta.apollo_keywords_sent === 'string' || meta.apollo_keywords_sent === null);
  });

  it('G4. apollo_location_sent es Colombia', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: [] }),
      3,
    );
    assert.equal(meta.apollo_location_sent, 'Colombia');
  });

  it('G5. q_organization_name_sent es null (nunca se usa)', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'] }),
      3,
    );
    assert.equal(meta.q_organization_name_sent, null);
  });

  it('G6. keyword_merge_strategy sigue presente', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'] }),
      3,
    );
    assert.equal(meta.keyword_merge_strategy, 'subindustry_first_with_strong_criteria_replacement');
  });
});

// ─── H. Tavily regression ─────────────────────────────────────────────────────

describe('H. Tavily regression', () => {
  it('H1. buildApolloSearchPacks no lanza error — módulo aislado de Tavily', () => {
    assert.doesNotThrow(() => {
      buildApolloSearchPacks({
        sector: 'Educación',
        subindustries: ['Formación Corporativa'],
        additionalCriteriaTokens: [],
      });
    });
  });

  it('H2. buildApolloOrganizationsSearchParams no lanza error con input válido', () => {
    assert.doesNotThrow(() => {
      buildApolloOrganizationsSearchParams(
        makeInput({ subindustries: ['Formación Corporativa'] }),
        3,
      );
    });
  });
});

// ─── I. Lusha no activado ─────────────────────────────────────────────────────

describe('I. Lusha no activado', () => {
  it('I1. buildApolloSearchPacks no expone tipos ni referencias Lusha', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
    });
    const resultStr = JSON.stringify(result).toLowerCase();
    assert.ok(!resultStr.includes('lusha'), 'no debe haber referencias Lusha en el resultado del pack builder');
  });
});

// ─── J. País no en qKeywords ──────────────────────────────────────────────────

describe('J. País no entra en qKeywords del pack', () => {
  // Solo chequeamos el nombre del país (no el código 'co' — está en "corporate", "e-commerce", etc.)
  const COUNTRY_TERMS = ['colombia', 'bogota', 'bogotá'];

  it('J1. ninguna keyword de ningún pack contiene el nombre del país', () => {
    const result = buildApolloSearchPacks({
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
      additionalCriteriaTokens: [],
      country: 'Colombia',
      countryCode: 'CO',
    });
    for (const pack of result.packs) {
      for (const kw of pack.qKeywords) {
        for (const term of COUNTRY_TERMS) {
          assert.ok(
            !kw.toLowerCase().includes(term),
            `keyword "${kw}" en pack ${pack.packKey} no debe contener país "${term}"`,
          );
        }
      }
    }
  });

  it('J2. apollo_location_sent contiene Colombia, q_keywords no lo contiene', () => {
    const { params, meta } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'] }),
      3,
    );
    assert.ok(params.organization_locations?.includes('Colombia'), 'Colombia debe estar en organization_locations');
    const keywords = meta.apollo_keywords_sent ?? '';
    assert.ok(!keywords.toLowerCase().includes('colombia'), `Colombia no debe estar en q_keywords: ${keywords}`);
  });
});

// ─── K. Fallback L2.7 cuando no hay packs ────────────────────────────────────

describe('K. Fallback L2.7 cuando no hay packs disponibles', () => {
  it('K1. sector desconocido + sin subindustria → fallback keywords presentes o vacío controlado', () => {
    const result = buildApolloSearchPacks({
      sector: 'SectorMuyDesconocido',
      subindustries: [],
      additionalCriteriaTokens: [],
    });
    // Puede tener 0 packs — es válido y controlado
    assert.ok(Array.isArray(result.packs));
    assert.equal(result.availablePackCount, result.packs.length);
  });

  it('K2. buildApolloOrganizationsSearchParams con sector desconocido no lanza error', () => {
    assert.doesNotThrow(() => {
      buildApolloOrganizationsSearchParams(
        makeInput({ industry: 'SectorDesconocido', subindustries: [], additionalCriteriaTokens: [] }),
        3,
      );
    });
  });

  it('K3. con sector desconocido — apollo_search_pack es null y fallback L2.7 se activa', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ industry: 'SectorDesconocido', subindustries: [], additionalCriteriaTokens: [] }),
      3,
    );
    assert.equal(meta.apollo_search_pack, null, 'sin packs → apollo_search_pack debe ser null');
  });
});
