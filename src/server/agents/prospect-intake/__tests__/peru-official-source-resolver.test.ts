/**
 * SOURCES-PE-CLOSE-1 — RUC por nombre de Perú: variantes, alias, regla de una
 * palabra y trabajadores hacia el filtro de tamaño. Lectura inyectada en memoria
 * (cero E/S) + la lectura de producción con un cliente doble que revienta si
 * alguien escribe. Casos tomados de las 182 empresas peruanas medidas el 06-10.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createPeruOfficialSourceResolver,
  type PeruNameRow,
} from '../resolvers/peru-official-source-resolver';
import {
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  enrichNormalizedProspectWithOfficialSources,
} from '../source-enrichment';
import type { NormalizedProspectCandidate } from '../types';
import { buildPeruSnapshotNameQuery } from '@/server/prospect-batches/peru-snapshot-query';
import { extractOfficialRegistryWorkforce } from '@/server/agents/prospecting-toolkit/employee-size-resolver';

function candidate(canonicalName: string, domain: string | null = null): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-pe',
    providerRequestId: 'req-pe',
    canonicalName,
    normalizedName: canonicalName.toLowerCase(),
    commercialName: canonicalName,
    legalName: null,
    websiteUrl: null,
    domain,
    corporateLinkedinUrl: null,
    country: 'Perú',
    countryCode: 'PE',
    requestedCountryCode: 'PE',
    region: null,
    city: 'Lima',
    industry: null,
    subindustry: null,
    industryCodes: {},
    employeeCount: null,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-pe', providerRequestId: 'req-pe', sourceUrl: null },
  };
}

const wf = (workers: number) => ({ workers, year: 2026, source: 'pe_sunat_registry' });

/** Índice en memoria: clave → filas (padrón y alias), y registro de cada consulta. */
function memory(rows: Array<Omit<PeruNameRow, 'normalizedLegalName'> & { key: string }>) {
  const asked: string[] = [];
  const query = async (core: string) => {
    asked.push(core);
    return rows.filter((r) => r.key === core).map(({ key, ...row }) => ({ ...row, normalizedLegalName: key }));
  };
  return { resolver: createPeruOfficialSourceResolver({ querySnapshots: query }), asked };
}

async function enrich(name: string, rows: Array<Omit<PeruNameRow, 'normalizedLegalName'> & { key: string }>, domain: string | null = null) {
  const { resolver, asked } = memory(rows);
  const identity = await enrichNormalizedProspectWithOfficialSources(candidate(name, domain), { countryCode: 'PE' }, [resolver]);
  return { identity, columns: buildOfficialSourceTypedColumns(identity), asked };
}

const GLORIA = { taxId: '20100190797', legalName: 'LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.', workforce: wf(2275) };

