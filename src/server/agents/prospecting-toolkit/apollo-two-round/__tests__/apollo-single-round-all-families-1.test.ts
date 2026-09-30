/**
 * AGENT1-APOLLO-SINGLE-ROUND-ALL-FAMILIES-1 — una sola búsqueda de Apollo, con
 * TODAS las familias de etiquetas de la macro industria.
 *
 * Decisión de la dueña (2026-09-29): «una sola corrida por Apollo y Lusha».
 * Medido ese día en Producción (Perú × Salud, lote `701ffe78`): la ronda 1 trajo
 * 73 organizaciones —todo lo que Apollo tenía, una sola página— y la ronda 2
 * pagó 1 crédito por 3 resultados, los 3 ya vistos.
 *
 * La ronda 2 no repetía la 1: buscaba la SEGUNDA familia (en Salud, farma /
 * dispositivos / aseguradoras). Quitarla sin más dejaría esas etiquetas sin
 * buscar nunca; por eso la única ronda envía la unión.
 *
 *   § 1 · una ronda se pide por entorno; el contrato de dos sigue intacto;
 *   § 2 · con una ronda, la reserva deja de cubrir la segunda;
 *   § 3 · sin familias, la ronda 1 envía la unión de todas, en las 12 macros;
 *   § 4 · el runner sólo reparte familias si hay ronda 2.
 *
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  MACRO_INDUSTRIES,
  MACRO_INDUSTRY_COUNT,
} from '@/modules/macro-industry-catalog/macro-industries';
import { buildMacroIndustryQueryPlan } from '../../apollo-macro-industry-query-terms';
import { WIZARD_APOLLO_MAX_PAGES_HARD_CAP } from '../../apollo-organizations-pagination-budget';
import { estimateApolloTwoRoundBudget } from '../budget';
import {
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_DEFAULT,
  resolveApolloTwoRoundConfig,
} from '../config';
import { buildRound1Hypothesis } from '../query-hypothesis';

/** Tope de valores por filtro de Apollo en el contrato (`request-contract.ts`). */
const APOLLO_FILTER_VALUES_MAX = 25;

// ─── § 1 ──────────────────────────────────────────────────────────────────────

describe('§ 1 — una sola ronda se pide por entorno, sin tocar el contrato de dos', () => {
  it('`AGENT1_APOLLO_MAX_SEARCH_ROUNDS=1` resuelve una ronda, como override visible', () => {
    const r = resolveApolloTwoRoundConfig({ maxRounds: '1' });
    assert.equal(r.config.maxRounds, 1);
    assert.equal(r.sources.maxRounds, 'env_override');
  });

  it('el contrato de dos rondas sigue disponible (default y tope sin cambios)', () => {
    assert.equal(MAX_SEARCH_ROUNDS_DEFAULT, 2);
    assert.equal(MAX_SEARCH_ROUNDS_ABSOLUTE_MAX, 2);
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

describe('§ 2 — con una ronda, la reserva cubre UNA ronda de búsqueda', () => {
  it('búsqueda = una ronda de páginas; ronda 2 = 0', () => {
    const { config } = resolveApolloTwoRoundConfig({ maxRounds: '1', maxEnrichmentsPerRun: '5' });
    const budget = estimateApolloTwoRoundBudget(config);
    assert.deepEqual(budget.searchCreditsPerRound, [WIZARD_APOLLO_MAX_PAGES_HARD_CAP]);
    assert.equal(budget.searchRound2Maximum, 0);
    // Producción (enrichments = 5): 5 páginas + 5 enrichments = 10, antes 15.
    assert.equal(budget.maximumInternalRecordedCredits, WIZARD_APOLLO_MAX_PAGES_HARD_CAP + 5);
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

describe('§ 3 — la ronda única envía la unión de las familias', () => {
  it('las 12 macro industrias declaran familias (si no, esta suite no mide nada)', () => {
    assert.equal(MACRO_INDUSTRIES.length, MACRO_INDUSTRY_COUNT);
    for (const d of MACRO_INDUSTRIES) {
      assert.ok((d.discovery.families ?? []).length >= 2, `${d.key} sin familias`);
    }
  });

  for (const definition of MACRO_INDUSTRIES) {
    it(`${definition.key}: todas las etiquetas de todas las familias, bajo el tope de ${APOLLO_FILTER_VALUES_MAX}`, () => {
      const round1 = buildRound1Hypothesis(
        {
          country: 'Perú',
          countryCode: 'PE',
          sector: definition.displayName,
          subindustries: [],
          macroQueryFamilies: [],
        },
        10,
      );
      assert.equal(round1.macroQueryVariantKey, null, 'sin variante ⇒ plan completo');

      const plan = buildMacroIndustryQueryPlan({ definition, variantKey: round1.macroQueryVariantKey });
      const sent = new Set(plan.effectiveKeywords.map((k) => k.toLowerCase()));
      for (const family of definition.discovery.families ?? []) {
        for (const term of family.terms) {
          // AGENT1-APOLLO-TECH-NOISY-TAGS-1 — las etiquetas demasiado genéricas
          // se retienen a propósito (y se declaran en `apolloNoisyTagsWithheld`).
          if (plan.apolloNoisyTagsWithheld.includes(term.toLowerCase())) continue;
          assert.ok(sent.has(term.toLowerCase()), `${definition.key}/${family.key}: «${term}» no viaja`);
        }
      }
      assert.ok(plan.effectiveKeywords.length <= APOLLO_FILTER_VALUES_MAX, `${plan.effectiveKeywords.length}`);
    });
  }

  it('🔴 Salud: la búsqueda de Perú ya no deja fuera a las farmacéuticas', () => {
    const health = MACRO_INDUSTRIES.find((d) => d.key === 'health_pharma')!;
    const firstFamilyOnly = buildMacroIndustryQueryPlan({
      definition: health,
      variantKey: health.discovery.families![0]!.key,
    }).effectiveKeywords;
    const union = buildMacroIndustryQueryPlan({ definition: health, variantKey: null }).effectiveKeywords;

    assert.ok(!firstFamilyOnly.includes('laboratorio farmaceutico'), 'así era la ronda 1 de Perú');
    assert.ok(union.includes('laboratorio farmaceutico'));
    assert.ok(union.includes('clinica'));
  });
});

// ─── § 4 ──────────────────────────────────────────────────────────────────────

/** Código sin comentarios: nombrar algo en un comentario no es usarlo. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('§ 4 — el runner reparte familias sólo si hay ronda 2', () => {
  it('`macroQueryFamilies` se condiciona a `config.maxRounds >= 2`', () => {
    const runner = stripComments(
      readFileSync(path.join(__dirname, '..', 'production-runner.server.ts'), 'utf8'),
    );
    const assignment = runner.match(/macroQueryFamilies:\s*([\s\S]*?)\?\s*macroIndustryQueryFamilyKeys\(/);
    assert.ok(assignment, 'no encuentro la asignación de macroQueryFamilies');
    assert.match(assignment[1]!, /config\.maxRounds\s*>=\s*2/);
  });
});
