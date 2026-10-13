// Panel del Agente 1 — lecturas paginadas y filtros de persona / rol / grupo.
//
// Antes cada tabla se leía con UNA petición y `.limit(20000)`: la API REST de
// Supabase devuelve como máximo 1.000 filas, así que con más de 1.000 lotes,
// candidatos o consultas las cifras del panel se quedaban cortas sin aviso. Y
// el panel sólo respetaba periodo y proveedor.
//
// Cliente falso en memoria: sin red, sin base de datos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAgent1EffectivenessEvidence } from '../queries';

type Row = Record<string, unknown>;

/** Cliente mínimo que imita PostgREST: filtros + .range() con 1.000 filas por página como máximo. */
function fakeClient(tables: Record<string, Row[]>, options: { failTable?: string } = {}) {
  const requests: Array<{ table: string; from: number; to: number; inFilters: Record<string, unknown[]> }> = [];
  function builder(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const ins: Record<string, unknown[]> = {};
    const gtes: Array<[string, string]> = [];
    const lts: Array<[string, string]> = [];
    const b = {
      select: () => b,
      order: () => b,
      eq: (col: string, v: unknown) => (eqs.push([col, v]), b),
      in: (col: string, v: unknown[]) => ((ins[col] = v), b),
      gte: (col: string, v: string) => (gtes.push([col, v]), b),
      lt: (col: string, v: string) => (lts.push([col, v]), b),
      range: async (from: number, to: number) => {
        requests.push({ table, from, to, inFilters: { ...ins } });
        if (options.failTable === table) return { data: null, error: { message: `falla ${table}` } };
        const rows = (tables[table] ?? []).filter(
          (r) =>
            eqs.every(([c, v]) => r[c] === v) &&
            Object.entries(ins).every(([c, vs]) => vs.includes(r[c])) &&
            gtes.every(([c, v]) => String(r[c]) >= v) &&
            lts.every(([c, v]) => String(r[c]) < v),
        );
        const end = Math.min(to + 1, from + 1000);
        return { data: rows.slice(from, end), error: null };
      },
    };
    return b;
  }
  return { client: { from: (t: string) => builder(t) }, requests };
}

function batch(i: number, createdBy = 'u1'): Row {
  return {
    id: `b${i}`,
    status: 'completed',
    country_code: 'CO',
    industry: 'tech',
    created_by: createdBy,
    created_at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`,
    source: 'ai',
    name: `Lote ${i}`,
    metadata: {},
  };
}

function usage(i: number, batchId: string, providerKey = 'apollo'): Row {
  return {
    id: `l${i}`,
    batch_id: batchId,
    provider_key: providerKey,
    operation_key: 'organizations_search',
    status: 'success',
    estimated_cost_usd: 0.01,
    credits_used: 1,
    results_returned: 1,
  };
}

describe('fetchAgent1EffectivenessEvidence — paginación', () => {
  it('lee las 2.500 consultas de costo, no sólo las primeras 1.000', async () => {
    const batches = [batch(1)];
    const logs = Array.from({ length: 2500 }, (_, i) => usage(i, 'b1'));
    const { client } = fakeClient({ prospect_batches: batches, provider_usage_logs: logs });
    const evidence = await fetchAgent1EffectivenessEvidence({}, { client });
    assert.equal(evidence.usageLogs.length, 2500);
    assert.equal(evidence.readTruncated, false);
  });

  it('lee más de 1.000 lotes y parte la lista de lotes en trozos para el filtro .in()', async () => {
    const batches = Array.from({ length: 1200 }, (_, i) => batch(i));
    const { client, requests } = fakeClient({ prospect_batches: batches, provider_usage_logs: [] });
    const evidence = await fetchAgent1EffectivenessEvidence({}, { client });
    assert.equal(evidence.batches.length, 1200);
    const usageRequests = requests.filter((r) => r.table === 'provider_usage_logs');
    assert.ok(usageRequests.length >= 6, 'los 1.200 lotes viajan en varios trozos');
    for (const r of usageRequests) assert.ok((r.inFilters.batch_id ?? []).length <= 200);
  });

  it('un error de lectura lanza (el panel muestra su aviso de error)', async () => {
    const { client } = fakeClient(
      { prospect_batches: [batch(1)], provider_usage_logs: [] },
      { failTable: 'provider_usage_logs' },
    );
    await assert.rejects(() => fetchAgent1EffectivenessEvidence({}, { client }), /provider_usage_logs/);
  });
});

describe('fetchAgent1EffectivenessEvidence — filtros de persona / rol / grupo', () => {
  it('createdByIds limita los lotes a esas personas', async () => {
    const { client } = fakeClient({
      prospect_batches: [batch(1, 'u1'), batch(2, 'u2'), batch(3, 'u3')],
      provider_usage_logs: [usage(1, 'b1'), usage(2, 'b2'), usage(3, 'b3')],
    });
    const evidence = await fetchAgent1EffectivenessEvidence({ createdByIds: ['u2', 'u3'] }, { client });
    assert.deepEqual(evidence.batches.map((b) => b.id).sort(), ['b2', 'b3']);
    assert.deepEqual(evidence.usageLogs.map((u) => u.batchId).sort(), ['b2', 'b3']);
  });

  it('createdByIds vacío (los filtros no dejan a nadie) no lee nada', async () => {
    const { client, requests } = fakeClient({ prospect_batches: [batch(1)] });
    const evidence = await fetchAgent1EffectivenessEvidence({ createdByIds: [] }, { client });
    assert.equal(evidence.batches.length, 0);
    assert.equal(requests.length, 0);
  });

  it('el proveedor sigue filtrando sólo las filas de costo', async () => {
    const { client } = fakeClient({
      prospect_batches: [batch(1)],
      provider_usage_logs: [usage(1, 'b1', 'apollo'), usage(2, 'b1', 'tavily')],
    });
    const evidence = await fetchAgent1EffectivenessEvidence({ providerKey: 'tavily' }, { client });
    assert.equal(evidence.batches.length, 1);
    assert.deepEqual(evidence.usageLogs.map((u) => u.providerKey), ['tavily']);
  });
});
