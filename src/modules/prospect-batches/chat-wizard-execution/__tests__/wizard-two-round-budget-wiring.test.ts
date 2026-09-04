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
import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';

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

  it('caso 19 — el presupuesto insuficiente bloquea con la precedencia de siempre', () => {
    // A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX § 10: lo que la modalidad cambia es
    // el NÚMERO estimado (su peor caso), no el vocabulario del bloqueo. El estado
    // explicativo propio viaja como `blockDetail` del bloqueo REAL, que lo decide
    // la reserva atómica — ver la prueba de la ruta real más abajo.
    withTwoRoundMode(true, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 11,
        maxCreditsPerExecution: 100,
      });

      assert.equal(result.passed, false);
      assert.equal(result.blockReason, 'insufficient_available_budget');
      assert.equal(result.estimatedCredits, 12);
      assert.equal(result.estimateSource, 'apollo_two_round_worst_case');
    });
  });

  it('un tope por ejecución insuficiente bloquea con su propio motivo', () => {
    withTwoRoundMode(true, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 1000,
        maxCreditsPerExecution: 8,
      });

      assert.equal(result.passed, false);
      assert.equal(result.blockReason, 'exceeds_max_credits_per_execution');
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

// ─── § 10 · el estado explicativo en la RUTA REAL ─────────────────────────────

describe('§ 10 · el bloqueo real de presupuesto explica el techo de la modalidad', () => {
  const BATCH_ID = '123e4567-e89b-12d3-a456-426614174000';
  const USER_ID = '123e4567-e89b-12d3-a456-426614174009';
  const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
  const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
  const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';

  const request = {
    clientRequestId: CLIENT_REQUEST_ID,
    countryCode: 'CO',
    industryId: INDUSTRY_ID,
    subindustryIds: [SUBINDUSTRY_ID],
    catalogVersion: 'v2024-01',
    additionalCriteriaRaw: null,
  };

  function blockedDeps(): WizardExecutionDeps {
    return {
      getActiveUserId: async () => USER_ID,
      resolveCatalog: async () => ({
        catalog: { version: 'v2024-01' },
        country: { code: 'CO', name: 'Colombia' },
        industry: { id: INDUSTRY_ID, slug: 'supermercados', name: 'Supermercados' },
        subindustries: [
          { id: SUBINDUSTRY_ID, slug: 'hiper', name: 'Hipermercados', applicableCountries: ['CO'] },
        ],
      }),
      checkTavilyAvailability: async () => true,
      // A1-APOLLO-PERSISTENCE-READINESS-4 § 6 — el esquema está listo: este doble
      // no ejercita el preflight de persistencia.
      checkPersistenceReadiness: async () => ({ status: 'available' as const }),
      checkApolloAvailability: async () => ({ available: true } as const),
      // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — Apollo ya no pasa por la
      // reserva atómica del pool del piloto: la AUTORIDAD que bloquea es su
      // propia cuota. `reserveBudget` queda sin ejercitar para esta corrida —
      // se conserva sólo para probar que NUNCA se llama.
      reserveBudget: async () => ({
        status: 'blocked',
        code: 'EXECUTION_CREDIT_LIMIT_EXCEEDED',
        message: 'limite por ejecución',
      }),
      checkApolloProviderQuota: async () => ({
        status: 'blocked',
        providerCreditsAvailable: 0,
      }),
      confirmBudget: async () => ({ status: 'confirmed' as const }),
      releaseBudget: async () => ({ status: 'released' as const }),
      readConsumedCredits: async () => 0,
      reserveSlot: async () => ({ status: 'reserved', batchId: BATCH_ID }),
      runTavilyPipeline: async () => {
        throw new Error('no debe ejecutarse: la reserva bloqueó');
      },
      runApolloPipeline: async () => {
        throw new Error('no debe ejecutarse: la reserva bloqueó');
      },
      resolveProvider: () => 'apollo_organizations',
      markBatchFailed: async () => undefined,
    };
  }

  // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — Apollo ya no reserva del pool
  // del piloto (`wizard_monthly_budget_periods`), así que ya no puede
  // bloquear con `EXECUTION_CREDIT_LIMIT_EXCEEDED` ni con el `blockDetail` de
  // dos rondas que explicaba ESE bloqueo: los dos eran vocabulario de la
  // reserva atómica del piloto. El bloqueo real de Apollo es su propia cuota
  // (`BUDGET_EXCEEDED`, sin `blockDetail`), con o sin la modalidad de dos
  // rondas encendida — `reserveBudget` NUNCA se llama para verificarlo.

  it('con la modalidad activa el bloqueo es BUDGET_EXCEEDED de la cuota propia, sin blockDetail ni reserva del piloto', async () => {
    const savedExecution = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const savedApollo = process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    let reserveBudgetCalls = 0;
    try {
      // `withTwoRoundMode` es sincrónica y esta prueba es asíncrona, así que el
      // flag se maneja aquí con el mismo cuidado: se pone y se restaura en finally.
      process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'true';
      const deps = blockedDeps();
      const result = await executeProspectWizardGeneration(request, {
        ...deps,
        reserveBudget: async (...args) => {
          reserveBudgetCalls++;
          return deps.reserveBudget(...args);
        },
      });

      assert.ok(result.ok === false);
      assert.equal(result.code, 'BUDGET_EXCEEDED');
      assert.equal(result.blockDetail, undefined, 'sin vocabulario del piloto para la cuota propia de Apollo');
      assert.equal(reserveBudgetCalls, 0, 'Apollo no debe tocar wizard_monthly_budget_periods');
    } finally {
      delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
      if (savedApollo === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
      else process.env.ENABLE_APOLLO_COMPANY_SEARCH = savedApollo;
      if (savedExecution === undefined) delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
      else process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = savedExecution;
    }
  });

  it('con la modalidad apagada el bloqueo es igual: BUDGET_EXCEEDED de la cuota propia, sin blockDetail', async () => {
    const savedExecution = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const savedApollo = process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    try {
      const result = await executeProspectWizardGeneration(request, blockedDeps());
      assert.ok(result.ok === false);
      assert.equal(result.code, 'BUDGET_EXCEEDED');
      assert.equal(result.blockDetail, undefined);
    } finally {
      if (savedApollo === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
      else process.env.ENABLE_APOLLO_COMPANY_SEARCH = savedApollo;
      if (savedExecution === undefined) delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
      else process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = savedExecution;
    }
  });
});
