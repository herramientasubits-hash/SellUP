/**
 * SOURCES-PE-FREE-DISCOVERY-1 — descubrimiento gratuito de Perú.
 *
 * Tabla CIIU Rev. 4, adapter, lectura con un cliente doble que registra cada
 * llamada (cualquier escritura revienta la prueba) y puerta previa al pago REAL.
 * Cero E/S. Nombres sintéticos; RUC 20 con 11 dígitos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import {
  buildPeSunatDirectoryDiscoveryAdapter,
  PE_SUNAT_DIRECTORY_DISCOVERY_MAX_ROWS,
  PE_SUNAT_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type PeSunatDirectoryDiscoveryReads,
  type PeSunatDirectorySnapshotReadRow,
} from '../pe-sunat-directory-discovery-adapter';
import { buildPeSunatDirectoryDiscoveryReads } from '../pe-sunat-directory-snapshot-query';
import {
  macroHasPeCoverage,
  normalizePeCiiu4Code,
  PE_SUNAT_MACRO_TABLE_VERSION,
  resolvePeActivityMacro,
} from '../pe-sunat-macro-table';
import { AR_RNS_DIVISION_MACRO } from '../ar-rns-macro-table';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';

const ruc = (n: number): string => `2060000${String(n).padStart(4, '0')}`;

function row(n: number, overrides: Partial<PeSunatDirectorySnapshotReadRow> = {}): PeSunatDirectorySnapshotReadRow {
  return {
    record_identity_key: `tax:${ruc(n)}`,
    ruc: ruc(n),
    legal_name: `EMPRESA SINTETICA ${n} S.A.C.`,
    normalized_legal_name: `EMPRESA SINTETICA ${n}`,
    city: 'LIMA',
    region: 'LIMA',
    ciiu4_code: '6201',
    activity_text: 'PROGRAMACION INFORMATICA',
    employees: 900 - n,
    metrics_year: 2026,
    priority_score: 900 - n,
    ...overrides,
  };
}

function fakeReads(rows: PeSunatDirectorySnapshotReadRow[]) {
  const calls: Array<{ macroIndustryKey: string; limit: number }> = [];
  const reads: PeSunatDirectoryDiscoveryReads = {
    async readCompaniesByMacro(input) {
      calls.push(input);
      return rows;
    },
  };
  return { reads, calls };
}

function noMatch(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 0,
    input,
    matches: [],
    summary: 'no_match',
    checkedSources: ['sellup', 'hubspot'],
  };
}

describe('tabla CIIU Rev. 4 de SUNAT → macro', () => {
  it('la división usa la misma tabla aprobada que Argentina', () => {
    for (const [code, division] of [['6201', '62'], ['0111', '01'], ['2011', '20'], ['4610', '46'], ['6419', '64'], ['8411', '84'], ['8610', '86']]) {
      assert.equal(resolvePeActivityMacro(code), AR_RNS_DIVISION_MACRO[division], code);
    }
    assert.equal(resolvePeActivityMacro('8411'), 'government');
    assert.equal(resolvePeActivityMacro('0710'), 'energy_mining_environment');
  });

  it('informática y telecomunicaciones del comercio van a Tecnología; farmacias a Salud', () => {
    for (const code of ['4651', '4652', '4741']) assert.equal(resolvePeActivityMacro(code), 'technology', code);
    assert.equal(resolvePeActivityMacro('4772'), 'health_pharma');
    // La CIIU internacional no separa a los mayoristas de medicamentos: siguen en Retail.
    assert.equal(resolvePeActivityMacro('4649'), 'retail');
    assert.equal(resolvePeActivityMacro('4711'), 'retail');
  });

  it('hoteles, restaurantes, medios, educación y asociaciones no tienen macro', () => {
    for (const code of ['5510', '5610', '6020', '8530', '9499', '7210']) {
      assert.equal(resolvePeActivityMacro(code), null, code);
    }
  });

  it('sólo acepta clases de 4 dígitos', () => {
    assert.equal(normalizePeCiiu4Code(' 6201 '), '6201');
    for (const raw of ['620', '62010', 'J6201', '', null, undefined]) {
      assert.equal(normalizePeCiiu4Code(raw), null, String(raw));
      assert.equal(resolvePeActivityMacro(raw), null, String(raw));
    }
  });

  it('cobertura por macro', () => {
    assert.equal(macroHasPeCoverage('technology'), true);
    assert.equal(macroHasPeCoverage('government'), true);
    assert.equal(macroHasPeCoverage('no_existe'), false);
    assert.equal(macroHasPeCoverage(null), false);
  });
});

describe('capacidad por país', () => {
  it('Perú tiene fuente gratuita propia y los demás conservan la suya', () => {
    assert.ok(COUNTRY_SOURCE_DISCOVERY_COUNTRIES.includes('PE'));
    assert.deepEqual(resolveCountrySourceCapability('pe'), {
      countryCode: 'PE',
      sourceKey: 'pe_sunat_directory_discovery',
    });
    assert.equal(resolveCountrySourceCapability('EC')?.sourceKey, 'ec_scvs_directory_discovery');
    assert.equal(resolveCountrySourceCapability('CL')?.sourceKey, 'cl_sii_directory_discovery');
    assert.equal(resolveCountrySourceCapability('VE'), null);
  });

  it('la cobertura de Perú sale de SU tabla', () => {
    assert.equal(countrySourceMacroHasCoverage('PE', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('PE', 'no_existe'), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open al pago)', () => {
    assert.equal(buildCountrySourceAdapter('PE', {}), null);
    assert.equal(buildCountrySourceAdapter('PE', { ecScvsDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } }), null);
    assert.ok(buildCountrySourceAdapter('PE', { peSunatDirectoryDiscoveryReads: fakeReads([]).reads }));
  });
});

describe('buildPeSunatDirectoryDiscoveryAdapter', () => {
  it('ofrece las filas en el orden de la lectura, con RUC, actividad y macro de la tabla', async () => {
    const { reads, calls } = fakeReads([row(1), row(2)]);
    const result = await buildPeSunatDirectoryDiscoveryAdapter(reads)({
      countryCode: 'PE',
      macroIndustryKey: 'technology',
      limit: 10,
    });

    assert.equal(result.sourceKey, PE_SUNAT_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.recordsRead, 2);
    assert.deepEqual(calls, [{ macroIndustryKey: 'technology', limit: 10 }]);
    assert.deepEqual(result.companies.map((c) => c.taxId), [ruc(1), ruc(2)]);
    const [first] = result.companies;
    assert.equal(first.countryCode, 'PE');
    assert.equal(first.taxIdentifierType, 'RUC');
    assert.equal(first.domain, null);
    assert.equal(first.industryCode, '6201');
    assert.equal(first.declaredIndustry, 'PROGRAMACION INFORMATICA');
    assert.equal(first.city, 'LIMA');
    assert.deepEqual(first.officialMacroIndustry, {
      macroIndustryKeys: ['technology'],
      tableVersion: PE_SUNAT_MACRO_TABLE_VERSION,
    });
  });

  it('la municipalidad llega con su web oficial del RENAMU; un dominio mal formado no se usa', async () => {
    const { reads } = fakeReads([
      row(1, { ciiu4_code: '8411', website_domain: 'MuniTacna.gob.pe' }),
      row(2, { ciiu4_code: '8411', website_domain: 'no es un dominio' }),
    ]);
    const result = await buildPeSunatDirectoryDiscoveryAdapter(reads)({ countryCode: 'PE', macroIndustryKey: 'government', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.domain), ['munitacna.gob.pe', null]);
  });

  it('re-clasifica con la tabla de HOY: descarta filas de otra macro aunque la lectura las devuelva', async () => {
    const { reads } = fakeReads([
      row(1),
      row(2, { ciiu4_code: '4610' }), // retail
      row(3, { ciiu4_code: '5510' }), // hoteles: sin macro
      row(4, { ciiu4_code: null }),
    ]);
    const result = await buildPeSunatDirectoryDiscoveryAdapter(reads)({ countryCode: 'PE', macroIndustryKey: 'technology', limit: 10 });
    assert.equal(result.companies.length, 1);
    assert.equal(result.recordsRead, 4);
  });

  it('vuelve a comprobar el tamaño: por debajo de 200 trabajadores o sin dato no se ofrece', async () => {
    const { reads } = fakeReads([row(1, { employees: 200 }), row(2, { employees: 199 }), row(3, { employees: null })]);
    const result = await buildPeSunatDirectoryDiscoveryAdapter(reads)({ countryCode: 'PE', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.taxId), [ruc(1)]);
  });

  it('descarta RUC de persona natural o mal formado, sin nombre y duplicados', async () => {
    const { reads } = fakeReads([
      row(1),
      row(1), // duplicado
      row(2, { ruc: '10452159428' }), // persona natural
      row(3, { ruc: '2060000' }),
      row(4, { ruc: null }),
      row(5, { legal_name: '  ' }),
    ]);
    const result = await buildPeSunatDirectoryDiscoveryAdapter(reads)({ countryCode: 'PE', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.taxId), [ruc(1)]);
  });

  it('respeta el límite pedido (el techo real es 200) y no consulta con límite 0', async () => {
    const { reads, calls } = fakeReads([]);
    const adapter = buildPeSunatDirectoryDiscoveryAdapter(reads);
    await adapter({ countryCode: 'PE', macroIndustryKey: 'technology', limit: 5000 });
    assert.equal(calls[0].limit, PE_SUNAT_DIRECTORY_DISCOVERY_MAX_ROWS);
    assert.equal(PE_SUNAT_DIRECTORY_DISCOVERY_MAX_ROWS, 200);
    await adapter({ countryCode: 'PE', macroIndustryKey: 'technology', limit: 0 });
    assert.equal(calls.length, 1);
  });

  it('una macro sin actividades clasificadas no consulta nada', async () => {
    const { reads, calls } = fakeReads([row(1)]);
    const result = await buildPeSunatDirectoryDiscoveryAdapter(reads)({ countryCode: 'PE', macroIndustryKey: 'no_existe', limit: 5 });
    assert.equal(result.companies.length, 0);
    assert.equal(calls.length, 0);
  });
});

describe('lectura de producción (buildPeSunatDirectoryDiscoveryReads)', () => {
  type Call = { method: string; args: unknown[] };

  function fakeClient(result: { data?: unknown; error?: unknown; throws?: boolean }) {
    const calls: Call[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'eq', 'order']) {
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

  it('lee sólo pe_sunat_directory / PE de la macro pedida, por trabajadores descendente y RUC, con tope', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          record_identity_key: `tax:${ruc(1)}`,
          normalized_tax_id: ruc(1),
          legal_name: 'EMPRESA A S.A.C.',
          normalized_legal_name: 'EMPRESA A',
          city: 'LIMA',
          region: 'LIMA',
          priority_score: '1200',
          raw_data: { ciiu4_code: '6201', activity_text: 'PROGRAMACION INFORMATICA', workers: 1200, metrics_year: 2026, website_domain: 'empresa-a.com.pe' },
        },
        {
          record_identity_key: `tax:${ruc(2)}`,
          normalized_tax_id: ruc(2),
          legal_name: 'EMPRESA B S.A.C.',
          normalized_legal_name: 'EMPRESA B',
          city: null,
          region: null,
          priority_score: null,
          raw_data: { ciiu4_code: 7, activity_text: null, workers: '350.5', metrics_year: 'x' },
        },
      ],
    });
    const rows = await buildPeSunatDirectoryDiscoveryReads(client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 50 });

    assert.deepEqual(rows[0], {
      record_identity_key: `tax:${ruc(1)}`,
      ruc: ruc(1),
      legal_name: 'EMPRESA A S.A.C.',
      normalized_legal_name: 'EMPRESA A',
      city: 'LIMA',
      region: 'LIMA',
      ciiu4_code: '6201',
      activity_text: 'PROGRAMACION INFORMATICA',
      website_domain: 'empresa-a.com.pe',
      employees: 1200,
      metrics_year: 2026,
      priority_score: 1200,
    });
    assert.equal(rows[1].ciiu4_code, null);
    assert.equal(rows[1].activity_text, null);
    assert.equal(rows[1].employees, null);
    assert.equal(rows[1].metrics_year, null);

    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['source_key', 'pe_sunat_directory'],
      ['country_code', 'PE'],
      ['raw_data->>macro_industry_key', 'technology'],
    ]);
    assert.deepEqual(calls.filter((c) => c.method === 'order').map((c) => c.args), [
      ['priority_score', { ascending: false }],
      ['normalized_tax_id', { ascending: true }],
    ]);
    assert.deepEqual(calls.at(-1), { method: 'limit', args: [50] });
  });

  it('con límite 0 no consulta; un error o una excepción devuelven vacío', async () => {
    const idle = fakeClient({ data: [] });
    assert.deepEqual(await buildPeSunatDirectoryDiscoveryReads(idle.client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 0 }), []);
    assert.equal(idle.calls.length, 0);
    for (const failing of [{ error: { message: 'boom' } }, { throws: true }]) {
      assert.deepEqual(
        await buildPeSunatDirectoryDiscoveryReads(fakeClient(failing).client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 5 }),
        [],
      );
    }
  });
});

describe('puerta previa al pago con Perú', () => {
  function gate(rows: PeSunatDirectorySnapshotReadRow[], macroIndustryKey = 'technology') {
    return runPrePaidNoveltyGate(
      { provider: 'apollo', countryCode: 'PE', macroIndustryKey, requestedTarget: 2 },
      {
        countrySourceAdapter: buildPeSunatDirectoryDiscoveryAdapter(fakeReads(rows).reads),
        checkCompanyDuplicate: async (input) => noMatch(input),
        listKnownExclusionDomains: async () => [],
      },
    );
  }

  it('dos sociedades grandes y nuevas cierran el objetivo sin pagar (igual que Ecuador)', async () => {
    const result = await gate([row(1), row(2)]);
    assert.equal(result.context.freeSource.macroConfirmed, 2);
    assert.equal(result.context.residualGap, 0);
    assert.equal(result.context.providerRequired, false);
    assert.equal(result.acceptedCompanies.length, 2);
  });

  it('las de otra macro o pequeñas no cierran hueco', async () => {
    const result = await gate([row(1, { ciiu4_code: '4610' }), row(2, { employees: 50 })]);
    assert.equal(result.acceptedCompanies.length, 0);
    assert.equal(result.context.residualGap, 2);
    assert.equal(result.context.providerRequired, true);
  });

  it('una macro sin cobertura ni siquiera consulta', async () => {
    const result = await gate([row(1)], 'no_existe');
    assert.equal(result.context.freeSource.attempted, false);
    assert.equal(result.context.residualGap, 2);
  });
});

describe('guardas estáticas', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));
  const DIR = 'src/server/prospect-batches/country-source-discovery';

  it('la lectura no escribe, no construye cliente y no lee env', () => {
    const code = read(`${DIR}/pe-sunat-directory-snapshot-query.ts`);
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete|rpc)\s*\(/);
    assert.doesNotMatch(code, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(/);
  });

  it('el adapter y la tabla son puros', () => {
    for (const file of ['pe-sunat-directory-discovery-adapter.ts', 'pe-sunat-macro-table.ts']) {
      assert.doesNotMatch(read(`${DIR}/${file}`), /supabase|process\.env|\bfetch\s*\(|\.from\(\s*['"]/i, file);
    }
  });

  it('el cableado de producción inyecta la lectura de Perú', () => {
    assert.match(
      read(`${DIR}/prepaid-novelty-gate.server.ts`),
      /peSunatDirectoryDiscoveryReads:\s*buildPeSunatDirectoryDiscoveryReads\(adminClient\)/,
    );
  });
});
