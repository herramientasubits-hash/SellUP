// AGENT2-HUBSPOT-FIRST-WHY-ZERO-1 — por qué «Primero HubSpot» no usó contactos (Grupo LALA, 21-10).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runHubSpotFirstStage, type HubSpotFirstStageDeps } from '../hubspot-first-stage.server';
import type { ExistingContactSnapshot, ExistingContactsSnapshotResult } from '@/modules/contact-enrichment/types';
import { buildAutomaticRoutingMessage, explainHubSpotFirstZero } from '@/components/contact-enrichment/contact-enrichment-chat-reducer';
import type { AutomaticRoutingUiDiagnosis, AutomaticRoutingUiResult } from '@/components/contact-enrichment/contact-enrichment-chat-types';

const person = (id: string, over: Partial<ExistingContactSnapshot> = {}): ExistingContactSnapshot => ({
  id,
  source: 'hubspot',
  fullName: `Persona ${id}`,
  email: `${id}@lala.com.mx`,
  title: 'Gerente de Recursos Humanos',
  completeness: { hasEmail: true, hasPhone: false, hasLinkedin: false },
  ...over,
});

function snapshot(hubspot: ExistingContactSnapshot[], sellup: ExistingContactSnapshot[] = []): ExistingContactsSnapshotResult {
  return {
    sellup: { status: 'success', contacts: sellup, count: sellup.length },
    hubspot: { status: 'success', contacts: hubspot, count: hubspot.length },
    combined: {} as ExistingContactsSnapshotResult['combined'],
  };
}

describe('Primero HubSpot — desglose de descartes', () => {
  it('cuenta por dueño, cargo, ya en SellUp y sin nombre', async () => {
    const deps: HubSpotFirstStageDeps = {
      loadRunRef: async () => ({ accountId: 'acc', hubspotCompanyId: 'hs' }),
      readSnapshot: async () =>
        snapshot(
          [
            person('a', { ownerId: 'otro' } as Partial<ExistingContactSnapshot>),
            person('b', { ownerId: 'otro' } as Partial<ExistingContactSnapshot>),
            person('c', { title: 'Contador' }),
            person('d', { email: 'yaesta@lala.com.mx' }),
            person('e', { fullName: 'HubSpot Contact e' }),
          ],
          [person('x', { source: 'sellup', email: 'yaesta@lala.com.mx' })],
        ),
      loadRunHubspotCandidates: async () => [],
      loadPendingHubspotIdsElsewhere: async () => new Set(),
      insertRows: async () => ({}),
      resolveOwnership: async () => ({
        sellerOwnerId: 'yo',
        directory: { activeIds: new Set(['yo', 'otro']), deactivatedIds: new Set(), poolIds: new Set() },
      }),
    };
    const result = await runHubSpotFirstStage({ attemptId: 'r', triggeredBy: 'u' }, deps);
    assert.equal(result.status, 'done');
    assert.equal(result.status === 'done' && result.inserted, 0);
    assert.deepEqual(result.status === 'done' && result.breakdown, {
      hubspotContacts: 5, otherSeller: 2, knownInSellUp: 1, notRelevant: 1, noName: 1, alreadyInRun: 0, alreadyPending: 0, ownerUnverified: 0,
    });
  });
});

const diag = (hubspotFirst: AutomaticRoutingUiDiagnosis['hubspotFirst']): AutomaticRoutingUiDiagnosis => ({
  apolloSkipped: false, apolloOrganization: 'found_by_domain', apolloPeopleFound: 5, apolloRejected: 0, apolloAlreadyKnown: 0,
  freeStages: { hubspotFirst: 'done', contactBank: 'done', companySite: 'not_reached' },
  lushaRecentZeroAt: null, lushaRan: false, hubspotFirst,
});

