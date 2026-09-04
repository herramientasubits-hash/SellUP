/**
 * AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1
 *
 * Apollo ya NO reserva/consume del pool `wizard_monthly_budget_periods` que
 * comparten Tavily y Lusha. Usa su PROPIA cuota de Providers & Consumption
 * (`tool_catalog.monthly_credits_allowance` + `provider_usage_logs`), la misma
 * infraestructura que ya gobierna el resto del catálogo (`checkBudget` /
 * `getAdminBudgetSummary` en `src/modules/budgets`). Ningún `budget_rule` se
 * lee ni se crea para Apollo, y sin cuota configurada no se inventa ningún
 * límite adicional — igual que el panel de administración ya muestra hoy.
 *
 * Este archivo prueba la orquestación en `wizard-execution-actions.ts` con
 * dobles inyectados (sin DB, sin proveedor real). El cableado real de
 * `checkApolloProviderQuota` con `checkProviderQuotaAvailable('apollo')`
 * (tool_catalog + provider_usage_logs) vive en
 * `executeProspectWizardGenerationAction` y se ejercita end-to-end con
 * Supabase real, no en este archivo.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

const CLIENT_REQUEST_ID = '11111111-1111-4111-8111-111111111199';
const BATCH_ID = 'batch-agent1-apollo-provider-consumption-gate-1';
const USER_ID = 'user-agent1-apollo-provider-consumption-gate-1';

const VALID_REQUEST = {
  countryCode: 'CO',
  industryId: '22222222-2222-4222-8222-222222222298',
  subindustryIds: [],
  additionalCriteriaRaw: null,
  catalogVersion: '33333333-3333-4333-8333-333333333397',
  clientRequestId: CLIENT_REQUEST_ID,
};

type Spy = {
  reserveBudgetCalls: number;
  confirmBudgetCalls: number;
  releaseBudgetCalls: number;
  checkApolloProviderQuotaCalls: Array<{ estimatedCredits: number }>;
  apolloPipelineCalls: number;
  tavilyPipelineCalls: number;
};

function freshSpy(): Spy {
  return {
    reserveBudgetCalls: 0,
    confirmBudgetCalls: 0,
    releaseBudgetCalls: 0,
    checkApolloProviderQuotaCalls: [],
    apolloPipelineCalls: 0,
    tavilyPipelineCalls: 0,
  };
}

function makePipelineOutput(batchId: string): IncrementalSearchOutput {
  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Educación',
      webSearchProvider: 'apollo_organizations',
      targetInternal: 10,
      existingBatchId: batchId,
      triggeredByUserId: USER_ID,
      ownerId: USER_ID,
      dryRun: false,
    },
    candidates: [],
    candidatesCount: 0,
    usefulCandidatesCount: 3,
    candidatesCreated: 3,
    metadata: {
      rounds_executed: 1,
      stopped_reason: 'min_useful_reached',
      total_raw_evaluated: 5,
      total_candidates_accumulated: 3,
      useful_candidates_count: 3,
      min_useful_candidates: 3,
      target_internal: 10,
      max_rounds: 1,
      max_total_raw_to_evaluate: 25,
      dry_run: false,
      rounds: [],
    },
    warnings: [],
    batchId,
  } as unknown as IncrementalSearchOutput;
}

/**
 * Doble de deps para UNA corrida. `provider` fija qué rama del wizard corre.
 * Por defecto: el preflight de Apollo está disponible y su cuota propia tiene
 * margen — cada prueba sobreescribe sólo lo que quiere ejercitar.
 */
function buildDeps(
  spy: Spy,
  provider: 'apollo_organizations' | 'tavily',
  overrides: Partial<WizardExecutionDeps> = {},
): WizardExecutionDeps {
  return {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => ({
      country: { code: 'CO', name: 'Colombia' },
      catalog: { version: VALID_REQUEST.catalogVersion },
      industry: { id: VALID_REQUEST.industryId, slug: 'educacion', name: 'Educación' },
      subindustries: [],
    }),
    checkTavilyAvailability: async () => true,
    checkApolloAvailability: async () => ({ available: true }),
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    // D/E — Tavily (y, por construcción compartida, Lusha en su propio flujo)
    // siguen usando exactamente esta reserva del pool del piloto.
    reserveBudget: async () => {
      spy.reserveBudgetCalls++;
      return { status: 'reserved', reservationId: 'wizard-pool-reservation-1', creditsReserved: 10 };
    },
    confirmBudget: async () => {
      spy.confirmBudgetCalls++;
      return { status: 'confirmed' };
    },
    releaseBudget: async () => {
      spy.releaseBudgetCalls++;
      return { status: 'released' };
    },
    // A/B/C — la puerta PROPIA de Apollo: cuota disponible por defecto.
    checkApolloProviderQuota: async (input) => {
      spy.checkApolloProviderQuotaCalls.push(input);
      return { status: 'available', providerCreditsAvailable: 50 };
    },
    readConsumedCredits: async () => 0,
    reserveSlot: async () => ({ status: 'reserved', batchId: BATCH_ID }),
    runTavilyPipeline: async () => {
      spy.tavilyPipelineCalls++;
      return makePipelineOutput(BATCH_ID);
    },
    runApolloPipeline: async () => {
      spy.apolloPipelineCalls++;
      return makePipelineOutput(BATCH_ID);
    },
    resolveProvider: () => provider,
    markBatchFailed: async () => undefined,
    ...overrides,
  };
}

before(() => {
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
});
after(() => {
  delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
});

