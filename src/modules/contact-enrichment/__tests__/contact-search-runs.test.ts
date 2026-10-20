/**
 * Búsquedas de contactos con Rumbo en segundo plano (dueña 20-10): varias a la vez, el
 * panel se puede cerrar y el Centro de procesos las sigue; la barra avanza por etapas reales.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { RunAutomaticContactEnrichmentForRequestResult } from '../automatic-routing-action-core';
import { contactSearchProgress, nextContactSearchPercent } from '../contact-search-progress';
import {
  CONTACT_SEARCH_DETACHED_STALE_MS,
  CONTACT_SEARCH_STALE_MESSAGE,
  contactsFound,
  createContactSearchRunsStore,
  restoreContactSearchRuns,
  type ContactSearchRun,
  type ContactSearchRunResponse,
} from '../contact-search-runs-store';

const RESULT = (over: Partial<RunAutomaticContactEnrichmentForRequestResult> = {}): RunAutomaticContactEnrichmentForRequestResult => ({
  success: true,
  status: 'attempt1_succeeded' as RunAutomaticContactEnrichmentForRequestResult['status'],
  automaticRoutingEnabled: true,
  fallbackExecuted: false,
  attempt1AttemptId: 'a1',
  attempt2AttemptId: null,
  blockedReason: null,
  reusedExistingCandidates: 0,
  providerCandidatesCreated: { apollo: 3, lusha: null },
  failedProviders: [],
  ...over,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('contactSearchProgress — etapas reales', () => {
  it('sin intentos revisa lo que ya existe; Apollo, luego Lusha, luego terminó', () => {
    assert.equal(contactSearchProgress([], 0).stage, 'checking');
    assert.equal(contactSearchProgress([{ attemptOrder: 1, provider: 'apollo', status: 'enriching' }], 0).stage, 'apollo');
    const lusha = contactSearchProgress(
      [
        { attemptOrder: 1, provider: 'apollo', status: 'ready_for_review' },
        { attemptOrder: 2, provider: 'lusha', status: 'enriching' },
      ],
      2,
    );
    assert.deepEqual([lusha.stage, lusha.found, lusha.done], ['lusha', 2, false]);
    const done = contactSearchProgress([{ attemptOrder: 1, provider: 'apollo', status: 'completed' }], 4);
    assert.deepEqual([done.stage, done.percent, done.done], ['done', 100, true]);
  });

  it('la barra no retrocede', () => {
    assert.equal(nextContactSearchPercent(75, contactSearchProgress([], 0)), 75);
  });
});

describe('createContactSearchRunsStore', () => {
  it('varias a la vez, cada una con su resultado, y avisa al terminar', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<ContactSearchRunResponse>>>();
    const settled: ContactSearchRun[] = [];
    const store = createContactSearchRunsStore({
      execute: (requestId) => {
        const d = deferred<ContactSearchRunResponse>();
        pending.set(requestId, d);
        return d.promise;
      },
      nowMs: () => 1_000,
      onSettled: (run) => settled.push(run),
    });
    const a = store.startRun({ id: 'r1', requestId: 'q1', accountId: 'acc1', companyName: 'Alpina' });
    const b = store.startRun({ id: 'r2', requestId: 'q2', accountId: 'acc2', companyName: 'Nutresa' });
    assert.deepEqual(store.getSnapshot().map((r) => r.status), ['running', 'running']);

    pending.get('q2')!.resolve({ ok: true, result: RESULT({ providerCandidatesCreated: { apollo: 0, lusha: 2 }, reusedExistingCandidates: 1 }) });
    await b;
    pending.get('q1')!.resolve({ ok: true, result: RESULT({ success: false, blockedReason: 'Sin créditos de Apollo' }) });
    await a;

    const byId = Object.fromEntries(store.getSnapshot().map((r) => [r.id, r]));
    assert.deepEqual([byId.r2.status, byId.r2.found], ['succeeded', 3]);
    assert.deepEqual([byId.r1.status, byId.r1.message], ['failed', 'Sin créditos de Apollo']);
    assert.deepEqual(settled.map((r) => r.id), ['r2', 'r1']);
  });

  it('si se pierde la respuesta, queda desligada (sigue en el servidor), no fallida', async () => {
    const store = createContactSearchRunsStore({ execute: async () => ({ ok: false, code: 'network', message: 'x' }) });
    const response = await store.startRun({ id: 'r1', requestId: 'q1', accountId: null, companyName: 'Alpina' });
    assert.equal(!response.ok && response.code, 'detached');
    const run = store.getSnapshot()[0];
    assert.deepEqual([run.status, run.detached], ['running', true]);
  });

  it('al recargar, lo que corría queda desligado; pasado el tope se cierra y manda a «Por revisar»', () => {
    const base: ContactSearchRun = {
      id: 'r1', requestId: 'q1', accountId: null, companyName: 'Alpina', status: 'running',
      startedAtMs: 0, finishedAtMs: null, found: null, message: null, detached: false,
    };
    assert.equal(restoreContactSearchRuns([base], 1_000)[0].detached, true);
    const stale = restoreContactSearchRuns([base], CONTACT_SEARCH_DETACHED_STALE_MS + 1)[0];
    assert.deepEqual([stale.status, stale.message], ['succeeded', CONTACT_SEARCH_STALE_MESSAGE]);
  });

  it('cuenta lo creado por cada proveedor y lo que ya estaba por revisar', () => {
    assert.equal(contactsFound(RESULT({ providerCandidatesCreated: { apollo: 2, lusha: 1 }, reusedExistingCandidates: 4 })), 7);
    assert.equal(contactsFound(RESULT({ providerCandidatesCreated: { apollo: null, lusha: null } })), 0);
  });

  it('cuenta lo que trajeron HubSpot y el banco de contactos aunque no corriera ningún proveedor', () => {
    assert.equal(
      contactsFound(
        RESULT({ providerCandidatesCreated: { apollo: null, lusha: null }, hubspotFirstCandidates: 2, contactBankCandidates: 1 }),
      ),
      3,
    );
  });
});
