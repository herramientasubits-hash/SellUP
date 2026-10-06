/**
 * SOURCES-CO-CLOSE-1 — la lectura web → filas oficiales de Colombia: qué pide,
 * cuándo el SIGEP viaja como tamaño y que nunca escribe ni lanza.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildColombiaDomainSnapshotQuery,
  CO_DOMAIN_QUERY_LIMIT,
  CO_PUBLIC_ENTITY_MIN_TRUSTED_WORKERS,
} from '../colombia-domain-snapshot-query';

type Call = { method: string; args: unknown[] };

function fakeClient(response: { data: unknown[] | null; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: 'limit', args });
    return Promise.resolve(response);
  };
  const client = {
    from: (...args: unknown[]) => {
      calls.push({ method: 'from', args });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const entity = (workers: number, overrides: Record<string, unknown> = {}) => ({
  source_key: 'co_public_entities',
  normalized_tax_id: '800099095',
  legal_name: 'ALCALDIA DE IPIALES',
  source_year: 2026,
  raw_data: { website_domain: 'Ipiales-Narino.gov.co', workers, metrics_year: 2026, entity_head: true },
  ...overrides,
});

test('pide las dos fuentes con web, de Colombia, por las llaves del dominio, acotado', async () => {
  const { client, calls } = fakeClient({ data: [], error: null });
  await buildColombiaDomainSnapshotQuery(client)(['sed.narino.gov.co', 'narino.gov.co', 'narino.gov.co']);
  assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
  const ins = calls.filter((c) => c.method === 'in').map((c) => c.args);
  assert.deepEqual(ins, [
    ['source_key', ['co_public_entities', 'co_siis']],
    ['raw_data->>website_domain', ['sed.narino.gov.co', 'narino.gov.co']],
  ]);
  assert.deepEqual(calls.find((c) => c.method === 'eq')?.args, ['country_code', 'CO']);
  assert.deepEqual(calls.find((c) => c.method === 'limit')?.args, [CO_DOMAIN_QUERY_LIMIT]);
  for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    assert.ok(!calls.some((c) => c.method === write));
  }
});

test('sin llaves no consulta; un error de la base es lista vacía', async () => {
  const { client, calls } = fakeClient({ data: null, error: { message: 'boom' } });
  const query = buildColombiaDomainSnapshotQuery(client);
  assert.deepEqual(await query([]), []);
  assert.equal(calls.length, 0);
  assert.deepEqual(await query(['x.gov.co']), []);
});

test('el SIGEP viaja como tamaño sólo desde 50 servidores (por debajo no es fiable)', async () => {
  const { client } = fakeClient({
    data: [
      entity(158),
      entity(CO_PUBLIC_ENTITY_MIN_TRUSTED_WORKERS - 49, { normalized_tax_id: '900413030', legal_name: 'INSTITUTO DISTRITAL DE LAS ARTES' }),
    ],
    error: null,
  });
  const rows = await buildColombiaDomainSnapshotQuery(client)(['ipiales-narino.gov.co']);
  assert.deepEqual(rows[0], {
    sourceKey: 'co_public_entities',
    taxId: '800099095',
    legalName: 'ALCALDIA DE IPIALES',
    websiteDomain: 'ipiales-narino.gov.co',
    entityHead: true,
    workforce: { workers: 158, year: 2026, source: 'co_public_entities', salesBracket: null },
  });
  assert.equal(rows[1]?.workforce, undefined);
});

test('una empresa del SIIS nunca trae tamaño por esta vía', async () => {
  const { client } = fakeClient({
    data: [{ source_key: 'co_siis', normalized_tax_id: '890900281', legal_name: 'INDUSTRIAS HACEB S.A.', source_year: 2024, raw_data: { website_domain: 'haceb.com', workers: 900, metrics_year: 2024 } }],
    error: null,
  });
  const rows = await buildColombiaDomainSnapshotQuery(client)(['haceb.com']);
  assert.equal(rows[0]?.workforce, undefined);
  assert.equal(rows[0]?.entityHead, false);
});
