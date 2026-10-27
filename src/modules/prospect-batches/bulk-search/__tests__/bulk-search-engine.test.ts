/**
 * Motor de la búsqueda masiva (GROWTH-BULK-SEARCH-1 · PR 2) con dependencias
 * falsas en memoria. Lo que se prueba es lo que protege el gasto y la cuenta:
 * el tope lo pone el servidor, nunca se lanza una ronda que no quepa, una pausa
 * gana, dos pestañas no lanzan la misma ronda y una ronda huérfana se cierra.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WizardExecutionActionResult } from '../../chat-wizard-execution/wizard-execution-types';
import {
  controlBulkSearch,
  createBulkSearch,
  runBulkSearchRound,
  streaksFromRounds,
  type BulkBudgetAvailability,
  type BulkSearchEngineDeps,
} from '../bulk-search-engine';
import { estimateBulkSearch } from '../bulk-search-estimate';
import type { BulkSearchRoundRow, BulkSearchRow } from '../bulk-search-view';

const USER = 'u-growth';
const PER_ROUND = { apollo: 12, lusha: 4, tavily: 20 };
const CRITERIA = {
  countryCode: 'CO',
  industryId: '11111111-1111-4111-8111-111111111111',
  subindustryIds: [],
  additionalCriteriaRaw: null,
  catalogVersion: 'v1',
};

type Fake = ReturnType<typeof fakeWorld>;

function fakeWorld(options: { budget?: Partial<BulkBudgetAvailability> } = {}) {
  let seq = 0;
  let nowMs = Date.parse('2026-10-27T15:00:00Z');
  const searches = new Map<string, BulkSearchRow>();
  const rounds: BulkSearchRoundRow[] = [];
  /** Candidatas revisables y créditos por lote. */
  const delivered = new Map<string, number>();
  const credits = new Map<string, number>();
  const batchByRequest = new Map<string, string>();
  const pendingContinuation = new Set<string>();
  const wizardCalls: Array<Record<string, unknown>> = [];
  let wizard = okRun(5, 16) as unknown as (request: Record<string, unknown>) => Promise<WizardExecutionActionResult>;

  /** Una corrida que crea su lote con N candidatas y C créditos. */
  function okRun(deliveredNew: number, spent: number) {
    return (async (request: Record<string, unknown>) => {
      const batchId = `b-${++seq}`;
      batchByRequest.set(String(request.clientRequestId), batchId);
      delivered.set(batchId, deliveredNew);
      credits.set(batchId, spent);
      return { ok: true, status: 'completed', batchId, batchStatus: 'ready_for_review', redirectPath: '/x' } as unknown as WizardExecutionActionResult;
    }) as unknown as WizardExecutionActionResult;
  }

  const deps: BulkSearchEngineDeps = {
    now: () => nowMs,
    newUuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    resolvePerRoundWorstCase: async () => PER_ROUND,
    readBudgetAvailability: async () => ({ apollo: null, tavily: null, lusha: null, ...options.budget }),
    findLiveSearch: async (userId) =>
      [...searches.values()].find((s) => s.created_by === userId && (s.status === 'running' || s.status === 'paused')) ?? null,
    insertSearch: async (row) => {
      const id = `s-${++seq}`;
      const search: BulkSearchRow = {
        id,
        created_by: row.createdBy,
        status: 'running',
        stop_reason: null,
        target_count: row.targetCount,
        request: row.request,
        credit_cap: row.creditCap,
        credit_cap_breakdown: row.creditCapBreakdown,
        credits_used: 0,
        delivered_count: 0,
        rounds_done: 0,
        max_rounds: row.maxRounds,
        consecutive_empty_rounds: 0,
        consecutive_failed_rounds: 0,
        lease_token: null,
        lease_expires_at: null,
        last_round_at: null,
        completed_at: null,
        created_at: new Date(nowMs).toISOString(),
      };
      searches.set(id, search);
      return search;
    },
    loadSearch: async (id, userId) => {
      const s = searches.get(id);
      return s && s.created_by === userId ? { ...s } : null;
    },
    claimSearch: async (id, userId, leaseSeconds) => {
      const s = searches.get(id);
      if (!s || s.created_by !== userId || s.status !== 'running') return null;
      if (s.lease_expires_at && Date.parse(s.lease_expires_at) > nowMs) return null;
      s.lease_token = `lease-${++seq}`;
      s.lease_expires_at = new Date(nowMs + leaseSeconds * 1000).toISOString();
      return { leaseToken: s.lease_token };
    },
    listRounds: async (id) => rounds.filter((r) => r.bulk_search_id === id).map((r) => ({ ...r })),
    insertRound: async ({ bulkSearchId, roundIndex, clientRequestId }) => {
      rounds.push({
        id: `r-${++seq}`,
        bulk_search_id: bulkSearchId,
        round_index: roundIndex,
        client_request_id: clientRequestId,
        batch_id: null,
        status: 'running',
        delivered_new: 0,
        credits_used: 0,
        outcome_code: null,
        started_at: new Date(nowMs).toISOString(),
        finished_at: null,
      });
    },
    finishRound: async (clientRequestId, patch) => {
      const r = rounds.find((round) => round.client_request_id === clientRequestId)!;
      Object.assign(r, {
        status: patch.status,
        batch_id: patch.batchId,
        delivered_new: patch.deliveredNew,
        credits_used: patch.creditsUsed,
        outcome_code: patch.outcomeCode,
        finished_at: new Date(nowMs).toISOString(),
      });
    },
    findBatchByClientRequestId: async (_userId, clientRequestId) => batchByRequest.get(clientRequestId) ?? null,
    countDelivered: async (ids) => ids.reduce((sum, id) => sum + (delivered.get(id) ?? 0), 0),
    sumPaidCredits: async (ids) => ids.reduce((sum, id) => sum + (credits.get(id) ?? 0), 0),
    hasPendingContinuation: async (batchId) => pendingContinuation.has(batchId),
    runWizard: async (request) => {
      wizardCalls.push(request);
      return wizard(request);
    },
    writeProgress: async (id, leaseToken, patch) => {
      const s = searches.get(id)!;
      if (s.lease_token !== leaseToken) return;
      Object.assign(s, {
        delivered_count: patch.deliveredCount,
        credits_used: patch.creditsUsed,
        rounds_done: patch.roundsDone,
        consecutive_empty_rounds: patch.consecutiveEmptyRounds,
        consecutive_failed_rounds: patch.consecutiveFailedRounds,
        ...(patch.lastRoundAt ? { last_round_at: patch.lastRoundAt } : {}),
      });
      if (patch.terminal && s.status === 'running') {
        s.status = patch.terminal.status;
        s.stop_reason = patch.terminal.stopReason;
      }
    },
    releaseLease: async (id, leaseToken) => {
      const s = searches.get(id)!;
      if (s.lease_token === leaseToken) {
        s.lease_token = null;
        s.lease_expires_at = null;
      }
    },
    applyControl: async (id, userId, from, to) => {
      const s = searches.get(id);
      if (!s || s.created_by !== userId || !from.includes(s.status)) return null;
      s.status = to.status;
      s.stop_reason = to.stopReason;
      return { ...s };
    },
    listSearches: async (userId) => [...searches.values()].filter((s) => s.created_by === userId),
  };

  return {
    deps,
    searches,
    rounds,
    delivered,
    credits,
    pendingContinuation,
    wizardCalls,
    okRun,
    setWizard: (fn: (request: Record<string, unknown>) => Promise<WizardExecutionActionResult>) => {
      wizard = fn;
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

const VALID_ID = '22222222-2222-4222-8222-222222222222';

function body(overrides: Record<string, unknown> = {}) {
  const estimate = estimateBulkSearch(25, PER_ROUND);
  return {
    criteria: CRITERIA,
    targetCount: 25,
    confirmedCreditCap: estimate.creditCap,
    clientRequestId: VALID_ID,
    label: 'Colombia · Tecnología',
    ...overrides,
  };
}

async function created(world: Fake, overrides: Record<string, unknown> = {}) {
  const result = await createBulkSearch(world.deps, USER, body(overrides));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.search.id : '';
}

function fail(code: string): WizardExecutionActionResult {
  return { ok: false, code, message: code, retryable: false } as unknown as WizardExecutionActionResult;
}

describe('crear', () => {
  it('guarda el tope del SERVIDOR, no el que manda la pantalla', async () => {
    const world = fakeWorld();
    const id = await created(world, { confirmedCreditCap: 9999 });
    assert.equal(Number(world.searches.get(id)!.credit_cap), estimateBulkSearch(25, PER_ROUND).creditCap);
  });

  it('si el tope confirmado no cubre el del servidor, pide volver a confirmar', async () => {
    const result = await createBulkSearch(fakeWorld().deps, USER, body({ confirmedCreditCap: 1 }));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, 'ESTIMATE_CHANGED');
  });

  it('una cantidad que no está en la pantalla se rechaza', async () => {
    for (const targetCount of [10, 30, 500]) {
      const result = await createBulkSearch(fakeWorld().deps, USER, body({ targetCount }));
      assert.equal(!result.ok && result.code, 'INVALID_REQUEST');
    }
  });

  it('solo «Empresas por criterios» y sin elegir proveedor', async () => {
    for (const criteria of [
      { ...CRITERIA, searchMode: 'suppliers', referenceCompanyName: 'Acme' },
      { ...CRITERIA, requestedDiscoveryProvider: 'apollo_organizations' },
      { ...CRITERIA, clientRequestId: VALID_ID },
      { ...CRITERIA, targetCount: 200 },
    ]) {
      const result = await createBulkSearch(fakeWorld().deps, USER, body({ criteria }));
      assert.equal(!result.ok && result.code, 'INVALID_REQUEST', JSON.stringify(criteria));
    }
  });

  it('un campo de más invalida la petición entera', async () => {
    const result = await createBulkSearch(fakeWorld().deps, USER, body({ creditCap: 50 }));
    assert.equal(!result.ok && result.code, 'INVALID_REQUEST');
  });

  it('si no cabe en el cupo del mes, no se crea', async () => {
    const result = await createBulkSearch(fakeWorld({ budget: { apollo: 10 } }).deps, USER, body());
    assert.equal(!result.ok && result.code, 'BULK_CAP_EXCEEDS_MONTHLY_BUDGET');
  });

  it('una sola viva por persona: la segunda devuelve la que ya existe', async () => {
    const world = fakeWorld();
    const id = await created(world);
    const second = await createBulkSearch(world.deps, USER, body());
    assert.equal(!second.ok && second.code, 'BULK_SEARCH_ALREADY_LIVE');
    assert.equal(!second.ok && 'search' in second && second.search.id, id);
  });
});

describe('ronda', () => {
  it('lanza una corrida NORMAL con los criterios del servidor y una identidad nueva', async () => {
    const world = fakeWorld();
    const id = await created(world);
    const response = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(response.ok && response.next, 'continue');
    const sent = world.wizardCalls[0];
    assert.deepEqual(Object.keys(sent).sort(), [...Object.keys(CRITERIA), 'clientRequestId'].sort());
    assert.notEqual(sent.clientRequestId, VALID_ID, 'la identidad de la ronda no es la de la creación');
    assert.equal('label' in sent, false);
    assert.equal(world.searches.get(id)!.delivered_count, 5);
    assert.equal(world.searches.get(id)!.lease_token, null, 'libera el lease al terminar');
  });

  it('se detiene al llegar a N y no lanza otra', async () => {
    const world = fakeWorld();
    world.setWizard(world.okRun(13, 16) as never);
    const id = await created(world);
    await runBulkSearchRound(world.deps, id, USER);
    const second = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(second.ok && second.next, 'done');
    assert.equal(world.searches.get(id)!.status, 'completed');
    assert.equal(world.wizardCalls.length, 2);
    const third = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(third.ok && third.next, 'done');
    assert.equal(world.wizardCalls.length, 2, 'terminada, no vuelve a gastar');
  });

  it('una ronda sin empresas nuevas agota la búsqueda', async () => {
    const world = fakeWorld();
    world.setWizard(world.okRun(0, 16) as never);
    const id = await created(world);
    const response = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(response.ok && response.next, 'done');
    assert.equal(world.searches.get(id)!.status, 'exhausted');
    assert.equal(world.searches.get(id)!.stop_reason, 'no_new_companies');
  });

  it('🔴 nunca lanza una ronda cuyo peor caso no quepa en lo que queda del tope', async () => {
    const world = fakeWorld();
    // Tope de 25 empresas = 3 rondas × 16. La primera gasta 40: lo que queda no cubre otra.
    world.setWizard(world.okRun(5, 40) as never);
    const id = await created(world);
    await runBulkSearchRound(world.deps, id, USER);
    assert.equal(world.searches.get(id)!.status, 'budget_capped');
    const again = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(again.ok && again.next, 'done');
    assert.equal(world.wizardCalls.length, 1);
  });

  it('dos pestañas a la vez: la segunda espera y no lanza nada', async () => {
    const world = fakeWorld();
    const id = await created(world);
    let release!: () => void;
    world.setWizard(
      (request) =>
        new Promise((resolve) => {
          release = () => resolve((world.okRun(5, 16) as unknown as (r: unknown) => WizardExecutionActionResult)(request));
        }),
    );
    const first = runBulkSearchRound(world.deps, id, USER);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(second.ok && second.next, 'wait');
    release();
    await first;
    assert.equal(world.wizardCalls.length, 1);
  });

  it('una pausa a mitad de ronda gana: la ronda se anota pero la búsqueda queda en pausa', async () => {
    const world = fakeWorld();
    world.setWizard(world.okRun(30, 16) as never);
    const id = await created(world);
    const original = world.deps.runWizard;
    world.deps.runWizard = async (request) => {
      await controlBulkSearch(world.deps, id, USER, 'pause');
      return original(request);
    };
    const response = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(world.searches.get(id)!.status, 'paused', 'llegar a N no pisa la pausa');
    assert.equal(world.searches.get(id)!.delivered_count, 30, 'lo encontrado sí se cuenta');
    assert.equal(response.ok && response.next, 'done');
  });

  it('otra corrida ocupando el cupo: la ronda no cuenta y se reintenta', async () => {
    const world = fakeWorld();
    world.setWizard(async () => fail('CONCURRENT_EXECUTION_ACTIVE'));
    const id = await created(world);
    const response = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(response.ok && response.next, 'wait');
    assert.equal(world.searches.get(id)!.status, 'running');
    assert.equal(world.searches.get(id)!.rounds_done, 0);
  });

  it('sin presupuesto del mes, termina con lo que lleva', async () => {
    const world = fakeWorld();
    world.setWizard(async () => fail('BUDGET_EXCEEDED'));
    const id = await created(world);
    await runBulkSearchRound(world.deps, id, USER);
    assert.equal(world.searches.get(id)!.status, 'budget_capped');
    assert.equal(world.searches.get(id)!.stop_reason, 'monthly_budget');
  });

  it('con una continuación de Apollo pendiente, espera antes de comprar otra ronda', async () => {
    const world = fakeWorld();
    const id = await created(world);
    await runBulkSearchRound(world.deps, id, USER);
    world.pendingContinuation.add(world.rounds[0].batch_id!);
    const response = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(response.ok && response.next, 'wait');
    assert.equal(world.wizardCalls.length, 1);
  });

  it('una ronda que murió a mitad se cierra con lo que dejó su lote', async () => {
    const world = fakeWorld();
    const id = await created(world);
    // La función murió después de lanzar la corrida y antes de anotarla.
    await world.deps.insertRound({ bulkSearchId: id, roundIndex: 0, clientRequestId: 'dead-run' });
    world.delivered.set('b-dead', 7);
    world.credits.set('b-dead', 16);
    world.deps.findBatchByClientRequestId = async (_u, crid) => (crid === 'dead-run' ? 'b-dead' : null);
    await runBulkSearchRound(world.deps, id, USER);
    const orphan = world.rounds.find((r) => r.client_request_id === 'dead-run')!;
    assert.equal(orphan.status, 'succeeded');
    assert.equal(orphan.outcome_code, 'orphan_reconciled');
    assert.ok(world.searches.get(id)!.delivered_count >= 7, 'lo de la ronda muerta cuenta');
  });

  it('una búsqueda de otra persona no se conduce', async () => {
    const world = fakeWorld();
    const id = await created(world);
    const response = await runBulkSearchRound(world.deps, id, 'u-otra');
    assert.deepEqual(response, { ok: false, code: 'NOT_FOUND' });
    assert.equal(world.wizardCalls.length, 0);
  });
});

describe('pausar · continuar · cancelar', () => {
  it('pausar y continuar', async () => {
    const world = fakeWorld();
    const id = await created(world);
    assert.equal((await controlBulkSearch(world.deps, id, USER, 'pause')).ok, true);
    const paused = await runBulkSearchRound(world.deps, id, USER);
    assert.equal(paused.ok && paused.next, 'done');
    assert.equal(world.wizardCalls.length, 0, 'pausada no gasta');
    assert.equal((await controlBulkSearch(world.deps, id, USER, 'resume')).ok, true);
    await runBulkSearchRound(world.deps, id, USER);
    assert.equal(world.wizardCalls.length, 1);
  });

  it('cancelar es final', async () => {
    const world = fakeWorld();
    const id = await created(world);
    await controlBulkSearch(world.deps, id, USER, 'cancel');
    assert.equal(world.searches.get(id)!.status, 'cancelled');
    const resume = await controlBulkSearch(world.deps, id, USER, 'resume');
    assert.deepEqual(resume, { ok: false, code: 'INVALID_TRANSITION' });
  });
});

describe('rachas desde las rondas', () => {
  it('las saltadas no cuentan; una ronda con empresas reinicia la racha vacía', () => {
    const round = (index: number, status: BulkSearchRoundRow['status'], deliveredNew = 0): BulkSearchRoundRow => ({
      id: String(index),
      bulk_search_id: 's',
      round_index: index,
      client_request_id: String(index),
      batch_id: null,
      status,
      delivered_new: deliveredNew,
      credits_used: 0,
      outcome_code: null,
      started_at: '',
      finished_at: null,
    });
    assert.deepEqual(streaksFromRounds([round(0, 'succeeded', 5), round(1, 'skipped'), round(2, 'failed')]), {
      roundsDone: 2,
      consecutiveEmptyRounds: 0,
      consecutiveFailedRounds: 1,
    });
    assert.equal(streaksFromRounds([round(0, 'succeeded', 0)]).consecutiveEmptyRounds, 1);
  });
});
