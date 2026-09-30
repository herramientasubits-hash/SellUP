/**
 * SOURCES-AR-CUIT-BY-NAME-1 — lectura del registro + cableado del resolvedor de
 * Argentina + fila mínima del registro. Cero E/S real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildArgentinaSnapshotQuery, ARGENTINA_SNAPSHOT_QUERY_LIMIT } from '../argentina-snapshot-query';
import {
  buildArRnsRegistryRow,
  readRnsPrincipalActivity,
} from '@/server/source-catalog/connectors/rns-argentina/ar-rns-snapshot-builder';

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

type Call = { method: string; args: unknown[] };

function fakeClient(result: { data?: unknown; error?: unknown; throws?: boolean }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: 'limit', args });
    if (result.throws) return Promise.reject(new Error('network down'));
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    builder[write] = () => {
      throw new Error(`escritura prohibida: ${write}`);
    };
  }
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('buildArgentinaSnapshotQuery', () => {
  it('un único SELECT acotado a ar_rns_registry / AR por núcleo exacto', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          normalized_tax_id: '30639453738',
          legal_name: 'TELECOM ARGENTINA SOCIEDAD ANONIMA',
          normalized_legal_name: 'TELECOM ARGENTINA',
        },
      ],
    });
    const rows = await buildArgentinaSnapshotQuery(client)('TELECOM ARGENTINA');
    assert.deepEqual(rows, [
      { cuit: '30639453738', legalName: 'TELECOM ARGENTINA SOCIEDAD ANONIMA', normalizedLegalName: 'TELECOM ARGENTINA' },
    ]);
    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['source_key', 'ar_rns_registry'],
      ['country_code', 'AR'],
      ['normalized_legal_name', 'TELECOM ARGENTINA'],
    ]);
    assert.deepEqual(calls.at(-1), { method: 'limit', args: [ARGENTINA_SNAPSHOT_QUERY_LIMIT] });
  });

  it('sin núcleo no consulta; un error o excepción devuelve vacío', async () => {
    const idle = fakeClient({ data: [] });
    assert.deepEqual(await buildArgentinaSnapshotQuery(idle.client)('  '), []);
    assert.equal(idle.calls.length, 0);
    assert.deepEqual(await buildArgentinaSnapshotQuery(fakeClient({ error: { message: 'x' } }).client)('A B'), []);
    assert.deepEqual(await buildArgentinaSnapshotQuery(fakeClient({ throws: true }).client)('A B'), []);
  });
});

describe('fila mínima del registro', () => {
  const activity = readRnsPrincipalActivity({
    cuit: '30639453738',
    razon_social: 'TELECOM ARGENTINA SOCIEDAD ANONIMA',
    tipo_societario: 'SOCIEDAD ANONIMA',
    dom_fiscal_provincia: 'CABA',
    dom_fiscal_localidad: 'CAPITAL FEDERAL',
    actividad_codigo: ' 611010',
    actividad_descripcion: 'Servicios de telefonía fija',
    actividad_orden: '1',
    actividad_estado: 'AC',
  })!;

  it('guarda el NÚCLEO del nombre (el mismo que calcula el resolvedor) y el código', () => {
    const row = buildArRnsRegistryRow({ activity, sourceYear: 2026, importedAt: '2026-09-30T00:00:00.000Z' })!;
    assert.equal(row.source_key, 'ar_rns_registry');
    assert.equal(row.country_code, 'AR');
    assert.equal(row.normalized_tax_id, '30639453738');
    assert.equal(row.legal_name, 'TELECOM ARGENTINA SOCIEDAD ANONIMA');
    assert.equal(row.normalized_legal_name, 'TELECOM ARGENTINA');
    assert.deepEqual(row.raw_data, { actividad_codigo: '611010' });
    assert.ok(row.record_identity_key);
  });

  it('no arma fila si el nombre no deja núcleo', () => {
    assert.equal(
      buildArRnsRegistryRow({ activity: { ...activity, legalName: '.' }, sourceYear: 2026, importedAt: 'x' }),
      null,
    );
  });
});

describe('cableado y guardas estáticas', () => {
  it('el factory compartido construye el resolvedor de Argentina junto a CO y DO', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /createColombiaOfficialSourceResolver\(/);
    assert.match(wiring, /createDominicanOfficialSourceResolver\(/);
    assert.match(wiring, /createArgentinaOfficialSourceResolver\(\{\s*querySnapshots:\s*buildArgentinaSnapshotQuery\(snapshotClient\)/);
  });

  it('el resolvedor es puro y la lectura no escribe ni construye cliente', () => {
    const resolver = read('src/server/agents/prospect-intake/resolvers/argentina-official-source-resolver.ts');
    assert.doesNotMatch(resolver, /createClient|createSupabaseAdminClient|@supabase\/supabase-js|process\.env|\bfetch\s*\(|\.from\(\s*['"]/);
    const query = read('src/server/prospect-batches/argentina-snapshot-query.ts');
    assert.doesNotMatch(query, /\.(insert|update|delete|upsert|rpc)\s*\(/);
    assert.doesNotMatch(query, /createClient\s*\(|createSupabaseAdminClient\s*\(|process\.env/);
  });
});
