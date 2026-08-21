/**
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 6, § 11 y § 14 (casos 4 y 5).
 *
 * La garantía que se prueba aquí es de ORDEN, no de helper: con la persistencia
 * no disponible, `executeProspectWizardGeneration` —la MISMA función que corre
 * en producción— no reserva presupuesto, no reserva lote, no llama a ningún
 * proveedor, no registra uso y no invoca al writer.
 *
 * Es exactamente lo que LIVE-QA-2 no tenía: allí la corrida reservó 12 créditos,
 * los gastó, Apollo devolvió una empresa elegible y el INSERT murió porque
 * `prospect_candidates.identity_key` no existía en Producción.
 *
 * Offline: sin Supabase, sin Apollo, sin Tavily, sin créditos.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeProspectWizardGeneration,
  type WizardExecutionDeps,
} from '../wizard-execution-actions';
import type { PersistenceReadinessProbe } from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';
import { IDENTITY_KEY_UNAVAILABLE_ERROR_CODE } from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';
import {
  probeProspectCandidatePersistenceReadiness,
  type PersistenceReadinessDbClient,
} from '../wizard-persistence-readiness-deps';

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
  readinessCalls: number;
  reserveBudgetCalls: number;
  reserveSlotCalls: number;
  apolloPipelineCalls: number;
  tavilyPipelineCalls: number;
  confirmBudgetCalls: number;
  releaseBudgetCalls: number;
  markBatchFailedCalls: number;
  /**
   * El writer se invoca DENTRO del pipeline en producción; aquí se cuenta a
   * través del doble del pipeline, que es la única vía por la que podría
   * llegarse a escribir.
   */
  writerCalls: number;
};

function freshSpy(): Spy {
  return {
    readinessCalls: 0,
    reserveBudgetCalls: 0,
    reserveSlotCalls: 0,
    apolloPipelineCalls: 0,
    tavilyPipelineCalls: 0,
    confirmBudgetCalls: 0,
    releaseBudgetCalls: 0,
    markBatchFailedCalls: 0,
    writerCalls: 0,
  };
}

function buildDeps(
  spy: Spy,
  probe: PersistenceReadinessProbe | (() => Promise<PersistenceReadinessProbe>),
  overrides: Partial<WizardExecutionDeps> = {},
): WizardExecutionDeps {
  return {
    getActiveUserId: async () => 'user_1',
    resolveCatalog: async () => ({
      country: { code: 'CO', name: 'Colombia' },
      catalog: { version: VALID_REQUEST.catalogVersion },
      industry: { id: VALID_REQUEST.industryId, slug: 'retail', name: 'Retail' },
      subindustries: [],
    }),
    checkTavilyAvailability: async () => true,
    checkApolloAvailability: async () => ({ available: true }) as never,
    checkPersistenceReadiness: async () => {
      spy.readinessCalls++;
      return typeof probe === 'function' ? probe() : probe;
    },
    reserveBudget: async () => {
      spy.reserveBudgetCalls++;
      return { status: 'reserved', reservationId: 'res_1', creditsReserved: 12 };
    },
    confirmBudget: async () => {
      spy.confirmBudgetCalls++;
      return { status: 'confirmed' } as never;
    },
    releaseBudget: async () => {
      spy.releaseBudgetCalls++;
      return { status: 'released' } as never;
    },
    readConsumedCredits: async () => 0,
    reserveSlot: async () => {
      spy.reserveSlotCalls++;
      return { status: 'reserved', batchId: 'batch_1' };
    },
    runTavilyPipeline: async () => {
      spy.tavilyPipelineCalls++;
      spy.writerCalls++;
      return { batchId: 'batch_1', candidatesCreated: 0 } as never;
    },
    runApolloPipeline: async () => {
      spy.apolloPipelineCalls++;
      spy.writerCalls++;
      return { batchId: 'batch_1', candidatesCreated: 0 } as never;
    },
    resolveProvider: () => 'tavily',
    markBatchFailed: async () => {
      spy.markBatchFailedCalls++;
    },
    ...overrides,
  };
}