describe('Primero HubSpot — el chat explica el cero', () => {
  it('arma la frase con lo que haya', () => {
    assert.equal(
      explainHubSpotFirstZero(diag({ hubspotContacts: 100, otherSeller: 70, notRelevant: 25, knownInSellUp: 3, noName: 2 })),
      '\n\nHubSpot tiene 100 contactos de esta empresa y no usé ninguno: 70 son de otro vendedor, 25 no son de RR. HH., formación o dirección, 3 ya están en SellUp y 2 no tienen nombre.',
    );
    assert.equal(
      explainHubSpotFirstZero(diag({ hubspotContacts: 1, otherSeller: 1, notRelevant: 0, knownInSellUp: 0, noName: 0 })),
      '\n\nHubSpot tiene 1 contacto de esta empresa y no usé ninguno: 1 es de otro vendedor.',
    );
  });

  it('nada que decir sin HubSpot o sin contactos ahí', () => {
    assert.equal(explainHubSpotFirstZero(diag(null)), '');
    assert.equal(explainHubSpotFirstZero(diag({ hubspotContacts: 0, otherSeller: 0, notRelevant: 0, knownInSellUp: 0, noName: 0 })), '');
  });

  it('va también cuando Apollo sí encontró gente (caso LALA)', () => {
    const result: AutomaticRoutingUiResult = {
      success: true, status: 'no_fallback_needed', automaticRoutingEnabled: true, fallbackExecuted: false,
      attempt1AttemptId: 'a1', attempt2AttemptId: null, blockedReason: null, reusedExistingCandidates: 0,
      providerCandidatesCreated: { apollo: 5, lusha: null }, failedProviders: [], hubspotFirstCandidates: 0,
      diagnosis: diag({ hubspotContacts: 100, otherSeller: 97, notRelevant: 0, knownInSellUp: 3, noName: 0 }),
    };
    const { content } = buildAutomaticRoutingMessage(result);
    // AGENT2A-COMPANY-SEARCH-COUNTS: el porqué va en la línea de HubSpot del resumen.
    assert.match(content, /^Terminé la búsqueda:/);
    assert.match(content, /De HubSpot: ninguno nuevo \(3 ya en SellUp y 97 de otro vendedor\)\./);
    assert.match(content, /De otras fuentes: 5 contactos nuevos en «Por revisar» \(5 de Apollo\)\./);
  });
});

describe('Primero HubSpot — el desglose viaja en el resultado y la telemetría', () => {
  it('orquestador', async () => {
    const { runAutomaticContactEnrichmentFallbackForRequest } = await import('../contact-enrichment-routing-orchestrator');
    const { CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION } = await import(
      '@/modules/contact-enrichment-routing/routing-config.server'
    );
    const evidence: Record<string, unknown>[] = [];
    const breakdown = { hubspotContacts: 100, otherSeller: 97, knownInSellUp: 3, notRelevant: 0, noName: 0, alreadyInRun: 0, alreadyPending: 0, ownerUnverified: 0 };
    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req', triggeredBy: 'u', evaluatedAt: '2026-10-21T00:00:00.000Z' },
      {
        getConfig: () => ({
          automaticRoutingEnabled: true, mode: 'automatic', primaryProvider: 'apollo', fallbackProvider: 'lusha',
          maxAttempts: 2, enabledFallbackReasons: ['zero_reviewable_candidates'], firstRolloutReason: 'zero_reviewable_candidates',
          providerErrorFallbackEnabled: false, zeroReviewableFallbackEnabled: true, budgetGuardrailEnabled: false,
          perRequestMaxEstimatedCostUsd: null, allowManualProviderSelection: true, requireHumanReview: true,
          allowHubSpotAutoWrite: false, allowPhoneReveal: false, policyVersion: CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION,
        }),
        assertEnvironmentSafe: () => {},
        resolveAttempt1: async () => ({ outcome: 'execute', attemptId: 'a1' }),
        runHubSpotFirst: async () => ({ status: 'done', satisfied: false, inserted: 0, relevantWithEmail: 0, breakdown }),
        runContactBank: async () => null,
        runCompanySite: async () => null,
        runApolloAttempt: async () =>
          ({
            status: 'ready_for_review', runStatus: 'ready_for_review', candidatesCreated: 5, duplicatesSkipped: 0,
            possibleDuplicates: 0, exactDuplicates: 0, rawResultsCount: 5, normalizedCount: 5, evaluatedCount: 5,
            rejectedByRelevance: 0, noReviewableContactsFound: false, existingPendingDuplicatesSkipped: 0,
            completionAttempted: 5, completionCompleted: 5, actionableContactsCount: 5, noActionableContactsFound: false,
            providerStatus: 'success', estimatedCostUsd: 0, totalCandidates: 5,
          }) as never,
        writeRoutingTelemetry: async (_id, _c, block) => { evidence.push(block.evidence); },
      },
    );
    assert.deepEqual(result.hubspotFirstBreakdown, breakdown);
    assert.deepEqual(evidence.at(-1)?.hubspot_first_breakdown, breakdown);
  });
});

describe('Primero HubSpot — la etapa pasa la ficha al resolver dueños', () => {
  it('resolveOwnership recibe el account_id de la corrida', async () => {
    let seen: unknown = 'no-call';
    await runHubSpotFirstStage(
      { attemptId: 'r', triggeredBy: 'leader' },
      {
        loadRunRef: async () => ({ accountId: 'acc-lala', hubspotCompanyId: 'hs' }),
        readSnapshot: async () => snapshot([person('a', { ownerId: 'brcastro-hs' } as Partial<ExistingContactSnapshot>)]),
        loadRunHubspotCandidates: async () => [],
        insertRows: async () => ({}),
        resolveOwnership: async (_by, accountId) => {
          seen = accountId;
          return { sellerOwnerId: 'leader-hs', accountOwnerId: 'brcastro-hs', directory: null };
        },
      },
    ).then((result) => {
      assert.equal(result.status === 'done' && result.inserted, 1);
    });
    assert.equal(seen, 'acc-lala');
  });
});
