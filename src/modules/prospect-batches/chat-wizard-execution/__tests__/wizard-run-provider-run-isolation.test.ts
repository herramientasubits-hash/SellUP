/**
 * wizard-run-provider-run-isolation.test.ts — aislamiento por corrida, estabilidad
 * del reintento y persistencia de la selección.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 8, § 9, § 10 y § 26 · casos 16, 17, 18, 26.
 *
 * Lo que se demuestra, atravesando `executeProspectWizardGeneration`:
 *
 *   dos corridas simultáneas          → no comparten proveedor, lote ni reserva
 *   reintento del mismo clientRequestId → conserva su proveedor original
 *   corrida nueva                     → NO hereda Apollo
 *   kill switch apagado entre intentos → 0 Apollo, 0 Tavily, 0 reserva
 *   toda corrida                      → requested/resolved/reason en el lote
 *
 * Todo offline: deps inyectadas, sin Supabase, sin Apollo, sin Tavily.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import {
  resolveWizardRunProvider,
  RUN_PROVIDER_SELECTION_METADATA_KEY,
  type WizardRunProviderSelection,
} from '../wizard-run-provider-selection';
import {
  readPreviousAttemptDiscoveryProvider,
  type PreviousAttemptProviderDbClient,
  type WizardExecutionReservationInput,
} from '../wizard-idempotency';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

const USER_ID = '123e4567-e89b-12d3-a456-426614174009';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const CLIENT_REQUEST_A = '423e4567-e89b-12d3-a456-42661417400a';
const CLIENT_REQUEST_B = '423e4567-e89b-12d3-a456-42661417400b';
const BATCH_A = '523e4567-e89b-12d3-a456-42661417400a';
const BATCH_B = '523e4567-e89b-12d3-a456-42661417400b';

function request(clientRequestId: string, requestedDiscoveryProvider?: string) {
  return {
    clientRequestId,
    countryCode: 'CO',
    industryId: INDUSTRY_ID,
    subindustryIds: [SUBINDUSTRY_ID],
    catalogVersion: 'v2024-01',
    additionalCriteriaRaw: null,
    ...(requestedDiscoveryProvider !== undefined ? { requestedDiscoveryProvider } : {}),
  };
}

const CATALOG_RESULT = {
  catalog: { version: 'v2024-01' },
  country: { code: 'CO', name: 'Colombia' },
  industry: { id: INDUSTRY_ID, slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [
    { id: SUBINDUSTRY_ID, slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] },
  ],
};

function pipelineOutput(batchId: string): IncrementalSearchOutput {
  return {
    input: {} as IncrementalSearchOutput['input'],
    candidates: [],
    candidatesCount: 0,
    usefulCandidatesCount: 0,
    candidatesCreated: 1,
    metadata: {} as IncrementalSearchOutput['metadata'],
    warnings: [],
    batchId,
  };
}

/** Todo lo que una corrida tocó. Una instancia por corrida — nunca compartida. */
type RunTrace = {
  tavily: number;
  apollo: number;
  batchIdsPipelined: string[];
  reservedCredits: number[];
  reservationClientRequestIds: string[];
  slotPayloads: WizardExecutionReservationInput['initialBatchPayload'][];
  apolloExtraMetadata: Record<string, unknown> | null;
};

function emptyTrace(): RunTrace {
  return {
    tavily: 0,
    apollo: 0,
    batchIdsPipelined: [],
    reservedCredits: [],
    reservationClientRequestIds: [],
    slotPayloads: [],
    apolloExtraMetadata: null,
  };
}

type RunOptions = {
  batchId: string;
  isAdmin: boolean;
  overrideEnabled: boolean;
  apolloEnabled: boolean;
  /** Elección registrada por un intento anterior de la MISMA corrida. */
  previousAttemptProvider?: string | null;
  slotStatus?: 'reserved' | 'already_reserved';
};

/**
 * Resolutor equivalente al de producción: la autoridad se deriva del rol resuelto
 * server-side, jamás del payload, y el proveedor del intento anterior llega por la
 * dep de lectura.
 */
function buildSelectionResolver(
  options: RunOptions,
): (input: {
  requestedProvider?: string;
  previousAttemptProvider?: string | null;
}) => WizardRunProviderSelection {
  return ({ requestedProvider, previousAttemptProvider }) =>
    resolveWizardRunProvider({
      requestedProvider,
      authority: requestedProvider !== undefined && options.isAdmin ? 'admin' : null,
      runOverrideEnabled: options.overrideEnabled,
      globalDefaultProvider: 'tavily',
      previousAttemptProvider:
        previousAttemptProvider === 'tavily' ||
        previousAttemptProvider === 'apollo_organizations' ||
        previousAttemptProvider === 'lusha_companies'
          ? previousAttemptProvider
          : null,
      enabledProviders: {
        tavily: true,
        apollo_organizations: options.apolloEnabled,
        lusha_companies: false,
      },
    });
}

