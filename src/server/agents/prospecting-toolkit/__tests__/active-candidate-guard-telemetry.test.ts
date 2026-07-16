/**
 * Q3F-5AW.2 (Phase 1) — Active Duplicate Guard prefetch telemetry (T8).
 *
 * Verifica que fetchActiveCandidatesForGuard:
 *   - degrada de forma observable (status='degraded', reason='prefetch_failed')
 *     cuando el cliente lanza, sin romper (records=[]).
 *   - degrada (reason='query_error') cuando Supabase devuelve error, sin romper.
 *   - reporta status='ok' en el camino feliz.
 *
 * El comportamiento funcional (fail-open con []) es idéntico al anterior; solo se
 * agrega observabilidad. Sin proveedores, sin Supabase real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchActiveCandidatesForGuard } from '../candidate-writer';

/** Cliente que lanza en la primera query (simula prefetch caído). */
function makeThrowingClient(): SupabaseClient {
  return {
    from() {
      throw new Error('simulated prefetch failure');
    },
  } as unknown as SupabaseClient;
}

/** Cliente que devuelve { data:null, error } en las queries (degradación suave). */
function makeQueryErrorClient(): SupabaseClient {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.in = () => builder;
  builder.eq = () => builder;
  builder.limit = () => Promise.resolve({ data: null, error: { message: 'boom' } });
  return { from: () => builder } as unknown as SupabaseClient;
}

/** Cliente feliz: devuelve filas activas. */
function makeOkClient(): SupabaseClient {
  const rows = [
    { id: 'c1', name: 'Acme', domain: 'acme.com', normalized_name: 'acme', metadata: {}, status: 'needs_review' },
  ];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.in = () => builder;
  builder.eq = () => builder;
  builder.limit = () => Promise.resolve({ data: rows, error: null });
  return { from: () => builder } as unknown as SupabaseClient;
}

describe('fetchActiveCandidatesForGuard — telemetry (T8)', () => {
  it('degradación por excepción → status=degraded, reason=prefetch_failed, records=[]', async () => {
    const out = await fetchActiveCandidatesForGuard(makeThrowingClient(), ['acme.com'], 'CO');
    assert.equal(out.status, 'degraded');
    assert.equal(out.reason, 'prefetch_failed');
    assert.deepEqual(out.records, []);
  });

  it('degradación por error de query → status=degraded, reason=query_error', async () => {
    const out = await fetchActiveCandidatesForGuard(makeQueryErrorClient(), ['acme.com'], 'CO');
    assert.equal(out.status, 'degraded');
    assert.equal(out.reason, 'query_error');
    // fail-open: no rompe, records sigue siendo [] (comportamiento funcional intacto)
    assert.deepEqual(out.records, []);
  });

  it('camino feliz → status=ok, reason=null, records poblados', async () => {
    const out = await fetchActiveCandidatesForGuard(makeOkClient(), ['acme.com'], 'CO');
    assert.equal(out.status, 'ok');
    assert.equal(out.reason, null);
    assert.ok(out.records.length >= 1);
  });

  it('sin dominios ni país → no consulta, status=ok, records=[]', async () => {
    const out = await fetchActiveCandidatesForGuard(makeOkClient(), [], null);
    assert.equal(out.status, 'ok');
    assert.equal(out.reason, null);
    assert.deepEqual(out.records, []);
  });
});
