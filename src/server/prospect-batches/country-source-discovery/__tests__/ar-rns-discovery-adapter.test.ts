/**
 * SOURCES-AR-RNS-1 — descubrimiento gratuito de Argentina.
 *
 * Adapter + puerta previa al pago REAL con lecturas dobles y un cliente doble que
 * registra cada llamada (cualquier escritura revienta la prueba). Cero E/S.
 * Nombres sintéticos; CUIT con dígito verificador válido.
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
  AR_RNS_DISCOVERY_MAX_ROWS,
  AR_RNS_DISCOVERY_SOURCE_KEY,
  buildArRnsDiscoveryAdapter,
  type ArRnsDiscoveryReads,
  type ArRnsSnapshotReadRow,
} from '../ar-rns-discovery-adapter';
import { buildArRnsDiscoveryReads } from '../ar-rns-snapshot-query';
import { AR_RNS_MACRO_TABLE_VERSION } from '../ar-rns-macro-table';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import {
  buildCountrySourceAdapter,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';

function row(n: number, overrides: Partial<ArRnsSnapshotReadRow> = {}): ArRnsSnapshotReadRow {
  return {
    record_identity_key: `tax:${n}`,
    cuit: `3050000${String(1000 + n).padStart(4, '0')}`,
    legal_name: `EMPRESA SINTETICA ${n} S.A.`,
    normalized_legal_name: `EMPRESA SINTETICA ${n} S.A.`,
    sector: 'Servicios de informática n.c.p.',
    city: 'CAPITAL FEDERAL',
    region: 'CIUDAD AUTONOMA BUENOS AIRES',
    activity_code: '620100',
    priority_score: 90 - n,
    ...overrides,
  };
}

function fakeReads(rows: ArRnsSnapshotReadRow[]) {
  const calls: Array<{ macroIndustryKey: string; limit: number }> = [];
  const reads: ArRnsDiscoveryReads = {
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

describe('capacidad por país', () => {
  it('Argentina tiene fuente gratuita propia y las demás conservan la suya', () => {
    assert.deepEqual(resolveCountrySourceCapability('ar'), { countryCode: 'AR', sourceKey: 'ar_rns_discovery' });
    assert.equal(resolveCountrySourceCapability('CO')?.sourceKey, 'co_siis_discovery');
    assert.equal(resolveCountrySourceCapability('DO')?.sourceKey, 'do_dgii_discovery');
    assert.equal(resolveCountrySourceCapability('PE'), null);
  });

  it('la cobertura de Argentina sale de SU tabla', () => {
    assert.equal(countrySourceMacroHasCoverage('AR', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('AR', 'agroindustry'), true);
    assert.equal(countrySourceMacroHasCoverage('AR', 'no_existe'), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open al pago)', () => {
    assert.equal(buildCountrySourceAdapter('AR', {}), null);
    assert.equal(buildCountrySourceAdapter('AR', { coSiisSnapshotQuery: async () => [] }), null);
    assert.ok(buildCountrySourceAdapter('AR', { arRnsDiscoveryReads: fakeReads([]).reads }));
  });
});

describe('buildArRnsDiscoveryAdapter', () => {
  it('ofrece las filas en el orden de la lectura, con CUIT, industria oficial y macro de la tabla', async () => {
    const { reads, calls } = fakeReads([row(1), row(2)]);
    const result = await buildArRnsDiscoveryAdapter(reads)({
      countryCode: 'AR',
      macroIndustryKey: 'technology',
      limit: 10,
    });

    assert.equal(result.sourceKey, AR_RNS_DISCOVERY_SOURCE_KEY);
    assert.equal(result.recordsRead, 2);
    assert.deepEqual(calls, [{ macroIndustryKey: 'technology', limit: 10 }]);
    const [first] = result.companies;
    assert.equal(first.countryCode, 'AR');
    assert.equal(first.taxId, '30500001001');
    assert.equal(first.taxIdentifierType, 'CUIT');
    assert.equal(first.domain, null);
    assert.equal(first.industryCode, '620100');
    assert.equal(first.declaredIndustry, 'Servicios de informática n.c.p.');
    assert.deepEqual(first.officialMacroIndustry, {
      macroIndustryKeys: ['technology'],
      tableVersion: AR_RNS_MACRO_TABLE_VERSION,
    });
  });

  it('re-clasifica con la tabla de HOY: descarta filas de otra macro aunque la lectura las devuelva', async () => {
    const { reads } = fakeReads([
      row(1),
      row(2, { activity_code: '471110' }), // retail
      row(3, { activity_code: '551010' }), // hoteles: sin macro
      row(4, { activity_code: null }),
    ]);
    const result = await buildArRnsDiscoveryAdapter(reads)({
      countryCode: 'AR',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.equal(result.companies.length, 1);
    assert.equal(result.recordsRead, 4);
  });

  it('las farmacias (clase 4773) se ofrecen en Salud y no en Retail', async () => {
    const pharmacy = row(1, { activity_code: '477310', sector: 'Venta al por menor de productos farmacéuticos' });
    const health = await buildArRnsDiscoveryAdapter(fakeReads([pharmacy]).reads)({
      countryCode: 'AR',
      macroIndustryKey: 'health_pharma',
      limit: 5,
    });
    const retail = await buildArRnsDiscoveryAdapter(fakeReads([pharmacy]).reads)({
      countryCode: 'AR',
      macroIndustryKey: 'retail',
      limit: 5,
    });
    assert.equal(health.companies.length, 1);
    assert.equal(retail.companies.length, 0);
  });

  it('descarta CUIT de persona física o mal formada, sin nombre y duplicadas', async () => {
    const { reads } = fakeReads([
      row(1),
      row(1), // duplicada
      row(2, { cuit: '20333449588' }), // persona física
      row(3, { cuit: '3050000' }),
      row(4, { cuit: null }),
      row(5, { legal_name: '  ' }),
    ]);
    const result = await buildArRnsDiscoveryAdapter(reads)({
      countryCode: 'AR',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.equal(result.companies.length, 1);
  });

  it('respeta el límite pedido (el techo real es 200) y no consulta con límite 0', async () => {
    const { reads, calls } = fakeReads([]);
    const adapter = buildArRnsDiscoveryAdapter(reads);
    await adapter({ countryCode: 'AR', macroIndustryKey: 'technology', limit: 5000 });
    assert.equal(calls[0].limit, AR_RNS_DISCOVERY_MAX_ROWS);
    assert.equal(AR_RNS_DISCOVERY_MAX_ROWS, 200);
    await adapter({ countryCode: 'AR', macroIndustryKey: 'technology', limit: 0 });
    assert.equal(calls.length, 1);
  });

  it('una macro sin actividades clasificadas no consulta nada', async () => {
    const { reads, calls } = fakeReads([row(1)]);
    const result = await buildArRnsDiscoveryAdapter(reads)({
      countryCode: 'AR',
      macroIndustryKey: 'no_existe',
      limit: 5,
    });
    assert.equal(result.companies.length, 0);
    assert.equal(calls.length, 0);
  });
});

describe('lectura de producción (buildArRnsDiscoveryReads)', () => {
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

  it('lee sólo ar_rns / AR de la macro pedida, por importe descendente y CUIT, con tope', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          record_identity_key: 'tax:1',
          normalized_tax_id: '30500001001',
          legal_name: 'EMPRESA A',
          normalized_legal_name: 'EMPRESA A',
          sector: 'Informática',
          city: 'CAPITAL FEDERAL',
          region: 'CABA',
          priority_score: '99.5',
          raw_data: { actividad_codigo: '620100' },
        },
      ],
    });
    const rows = await buildArRnsDiscoveryReads(client).readCompaniesByMacro({
      macroIndustryKey: 'technology',
      limit: 50,
    });

    assert.deepEqual(rows, [
      {
        record_identity_key: 'tax:1',
        cuit: '30500001001',
        legal_name: 'EMPRESA A',
        normalized_legal_name: 'EMPRESA A',
        sector: 'Informática',
        city: 'CAPITAL FEDERAL',
        region: 'CABA',
        activity_code: '620100',
        priority_score: 99.5,
      },
    ]);
    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args);
    assert.deepEqual(eqs, [
      ['source_key', 'ar_rns'],
      ['country_code', 'AR'],
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
      await buildArRnsDiscoveryReads(idle.client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 0 }),
      [],
    );
    assert.equal(idle.calls.length, 0);
    for (const failing of [{ error: { message: 'boom' } }, { throws: true }]) {
      assert.deepEqual(
        await buildArRnsDiscoveryAdapterReads(failing).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 5 }),
        [],
      );
    }

    function buildArRnsDiscoveryAdapterReads(result: { error?: unknown; throws?: boolean }) {
      return buildArRnsDiscoveryReads(fakeClient(result).client);
    }
  });
});

describe('puerta previa al pago con Argentina', () => {
  function gate(rows: ArRnsSnapshotReadRow[], macroIndustryKey = 'technology') {
    return runPrePaidNoveltyGate(
      { provider: 'lusha', countryCode: 'AR', macroIndustryKey, requestedTarget: 2 },
      {
        countrySourceAdapter: buildArRnsDiscoveryAdapter(fakeReads(rows).reads),
        checkCompanyDuplicate: async (input) => noMatch(input),
        listKnownExclusionDomains: async () => [],
      },
    );
  }

  it('dos adjudicatarias nuevas cierran el objetivo sin pagar (igual que Colombia)', async () => {
    const result = await gate([row(1), row(2)]);
    assert.equal(result.context.freeSource.macroConfirmed, 2);
    assert.equal(result.context.residualGap, 0);
    assert.equal(result.context.providerRequired, false);
    assert.equal(result.acceptedCompanies.length, 2);
  });

  it('las de otra macro no cierran hueco', async () => {
    const result = await gate([row(1, { activity_code: '471110' })]);
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
    const code = read(`${DIR}/ar-rns-snapshot-query.ts`);
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete|rpc)\s*\(/);
    assert.doesNotMatch(code, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(/);
  });

  it('el adapter y la tabla son puros', () => {
    for (const file of ['ar-rns-discovery-adapter.ts', 'ar-rns-macro-table.ts']) {
      assert.doesNotMatch(read(`${DIR}/${file}`), /supabase|process\.env|\bfetch\s*\(|\.from\(\s*['"]/i, file);
    }
  });

  it('el cableado de producción inyecta la lectura de Argentina', () => {
    assert.match(read(`${DIR}/prepaid-novelty-gate.server.ts`), /arRnsDiscoveryReads:\s*buildArRnsDiscoveryReads\(adminClient\)/);
  });
});
