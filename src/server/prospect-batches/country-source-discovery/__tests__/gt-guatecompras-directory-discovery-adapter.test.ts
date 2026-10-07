/**
 * SOURCES-GT-CLOSE-1 — descubrimiento gratuito de Guatemala (sociedades a las que
 * el Estado adjudicó en Guatecompras).
 *
 * Tabla y relevancia, capacidad por país, adapter, lectura con un cliente doble
 * que registra cada llamada (cualquier escritura revienta la prueba) y puerta
 * previa al pago REAL. Cero E/S. Nombres y NIT sintéticos (con dígito verificador
 * válido).
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
  buildGtGuatecomprasDirectoryDiscoveryAdapter,
  GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_MAX_ROWS,
  GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type GtGuatecomprasDirectoryDiscoveryReads,
  type GtGuatecomprasDirectorySnapshotReadRow,
} from '../gt-guatecompras-directory-discovery-adapter';
import { buildGtGuatecomprasDirectoryDiscoveryReads } from '../gt-guatecompras-directory-snapshot-query';
import {
  GT_GUATECOMPRAS_MACRO_TABLE_VERSION,
  GT_GUATECOMPRAS_MIN_AWARDED_GTQ,
  isGtGuatecomprasRelevant,
  macroHasGtGuatecomprasCoverage,
  resolveGtGuatecomprasSupplierMacro,
  resolveGtUnspscMacro,
  resolveGtUnspscRubro,
} from '../gt-guatecompras-macro-table';
import { resolvePyDncpSupplierMacro, resolvePyUnspscMacro } from '../py-dncp-macro-table';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import {
  buildUnverifiedFreeDispositionRows,
  FREE_SOURCE_MISSING_DOMAIN_REASON_CODE,
  partitionFreeCompaniesByDomain,
} from '../free-source-unverified';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';
import { guatemalaNitCheckDigit } from '@/server/source-catalog/connectors/gt-guatecompras/gt-nit';

/** NIT sintético con dígito verificador válido. */
const nit = (n: number): string => {
  const body = String(9_000_000 + n);
  return `${body}${guatemalaNitCheckDigit(body)}`;
};

function row(n: number, overrides: Partial<GtGuatecomprasDirectorySnapshotReadRow> = {}): GtGuatecomprasDirectorySnapshotReadRow {
  return {
    record_identity_key: `tax:${nit(n)}`,
    nit: nit(n),
    legal_name: `EMPRESA SINTETICA ${n}, SOCIEDAD ANONIMA`,
    normalized_legal_name: `EMPRESA SINTETICA ${n}`,
    city: 'GUATEMALA',
    region: 'GUATEMALA',
    unspsc_family: '4321',
    activity_text: 'Computadoras',
    website_domain: `sintetica${n}.com.gt`,
    sat_iva_agent: true,
    awarded_gtq: 1_000_000,
    priority_score: 1_009_000 - n,
    ...overrides,
  };
}

