/**
 * SOURCES-CL-SII-FREE-DISCOVERY-1 — descubrimiento gratuito de Chile.
 *
 * Tabla de actividades del SII, adapter, lectura con un cliente doble que
 * registra cada llamada (cualquier escritura revienta la prueba) y puerta previa
 * al pago REAL. Cero E/S. Nombres sintéticos; RUT con dígito verificador real.
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
import { calculateChileCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';
import {
  buildClSiiDirectoryDiscoveryAdapter,
  CL_SII_DIRECTORY_DISCOVERY_MAX_ROWS,
  CL_SII_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type ClSiiDirectoryDiscoveryReads,
  type ClSiiDirectorySnapshotReadRow,
} from '../cl-sii-directory-discovery-adapter';
import { buildClSiiDirectoryDiscoveryReads } from '../cl-sii-directory-snapshot-query';
import {
  CL_SII_HOLDING_MACRO_BY_RUT,
  CL_SII_MACRO_TABLE_VERSION,
  macroHasClCoverage,
  normalizeClActivityCode,
  resolveClActivityMacro,
} from '../cl-sii-macro-table';
import { AR_RNS_DIVISION_MACRO } from '../ar-rns-macro-table';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';

const TECH_CODE = '620200';
const TECH_TEXT = 'ACTIVIDADES DE CONSULTORIA DE INFORMATICA Y DE GESTION DE INSTALACIONES INFORMATICAS';

/** RUT sintético con dígito verificador correcto. */
function rut(n: number): string {
  const body = String(76_000_000 + n);
  return `${body}-${calculateChileCheckDigit(body)}`;
}

function row(n: number, overrides: Partial<ClSiiDirectorySnapshotReadRow> = {}): ClSiiDirectorySnapshotReadRow {
  return {
    record_identity_key: `tax:${rut(n)}`,
    rut: rut(n),
    legal_name: `EMPRESA SINTETICA ${n} SPA`,
    normalized_legal_name: `EMPRESA SINTETICA ${n}`,
    activity_code: TECH_CODE,
    activity: TECH_TEXT,
    workers: 900 - n,
    metrics_year: 2024,
    priority_score: 90 - n,
    ...overrides,
  };
}

