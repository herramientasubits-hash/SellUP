/**
 * AGENT1-AUDIT-WS2 §§ 5, 8, 11 + extra WS1 — bandeja de corridas, candado de las
 * acciones de Claude y la recuperación de continuaciones por dueño. Sin red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_RUNS_STORAGE_KEY,
  CONTINUATION_NOT_QUEUED_MESSAGE,
  DETACHED_RUN_STALE_AFTER_MS,
  DETACHED_RUN_STALE_MESSAGE,
  createAgentRunsStore,
  isDetachedRunStale,
  type AgentRun,
} from '../agent-runs/agent-runs-store';
import { describeAgentRun } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray-copy';
import type { WizardExecutionActionResult } from '../chat-wizard-execution/wizard-execution-types';
import {
  CLAUDE_ACTION_LOCK_TTL_MS,
  acquireClaudeActionLock,
  isClaudeActionLockHeld,
  releaseClaudeActionLock,
  type ClaudeActionLockClient,
} from '../claude-action-lock';
import { listOpenContinuationBatchIds, type ApolloContinuationReadClient } from '../apollo-continuation-read.server';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

const detachedRun = (startedAtMs: number): AgentRun => ({
  clientRequestId: ID_A, title: 't', status: 'running', createdAtMs: startedAtMs, startedAtMs, finishedAtMs: null,
  batchId: null, redirectPath: null, candidateCount: null, message: null, detached: true,
});

describe('§ 8 — desligadas que ya no pueden estar corriendo', () => {
  it('al restaurar, una desligada de hace más de 10 min se cierra como fallida', () => {
    const storage = memoryStorage({ [AGENT_RUNS_STORAGE_KEY]: JSON.stringify([detachedRun(0)]) });
    const store = createAgentRunsStore({ execute: async () => ({}) as never, storage, nowMs: () => DETACHED_RUN_STALE_AFTER_MS + 1 });
    const run = store.getSnapshot()[0]!;
    assert.equal(run.status, 'failed');
    assert.equal(run.message, DETACHED_RUN_STALE_MESSAGE);
  });

  it('expireStaleDetached la cierra mientras la página sigue abierta y libera el lugar', () => {
    let now = 1_000;
    const storage = memoryStorage({ [AGENT_RUNS_STORAGE_KEY]: JSON.stringify([detachedRun(1_000)]) });
    const store = createAgentRunsStore({ execute: async () => ({}) as never, storage, nowMs: () => now });
    assert.equal(store.getSnapshot()[0]!.status, 'running');
    store.expireStaleDetached();
    assert.equal(store.getSnapshot()[0]!.status, 'running', 'reciente: sigue');
    now = 1_000 + DETACHED_RUN_STALE_AFTER_MS + 1;
    store.expireStaleDetached();
    assert.equal(store.getSnapshot()[0]!.status, 'failed');
  });

  it('una desligada se puede quitar; una en curso normal no', () => {
    const storage = memoryStorage({ [AGENT_RUNS_STORAGE_KEY]: JSON.stringify([detachedRun(1_000)]) });
    const store = createAgentRunsStore({ execute: async () => ({}) as never, storage, nowMs: () => 2_000 });
    assert.equal(describeAgentRun(store.getSnapshot()[0]!, null).dismissible, true);
    store.dismiss(ID_A);
    assert.equal(store.getSnapshot().length, 0);
    assert.equal(describeAgentRun({ ...detachedRun(1), detached: false }, null).dismissible, false);
    assert.equal(isDetachedRunStale({ ...detachedRun(0), detached: false }, 10 ** 9), false);
  });

  it('almacenamiento que lanza ⇒ la bandeja funciona en memoria', () => {
    const throwing = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('quota'); } };
    const store = createAgentRunsStore({ execute: async () => ({}) as never, storage: throwing });
    assert.deepEqual(store.getSnapshot(), []);
  });
});

describe('§ 5 — la bandeja sólo dice «en pausa» con la continuación en cola', () => {
  const ok = (extra: Record<string, unknown>) =>
    ({ ok: true, status: 'success_partial', batchId: 'b', redirectPath: '/prospect-batches/b', candidateCount: 3, ...extra }) as unknown as WizardExecutionActionResult;

  it('pausa encolada ⇒ continuationPending; pausa sin cola ⇒ fallida con enlace; revisables primero', async () => {
    const results = [
      ok({ apolloContinuation: { enqueued: true, pendingOrganizationCount: 4 } }),
      ok({ apolloContinuationFailure: { pendingOrganizationCount: 4, reason: 'x' } }),
    ];
    const store = createAgentRunsStore({ execute: async () => results.shift()!, nowMs: () => 1 });
    await store.startRun({ title: 'a', concurrencyKey: 'a', payload: { clientRequestId: ID_A } });
    await store.startRun({ title: 'b', concurrencyKey: 'b', payload: { clientRequestId: ID_B } });
    const byId = new Map(store.getSnapshot().map((r) => [r.clientRequestId, r]));
    assert.equal(byId.get(ID_A)!.continuationPending, true);
    assert.equal(byId.get(ID_B)!.status, 'failed');
    assert.equal(byId.get(ID_B)!.message, CONTINUATION_NOT_QUEUED_MESSAGE);
    assert.equal(byId.get(ID_B)!.redirectPath, '/prospect-batches/b');
  });

  it('§ F: «Terminada: N» usa lo revisable si el servidor lo midió', async () => {
    const store = createAgentRunsStore({ execute: async () => ok({ candidateCount: 7, reviewableCandidateCount: 4 }), nowMs: () => 1 });
    await store.startRun({ title: 'a', payload: { clientRequestId: ID_A } });
    assert.equal(store.getSnapshot()[0]!.candidateCount, 4);
  });
});

/** Doble de `prospect_batches` con UPDATE condicional por la marca del candado. */
function lockTable(initialMetadata: Record<string, unknown> | null) {
  const row = { metadata: initialMetadata };
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row.metadata === null ? null : { metadata: row.metadata }, error: null }) }) }),
      update: (values: { metadata: Record<string, unknown> }) => ({
        eq: () => ({
          or: (filters: string) => ({
            select: async () => {
              // Reevalúa la condición sobre la fila ACTUAL (como Postgres tras bloquearla).
              const kind = /->>(\w+)\./.exec(filters)?.[1] ?? '';
              const locks = (row.metadata?.claude_action_locks ?? {}) as Record<string, string>;
              const current = locks[kind];
              const free = filters.includes('.not.is.null')
                ? current !== undefined
                : current === undefined || current < (/\.lt\.(.+)$/.exec(filters)?.[1] ?? '');
              if (!free) return { data: [], error: null };
              row.metadata = values.metadata;
              return { data: [{ id: 'b' }], error: null };
            },
          }),
        }),
      }),
    }),
  } as unknown as ClaudeActionLockClient;
  return { row, client };
}

