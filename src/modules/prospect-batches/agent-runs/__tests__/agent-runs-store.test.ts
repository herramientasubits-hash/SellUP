/**
 * AGENT1-PARALLEL-RUNS-TRAY-1 — el almacén de corridas del navegador: sobrevive al
 * chat, ejecuta UNA a la vez (reserva única por usuario, migración 064), pone las
 * demás en espera y se restaura bien tras recargar la página. Cero red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_RUNS_MAX_CONCURRENT,
  AGENT_RUNS_STORAGE_KEY,
  createAgentRunsStore,
  restoreAgentRuns,
  type AgentRun,
  type AgentRunPayload,
} from '../agent-runs-store';
import type { WizardExecutionActionResult } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';
import {
  AGENT_RUNS_TRAY_COPY,
  agentRunProcessState,
  describeAgentRun,
  isDetachedRunFinished,
  processCenterSummary,
} from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray-copy';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const ID_D = '44444444-4444-4444-8444-444444444444';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

function deferred() {
  let resolve!: (r: WizardExecutionActionResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<WizardExecutionActionResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ok = (batchId: string, candidateCount: number) =>
  ({ ok: true, status: 'success_target_reached', batchId, redirectPath: `/prospect-batches/${batchId}`, candidateCount }) as unknown as WizardExecutionActionResult;

const payload = (clientRequestId: string): AgentRunPayload => ({ clientRequestId, countryCode: 'MX' });

const tick = () => new Promise((r) => setImmediate(r));

describe('almacén de corridas', () => {
  it('distinto país × industria corren juntas; el mismo país × industria espera', async () => {
    const calls: string[] = [];
    const jobs = new Map<string, ReturnType<typeof deferred>>();
    const store = createAgentRunsStore({
      execute: (p) => {
        calls.push(p.clientRequestId);
        const d = deferred();
        jobs.set(p.clientRequestId, d);
        return d.promise;
      },
      storage: memoryStorage(),
    });

    const first = store.startRun({ title: 'México · Retail', concurrencyKey: 'MX:retail', payload: payload(ID_A) });
    store.startRun({ title: 'Chile · Salud', concurrencyKey: 'CL:salud', payload: payload(ID_B) });
    store.startRun({ title: 'México · Retail', concurrencyKey: 'MX:retail', payload: payload(ID_C) });
    assert.deepEqual(calls, [ID_A, ID_B]);
    assert.equal(store.getSnapshot().find((r) => r.clientRequestId === ID_C)!.status, 'queued');

    jobs.get(ID_A)!.resolve(ok('batch-a', 6));
    assert.equal((await first).ok, true);
    await tick();
    assert.deepEqual(calls, [ID_A, ID_B, ID_C]);
    const a = store.getSnapshot().find((r) => r.clientRequestId === ID_A)!;
    assert.equal(a.status, 'succeeded');
    assert.equal(a.batchId, 'batch-a');
    assert.equal(a.candidateCount, 6);

    jobs.get(ID_B)!.resolve({ ok: false, code: 'GENERATION_FAILED', message: 'falló' } as unknown as WizardExecutionActionResult);
    await tick();
    assert.equal(store.getSnapshot().find((r) => r.clientRequestId === ID_B)!.status, 'failed');
  });

  it(`nunca más de ${AGENT_RUNS_MAX_CONCURRENT} a la vez`, async () => {
    const calls: string[] = [];
    const store = createAgentRunsStore({
      execute: (p) => (calls.push(p.clientRequestId), deferred().promise),
      storage: null,
    });
    const ids = [ID_A, ID_B, ID_C, ID_D];
    ids.forEach((id, i) => store.startRun({ title: `País ${i}`, concurrencyKey: `K${i}`, payload: payload(id) }));
    assert.equal(calls.length, AGENT_RUNS_MAX_CONCURRENT);
    assert.equal(store.getSnapshot().filter((r) => r.status === 'queued').length, ids.length - AGENT_RUNS_MAX_CONCURRENT);
  });

  it('el mismo id dos veces (doble clic) es la MISMA corrida', async () => {
    let calls = 0;
    const store = createAgentRunsStore({ execute: async () => (calls++, ok('b', 1)), storage: null });
    const p1 = store.startRun({ title: 'x', payload: payload(ID_A) });
    const p2 = store.startRun({ title: 'x', payload: payload(ID_A) });
    assert.equal(p1, p2);
    await p1;
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot().length, 1);
  });

  it('un fallo de red marca la fila como fallida y no bloquea la cola', async () => {
    const store = createAgentRunsStore({ execute: async () => Promise.reject(new Error('net')), storage: null });
    await assert.rejects(store.startRun({ title: 'x', payload: payload(ID_A) }));
    await tick();
    assert.equal(store.getSnapshot()[0].status, 'failed');
  });

  it('guarda en el navegador y quitar sólo afecta a las terminadas', async () => {
    const storage = memoryStorage();
    const store = createAgentRunsStore({ execute: async () => ok('b', 2), storage });
    await store.startRun({ title: 'México · Retail', payload: payload(ID_A) });
    await tick();
    const saved = JSON.parse(storage.data[AGENT_RUNS_STORAGE_KEY]) as AgentRun[];
    assert.equal(saved[0].status, 'succeeded');
    store.dismissFinished();
    assert.equal(store.getSnapshot().length, 0);
  });

  it('al recargar: la que corría se sigue por su id; la que esperaba se dice que no arrancó', () => {
    const base: AgentRun = {
      clientRequestId: ID_A, title: 't', status: 'running', createdAtMs: 1, startedAtMs: 1, finishedAtMs: null,
      batchId: null, redirectPath: null, candidateCount: null, message: null, detached: false,
    };
    const [running, queued] = restoreAgentRuns([base, { ...base, clientRequestId: ID_B, status: 'queued' }], 99);
    assert.equal(running.detached, true);
    assert.equal(running.status, 'running');
    assert.equal(queued.status, 'failed');
    assert.match(queued.message ?? '', /no llegó a iniciarse/i);
  });

  it('una desligada se cierra con el lote que la consulta encontró', () => {
    const run: AgentRun = {
      clientRequestId: ID_A, title: 't', status: 'running', createdAtMs: 1, startedAtMs: 1, finishedAtMs: null,
      batchId: null, redirectPath: null, candidateCount: null, message: null, detached: true,
    };
    const storage = memoryStorage({ [AGENT_RUNS_STORAGE_KEY]: JSON.stringify([run]) });
    const store = createAgentRunsStore({ execute: async () => ok('b', 1), storage });
    store.settleDetached(ID_A, { status: 'succeeded', batchId: 'batch-z' });
    const settled = store.getSnapshot()[0];
    assert.equal(settled.status, 'succeeded');
    assert.equal(settled.redirectPath, '/prospect-batches/batch-z');
    assert.equal(settled.detached, false);
  });
});

describe('textos de la bandeja', () => {
  const run = (patch: Partial<AgentRun>): AgentRun => ({
    clientRequestId: ID_A, title: 'México · Retail', status: 'running', createdAtMs: 1, startedAtMs: 1, finishedAtMs: null,
    batchId: null, redirectPath: null, candidateCount: null, message: null, detached: false, ...patch,
  });

  it('en curso muestra la etapa; en espera lo dice; terminada enlaza al lote', () => {
    assert.equal(describeAgentRun(run({}), 'Buscando en fuentes gratuitas').description, 'Buscando en fuentes gratuitas');
    assert.equal(describeAgentRun(run({ status: 'queued' }), null).description, AGENT_RUNS_TRAY_COPY.queued);
    const done = describeAgentRun(run({ status: 'succeeded', candidateCount: 6, redirectPath: '/prospect-batches/b' }), null);
    assert.equal(done.description, 'Terminada: 6 empresas.');
    assert.equal(done.showLink, true);
    assert.equal(done.dismissible, true);
  });

  it('fallida con empresas guardadas también enlaza', () => {
    const failed = describeAgentRun(run({ status: 'failed', message: 'Sin créditos', redirectPath: '/prospect-batches/b' }), null);
    assert.equal(failed.error, 'Sin créditos');
    assert.equal(failed.showLink, true);
  });

  it('Centro de procesos: cada corrida cae en uno de los cuatro estados de Thema', () => {
    assert.equal(agentRunProcessState(run({ status: 'running' })), 'running');
    assert.equal(agentRunProcessState(run({ status: 'queued' })), 'waiting');
    assert.equal(agentRunProcessState(run({ status: 'succeeded' })), 'done');
    assert.equal(agentRunProcessState(run({ status: 'failed' })), 'failed');
  });

  it('el resumen sólo nombra lo terminado y lo fallido si los hay', () => {
    assert.equal(processCenterSummary({ running: 0, waiting: 0, done: 0, failed: 0 }), 'Nada en proceso');
    assert.equal(processCenterSummary({ running: 2, waiting: 1, done: 0, failed: 0 }), '2 en curso · 1 en espera');
    assert.equal(
      processCenterSummary({ running: 0, waiting: 0, done: 1, failed: 2 }),
      '0 en curso · 0 en espera · 1 terminada · 2 con error',
    );
  });

  it('una desligada termina cuando su lote deja de generar', () => {
    assert.equal(isDetachedRunFinished({ clientRequestId: ID_A, progress: null, batch: null }), false);
    assert.equal(isDetachedRunFinished({ clientRequestId: ID_A, progress: null, batch: { id: 'b', status: 'generating', candidateCount: 0 } }), false);
    assert.equal(isDetachedRunFinished({ clientRequestId: ID_A, progress: null, batch: { id: 'b', status: 'ready_for_review', candidateCount: 4 } }), true);
  });
});

describe('abrir el chat en «Búsquedas» desde el Centro de procesos', async () => {
  const events = await import('../agent-chat-events');

  it('sin un chat montado nadie lo atiende y hay ruta de respaldo a Empresas', () => {
    const target = new EventTarget();
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = target;
    try {
      assert.equal(events.requestOpenAgentRunsInChat(), false);
      target.addEventListener(events.AGENT_CHAT_OPEN_RUNS_EVENT, (event) => {
        (event as CustomEvent<{ handled: boolean }>).detail.handled = true;
      });
      assert.equal(events.requestOpenAgentRunsInChat(), true, 'con el cajón montado, lo atiende él');
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
    assert.equal(events.agentRunsFallbackHref(), '/accounts?agentView=runs');
  });
});
