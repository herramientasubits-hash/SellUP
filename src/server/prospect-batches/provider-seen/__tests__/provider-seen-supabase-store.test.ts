/**
 * ADDENDUM PROVIDER-SEEN · AGENT1-PROVIDER-SEEN-MEMORY-2 — el TRANSPORTE del store
 * persistente: qué pide, qué acota y, sobre todo, qué hace cuando la persistencia
 * falla.
 *
 * 🔴 La garantía que más importa aquí no es que escriba bien: es que NINGÚN fallo de
 * esta tabla pueda costar dinero. Una lectura rota devuelve memoria VACÍA —0 aciertos,
 * 0 exclusiones nuevas, el gasto de hoy— y una escritura rota se REPORTA. Lo que no
 * puede pasar nunca es que la memoria lance, aborte la corrida o provoque una segunda
 * petición al proveedor: una optimización que puede tumbar la operación deja de serlo.
 *
 * La SEMÁNTICA de identidad no se prueba aquí porque no vive aquí: vive en la
 * migración, y se ejercita contra un PostgreSQL real en
 * `provider-seen-schema-postgres.test.ts`. Este archivo cubre el cable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { collectProviderSeenObservations } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_LIMIT } from '../provider-seen-store';
import {
  createSupabaseProviderSeenStore,
  PROVIDER_SEEN_RECORD_RPC,
  PROVIDER_SEEN_TABLE,
  PROVIDER_SEEN_WRITE_SKIPPED_NO_OBSERVATIONS,
  PROVIDER_SEEN_WRITE_SKIPPED_PERSISTENCE_ERROR,
} from '../provider-seen-supabase-store';

const T1 = '2026-08-20T10:00:00.000Z';

type QueryCall = { table: string; filters: Array<[string, unknown]>; orders: string[]; limit: number | null; columns: string };
type RpcCall = { fn: string; args: Record<string, unknown> };

/**
 * Doble del cliente de Supabase. Registra lo que se le pide y devuelve lo que la
 * prueba decida. No abre una conexión y no conoce ningún proveedor.
 */
function createClientDouble(options: {
  rows?: unknown[] | null;
  selectError?: unknown;
  rpcResult?: unknown;
  rpcError?: unknown;
  throwOn?: 'select' | 'rpc';
}) {
  const queries: QueryCall[] = [];
  const rpcs: RpcCall[] = [];

  const client = {
    from(table: string) {
      const call: QueryCall = { table, filters: [], orders: [], limit: null, columns: '' };
      queries.push(call);
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        order(column: string, opts: { ascending: boolean }) {
          call.orders.push(`${column}:${opts.ascending ? 'asc' : 'desc'}`);
          return builder;
        },
        async limit(value: number) {
          call.limit = value;
          if (options.throwOn === 'select') throw new Error('conexión caída');
          return { data: options.rows ?? null, error: options.selectError ?? null };
        },
      };
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (options.throwOn === 'rpc') throw new Error('conexión caída');
      return { data: options.rpcResult ?? null, error: options.rpcError ?? null };
    },
  };

  // El puerto pide un `SupabaseClient`; el doble sólo implementa lo que se usa.
  return { client: client as unknown as Parameters<typeof createSupabaseProviderSeenStore>[0], queries, rpcs };
}

const OBSERVATIONS = collectProviderSeenObservations('lusha', [
  { providerEntityId: 'v1.aaa', domain: 'uno.example' },
  { providerEntityId: null, domain: 'dos.example' },
]).observations;

test('load — pide la tabla acotada, filtrada por proveedor y con orden determinista', async () => {
  const { client, queries } = createClientDouble({ rows: [] });
  await createSupabaseProviderSeenStore(client).load({
    provider: 'lusha',
    limit: PROVIDER_SEEN_LOAD_LIMIT,
  });

  assert.equal(queries.length, 1);
  assert.equal(queries[0]!.table, PROVIDER_SEEN_TABLE);
  assert.deepEqual(queries[0]!.filters, [
    ['provider', 'lusha'],
    ['provider_entity_type', 'company'],
  ]);
  // Lo más reciente primero y `id` como desempate: dos corridas idénticas tienen que
  // cargar exactamente la misma página, o el plan de exclusión dejaría de ser
  // reproducible entre ellas.
  assert.deepEqual(queries[0]!.orders, ['last_seen_at:desc', 'id:asc']);
  assert.equal(queries[0]!.limit, PROVIDER_SEEN_LOAD_LIMIT);
  // Sólo identidad y ventana. Ninguna columna del perfil comprado se pide siquiera.
  for (const forbidden of ['name', 'employee', 'industry', 'phone', 'email']) {
    assert.ok(!queries[0]!.columns.includes(forbidden), `columna de perfil pedida: ${forbidden}`);
  }
});

test('load — un tope de 0 no llega ni a consultar', async () => {
  const { client, queries } = createClientDouble({ rows: [] });
  const found = await createSupabaseProviderSeenStore(client).load({ provider: 'lusha', limit: 0 });
  assert.deepEqual([...found], []);
  assert.equal(queries.length, 0, 'una carga de cero filas no es una consulta');
});

test('load — un tope negativo o fraccionario se sanea, nunca viaja crudo', async () => {
  const { client, queries } = createClientDouble({ rows: [] });
  const store = createSupabaseProviderSeenStore(client);
  await store.load({ provider: 'lusha', limit: -5 });
  assert.equal(queries.length, 0);
  await store.load({ provider: 'apollo', limit: 3.9 });
  assert.equal(queries[0]!.limit, 3);
});

