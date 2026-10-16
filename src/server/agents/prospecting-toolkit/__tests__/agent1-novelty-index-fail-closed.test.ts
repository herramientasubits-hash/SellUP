/**
 * AGENT1-NOVELTY-INDEX-DEGRADED-1 · AGENT1-SELECT-NO-SILENT-CAP-1 ·
 * AGENT1-CLAIM-CONFLICT-NOVELTY-1 — la memoria de novedad y la negativa no
 * mienten cuando no pudieron leer, no se cortan en 1.000 filas, y una empresa
 * que perdió una carrera de reclamo vuelve a proponerse cuando el ganador la
 * suelta.
 *
 * Sin red, sin base: un doble de cliente que registra las consultas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildNoveltyIndex,
  buildRecentIdentityKeySet,
  evaluateCandidateNovelty,
  NoveltyIndexUnavailableError,
} from '../novelty-checker';
import { loadDiscoveryNegativeMemory } from '../discovery-negative-memory';
import { chunk, selectAllRows, SUPABASE_PAGE_SIZE, type PageableQuery } from '../paginated-select';
import { createFakeSupabase, filterValue, type RecordedQuery } from './support/fake-supabase-query';

const asClient = (client: unknown) => client as SupabaseClient;

function candidateRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'c-x',
    batch_id: 'b-x',
    name: 'Acme',
    domain: 'acme.com',
    website: null,
    status: 'needs_review',
    duplicate_status: 'no_match',
    reviewed_at: null,
    updated_at: null,
    created_at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

describe('buildNoveltyIndex — fail-closed', () => {
  it('🔴 un error de lectura LANZA (antes devolvía un índice vacío = «todo es nuevo»)', async () => {
    const { client } = createFakeSupabase(() => ({ data: null, error: { code: '57014' } }));
    await assert.rejects(
      buildNoveltyIndex(asClient(client), ['acme.com']),
      (err: unknown) => err instanceof NoveltyIndexUnavailableError && err.code === '57014',
    );
  });

  it('sin dominios no consulta nada', async () => {
    const { client, queries } = createFakeSupabase(() => ({ data: [], error: null }));
    const index = await buildNoveltyIndex(asClient(client), [null, '']);
    assert.equal(index.size, 0);
    assert.equal(queries.length, 0);
  });

  it('trocea los dominios: 250 dominios ⇒ 3 consultas de ≤ 100', async () => {
    const domains = Array.from({ length: 250 }, (_, i) => `d${i}.com`);
    const { client, queries } = createFakeSupabase(() => ({ data: [], error: null }));
    await buildNoveltyIndex(asClient(client), domains);
    const sizes = queries.map((q) => (filterValue(q, 'in', 'domain') as string[]).length);
    assert.deepEqual(sizes, [100, 100, 50]);
  });

  it('🔴 una página llena se completa paginando por id (antes se perdía todo tras la fila 1.000)', async () => {
    const total = SUPABASE_PAGE_SIZE + 7;
    const all = Array.from({ length: total }, (_, i) =>
      candidateRow({ id: `c${String(i).padStart(5, '0')}`, domain: 'grande.com' }),
    );
    const { client, queries } = createFakeSupabase((q: RecordedQuery) => {
      if (q.range) return { data: all.slice(q.range[0], q.range[1] + 1), error: null };
      return { data: all.slice(0, SUPABASE_PAGE_SIZE), error: null };
    });
    const index = await buildNoveltyIndex(asClient(client), ['grande.com']);
    assert.equal(index.get('grande.com')?.length, total);
    assert.ok(queries.some((q) => q.order === 'id' && q.range !== null));
  });
});

describe('Regla 3 — perdedora de una carrera de reclamo', () => {
  const loser = (holder: string) =>
    candidateRow({
      id: 'loser',
      status: 'duplicate',
      duplicate_status: 'exact_duplicate',
      metadata: { global_identity_claim_conflict: { held_by_candidate_id: holder } },
    });

  it('🔴 si el ganador YA no tiene reclamos activos, la perdedora deja de bloquear', async () => {
    const { client } = createFakeSupabase((q) => {
      if (q.table === 'agent1_company_identity_claims') return { data: [], error: null };
      return { data: [loser('winner-gone')], error: null };
    });
    const index = await buildNoveltyIndex(asClient(client), ['acme.com']);
    const verdict = evaluateCandidateNovelty({ name: 'Acme', domain: 'acme.com', website: null }, index);
    assert.equal(verdict.shouldSkip, false, 'antes: confirmed_duplicate para siempre');
  });

  it('si el ganador SIGUE vivo, sigue bloqueando como duplicado exacto', async () => {
    const { client } = createFakeSupabase((q) => {
      if (q.table === 'agent1_company_identity_claims') {
        return { data: [{ candidate_id: 'winner-live' }], error: null };
      }
      return { data: [loser('winner-live')], error: null };
    });
    const index = await buildNoveltyIndex(asClient(client), ['acme.com']);
    const verdict = evaluateCandidateNovelty({ name: 'Acme', domain: 'acme.com', website: null }, index);
    assert.equal(verdict.status, 'confirmed_duplicate');
  });

  it('si no se puede leer el estado del ganador, sigue bloqueando (nunca se libera por un fallo)', async () => {
    const { client } = createFakeSupabase((q) => {
      if (q.table === 'agent1_company_identity_claims') return { data: null, error: { code: 'X' } };
      return { data: [loser('winner-unknown')], error: null };
    });
    const index = await buildNoveltyIndex(asClient(client), ['acme.com']);
    const verdict = evaluateCandidateNovelty({ name: 'Acme', domain: 'acme.com', website: null }, index);
    assert.equal(verdict.status, 'confirmed_duplicate');
  });

  it('un duplicado de verdad (sin marca de carrera) sigue bloqueando siempre', async () => {
    const { client } = createFakeSupabase(() => ({
      data: [candidateRow({ status: 'duplicate', duplicate_status: 'exact_duplicate' })],
      error: null,
    }));
    const index = await buildNoveltyIndex(asClient(client), ['acme.com']);
    const verdict = evaluateCandidateNovelty({ name: 'Acme', domain: 'acme.com', website: null }, index);
    assert.equal(verdict.status, 'confirmed_duplicate');
  });
});

describe('buildRecentIdentityKeySet — fail-closed y sin corte', () => {
  it('🔴 un error de lectura de lotes LANZA (antes: Set vacío)', async () => {
    const { client } = createFakeSupabase(() => ({ data: null, error: { code: 'E1' } }));
    await assert.rejects(buildRecentIdentityKeySet(asClient(client)), NoveltyIndexUnavailableError);
  });

  it('🔴 un error de lectura de nombres LANZA', async () => {
    const { client } = createFakeSupabase((q) =>
      q.table === 'prospect_batches' ? { data: [{ id: 'b1' }], error: null } : { data: null, error: { code: 'E2' } },
    );
    await assert.rejects(buildRecentIdentityKeySet(asClient(client)), NoveltyIndexUnavailableError);
  });

  it('trocea los ids de lote (cientos en una URL pueden fallar)', async () => {
    const batches = Array.from({ length: 230 }, (_, i) => ({ id: `b${i}` }));
    const { client, queries } = createFakeSupabase((q) =>
      q.table === 'prospect_batches' ? { data: batches, error: null } : { data: [{ name: 'Siesa' }], error: null },
    );
    const keys = await buildRecentIdentityKeySet(asClient(client));
    const nameQueries = queries.filter((q) => q.table === 'prospect_candidates');
    assert.deepEqual(
      nameQueries.map((q) => (filterValue(q, 'in', 'batch_id') as string[]).length),
      [100, 100, 30],
    );
    assert.ok(keys.size >= 1);
  });
});

describe('loadDiscoveryNegativeMemory — degradada y completa', () => {
  const scope = { countryCode: 'CO', industryName: 'Tecnología', subindustryNames: [], lookbackDays: 30 };

  it('🔴 un error devuelve memoria vacía MARCADA degraded (antes, indistinguible de «nada»)', async () => {
    const { client } = createFakeSupabase(() => ({ data: null, error: { code: 'E' } }));
    const memory = await loadDiscoveryNegativeMemory(asClient(client), scope);
    assert.equal(memory.degraded, true);
    assert.equal(memory.excludedDomains.size, 0);
  });

  it('🔴 más de 1.000 filas recientes se leen todas', async () => {
    const total = SUPABASE_PAGE_SIZE + 3;
    const rows = Array.from({ length: total }, (_, i) => ({
      batch_id: 'b',
      domain: `n${i}.com`,
      name: `Empresa ${i}`,
      status: 'needs_review',
      duplicate_status: 'no_match',
      source_primary: 'apollo',
      review_notes: null,
      metadata: {},
    }));
    const { client } = createFakeSupabase((q) =>
      q.range ? { data: rows.slice(q.range[0], q.range[1] + 1), error: null } : { data: rows.slice(0, SUPABASE_PAGE_SIZE), error: null },
    );
    const memory = await loadDiscoveryNegativeMemory(asClient(client), scope);
    assert.equal(memory.excludedDomains.size, total);
    assert.notEqual(memory.degraded, true);
  });
});

describe('paginated-select', () => {
  it('chunk trocea sin perder ni repetir', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });

  it('un error en una página intermedia no devuelve filas parciales', async () => {
    let call = 0;
    const page = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    const build = (): PageableQuery<{ id: number }> => {
      const q = {
        order: () => q,
        range: (from: number) =>
          Promise.resolve(from === 0 ? { data: page, error: null } : { data: null, error: { code: 'X' } }),
        then: (resolve: (v: { data: { id: number }[]; error: null }) => unknown) => {
          call += 1;
          return Promise.resolve({ data: page, error: null }).then(resolve);
        },
      };
      return q as unknown as PageableQuery<{ id: number }>;
    };
    const result = await selectAllRows(build, 4);
    assert.ok(result.error);
    assert.deepEqual(result.rows, []);
    assert.equal(call, 1);
  });
});
