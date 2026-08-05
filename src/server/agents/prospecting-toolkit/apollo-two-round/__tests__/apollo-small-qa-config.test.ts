/**
 * Tests — configuración del QA pequeño 1/1/3/3/1 con tope de 4 créditos.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 12 y § 14 (caso 16).
 *
 * Lo que estos tests DEMUESTRAN: las variables de entorno que ya existen bastan
 * para reducir la modalidad de dos rondas a la corrida mínima que valida la
 * persistencia. No hace falta un flag nuevo ni un «modo QA».
 *
 * Nada aquí enciende nada: el núcleo es puro y recibe los valores crudos por
 * parámetro. No se lee `process.env`, no se llama a Apollo, no se gasta un
 * crédito.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveApolloTwoRoundConfig,
  APOLLO_TWO_ROUND_ENV_KEYS,
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
  MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX,
  MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
  TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
} from '../config';
import { estimateApolloTwoRoundBudget } from '../budget';

/** Los cinco valores crudos del QA pequeño, en el orden del contrato. */
const SMALL_QA_RAW_ENV = {
  targetEligibleCompanies: '1',
  maxRounds: '1',
  maxResultsPerRound: '3',
  maxRawResultsPerRun: '3',
  maxEnrichmentsPerRun: '1',
} as const;

const SMALL_QA_MAX_CREDITS = 4;

describe('§ 12 / § 14.16 — la configuración existente resuelve 1/1/3/3/1', () => {
  it('los cinco números efectivos son los pedidos, todos por override de entorno', () => {
    const resolution = resolveApolloTwoRoundConfig(SMALL_QA_RAW_ENV);

    assert.deepEqual(resolution.config, {
      targetEligibleCompanies: 1,
      maxRounds: 1,
      maxResultsPerRound: 3,
      maxRawResultsPerRun: 3,
      maxEnrichmentsPerRun: 1,
    });

    for (const [key, source] of Object.entries(resolution.sources)) {
      assert.equal(source, 'env_override', `${key} debe venir del override, no de un default`);
    }
  });

  it('la invariante de resultados crudos no infla el tope: 1 ronda × 3 = 3', () => {
    // `maxRawResultsPerRun` se eleva al mínimo alcanzable por las rondas. Con una
    // sola ronda de 3, ese mínimo ES 3, así que el tope crudo no crece.
    const { config } = resolveApolloTwoRoundConfig(SMALL_QA_RAW_ENV);
    assert.equal(config.maxRawResultsPerRun, config.maxRounds * config.maxResultsPerRound);
    assert.equal(config.maxRawResultsPerRun, 3);
  });

  it('el techo económico del peor caso es EXACTAMENTE 4 créditos', () => {
    const { config } = resolveApolloTwoRoundConfig(SMALL_QA_RAW_ENV);
    const budget = estimateApolloTwoRoundBudget(config);

    assert.equal(budget.maximumInternalRecordedCredits, SMALL_QA_MAX_CREDITS);
    assert.equal(budget.searchRound1Maximum, 3);
    assert.equal(budget.searchRound2Maximum, 0, 'no hay segunda ronda que presupuestar');
    assert.equal(budget.enrichmentMaximum, 1);
    assert.deepEqual(budget.searchCreditsPerRound, [3]);
  });

  it('los cinco valores caben bajo los topes absolutos: reducen, nunca amplían', () => {
    assert.ok(1 <= TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX);
    assert.ok(1 <= MAX_SEARCH_ROUNDS_ABSOLUTE_MAX);
    assert.ok(3 <= MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX);
    assert.ok(3 <= MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX);
    assert.ok(1 <= MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX);
  });

  it('el QA pequeño cuesta menos que el peor caso por defecto (12 créditos)', () => {
    const smallQa = estimateApolloTwoRoundBudget(
      resolveApolloTwoRoundConfig(SMALL_QA_RAW_ENV).config,
    );
    const defaults = estimateApolloTwoRoundBudget(resolveApolloTwoRoundConfig().config);
    assert.equal(defaults.maximumInternalRecordedCredits, 12);
    assert.ok(
      smallQa.maximumInternalRecordedCredits < defaults.maximumInternalRecordedCredits,
      'el QA pequeño tiene que ser estrictamente más barato',
    );
  });

  it('las cinco variables que habría que fijar son las que ya existen', () => {
    // Se afirman los NOMBRES para que un futuro renombrado rompa el test antes de
    // romper una ventana de QA. Ningún valor se escribe en el entorno aquí.
    assert.deepEqual(APOLLO_TWO_ROUND_ENV_KEYS, {
      targetEligibleCompanies: 'AGENT1_APOLLO_TARGET_ELIGIBLE_COMPANIES',
      maxRounds: 'AGENT1_APOLLO_MAX_SEARCH_ROUNDS',
      maxResultsPerRound: 'AGENT1_APOLLO_MAX_RESULTS_PER_ROUND',
      maxRawResultsPerRun: 'AGENT1_APOLLO_MAX_RAW_RESULTS_PER_RUN',
      maxEnrichmentsPerRun: 'AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN_TWO_ROUND',
    });
    assert.equal(Object.keys(APOLLO_TWO_ROUND_ENV_KEYS).length, 5);
  });

  it('un valor ilegible NO amplía el QA pequeño: cae al default conservador', () => {
    // Importa para la ventana real: un typo en el panel de Vercel no puede
    // convertir una corrida de 4 créditos en una de 12 sin que se note.
    const withTypo = resolveApolloTwoRoundConfig({
      ...SMALL_QA_RAW_ENV,
      maxResultsPerRound: '3.5',
    });
    assert.equal(withTypo.sources.maxResultsPerRound, 'env_invalid_fallback_default');
    assert.equal(withTypo.config.maxResultsPerRound, 5);
    // Y el presupuesto resultante sigue siendo el del contrato, nunca mayor.
    assert.ok(
      estimateApolloTwoRoundBudget(withTypo.config).maximumInternalRecordedCredits <= 12,
    );
  });
});