function makeDeps(trace: RunTrace, options: RunOptions): WizardExecutionDeps {
  return {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG_RESULT,
    checkTavilyAvailability: async () => true,
    checkApolloAvailability: async () => ({ available: true }) as const,
    reserveBudget: async ({ clientRequestId, requestedCredits }) => {
      trace.reservedCredits.push(requestedCredits);
      trace.reservationClientRequestIds.push(clientRequestId);
      return {
        status: 'reserved',
        reservationId: `res-${options.batchId}`,
        creditsReserved: requestedCredits,
      };
    },
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 1,
    reserveSlot: async (input) => {
      trace.slotPayloads.push(input.initialBatchPayload);
      return { status: options.slotStatus ?? 'reserved', batchId: options.batchId };
    },
    runTavilyPipeline: async ({ reservedBatchId }) => {
      trace.tavily++;
      trace.batchIdsPipelined.push(reservedBatchId);
      return pipelineOutput(reservedBatchId);
    },
    runApolloPipeline: async (input) => {
      trace.apollo++;
      trace.batchIdsPipelined.push(input.reservedBatchId);
      trace.apolloExtraMetadata = (input.extraBatchMetadata ?? null) as Record<
        string,
        unknown
      > | null;
      return pipelineOutput(input.reservedBatchId);
    },
    resolveProvider: () => 'tavily',
    resolveRunProviderSelection: buildSelectionResolver(options),
    readPreviousAttemptProvider: async () => options.previousAttemptProvider ?? null,
    markBatchFailed: async () => undefined,
  };
}

/** Lee la selección tal como quedaría en el metadata del lote (§ 26). */
function persistedSelection(trace: RunTrace): Record<string, unknown> | undefined {
  const payload = trace.slotPayloads[0];
  return payload?.runProviderSelection as unknown as Record<string, unknown> | undefined;
}