function fakeReads(rows: GtGuatecomprasDirectorySnapshotReadRow[]) {
  const calls: Array<{ macroIndustryKey: string; limit: number }> = [];
  const reads: GtGuatecomprasDirectoryDiscoveryReads = {
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

describe('tabla UNSPSC de Guatemala → macro (la misma aprobada para Paraguay)', () => {
  it('clasifica igual que la tabla de Paraguay, con versión propia', () => {
    assert.equal(GT_GUATECOMPRAS_MACRO_TABLE_VERSION, 'gt-unspsc-guatecompras-macro-v1');
    for (const code of ['43211503', '42181801', '72131601', '81111504', '83111603', '78111502', '90101501', '51181699']) {
      assert.equal(resolveGtUnspscMacro(code), resolvePyUnspscMacro(code), code);
    }
    const families = { '4321': 700, '8111': 200, '4410': 100 };
    assert.deepEqual(resolveGtGuatecomprasSupplierMacro(families), resolvePyDncpSupplierMacro(families));
    assert.equal(resolveGtGuatecomprasSupplierMacro({ '4321': 40, '4218': 30, '7213': 30 }), null);
    assert.equal(resolveGtUnspscRubro('8111'), 'Servicios informáticos (software, desarrollo, soporte)');
  });

  it('relevancia: agente de retención del IVA o al menos Q5 millones adjudicados', () => {
    assert.equal(GT_GUATECOMPRAS_MIN_AWARDED_GTQ, 5_000_000);
    assert.equal(isGtGuatecomprasRelevant({ satIvaAgent: true, awardedGtq: 0 }), true);
    assert.equal(isGtGuatecomprasRelevant({ satIvaAgent: false, awardedGtq: 5_000_000 }), true);
    assert.equal(isGtGuatecomprasRelevant({ satIvaAgent: false, awardedGtq: 4_999_999 }), false);
    assert.equal(isGtGuatecomprasRelevant({ satIvaAgent: false, awardedGtq: Number.NaN }), false);
  });

  it('cobertura por macro (Gobierno no se ofrece desde los proveedores)', () => {
    assert.equal(macroHasGtGuatecomprasCoverage('technology'), true);
    assert.equal(macroHasGtGuatecomprasCoverage('government'), false);
    assert.equal(macroHasGtGuatecomprasCoverage(null), false);
  });
});

describe('capacidad por país', () => {
  it('Guatemala tiene fuente gratuita propia y los demás conservan la suya', () => {
    assert.ok(COUNTRY_SOURCE_DISCOVERY_COUNTRIES.includes('GT'));
    assert.deepEqual(resolveCountrySourceCapability(' gt '), {
      countryCode: 'GT',
      sourceKey: 'gt_guatecompras_directory_discovery',
    });
    assert.equal(resolveCountrySourceCapability('PY')?.sourceKey, 'py_dncp_directory_discovery');
    // Honduras y Panamá comparten la limpieza centroamericana, pero no tienen capa gratuita.
    assert.equal(resolveCountrySourceCapability('HN'), null);
    assert.equal(resolveCountrySourceCapability('PA'), null);
  });

  it('la cobertura de Guatemala sale de SU tabla', () => {
    assert.equal(countrySourceMacroHasCoverage('GT', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('GT', 'government'), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open al pago)', () => {
    assert.equal(buildCountrySourceAdapter('GT', {}), null);
    assert.equal(buildCountrySourceAdapter('GT', { pyDncpDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } }), null);
    assert.ok(buildCountrySourceAdapter('GT', { gtGuatecomprasDirectoryDiscoveryReads: fakeReads([]).reads }));
  });
});

describe('buildGtGuatecomprasDirectoryDiscoveryAdapter', () => {
  it('ofrece las filas en el orden de la lectura, con NIT, web, rubro y macro de la tabla', async () => {
    const { reads, calls } = fakeReads([row(1), row(2)]);
    const result = await buildGtGuatecomprasDirectoryDiscoveryAdapter(reads)({
      countryCode: 'GT',
      macroIndustryKey: 'technology',
      limit: 10,
    });
    assert.equal(result.sourceKey, GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.recordsRead, 2);
    assert.deepEqual(calls, [{ macroIndustryKey: 'technology', limit: 10 }]);
    assert.deepEqual(result.companies[0], {
      recordIdentityKey: `tax:${nit(1)}`,
      legalName: 'EMPRESA SINTETICA 1, SOCIEDAD ANONIMA',
      normalizedLegalName: 'EMPRESA SINTETICA 1',
      taxId: nit(1),
      taxIdentifierType: 'NIT',
      countryCode: 'GT',
      city: 'GUATEMALA',
      region: 'GUATEMALA',
      domain: 'sintetica1.com.gt',
      declaredIndustry: 'Informática y telecomunicaciones',
      industryCode: '4321',
      coarseSector: null,
      officialMacroIndustry: { macroIndustryKeys: ['technology'], tableVersion: 'gt-unspsc-guatecompras-macro-v1' },
    });
  });

  it('re-clasifica con la tabla de HOY y vuelve a comprobar la relevancia', async () => {
    const { reads } = fakeReads([
      row(1, { unspsc_family: '4218' }),
      row(2, { sat_iva_agent: false, awarded_gtq: 100_000 }),
      row(3, { sat_iva_agent: false, awarded_gtq: 6_000_000 }),
    ]);
    const result = await buildGtGuatecomprasDirectoryDiscoveryAdapter(reads)({ countryCode: 'GT', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.taxId), [nit(3)]);
  });

  it('descarta NIT con dígito verificador inválido, sin nombre, dominio mal formado y duplicados', async () => {
    const bad = nit(4).slice(0, -1) + (nit(4).endsWith('1') ? '2' : '1');
    const { reads } = fakeReads([
      row(4, { nit: bad }),
      row(5, { legal_name: '  ' }),
      row(6, { website_domain: 'no es un dominio' }),
      row(6),
    ]);
    const result = await buildGtGuatecomprasDirectoryDiscoveryAdapter(reads)({ countryCode: 'GT', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => [c.taxId, c.domain]), [[nit(6), null]]);
  });

  it('respeta el límite (techo 200), no consulta con límite 0 ni con una macro sin cobertura', async () => {
    const big = fakeReads([]);
    await buildGtGuatecomprasDirectoryDiscoveryAdapter(big.reads)({ countryCode: 'GT', macroIndustryKey: 'technology', limit: 999 });
    assert.equal(big.calls[0].limit, GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_MAX_ROWS);
    const idle = fakeReads([row(1)]);
    const zero = await buildGtGuatecomprasDirectoryDiscoveryAdapter(idle.reads)({ countryCode: 'GT', macroIndustryKey: 'technology', limit: 0 });
    const gov = await buildGtGuatecomprasDirectoryDiscoveryAdapter(idle.reads)({ countryCode: 'GT', macroIndustryKey: 'government', limit: 5 });
    assert.equal(zero.companies.length + gov.companies.length, 0);
    assert.equal(idle.calls.length, 0);
  });
});

describe('lectura de producción (buildGtGuatecomprasDirectoryDiscoveryReads)', () => {
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

  it('lee sólo gt_guatecompras_directory / GT de la macro pedida, por relevancia y NIT, con tope', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          record_identity_key: `tax:${nit(1)}`,
          normalized_tax_id: nit(1),
          legal_name: 'EMPRESA A, S.A.',
          normalized_legal_name: 'EMPRESA A',
          city: 'MIXCO',
          region: 'GUATEMALA',
          priority_score: '1006017',
          raw_data: { unspsc_family: '4321', activity_text: 'Computadoras', website_domain: 'empresa-a.com.gt', sat_iva_agent: true, awarded_gtq: 7_000_000 },
        },
        {
          record_identity_key: `tax:${nit(2)}`,
          normalized_tax_id: nit(2),
          legal_name: 'EMPRESA B, S.A.',
          normalized_legal_name: 'EMPRESA B',
          city: null,
          region: null,
          priority_score: null,
          raw_data: { unspsc_family: 4321, activity_text: '', website_domain: null, sat_iva_agent: 'true' },
        },
      ],
    });
    const rows = await buildGtGuatecomprasDirectoryDiscoveryReads(client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 50 });
    assert.deepEqual(rows[0], {
      record_identity_key: `tax:${nit(1)}`,
      nit: nit(1),
      legal_name: 'EMPRESA A, S.A.',
      normalized_legal_name: 'EMPRESA A',
      city: 'MIXCO',
      region: 'GUATEMALA',
      unspsc_family: '4321',
      activity_text: 'Computadoras',
      website_domain: 'empresa-a.com.gt',
      sat_iva_agent: true,
      awarded_gtq: 7_000_000,
      priority_score: 1_006_017,
    });
    // Sólo `true` literal cuenta como agente del IVA.
    assert.equal(rows[1].sat_iva_agent, false);
    assert.equal(rows[1].unspsc_family, null);
    assert.equal(rows[1].awarded_gtq, null);
    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['source_key', 'gt_guatecompras_directory'],
      ['country_code', 'GT'],
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
    assert.deepEqual(await buildGtGuatecomprasDirectoryDiscoveryReads(idle.client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 0 }), []);
    assert.equal(idle.calls.length, 0);
    for (const failing of [{ error: { message: 'boom' } }, { throws: true }]) {
      assert.deepEqual(
        await buildGtGuatecomprasDirectoryDiscoveryReads(fakeClient(failing).client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 5 }),
        [],
      );
    }
  });
});