function assertNothingSpent(spy: Spy): void {
  assert.equal(spy.reserveBudgetCalls, 0, 'reservation calls = 0');
  assert.equal(spy.confirmBudgetCalls, 0, 'ninguna confirmación de créditos');
  assert.equal(spy.releaseBudgetCalls, 0, 'no hay nada que liberar: nada se reservó');
  assert.equal(spy.reserveSlotCalls, 0, 'no se reserva lote');
  assert.equal(spy.apolloPipelineCalls, 0, 'Apollo search calls = 0');
  assert.equal(spy.tavilyPipelineCalls, 0, 'ningún otro proveedor: no hay degradación silenciosa');
  assert.equal(spy.writerCalls, 0, 'candidate writer calls = 0');
  assert.equal(spy.markBatchFailedCalls, 0, 'no hay lote que marcar como fallido');
}

before(() => {
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
});
after(() => {
  delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
});

describe('§ 14.4 y § 14.5 — el preflight bloquea ANTES de reservar y ANTES del proveedor', () => {
  const blockingProbes: { label: string; probe: PersistenceReadinessProbe; retryable: boolean; reason: string }[] = [
    {
      label: 'identity_key ausente',
      probe: { status: 'identity_key_missing' },
      retryable: false,
      reason: 'identity_key_missing',
    },
    {
      label: 'sonda no verificable',
      probe: { status: 'probe_failed' },
      retryable: true,
      reason: 'probe_failed',
    },
  ];

  for (const { label, probe, retryable, reason } of blockingProbes) {
    it(`«${label}»: 0 reserva, 0 proveedores, 0 créditos, 0 escrituras`, async () => {
      const spy = freshSpy();
      const result = await executeProspectWizardGeneration(VALID_REQUEST, buildDeps(spy, probe));

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, 'PERSISTENCE_NOT_READY');
      assert.equal(result.retryable, retryable);
      assert.equal(result.persistenceNotReady?.errorCode, IDENTITY_KEY_UNAVAILABLE_ERROR_CODE);
      assert.equal(result.persistenceNotReady?.reason, reason);
      assert.equal(result.persistenceNotReady?.stage, 'schema_preflight');

      assert.equal(spy.readinessCalls, 1, 'el preflight corre exactamente una vez');
      assertNothingSpent(spy);
    });
  }

  it('el mensaje al operador no expone el error crudo de Postgres/PostgREST', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'identity_key_missing' }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.doesNotMatch(result.message, /PGRST/);
    assert.doesNotMatch(result.message, /schema cache/i);
    assert.doesNotMatch(result.message, /identity_key/);
    assert.doesNotMatch(result.message, /42703/);
    assert.match(result.message, /no est.{0,2} preparada para guardar/i);
  });

  it('una sonda que LANZA bloquea igual: fail-closed, no fail-open', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, async () => {
        throw new Error('connection reset');
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'PERSISTENCE_NOT_READY');
    assert.equal(result.persistenceNotReady?.reason, 'probe_failed');
    assertNothingSpent(spy);
  });

  it('bloquea igual con Apollo seleccionado: el control no es de un proveedor', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'identity_key_missing' }, {
        resolveProvider: () => 'apollo_organizations',
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'PERSISTENCE_NOT_READY');
    // § 10 — el rechazo reporta con qué proveedor se rechazó.
    assert.equal(result.runProvider?.resolved, 'apollo_organizations');
    assertNothingSpent(spy);
  });
});

// ─── La sonda REAL dentro de la acción REAL ───────────────────────────────────