describe('A1-APOLLO-QA-CONTROL-SURFACE-1 · aislamiento y reintento', () => {
  let savedExecutionFlag: string | undefined;
  beforeEach(() => {
    savedExecutionFlag = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  });
  afterEach(() => {
    if (savedExecutionFlag !== undefined) {
      process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = savedExecutionFlag;
    } else {
      delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  it('caso 16 — dos corridas SIMULTÁNEAS no comparten nada', async () => {
    const traceA = emptyTrace();
    const traceB = emptyTrace();

    const optionsA: RunOptions = {
      batchId: BATCH_A,
      isAdmin: true,
      overrideEnabled: true,
      apolloEnabled: true,
    };
    const optionsB: RunOptions = { ...optionsA, batchId: BATCH_B };

    // Se lanzan de verdad en paralelo: si algún estado fuera compartido (módulo,
    // Set, variable de nivel superior), el intercalado lo destaparía.
    const [resultA, resultB] = await Promise.all([
      executeProspectWizardGeneration(
        request(CLIENT_REQUEST_A, 'apollo_organizations'),
        makeDeps(traceA, optionsA),
      ),
      // La corrida B no pide proveedor: mismo entorno, misma autoridad.
      executeProspectWizardGeneration(request(CLIENT_REQUEST_B), makeDeps(traceB, optionsB)),
    ]);

    assert.equal(resultA.ok, true);
    assert.equal(resultB.ok, true);

    // Proveedor resuelto: A Apollo, B Tavily.
    assert.equal(resultA.ok && resultA.runProvider?.resolved, 'apollo_organizations');
    assert.equal(resultA.ok && resultA.runProvider?.isRunLevelOverride, true);
    assert.equal(resultB.ok && resultB.runProvider?.resolved, 'tavily');
    assert.equal(resultB.ok && resultB.runProvider?.isRunLevelOverride, false);
    assert.equal(resultB.ok && resultB.runProvider?.requested, null);

    // Ejecución: cada corrida corrió su proveedor y sólo el suyo.
    assert.equal(traceA.apollo, 1);
    assert.equal(traceA.tavily, 0);
    assert.equal(traceB.tavily, 1);
    assert.equal(traceB.apollo, 0, 'la corrida sin override NUNCA toca Apollo');

    // Lote, reserva y clave de idempotencia: disjuntos.
    assert.deepEqual(traceA.batchIdsPipelined, [BATCH_A]);
    assert.deepEqual(traceB.batchIdsPipelined, [BATCH_B]);
    assert.deepEqual(traceA.reservationClientRequestIds, [CLIENT_REQUEST_A]);
    assert.deepEqual(traceB.reservationClientRequestIds, [CLIENT_REQUEST_B]);

    // La reserva de cada corrida corresponde a SU proveedor: reservar para Tavily
    // y ejecutar Apollo es exactamente el descuadre que este orden evita.
    assert.notDeepEqual(traceA.reservedCredits, traceB.reservedCredits);

    // Metadata del lote: cada uno con su propia selección.
    assert.equal(
      persistedSelection(traceA)?.['resolved_discovery_provider'],
      'apollo_organizations',
    );
    assert.equal(persistedSelection(traceB)?.['resolved_discovery_provider'], 'tavily');
  });

  it('caso 17 — un reintento conserva el proveedor de la corrida original', async () => {
    const trace = emptyTrace();

    // El navegador perdió la selección: la solicitud llega SIN proveedor pedido.
    const result = await executeProspectWizardGeneration(
      request(CLIENT_REQUEST_A),
      makeDeps(trace, {
        batchId: BATCH_A,
        isAdmin: true,
        overrideEnabled: true,
        apolloEnabled: true,
        previousAttemptProvider: 'apollo_organizations',
      }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.runProvider?.resolved, 'apollo_organizations');
    assert.equal(
      result.ok && result.runProvider?.reason,
      'preserved_from_previous_attempt',
      'el reintento no vuelve a leer el selector del navegador',
    );
    assert.equal(trace.apollo, 1);
    assert.equal(trace.tavily, 0, 'un reintento NUNCA se degrada a Tavily por su cuenta');
  });

  it('caso 18 — una corrida NUEVA no hereda Apollo', async () => {
    const trace = emptyTrace();

    // Sin intento anterior para ESTE clientRequestId: la corrida arranca limpia.
    const result = await executeProspectWizardGeneration(
      request(CLIENT_REQUEST_B),
      makeDeps(trace, {
        batchId: BATCH_B,
        isAdmin: true,
        overrideEnabled: true,
        apolloEnabled: true,
        previousAttemptProvider: null,
      }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.runProvider?.resolved, 'tavily');
    assert.equal(result.ok && result.runProvider?.reason, 'global_default_provider');
    assert.equal(trace.apollo, 0);
    assert.equal(trace.tavily, 1);
  });

  it('§ 9 — kill switch apagado entre intentos: 0 Apollo, 0 Tavily, 0 reserva', async () => {
    const trace = emptyTrace();

    const result = await executeProspectWizardGeneration(
      request(CLIENT_REQUEST_A),
      makeDeps(trace, {
        batchId: BATCH_A,
        isAdmin: true,
        overrideEnabled: true,
        // El proveedor de la corrida quedó apagado después del primer intento.
        apolloEnabled: false,
        previousAttemptProvider: 'apollo_organizations',
      }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(
      result.ok === false && result.runProvider?.reason,
      'previous_attempt_provider_disabled_fail_closed',
    );
    assert.equal(trace.apollo, 0, 'no se repite la llamada a Apollo');
    assert.equal(
      trace.tavily,
      0,
      'cambiar de proveedor NO es un mecanismo de recuperación',
    );
    assert.equal(trace.reservedCredits.length, 0, 'sin reserva');
    assert.equal(trace.slotPayloads.length, 0, 'sin lote');
  });

  it('§ 7 — el kill switch manda sobre admin + override en una petición nueva', async () => {
    const trace = emptyTrace();
    const result = await executeProspectWizardGeneration(
      request(CLIENT_REQUEST_A, 'apollo_organizations'),
      makeDeps(trace, {
        batchId: BATCH_A,
        isAdmin: true,
        overrideEnabled: true,
        apolloEnabled: false,
      }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.runProvider?.resolved, 'tavily');
    assert.equal(
      result.ok && result.runProvider?.reason,
      'requested_provider_disabled_by_kill_switch',
    );
    assert.equal(trace.apollo, 0);
  });
});

describe('§ 26 · la selección queda en el metadata del lote, para TODO proveedor', () => {
  let savedExecutionFlag: string | undefined;
  beforeEach(() => {
    savedExecutionFlag = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  });
  afterEach(() => {
    if (savedExecutionFlag !== undefined) {
      process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = savedExecutionFlag;
    } else {
      delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  it('una corrida Tavily con petición explícita conserva requested/resolved/reason', async () => {
    // El hueco que esto cierra: la costura `extraBatchMetadata` sólo existe en la
    // ruta de Apollo, así que antes una corrida Tavily con petición no dejaba
    // rastro de que se había pedido otra cosa.
    const trace = emptyTrace();
    await executeProspectWizardGeneration(
      request(CLIENT_REQUEST_A, 'apollo_organizations'),
      makeDeps(trace, {
        batchId: BATCH_A,
        isAdmin: false, // sin autoridad ⇒ degrada a Tavily
        overrideEnabled: true,
        apolloEnabled: true,
      }),
    );

    const selection = persistedSelection(trace);
    assert.equal(selection?.['requested_discovery_provider'], 'apollo_organizations');
    assert.equal(selection?.['resolved_discovery_provider'], 'tavily');
    assert.equal(selection?.['provider_resolution_reason'], 'requested_provider_not_authorized');
    assert.equal(selection?.['is_run_level_override'], false);
  });

  it('una corrida Apollo la conserva en el INSERT inicial y en su metadata', async () => {
    const trace = emptyTrace();
    await executeProspectWizardGeneration(
      request(CLIENT_REQUEST_A, 'apollo_organizations'),
      makeDeps(trace, {
        batchId: BATCH_A,
        isAdmin: true,
        overrideEnabled: true,
        apolloEnabled: true,
      }),
    );

    assert.equal(
      persistedSelection(trace)?.['resolved_discovery_provider'],
      'apollo_organizations',
    );
    const viaApolloSeam = trace.apolloExtraMetadata?.[
      RUN_PROVIDER_SELECTION_METADATA_KEY
    ] as Record<string, unknown> | undefined;
    assert.equal(viaApolloSeam?.['resolved_discovery_provider'], 'apollo_organizations');
  });

  it('una corrida sin petición la conserva con requested = null', async () => {
    const trace = emptyTrace();
    await executeProspectWizardGeneration(
      request(CLIENT_REQUEST_B),
      makeDeps(trace, {
        batchId: BATCH_B,
        isAdmin: true,
        overrideEnabled: false,
        apolloEnabled: true,
      }),
    );

    const selection = persistedSelection(trace);
    assert.equal(selection?.['requested_discovery_provider'], null);
    assert.equal(selection?.['resolved_discovery_provider'], 'tavily');
    assert.equal(selection?.['provider_resolution_reason'], 'global_default_provider');
  });
});

// ─── Lectura del intento anterior (§ 9) ───────────────────────────────────────

function fakeDb(row: { metadata: unknown } | null, error?: { code?: string }): PreviousAttemptProviderDbClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: error ?? null }),
          }),
        }),
      }),
    }),
  };
}

