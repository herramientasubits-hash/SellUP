/**
 * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — `page-fence.server.ts`.
 *
 * Prueba el ESCRITOR real (relectura + comparación-y-cambio + reintento), con
 * un cliente falso que emula el filtro JSON de PostgREST sobre `fence_version`
 * — el mismo patrón que ya usa `apollo-two-round-same-run-concurrency.test.ts`
 * para el checkpoint de ronda, aplicado a la clave de metadata de la valla.
 *
 * Sin Supabase real, sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  readApolloPageFenceEntries,
  upsertApolloPageFenceEntry,
  clearApolloPageFenceRoundDurable,
} from '../page-fence.server';
import { APOLLO_PAGE_FENCE_METADATA_KEY, type ApolloPageFenceEntry, type ApolloPageFenceDocumentV1 } from '../page-fence';
import type { CheckpointStoreClient } from '../checkpoint.server';

const BATCH_ID = 'batch-1';
const IDENTITY = { idempotencyKey: 'idem-1', requestFingerprint: 'fp-1' };

function fakeStore(): { client: CheckpointStoreClient; document: () => Record<string, unknown> } {
  let document: Record<string, unknown> = {};
  const client: CheckpointStoreClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { metadata: document }, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        const apply = (matches: boolean) => ({
          select: async () => {
            if (!matches) return { data: [], error: null };
            document = values['metadata'] as Record<string, unknown>;
            return { data: [{ id: BATCH_ID }], error: null };
          },
        });
        return {
          eq: () => ({
            eq: (column: string, value: string) => {
              const stored = document[APOLLO_PAGE_FENCE_METADATA_KEY] as
                | { fence_version?: number }
                | undefined;
              return apply(
                column.includes('fence_version') && String(stored?.fence_version ?? '') === value,
              );
            },
            is: () => apply(document[APOLLO_PAGE_FENCE_METADATA_KEY] === undefined),
          }),
        };
      },
    }),
  } as unknown as CheckpointStoreClient;

  return { client, document: () => document };
}

function pageEntry(overrides: Partial<ApolloPageFenceEntry> = {}): ApolloPageFenceEntry {
  return {
    round_number: 1,
    search_plan_fingerprint: 'fp-round-1',
    page: 1,
    status: 'request_started',
    organizations: [],
    credits: 1,
    results_returned: 0,
    total_pages: null,
    accepted_count: null,
    ...overrides,
  };
}

/** Desenvuelve un `ApolloPageFenceReadOutcome` esperado como lectura exitosa. */
function expectRead(outcome: Awaited<ReturnType<typeof readApolloPageFenceEntries>>): ApolloPageFenceEntry[] {
  assert.equal(outcome.kind, 'read', 'se esperaba una lectura exitosa, no un fallo');
  return outcome.kind === 'read' ? outcome.entries : [];
}

describe('page-fence.server · escritura durable', () => {
  it('escribe una entrada y se puede releer', async () => {
    const { client } = fakeStore();
    const outcome = await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry(), client);
    assert.equal(outcome.kind, 'written');

    const entries = expectRead(await readApolloPageFenceEntries(BATCH_ID, IDENTITY, client));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 'request_started');
  });

  it('un segundo upsert de la MISMA página con succeeded reemplaza la anterior', async () => {
    const { client } = fakeStore();
    await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry({ status: 'request_started' }), client);
    await upsertApolloPageFenceEntry(
      BATCH_ID,
      IDENTITY,
      pageEntry({ status: 'succeeded', organizations: [] }),
      client,
    );

    const entries = expectRead(await readApolloPageFenceEntries(BATCH_ID, IDENTITY, client));
    assert.equal(entries.length, 1, 'sigue siendo UNA entrada para esa página, no dos');
    assert.equal(entries[0].status, 'succeeded');
  });

  it('páginas distintas se acumulan, no se pisan', async () => {
    const { client } = fakeStore();
    await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry({ page: 1, status: 'succeeded' }), client);
    await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry({ page: 2, status: 'request_started' }), client);

    const entries = expectRead(await readApolloPageFenceEntries(BATCH_ID, IDENTITY, client));
    assert.equal(entries.length, 2);
  });

  it('un documento de OTRA corrida (idempotency_key distinto) no se lee ni se usa como base', async () => {
    const { client } = fakeStore();
    await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry({ page: 1, status: 'succeeded' }), client);

    const otherRun = { idempotencyKey: 'idem-OTRA-corrida', requestFingerprint: 'fp-otra' };
    const entries = expectRead(await readApolloPageFenceEntries(BATCH_ID, otherRun, client));
    assert.deepEqual(entries, [], 'una corrida distinta no ve páginas ajenas');
  });

  it('limpiar una ronda quita sus entradas y conserva las de otras', async () => {
    const { client } = fakeStore();
    await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry({ round_number: 1, page: 1, status: 'succeeded' }), client);
    await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry({ round_number: 2, page: 1, status: 'succeeded' }), client);

    await clearApolloPageFenceRoundDurable(BATCH_ID, IDENTITY, 1, client);

    const entries = expectRead(await readApolloPageFenceEntries(BATCH_ID, IDENTITY, client));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].round_number, 2);
  });

  it('sin cliente (sin Supabase configurado) la lectura degrada a {kind:"read", entries:[]} y la escritura reporta el fallo, sin lanzar', async () => {
    const outcome = await readApolloPageFenceEntries(BATCH_ID, IDENTITY, null);
    assert.deepEqual(outcome, { kind: 'read', entries: [] });
    const writeOutcome = await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry(), null);
    assert.equal(writeOutcome.kind, 'failed');
  });

  // ── AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX · BLOQUEADOR 2 ──────────────
  //
  // H2 — una lectura que SÍ tiene cliente pero cuya consulta falla (excepción
  // o `error` de PostgREST) debe distinguirse de "no hay documento todavía":
  // antes de este corte, ambos casos devolvían `[]` y el llamador no podía
  // saber la diferencia.

  describe('H2 · la lectura distingue "sin documento" de "fallo de lectura"', () => {
    it('un cliente cuya consulta devuelve `error` reporta {kind:"failed"}, nunca [] silencioso', async () => {
      const failingClient: CheckpointStoreClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }),
            }),
          }),
        }),
      } as unknown as CheckpointStoreClient;

      const outcome = await readApolloPageFenceEntries(BATCH_ID, IDENTITY, failingClient);
      assert.equal(outcome.kind, 'failed');
      assert.equal(outcome.kind === 'failed' ? outcome.reason : null, 'connection reset');
    });

    it('un cliente que lanza (excepción de red) reporta {kind:"failed"}, nunca [] silencioso', async () => {
      const throwingClient: CheckpointStoreClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                throw new Error('supabase unreachable');
              },
            }),
          }),
        }),
      } as unknown as CheckpointStoreClient;

      const outcome = await readApolloPageFenceEntries(BATCH_ID, IDENTITY, throwingClient);
      assert.equal(outcome.kind, 'failed');
      assert.equal(outcome.kind === 'failed' ? outcome.reason : null, 'supabase unreachable');
    });

    it('un lote existente con una página succeeded se sigue leyendo bien cuando NO hay fallo (control)', async () => {
      const { client } = fakeStore();
      await upsertApolloPageFenceEntry(BATCH_ID, IDENTITY, pageEntry({ page: 1, status: 'succeeded' }), client);

      const outcome = await readApolloPageFenceEntries(BATCH_ID, IDENTITY, client);
      assert.equal(outcome.kind, 'read');
    });
  });
});
