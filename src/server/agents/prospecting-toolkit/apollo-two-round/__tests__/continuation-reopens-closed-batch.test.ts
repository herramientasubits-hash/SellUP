/**
 * Prod 17-11 (masiva MX × Manufactura, lote 58b2270e): «Claude busca empresas»
 * escribió DESPUÉS de encolar la continuación de Apollo y cerró el lote
 * (`ready_for_review`). La continuación falló con «cannot receive pipeline results»
 * y la masiva quedó parada en 49/50. Ahora la continuación reabre SÓLO un lote en
 * `ready_for_review` y, si no escribe, lo devuelve como estaba.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  reopenClosedBatchForContinuation,
  restoreClosedBatchAfterContinuation,
} from '../continuation-worker.server';

type Row = { id: string; status: string };

function fakeClient(rows: Row[]): SupabaseClient {
  return {
    from: () => {
      let patch: Partial<Row> = {};
      const filters: Array<[keyof Row, string]> = [];
      const run = () => {
        const hit = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
        hit.forEach((row) => Object.assign(row, patch));
        return { data: hit.map((row) => ({ id: row.id })), error: null };
      };
      const chain = {
        update(next: Partial<Row>) {
          patch = next;
          return chain;
        },
        eq(key: keyof Row, value: string) {
          filters.push([key, value]);
          return chain;
        },
        select: async () => run(),
        then(resolve: (value: unknown) => void) {
          resolve(run());
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe('continuación de Apollo sobre un lote ya cerrado', () => {
  it('reabre un lote en ready_for_review y lo devuelve si no escribió', async () => {
    const rows = [{ id: 'b1', status: 'ready_for_review' }];
    const client = fakeClient(rows);
    assert.equal(await reopenClosedBatchForContinuation(client, 'b1'), true);
    assert.equal(rows[0].status, 'generating');
    await restoreClosedBatchAfterContinuation(client, 'b1');
    assert.equal(rows[0].status, 'ready_for_review');
  });

  it('no toca un lote que la persona ya tomó ni uno que sigue generando', async () => {
    const rows = [
      { id: 'b1', status: 'in_review' },
      { id: 'b2', status: 'generating' },
    ];
    const client = fakeClient(rows);
    assert.equal(await reopenClosedBatchForContinuation(client, 'b1'), false);
    assert.equal(await reopenClosedBatchForContinuation(client, 'b2'), false);
    assert.deepEqual(rows.map((row) => row.status), ['in_review', 'generating']);
  });

  it('el worker reabre antes de reanudar y restaura si falla o no escribe', () => {
    const source = readFileSync(join(__dirname, '..', 'continuation-worker.server.ts'), 'utf8');
    const resume = source.slice(source.indexOf('resumeRun: async'));
    const reopenAt = resume.indexOf('reopenClosedBatchForContinuation(client, job.batchId)');
    const runAt = resume.indexOf('runApolloTwoRoundWizardDiscovery(runInput');
    assert.ok(reopenAt > 0 && reopenAt < runAt);
    assert.match(resume, /catch \(error\) \{\s*if \(reopened\) await restoreClosedBatchAfterContinuation/);
    assert.match(resume, /reopened && outcome\.persistenceOutcome === undefined/);
  });
});
