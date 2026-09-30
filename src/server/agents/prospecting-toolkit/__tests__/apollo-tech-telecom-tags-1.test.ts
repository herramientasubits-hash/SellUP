/**
 * AGENT1-APOLLO-TECH-TELECOM-TAGS-1 — Apollo también busca telecomunicaciones
 * cuando la macro industria es Tecnología.
 *
 * Decisión de la dueña (2026-09-30): las telecomunicaciones cuentan como
 * Tecnología para UBITS. Colombia × Tecnología (lote `67930f23`): con las 13
 * etiquetas precisas Apollo sólo devolvió 17 empresas y ninguna de telecom.
 *
 *   § 1 · Tecnología envía `telecomunicaciones` y `telecommunications` y lo declara;
 *   § 2 · no cuentan como cobertura ni rompen el tope ni la huella de otras;
 *   § 3 · las familias y el resto de macro industrias no cambian;
 *   § 4 · el gate de evidencia ya acepta una empresa de telecomunicaciones.
 *
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import {
  APOLLO_EXTRA_MACRO_TAGS,
  buildMacroIndustryQueryPlan,
  computeMacroIndustryQueryCoverage,
  toMacroIndustryQueryMetadata,
} from '../apollo-macro-industry-query-terms';
import { APOLLO_MAX_FILTER_VALUES } from '../apollo-organizations-request-contract';

const TELECOM = ['telecomunicaciones', 'telecommunications'];
const technology = MACRO_INDUSTRIES.find((d) => d.key === 'technology')!;

describe('§ 1 — Tecnología pide telecomunicaciones', () => {
  it('la lista es exactamente la decidida', () => {
    assert.deepEqual(Object.keys(APOLLO_EXTRA_MACRO_TAGS), ['technology']);
    assert.deepEqual([...APOLLO_EXTRA_MACRO_TAGS.technology!], TELECOM);
  });

  it('🔴 las dos viajan, justo después de los específicos', () => {
    const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey: null });
    const specificCount = plan.coverage.specificTermCount;
    assert.deepEqual(plan.effectiveKeywords.slice(specificCount, specificCount + 2), TELECOM);
    assert.deepEqual(plan.apolloExtraTagsAdded, TELECOM);
    assert.ok(plan.effectiveKeywords.length <= APOLLO_MAX_FILTER_VALUES);
  });

  it('la metadata lo publica', () => {
    const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey: null });
    assert.deepEqual(toMacroIndustryQueryMetadata(plan).macro_industry_apollo_extra_tags_added, TELECOM);
  });
});

describe('§ 2 — no se hacen pasar por cobertura', () => {
  it('la cobertura sigue siendo la del catálogo (13 específicos, completa)', () => {
    const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey: null });
    assert.equal(plan.coverage.specificTermCount, 13);
    assert.equal(plan.coverage.complete, true);
    assert.ok(plan.coverage.specificCoverageRatio <= 1);
    for (const t of TELECOM) assert.ok(!plan.coverage.coveringSpecificTerms.includes(t), t);
  });

  it('la cobertura medida sobre lo que viaja tampoco las cuenta', () => {
    const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey: null });
    const measured = computeMacroIndustryQueryCoverage({
      definition: technology,
      effectiveKeywords: plan.effectiveKeywords,
    });
    for (const t of TELECOM) assert.ok(!measured.coveringSpecificTerms.includes(t), t);
  });

  it('con poco presupuesto, primero los específicos del catálogo', () => {
    const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey: null, keywordBudget: 14 });
    assert.equal(plan.coverage.specificTermCount, 13);
    assert.deepEqual(plan.apolloExtraTagsAdded, ['telecomunicaciones']);
  });
});

describe('§ 3 — lo demás no cambia', () => {
  it('una familia de Tecnología no las lleva', () => {
    for (const family of technology.discovery.families ?? []) {
      const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey: family.key });
      assert.deepEqual(plan.apolloExtraTagsAdded, [], family.key);
      for (const t of TELECOM) assert.ok(!plan.effectiveKeywords.includes(t), `${family.key}: ${t}`);
    }
  });

  for (const definition of MACRO_INDUSTRIES.filter((d) => d.key !== 'technology')) {
    it(`${definition.key}: nada añadido`, () => {
      const plan = buildMacroIndustryQueryPlan({ definition, variantKey: null });
      assert.deepEqual(plan.apolloExtraTagsAdded, []);
      for (const t of TELECOM) assert.ok(!plan.effectiveKeywords.includes(t), t);
    });
  }
});

describe('§ 4 — la evidencia ya acepta telecomunicaciones como Tecnología', () => {
  it('`telecommunications` es industria padre de Tecnología y no la excluye', () => {
    assert.ok(technology.evidence.parentIndustries.includes('telecommunications'));
    assert.ok(!technology.evidence.excludingIndustries.includes('telecommunications'));
    assert.ok(!technology.discovery.exclusions.some((e) => /telecom/.test(e)));
  });
});