describe('§ 1 — 42501 y respuestas malformadas, con la sonda real acoplada', () => {
  /**
   * Los casos de arriba inyectan un `PersistenceReadinessProbe` ya resuelto, así
   * que prueban el orden económico pero no el acoplamiento. Aquí la dependencia
   * es la sonda REAL leyendo de un cliente falso: si el contrato de la sonda se
   * relajara —volviendo a declarar disponible una respuesta que no lo es—, la
   * corrida llegaría al gasto y estas afirmaciones caerían.
   */
  function depsWithRealProbe(spy: Spy, response: unknown): WizardExecutionDeps {
    const client = {
      from: () => ({
        select: () => ({
          limit: async () => {
            spy.readinessCalls++;
            return response;
          },
        }),
      }),
    } as unknown as PersistenceReadinessDbClient;

    return buildDeps(spy, { status: 'available' }, {
      checkPersistenceReadiness: () => probeProspectCandidatePersistenceReadiness(client),
    });
  }

  it('42501 insufficient_privilege: probe_failed, retryable, y cero gasto de punta a punta', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      depsWithRealProbe(spy, {
        data: null,
        error: { code: '42501', message: 'permission denied for table prospect_candidates' },
      }),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'PERSISTENCE_NOT_READY');
    assert.equal(result.persistenceNotReady?.reason, 'probe_failed');
    assert.equal(result.persistenceNotReady?.errorCode, IDENTITY_KEY_UNAVAILABLE_ERROR_CODE);
    assert.equal(result.persistenceNotReady?.stage, 'schema_preflight');
    // Un permiso denegado puede arreglarse sin migración: es recuperable.
    assert.equal(result.retryable, true);
    // Y el motivo NO es la columna ausente: aplicar la migración no lo arreglaría.
    assert.notEqual(result.persistenceNotReady?.reason, 'identity_key_missing');

    assert.equal(spy.readinessCalls, 1, 'la sonda real corre exactamente una vez');
    assertNothingSpent(spy);
    assert.doesNotMatch(result.message, /permission denied/i);
    assert.doesNotMatch(result.message, /42501/);
  });

  const malformed: { label: string; response: unknown }[] = [
    { label: 'respuesta {}', response: {} },
    { label: 'respuesta sin data', response: { error: null } },
    { label: 'data null', response: { data: null, error: null } },
    { label: 'data no array', response: { data: {}, error: null } },
    { label: 'respuesta undefined', response: undefined },
    { label: 'respuesta null', response: null },
  ];

  for (const { label, response } of malformed) {
    it(`${label}: bloquea con 0 reserva, 0 proveedores, 0 créditos`, async () => {
      const spy = freshSpy();
      const result = await executeProspectWizardGeneration(
        VALID_REQUEST,
        depsWithRealProbe(spy, response),
      );

      assert.equal(result.ok, false, `${label} no puede autorizar la corrida`);
      if (result.ok) return;
      assert.equal(result.code, 'PERSISTENCE_NOT_READY');
      assert.equal(result.persistenceNotReady?.reason, 'probe_failed');
      assertNothingSpent(spy);
    });
  }

  it('la respuesta bien formada de una tabla vacía SÍ deja correr: no se bloquea de más', async () => {
    // La otra mitad del fail-closed: si bloqueara todo, sería inútil. Una base
    // recién migrada y sin filas es exactamente el estado que debe desbloquear.
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      depsWithRealProbe(spy, { data: [], error: null }),
    );
    assert.equal(result.ok, true);
    assert.equal(spy.reserveBudgetCalls, 1);
  });
});

describe('§ 6 — con el esquema listo la corrida sigue su camino de siempre', () => {
  it('la readiness disponible no cambia nada: reserva, lote y pipeline corren', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'available' }),
    );

    assert.equal(result.ok, true);
    assert.equal(spy.readinessCalls, 1);
    assert.equal(spy.reserveBudgetCalls, 1);
    assert.equal(spy.reserveSlotCalls, 1);
    assert.equal(spy.tavilyPipelineCalls, 1);
  });

  it('el preflight corre ANTES de la reserva, no después', async () => {
    const order: string[] = [];
    const spy = freshSpy();
    await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, async () => {
        order.push('readiness');
        return { status: 'available' };
      }, {
        reserveBudget: async () => {
          order.push('reserveBudget');
          return { status: 'reserved', reservationId: 'res_1', creditsReserved: 12 };
        },
        runTavilyPipeline: async () => {
          order.push('pipeline');
          return { batchId: 'batch_1', candidatesCreated: 0 } as never;
        },
      }),
    );
    assert.deepEqual(order, ['readiness', 'reserveBudget', 'pipeline']);
  });
});
