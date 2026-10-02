/**
 * SOURCES-GT-HN-BY-NAME-1 — lectura genérica + cableado de Guatemala y Honduras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildSnapshotNameQuery, SNAPSHOT_NAME_QUERY_LIMIT } from '../snapshot-name-query';
import { buildColombiaOfficialSourceResolvers } from '../official-source-resolvers';

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

function fakeClient(result: { data?: unknown; error?: unknown; throws?: boolean }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: 'limit', args });
    if (result.throws) return Promise.reject(new Error('down'));
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    builder[write] = () => {
      throw new Error(`escritura prohibida: ${write}`);
    };
  }
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('buildSnapshotNameQuery', () => {
  it('un SELECT acotado a la fuente y el país pedidos, por núcleo exacto', async () => {
    const { client, calls } = fakeClient({
      data: [{ normalized_tax_id: '111321522', legal_name: 'GRUPO WIT, SOCIEDAD ANONIMA', normalized_legal_name: 'GRUPO WIT' }],
    });
    const rows = await buildSnapshotNameQuery(client, 'gt_rgae_proveedores', 'GT')('GRUPO WIT');
    assert.deepEqual(rows, [{ taxId: '111321522', legalName: 'GRUPO WIT, SOCIEDAD ANONIMA', normalizedLegalName: 'GRUPO WIT' }]);
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['source_key', 'gt_rgae_proveedores'],
      ['country_code', 'GT'],
      ['normalized_legal_name', 'GRUPO WIT'],
    ]);
    assert.deepEqual(calls.at(-1), { method: 'limit', args: [SNAPSHOT_NAME_QUERY_LIMIT] });
  });

  it('sin núcleo no consulta; error o excepción → vacío', async () => {
    const idle = fakeClient({ data: [] });
    assert.deepEqual(await buildSnapshotNameQuery(idle.client, 'x', 'GT')(' '), []);
    assert.equal(idle.calls.length, 0);
    assert.deepEqual(await buildSnapshotNameQuery(fakeClient({ error: {} }).client, 'x', 'GT')('A B'), []);
    assert.deepEqual(await buildSnapshotNameQuery(fakeClient({ throws: true }).client, 'x', 'GT')('A B'), []);
  });
});

describe('cableado', () => {
  it('el módulo del factory compila y se ejecuta (nunca lanza, aunque falte el entorno)', () => {
    const resolvers = buildColombiaOfficialSourceResolvers();
    assert.ok(Array.isArray(resolvers));
    for (const resolver of resolvers) {
      assert.ok(['CO', 'DO', 'AR', 'EC', 'GT', 'HN', 'PE', 'PY', 'UY', 'US', 'ES', 'CL', 'CR', 'BO'].includes(resolver.countryCode), resolver.countryCode);
    }
  });

  it('el factory construye Guatemala (NIT) y Honduras (RTN) sobre sus snapshots', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /countryCode: 'GT',\s*sourceKey: 'gt_rgae_proveedores',\s*taxIdentifierType: 'NIT'/);
    assert.match(wiring, /buildSnapshotNameQuery\(snapshotClient, 'gt_rgae_proveedores', 'GT'\)/);
    assert.match(wiring, /countryCode: 'HN',\s*sourceKey: 'hn_contrataciones_abiertas',\s*taxIdentifierType: 'RTN'/);
    assert.match(wiring, /buildSnapshotNameQuery\(snapshotClient, 'hn_contrataciones_abiertas', 'HN'\)/);
  });

  it('el factory construye Perú (RUC) sobre el registro de SUNAT', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /countryCode: 'PE',\s*sourceKey: 'pe_sunat_registry',\s*taxIdentifierType: 'RUC',\s*validTaxId: \/\^20\\d\{9\}\$\//);
    assert.match(wiring, /buildSnapshotNameQuery\(snapshotClient, 'pe_sunat_registry', 'PE'\)/);
  });

  it('el factory construye Paraguay (RUC con dígito verificador) sobre el padrón de la SET', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /countryCode: 'PY',\s*sourceKey: 'py_set_registry',\s*taxIdentifierType: 'RUC',\s*validTaxId: \/\^80\\d\{6\}-\\d\$\//);
    assert.match(wiring, /buildSnapshotNameQuery\(snapshotClient, 'py_set_registry', 'PY'\)/);
  });

  it('el factory construye Uruguay (RUT de 12 dígitos) sobre el RUPE', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /countryCode: 'UY',\s*sourceKey: 'uy_rupe_registry',\s*taxIdentifierType: 'RUT',\s*validTaxId: \/\^\\d\{12\}\$\//);
    assert.match(wiring, /buildSnapshotNameQuery\(snapshotClient, 'uy_rupe_registry', 'UY'\)/);
  });

  it('el factory construye Estados Unidos (EIN): la SEC primero y, detrás, el IRS', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(
      wiring,
      /createFallbackOfficialSourceResolver\(\s*createSnapshotNameOfficialSourceResolver\(\{\s*countryCode: 'US',\s*sourceKey: 'us_sec_edgar_registry',\s*taxIdentifierType: 'EIN',[\s\S]*?buildSnapshotNameQuery\(snapshotClient, 'us_sec_edgar_registry', 'US'\),\s*\}\),\s*createSnapshotNameOfficialSourceResolver\(\{\s*countryCode: 'US',\s*sourceKey: 'us_irs_eo_registry',\s*taxIdentifierType: 'EIN',[\s\S]*?buildSnapshotNameQuery\(snapshotClient, 'us_irs_eo_registry', 'US'\),/,
    );
  });

  it('el factory construye España (NIF de sociedad) sobre las adjudicatarias de la PLACSP', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /countryCode: 'ES',\s*sourceKey: 'es_placsp_registry',\s*taxIdentifierType: 'NIF',/);
    assert.match(wiring, /buildSnapshotNameQuery\(snapshotClient, 'es_placsp_registry', 'ES'\)/);
  });

  it('el factory construye Chile (RUT con DV) sobre el Registro de Empresas y Sociedades', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /countryCode: 'CL',\s*sourceKey: 'cl_res_registry',\s*taxIdentifierType: 'RUT',/);
    assert.match(wiring, /buildSnapshotNameQuery\(snapshotClient, 'cl_res_registry', 'CL'\)/);
  });

  it('el factory construye Costa Rica (cédula jurídica) sobre PYMES MEIC + proveedores SICOP', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /countryCode: 'CR',\s*sourceKey: 'cr_company_registry',\s*taxIdentifierType: 'cedula_juridica',\s*validTaxId: \/\^3\\d\{9\}\$\//);
    assert.match(wiring, /buildSnapshotNameQuery\(snapshotClient, 'cr_company_registry', 'CR'\)/);
  });

  it('el resolvedor genérico es puro y la lectura no escribe', () => {
    const resolver = read('src/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver.ts');
    assert.doesNotMatch(resolver, /createClient|createSupabaseAdminClient|@supabase\/supabase-js|process\.env|\bfetch\s*\(|\.from\(\s*['"]/);
    const query = read('src/server/prospect-batches/snapshot-name-query.ts');
    assert.doesNotMatch(query, /\.(insert|update|delete|upsert|rpc)\s*\(/);
    assert.doesNotMatch(query, /createClient\s*\(|createSupabaseAdminClient\s*\(|process\.env/);
  });
});
