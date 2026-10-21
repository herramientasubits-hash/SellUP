// AGENT2-AUDIT-FIXES-1 — frenos a Lusha y estados de las etapas gratuitas en el orquestador.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runAutomaticContactEnrichmentFallbackForRequest,
  type AutomaticRoutingOrchestratorDeps,
} from '../contact-enrichment-routing-orchestrator';
import type { ApolloEnrichmentRunResult } from '../apollo-enrichment-runner';
import type { LushaRunnerResult } from '../lusha-enrichment-runner';
import type { LocalReuseGateResultV1 } from '../local-reviewable-candidate-reuse-gate';
import {
  evaluateRecentFallbackZero,
  evaluateRecentFallbackZeroGate,
  resolveRecentZeroLookbackDays,
  type PriorFallbackRunRow,
} from '../recent-fallback-zero-gate';
import { CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION } from '@/modules/contact-enrichment-routing/routing-config.server';

const INPUT = { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: '2026-10-21T00:00:00.000Z' };

const apollo = (candidatesCreated: number): ApolloEnrichmentRunResult =>
  ({
    status: candidatesCreated > 0 ? 'ready_for_review' : 'completed',
    runStatus: candidatesCreated > 0 ? 'ready_for_review' : 'completed',
    candidatesCreated, duplicatesSkipped: 0, possibleDuplicates: 0, exactDuplicates: 0,
    rawResultsCount: candidatesCreated, normalizedCount: candidatesCreated, evaluatedCount: candidatesCreated,
    rejectedByRelevance: 0, noReviewableContactsFound: candidatesCreated === 0, existingPendingDuplicatesSkipped: 0,
    completionAttempted: 0, completionCompleted: 0, actionableContactsCount: candidatesCreated,
    noActionableContactsFound: false, providerStatus: 'success', estimatedCostUsd: 0, totalCandidates: candidatesCreated,
  }) as ApolloEnrichmentRunResult;

const REUSE_MISS = { hit: false, actionableReusableCandidateCount: 0, observability: {} } as unknown as LocalReuseGateResultV1;

function harness(over: Partial<AutomaticRoutingOrchestratorDeps>) {
  const calls = { apollo: 0, lusha: 0, attempt2: 0, evidence: [] as Record<string, unknown>[] };
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
    runApolloAttempt: async () => { calls.apollo += 1; return apollo(0); },
    runHubSpotFirst: async () => null,
    runContactBank: async () => null,
    runCompanySite: async () => null,
    evaluateLocalCandidateReuse: async () => REUSE_MISS,
    evaluateRecentFallbackZero: async () => ({ hit: false, lastZeroAt: null, lookbackDays: 30, lookupError: null }),
    isFallbackProviderAvailable: async () => true,
    createFallbackAttempt: async () => { calls.attempt2 += 1; return { status: 'created', attemptId: 'attempt-2', agentRunId: null } as never; },
    runLushaAttempt: async () => { calls.lusha += 1; return { status: 'success', candidatesCreated: 0 } as unknown as LushaRunnerResult; },
    writeRoutingTelemetry: async (_id, _cols, block) => { calls.evidence.push(block.evidence); },
    ...over,
  };
  return { deps, calls };
}

