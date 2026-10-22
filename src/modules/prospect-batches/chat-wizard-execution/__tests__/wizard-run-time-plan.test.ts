/**
 * AGENT1-CRITERIA-QUICK-WINS-2 § 2 — el plan único de tiempo de la corrida.
 * Puro: sin reloj real.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { WIZARD_RUN_TIME_PLAN, resolveTavilyFirstMaxRounds } from '../wizard-run-time-plan';
import {
  TAVILY_FIRST_APOLLO_START_LIMIT_MS,
  TAVILY_FIRST_LUSHA_START_LIMIT_MS,
  TAVILY_FIRST_MAX_ROUNDS,
  FREE_LAYER_RESCUE_WINDOW_MS,
} from '../wizard-tavily-first';
import { CLAUDE_SEARCH_LEG_MIN_REMAINING_MS, WIZARD_FUNCTION_LIMIT_MS } from '../wizard-claude-search-leg';

describe('resolveTavilyFirstMaxRounds', () => {
  it('sin reloj conocido ⇒ el máximo de siempre', () => {
    assert.equal(resolveTavilyFirstMaxRounds(null), 3);
  });

  it('las rondas bajan a medida que se acerca el arranque de Apollo', () => {
    assert.equal(resolveTavilyFirstMaxRounds(0), 3);
    assert.equal(resolveTavilyFirstMaxRounds(30_000), 3);
    assert.equal(resolveTavilyFirstMaxRounds(50_000), 2);
    assert.equal(resolveTavilyFirstMaxRounds(80_000), 1);
  });

  it('nunca menos de 1: si Apollo ya no cabe, una ronda de Tavily es lo que queda', () => {
    assert.equal(resolveTavilyFirstMaxRounds(200_000), 1);
  });

  it('con las rondas que devuelve, Tavily cabe antes del arranque de Apollo', () => {
    for (const elapsed of [0, 20_000, 45_000, 60_000, 75_000, 95_000]) {
      const rounds = resolveTavilyFirstMaxRounds(elapsed);
      const end = elapsed + rounds * WIZARD_RUN_TIME_PLAN.tavilyRoundBudgetMs + WIZARD_RUN_TIME_PLAN.inlineReviewMinWindowMs;
      assert.ok(end <= WIZARD_RUN_TIME_PLAN.apolloStartLimitMs, `elapsed=${elapsed} rounds=${rounds}`);
    }
  });
});

describe('los tramos leen el mismo plan (valores de siempre)', () => {
  it('Tavily, Apollo, Lusha y Claude conservan sus límites', () => {
    assert.equal(TAVILY_FIRST_MAX_ROUNDS, 3);
    assert.equal(TAVILY_FIRST_APOLLO_START_LIMIT_MS, 140_000);
    assert.equal(TAVILY_FIRST_LUSHA_START_LIMIT_MS, 200_000);
    assert.equal(FREE_LAYER_RESCUE_WINDOW_MS, 45_000);
    assert.equal(CLAUDE_SEARCH_LEG_MIN_REMAINING_MS, 150_000);
    assert.equal(WIZARD_FUNCTION_LIMIT_MS, 300_000);
  });
});
