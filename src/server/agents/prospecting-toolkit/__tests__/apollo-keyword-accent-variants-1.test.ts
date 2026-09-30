/**
 * AGENT1-APOLLO-KEYWORD-ACCENT-VARIANTS-1 — cada etiqueta en español viaja
 * también con su tilde.
 *
 * Apollo Support (2026-09-29): `q_organization_keyword_tags[]` es un OR, pero no
 * documenta si ignora tildes; recomendó enviar las dos formas (`clinica` y
 * `clínica`). El catálogo macro guarda los términos sin tilde, así que hasta
 * ahora sólo viajaba una.
 *
 *   § 1 · la variante se construye palabra por palabra, sin adivinar;
 *   § 2 · el diccionario cubre el catálogo;
 *   § 3 · el plan añade las variantes al final, dentro del tope de 25, sin
 *         tocar cobertura ni cuota de amplios;
 *   § 4 · el contrato de la petición NO colapsa la variante con el original.
 *
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import {
  SPANISH_ACCENT_RESTORATIONS,
  apolloKeywordAccentVariant,
} from '../apollo-keyword-accent-variants';
import { buildMacroIndustryQueryPlan } from '../apollo-macro-industry-query-terms';
import { buildApolloOrganizationsRequestContract } from '../apollo-organizations-request-contract';

const APOLLO_FILTER_VALUES_MAX = 25;

// ─── § 1 ──────────────────────────────────────────────────────────────────────

describe('§ 1 — la variante, palabra por palabra', () => {
  it('una palabra', () => assert.equal(apolloKeywordAccentVariant('clinica'), 'clínica'));
  it('una frase: sólo cambian las palabras conocidas', () =>
    assert.equal(apolloKeywordAccentVariant('laboratorio clinico'), 'laboratorio clínico'));
  it('varias palabras con tilde en el mismo término', () =>
    assert.equal(
      apolloKeywordAccentVariant('exploracion y produccion de petroleo'),
      'exploración y producción de petróleo',
    ));
  it('sin palabras que la necesiten ⇒ null (no hay variante)', () => {
    assert.equal(apolloKeywordAccentVariant('hospital'), null);
    assert.equal(apolloKeywordAccentVariant('medical devices'), null);
  });
  it('el diccionario no inventa: todas sus salidas llevan tilde o eñe', () => {
    for (const [plain, accented] of Object.entries(SPANISH_ACCENT_RESTORATIONS)) {
      assert.notEqual(plain, accented);
      assert.equal(accented.normalize('NFD').replace(/\p{M}/gu, ''), plain.normalize('NFD').replace(/\p{M}/gu, ''));
    }
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

describe('§ 2 — el diccionario cubre el catálogo', () => {
  it('toda palabra del catálogo terminada en -cion/-sion (siempre con tilde) tiene su forma', () => {
    const missing = new Set<string>();
    for (const d of MACRO_INDUSTRIES) {
      for (const term of [...d.discovery.specific, ...d.discovery.broad]) {
        for (const word of term.split(/\s+/)) {
          if (/(cion|sion)$/.test(word) && SPANISH_ACCENT_RESTORATIONS[word] === undefined) missing.add(word);
        }
      }
    }
    assert.deepEqual([...missing], []);
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

describe('§ 3 — el plan añade las variantes al final', () => {
  for (const definition of MACRO_INDUSTRIES) {
    it(`${definition.key}: originales intactos y en orden, variantes después, ≤ ${APOLLO_FILTER_VALUES_MAX}`, () => {
      const plan = buildMacroIndustryQueryPlan({ definition, variantKey: null });
      const originals = plan.effectiveKeywords.slice(0, plan.effectiveKeywords.length - plan.accentVariantsAdded.length);
      assert.deepEqual(plan.effectiveKeywords.slice(originals.length), plan.accentVariantsAdded);
      assert.ok(plan.effectiveKeywords.length <= APOLLO_FILTER_VALUES_MAX);
      for (const v of plan.accentVariantsAdded) {
        assert.ok(originals.some((o) => apolloKeywordAccentVariant(o) === v), `${v} sin original`);
      }
      // La cuota de amplios se mide sobre los originales.
      const expectedShare = originals.length === 0 ? 0 : plan.admittedBroadTerms.length / originals.length;
      assert.equal(plan.coverage.broadTermShare, expectedShare);
    });
  }

  it('🔴 Salud: la búsqueda de Perú lleva `clinica` Y `clínica`', () => {
    const health = MACRO_INDUSTRIES.find((d) => d.key === 'health_pharma')!;
    const plan = buildMacroIndustryQueryPlan({ definition: health, variantKey: null });
    for (const pair of [
      ['clinica', 'clínica'],
      ['laboratorio farmaceutico', 'laboratorio farmacéutico'],
      ['diagnostico clinico', 'diagnóstico clínico'],
    ]) {
      assert.ok(plan.effectiveKeywords.includes(pair[0]!), pair[0]);
      assert.ok(plan.effectiveKeywords.includes(pair[1]!), pair[1]);
    }
  });

  it('con poco presupuesto, las variantes son lo primero que se queda fuera', () => {
    const health = MACRO_INDUSTRIES.find((d) => d.key === 'health_pharma')!;
    const full = buildMacroIndustryQueryPlan({ definition: health, variantKey: null });
    const originalsCount = full.effectiveKeywords.length - full.accentVariantsAdded.length;
    const tight = buildMacroIndustryQueryPlan({
      definition: health,
      variantKey: null,
      keywordBudget: originalsCount + 1,
    });
    assert.equal(tight.accentVariantsAdded.length, 1);
    assert.deepEqual(
      tight.effectiveKeywords.slice(0, originalsCount),
      full.effectiveKeywords.slice(0, originalsCount),
    );
  });
});

// ─── § 4 ──────────────────────────────────────────────────────────────────────

describe('§ 4 — el contrato de la petición conserva las dos formas', () => {
  it('`clinica` y `clínica` viajan las dos en q_organization_keyword_tags', () => {
    const contract = buildApolloOrganizationsRequestContract({
      page: 1,
      perPage: 100,
      keywordTags: ['clinica', 'clínica', 'CLINICA'],
    } as Parameters<typeof buildApolloOrganizationsRequestContract>[0]);
    assert.deepEqual(contract.body.q_organization_keyword_tags, ['clinica', 'clínica']);
  });
});
