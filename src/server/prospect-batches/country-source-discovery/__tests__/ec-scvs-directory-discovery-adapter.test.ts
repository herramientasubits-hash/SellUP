/**
 * SOURCES-EC-FREE-DISCOVERY-1 — descubrimiento gratuito de Ecuador.
 *
 * Tabla CIIU, adapter, lectura con un cliente doble que registra cada llamada
 * (cualquier escritura revienta la prueba) y puerta previa al pago REAL. Cero E/S.
 * Nombres sintéticos; RUC con formato EC-RUC-v1.
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
  buildEcScvsDirectoryDiscoveryAdapter,
  EC_SCVS_DIRECTORY_DISCOVERY_MAX_ROWS,
  EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type EcScvsDirectoryDiscoveryReads,
  type EcScvsDirectorySnapshotReadRow,
} from '../ec-scvs-directory-discovery-adapter';
import { buildEcScvsDirectoryDiscoveryReads } from '../ec-scvs-directory-snapshot-query';
import {
  EC_SCVS_MACRO_TABLE_VERSION,
  macroHasEcCoverage,
  normalizeEcCiiuCode,
  resolveEcActivityMacro,
} from '../ec-scvs-macro-table';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import {
  buildCountrySourceAdapter,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';

function row(n: number, overrides: Partial<EcScvsDirectorySnapshotReadRow> = {}): EcScvsDirectorySnapshotReadRow {
  return {
    record_identity_key: `tax:17912345${String(n).padStart(2, '0')}001`,
    ruc: `17912345${String(n).padStart(2, '0')}001`,
    legal_name: `EMPRESA SINTETICA ${n} S.A.`,
    normalized_legal_name: `EMPRESA SINTETICA ${n}`,
    city: 'QUITO',
    region: 'PICHINCHA',
    ciiu_code: 'J6201.01',
    employees: 900 - n,
    metrics_year: 2025,
    priority_score: 90 - n,
    ...overrides,
  };
}

function fakeReads(rows: EcScvsDirectorySnapshotReadRow[]) {
  const calls: Array<{ macroIndustryKey: string; limit: number }> = [];
  const reads: EcScvsDirectoryDiscoveryReads = {
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

describe('tabla CIIU del INEC → macro', () => {
  it('la división usa la misma tabla aprobada que Argentina', () => {
    assert.equal(resolveEcActivityMacro('J6201.01'), 'technology');
    assert.equal(resolveEcActivityMacro('A0126.01'), 'agroindustry');
    assert.equal(resolveEcActivityMacro('C2410.25'), 'industry_manufacturing_chemicals_automotive');
    assert.equal(resolveEcActivityMacro('G4610.03'), 'retail');
    assert.equal(resolveEcActivityMacro('K6419.01'), 'insurance_financial_services');
    assert.equal(resolveEcActivityMacro('O8411.01'), 'government');
  });

  it('medicamentos y equipo médico dentro del comercio van a Salud; el resto del comercio sigue en Retail', () => {
    for (const code of ['G4649.22', 'G4649.24', 'G4772.01', 'G4772.03']) {
      assert.equal(resolveEcActivityMacro(code), 'health_pharma', code);
    }
    for (const code of ['G4649.21', 'G4649.23', 'G4772.02', 'G4772.04', 'G4773.11']) {
      assert.equal(resolveEcActivityMacro(code), 'retail', code);
    }
  });

  it('v2 (dueña 06-10): mayoristas y tiendas de informática y software a Tecnología; celulares siguen en Retail', () => {
    for (const code of ['G4651.01', 'G4651.02', 'G4652.01', 'G4652.02', 'G4741.11', 'G4741.12']) {
      assert.equal(resolveEcActivityMacro(code), 'technology', code);
    }
    for (const code of ['G4741.13', 'G4653.01', 'G4759.01']) {
      assert.equal(resolveEcActivityMacro(code), 'retail', code);
    }
    assert.equal(EC_SCVS_MACRO_TABLE_VERSION, 'ec-ciiu4-inec-macro-v2');
  });

  it('hoteles, restaurantes, medios, educación y asociaciones no tienen macro', () => {
    for (const code of ['I5510.01', 'I5610.01', 'J6020.01', 'P8530.01', 'S9411.01', 'M7210.01']) {
      assert.equal(resolveEcActivityMacro(code), null, code);
    }
  });

  it('normaliza mayúsculas y espacios, y rechaza códigos sin 6 niveles', () => {
    assert.equal(normalizeEcCiiuCode(' j6201.01 '), 'J6201.01');
    for (const raw of ['J6201', 'J62010.1', '6201.01', 'J6201.1', '', null, undefined]) {
      assert.equal(normalizeEcCiiuCode(raw), null, String(raw));
      assert.equal(resolveEcActivityMacro(raw), null, String(raw));
    }
  });

  it('cobertura por macro', () => {
    assert.equal(macroHasEcCoverage('technology'), true);
    assert.equal(macroHasEcCoverage('health_pharma'), true);
    assert.equal(macroHasEcCoverage('no_existe'), false);
    assert.equal(macroHasEcCoverage(null), false);
  });
});

describe('capacidad por país', () => {
  it('Ecuador tiene fuente gratuita propia y los demás conservan la suya', () => {
    assert.deepEqual(resolveCountrySourceCapability('ec'), {
      countryCode: 'EC',
      sourceKey: 'ec_scvs_directory_discovery',
    });
    assert.equal(resolveCountrySourceCapability('AR')?.sourceKey, 'ar_rns_discovery');
    assert.equal(resolveCountrySourceCapability('CO')?.sourceKey, 'co_siis_discovery');
    assert.equal(resolveCountrySourceCapability('PE'), null);
  });

  it('la cobertura de Ecuador sale de SU tabla', () => {
    assert.equal(countrySourceMacroHasCoverage('EC', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('EC', 'no_existe'), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open al pago)', () => {
    assert.equal(buildCountrySourceAdapter('EC', {}), null);
    assert.equal(buildCountrySourceAdapter('EC', { arRnsDiscoveryReads: { readCompaniesByMacro: async () => [] } }), null);
    assert.ok(buildCountrySourceAdapter('EC', { ecScvsDirectoryDiscoveryReads: fakeReads([]).reads }));
  });
});

describe('buildEcScvsDirectoryDiscoveryAdapter', () => {
  it('ofrece las filas en el orden de la lectura, con RUC, CIIU y macro de la tabla', async () => {
    const { reads, calls } = fakeReads([row(1), row(2)]);
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({
      countryCode: 'EC',
      macroIndustryKey: 'technology',
      limit: 10,
    });

    assert.equal(result.sourceKey, EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.recordsRead, 2);
    assert.deepEqual(calls, [{ macroIndustryKey: 'technology', limit: 10 }]);
    assert.deepEqual(
      result.companies.map((c) => c.taxId),
      ['1791234501001', '1791234502001'],
    );
    const [first] = result.companies;
    assert.equal(first.countryCode, 'EC');
    assert.equal(first.taxIdentifierType, 'RUC');
    // Sin dominio de SERCOP no se fabrica ninguno.
    assert.equal(first.domain, null);
    assert.equal(first.industryCode, 'J6201.01');
    assert.equal(first.city, 'QUITO');
    assert.equal(first.region, 'PICHINCHA');
    assert.deepEqual(first.officialMacroIndustry, {
      macroIndustryKeys: ['technology'],
      tableVersion: EC_SCVS_MACRO_TABLE_VERSION,
    });
  });

  it('re-clasifica con la tabla de HOY: descarta filas de otra macro aunque la lectura las devuelva', async () => {
    const { reads } = fakeReads([
      row(1),
      row(2, { ciiu_code: 'G4610.03' }), // retail
      row(3, { ciiu_code: 'I5510.01' }), // hoteles: sin macro
      row(4, { ciiu_code: null }),
    ]);
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({
      countryCode: 'EC',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.equal(result.companies.length, 1);
    assert.equal(result.recordsRead, 4);
  });

  it('vuelve a comprobar el tamaño: por debajo de 100 empleados o sin dato no se ofrece', async () => {
    const { reads } = fakeReads([
      row(1, { employees: 100 }),
      row(2, { employees: 99 }),
      row(3, { employees: null }),
    ]);
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({
      countryCode: 'EC',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), ['1791234501001']);
  });

  it('sin año del ranking la empresa se ofrece igual (el tamaño ya se comprobó)', async () => {
    const result = await buildEcScvsDirectoryDiscoveryAdapter(fakeReads([row(1, { metrics_year: null })]).reads)({
      countryCode: 'EC',
      macroIndustryKey: 'technology',
      limit: 5,
    });
    assert.equal(result.companies.length, 1);
  });

  it('descarta RUC de persona natural, de provincia inválida o mal formado, sin nombre y duplicados', async () => {
    const { reads } = fakeReads([
      row(1),
      row(1), // duplicado
      row(2, { ruc: '1791234502002' }), // segundo establecimiento
      row(3, { ruc: '9991234503001' }), // provincia 99
      row(4, { ruc: '17912345' }),
      row(5, { ruc: null }),
      row(6, { legal_name: '  ' }),
    ]);
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({
      countryCode: 'EC',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), ['1791234501001']);
  });

  it('respeta el límite pedido (el techo real es 200) y no consulta con límite 0', async () => {
    const { reads, calls } = fakeReads([]);
    const adapter = buildEcScvsDirectoryDiscoveryAdapter(reads);
    await adapter({ countryCode: 'EC', macroIndustryKey: 'technology', limit: 5000 });
    assert.equal(calls[0].limit, EC_SCVS_DIRECTORY_DISCOVERY_MAX_ROWS);
    assert.equal(EC_SCVS_DIRECTORY_DISCOVERY_MAX_ROWS, 200);
    await adapter({ countryCode: 'EC', macroIndustryKey: 'technology', limit: 0 });
    assert.equal(calls.length, 1);
  });

  it('una macro sin actividades clasificadas no consulta nada', async () => {
    const { reads, calls } = fakeReads([row(1)]);
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({
      countryCode: 'EC',
      macroIndustryKey: 'no_existe',
      limit: 5,
    });
    assert.equal(result.companies.length, 0);
    assert.equal(calls.length, 0);
  });
});

describe('lectura de producción (buildEcScvsDirectoryDiscoveryReads)', () => {
  type Call = { method: string; args: unknown[] };

  function fakeClient(result: {
    data?: unknown;
    error?: unknown;
    throws?: boolean;
    candidates?: unknown[];
    discards?: unknown[];
  }) {
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
    // SOURCES-EC-CLOSE-1 — lo ya visto: candidatas y descartes, por RUC.
    let table = '';
    const from = builder.from as (...args: unknown[]) => unknown;
    builder.from = (...args: unknown[]) => {
      table = String(args[0]);
      return from(...args);
    };
    builder.in = (...args: unknown[]) => {
      calls.push({ method: 'in', args });
      if (table === 'prospect_candidates') return Promise.resolve({ data: result.candidates ?? [], error: null });
      return Promise.resolve({ data: result.discards ?? [], error: null });
    };
    for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      builder[write] = () => {
        throw new Error(`escritura prohibida: ${write}`);
      };
    }
    return { client: builder as unknown as SupabaseClient, calls };
  }

  it('lee sólo ec_scvs_directory / EC de la macro pedida, por empleados descendente y RUC, con tope', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          record_identity_key: 'tax:1791234501001',
          normalized_tax_id: '1791234501001',
          legal_name: 'EMPRESA A S.A.',
          normalized_legal_name: 'EMPRESA A',
          city: 'QUITO',
          region: 'PICHINCHA',
          priority_score: '99.5',
          raw_data: { ciiu_code: 'J6201.01', workers: 350, metrics_year: 2025 },
        },
        {
          record_identity_key: 'tax:1791234502001',
          normalized_tax_id: '1791234502001',
          legal_name: 'EMPRESA B S.A.',
          normalized_legal_name: 'EMPRESA B',
          city: null,
          region: null,
          priority_score: null,
          raw_data: { ciiu_code: 7, workers: '350.5', metrics_year: 'x' },
        },
      ],
    });
    const rows = await buildEcScvsDirectoryDiscoveryReads(client).readCompaniesByMacro({
      macroIndustryKey: 'technology',
      limit: 50,
    });

    assert.deepEqual(rows[0], {
      record_identity_key: 'tax:1791234501001',
      ruc: '1791234501001',
      legal_name: 'EMPRESA A S.A.',
      normalized_legal_name: 'EMPRESA A',
      city: 'QUITO',
      region: 'PICHINCHA',
      ciiu_code: 'J6201.01',
      employees: 350,
      metrics_year: 2025,
      priority_score: 99.5,
      website_domain: null,
      prior_sighting: null,
    });
    assert.equal(rows[1].ciiu_code, null);
    assert.equal(rows[1].employees, null);
    assert.equal(rows[1].metrics_year, null);
    assert.equal(rows[1].priority_score, null);

    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    const snapshotRead = calls.slice(0, calls.findIndex((c) => c.method === 'limit') + 1);
    assert.deepEqual(snapshotRead.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['source_key', 'ec_scvs_directory'],
      ['country_code', 'EC'],
      ['raw_data->>macro_industry_key', 'technology'],
    ]);
    assert.deepEqual(calls.filter((c) => c.method === 'order').map((c) => c.args), [
      ['priority_score', { ascending: false }],
      ['normalized_tax_id', { ascending: true }],
    ]);
    // Lee el triple de lo pedido (tope 600) para saltar lo que SellUp ya vio.
    assert.deepEqual(snapshotRead.at(-1), { method: 'limit', args: [150] });
  });

  it('SOURCES-EC-CLOSE-1: marca por RUC lo que SellUp ya vio y lee el dominio de SERCOP', async () => {
    const snapshot = (n: number, raw: Record<string, unknown> = {}) => ({
      record_identity_key: `tax:17912345${n}001`,
      normalized_tax_id: `17912345${n}001`,
      legal_name: `EMPRESA ${n} S.A.`,
      normalized_legal_name: `EMPRESA ${n}`,
      city: null,
      region: null,
      priority_score: 50,
      raw_data: { ciiu_code: 'J6201.01', workers: 300, metrics_year: 2025, ...raw },
    });
    const { client, calls } = fakeClient({
      data: [snapshot(10, { website_domain: 'empresa10.com.ec' }), snapshot(11), snapshot(12), snapshot(13)],
      candidates: [{ tax_identifier: '1791234510001' }],
      discards: [
        { provider_identifier: 'tax:1791234511001', decision: 'discard' },
        { provider_identifier: 'tax:1791234512001', decision: null },
        { provider_identifier: 'tax:1791234510001', decision: null },
      ],
    });
    const rows = await buildEcScvsDirectoryDiscoveryReads(client).readCompaniesByMacro({
      macroIndustryKey: 'technology',
      limit: 300,
    });
    assert.deepEqual(
      rows.map((r) => [r.ruc, r.prior_sighting, r.website_domain]),
      [
        ['1791234510001', 'candidate', 'empresa10.com.ec'],
        ['1791234511001', 'definitive_discard', null],
        ['1791234512001', 'discard', null],
        ['1791234513001', null, null],
      ],
    );
    assert.deepEqual(calls.find((c) => c.method === 'limit'), { method: 'limit', args: [600] });
    const inCalls = calls.filter((c) => c.method === 'in').map((c) => c.args);
    assert.deepEqual(inCalls[0], ['tax_identifier', ['1791234510001', '1791234511001', '1791234512001', '1791234513001']]);
    assert.deepEqual(inCalls[1][1], ['tax:1791234510001', 'tax:1791234511001', 'tax:1791234512001', 'tax:1791234513001']);
  });

  it('con límite 0 no consulta; un error o una excepción devuelven vacío', async () => {
    const idle = fakeClient({ data: [] });
    assert.deepEqual(
      await buildEcScvsDirectoryDiscoveryReads(idle.client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 0 }),
      [],
    );
    assert.equal(idle.calls.length, 0);
    for (const failing of [{ error: { message: 'boom' } }, { throws: true }]) {
      assert.deepEqual(
        await buildEcScvsDirectoryDiscoveryReads(fakeClient(failing).client).readCompaniesByMacro({
          macroIndustryKey: 'technology',
          limit: 5,
        }),
        [],
      );
    }
  });
});

describe('puerta previa al pago con Ecuador', () => {
  function gate(rows: EcScvsDirectorySnapshotReadRow[], macroIndustryKey = 'technology') {
    return runPrePaidNoveltyGate(
      { provider: 'apollo', countryCode: 'EC', macroIndustryKey, requestedTarget: 2 },
      {
        countrySourceAdapter: buildEcScvsDirectoryDiscoveryAdapter(fakeReads(rows).reads),
        checkCompanyDuplicate: async (input) => noMatch(input),
        listKnownExclusionDomains: async () => [],
      },
    );
  }

  it('dos compañías grandes y nuevas cierran el objetivo sin pagar (igual que Argentina)', async () => {
    const result = await gate([row(1), row(2)]);
    assert.equal(result.context.freeSource.macroConfirmed, 2);
    assert.equal(result.context.residualGap, 0);
    assert.equal(result.context.providerRequired, false);
    assert.equal(result.acceptedCompanies.length, 2);
  });

  it('las de otra macro o pequeñas no cierran hueco', async () => {
    const result = await gate([row(1, { ciiu_code: 'G4610.03' }), row(2, { employees: 50 })]);
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
    const code = read(`${DIR}/ec-scvs-directory-snapshot-query.ts`);
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete|rpc)\s*\(/);
    assert.doesNotMatch(code, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(/);
  });

  it('el adapter y la tabla son puros', () => {
    for (const file of ['ec-scvs-directory-discovery-adapter.ts', 'ec-scvs-macro-table.ts']) {
      assert.doesNotMatch(read(`${DIR}/${file}`), /supabase|process\.env|\bfetch\s*\(|\.from\(\s*['"]/i, file);
    }
  });

  it('el cableado de producción inyecta la lectura de Ecuador', () => {
    assert.match(
      read(`${DIR}/prepaid-novelty-gate.server.ts`),
      /ecScvsDirectoryDiscoveryReads:\s*buildEcScvsDirectoryDiscoveryReads\(adminClient\)/,
    );
  });
});

describe('SOURCES-EC-CLOSE-1 — web de SERCOP y no volver a proponer lo ya visto', () => {
  it('el dominio de SERCOP llega al candidato (normalizado); uno mal formado no', async () => {
    const { reads } = fakeReads([
      row(1, { website_domain: ' Empresa1.COM.ec ' }),
      row(2, { website_domain: 'no es un dominio' }),
    ]);
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({
      countryCode: 'EC',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.deepEqual(result.companies.map((c) => c.domain), ['empresa1.com.ec', null]);
  });

  it('salta candidatas y descartes cerrados; un descarte sin web sólo vuelve si ahora la tiene', async () => {
    const { reads } = fakeReads([
      row(1, { prior_sighting: 'candidate', website_domain: 'a.com' }),
      row(2, { prior_sighting: 'definitive_discard', website_domain: 'b.com' }),
      row(3, { prior_sighting: 'discard' }),
      row(4, { prior_sighting: 'discard', website_domain: 'empresa4.com' }),
      row(5, { prior_sighting: null }),
    ]);
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({
      countryCode: 'EC',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), ['1791234504001', '1791234505001']);
    assert.equal(result.recordsRead, 5);
  });

  it('lee de más pero devuelve como mucho lo pedido', async () => {
    const { reads } = fakeReads([row(1), row(2), row(3), row(4)]);
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({
      countryCode: 'EC',
      macroIndustryKey: 'technology',
      limit: 2,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), ['1791234501001', '1791234502001']);
  });
});
