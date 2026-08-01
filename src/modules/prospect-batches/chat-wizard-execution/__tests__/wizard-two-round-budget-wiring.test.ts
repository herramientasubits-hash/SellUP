/**
 * Cableado del presupuesto de dos rondas en el preflight del wizard.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 10 · casos 18 y 19 en la ruta real.
 *
 * Offline: se manipula sólo el entorno del proceso de test y se restaura. No hay
 * proveedor, ni base de datos, ni créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveWizardExecutionCreditEstimate,
  estimateCreditsForProvider,
  toWizardBudgetValidationMetadata,
} from '../wizard-budget-estimate';
import { BUDGET_EXCEEDED_TWO_ROUND_APOLLO } from '@/server/agents/prospecting-toolkit/apollo-two-round';

/** Ejecuta `fn` con la modalidad de dos rondas encendida y restaura el entorno. */
function withTwoRoundMode(enabled: boolean, fn: () => void): void {
  const saved = process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
  if (enabled) {
    process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'true';
  } else {
    delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
  }
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    else process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = saved;
  }
}

describe('§ 10 · preflight del wizard con la modalidad de dos rondas', () => {
  it('reserva el peor caso de doce créditos, no el desglose legacy', () => {
    withTwoRoundMode(true, () => {
      assert.equal(estimateCreditsForProvider('apollo_organizations'), 12);
    });
  });

  it('caso 19 — con presupuesto insuficiente bloquea con el estado explicativo propio', () => {
    withTwoRoundMode(true, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 11,
        maxCreditsPerExecution: 100,
      });

      assert.equal(result.passed, false);
      assert.equal(result.blockReason, BUDGET_EXCEEDED_TWO_ROUND_APOLLO);
      assert.equal(result.estimatedCredits, 12);
      assert.equal(result.estimateSource, 'apollo_two_round_worst_case');
    });
  });

  it('un tope por ejecución insuficiente bloquea con el mismo estado', () => {
    withTwoRoundMode(true, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 1000,
        maxCreditsPerExecution: 8,
      });

      assert.equal(result.passed, false);
      assert.equal(result.blockReason, BUDGET_EXCEEDED_TWO_ROUND_APOLLO);
    });
  });

  it('con presupuesto suficiente pasa y expone el desglose', () => {
    withTwoRoundMode(true, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 25,
      });

      assert.equal(result.passed, true);
      assert.equal(result.blockReason, null);
      assert.equal(result.apolloTwoRoundBreakdown?.maximumInternalRecordedCredits, 12);
      assert.equal(result.apolloTwoRoundBreakdown?.searchRound1Maximum, 5);
      assert.equal(result.apolloTwoRoundBreakdown?.searchRound2Maximum, 5);
      assert.equal(result.apolloTwoRoundBreakdown?.enrichmentMaximum, 2);
    });
  });

  it('con la modalidad apagada el comportamiento previo queda intacto', () => {
    withTwoRoundMode(false, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 25,
      });

      assert.equal(result.estimateSource, 'apollo_cost_guardrails');
      assert.equal(result.apolloTwoRoundBreakdown, null);
      assert.notEqual(result.blockReason, BUDGET_EXCEEDED_TWO_ROUND_APOLLO);
    });
  });

  it('Tavily no se ve afectado por la modalidad', () => {
    withTwoRoundMode(true, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'tavily',
        availableCredits: 100,
        maxCreditsPerExecution: 100,
      });

      assert.equal(result.estimateSource, 'tavily_adaptive_pipeline');
      assert.equal(result.apolloTwoRoundBreakdown, null);
    });
  });

  it('la metadata del preflight no filtra secretos ni valores crudos de entorno', () => {
    withTwoRoundMode(true, () => {
      const metadata = toWizardBudgetValidationMetadata(
        resolveWizardExecutionCreditEstimate({
          provider: 'apollo_organizations',
          availableCredits: 12,
          maxCreditsPerExecution: 25,
        }),
      );

      const serialized = JSON.stringify(metadata);
      for (const forbidden of ['api_key', 'apiKey', 'SUPABASE', 'Bearer', 'ENABLE_APOLLO']) {
        assert.ok(!serialized.includes(forbidden), `no debe aparecer "${forbidden}"`);
      }
      assert.equal(metadata.apollo_two_round_budget?.['maximum_internal_recorded_credits'], 12);
    });
  });
});