describe('RUC por nombre de Perú', () => {
  it('el núcleo de siempre sigue funcionando y es lo primero que se pregunta', async () => {
    const { columns, asked } = await enrich('Ajinomoto del Perú S.A.', [
      { key: 'AJINOMOTO DEL PERU', taxId: '20100085063', legalName: 'AJINOMOTO DEL PERU S A', workforce: wf(1518) },
    ]);
    assert.equal(columns.tax_identifier, '20100085063');
    assert.equal(columns.tax_identifier_type, 'RUC');
    assert.deepEqual(asked, ['AJINOMOTO DEL PERU']);
  });

  it('una marca que es el alias de la razón social da el RUC, con la razón social del padrón', async () => {
    const { identity, columns } = await enrich('Gloria', [{ key: 'GLORIA', alias: true, ...GLORIA }]);
    assert.equal(columns.tax_identifier, '20100190797');
    assert.equal(identity.officialSource.legalName, 'LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.');
    assert.equal(identity.officialSource.safeMetadata?.['matchedAlias'], true);
  });

  it('los trabajadores del padrón viajan con el RUC fuerte hasta el filtro de tamaño', async () => {
    const { identity } = await enrich('Gloria', [{ key: 'GLORIA', alias: true, ...GLORIA }]);
    assert.deepEqual(identity.officialSource.workforce, wf(2275));
    const officialSourceIdentity = {
      officialSourceMetadata: buildOfficialSourceEnrichmentMetadata(identity),
      typedColumns: buildOfficialSourceTypedColumns(identity),
      strongIdentityAvailable: identity.strongIdentityAvailable,
    };
    assert.deepEqual(extractOfficialRegistryWorkforce({ officialSourceIdentity }), {
      workers: 2275,
      year: 2026,
      source: 'pe_sunat_registry',
    });
  });

  it('entidad pública escrita distinto: la clave sin «de/del» la encuentra', async () => {
    const { columns, asked } = await enrich('Hospital Regional del Cusco', [
      { key: 'HOSPITAL REGIONAL CUSCO', taxId: '20527180318', legalName: 'HOSPITAL REGIONAL CUSCO', workforce: wf(1514) },
    ]);
    assert.equal(columns.tax_identifier, '20527180318');
    assert.deepEqual(asked, ['HOSPITAL REGIONAL DEL CUSCO', 'HOSPITAL REGIONAL CUSCO']);
  });

  it('la provincia tras el guion no estorba; «del Perú» se prueba si falta', async () => {
    const espinar = await enrich('MUNICIPALIDAD PROVINCIAL DE ESPINAR - CUSCO', [
      { key: 'MUNICIPALIDAD PROVINCIAL DE ESPINAR', taxId: '20147346434', legalName: 'MUNICIPALIDAD PROVINCIAL DE ESPINAR', workforce: wf(1544) },
    ]);
    assert.equal(espinar.columns.tax_identifier, '20147346434');
    const bago = await enrich('Laboratorios Bagó S.A.', [
      { key: 'LABORATORIOS BAGO DEL PERU', taxId: '20100126622', legalName: 'LABORATORIOS BAGO DEL PERU S.A.', workforce: wf(195) },
    ]);
    assert.equal(bago.columns.tax_identifier, '20100126622');
    assert.equal(bago.identity.officialSource.safeMetadata?.['nameVariant'], 'with_peru');
  });

  it('la PRIMERA variante con resultados decide: las siguientes no se consultan', async () => {
    const { columns, asked } = await enrich('Laboratorios Bagó S.A.', [
      { key: 'LABORATORIOS BAGO', taxId: '20111111111', legalName: 'LABORATORIOS BAGO S.A.' , workforce: wf(80) },
      { key: 'LABORATORIOS BAGO DEL PERU', taxId: '20100126622', legalName: 'LABORATORIOS BAGO DEL PERU S.A.' },
    ]);
    assert.equal(columns.tax_identifier, '20111111111');
    assert.deepEqual(asked, ['LABORATORIOS BAGO']);
  });

  it('una palabra sin forma societaria: fuerte sólo con 50+ trabajadores; si no, pista', async () => {
    const rinti = await enrich('Rinti', [{ key: 'RINTI', taxId: '20100617332', legalName: 'RINTI S A', workforce: wf(702) }]);
    assert.equal(rinti.columns.tax_identifier, '20100617332');

    // «LIMA» → LIMA S.A.C., «Masplay», «Aqualep» (3 trabajadores): marcas sueltas sin tamaño.
    for (const [name, workforce] of [['Masplay', null], ['Aqualep', wf(3)], ['Trupalix', wf(49)]] as const) {
      const key = name.toUpperCase();
      const { identity, columns } = await enrich(name, [{ key, taxId: '20562883844', legalName: `${key} E.I.R.L.`, workforce }]);
      assert.equal(columns.tax_identifier, null, name);
      assert.equal(identity.officialSource.status, 'low_confidence_match', name);
      assert.equal(identity.officialSource.safeMetadata?.['singleWordName'], true, name);
      assert.equal(identity.officialSource.workforce ?? null, null, name);
    }
  });

  it('una palabra CON su forma societaria es una razón social y puede ser fuerte', async () => {
    const { columns } = await enrich('Ferreyros S.A.', [{ key: 'FERREYROS', taxId: '20100028698', legalName: 'FERREYROS SOCIEDAD ANÓNIMA' }]);
    assert.equal(columns.tax_identifier, '20100028698');
  });

  it('dos sociedades con la misma clave: pista, nunca un RUC', async () => {
    const { identity, columns } = await enrich('San Fernando', [
      { key: 'SAN FERNANDO', taxId: '20100154308', legalName: 'SAN FERNANDO S.A.', workforce: wf(4967) },
      { key: 'SAN FERNANDO', taxId: '20600000001', legalName: 'COLEGIO X - SAN FERNANDO', alias: true },
    ]);
    assert.equal(columns.tax_identifier, null);
    assert.equal(identity.officialSource.safeMetadata?.['ambiguous'], true);
    assert.equal(identity.officialSource.safeMetadata?.['candidateCount'], 2);
  });

  it('el padrón y su alias de la MISMA sociedad cuentan como una sola', async () => {
    const { columns } = await enrich('Paltarumi SAC', [
      { key: 'PALTARUMI', taxId: '20600000002', legalName: 'PALTARUMI SOCIEDAD ANONIMA CERRADA - PALTARUMI S.A.C.', alias: true, workforce: wf(436) },
      { key: 'PALTARUMI', taxId: '20600000002', legalName: 'PALTARUMI SOCIEDAD ANONIMA CERRADA - PALTARUMI S.A.C.' },
    ]);
    assert.equal(columns.tax_identifier, '20600000002');
  });

  it('un RUC de persona natural nunca se ofrece; sin filas no hay nada', async () => {
    const natural = await enrich('Alicorp', [{ key: 'ALICORP', taxId: '10452159428', legalName: 'ALICORP' }]);
    assert.equal(natural.identity.strongIdentityAvailable, false);
    const none = await enrich('Empresa Inexistente', []);
    assert.equal(none.identity.officialSource.status, 'not_found');
  });

  it('sólo para candidatos de Perú con nombre', () => {
    const { resolver } = memory([]);
    const input = (name: string, countryCode: string) => ({ candidate: { ...candidate(name), countryCode }, criteria: { countryCode }, policy: {} }) as never;
    assert.equal(resolver.canResolve(input('Gloria', 'PE')), true);
    assert.equal(resolver.canResolve(input('Gloria', 'CO')), false);
    assert.equal(resolver.canResolve(input('ab', 'PE')), false);
    assert.equal(resolver.sourceKey, 'pe_sunat_registry');
  });
});