describe('§ 9 · readPreviousAttemptDiscoveryProvider', () => {
  const key = { userId: USER_ID, clientRequestId: CLIENT_REQUEST_A };

  it('devuelve el proveedor resuelto que quedó en el metadata', async () => {
    const db = fakeDb({
      metadata: {
        [RUN_PROVIDER_SELECTION_METADATA_KEY]: {
          resolved_discovery_provider: 'apollo_organizations',
        },
      },
    });
    assert.equal(await readPreviousAttemptDiscoveryProvider(key, db), 'apollo_organizations');
  });

  it('null cuando no hay fila: una corrida nueva no tiene intento anterior', async () => {
    assert.equal(await readPreviousAttemptDiscoveryProvider(key, fakeDb(null)), null);
  });

  it('null ante un error de lectura, sin lanzar', async () => {
    const db = fakeDb(null, { code: '42P01' });
    assert.equal(await readPreviousAttemptDiscoveryProvider(key, db), null);
  });

  it('null ante metadata de forma inesperada', async () => {
    for (const metadata of [null, 'texto', 7, [], {}, { run_provider_selection: 'x' }]) {
      assert.equal(await readPreviousAttemptDiscoveryProvider(key, fakeDb({ metadata })), null);
    }
  });

  it('null cuando el proveedor guardado no es una cadena', async () => {
    const db = fakeDb({
      metadata: {
        [RUN_PROVIDER_SELECTION_METADATA_KEY]: { resolved_discovery_provider: 42 },
      },
    });
    assert.equal(await readPreviousAttemptDiscoveryProvider(key, db), null);
  });

  it('nunca lanza: un cliente que explota degrada a null', async () => {
    const exploding = {
      from: () => {
        throw new Error('boom');
      },
    } as unknown as PreviousAttemptProviderDbClient;
    assert.equal(await readPreviousAttemptDiscoveryProvider(key, exploding), null);
  });
});
