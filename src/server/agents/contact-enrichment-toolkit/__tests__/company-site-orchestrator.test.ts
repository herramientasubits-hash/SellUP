import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runAutomaticContactEnrichmentFallbackForRequest,
  type AutomaticRoutingOrchestratorDeps,
} from '../contact-enrichment-routing-orchestrator';
import type { ApolloEnrichmentRunResult } from '../apollo-enrichment-runner';
import { CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION } from '@/modules/contact-enrichment-routing/routing-config.server';

const INPUT = { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: '2026-10-15T00:00:00.000Z' };

const apollo = (candidatesCreated: number): ApolloEnrichmentRunResult =>
  ({
    status: 'ready_for_review', runStatus: 'ready_for_review', candidatesCreated, duplicatesSkipped: 0,
    possibleDuplicates: 0, exactDuplicates: 0, rawResultsCount: candidatesCreated, normalizedCount: candidatesCreated,
    evaluatedCount: candidatesCreated, rejectedByRelevance: 0, noReviewableContactsFound: false,
    existingPendingDuplicatesSkipped: 0, completionAttempted: 0, completionCompleted: 0,
    actionableContactsCount: candidatesCreated, noActionableContactsFound: false, providerStatus: 'success',
    estimatedCostUsd: 0, totalCandidates: candidatesCreated,
  }) as ApolloEnrichmentRunResult;

function harness(over: Partial<AutomaticRoutingOrchestratorDeps>) {
  const calls = { apollo: 0, lusha: 0, marked: 0, bankMarked: 0, bank: 0, telemetry: 0, site: 0 };
  const deps: AutomaticRoutingOrchestratorDeps = {
    getConfig: () => ({
      automaticRoutingEnabled: true, mode: 'automatic', primaryProvider: 'apollo', fallbackProvider: 'lusha',
      maxAttempts: 2, enabledFallbackReasons: ['zero_reviewable_candidates'], firstRolloutReason: 'zero_reviewable_candidates',
      providerErrorFallbackEnabled: false, zeroReviewableFallbackEnabled: true, budgetGuardrailEnabled: false,
      perRequestMaxEstimatedCostUsd: null, allowManualProviderSelection: true, requireHumanReview: true,
      allowHubSpotAutoWrite: false, allowPhoneReveal: false, policyVersion: CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION,
    }),
    assertEnvironmentSafe: () => {},
    resolveAttempt1: async () => ({ outcome: 'execute', attemptId: 'attempt-1' }),
    runApolloAttempt: async () => { calls.apollo += 1; return apollo(2); },
    runLushaAttempt: async () => { calls.lusha += 1; throw new Error('Lusha no debe correr'); },
    markRunSatisfiedByHubSpot: async () => { calls.marked += 1; },
    markRunSatisfiedByContactBank: async () => { calls.bankMarked += 1; },
    runHubSpotFirst: async () => null,
    runContactBank: async () => null,
    isFallbackProviderAvailable: async () => false,
    writeRoutingTelemetry: async () => { calls.telemetry += 1; },
    ...over,
  };
  return { deps, calls };
}

describe('Sitio de la empresa — orquestador', () => {
  it('Apollo sin candidatos: se lee el sitio y el resultado lo cuenta', async () => {
    const { deps, calls } = harness({
      runApolloAttempt: async () => { calls.apollo += 1; return apollo(0); },
      runCompanySite: async () => { calls.site += 1; return { status: 'done', inserted: 2, pagesRead: 3, peopleFound: 2 }; },
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(calls.site, 1);
    assert.deepEqual(result.companySite, { attemptId: 'attempt-1', inserted: 2 });
    // La decisión de Lusha sigue siendo la de siempre: aquí no está disponible.
    assert.equal(result.outcome, 'fallback_provider_unavailable');
  });

  it('Apollo con candidatos: el sitio no se lee', async () => {
    const { deps, calls } = harness({ runCompanySite: async () => { calls.site += 1; return null; } });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(calls.site, 0);
    assert.equal(result.companySite, undefined);
  });

  it('bandera apagada o error: ni rastro del sitio y todo sigue igual', async () => {
    for (const stage of [async () => null, async () => { throw new Error('boom'); }]) {
      const { deps } = harness({ runApolloAttempt: async () => apollo(0), runCompanySite: stage });
      const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
      assert.equal(result.companySite, undefined);
      assert.equal(result.outcome, 'fallback_provider_unavailable');
    }
  });
});