describe('puerta previa al pago con Guatemala', () => {
  function gate(rows: GtGuatecomprasDirectorySnapshotReadRow[], macroIndustryKey = 'technology') {
    return runPrePaidNoveltyGate(
      { provider: 'apollo', countryCode: 'GT', macroIndustryKey, requestedTarget: 2 },
      {
        countrySourceAdapter: buildGtGuatecomprasDirectoryDiscoveryAdapter(fakeReads(rows).reads),
        checkCompanyDuplicate: async (input) => noMatch(input),
        listKnownExclusionDomains: async () => [],
      },
    );
  }

  it('dos proveedoras nuevas con web cierran el objetivo sin pagar', async () => {
    const result = await gate([row(1), row(2)]);
    assert.equal(result.context.residualGap, 0);
    assert.equal(result.context.providerRequired, false);
    assert.equal(result.acceptedCompanies.length, 2);
  });

  it('sin web no cuentan para la meta: van a Descartadas para que el rescate busque su sitio', async () => {
    const { reads } = fakeReads([row(1), row(2, { website_domain: null })]);
    const result = await buildGtGuatecomprasDirectoryDiscoveryAdapter(reads)({ countryCode: 'GT', macroIndustryKey: 'technology', limit: 10 });
    const { withDomain, withoutDomain } = partitionFreeCompaniesByDomain(result.companies);
    assert.deepEqual(withDomain.map((c) => c.taxId), [nit(1)]);
    const dispositions = buildUnverifiedFreeDispositionRows({ batchId: 'b', countryCode: 'GT', companies: withoutDomain });
    assert.equal(dispositions.length, 1);
    assert.equal(dispositions[0].reasonCode, FREE_SOURCE_MISSING_DOMAIN_REASON_CODE);
  });

  it('una macro sin cobertura ni siquiera consulta', async () => {
    const result = await gate([row(1)], 'government');
    assert.equal(result.context.freeSource.attempted, false);
    assert.equal(result.context.residualGap, 2);
  });
});

