/**
 * Auditoría del Agente 3 (21-10) — el registro de corridas en `agent_runs` y el barrido
 * de lo que Vercel cortó, con un cliente de base falso que anota cada consulta.
 *
 * Sin red ni base: se comprueba QUÉ se pide (tabla, filtros, valores), que nunca pise lo
 * de otro usuario ni reviva lo cerrado, y que un fallo de la base no detenga nada.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  dismissFirstContactRuns,
  listFirstContactRuns,
  recordFirstContactRunFinish,
  recordFirstContactRunStart,
  resetFirstContactSweepForTests,
  sweepStaleFirstContactRuns,
} from '../run-registry.server';
import { FIRST_CONTACT_RUN_STALE_MS, FIRST_CONTACT_RUN_TIMEOUT_MESSAGE } from '@/modules/speech/first-contact-run-registry';
import { RESEARCH_RUNNING_STALE_MS } from '../run-first-call.server';

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload: unknown;
  filters: Array<[string, string, unknown]>;
}

type Responder = (call: Call) => { data?: unknown; error?: { message: string; code?: string } | null };

function fakeClient(respond: Responder = () => ({ data: [] })) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', payload: null, filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (column: string, value: unknown) => {
      call.filters.push([name, column, value]);
      return builder;
    };
    Object.assign(builder, {
      insert: (payload: unknown) => ((call.op = 'insert'), (call.payload = payload), builder),
      update: (payload: unknown) => ((call.op = 'update'), (call.payload = payload), builder),
      select: () => builder,
      eq: chain('eq'),
      neq: chain('neq'),
      lt: chain('lt'),
      gte: chain('gte'),
      in: chain('in'),
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        try {
          const out = respond(call);
          return Promise.resolve({ data: out.data ?? null, error: out.error ?? null }).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      },
    });
    return builder;
  };
  return { client: { from } as never, calls };
}

const RUN_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const ACCOUNT = '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f';
const META = { id: RUN_ID, title: 'para Emily por Llamada', expected: 2, accountName: 'Grupo Ciisa' };
const NOW = Date.parse('2026-10-21T15:00:00Z');

const filter = (call: Call, name: string, column: string) => call.filters.find(([n, c]) => n === name && c === column)?.[2];

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

describe('registro de corridas — escribir', () => {
  it('registra la corrida con el id del navegador, la empresa y quién la pidió', async () => {
    const { client, calls } = fakeClient();
    assert.equal(await recordFirstContactRunStart({ meta: META, accountId: ACCOUNT, userId: 'u1' }, client), true);
    const row = calls[0].payload as Record<string, unknown>;
    assert.equal(calls[0].table, 'agent_runs');
    assert.equal(row.id, RUN_ID);
    assert.equal(row.agent_key, 'agent3');
    assert.equal(row.triggered_by, 'u1');
    assert.equal(row.status, 'running');
    assert.deepEqual(row.input_params, { account_id: ACCOUNT, title: META.title, expected: 2 });
  });

  it('si la fila no se puede escribir (id repetido, base caída), la corrida sigue sin enlace', async () => {
    const dup = fakeClient(() => ({ error: { message: 'duplicate key', code: '23505' } }));
    assert.equal(await quiet(() => recordFirstContactRunStart({ meta: META, accountId: ACCOUNT, userId: 'u1' }, dup.client)), false);
    const down = fakeClient(() => {
      throw new Error('fetch failed');
    });
    assert.equal(await quiet(() => recordFirstContactRunStart({ meta: META, accountId: ACCOUNT, userId: 'u1' }, down.client)), false);
  });

  it('al terminar cierra SÓLO la suya y sólo si sigue en curso (lo barrido no revive)', async () => {
    const { client, calls } = fakeClient();
    await recordFirstContactRunFinish(
      {
        runId: RUN_ID,
        userId: 'u1',
        meta: META,
        result: { ok: true, briefId: 'b1', packIds: ['p1', 'p2'], packStatuses: ['draft', 'needs_review'], reusedBrief: true, failedTargets: 1, budgetStopped: false },
      },
      client,
    );
    const call = calls[0];
    assert.equal(call.op, 'update');
    assert.equal(filter(call, 'eq', 'id'), RUN_ID);
    assert.equal(filter(call, 'eq', 'triggered_by'), 'u1');
    assert.equal(filter(call, 'eq', 'status'), 'running');
    const payload = call.payload as { status: string; results_generated: number; metadata: Record<string, unknown> };
    assert.equal(payload.status, 'completed');
    assert.equal(payload.results_generated, 2);
    assert.deepEqual(payload.metadata.pack_statuses, ['draft', 'needs_review']);
    assert.equal(payload.metadata.failed_targets, 1);
  });

  it('un «no» del servidor queda como fallida con su motivo', async () => {
    const { client, calls } = fakeClient();
    await recordFirstContactRunFinish({ runId: RUN_ID, userId: 'u1', meta: META, result: { ok: false, code: 'budget_blocked', message: 'Sin presupuesto' } }, client);
    const payload = calls[0].payload as { status: string; error_message: string; metadata: Record<string, unknown> };
    assert.equal(payload.status, 'failed');
    assert.equal(payload.error_message, 'Sin presupuesto');
    assert.equal(payload.metadata.error_code, 'budget_blocked');
  });
});

describe('registro de corridas — barrido de lo que Vercel cortó', () => {
  beforeEach(() => resetFirstContactSweepForTests());

  it('cierra corridas de más de 6 min e investigaciones de más de 5, y baja el «escribiendo» de su empresa', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.table === 'agent_runs' && call.op === 'update') return { data: [{ input_params: { account_id: ACCOUNT } }] };
      if (call.table === 'account_research_briefs' && call.op === 'update' && filter(call, 'eq', 'status') === 'running') return { data: [{ id: 'b-old' }] };
      return { data: [] };
    });
    await quiet(() => sweepStaleFirstContactRuns(NOW, client));
    const runs = calls.find((c) => c.table === 'agent_runs' && c.op === 'update')!;
    assert.equal(filter(runs, 'eq', 'agent_key'), 'agent3');
    assert.equal(filter(runs, 'eq', 'status'), 'running');
    assert.equal(filter(runs, 'lt', 'started_at'), new Date(NOW - FIRST_CONTACT_RUN_STALE_MS).toISOString());
    assert.equal((runs.payload as { error_message: string }).error_message, FIRST_CONTACT_RUN_TIMEOUT_MESSAGE);
    const briefs = calls.find((c) => c.table === 'account_research_briefs' && filter(c, 'eq', 'status') === 'running')!;
    assert.equal(filter(briefs, 'lt', 'created_at'), new Date(NOW - RESEARCH_RUNNING_STALE_MS).toISOString());
    assert.equal((briefs.payload as { error_code: string }).error_code, 'stale_running');
    const writing = calls.find((c) => c.table === 'account_research_briefs' && filter(c, 'eq', 'progress_stage') === 'writing')!;
    assert.deepEqual(filter(writing, 'in', 'account_id'), [ACCOUNT]);
    assert.equal(filter(writing, 'neq', 'status'), 'running');
    assert.deepEqual(writing.payload, { progress_stage: 'done' });
  });

  it('no baja el «escribiendo» si otra corrida de esa empresa sigue en curso', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.table === 'agent_runs' && call.op === 'update') return { data: [{ input_params: { account_id: ACCOUNT } }] };
      if (call.table === 'agent_runs' && call.op === 'select') return { data: [{ input_params: { account_id: ACCOUNT } }] };
      return { data: [] };
    });
    await quiet(() => sweepStaleFirstContactRuns(NOW, client));
    assert.equal(calls.some((c) => filter(c, 'eq', 'progress_stage') === 'writing'), false);
  });

  it('corre como mucho una vez por minuto (se llama en cada lectura del avance)', async () => {
    const { client, calls } = fakeClient();
    await sweepStaleFirstContactRuns(NOW, client);
    const first = calls.length;
    await sweepStaleFirstContactRuns(NOW + 30_000, client);
    assert.equal(calls.length, first);
    await sweepStaleFirstContactRuns(NOW + 61_000, client);
    assert.ok(calls.length > first);
  });

  it('con la base caída no rompe la lectura del avance', async () => {
    const { client } = fakeClient(() => {
      throw new Error('fetch failed');
    });
    await quiet(() => sweepStaleFirstContactRuns(NOW, client));
  });
});

describe('registro de corridas — leer y quitar', () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    status: 'completed',
    input_params: { account_id: ACCOUNT, title: 't', expected: 1 },
    metadata: { account_name: 'Ciisa', pack_statuses: ['draft'] },
    started_at: '2026-10-21T14:00:00Z',
    finished_at: '2026-10-21T14:01:00Z',
    error_message: null,
    created_at: '2026-10-21T14:00:00Z',
    ...extra,
  });

  it('sólo trae las de quien pregunta y deja fuera las quitadas', async () => {
    const { client, calls } = fakeClient(() => ({ data: [row('a'), row('b', { metadata: { dismissed_at: '2026-10-21T14:05:00Z' } })] }));
    const runs = await listFirstContactRuns('u1', undefined, client);
    assert.deepEqual(runs.map((r) => r.id), ['a']);
    assert.equal(filter(calls[0], 'eq', 'triggered_by'), 'u1');
    assert.equal(filter(calls[0], 'eq', 'agent_key'), 'agent3');
  });

  it('por id ignora los que no son de una corrida («panel») y no consulta si no queda ninguno', async () => {
    const { client, calls } = fakeClient(() => ({ data: [row(RUN_ID)] }));
    assert.deepEqual(await listFirstContactRuns('u1', ['panel'], client), []);
    assert.equal(calls.length, 0);
    const runs = await listFirstContactRuns('u1', ['panel', RUN_ID], client);
    assert.equal(runs[0].status, 'succeeded');
    assert.deepEqual(filter(calls[0], 'in', 'id'), [RUN_ID]);
  });

  it('«Quitar» marca dismissed_at sólo en las terminadas de quien pregunta, sin perder su metadata', async () => {
    const { client, calls } = fakeClient((call) =>
      call.op === 'select' ? { data: [{ id: RUN_ID, metadata: { account_name: 'Ciisa', pack_statuses: ['draft'] } }] } : { data: null },
    );
    await dismissFirstContactRuns('u1', [RUN_ID, 'no-es-id'], client);
    const read = calls[0];
    assert.equal(filter(read, 'eq', 'triggered_by'), 'u1');
    assert.equal(filter(read, 'neq', 'status'), 'running');
    assert.deepEqual(filter(read, 'in', 'id'), [RUN_ID]);
    const write = calls[1];
    const metadata = (write.payload as { metadata: Record<string, unknown> }).metadata;
    assert.equal(metadata.account_name, 'Ciisa');
    assert.equal(typeof metadata.dismissed_at, 'string');
    assert.equal(filter(write, 'eq', 'triggered_by'), 'u1');
  });
});
