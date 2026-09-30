/**
 * AGENT1-APOLLO-TECH-NOISY-TAGS-1 — Apollo deja de buscar Tecnología con
 * etiquetas que casi cualquier empresa tiene.
 *
 * Medido en Producción el 2026-09-30 (Perú × Tecnología, lote `d1d035ce`): con
 * `software`, `technology` y `plataforma digital` en el OR, Apollo devolvió KFC
 * Perú, una minera, el puerto de Chancay, un diario, inmobiliarias y
 * municipalidades como «Tecnología». Antes, en México, decenas de universidades.
 *
 *   § 1 · Tecnología ya no envía esas cinco etiquetas y lo declara;
 *   § 2 · la consulta sigue siendo completa (cobertura y específicos);
 *   § 3 · el resto de macro industrias no cambia;
 *   § 4 · la petición real a Apollo no las lleva.
 *
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import {
  APOLLO_NOISY_MACRO_TAGS,
  MACRO_QUERY_MIN_SPECIFIC_FOR_BROAD,
  buildMacroIndustryQueryPlan,
} from '../apollo-macro-industry-query-terms';

const NOISY = ['software', 'technology', 'tecnologia', 'information technology', 'plataforma digital'];
const technology = MACRO_INDUSTRIES.find((d) => d.key === 'technology')!;

describe('§ 1 — Tecnología sin etiquetas genéricas', () => {
  it('la lista es exactamente la medida en Producción', () => {
    assert.deepEqual([...(APOLLO_NOISY_MACRO_TAGS.technology ?? [])].sort(), [...NOISY].sort());
  });

  it('🔴 ninguna de las cinco viaja, en ninguna variante', () => {
    for (const variantKey of [null, ...(technology.discovery.families ?? []).map((f) => f.key)]) {
      const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey });
      for (const noisy of NOISY) {
        assert.ok(!plan.effectiveKeywords.includes(noisy), `${variantKey}: «${noisy}» viajó`);
      }
    }
  });

  it('se declaran como retenidas, con su motivo', () => {
    const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey: null });
    assert.deepEqual([...plan.apolloNoisyTagsWithheld].sort(), [...NOISY].sort());
    for (const broad of plan.withheldBroadTerms) {
      assert.equal(broad.reason, 'apollo_noisy_generic_tag', broad.term);
    }
    assert.deepEqual(plan.admittedBroadTerms, []);
  });
});

describe('§ 2 — la consulta de Tecnología sigue siendo completa', () => {
  it('13 específicos, cobertura completa, sin amplios', () => {
    const plan = buildMacroIndustryQueryPlan({ definition: technology, variantKey: null });
    assert.equal(plan.coverage.specificTermCount, 13);
    assert.ok(plan.coverage.specificTermCount >= MACRO_QUERY_MIN_SPECIFIC_FOR_BROAD);
    assert.equal(plan.coverage.complete, true);
    assert.equal(plan.coverage.broadTermShare, 0);
    for (const kept of ['saas platform', 'cybersecurity', 'desarrollo de software', 'machine learning']) {
      assert.ok(plan.effectiveKeywords.includes(kept), kept);
    }
  });
});

describe('§ 3 — las demás macro industrias no cambian', () => {
  for (const definition of MACRO_INDUSTRIES.filter((d) => d.key !== 'technology')) {
    it(`${definition.key}: nada retenido por ruido`, () => {
      const plan = buildMacroIndustryQueryPlan({ definition, variantKey: null });
      assert.deepEqual(plan.apolloNoisyTagsWithheld, []);
      assert.ok(plan.withheldBroadTerms.every((w) => w.reason !== 'apollo_noisy_generic_tag'));
    });
  }
});