describe('guardas estáticas', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));
  const DIR = 'src/server/prospect-batches/country-source-discovery';

  it('la lectura no escribe, no construye cliente y no lee env', () => {
    const code = read(`${DIR}/gt-guatecompras-directory-snapshot-query.ts`);
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete|rpc)\s*\(/);
    assert.doesNotMatch(code, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(/);
  });

  it('el adapter, la tabla y las filas son puros', () => {
    for (const file of [
      `${DIR}/gt-guatecompras-directory-discovery-adapter.ts`,
      `${DIR}/gt-guatecompras-macro-table.ts`,
      'src/server/source-catalog/connectors/gt-guatecompras/gt-sources-rows.ts',
      'src/server/source-catalog/connectors/gt-guatecompras/gt-name-keys.ts',
      'src/server/source-catalog/connectors/gt-guatecompras/gt-domain.ts',
      'src/server/source-catalog/connectors/gt-guatecompras/gt-nit.ts',
    ]) {
      assert.doesNotMatch(read(file), /supabase|process\.env|\bfetch\s*\(|\.from\(\s*['"]/i, file);
    }
  });

  it('el cableado de producción inyecta la lectura de Guatemala', () => {
    assert.match(
      read(`${DIR}/prepaid-novelty-gate.server.ts`),
      /gtGuatecomprasDirectoryDiscoveryReads:\s*buildGtGuatecomprasDirectoryDiscoveryReads\(adminClient\)/,
    );
  });
});
