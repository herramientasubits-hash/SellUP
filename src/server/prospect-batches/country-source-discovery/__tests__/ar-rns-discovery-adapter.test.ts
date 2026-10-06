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
  interleaveByOrigin,
  isRecycledArCompany,
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
    assert.equal(resolveCountrySourceCapability('VE'), null);
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

describe('dos orígenes intercalados (SOURCES-AR-E2E-1)', () => {
  it('alterna proveedoras y empleadores respetando el orden de cada lista', () => {
    const p = [row(1), row(2), row(3)];
    const e = [row(11, { origin: 'employer' }), row(12, { origin: 'employer' })];
    assert.deepEqual(
      interleaveByOrigin([...p, ...e]).map((r) => r.record_identity_key),
      ['tax:1', 'tax:11', 'tax:2', 'tax:12', 'tax:3'],
    );
  });

  it('una CUIT en las dos cargas sale una sola vez y el tope se respeta', async () => {
    const shared = row(1);
    const rows = [
      shared,
      row(2),
      { ...shared, origin: 'employer' as const, record_identity_key: 'tax:1-atp' },
      row(13, { origin: 'employer' }),
      row(14, { origin: 'employer' }),
    ];
    const result = await buildArRnsDiscoveryAdapter(fakeReads(rows).reads)({
      countryCode: 'AR',
      macroIndustryKey: 'technology',
      limit: 3,
    });
    assert.deepEqual(
      result.companies.map((c) => c.recordIdentityKey),
      ['tax:1', 'tax:2', 'tax:13'],
    );
    assert.equal(result.recordsRead, rows.length);
  });

  it('si una carga está vacía, la otra llena sola', async () => {
    const rows = [row(11, { origin: 'employer' }), row(12, { origin: 'employer' })];
    const result = await buildArRnsDiscoveryAdapter(fakeReads(rows).reads)({
      countryCode: 'AR',
      macroIndustryKey: 'technology',
      limit: 5,
    });
    assert.equal(result.companies.length, 2);
  });
});

describe('dominio del SIPRO histórico (SOURCES-AR-SIPRO-DOMAIN-1)', () => {
  it('la empresa llega con el dominio que guardó la carga, normalizado', async () => {
    const result = await buildArRnsDiscoveryAdapter(
      fakeReads([row(1, { website_domain: ' Telecom.COM.ar ' }), row(2)]).reads,
    )({ countryCode: 'AR', macroIndustryKey: 'technology', limit: 5 });
    assert.equal(result.companies[0]?.domain, 'telecom.com.ar');
    assert.equal(result.companies[1]?.domain, null, 'sin dominio en la carga, no se fabrica');
  });

  it('un valor con forma imposible no se usa como dominio', async () => {
    for (const bad of ['telecom', 'http://telecom.com.ar', 'a b.com', '']) {
      const result = await buildArRnsDiscoveryAdapter(fakeReads([row(1, { website_domain: bad })]).reads)({
        countryCode: 'AR',
        macroIndustryKey: 'technology',
        limit: 5,
      });
      assert.equal(result.companies[0]?.domain, null, bad);
    }
  });

  it('la lectura toma raw_data.website_domain', async () => {
    const builder: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'eq', 'order']) builder[m] = () => builder;
    builder.limit = () =>
      Promise.resolve({
        data: [
          {
            record_identity_key: 'tax:1',
            normalized_tax_id: '30639453738',
            legal_name: 'TELECOM ARGENTINA SOCIEDAD ANONIMA',
            normalized_legal_name: 'TELECOM ARGENTINA SOCIEDAD ANONIMA',
            sector: null,
            city: null,
            region: null,
            priority_score: 99,
            raw_data: { actividad_codigo: '611090', website_domain: 'telecom.com.ar' },
          },
        ],
        error: null,
      });
    const rows = await buildArRnsDiscoveryReads(builder as unknown as SupabaseClient).readCompaniesByMacro({
      macroIndustryKey: 'technology',
      limit: 5,
    });
    assert.equal(rows[0]?.website_domain, 'telecom.com.ar');
  });
});

describe('no reciclar lo que SellUp ya vio (SOURCES-AR-NO-RECYCLE-1)', () => {
  it('salta candidatas y descartes cerrados; un descarte sin web sólo vuelve si ahora tiene dominio', () => {
    assert.equal(isRecycledArCompany({ prior_sighting: 'candidate', website_domain: 'x.com.ar' }), true);
    assert.equal(isRecycledArCompany({ prior_sighting: 'definitive_discard', website_domain: 'x.com.ar' }), true);
    assert.equal(isRecycledArCompany({ prior_sighting: 'discard', website_domain: null }), true);
    assert.equal(isRecycledArCompany({ prior_sighting: 'discard', website_domain: 'telecom.com.ar' }), false);
    assert.equal(isRecycledArCompany({ prior_sighting: null, website_domain: null }), false);
    assert.equal(isRecycledArCompany({}), false);
  });

  it('el adapter llena el tope con empresas nuevas saltando las ya vistas', async () => {
    const rows = [
      row(1, { prior_sighting: 'candidate' }),
      row(2, { prior_sighting: 'discard' }),
      row(3, { prior_sighting: 'discard', website_domain: 'empresa3.com.ar' }),
      row(4),
      row(5),
    ];
    const result = await buildArRnsDiscoveryAdapter(fakeReads(rows).reads)({
      countryCode: 'AR',
      macroIndustryKey: 'technology',
      limit: 2,
    });
    assert.deepEqual(result.companies.map((c) => c.recordIdentityKey), ['tax:3', 'tax:4']);
    assert.equal(result.recordsRead, rows.length);
  });
});

