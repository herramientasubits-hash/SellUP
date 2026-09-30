/**
 * AGENT1-TAVILY-TRIAL-1 — a través del punto de entrada real del wizard:
 * una corrida de prueba de Tavily NO abre la pierna de Lusha.
 *
 *   prueba ON + modo automático ON + admin pide tavily ⇒ corre Tavily, 0 Lusha
 *   prueba OFF (misma corrida Tavily)                 ⇒ la pierna se consulta
 *                                                        como siempre
 *   prueba ON pero se resolvió Apollo                  ⇒ la pierna se consulta
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import { resolveWizardRunProvider } from '../wizard-run-provider-selection';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

const BATCH_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = '123e4567-e89b-12d3-a456-426614174009';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';

const REQUEST_BASE = {
  clientRequestId: CLIENT_REQUEST_ID,
  countryCode: 'CO',
  industryId: INDUSTRY_ID,
  subindustryIds: [],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

const CATALOG_RESULT = {
  catalog: { version: 'v2024-01' },
  country: { code: 'CO', name: 'Colombia' },
  industry: { id: INDUSTRY_ID, slug: 'government', name: 'Gobierno' },
  subindustries: [],
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

type Trace = { tavily: number; apollo: number; lushaLeg: number };

function makeDeps(trace: Trace, resolved: 'tavily' | 'apollo_organizations'): WizardExecutionDeps {
  return {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG_RESULT,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true }) as const,
    reserveBudget: async () => ({ status: 'reserved', reservationId: 'res-001', creditsReserved: 20 }),
    checkApolloProviderQuota: async () => ({ status: 'available', providerCreditsAvailable: 999 }),
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 1,
    reserveSlot: async () => ({ status: 'reserved', batchId: BATCH_ID }),
    runTavilyPipeline: async () => {
      trace.tavily++;
      return pipelineOutput();
    },
    runApolloPipeline: async () => {
      trace.apollo++;
      return pipelineOutput();
    },
    resolveProvider: () => 'apollo_organizations',
    // El resolvedor real, con el resultado que la prueba necesita forzar.
    resolveRunProviderSelection: async ({ requestedProvider }) =>
      resolveWizardRunProvider({
        requestedProvider,
        authority: 'admin',
        runOverrideEnabled: resolved === 'tavily',
        globalDefaultProvider: 'apollo_organizations',
        enabledProviders: { tavily: true, apollo_organizations: true, lusha_companies: false },
      }),
    runLushaWaterfallLeg: async () => {
      trace.lushaLeg++;
      return { executed: false, reason: 'target_reached' };
    },
    markBatchFailed: async () => undefined,
  };
}

const ENV_KEYS = [
  'ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION',
  'ENABLE_AGENT1_AUTO_PROVIDER_CASCADE',
  'ENABLE_AGENT1_ADMIN_TAVILY_TRIAL',
];

describe('AGENT1-TAVILY-TRIAL-1 · la corrida de prueba no abre Lusha', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    process.env.ENABLE_AGENT1_AUTO_PROVIDER_CASCADE = 'true';
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('prueba ON + admin pide tavily ⇒ corre Tavily y la pierna de Lusha no se consulta', async () => {
    process.env.ENABLE_AGENT1_ADMIN_TAVILY_TRIAL = 'true';
    const trace: Trace = { tavily: 0, apollo: 0, lushaLeg: 0 };
    await executeProspectWizardGeneration(
      { ...REQUEST_BASE, requestedDiscoveryProvider: 'tavily' },
      makeDeps(trace, 'tavily'),
    );
    assert.equal(trace.tavily, 1);
    assert.equal(trace.apollo, 0);
    assert.equal(trace.lushaLeg, 0);
  });

  it('prueba OFF, misma corrida Tavily ⇒ la pierna se consulta como siempre', async () => {
    delete process.env.ENABLE_AGENT1_ADMIN_TAVILY_TRIAL;
    const trace: Trace = { tavily: 0, apollo: 0, lushaLeg: 0 };
    await executeProspectWizardGeneration(
      { ...REQUEST_BASE, requestedDiscoveryProvider: 'tavily' },
      makeDeps(trace, 'tavily'),
    );
    assert.equal(trace.tavily, 1);
    assert.equal(trace.lushaLeg, 1);
  });

  it('prueba ON pero sin petición (Apollo) ⇒ la pierna se consulta como siempre', async () => {
    process.env.ENABLE_AGENT1_ADMIN_TAVILY_TRIAL = 'true';
    const trace: Trace = { tavily: 0, apollo: 0, lushaLeg: 0 };
    await executeProspectWizardGeneration(REQUEST_BASE, makeDeps(trace, 'apollo_organizations'));
    assert.equal(trace.apollo, 1);
    assert.equal(trace.lushaLeg, 1);
  });
});
