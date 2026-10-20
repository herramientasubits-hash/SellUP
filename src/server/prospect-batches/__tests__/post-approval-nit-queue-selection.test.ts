/**
 * AGENT1-AUDIT-WS1 — selección del worker de enriquecimiento oficial
 * post-aprobación.
 *
 * Defectos que cubre:
 *   1. Se pedían 60 convertidos cualesquiera, sin orden ni filtro por el estado
 *      del bloque, y se filtraba en JS ⇒ con más de 60 convertidos ya procesados
 *      los encolados no salían nunca. Ahora el estado se filtra en la base y se
 *      ordena por antigüedad.
 *   2. El disparador encola México SIN RFC (DENUE busca por nombre), pero el
 *      worker exigía NIT ⇒ esos candidatos quedaban `queued` para siempre.
 *
 * Sin red ni base: cliente en memoria que registra la consulta.
 *
 * Correr: node --import tsx --test src/server/prospect-batches/__tests__/post-approval-nit-queue-selection.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isPostApprovalNitQueueEligible,
  selectQueuedCandidates,
  type CandidateRow,
} from '../post-approval-nit-enrichment-worker';

function row(overrides: Partial<CandidateRow> & { pae?: Record<string, unknown> | null } = {}): CandidateRow {
  const { pae, ...rest } = overrides;
  return {
    id: 'c-1',
    batch_id: 'b-1',
    name: 'Empresa',
    status: 'converted_to_account',
    converted_account_id: 'a-1',
    tax_identifier: null,
    country_code: 'CO',
    sector_code: null,
    sector_description: null,
    metadata:
      pae === null
        ? {}
        : { post_approval_enrichment: { status: 'queued', strategy: 'nit_first', nit: '900123456', ...(pae ?? {}) } },
    ...rest,
  };
}

function recordingClient(rows: CandidateRow[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain = {
    select: (cols: string) => (calls.push(['select', cols]), chain),
    eq: (col: string, val: unknown) => (calls.push(['eq', col, val]), chain),
    not: (col: string, op: string, val: unknown) => (calls.push(['not', col, op, val]), chain),
    order: (col: string, opts: unknown) => (calls.push(['order', col, opts]), chain),
    limit: (n: number) => (calls.push(['limit', n]), Promise.resolve({ data: rows, error: null })),
  };
  const client = { from: (table: string) => (calls.push(['from', table]), chain) } as unknown as SupabaseClient;
  return { client, calls };
}

describe('selección de encolados post-aprobación', () => {
  it('filtra el estado del bloque EN LA BASE y ordena por antigüedad', async () => {
    const { client, calls } = recordingClient([row()]);
    await selectQueuedCandidates(client, 5);
    assert.deepEqual(calls[0], ['from', 'prospect_candidates']);
    assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'status' && c[2] === 'converted_to_account'));
    assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'metadata->post_approval_enrichment->>status' && c[2] === 'queued'));
    assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'metadata->post_approval_enrichment->>strategy' && c[2] === 'nit_first'));
    assert.deepEqual(
      calls.find((c) => c[0] === 'order'),
      ['order', 'updated_at', { ascending: true }],
    );
    assert.deepEqual(calls.at(-1), ['limit', 30]);
  });

  it('México sin RFC entra (DENUE por nombre), igual que lo encola el disparador', async () => {
    const mx = row({ id: 'mx', country_code: 'MX', pae: { nit: undefined } });
    delete (mx.metadata!.post_approval_enrichment as Record<string, unknown>).nit;
    const { client } = recordingClient([mx]);
    const result = await selectQueuedCandidates(client, 5);
    assert.deepEqual(result.map((c) => c.id), ['mx']);
  });

  it('fuera de México, sin NIT no entra (ningún adaptador corre sin identificador)', () => {
    const co = row({ country_code: 'CO' });
    delete (co.metadata!.post_approval_enrichment as Record<string, unknown>).nit;
    assert.equal(isPostApprovalNitQueueEligible(co), false);
    assert.equal(isPostApprovalNitQueueEligible(row({ country_code: 'PE', pae: { nit: '   ' } })), false);
  });

  it('México con un NIT vacío o basura no entra por el camino de nombre', () => {
    assert.equal(isPostApprovalNitQueueEligible(row({ country_code: 'MX', pae: { nit: '  ' } })), false);
    assert.equal(isPostApprovalNitQueueEligible(row({ country_code: 'MX', pae: { nit: 12 } })), false);
  });

  it('sólo encolados con estrategia nit_first; el resto sigue fuera', () => {
    assert.equal(isPostApprovalNitQueueEligible(row()), true);
    assert.equal(isPostApprovalNitQueueEligible(row({ pae: { status: 'completed' } })), false);
    assert.equal(isPostApprovalNitQueueEligible(row({ pae: { strategy: 'otra' } })), false);
    assert.equal(isPostApprovalNitQueueEligible(row({ pae: null })), false);
  });
});