function fakeReads(rows: ClSiiDirectorySnapshotReadRow[]) {
  const calls: Array<{ macroIndustryKey: string; limit: number }> = [];
  const reads: ClSiiDirectoryDiscoveryReads = {
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

describe('tabla de actividades del SII → macro (tabla CL aprobada 05-10-2026)', () => {
  it('la división usa la misma tabla aprobada que Argentina', () => {
    assert.equal(resolveClActivityMacro('620200'), 'technology');
    assert.equal(resolveClActivityMacro('619090'), 'technology');
    assert.equal(resolveClActivityMacro('641910'), 'insurance_financial_services');
    assert.equal(resolveClActivityMacro('471100'), 'retail');
    assert.equal(resolveClActivityMacro('861020'), 'health_pharma');
    assert.equal(resolveClActivityMacro('841100'), 'government');
    assert.equal(resolveClActivityMacro('089900'), 'energy_mining_environment');
    assert.equal(resolveClActivityMacro('170190'), 'industry_manufacturing_chemicals_automotive');
    for (const [division, macro] of Object.entries(AR_RNS_DIVISION_MACRO)) {
      assert.equal(resolveClActivityMacro(`${division}9999`), macro, division);
    }
  });

  it('el cobre (división 04, propia de Chile) va a Energía y minería', () => {
    assert.equal(resolveClActivityMacro('040000'), 'energy_mining_environment');
  });

  it('medicamentos, instrumental médico, farmacias y ortopedia van a Salud; el resto del comercio sigue en Retail', () => {
    for (const code of ['464907', '464908', '477201', '477202']) {
      assert.equal(resolveClActivityMacro(code), 'health_pharma', code);
    }
    for (const code of ['464903', '477203', '477393', '471100']) {
      assert.equal(resolveClActivityMacro(code), 'retail', code);
    }
  });

  it('mayoristas y tiendas de informática y telecomunicaciones van a Tecnología (como Argentina v2)', () => {
    for (const code of ['465100', '465200', '474100']) {
      assert.equal(resolveClActivityMacro(code), 'technology', code);
    }
    assert.equal(resolveClActivityMacro('474200'), 'retail'); // equipo de sonido y video sigue en Retail
  });

  it('fondos y sociedades de inversión (643000): sin industria salvo la lista revisada a mano', () => {
    assert.equal(resolveClActivityMacro('643000'), null);
    assert.equal(resolveClActivityMacro('643000', rut(1)), null);
    assert.equal(resolveClActivityMacro('643000', '77261280-K'), 'retail'); // Falabella Retail
    assert.equal(resolveClActivityMacro('643000', '77261280-k'), 'retail');
    assert.equal(resolveClActivityMacro('643000', '76536353-5'), 'energy_mining_environment'); // Enel Chile
    assert.equal(resolveClActivityMacro('643000', '76020458-7'), 'health_pharma'); // Red Salud
    assert.equal(resolveClActivityMacro('643000', '96530900-4'), 'insurance_financial_services'); // BCI AM
    // La lista sólo corrige la actividad 643000: con otro código manda la tabla.
    assert.equal(resolveClActivityMacro('620200', '77261280-K'), 'technology');
    assert.equal(Object.keys(CL_SII_HOLDING_MACRO_BY_RUT).length, 25);
  });

  it('hoteles, restaurantes, medios, investigación, educación y asociaciones no tienen macro', () => {
    for (const code of ['551001', '561000', '601000', '602000', '721000', '850022', '853120', '949903', '931201']) {
      assert.equal(resolveClActivityMacro(code), null, code);
    }
  });

  it('rechaza códigos que no son de 6 dígitos', () => {
    assert.equal(normalizeClActivityCode(' 620200 '), '620200');
    for (const raw of ['62020', '6202000', 'J62020', '', null, undefined]) {
      assert.equal(normalizeClActivityCode(raw), null, String(raw));
      assert.equal(resolveClActivityMacro(raw), null, String(raw));
    }
  });

  it('cobertura por macro', () => {
    assert.equal(macroHasClCoverage('technology'), true);
    assert.equal(macroHasClCoverage('government'), true);
    assert.equal(macroHasClCoverage('health_pharma'), true);
    assert.equal(macroHasClCoverage('no_existe'), false);
    assert.equal(macroHasClCoverage(null), false);
  });
});

describe('capacidad por país', () => {
  it('Chile tiene fuente gratuita propia y los demás conservan la suya', () => {
    assert.ok(COUNTRY_SOURCE_DISCOVERY_COUNTRIES.includes('CL'));
    assert.deepEqual(resolveCountrySourceCapability('cl'), {
      countryCode: 'CL',
      sourceKey: 'cl_sii_directory_discovery',
    });
    assert.equal(resolveCountrySourceCapability('EC')?.sourceKey, 'ec_scvs_directory_discovery');
    assert.equal(resolveCountrySourceCapability('CO')?.sourceKey, 'co_siis_discovery');
    assert.equal(resolveCountrySourceCapability('PE'), null);
  });

  it('la cobertura de Chile sale de SU tabla', () => {
    assert.equal(countrySourceMacroHasCoverage('CL', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('CL', 'no_existe'), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open al pago)', () => {
    assert.equal(buildCountrySourceAdapter('CL', {}), null);
    assert.equal(
      buildCountrySourceAdapter('CL', { ecScvsDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } }),
      null,
    );
    assert.ok(buildCountrySourceAdapter('CL', { clSiiDirectoryDiscoveryReads: fakeReads([]).reads }));
  });
});

describe('buildClSiiDirectoryDiscoveryAdapter', () => {
  it('ofrece las filas en el orden de la lectura, con RUT, actividad y macro de la tabla', async () => {
    const { reads, calls } = fakeReads([row(1), row(2)]);
    const result = await buildClSiiDirectoryDiscoveryAdapter(reads)({
      countryCode: 'CL',
      macroIndustryKey: 'technology',
      limit: 10,
    });

    assert.equal(result.sourceKey, CL_SII_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.recordsRead, 2);
    assert.deepEqual(calls, [{ macroIndustryKey: 'technology', limit: 10 }]);
    assert.deepEqual(result.companies.map((c) => c.taxId), [rut(1), rut(2)]);
    const [first] = result.companies;
    assert.equal(first.countryCode, 'CL');
    assert.equal(first.taxIdentifierType, 'RUT');
    assert.equal(first.domain, null);
    assert.equal(first.industryCode, TECH_CODE);
    assert.equal(first.declaredIndustry, TECH_TEXT);
    assert.deepEqual(first.officialMacroIndustry, {
      macroIndustryKeys: ['technology'],
      tableVersion: CL_SII_MACRO_TABLE_VERSION,
    });
  });

  it('re-clasifica con la tabla de HOY: descarta filas de otra macro aunque la lectura las devuelva', async () => {
    const { reads } = fakeReads([
      row(1),
      row(2, { activity_code: '471100', activity: 'VENTA AL POR MENOR EN COMERCIOS DE ALIMENTOS, BEBIDAS O TABACO (SUPERMERCADOS E HIPERMERCADOS)' }),
      row(3, { activity_code: '551001', activity: 'ACTIVIDADES DE HOTELES' }),
      row(4, { activity_code: null }),
    ]);
    const result = await buildClSiiDirectoryDiscoveryAdapter(reads)({
      countryCode: 'CL',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), [rut(1)]);
    assert.equal(result.recordsRead, 4);
  });

  it('código y texto de actividad que no coinciden no se ofrecen', async () => {
    const { reads } = fakeReads([
      row(1),
      row(2, { activity: 'ACTIVIDADES DE PAISAJISMO, SERVICIOS DE JARDINERIA Y SERVICIOS CONEXOS' }),
      row(3, { activity: null }),
    ]);
    const result = await buildClSiiDirectoryDiscoveryAdapter(reads)({
      countryCode: 'CL',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), [rut(1)]);
  });

  it('vuelve a comprobar el tamaño: por debajo de 100 trabajadores o sin dato no se ofrece', async () => {
    const { reads } = fakeReads([
      row(1, { workers: 100 }),
      row(2, { workers: 99 }),
      row(3, { workers: null }),
    ]);
    const result = await buildClSiiDirectoryDiscoveryAdapter(reads)({
      countryCode: 'CL',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), [rut(1)]);
  });

  it('un holding revisado a mano se ofrece en su industria real, no en Finanzas', async () => {
    const holding = row(1, {
      rut: '77261280-K',
      activity_code: '643000',
      activity: 'FONDOS Y SOCIEDADES DE INVERSION Y ENTIDADES FINANCIERAS SIMILARES',
    });
    const adapter = buildClSiiDirectoryDiscoveryAdapter(fakeReads([holding]).reads);
    const asRetail = await adapter({ countryCode: 'CL', macroIndustryKey: 'retail', limit: 5 });
    const asFinance = await adapter({ countryCode: 'CL', macroIndustryKey: 'insurance_financial_services', limit: 5 });
    assert.deepEqual(asRetail.companies.map((c) => c.taxId), ['77261280-K']);
    assert.equal(asFinance.companies.length, 0);
  });

  it('descarta RUT con dígito verificador malo o mal formado, sin nombre y duplicados', async () => {
    const good = rut(1);
    const badDv = `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`;
    const { reads } = fakeReads([
      row(1),
      row(1), // duplicado
      row(2, { rut: badDv }),
      row(3, { rut: '7600' }),
      row(4, { rut: null }),
      row(5, { legal_name: '  ' }),
    ]);
    const result = await buildClSiiDirectoryDiscoveryAdapter(reads)({
      countryCode: 'CL',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), [good]);
  });

  it('respeta el límite pedido (el techo real es 200) y no consulta con límite 0', async () => {
    const { reads, calls } = fakeReads([]);
    const adapter = buildClSiiDirectoryDiscoveryAdapter(reads);
    await adapter({ countryCode: 'CL', macroIndustryKey: 'technology', limit: 5000 });
    assert.equal(calls[0].limit, CL_SII_DIRECTORY_DISCOVERY_MAX_ROWS);
    assert.equal(CL_SII_DIRECTORY_DISCOVERY_MAX_ROWS, 200);
    await adapter({ countryCode: 'CL', macroIndustryKey: 'technology', limit: 0 });
    assert.equal(calls.length, 1);
  });

  it('una macro sin actividades clasificadas no consulta nada', async () => {
    const { reads, calls } = fakeReads([row(1)]);
    const result = await buildClSiiDirectoryDiscoveryAdapter(reads)({
      countryCode: 'CL',
      macroIndustryKey: 'no_existe',
      limit: 5,
    });
    assert.equal(result.companies.length, 0);
    assert.equal(calls.length, 0);
  });
});

describe('lectura de producción (buildClSiiDirectoryDiscoveryReads)', () => {
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

  it('lee sólo cl_sii_directory / CL de la macro pedida, por trabajadores descendente y RUT, con tope', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          record_identity_key: `tax:${rut(1)}`,
          normalized_tax_id: rut(1),
          legal_name: 'EMPRESA A SPA',
          normalized_legal_name: 'EMPRESA A',
          priority_score: '99.5',
          raw_data: { activity_code: TECH_CODE, activity: TECH_TEXT, workers: 350, metrics_year: 2024 },
        },
        {
          record_identity_key: `tax:${rut(2)}`,
          normalized_tax_id: rut(2),
          legal_name: 'EMPRESA B SPA',
          normalized_legal_name: 'EMPRESA B',
          priority_score: null,
          raw_data: { activity_code: 7, activity: null, workers: '350.5', metrics_year: 'x' },
        },
      ],
    });
    const rows = await buildClSiiDirectoryDiscoveryReads(client).readCompaniesByMacro({
      macroIndustryKey: 'technology',
      limit: 50,
    });

    assert.deepEqual(rows[0], {
      record_identity_key: `tax:${rut(1)}`,
      rut: rut(1),
      legal_name: 'EMPRESA A SPA',
      normalized_legal_name: 'EMPRESA A',
      activity_code: TECH_CODE,
      activity: TECH_TEXT,
      workers: 350,
      metrics_year: 2024,
      priority_score: 99.5,
    });
    assert.equal(rows[1].activity_code, null);
    assert.equal(rows[1].activity, null);
    assert.equal(rows[1].workers, null);
    assert.equal(rows[1].metrics_year, null);
    assert.equal(rows[1].priority_score, null);

    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['source_key', 'cl_sii_directory'],
      ['country_code', 'CL'],
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
    assert.deepEqual(
      await buildClSiiDirectoryDiscoveryReads(idle.client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 0 }),
      [],
    );
    assert.equal(idle.calls.length, 0);
    for (const failing of [{ error: { message: 'boom' } }, { throws: true }]) {
      assert.deepEqual(
        await buildClSiiDirectoryDiscoveryReads(fakeClient(failing).client).readCompaniesByMacro({
          macroIndustryKey: 'technology',
          limit: 5,
        }),
        [],
      );
    }
  });
});