describe('Lusha no se repite donde ya dio cero', () => {
  it('última corrida de Lusha para la empresa en cero: no se crea intento 2 ni se paga', async () => {
    const { deps, calls } = harness({
      evaluateRecentFallbackZero: async () => ({ hit: true, lastZeroAt: '2026-10-14T10:00:00.000Z', lookbackDays: 30, lookupError: null }),
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'fallback_skipped_recent_zero');
    assert.equal(calls.lusha, 0);
    assert.equal(calls.attempt2, 0);
    assert.deepEqual(result.recentFallbackZero, { lastZeroAt: '2026-10-14T10:00:00.000Z', lookbackDays: 30 });
    assert.equal(calls.evidence.at(-1)?.blocked_reason, 'fallback_recent_zero');
  });

  it('sin acierto o si la compuerta falla: Lusha corre como siempre (falla abierto)', async () => {
    for (const gate of [
      async () => ({ hit: false, lastZeroAt: null, lookbackDays: 30, lookupError: null }),
      async () => { throw new Error('boom'); },
    ]) {
      const { deps, calls } = harness({ evaluateRecentFallbackZero: gate });
      const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
      assert.equal(result.outcome, 'fallback_executed');
      assert.equal(calls.lusha, 1);
    }
  });
});

describe('Lusha no corre si HubSpot o el banco ya dejaron gente en esta búsqueda', () => {
  it('HubSpot dejó 2 (sin bastar) y Apollo 0: no se paga Lusha', async () => {
    const { deps, calls } = harness({
      runHubSpotFirst: async () => ({ status: 'done', satisfied: false, inserted: 2, relevantWithEmail: 2 }),
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'fallback_skipped_free_stage_candidates');
    assert.equal(calls.lusha, 0);
    assert.equal(calls.attempt2, 0);
    // La señal de Apollo no se mezcla: su conteo sigue siendo el suyo.
    assert.equal(result.attempt1?.result.candidatesCreated, 0);
  });

  it('el banco dejó 1: tampoco se paga Lusha', async () => {
    const { deps, calls } = harness({
      runContactBank: async () => ({ status: 'done', satisfied: false, inserted: 1, relevantWithEmail: 1, siblingAccounts: 1 }),
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'fallback_skipped_free_stage_candidates');
    assert.equal(calls.lusha, 0);
  });

  it('el sitio web solo (sin correos) NO frena a Lusha', async () => {
    const { deps, calls } = harness({
      runCompanySite: async () => ({ status: 'done', inserted: 3, pagesRead: 2, peopleFound: 3 }),
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(calls.lusha, 1);
  });
});

describe('Estados de las etapas gratuitas', () => {
  it('se informan también cuando no aportan, y viajan en la telemetría', async () => {
    const { deps, calls } = harness({
      runHubSpotFirst: async () => ({ status: 'no_hubspot_company', satisfied: false, inserted: 0 }),
      runContactBank: async () => { throw new Error('boom'); },
      runCompanySite: async () => ({ status: 'site_unreachable', inserted: 0 }),
      evaluateRecentFallbackZero: async () => ({ hit: true, lastZeroAt: '2026-10-14T10:00:00.000Z', lookbackDays: 30, lookupError: null }),
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.deepEqual(result.freeStages, {
      hubspot_first: 'no_hubspot_company',
      contact_bank: 'error',
      company_site: 'site_unreachable',
    });
    assert.deepEqual(calls.evidence.at(-1)?.free_stages, result.freeStages);
  });

  it('bandera apagada = disabled; etapa no alcanzada = not_reached', async () => {
    const { deps } = harness({
      runHubSpotFirst: async () => ({ status: 'done', satisfied: true, inserted: 3, relevantWithEmail: 3 }),
      markRunSatisfiedByHubSpot: async () => {},
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'hubspot_first_satisfied');
    assert.deepEqual(result.freeStages, { hubspot_first: 'done', contact_bank: 'not_reached', company_site: 'not_reached' });

    const off = harness({});
    const offResult = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, off.deps);
    assert.deepEqual(offResult.freeStages, { hubspot_first: 'disabled', contact_bank: 'disabled', company_site: 'disabled' });
  });
});

describe('Cierre de corridas satisfechas por etapas gratuitas (código)', () => {
  const source = readFileSync(join(__dirname, '..', 'contact-enrichment-routing-orchestrator.ts'), 'utf8');
  const helper = source.slice(source.indexOf('async function markRunSatisfiedByFreeStage('), source.indexOf('async function defaultRunContactBank('));
  it('escribe el total, cierra agent_runs y revisa si se cerró algo', () => {
    assert.match(helper, /totalCandidates: inserted/);
    assert.match(helper, /updateAgentRunRecord\(agentRunId/);
    assert.match(helper, /\.select\('id'\)/);
  });
  it('HubSpot y banco pasan por el mismo cierre', () => {
    assert.equal(source.split('await markRunSatisfiedByFreeStage(').length - 1, 2);
  });
});

describe('recent-fallback-zero-gate — núcleo puro', () => {
  const NOW = Date.parse('2026-10-21T12:00:00.000Z');
  const row = (over: Partial<PriorFallbackRunRow>): PriorFallbackRunRow => ({
    id: 'r', request_id: 'req-old', created_at: '2026-10-14T12:00:00.000Z', status: 'ready_for_review',
    summary: { candidates_created: 0 }, ...over,
  });
  const args = { nowMs: NOW, lookbackDays: 30, currentRequestId: 'req-1' };

  it('la más reciente terminada en cero ⇒ acierto (aunque su estado diga ready_for_review)', () => {
    assert.deepEqual(evaluateRecentFallbackZero([row({})], args), { hit: true, lastZeroAt: '2026-10-14T12:00:00.000Z' });
  });
  it('si la más reciente encontró gente ⇒ sin acierto, aunque una anterior diera cero', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', created_at: '2026-10-18T12:00:00.000Z', summary: { candidates_created: 2 } })];
    assert.equal(evaluateRecentFallbackZero(rows, args).hit, false);
  });
  it('fuera de la ventana, en curso, de la misma solicitud o sin conteo ⇒ sin acierto', () => {
    assert.equal(evaluateRecentFallbackZero([row({ created_at: '2026-09-01T12:00:00.000Z' })], args).hit, false);
    assert.equal(evaluateRecentFallbackZero([row({ status: 'enriching' })], args).hit, false);
    assert.equal(evaluateRecentFallbackZero([row({ request_id: 'req-1' })], args).hit, false);
    assert.equal(evaluateRecentFallbackZero([row({ summary: {} })], args).hit, false);
  });
  it('usa totalCandidates cuando no hay candidates_created', () => {
    assert.equal(evaluateRecentFallbackZero([row({ summary: { totalCandidates: 0 } })], args).hit, true);
  });
  it('ventana 0 ⇒ apagada', () => {
    assert.equal(evaluateRecentFallbackZero([row({})], { ...args, lookbackDays: 0 }).hit, false);
  });
});

describe('recent-fallback-zero-gate — ventana y lectura', () => {
  it('ventana: 30 por defecto, 0 apaga, tope 180, inválido ⇒ 30', () => {
    assert.equal(resolveRecentZeroLookbackDays({}), 30);
    assert.equal(resolveRecentZeroLookbackDays({ CONTACT_ENRICHMENT_LUSHA_RECENT_ZERO_SKIP_DAYS: '0' }), 0);
    assert.equal(resolveRecentZeroLookbackDays({ CONTACT_ENRICHMENT_LUSHA_RECENT_ZERO_SKIP_DAYS: '999' }), 180);
    assert.equal(resolveRecentZeroLookbackDays({ CONTACT_ENRICHMENT_LUSHA_RECENT_ZERO_SKIP_DAYS: 'x' }), 30);
  });

  it('sin solicitud legible o con error de lectura ⇒ falla abierto', async () => {
    const noRequest = await evaluateRecentFallbackZeroGate(
      { requestId: 'req-1', provider: 'lusha' },
      { lookbackDays: () => 30, readRequestCompanyKeys: async () => ({ company: null, lookupError: 'request_not_found' }) },
    );
    assert.equal(noRequest.hit, false);
    assert.equal(noRequest.lookupError, 'request_not_found');

    const readError = await evaluateRecentFallbackZeroGate(
      { requestId: 'req-1', provider: 'lusha' },
      {
        lookbackDays: () => 30,
        readRequestCompanyKeys: async () => ({ company: { accountId: 'acc', hubspotCompanyId: null, companyDomain: 'x.com' }, lookupError: null }),
        readPriorRuns: async () => ({ rows: [], lookupError: 'db down' }),
      },
    );
    assert.equal(readError.hit, false);
  });

  it('lee por ficha y dominio de la solicitud y decide con el núcleo', async () => {
    let asked: unknown = null;
    const result = await evaluateRecentFallbackZeroGate(
      { requestId: 'req-1', provider: 'lusha' },
      {
        nowMs: () => Date.parse('2026-10-21T12:00:00.000Z'),
        lookbackDays: () => 30,
        readRequestCompanyKeys: async () => ({ company: { accountId: 'acc', hubspotCompanyId: null, companyDomain: 'almagro.com.ec' }, lookupError: null }),
        readPriorRuns: async (a) => {
          asked = a;
          return { rows: [{ id: 'r', request_id: 'old', created_at: '2026-10-20T22:20:36.000Z', status: 'ready_for_review', summary: { candidates_created: 0 } }], lookupError: null };
        },
      },
    );
    assert.equal(result.hit, true);
    assert.deepEqual(asked, { provider: 'lusha', accountId: 'acc', companyDomain: 'almagro.com.ec', sinceIso: '2026-09-21T12:00:00.000Z' });
  });
});
