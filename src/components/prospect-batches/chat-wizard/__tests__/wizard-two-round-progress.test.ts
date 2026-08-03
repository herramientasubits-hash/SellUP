/**
 * wizard-two-round-progress.test.ts — etapas y cierre de la modalidad Apollo de
 * dos rondas.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 11 · casos 19–22.
 *
 * La regla que estos tests protegen: NUNCA afirmar que la ronda 2 corrió.
 *
 *   ronda 1 alcanza el objetivo   → «Rondas ejecutadas: 1» y nada sobre la ronda 2
 *   3 + 2 = 5                     → objetivo alcanzado tras 2 rondas
 *   menos de cinco                → estado parcial + filtros intactos
 *   tope de rondas                → la etapa de la ronda 2 es CONDICIONAL
 *
 * Todo offline: módulo puro, sin DOM.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_TWO_ROUND_CONDITIONAL_NOTICE,
  APOLLO_TWO_ROUND_FILTERS_PRESERVED_LINE,
  APOLLO_TWO_ROUND_PLANNED_STEPS_TITLE,
  buildApolloTwoRoundProgressSteps,
  summarizeApolloTwoRoundOutcome,
} from '../wizard-two-round-progress';

const TARGET = 5;

describe('§ 11 · etapas planificadas', () => {
  it('lista las cinco etapas del contrato, en orden', () => {
    const steps = buildApolloTwoRoundProgressSteps({ maxRounds: 2 });

    assert.deepEqual(
      steps.map((s) => s.label),
      [
        'Buscando empresas con Apollo — ronda 1 de 2',
        'Evaluando resultados y duplicados',
        'Buscando alternativas — ronda 2 de 2',
        'Evaluando empresas para enrichment',
        'Preparando candidatos',
      ],
    );
  });

  it('la ronda 2 se marca CONDICIONAL: puede no ocurrir', () => {
    const steps = buildApolloTwoRoundProgressSteps({ maxRounds: 2 });
    const round2 = steps.find((s) => s.phase === 'round_2_search');
    assert.equal(round2?.conditional, true);

    // Ninguna otra etapa es condicional: las demás siempre ocurren.
    const conditionals = steps.filter((s) => s.conditional).map((s) => s.phase);
    assert.deepEqual(conditionals, ['round_2_search']);
  });

  it('se presentan como PLAN, no como progreso cumplido', () => {
    assert.equal(APOLLO_TWO_ROUND_PLANNED_STEPS_TITLE, 'Etapas de esta ejecución');
    assert.equal(
      APOLLO_TWO_ROUND_CONDITIONAL_NOTICE,
      'La ronda 2 sólo se ejecuta si la ronda 1 no alcanza el objetivo.',
    );
  });

  it('caso 22 — con el tope en una ronda la etapa de la ronda 2 desaparece', () => {
    const steps = buildApolloTwoRoundProgressSteps({ maxRounds: 1 });
    assert.equal(
      steps.some((s) => s.phase === 'round_2_search'),
      false,
    );
    assert.match(steps[0].label, /ronda 1 de 1/);
  });
});

describe('§ 11 · caso 19 — la ronda 1 alcanza el objetivo', () => {
  const outcome = summarizeApolloTwoRoundOutcome({
    roundsExecuted: 1,
    eligibleCompaniesFound: 5,
    targetEligibleCompanies: TARGET,
  });

  it('reporta una sola ronda ejecutada', () => {
    assert.equal(outcome.roundsLine, 'Rondas ejecutadas: 1');
  });

  it('declara el objetivo alcanzado', () => {
    assert.equal(outcome.targetLine, 'Objetivo alcanzado: sí');
  });

  it('NO insinúa que la ronda 2 corrió', () => {
    const rendered = [outcome.roundsLine, outcome.targetLine, outcome.partialLine, outcome.filtersLine]
      .filter((line): line is string => line !== null)
      .join(' ');
    assert.ok(!/ronda 2/i.test(rendered));
    assert.ok(!/2 rondas/i.test(rendered));
    assert.equal(outcome.partialLine, null);
  });
});

describe('§ 11 · caso 20 — la ronda 1 aporta tres y la ronda 2 dos', () => {
  const outcome = summarizeApolloTwoRoundOutcome({
    roundsExecuted: 2,
    eligibleCompaniesFound: 5,
    targetEligibleCompanies: TARGET,
  });

  it('reporta dos rondas y objetivo alcanzado', () => {
    assert.equal(outcome.roundsLine, 'Rondas ejecutadas: 2');
    assert.equal(outcome.targetLine, 'Objetivo alcanzado: sí');
  });

  it('no hay estado parcial cuando el objetivo se cumplió', () => {
    assert.equal(outcome.partialLine, null);
    assert.equal(outcome.filtersLine, null);
  });
});

describe('§ 11 · caso 21 — menos de cinco empresas válidas', () => {
  const outcome = summarizeApolloTwoRoundOutcome({
    roundsExecuted: 2,
    eligibleCompaniesFound: 3,
    targetEligibleCompanies: TARGET,
  });

  it('dice cuántas encontró y tras cuántas rondas', () => {
    assert.equal(
      outcome.partialLine,
      'Se encontraron 3 empresas válidas después de 2 rondas.',
    );
  });

  it('declara el objetivo NO alcanzado', () => {
    assert.equal(outcome.targetLine, 'Objetivo alcanzado: no');
  });

  it('afirma que los filtros de calidad NO se relajaron', () => {
    assert.equal(outcome.filtersLine, APOLLO_TWO_ROUND_FILTERS_PRESERVED_LINE);
    assert.equal(outcome.filtersLine, 'No se redujeron los filtros de calidad.');
  });

  it('una sola empresa se redacta en singular', () => {
    const single = summarizeApolloTwoRoundOutcome({
      roundsExecuted: 1,
      eligibleCompaniesFound: 1,
      targetEligibleCompanies: TARGET,
    });
    assert.equal(single.partialLine, 'Se encontraron 1 empresa válida después de 1 ronda.');
  });

  it('cero empresas sigue siendo un estado parcial, no un error', () => {
    const none = summarizeApolloTwoRoundOutcome({
      roundsExecuted: 2,
      eligibleCompaniesFound: 0,
      targetEligibleCompanies: TARGET,
    });
    assert.equal(none.targetLine, 'Objetivo alcanzado: no');
    assert.equal(none.partialLine, 'Se encontraron 0 empresas válidas después de 2 rondas.');
  });
});

describe('§ 11 · un dato ausente no se convierte en un cero ni en un «no»', () => {
  it('sin conteo de empresas no se afirma nada sobre el objetivo', () => {
    const outcome = summarizeApolloTwoRoundOutcome({
      roundsExecuted: 2,
      eligibleCompaniesFound: null,
      targetEligibleCompanies: TARGET,
    });
    assert.equal(outcome.roundsLine, 'Rondas ejecutadas: 2');
    assert.equal(outcome.targetLine, null);
    assert.equal(outcome.partialLine, null);
    assert.equal(outcome.filtersLine, null);
  });

  it('sin conteo de rondas el parcial omite la frase de rondas', () => {
    const outcome = summarizeApolloTwoRoundOutcome({
      roundsExecuted: null,
      eligibleCompaniesFound: 2,
      targetEligibleCompanies: TARGET,
    });
    assert.equal(outcome.roundsLine, null);
    assert.equal(outcome.partialLine, 'Se encontraron 2 empresas válidas.');
  });

  it('sin ningún dato no se produce una sola línea', () => {
    const outcome = summarizeApolloTwoRoundOutcome({
      roundsExecuted: null,
      eligibleCompaniesFound: null,
      targetEligibleCompanies: TARGET,
    });
    assert.deepEqual(outcome, {
      roundsLine: null,
      targetLine: null,
      partialLine: null,
      filtersLine: null,
    });
  });
});