describe('AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1', () => {
  it('A — Apollo con wizard_monthly_budget_periods AGOTADO + cuota propia DISPONIBLE ⇒ Apollo pasa la puerta', async () => {
    const spy = freshSpy();
    const deps = buildDeps(spy, 'apollo_organizations', {
      // Si Apollo tocara el pool del piloto, esto lo bloquearía.
      reserveBudget: async () => {
        spy.reserveBudgetCalls++;
        return {
          status: 'blocked',
          code: 'BUDGET_EXCEEDED',
          message: 'pool del piloto agotado',
        };
      },
      checkApolloProviderQuota: async (input) => {
        spy.checkApolloProviderQuotaCalls.push(input);
        return { status: 'available', providerCreditsAvailable: 42 };
      },
    });

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

    assert.equal(result.ok, true, 'la corrida Apollo debe tener éxito aunque el pool del piloto esté agotado');
    assert.equal(spy.reserveBudgetCalls, 0, 'Apollo nunca debe llamar a reserveBudget (wizard_monthly_budget_periods)');
    assert.equal(spy.checkApolloProviderQuotaCalls.length, 1);
    assert.equal(spy.apolloPipelineCalls, 1);
    assert.equal(spy.confirmBudgetCalls, 0, 'no existe reserva del piloto que confirmar');
    assert.equal(spy.releaseBudgetCalls, 0, 'no existe reserva del piloto que liberar');
  });

  it('B — Apollo con cuota propia AGOTADA (0 disponibles) ⇒ ejecución bloqueada, sin tocar el pool del piloto', async () => {
    const spy = freshSpy();
    const deps = buildDeps(spy, 'apollo_organizations', {
      checkApolloProviderQuota: async (input) => {
        spy.checkApolloProviderQuotaCalls.push(input);
        return { status: 'blocked', providerCreditsAvailable: 0 };
      },
    });

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'BUDGET_EXCEEDED');
      assert.equal(result.budgetExceeded?.reason, 'exhausted');
      assert.equal(result.budgetExceeded?.availableCredits, 0);
    }
    assert.equal(spy.reserveBudgetCalls, 0, 'ni siquiera se intenta reservar del pool del piloto');
    assert.equal(spy.apolloPipelineCalls, 0, 'sin cuota, Apollo nunca corre');
    assert.equal(spy.confirmBudgetCalls, 0);
    assert.equal(spy.releaseBudgetCalls, 0);
  });

  it('C — Apollo SIN budget_rule (cuota no configurada) ⇒ no se inventa ningún límite adicional', async () => {
    // El equivalente, a nivel de wizard, de "sin regla ⇒ allowed" que ya
    // documenta `checkBudget` en src/modules/budgets/budget-resolution.ts: la
    // ausencia de una regla de gasto (o de una cuota configurada en
    // tool_catalog) nunca inventa un tope. `checkProviderQuotaAvailable`
    // devuelve `providerCreditsAvailable: null` en ese caso (ver
    // budget-resolution.ts y su prueba pura dedicada); aquí se demuestra que
    // el wizard respeta ese "ilimitado" y dejar pasar la corrida.
    const spy = freshSpy();
    const deps = buildDeps(spy, 'apollo_organizations', {
      checkApolloProviderQuota: async (input) => {
        spy.checkApolloProviderQuotaCalls.push(input);
        return { status: 'available', providerCreditsAvailable: null };
      },
    });

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

    assert.equal(result.ok, true);
    assert.equal(spy.apolloPipelineCalls, 1);
    assert.equal(spy.reserveBudgetCalls, 0);
  });

  it('D — Tavily sigue reservando/confirmando contra wizard_monthly_budget_periods, sin cambios', async () => {
    const spy = freshSpy();
    const deps = buildDeps(spy, 'tavily');

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

    assert.equal(result.ok, true);
    assert.equal(spy.reserveBudgetCalls, 1, 'Tavily sigue reservando del pool del piloto');
    assert.equal(spy.confirmBudgetCalls, 1, 'Tavily sigue confirmando su reserva');
    assert.equal(spy.tavilyPipelineCalls, 1);
    assert.equal(spy.apolloPipelineCalls, 0);
    assert.equal(
      spy.checkApolloProviderQuotaCalls.length,
      0,
      'Tavily nunca consulta la cuota propia de Apollo',
    );
  });

  it('E — el wizard de empresas sigue sin ruta de ejecución para Lusha (PROVIDER_UNAVAILABLE, cero gasto), sin cambios', async () => {
    // La ruta de company-discovery del wizard nunca ejecutó Lusha (Agent2A /
    // contact-enrichment-toolkit son los que gobiernan el presupuesto de
    // Lusha, y ninguno de esos módulos fue tocado por este cambio). Lo único
    // que este archivo puede probar dentro de wizard-execution-actions.ts es
    // que ese fail-closed sigue exactamente igual: 0 reservas, 0 pipeline.
    const spy = freshSpy();
    const deps = buildDeps(spy, 'tavily', {
      resolveRunProviderSelection: () => ({
        requestedDiscoveryProvider: 'lusha_companies',
        resolvedDiscoveryProvider: 'lusha_companies',
        providerResolutionReason: 'run_level_override_authorized',
        isRunLevelOverride: true,
      }),
    });

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(spy.reserveBudgetCalls, 0);
    assert.equal(spy.checkApolloProviderQuotaCalls.length, 0);
    assert.equal(spy.apolloPipelineCalls, 0);
    assert.equal(spy.tavilyPipelineCalls, 0);
  });

  it('Apollo sin checkApolloProviderQuota inyectado ⇒ falla cerrado, cero gasto (misma disciplina que checkApolloAvailability ausente)', async () => {
    const spy = freshSpy();
    const deps = buildDeps(spy, 'apollo_organizations');
    delete (deps as Partial<WizardExecutionDeps>).checkApolloProviderQuota;

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(spy.apolloPipelineCalls, 0);
    assert.equal(spy.reserveBudgetCalls, 0);
  });
});
