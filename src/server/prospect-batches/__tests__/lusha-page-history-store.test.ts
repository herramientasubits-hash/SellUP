/**
 * AGENT1-LUSHA-PAGE-CURSOR-1 — la lectura del historial de páginas.
 *
 * Con un doble del cliente: comprueba QUÉ se pide (firma y versión, sin la
 * operación en curso, en orden cronológico) y que un error se propaga en vez de
 * convertirse en «sin historial».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadLushaPageHistory } from '../lusha-page-history-store';

type Call = { table: string; op: string; args: unknown[] };

function fakeClient(opts: {
  operations: { operation_id: string }[];
  fence: Record<string, unknown>[];
  opsError?: string;
  fenceError?: string;
}) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const self: Record<string, unknown> = {};
    const record =
      (op: string) =>
      (...args: unknown[]) => {
        calls.push({ table, op, args });
        return self;
      };
    for (const op of ['select', 'eq', 'neq', 'in', 'order']) self[op] = record(op);
    self.limit = (...args: unknown[]) => {
      calls.push({ table, op: 'limit', args });
      const isOps = table === 'lusha_prospecting_operations';
      const error = isOps ? opts.opsError : opts.fenceError;
      return Promise.resolve(
        error
          ? { data: null, error: { message: error } }
          : { data: isOps ? opts.operations : opts.fence, error: null },
      );
    };
    return self;
  };
  const client = { from: (table: string) => builder(table) } as unknown as SupabaseClient;
  return { client, calls };
}

const QUERY = { signatureVersion: 'v1', signatureHash: 'ba24968a63', excludeOperationId: 'op-now' };

describe('lectura del historial de páginas de una búsqueda', () => {
  it('pide por firma y versión, excluye la operación en curso y ordena por fecha', async () => {
    const { client, calls } = fakeClient({
      operations: [{ operation_id: 'op-22' }, { operation_id: 'op-23' }],
      // La base las devuelve de la más reciente a la más vieja.
      fence: [
        { branch_index: 0, page_index: 1, state: 'succeeded', results_returned: 25 },
        { branch_index: 0, page_index: 0, state: 'succeeded', results_returned: 25 },
      ],
    });
    const rows = await loadLushaPageHistory(QUERY, client);
    // …y la lectura las entrega en orden cronológico.
    assert.deepEqual(rows, [
      { branchIndex: 0, pageIndex: 0, state: 'succeeded', resultsReturned: 25 },
      { branchIndex: 0, pageIndex: 1, state: 'succeeded', resultsReturned: 25 },
    ]);
    const has = (table: string, op: string, first: unknown) =>
      calls.some((c) => c.table === table && c.op === op && c.args[0] === first);
    assert.ok(has('lusha_prospecting_operations', 'eq', 'request_signature_hash'));
    assert.ok(has('lusha_prospecting_operations', 'eq', 'request_signature_version'));
    assert.ok(has('lusha_prospecting_operations', 'neq', 'operation_id'));
    assert.ok(has('lusha_prospecting_request_fence', 'order', 'claimed_at'));
    const inCall = calls.find(
      (c) => c.table === 'lusha_prospecting_request_fence' && c.op === 'in',
    );
    assert.deepEqual(inCall?.args, ['operation_id', ['op-22', 'op-23']]);
  });

  it('🔴 con los topes, se queda con lo MÁS RECIENTE, no con lo más viejo', async () => {
    const { client, calls } = fakeClient({
      operations: [{ operation_id: 'op-1' }],
      fence: [],
    });
    await loadLushaPageHistory(QUERY, client);
    const order = (table: string) => calls.find((c) => c.table === table && c.op === 'order')?.args;
    assert.deepEqual(order('lusha_prospecting_operations'), ['created_at', { ascending: false }]);
    assert.deepEqual(order('lusha_prospecting_request_fence'), [
      'claimed_at',
      { ascending: false },
    ]);
  });

  it('🔴 la firma NO se acota por actor: la página 0 de otra usuaria es la misma página 0', async () => {
    const { client, calls } = fakeClient({ operations: [], fence: [] });
    await loadLushaPageHistory(QUERY, client);
    assert.ok(!calls.some((c) => c.op === 'eq' && c.args[0] === 'actor_scope'));
  });

  it('sin operaciones previas no consulta la valla', async () => {
    const { client, calls } = fakeClient({ operations: [], fence: [] });
    assert.deepEqual(await loadLushaPageHistory(QUERY, client), []);
    assert.ok(!calls.some((c) => c.table === 'lusha_prospecting_request_fence'));
  });

  it('🔴 un error se PROPAGA: nunca se disfraza de «sin historial»', async () => {
    await assert.rejects(
      loadLushaPageHistory(
        QUERY,
        fakeClient({ operations: [], fence: [], opsError: 'boom' }).client,
      ),
      /lusha_prospecting_operations: boom/,
    );
    await assert.rejects(
      loadLushaPageHistory(
        QUERY,
        fakeClient({ operations: [{ operation_id: 'op-1' }], fence: [], fenceError: 'kaput' })
          .client,
      ),
      /lusha_prospecting_request_fence: kaput/,
    );
  });

  it('sin operación en curso no añade el filtro de exclusión', async () => {
    const { client, calls } = fakeClient({ operations: [], fence: [] });
    await loadLushaPageHistory({ ...QUERY, excludeOperationId: null }, client);
    assert.ok(!calls.some((c) => c.op === 'neq'));
  });
});