describe('la lectura marca lo ya visto (SOURCES-AR-NO-RECYCLE-1)', () => {
  function tableClient(tables: Record<string, unknown[]>) {
    const make = (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) b[m] = () => b;
      b.limit = () => Promise.resolve({ data: tables[table] ?? [], error: null });
      b.in = () => Promise.resolve({ data: tables[table] ?? [], error: null });
      for (const w of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
        b[w] = () => {
          throw new Error(`escritura prohibida: ${w}`);
        };
      }
      return b;
    };
    return { from: (table: string) => make(table) } as unknown as SupabaseClient;
  }
  const snap = (cuit: string) => ({
    record_identity_key: `tax:${cuit}`,
    normalized_tax_id: cuit,
    legal_name: `EMPRESA ${cuit}`,
    normalized_legal_name: `EMPRESA ${cuit}`,
    sector: null,
    city: null,
    region: null,
    priority_score: 50,
    raw_data: { actividad_codigo: '620100' },
  });

  it('candidata > descarte cerrado > descarte; sin rastro = null', async () => {
    const client = tableClient({
      source_company_snapshots: [snap('30500001001'), snap('30500001002'), snap('30500001003'), snap('30500001004')],
      prospect_candidates: [{ tax_identifier: '30500001001' }],
      prospect_discarded_dispositions: [
        { provider_identifier: 'tax:30500001001', decision: 'website_not_found' },
        { provider_identifier: 'tax:30500001002', decision: 'discard' },
        { provider_identifier: 'tax:30500001003', decision: null },
      ],
    });
    const rows = await buildArRnsDiscoveryReads(client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 5 });
    const byCuit = new Map(rows.map((r) => [r.cuit, r.prior_sighting]));
    assert.equal(byCuit.get('30500001001'), 'candidate');
    assert.equal(byCuit.get('30500001002'), 'definitive_discard');
    assert.equal(byCuit.get('30500001003'), 'discard');
    assert.equal(byCuit.get('30500001004'), null);
  });

  it('si la consulta de «ya visto» falla, la fila se ofrece igual (fail-open)', async () => {
    const client = tableClient({ source_company_snapshots: [snap('30500001001')] });
    const broken = {
      from: (table: string) => {
        if (table === 'source_company_snapshots') return (client as unknown as { from: (t: string) => unknown }).from(table);
        throw new Error('caída');
      },
    } as unknown as SupabaseClient;
    const rows = await buildArRnsDiscoveryReads(broken).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 5 });
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.prior_sighting === null));
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
    // SOURCES-AR-NO-RECYCLE-1 — la consulta de «ya visto» termina en `.in(...)`.
    builder.in = (...args: unknown[]) => {
      calls.push({ method: 'in', args });
      return Promise.resolve({ data: [], error: null });
    };
    for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      builder[write] = () => {
        throw new Error(`escritura prohibida: ${write}`);
      };
    }
    return { client: builder as unknown as SupabaseClient, calls };
  }

  it('lee ar_rns y ar_atp_employers / AR de la macro pedida, por puntaje y CUIT, con tope', async () => {
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

    const expected = {
      record_identity_key: 'tax:1',
      cuit: '30500001001',
      legal_name: 'EMPRESA A',
      normalized_legal_name: 'EMPRESA A',
      sector: 'Informática',
      city: 'CAPITAL FEDERAL',
      region: 'CABA',
      activity_code: '620100',
      priority_score: 99.5,
      website_domain: null,
      prior_sighting: null,
    };
    assert.deepEqual(rows, [
      { origin: 'procurement', ...expected },
      { origin: 'employer', ...expected },
    ]);
    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    const snapshotCalls = calls.slice(0, calls.findIndex((c) => c.method === 'in'));
    const eqs = snapshotCalls.filter((c) => c.method === 'eq').map((c) => c.args);
    assert.deepEqual(eqs, [
      ['source_key', 'ar_rns'],
      ['country_code', 'AR'],
      ['raw_data->>macro_industry_key', 'technology'],
      ['source_key', 'ar_atp_employers'],
      ['country_code', 'AR'],
      ['raw_data->>macro_industry_key', 'technology'],
    ]);
    const order = [
      ['priority_score', { ascending: false }],
      ['normalized_tax_id', { ascending: true }],
    ];
    assert.deepEqual(snapshotCalls.filter((c) => c.method === 'order').map((c) => c.args), [...order, ...order]);
    // SOURCES-AR-NO-RECYCLE-1 — se lee el triple para compensar lo ya visto.
    assert.deepEqual(
      snapshotCalls.filter((c) => c.method === 'limit').map((c) => c.args),
      [[150], [150]],
    );
    // Lo «ya visto» se pregunta a candidatas y descartadas, sólo lectura.
    const tables = calls.filter((c) => c.method === 'from').map((c) => c.args[0]);
    assert.deepEqual(tables.slice(2), ['prospect_candidates', 'prospect_discarded_dispositions']);
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