test('load — traduce filas y descarta la que no tuviera ninguna señal', async () => {
  const { client } = createClientDouble({
    rows: [
      {
        provider: 'lusha',
        provider_entity_type: 'company',
        provider_entity_id: 'v1.aaa',
        normalized_domain: 'uno.example',
        first_seen_at: T1,
        last_seen_at: T1,
        first_seen_correlation: 'run-1',
        last_seen_correlation: 'run-1',
      },
      // La tabla no puede producirla (CHECK), pero si apareciera envenenaría la memoria.
      {
        provider: 'lusha',
        provider_entity_type: 'company',
        provider_entity_id: null,
        normalized_domain: null,
        first_seen_at: T1,
        last_seen_at: T1,
        first_seen_correlation: null,
        last_seen_correlation: null,
      },
    ],
  });

  const found = await createSupabaseProviderSeenStore(client).load({ provider: 'lusha', limit: 10 });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.providerEntityId, 'v1.aaa');
  assert.equal(found[0]!.firstSeenCorrelation, 'run-1');
});

test('🔴 load — un error de persistencia devuelve memoria VACÍA y no lanza', async () => {
  const { client } = createClientDouble({ selectError: { message: 'boom' } });
  const found = await createSupabaseProviderSeenStore(client).load({ provider: 'lusha', limit: 10 });
  // Memoria vacía ⇒ 0 aciertos ⇒ 0 exclusiones nuevas ⇒ el gasto de hoy. Degradación
  // segura: nunca más cara que antes del PR.
  assert.deepEqual([...found], []);
});

test('🔴 load — una excepción del transporte tampoco escapa', async () => {
  const { client } = createClientDouble({ throwOn: 'select' });
  const found = await createSupabaseProviderSeenStore(client).load({ provider: 'lusha', limit: 10 });
  assert.deepEqual([...found], []);
});

test('record — llama a la función de SQL con la forma que la migración espera', async () => {
  const { client, rpcs } = createClientDouble({
    rpcResult: { accepted_count: 2, rejected_count: 0, new_ids_recorded: 1, new_domains_recorded: 2, refreshed_count: 0 },
  });

  const result = await createSupabaseProviderSeenStore(client).record({
    observations: OBSERVATIONS,
    correlationId: 'run-1',
    observedAt: T1,
  });

  assert.equal(rpcs.length, 1);
  assert.equal(rpcs[0]!.fn, PROVIDER_SEEN_RECORD_RPC);
  assert.equal(rpcs[0]!.args.p_correlation, 'run-1');
  assert.equal(rpcs[0]!.args.p_observed_at, T1);
  assert.deepEqual(rpcs[0]!.args.p_observations, [
    { provider: 'lusha', entity_type: 'company', provider_entity_id: 'v1.aaa', normalized_domain: 'uno.example' },
    { provider: 'lusha', entity_type: 'company', provider_entity_id: null, normalized_domain: 'dos.example' },
  ]);

  assert.equal(result.written, true);
  assert.equal(result.skippedReason, null);
  assert.equal(result.newIdsRecorded, 1);
  assert.equal(result.newDomainsRecorded, 2);
  assert.equal(result.refreshedCount, 0);
});

test('record — un lote sin observaciones se reporta, no se escribe', async () => {
  const { client, rpcs } = createClientDouble({});
  const result = await createSupabaseProviderSeenStore(client).record({
    observations: [],
    correlationId: 'run-1',
    observedAt: T1,
  });

  assert.equal(result.written, false);
  assert.equal(result.skippedReason, PROVIDER_SEEN_WRITE_SKIPPED_NO_OBSERVATIONS);
  assert.equal(rpcs.length, 0, 'no se molesta a la base con un lote vacío');
});

test('🔴 record — un error de persistencia NO lanza y NO pide reintentar al proveedor', async () => {
  const { client } = createClientDouble({ rpcError: { message: 'boom' } });
  const result = await createSupabaseProviderSeenStore(client).record({
    observations: OBSERVATIONS,
    correlationId: 'run-1',
    observedAt: T1,
  });

  assert.equal(result.written, false);
  assert.equal(result.skippedReason, PROVIDER_SEEN_WRITE_SKIPPED_PERSISTENCE_ERROR);
  // 🔴 Ni un contador inventado. Un fallo de escritura no «registró» nada, y publicar
  // un número aquí haría creer que la memoria creció cuando no lo hizo.
  assert.equal(result.newIdsRecorded, 0);
  assert.equal(result.newDomainsRecorded, 0);
  assert.equal(result.refreshedCount, 0);
});

test('🔴 record — una excepción del transporte tampoco escapa', async () => {
  const { client } = createClientDouble({ throwOn: 'rpc' });
  const result = await createSupabaseProviderSeenStore(client).record({
    observations: OBSERVATIONS,
    correlationId: 'run-1',
    observedAt: T1,
  });
  assert.equal(result.written, false);
  assert.equal(result.skippedReason, PROVIDER_SEEN_WRITE_SKIPPED_PERSISTENCE_ERROR);
});

test('record — una respuesta ilegible se lee como cero, nunca como NaN', async () => {
  const { client } = createClientDouble({ rpcResult: { new_ids_recorded: 'muchos' } });
  const result = await createSupabaseProviderSeenStore(client).record({
    observations: OBSERVATIONS,
    correlationId: 'run-1',
    observedAt: T1,
  });
  assert.equal(result.written, true);
  assert.equal(result.newIdsRecorded, 0);
});
