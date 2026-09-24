/**
 * AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — el mago entrega a la continuación
 * los MISMOS hechos de aceptación con los que resuelve su propio writer.
 *
 * La suite del recorrido demuestra que la continuación reconstruye el resolutor
 * a partir de los hechos. Ésta cierra la otra mitad: que el mago, por el camino
 * real de `executeProspectWizardGeneration`, los pone en la política que viaja
 * con el trabajo, y que esos hechos —pasados por JSON, como hace la cola—
 * producen byte por byte lo que su resolutor en proceso produce.
 *
 * I/O simulado. 0 proveedores reales · 0 créditos · 0 red · 0 Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-apollo-executor';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { ResolveExtraBatchMetadata } from '@/server/agents/prospecting-toolkit/writer-metadata-resolution';
import {
  restoreContinuationRunInput,
  type ApolloContinuationRunPolicy,
} from '@/server/agents/prospecting-toolkit/apollo-two-round/continuation-worker';
import { ACCEPTED_FOR_TARGET_METADATA_KEY } from '@/modules/prospect-batches/accepted-for-target';

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;
const USER_ID = '123e4567-e89b-12d3-a456-426614174019';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174011';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174012';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174013';
const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-426614174014';
const CLIENT = {} as unknown as SupabaseClient;

const REQUEST = {
  clientRequestId: CLIENT_REQUEST_ID,
  countryCode: 'CO',
  industryId: INDUSTRY_ID,
  subindustryIds: [SUBINDUSTRY_ID],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

const CATALOG: CatalogResolutionOutput = {
  catalog: { version: 'v2024-01' },
  country: { code: 'CO', name: 'Colombia' },
  industry: { id: INDUSTRY_ID, slug: 'health-pharma', name: 'Salud / Farma' },
  subindustries: [
    { id: SUBINDUSTRY_ID, slug: 'clinicas', name: 'Clínicas', applicableCountries: ['CO'] },
  ],
};

function emptyFreeLayer(): PrePaidNoveltyDiscoveryDeps {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: 0,
      macroConfirmed: 0,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: 0,
      failed: false,
      failureCode: null,
    },
  });
  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('apollo', {}),
    providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: [],
    telemetry: {},
  };
  return {
    runGate: async () => gateResult,
    persist: async () => ({ batchId: null, writtenCount: 0, skippedCount: 0, failed: true }),
  };
}

type CapturedApolloInput = {
  continuationRunPolicy?: ApolloContinuationRunPolicy;
  resolveExtraBatchMetadata?: ResolveExtraBatchMetadata | null;
};

async function captureApolloInput(): Promise<CapturedApolloInput> {
  let captured: CapturedApolloInput | null = null;
  const free = emptyFreeLayer();
  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    resolveProvider: () => 'apollo_organizations',
    runPrePaidNoveltyDiscovery: (input) =>
      runPrePaidNoveltyDiscovery(
        CLIENT,
        {
          provider: 'apollo',
          countryCode: input.countryCode,
          countryName: input.countryName,
          macroIndustryKey: input.macroIndustryKey,
          requestedTarget: input.requestedTarget,
          requestedByUserId: input.requestedByUserId,
          resolveBatchId: input.resolveBatchId,
          partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
        },
        free,
      ),
    reserveBudget: async () => ({ status: 'reserved' as const, reservationId: 'res-1', creditsReserved: 3 }),
    checkApolloProviderQuota: async () => ({ status: 'available' as const, providerCreditsAvailable: 999 }),
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    reserveSlot: async () => ({ status: 'reserved', batchId: CANONICAL_BATCH_ID }),
    sealFreeOnlyBatchStatus: async () => undefined,
    runTavilyPipeline: async ({ reservedBatchId }) =>
      ({ batchId: reservedBatchId, candidatesCreated: 0 } as unknown as IncrementalSearchOutput),
    runApolloPipeline: async (input) => {
      captured = input as unknown as CapturedApolloInput;
      return {
        batchId: input.reservedBatchId,
        candidatesCreated: 0,
        targetPersistibleCandidates: TARGET,
        targetReached: false,
      } as unknown as IncrementalSearchOutput;
    },
    markBatchFailed: async () => undefined,
  };

  const saved = {
    execution: process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION,
    apollo: process.env.ENABLE_APOLLO_COMPANY_SEARCH,
  };
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  try {
    await executeProspectWizardGeneration(REQUEST, deps);
  } finally {
    if (saved.execution === undefined) delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    else process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved.execution;
    if (saved.apollo === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    else process.env.ENABLE_APOLLO_COMPANY_SEARCH = saved.apollo;
  }
  assert.ok(captured, 'la corrida llegó a la ruta de Apollo');
  return captured;
}

const WRITER_OUTCOMES = [
  { completeValidCandidates: null, persistedCandidates: 0, reviewOnlyCandidates: null },
  { completeValidCandidates: null, persistedCandidates: 2, reviewOnlyCandidates: null },
  { completeValidCandidates: 0, persistedCandidates: 2, reviewOnlyCandidates: 2 },
  { completeValidCandidates: 3, persistedCandidates: 5, reviewOnlyCandidates: 2 },
] as const;

describe('AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — el mago → la cola → la continuación', () => {
  it('la política que viaja con el trabajo lleva los hechos de aceptación', async () => {
    const input = await captureApolloInput();
    const facts = input.continuationRunPolicy?.acceptanceFacts;
    assert.ok(facts, '🔴 sin hechos, una corrida pausada termina sin `accepted_for_target`');
    assert.equal(facts.demand.requestedTarget, TARGET);
    assert.equal(facts.freePersistedCandidates, 0, 'la capa gratuita de esta corrida no aportó');
  });

  it('🔴 paridad: los hechos, tras pasar por JSON, reproducen EXACTAMENTE el resolutor del mago', async () => {
    const input = await captureApolloInput();
    assert.equal(typeof input.resolveExtraBatchMetadata, 'function');

    // Lo que la cola guarda y el worker lee: el payload pasado por JSON.
    const stored = JSON.parse(
      JSON.stringify({ run_input: input, run_policy: input.continuationRunPolicy }),
    );
    const restored = restoreContinuationRunInput<CapturedApolloInput>(stored);
    assert.ok(restored?.acceptanceRestored, 'la continuación reconstruye la aceptación');

    for (const outcome of WRITER_OUTCOMES) {
      const fromContinuation = restored.runInput.resolveExtraBatchMetadata!(outcome);
      const fromWizard = input.resolveExtraBatchMetadata!(outcome);
      assert.deepEqual(fromContinuation, fromWizard, JSON.stringify(outcome));
      assert.ok(fromContinuation && ACCEPTED_FOR_TARGET_METADATA_KEY in fromContinuation);
    }
  });
});
