/**
 * Auditoría del Agente 3 (21-10) — las corridas quedan en el servidor (`agent_runs`):
 * se ven desde otro equipo, el Centro de procesos sabe cómo terminaron aunque se haya
 * perdido la respuesta, y «Quitar» deja de mostrarlas en los demás equipos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIRST_CONTACT_RUN_STALE_MS,
  isFirstContactRunDismissed,
  mapFirstContactRunRow,
  parseFirstContactRunMeta,
  type FirstContactServerRun,
} from '../first-contact-run-registry';
import { FIRST_CONTACT_DETACHED_STALE_MS, createFirstContactRunsStore, type FirstContactRun } from '../first-contact-runs-store';

const RUN_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const START = { accountId: 'acc-1', accountName: 'Grupo Ciisa', title: 'para Emily por Llamada', expected: 2, body: { accountId: 'acc-1' } };

function server(overrides: Partial<FirstContactServerRun> = {}): FirstContactServerRun {
  return {
    id: RUN_ID,
    accountId: 'acc-1',
    accountName: 'Grupo Ciisa',
    title: 'para Emily por Llamada',
    expected: 2,
    status: 'succeeded',
    startedAtMs: 1_000,
    finishedAtMs: 5_000,
    packStatuses: ['draft', 'needs_review'],
    message: null,
    ...overrides,
  };
}

describe('registro de corridas en el servidor — lo que viaja y lo que vuelve', () => {
  it('lee el id, el título y cuántas se esperan; sin id válido no registra nada', () => {
    assert.deepEqual(parseFirstContactRunMeta({ run: { id: RUN_ID.toUpperCase(), title: '  para   Emily ', expected: 3, accountName: 'Ciisa' } }), {
      id: RUN_ID,
      title: 'para Emily',
      expected: 3,
      accountName: 'Ciisa',
    });
    assert.equal(parseFirstContactRunMeta({ run: { id: 'r1' } }), null);
    assert.equal(parseFirstContactRunMeta({ accountId: 'x' }), null);
    assert.equal(parseFirstContactRunMeta(null), null);
    assert.equal(parseFirstContactRunMeta({ run: { id: RUN_ID, expected: 9_999 } })?.expected, 64);
    assert.equal(parseFirstContactRunMeta({ run: { id: RUN_ID, title: 'x'.repeat(500) } })?.title.length, 200);
  });

  it('una fila de agent_runs se lee como la corrida del navegador', () => {
    const row = {
      id: RUN_ID,
      status: 'completed',
      input_params: { account_id: 'acc-1', title: 'para Emily', expected: 2 },
      metadata: { account_name: 'Grupo Ciisa', pack_statuses: ['draft', 7, 'needs_review'] },
      started_at: '2026-10-21T10:00:00Z',
      finished_at: '2026-10-21T10:01:30Z',
      error_message: null,
    };
    const run = mapFirstContactRunRow(row)!;
    assert.equal(run.status, 'succeeded');
    assert.deepEqual(run.packStatuses, ['draft', 'needs_review']);
    assert.equal(run.finishedAtMs! - run.startedAtMs, 90_000);
    const timedOut = mapFirstContactRunRow({ ...row, status: 'failed', error_message: 'Se cortó.' })!;
    assert.equal(timedOut.status, 'failed');
    assert.equal(timedOut.message, 'Se cortó.');
    assert.equal(mapFirstContactRunRow({ ...row, status: 'running' })!.finishedAtMs, null);
    assert.equal(mapFirstContactRunRow({ ...row, input_params: {} }), null, 'sin empresa no es de este flujo');
  });

  it('«Quitar» vive en metadata.dismissed_at', () => {
    assert.equal(isFirstContactRunDismissed({ metadata: { dismissed_at: '2026-10-21T10:00:00Z' } }), true);
    assert.equal(isFirstContactRunDismissed({ metadata: {} }), false);
  });

  it('el servidor da por cortada la corrida al mismo tiempo que el navegador', () => {
    assert.equal(FIRST_CONTACT_RUN_STALE_MS, FIRST_CONTACT_DETACHED_STALE_MS);
  });
});

describe('registro de corridas en el servidor — el navegador', () => {
  it('manda el id, el título y cuántas se esperan junto con la solicitud', async () => {
    const bodies: unknown[] = [];
    const store = createFirstContactRunsStore({ execute: async (body) => (bodies.push(body), { ok: true, packIds: [], packStatuses: ['draft'], reusedBrief: false }) });
    await store.startRun({ id: RUN_ID, ...START });
    assert.deepEqual(bodies[0], { accountId: 'acc-1', run: { id: RUN_ID, title: START.title, expected: 2, accountName: 'Grupo Ciisa' } });
  });

  it('trae las corridas de otro equipo: en curso quedan desligadas, sin avisos de las ya terminadas', () => {
    const settled: FirstContactRun[] = [];
    const store = createFirstContactRunsStore({ execute: () => new Promise(() => {}), nowMs: () => 10_000, onSettled: (r) => settled.push(r) });
    store.hydrate([server({ id: 'a', startedAtMs: 1_000 }), server({ id: 'b', status: 'running', finishedAtMs: null, packStatuses: [], startedAtMs: 2_000 })]);
    const runs = store.getSnapshot();
    assert.deepEqual(runs.map((r) => r.id), ['b', 'a'], 'la más reciente primero');
    assert.equal(runs[0].detached, true);
    assert.equal(runs[1].detached, false);
    assert.equal(settled.length, 0);
  });

  it('una desligada que el servidor ya cerró se cierra con su resultado y avisa una vez', () => {
    const settled: FirstContactRun[] = [];
    const store = createFirstContactRunsStore({ execute: () => new Promise(() => {}), nowMs: () => 10_000, onSettled: (r) => settled.push(r) });
    store.hydrate([server({ status: 'running', finishedAtMs: null, packStatuses: [] })]);
    store.hydrate([server({ status: 'failed', message: 'La preparación se cortó antes de terminar.' })]);
    store.hydrate([server({ status: 'failed', message: 'La preparación se cortó antes de terminar.' })]);
    const [run] = store.getSnapshot();
    assert.equal(run.status, 'failed');
    assert.equal(run.detached, false);
    assert.equal(run.message, 'La preparación se cortó antes de terminar.');
    assert.equal(settled.length, 1);
  });

  it('no pisa una corrida que sigue esperando su respuesta en esta pestaña', async () => {
    const settled: FirstContactRun[] = [];
    let resolve!: (value: { ok: true; packIds: string[]; packStatuses: string[]; reusedBrief: boolean }) => void;
    const store = createFirstContactRunsStore({ execute: () => new Promise((res) => (resolve = res)), onSettled: (r) => settled.push(r) });
    const running = store.startRun({ id: RUN_ID, ...START });
    store.hydrate([server({ status: 'succeeded' })]);
    assert.equal(store.getSnapshot()[0].status, 'running');
    resolve({ ok: true, packIds: ['p1'], packStatuses: ['draft'], reusedBrief: false });
    await running;
    assert.equal(store.getSnapshot()[0].status, 'succeeded');
    assert.equal(settled.length, 1);
  });

  it('«Quitar» también quita en el servidor (una desligada en curso no vuelve al sincronizar)', () => {
    const dismissed: string[][] = [];
    const store = createFirstContactRunsStore({ execute: () => new Promise(() => {}), onDismiss: (ids) => dismissed.push(ids) });
    store.hydrate([server({ id: 'a' }), server({ id: 'b', status: 'running', finishedAtMs: null })]);
    store.dismiss('b');
    assert.deepEqual(dismissed, [['b']]);
    store.dismissFinished();
    assert.deepEqual(dismissed, [['b'], ['a']]);
  });
});
