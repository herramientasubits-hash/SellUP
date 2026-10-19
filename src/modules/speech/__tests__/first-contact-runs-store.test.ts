/**
 * AGENT3-PROCESS-CENTER-1 — las preparaciones del Agente 3 viven fuera del panel: se
 * puede minimizar o cerrar y siguen en el Centro de procesos (dueña 18-10).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIRST_CONTACT_DETACHED_CODE,
  FIRST_CONTACT_DETACHED_STALE_MS,
  FIRST_CONTACT_RUNS_STORAGE_KEY,
  createFirstContactRunsStore,
  restoreFirstContactRuns,
  type FirstContactRun,
  type FirstContactRunResponse,
} from '../first-contact-runs-store';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

function deferred() {
  let resolve!: (value: FirstContactRunResponse) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<FirstContactRunResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const START = { accountId: 'acc-1', accountName: 'Grupo Ciisa', title: 'para Emily por Llamada', expected: 1, body: {} };

describe('registro de preparaciones del Agente 3', () => {
  it('queda en curso, termina con sus estados y avisa al terminar', async () => {
    const call = deferred();
    const settled: FirstContactRun[] = [];
    const storage = memoryStorage();
    const store = createFirstContactRunsStore({ execute: () => call.promise, storage, nowMs: () => 1_000, onSettled: (r) => settled.push(r) });

    const running = store.startRun({ id: 'r1', ...START });
    assert.equal(store.getSnapshot()[0].status, 'running');
    assert.equal(store.isRunning('acc-1'), true);
    assert.ok(storage.data[FIRST_CONTACT_RUNS_STORAGE_KEY]?.includes('"r1"'), 'se guarda en el navegador');

    call.resolve({ ok: true, packIds: ['p1'], packStatuses: ['needs_review'], reusedBrief: true });
    await running;
    assert.equal(store.getSnapshot()[0].status, 'succeeded');
    assert.deepEqual(store.getSnapshot()[0].packStatuses, ['needs_review']);
    assert.equal(settled.length, 1);
  });

  it('una por empresa: lanzarla dos veces devuelve la misma', () => {
    const call = deferred();
    let calls = 0;
    const store = createFirstContactRunsStore({ execute: () => ((calls += 1), call.promise) });
    const a = store.startRun({ id: 'r1', ...START });
    const b = store.startRun({ id: 'r2', ...START });
    assert.equal(a, b);
    assert.equal(calls, 1);
  });

  it('sin red (o la página se recargó): NO es un fallo, queda desligada y el Centro la cierra (Prod 19-10)', async () => {
    const store = createFirstContactRunsStore({ execute: () => Promise.reject(new Error('offline')) });
    const response = await store.startRun({ id: 'r1', ...START });
    assert.equal(response.ok, false);
    assert.equal(!response.ok && response.code, FIRST_CONTACT_DETACHED_CODE);
    assert.equal(store.getSnapshot()[0].status, 'running');
    assert.equal(store.getSnapshot()[0].detached, true);
    store.settleDetached('r1', { status: 'succeeded', packStatuses: ['draft'] });
    assert.equal(store.getSnapshot()[0].status, 'succeeded');
  });

  it('una respuesta que no se pudo leer (el servidor cortó la conexión) también queda desligada', async () => {
    const store = createFirstContactRunsStore({ execute: async () => ({ ok: false, code: 'bad_response', message: 'x' }) });
    await store.startRun({ id: 'r1', ...START });
    assert.equal(store.getSnapshot()[0].status, 'running');
    assert.equal(store.getSnapshot()[0].detached, true);
  });

  it('un «no» del servidor sí es un fallo', async () => {
    const store = createFirstContactRunsStore({ execute: async () => ({ ok: false, code: 'budget_blocked', message: 'Sin presupuesto' }) });
    await store.startRun({ id: 'r1', ...START });
    assert.equal(store.getSnapshot()[0].status, 'failed');
    assert.equal(store.getSnapshot()[0].message, 'Sin presupuesto');
  });

  it('al recargar: la que corría queda desligada; la vieja, vencida', () => {
    const base: FirstContactRun = { id: 'r1', ...START, status: 'running', startedAtMs: 0, finishedAtMs: null, packStatuses: [], message: null, detached: false };
    const [fresh] = restoreFirstContactRuns([base], 60_000);
    assert.equal(fresh.detached, true);
    const [stale] = restoreFirstContactRuns([base], FIRST_CONTACT_DETACHED_STALE_MS + 1);
    assert.equal(stale.status, 'failed');
  });

  it('una desligada se cierra cuando aparecen sus preparaciones; no se descarta una que corre', () => {
    const stored: FirstContactRun = { id: 'r1', ...START, status: 'running', startedAtMs: 0, finishedAtMs: null, packStatuses: [], message: null, detached: false };
    const storage = memoryStorage({ [FIRST_CONTACT_RUNS_STORAGE_KEY]: JSON.stringify([stored]) });
    const store = createFirstContactRunsStore({ execute: () => new Promise(() => {}), storage, nowMs: () => 30_000 });
    assert.equal(store.getSnapshot()[0].detached, true);
    store.settleDetached('r1', { status: 'succeeded', packStatuses: ['draft'] });
    assert.equal(store.getSnapshot()[0].status, 'succeeded');

    store.startRun({ id: 'r2', ...START, accountId: 'acc-2' });
    store.dismiss('r2');
    assert.ok(store.getSnapshot().some((r) => r.id === 'r2'), 'la que corre no se descarta');
    store.dismissFinished();
    assert.deepEqual(store.getSnapshot().map((r) => r.id), ['r2']);
  });
});
