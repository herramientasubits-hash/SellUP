/**
 * A1-APOLLO-WIZARD-1 — El preflight de Apollo corre ANTES de reservar nada.
 *
 * La garantía que se prueba aquí: con Apollo seleccionado y no disponible, la
 * ejecución no reserva presupuesto, no reserva lote y no invoca el pipeline.
 * Antes de este hito, una credencial ausente llegaba hasta el provider y, por
 * la reconciliación conservadora, consumía cupo del piloto sin haber llamado
 * nunca a Apollo.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration, type WizardExecutionDeps } from '../wizard-execution-actions';
import type { WizardApolloSkipReason } from '../wizard-apollo-availability';

const CLIENT_REQUEST_ID = '11111111-1111-4111-8111-111111111111';

const VALID_REQUEST = {
  countryCode: 'CO',
  industryId: '22222222-2222-4222-8222-222222222222',
  subindustryIds: [],
  additionalCriteriaRaw: null,
  catalogVersion: '33333333-3333-4333-8333-333333333333',
  clientRequestId: CLIENT_REQUEST_ID,
};

type Spy = {
  reserveBudgetCalls: number;
  reserveSlotCalls: number;
  apolloPipelineCalls: number;
  tavilyPipelineCalls: number;
};

function buildDeps(
  spy: Spy,
  overrides: Partial<WizardExecutionDeps> = {},
): WizardExecutionDeps {
  return {
    getActiveUserId: async () => 'user_1',
    resolveCatalog: async () => ({
      country: { code: 'CO', name: 'Colombia' },
      catalog: { version: VALID_REQUEST.catalogVersion },
      industry: { id: VALID_REQUEST.industryId, slug: 'educacion', name: 'Educación' },
      subindustries: [],
    }),
    checkTavilyAvailability: async () => true,
    // A1-APOLLO-PERSISTENCE-READINESS-4 § 6 — el esquema está listo: este doble
    // no ejercita el preflight de persistencia.
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    reserveBudget: async () => {
      spy.reserveBudgetCalls++;
      return { status: 'reserved', reservationId: 'res_1', creditsReserved: 3 };
    },
    confirmBudget: async () => ({ status: 'confirmed' }) as never,
    releaseBudget: async () => ({ status: 'released' }) as never,
    readConsumedCredits: async () => 0,
    reserveSlot: async () => {
      spy.reserveSlotCalls++;
      return { status: 'reserved', batchId: 'batch_1' };
    },
    runTavilyPipeline: async () => {
      spy.tavilyPipelineCalls++;
      return { batchId: 'batch_1', candidatesCreated: 0 } as never;
    },
    runApolloPipeline: async () => {
      spy.apolloPipelineCalls++;
      return { batchId: 'batch_1', candidatesCreated: 0 } as never;
    },
    resolveProvider: () => 'apollo_organizations',
    markBatchFailed: async () => undefined,
    ...overrides,
  };
}

function freshSpy(): Spy {
  return { reserveBudgetCalls: 0, reserveSlotCalls: 0, apolloPipelineCalls: 0, tavilyPipelineCalls: 0 };
}

before(() => { process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true'; });
after(() => { delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION; });

describe('A1-APOLLO-WIZARD-1 · preflight antes de cualquier reserva', () => {
  const skipReasons: WizardApolloSkipReason[] = [
    'feature_disabled',
    'capability_unavailable',
    'role_not_permitted',
    'budget_unavailable',
    'provider_not_configured',
    'credential_unavailable',
    'availability_check_failed',
  ];

  for (const skipReason of skipReasons) {
    it(`«${skipReason}» no reserva presupuesto, ni lote, ni ejecuta el pipeline`, async () => {
      const spy = freshSpy();
      const result = await executeProspectWizardGeneration(
        VALID_REQUEST,
        buildDeps(spy, { checkApolloAvailability: async () => ({ available: false, skipReason }) }),
      );

      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(
        result.ok === false && result.providerSkipped?.skipReason,
        skipReason,
      );
      assert.equal(
        result.ok === false && result.providerSkipped?.provider,
        'apollo_organizations',
      );

      assert.equal(spy.reserveBudgetCalls, 0, 'no debe tocar el presupuesto del piloto');
      assert.equal(spy.reserveSlotCalls, 0, 'no debe reservar lote');
      assert.equal(spy.apolloPipelineCalls, 0, 'no debe llamar a Apollo');
      assert.equal(spy.tavilyPipelineCalls, 0, 'no debe desviarse a otro proveedor');
    });
  }

  it('sin dep de disponibilidad falla cerrado, sin reservar nada', async () => {
    const spy = freshSpy();
    const deps = buildDeps(spy);
    delete deps.checkApolloAvailability;

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

    assert.equal(result.ok === false && result.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(
      result.ok === false && result.providerSkipped?.skipReason,
      'availability_check_failed',
    );
    assert.equal(spy.reserveBudgetCalls, 0);
    assert.equal(spy.reserveSlotCalls, 0);
  });

  it('un proveedor no disponible nunca cae a la ruta legacy ni a Tavily', async () => {
    const spy = freshSpy();
    await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, {
        checkApolloAvailability: async () => ({ available: false, skipReason: 'feature_disabled' }),
      }),
    );
    assert.equal(spy.tavilyPipelineCalls, 0);
    assert.equal(spy.apolloPipelineCalls, 0);
  });

  it('con Apollo disponible la ejecución continúa con normalidad', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { checkApolloAvailability: async () => ({ available: true }) }),
    );

    assert.equal(result.ok, true);
    assert.equal(spy.reserveBudgetCalls, 1);
    assert.equal(spy.reserveSlotCalls, 1);
    assert.equal(spy.apolloPipelineCalls, 1);
    assert.equal(spy.tavilyPipelineCalls, 0);
  });

  it('el preflight de Apollo no se ejecuta cuando el proveedor es Tavily', async () => {
    const spy = freshSpy();
    let apolloPreflightRan = false;

    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, {
        resolveProvider: () => 'tavily',
        checkApolloAvailability: async () => {
          apolloPreflightRan = true;
          return { available: false, skipReason: 'feature_disabled' };
        },
      }),
    );

    assert.equal(apolloPreflightRan, false, 'Tavily no debe pasar por el preflight de Apollo');
    assert.equal(result.ok, true);
    assert.equal(spy.tavilyPipelineCalls, 1);
    assert.equal(spy.apolloPipelineCalls, 0);
  });

  it('los motivos no accionables no se marcan como reintentables', async () => {
    for (const skipReason of ['feature_disabled', 'role_not_permitted', 'credential_unavailable'] as const) {
      const result = await executeProspectWizardGeneration(
        VALID_REQUEST,
        buildDeps(freshSpy(), {
          checkApolloAvailability: async () => ({ available: false, skipReason }),
        }),
      );
      assert.equal(result.ok === false && result.retryable, false, `${skipReason} no es reintentable`);
    }
  });
});
