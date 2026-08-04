/**
 * wizard-run-provider-authority.test.ts — Routing POR CORRIDA, atravesando el
 * punto de entrada real del wizard.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FIX · § 3 y § 10 (casos 9, 10, 11).
 *
 * Lo que se demuestra aquí, contra `executeProspectWizardGeneration`:
 *
 *   admin autorizado + override ON + kill switch ON → Apollo SÓLO en esa corrida
 *   otra corrida simultánea sin petición             → proveedor global (Tavily)
 *   usuario sin autoridad                            → nunca obtiene Apollo
 *   kill switch OFF                                  → Apollo imposible
 *
 * La autoridad NUNCA viaja en el payload: el schema es `.strict()` y no admite
 * `isAdmin` ni `providerAuthorized`. Lo único que el cliente puede enviar es la
 * PETICIÓN; quién puede pedir lo decide el servidor.
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
import { wizardExecutionRequestSchema } from '../wizard-execution-schema';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

const BATCH_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = '123e4567-e89b-12d3-a456-426614174009';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';

const VALID_REQUEST = {
  clientRequestId: CLIENT_REQUEST_ID,
  countryCode: 'CO',
  industryId: INDUSTRY_ID,
  subindustryIds: [SUBINDUSTRY_ID],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

const CATALOG_RESULT = {
  catalog: { version: 'v2024-01' },
  country: { code: 'CO', name: 'Colombia' },
  industry: { id: INDUSTRY_ID, slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [{ id: SUBINDUSTRY_ID, slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] }],
};

function pipelineOutput(): IncrementalSearchOutput {
  return {
    input: {} as IncrementalSearchOutput['input'],
    candidates: [],
    candidatesCount: 0,
    usefulCandidatesCount: 0,
    candidatesCreated: 1,
    metadata: {} as IncrementalSearchOutput['metadata'],
    warnings: [],
    batchId: BATCH_ID,
  };
}

/**
 * Resolutor server-side equivalente al de producción: la autoridad se deriva de
 * un rol resuelto en el servidor, jamás de la petición.
 */
function buildSelectionResolver(options: {
  isAdmin: boolean;
  overrideEnabled: boolean;
  apolloEnabled: boolean;
  globalDefault?: 'tavily' | 'apollo_organizations';
}): (input: { requestedProvider?: string }) => WizardRunProviderSelection {
  return ({ requestedProvider }) =>
    resolveWizardRunProvider({
      requestedProvider,
      authority: requestedProvider !== undefined && options.isAdmin ? 'admin' : null,
      runOverrideEnabled: options.overrideEnabled,
      globalDefaultProvider: options.globalDefault ?? 'tavily',
      enabledProviders: {
        tavily: true,
        apollo_organizations: options.apolloEnabled,
        lusha_companies: false,
      },
    });
}

type Trace = { tavily: number; apollo: number; apolloMetadata: Record<string, unknown> | null };

function makeDeps(
  trace: Trace,
  selection: ReturnType<typeof buildSelectionResolver>,
): WizardExecutionDeps {
  return {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG_RESULT,
    checkTavilyAvailability: async () => true,
    // A1-APOLLO-PERSISTENCE-READINESS-4 § 6 — el esquema está listo: este doble
    // no ejercita el preflight de persistencia.
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true }) as const,
    reserveBudget: async () => ({
      status: 'reserved',
      reservationId: 'res-001',
      creditsReserved: 20,
    }),
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 1,
    reserveSlot: async () => ({ status: 'reserved', batchId: BATCH_ID }),
    runTavilyPipeline: async () => {
      trace.tavily++;
      return pipelineOutput();
    },
    runApolloPipeline: async (input) => {
      trace.apollo++;
      trace.apolloMetadata = (input.extraBatchMetadata ?? null) as Record<string, unknown> | null;
      return pipelineOutput();
    },
    resolveProvider: () => 'tavily',
    resolveRunProviderSelection: selection,
    markBatchFailed: async () => undefined,
  };
}

function emptyTrace(): Trace {
  return { tavily: 0, apollo: 0, apolloMetadata: null };
}