describe('puerta previa al pago con Chile', () => {
  function gate(rows: ClSiiDirectorySnapshotReadRow[], macroIndustryKey = 'technology') {
    return runPrePaidNoveltyGate(
      { provider: 'apollo', countryCode: 'CL', macroIndustryKey, requestedTarget: 2 },
      {
        countrySourceAdapter: buildClSiiDirectoryDiscoveryAdapter(fakeReads(rows).reads),
        checkCompanyDuplicate: async (input) => noMatch(input),
        listKnownExclusionDomains: async () => [],
      },
    );
  }

  it('dos empresas grandes y nuevas cierran el objetivo sin pagar (igual que Ecuador)', async () => {
    const result = await gate([row(1), row(2)]);
    assert.equal(result.context.freeSource.macroConfirmed, 2);
    assert.equal(result.context.residualGap, 0);
    assert.equal(result.context.providerRequired, false);
    assert.equal(result.acceptedCompanies.length, 2);
  });

  it('las de otra macro o pequeñas no cierran hueco', async () => {
    const result = await gate([
      row(1, { activity_code: '551001', activity: 'ACTIVIDADES DE HOTELES' }),
      row(2, { workers: 50 }),
    ]);
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
    const code = read(`${DIR}/cl-sii-directory-snapshot-query.ts`);
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete|rpc)\s*\(/);
    assert.doesNotMatch(code, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(/);
  });

  it('el adapter y la tabla son puros', () => {
    for (const file of ['cl-sii-directory-discovery-adapter.ts', 'cl-sii-macro-table.ts']) {
      assert.doesNotMatch(read(`${DIR}/${file}`), /supabase|process\.env|\bfetch\s*\(|\.from\(\s*['"]/i, file);
    }
  });

  it('el cableado de producción inyecta la lectura de Chile', () => {
    assert.match(
      read(`${DIR}/prepaid-novelty-gate.server.ts`),
      /clSiiDirectoryDiscoveryReads:\s*buildClSiiDirectoryDiscoveryReads\(adminClient\)/,
    );
  });
});
