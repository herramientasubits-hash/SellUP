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
  const calls = { apollo: 0, lusha: 0, marked: 0, bankMarked: 0, bank: 0, telemetry: 0 };
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
    writeRoutingTelemetry: async () => { calls.telemetry += 1; },
    ...over,
  };
  return { deps, calls };
}

describe('Banco de contactos — orquestador', () => {
  const bank = (satisfied: boolean, inserted: number) => async () => ({
    status: 'done' as const, satisfied, inserted, relevantWithEmail: satisfied ? 3 : inserted, siblingAccounts: 1,
  });

  it('bandera apagada (la etapa devuelve null): Apollo corre y no hay rastro del banco', async () => {
    const { deps, calls } = harness({ runContactBank: async () => null });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'no_fallback_needed');
    assert.equal(calls.apollo, 1);
    assert.equal(result.contactBank, undefined);
  });

  it('el banco bastó: no se llama a Apollo ni a Lusha y la corrida pasa a revisión', async () => {
    const { deps, calls } = harness({ runContactBank: bank(true, 3) });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'contact_bank_satisfied');
    assert.equal(calls.apollo, 0);
    assert.equal(calls.lusha, 0);
    assert.equal(calls.bankMarked, 1);
    assert.equal(calls.telemetry, 1);
    assert.deepEqual(result.contactBank, { attemptId: 'attempt-1', inserted: 3, satisfied: true });
  });

  it('el banco trajo algo pero no bastó: Apollo corre y el resultado conserva lo del banco', async () => {
    const { deps, calls } = harness({ runContactBank: bank(false, 1) });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(calls.apollo, 1);
    assert.equal(calls.bankMarked, 0);
    assert.deepEqual(result.contactBank, { attemptId: 'attempt-1', inserted: 1, satisfied: false });
  });

  it('HubSpot bastó: el banco ni se consulta', async () => {
    const { deps, calls } = harness({
      runHubSpotFirst: async () => ({ status: 'done', satisfied: true, inserted: 3, relevantWithEmail: 3 }),
      runContactBank: async () => { calls.bank += 1; return null; },
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'hubspot_first_satisfied');
    assert.equal(calls.bank, 0);
  });

  it('HubSpot no bastó pero sumado al banco sí: no se gasta y quedan los dos rastros', async () => {
    const { deps, calls } = harness({
      runHubSpotFirst: async () => ({ status: 'done', satisfied: false, inserted: 2, relevantWithEmail: 2 }),
      runContactBank: bank(true, 1),
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'contact_bank_satisfied');
    assert.equal(calls.apollo, 0);
    assert.deepEqual(result.hubspotFirst, { attemptId: 'attempt-1', inserted: 2, satisfied: false });
    assert.deepEqual(result.contactBank, { attemptId: 'attempt-1', inserted: 1, satisfied: true });
  });

  it('falla abierto: si la etapa lanza o devuelve error, Apollo corre como siempre', async () => {
    for (const stage of [
      async () => { throw new Error('boom'); },
      async () => ({ status: 'error' as const, satisfied: false as const, inserted: 0 as const }),
    ]) {
      const { deps, calls } = harness({ runContactBank: stage });
      const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
      assert.equal(calls.apollo, 1);
      assert.equal(result.contactBank, undefined);
    }
  });
});