describe('§ 3 · autoridad del routing por corrida', () => {
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

  it('caso 9 — admin + override ON + kill switch ON: Apollo SÓLO en esa corrida', async () => {
    const trace = emptyTrace();
    const result = await executeProspectWizardGeneration(
      { ...VALID_REQUEST, requestedDiscoveryProvider: 'apollo_organizations' },
      makeDeps(
        trace,
        buildSelectionResolver({ isAdmin: true, overrideEnabled: true, apolloEnabled: true }),
      ),
    );

    assert.equal(result.ok, true);
    assert.equal(trace.apollo, 1);
    assert.equal(trace.tavily, 0);

    // Los tres campos del § 1 quedan en el metadata del lote.
    const selection = trace.apolloMetadata?.[RUN_PROVIDER_SELECTION_METADATA_KEY] as
      | Record<string, unknown>
      | undefined;
    assert.equal(selection?.['requested_discovery_provider'], 'apollo_organizations');
    assert.equal(selection?.['resolved_discovery_provider'], 'apollo_organizations');
    assert.equal(selection?.['provider_resolution_reason'], 'run_level_override_authorized');
    assert.equal(selection?.['is_run_level_override'], true);
  });

  it('caso 10 — una corrida simultánea sin petición sigue en el proveedor global', async () => {
    // Misma configuración de entorno que el caso 9: lo único que cambia es que
    // ESTA corrida no pide proveedor.
    const trace = emptyTrace();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      makeDeps(
        trace,
        buildSelectionResolver({ isAdmin: true, overrideEnabled: true, apolloEnabled: true }),
      ),
    );

    assert.equal(result.ok, true);
    assert.equal(trace.tavily, 1);
    assert.equal(trace.apollo, 0);
  });

  it('caso 11 — un usuario sin autoridad no puede seleccionar Apollo', async () => {
    const trace = emptyTrace();
    const result = await executeProspectWizardGeneration(
      { ...VALID_REQUEST, requestedDiscoveryProvider: 'apollo_organizations' },
      makeDeps(
        trace,
        buildSelectionResolver({ isAdmin: false, overrideEnabled: true, apolloEnabled: true }),
      ),
    );

    assert.equal(result.ok, true);
    assert.equal(trace.apollo, 0, 'un no-admin nunca obtiene Apollo');
    assert.equal(trace.tavily, 1, 'fail-closed a Tavily, nunca un proveedor pagado');
  });

  it('kill switch OFF: Apollo es imposible aunque lo pida un admin con override', async () => {
    const trace = emptyTrace();
    await executeProspectWizardGeneration(
      { ...VALID_REQUEST, requestedDiscoveryProvider: 'apollo_organizations' },
      makeDeps(
        trace,
        buildSelectionResolver({ isAdmin: true, overrideEnabled: true, apolloEnabled: false }),
      ),
    );

    assert.equal(trace.apollo, 0);
    assert.equal(trace.tavily, 1);
  });

  it('override OFF: la petición se ignora y manda el predeterminado global', async () => {
    const trace = emptyTrace();
    await executeProspectWizardGeneration(
      { ...VALID_REQUEST, requestedDiscoveryProvider: 'apollo_organizations' },
      makeDeps(
        trace,
        buildSelectionResolver({ isAdmin: true, overrideEnabled: false, apolloEnabled: true }),
      ),
    );

    assert.equal(trace.apollo, 0);
    assert.equal(trace.tavily, 1);
  });

  it('§ 9 — un proveedor sin ruta de ejecución falla explícito, sin reserva ni lote', async () => {
    const trace = emptyTrace();
    let budgetReserved = 0;
    let slotsReserved = 0;
    const deps = makeDeps(
      trace,
      buildSelectionResolver({ isAdmin: true, overrideEnabled: true, apolloEnabled: true }),
    );

    const result = await executeProspectWizardGeneration(
      { ...VALID_REQUEST, requestedDiscoveryProvider: 'lusha_companies' },
      {
        ...deps,
        reserveBudget: async (...args) => {
          budgetReserved++;
          return deps.reserveBudget(...args);
        },
        reserveSlot: async (...args) => {
          slotsReserved++;
          return deps.reserveSlot(...args);
        },
        resolveRunProviderSelection: () =>
          resolveWizardRunProvider({
            requestedProvider: 'lusha_companies',
            authority: 'admin',
            runOverrideEnabled: true,
            globalDefaultProvider: 'tavily',
            enabledProviders: {
              tavily: true,
              apollo_organizations: true,
              // Lusha jamás tiene ruta de ejecución en el wizard de empresas.
              lusha_companies: true,
            },
          }),
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(budgetReserved, 0, 'sin reserva de presupuesto');
    assert.equal(slotsReserved, 0, 'sin lote');
    assert.equal(trace.tavily, 0, 'nunca hay fallback silencioso a Tavily');
    assert.equal(trace.apollo, 0);
  });
});

describe('§ 3 · el cliente no puede fabricarse autoridad', () => {
  it('el schema rechaza campos de autorización enviados por el cliente', () => {
    const withFakeAuthority = wizardExecutionRequestSchema.safeParse({
      ...VALID_REQUEST,
      isAdmin: true,
      providerAuthorized: true,
      requestedDiscoveryProvider: 'apollo_organizations',
    });
    assert.equal(withFakeAuthority.success, false);
  });

  it('el schema rechaza un proveedor desconocido en vez de degradarlo en silencio', () => {
    const unknownProvider = wizardExecutionRequestSchema.safeParse({
      ...VALID_REQUEST,
      requestedDiscoveryProvider: 'clearbit',
    });
    assert.equal(unknownProvider.success, false);
  });

  it('la petición sola, sin autoridad, nunca resuelve a Apollo', () => {
    const selection = resolveWizardRunProvider({
      requestedProvider: 'apollo_organizations',
      authority: null,
      runOverrideEnabled: true,
      globalDefaultProvider: 'tavily',
      enabledProviders: { tavily: true, apollo_organizations: true },
    });
    assert.equal(selection.resolvedDiscoveryProvider, 'tavily');
    assert.equal(selection.providerResolutionReason, 'requested_provider_not_authorized');
  });
});