describe('§ 11 — dos clics no pagan dos corridas de Claude', () => {
  it('el segundo ve «busy»; al soltar se puede volver a tomar; caducada se puede tomar', async () => {
    const { row, client } = lockTable({ other: 1 });
    assert.equal(await acquireClaudeActionLock(client, 'b', 'classify', 1_000), 'acquired');
    assert.equal(await acquireClaudeActionLock(client, 'b', 'classify', 2_000), 'busy');
    assert.equal(await acquireClaudeActionLock(client, 'b', 'rescue', 2_000), 'acquired', 'otra acción, otra marca');
    assert.equal((row.metadata as Record<string, unknown>).other, 1, 'no pisa el resto de la metadata');
    await releaseClaudeActionLock(client, 'b', 'classify');
    assert.equal(isClaudeActionLockHeld(row.metadata, 'classify', 3_000), false);
    assert.equal(await acquireClaudeActionLock(client, 'b', 'classify', 3_000), 'acquired');
    assert.equal(
      await acquireClaudeActionLock(client, 'b', 'classify', 3_000 + CLAUDE_ACTION_LOCK_TTL_MS + 1),
      'acquired',
      'un proceso muerto no deja el lote bloqueado',
    );
  });

  it('sin lote o con error ⇒ unavailable (fail-closed)', async () => {
    const { client } = lockTable(null);
    assert.equal(await acquireClaudeActionLock(client, 'b', 'classify', 1), 'unavailable');
  });
});

describe('extra WS1 — la recuperación sólo mira la cola de la persona', () => {
  it('con `createdBy` filtra por el dueño del lote EN la consulta', async () => {
    const calls: string[] = [];
    const chain = {
      in: (c: string) => (calls.push(`in:${c}`), chain),
      order: () => ({ limit: async () => ({ data: [{ batch_id: 'mine' }], error: null }) }),
    };
    const client = {
      from: () => ({
        select: (cols: string) => {
          calls.push(`select:${cols}`);
          return { eq: (c: string, v: string) => (calls.push(`eq:${c}=${v}`), chain), in: chain.in };
        },
      }),
    } as unknown as ApolloContinuationReadClient;
    assert.deepEqual(await listOpenContinuationBatchIds(10, client, { createdBy: 'user-1' }), ['mine']);
    assert.ok(calls.some((c) => c.includes('prospect_batches!inner(created_by)')));
    assert.ok(calls.includes('eq:prospect_batches.created_by=user-1'));
  });
});