describe('lectura de producción (buildPeruSnapshotNameQuery)', () => {
  type Call = { method: string; args: unknown[] };

  function fakeClient(result: { data?: unknown; error?: unknown; throws?: boolean }) {
    const calls: Call[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'eq', 'in']) {
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

  it('lee padrón y alias de Perú por la clave exacta, con trabajadores y marca de alias', async () => {
    const { client, calls } = fakeClient({
      data: [
        { source_key: 'pe_sunat_name_alias', normalized_tax_id: '20100190797', legal_name: 'LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.', normalized_legal_name: 'GLORIA', raw_data: { workers: 2275, metrics_year: 2026 }, source_year: 2026 },
        { source_key: 'pe_sunat_registry', normalized_tax_id: '20100000001', legal_name: 'GLORIA X S.A.C.', normalized_legal_name: 'GLORIA', raw_data: { ubigeo: '150101' }, source_year: 2026 },
      ],
    });
    const rows = await buildPeruSnapshotNameQuery(client)(' GLORIA ');
    assert.deepEqual(rows[0], {
      taxId: '20100190797',
      legalName: 'LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.',
      normalizedLegalName: 'GLORIA',
      workforce: { workers: 2275, year: 2026, source: 'pe_sunat_registry', salesBracket: null },
      alias: true,
    });
    assert.equal(rows[1].alias, false);
    assert.equal(rows[1].workforce, null);
    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    assert.deepEqual(calls.find((c) => c.method === 'in')?.args, ['source_key', ['pe_sunat_registry', 'pe_sunat_name_alias']]);
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['country_code', 'PE'],
      ['normalized_legal_name', 'GLORIA'],
    ]);
    assert.deepEqual(calls.at(-1), { method: 'limit', args: [20] });
  });

  it('una clave vacía no consulta; un error o una excepción devuelven vacío', async () => {
    const idle = fakeClient({ data: [] });
    assert.deepEqual(await buildPeruSnapshotNameQuery(idle.client)('  '), []);
    assert.equal(idle.calls.length, 0);
    for (const failing of [{ error: { message: 'boom' } }, { throws: true }]) {
      assert.deepEqual(await buildPeruSnapshotNameQuery(fakeClient(failing).client)('GLORIA'), []);
    }
  });

  it('guardas estáticas: el resolvedor es puro y la lectura no escribe ni crea clientes', () => {
    const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));
    const query = read('src/server/prospect-batches/peru-snapshot-query.ts');
    assert.doesNotMatch(query, /\.(insert|update|upsert|delete|rpc)\s*\(/);
    assert.doesNotMatch(query, /createClient\s*\(|createSupabaseAdminClient\s*\(|process\.env/);
    const resolver = read('src/server/agents/prospect-intake/resolvers/peru-official-source-resolver.ts');
    assert.doesNotMatch(resolver, /supabase|process\.env|\bfetch\s*\(|\.from\(\s*['"]/i);
  });
});
