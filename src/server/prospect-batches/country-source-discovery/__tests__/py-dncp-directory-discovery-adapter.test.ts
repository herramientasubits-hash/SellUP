/**
 * SOURCES-PY-CLOSE-1 — descubrimiento gratuito de Paraguay (proveedores del
 * Estado de la DNCP).
 *
 * Tabla UNSPSC, fila de la carga, adapter, lectura con un cliente doble que
 * registra cada llamada (cualquier escritura revienta la prueba) y puerta previa
 * al pago REAL. Cero E/S. Nombres sintéticos salvo donde se indica.
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
  buildPyDncpDirectoryDiscoveryAdapter,
  PY_DNCP_DIRECTORY_DISCOVERY_MAX_ROWS,
  PY_DNCP_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type PyDncpDirectoryDiscoveryReads,
  type PyDncpDirectorySnapshotReadRow,
} from '../py-dncp-directory-discovery-adapter';
import { buildPyDncpDirectoryDiscoveryReads } from '../py-dncp-directory-snapshot-query';
import {
  macroHasPyDncpCoverage,
  PY_DNCP_MACRO_TABLE_VERSION,
  resolvePyDncpSupplierMacro,
  resolvePyUnspscMacro,
} from '../py-dncp-macro-table';
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
import {
  buildPyDncpDirectoryRow,
  parsePyDncpAwardSummary,
  parsePyDncpSupplierProfile,
  pyDncpDeclaredMipymeSize,
  pyDncpPriorityScore,
  pyDncpProfileRuc,
  type PyDncpAwardSummary,
} from '@/server/source-catalog/connectors/set-paraguay/py-dncp-directory-row';

const ruc = (n: number): string => `8090${String(n).padStart(4, '0')}-${n % 10}`;

function row(n: number, overrides: Partial<PyDncpDirectorySnapshotReadRow> = {}): PyDncpDirectorySnapshotReadRow {
  return {
    record_identity_key: `tax:${ruc(n)}`,
    ruc: ruc(n),
    legal_name: `EMPRESA SINTETICA ${n} S.A.`,
    normalized_legal_name: `EMPRESA SINTETICA ${n}`,
    city: 'Asunción',
    region: 'Central',
    unspsc_family: '4321',
    activity_text: 'Computadoras',
    website_domain: `sintetica${n}.com.py`,
    declared_size: 'SIN CATEGORIZAR',
    priority_score: 9000 - n,
    ...overrides,
  };
}

function fakeReads(rows: PyDncpDirectorySnapshotReadRow[]) {
  const calls: Array<{ macroIndustryKey: string; limit: number }> = [];
  const reads: PyDncpDirectoryDiscoveryReads = {
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

describe('tabla UNSPSC de la DNCP → macro', () => {
  it('segmentos de bienes y servicios', () => {
    assert.equal(resolvePyUnspscMacro('43211503'), 'technology');
    assert.equal(resolvePyUnspscMacro('42181801'), 'health_pharma');
    assert.equal(resolvePyUnspscMacro('51181699'), 'health_pharma');
    assert.equal(resolvePyUnspscMacro('72131601'), 'property_construction');
    assert.equal(resolvePyUnspscMacro('15101505'), 'energy_mining_environment');
    assert.equal(resolvePyUnspscMacro('78101802'), 'transport_logistics');
    assert.equal(resolvePyUnspscMacro('84131501'), 'insurance_financial_services');
    assert.equal(resolvePyUnspscMacro('50192100'), 'consumer_goods');
  });

  it('la familia manda: servicios informáticos y telecomunicaciones a Tecnología', () => {
    assert.equal(resolvePyUnspscMacro('81111504'), 'technology');
    assert.equal(resolvePyUnspscMacro('83111603'), 'technology');
    assert.equal(resolvePyUnspscMacro('81101508'), 'services_company');
    assert.equal(resolvePyUnspscMacro('83101801'), 'energy_mining_environment');
  });

  it('viajes, comida, educación y servicios comunitarios no tienen macro', () => {
    for (const code of ['90101501', '86101705', '93141701', '55101501']) {
      assert.equal(resolvePyUnspscMacro(code), null, code);
    }
    for (const raw of ['', 'x4321', null, undefined]) assert.equal(resolvePyUnspscMacro(raw), null, String(raw));
  });

  it('la macro de la empresa es la dominante por monto, sólo si pesa la mitad o más', () => {
    assert.deepEqual(resolvePyDncpSupplierMacro({ '4321': 700, '8111': 200, '4410': 100 }), {
      macroIndustryKey: 'technology',
      share: 0.9,
    });
    assert.equal(resolvePyDncpSupplierMacro({ '4321': 40, '4218': 30, '7213': 30 }), null);
    assert.equal(resolvePyDncpSupplierMacro({ '9010': 900, '4321': 100 }), null);
    assert.equal(resolvePyDncpSupplierMacro({}), null);
  });

  it('cobertura por macro (Gobierno no se ofrece desde los proveedores)', () => {
    assert.equal(macroHasPyDncpCoverage('technology'), true);
    assert.equal(macroHasPyDncpCoverage('government'), false);
    assert.equal(macroHasPyDncpCoverage(null), false);
  });
});

describe('fila de la carga (py_dncp_directory)', () => {
  const summary = (overrides: Partial<PyDncpAwardSummary> = {}): PyDncpAwardSummary => ({
    ruc: '80027374-5',
    amountByFamily: { '4321': 900, '8111': 300, '4410': 50 },
    awards: 17,
    buyers: 6,
    lastAwardYear: 2026,
    activityText: 'Computadoras',
    ...overrides,
  });
  // Ficha real de la API pública de la DNCP (KONECTA SA), recortada.
  const KONECTA = {
    identifier: { id: '80027374-5', legalName: 'KONECTA SA ', scheme: 'PY-RUC' },
    contactPoint: { email: 'contacto@konecta.com.py', url: 'www.konecta.com.py' },
    details: { legalEntityTypeDetail: 'S.A.', size: 'Sin categorizar' },
    address: { locality: 'Asuncion', region: 'Central' },
  };

  it('lee la ficha de la API y el resumen de adjudicaciones', () => {
    assert.equal(pyDncpProfileRuc(KONECTA), '80027374-5');
    assert.equal(pyDncpProfileRuc({ id: 'PY-RUC-80027374-5' }), '80027374-5');
    assert.equal(pyDncpProfileRuc({ identifier: { id: 'DNCP-002240' } }), null);
    assert.deepEqual(parsePyDncpSupplierProfile(KONECTA), {
      legalEntityType: 'S.A.',
      size: 'Sin categorizar',
      url: 'www.konecta.com.py',
      email: 'contacto@konecta.com.py',
      locality: 'Asuncion',
      region: 'Central',
    });
    assert.equal(parsePyDncpSupplierProfile({ address: { locality: '11003' } })?.locality, null);
    assert.deepEqual(
      parsePyDncpAwardSummary({ ruc: '80027374-5', awards: 3, buyers: 2, last_year: 2026, fam: { '4321': 10, x: 5, '8111': -1 }, activity: 'Notebook' }),
      { ruc: '80027374-5', amountByFamily: { '4321': 10 }, awards: 3, buyers: 2, lastAwardYear: 2026, activityText: 'Notebook' },
    );
    assert.equal(pyDncpDeclaredMipymeSize({ ...parsePyDncpSupplierProfile(KONECTA)!, size: 'Pequeña' }), 'PEQUEÑA');
    assert.equal(pyDncpDeclaredMipymeSize(parsePyDncpSupplierProfile(KONECTA)), null);
  });

  it('una sociedad activa con macro dominante → fila con RUC, razón social del padrón, web y relevancia', () => {
    const built = buildPyDncpDirectoryRow({
      summary: summary(),
      profile: parsePyDncpSupplierProfile(KONECTA),
      registryLegalName: 'KONECTA SA',
      sourceYear: 2026,
      importedAt: '2026-10-06T00:00:00.000Z',
    });
    assert.ok('row' in built);
    const r = built.row;
    assert.equal(r.source_key, 'py_dncp_directory');
    assert.equal(r.tax_id, '80027374-5');
    assert.equal(r.legal_name, 'KONECTA SA');
    assert.equal(r.normalized_legal_name, 'KONECTA');
    assert.equal(r.record_identity_key, 'tax:80027374-5');
    assert.equal(r.priority_score, pyDncpPriorityScore({ awards: 17, buyers: 6 }));
    assert.equal(r.raw_data['macro_industry_key'], 'technology');
    assert.equal(r.raw_data['macro_table_version'], PY_DNCP_MACRO_TABLE_VERSION);
    assert.equal(r.raw_data['unspsc_family'], '4321');
    assert.equal(r.raw_data['website_domain'], 'konecta.com.py');
    assert.equal(r.raw_data['website_origin'], 'url');
  });

  it('fuera: no activa, consorcio, persona física, micro/pequeña/mediana, sin macro dominante, RUC no societario', () => {
    const base = { sourceYear: 2026, importedAt: 'x' };
    const profile = parsePyDncpSupplierProfile(KONECTA)!;
    const build = (o: Partial<Parameters<typeof buildPyDncpDirectoryRow>[0]>) =>
      buildPyDncpDirectoryRow({ summary: summary(), profile, registryLegalName: 'KONECTA SA', ...base, ...o });
    assert.deepEqual(build({ registryLegalName: null }), { excluded: 'not_active_in_registry' });
    assert.deepEqual(build({ registryLegalName: 'CONSORCIO ELECTRICO CHAQUEÑO' }), { excluded: 'consortium_or_person' });
    assert.deepEqual(build({ profile: { ...profile, legalEntityType: 'Consorcio' } }), { excluded: 'consortium_or_person' });
    assert.deepEqual(build({ profile: { ...profile, legalEntityType: 'Persona Física - Bienes y Servicios' } }), {
      excluded: 'consortium_or_person',
    });
    for (const size of ['Micro', 'Pequeña', 'Mediana']) {
      assert.deepEqual(build({ profile: { ...profile, size } }), { excluded: 'declared_small' }, size);
    }
    assert.deepEqual(build({ summary: summary({ amountByFamily: { '4321': 1, '7213': 1, '4218': 1 } }) }), {
      excluded: 'no_dominant_macro',
    });
    assert.deepEqual(build({ summary: summary({ ruc: '1684979-5' }) }), { excluded: 'invalid_ruc' });
  });

  it('sin ficha de la API entra igual (sin web ni tamaño declarado)', () => {
    const built = buildPyDncpDirectoryRow({ summary: summary(), profile: null, registryLegalName: 'KONECTA SA', sourceYear: 2026, importedAt: 'x' });
    assert.ok('row' in built);
    assert.equal(built.row.raw_data['website_domain'], undefined);
  });

  it('la relevancia ordena por entidades compradoras y luego por adjudicaciones', () => {
    assert.ok(pyDncpPriorityScore({ buyers: 3, awards: 1 }) > pyDncpPriorityScore({ buyers: 2, awards: 900 }));
  });
});

describe('capacidad por país', () => {
  it('Paraguay tiene fuente gratuita propia y los demás conservan la suya', () => {
    assert.ok(COUNTRY_SOURCE_DISCOVERY_COUNTRIES.includes('PY'));
    assert.deepEqual(resolveCountrySourceCapability('py'), {
      countryCode: 'PY',
      sourceKey: 'py_dncp_directory_discovery',
    });
    assert.equal(resolveCountrySourceCapability('PE')?.sourceKey, 'pe_sunat_directory_discovery');
    assert.equal(resolveCountrySourceCapability('UY'), null);
  });

  it('la cobertura de Paraguay sale de SU tabla', () => {
    assert.equal(countrySourceMacroHasCoverage('PY', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('PY', 'government'), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open al pago)', () => {
    assert.equal(buildCountrySourceAdapter('PY', {}), null);
    assert.equal(buildCountrySourceAdapter('PY', { peSunatDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } }), null);
    assert.ok(buildCountrySourceAdapter('PY', { pyDncpDirectoryDiscoveryReads: fakeReads([]).reads }));
  });
});

describe('buildPyDncpDirectoryDiscoveryAdapter', () => {
  it('ofrece las filas en el orden de la lectura, con RUC, web, actividad y macro de la tabla', async () => {
    const { reads, calls } = fakeReads([row(1), row(2, { website_domain: null })]);
    const result = await buildPyDncpDirectoryDiscoveryAdapter(reads)({ countryCode: 'PY', macroIndustryKey: 'technology', limit: 10 });
    assert.equal(result.sourceKey, PY_DNCP_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.recordsRead, 2);
    assert.deepEqual(calls, [{ macroIndustryKey: 'technology', limit: 10 }]);
    assert.deepEqual(result.companies.map((c) => [c.taxId, c.domain]), [
      [ruc(1), 'sintetica1.com.py'],
      [ruc(2), null],
    ]);
    const [first] = result.companies;
    assert.equal(first.countryCode, 'PY');
    assert.equal(first.taxIdentifierType, 'RUC');
    assert.equal(first.industryCode, '4321');
    assert.equal(first.declaredIndustry, 'Computadoras');
    assert.deepEqual(first.officialMacroIndustry, { macroIndustryKeys: ['technology'], tableVersion: PY_DNCP_MACRO_TABLE_VERSION });
  });

  it('re-clasifica con la tabla de HOY y vuelve a comprobar el tamaño declarado', async () => {
    const { reads } = fakeReads([
      row(1),
      row(2, { unspsc_family: '7213' }), // construcción
      row(3, { unspsc_family: '9010' }), // sin macro
      row(4, { declared_size: 'Mediana' }),
      row(5, { declared_size: 'MICRO' }),
    ]);
    const result = await buildPyDncpDirectoryDiscoveryAdapter(reads)({ countryCode: 'PY', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.taxId), [ruc(1)]);
  });

  it('descarta RUC de persona física o mal formado, sin nombre, dominio mal formado y duplicados', async () => {
    const { reads } = fakeReads([
      row(1),
      row(1),
      row(2, { ruc: '1684979-5' }),
      row(3, { ruc: null }),
      row(4, { legal_name: ' ' }),
      row(5, { website_domain: 'no es dominio' }),
    ]);
    const result = await buildPyDncpDirectoryDiscoveryAdapter(reads)({ countryCode: 'PY', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => [c.taxId, c.domain]), [
      [ruc(1), 'sintetica1.com.py'],
      [ruc(5), null],
    ]);
  });

  it('respeta el límite (techo 200), no consulta con límite 0 ni con una macro sin cobertura', async () => {
    const { reads, calls } = fakeReads([]);
    const adapter = buildPyDncpDirectoryDiscoveryAdapter(reads);
    await adapter({ countryCode: 'PY', macroIndustryKey: 'technology', limit: 5000 });
    assert.equal(calls[0].limit, PY_DNCP_DIRECTORY_DISCOVERY_MAX_ROWS);
    assert.equal(PY_DNCP_DIRECTORY_DISCOVERY_MAX_ROWS, 200);
    await adapter({ countryCode: 'PY', macroIndustryKey: 'technology', limit: 0 });
    await adapter({ countryCode: 'PY', macroIndustryKey: 'government', limit: 5 });
    assert.equal(calls.length, 1);
  });
});

describe('lectura de producción (buildPyDncpDirectoryDiscoveryReads)', () => {
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

  it('lee sólo py_dncp_directory / PY de la macro pedida, por relevancia y RUC, con tope', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          record_identity_key: `tax:${ruc(1)}`,
          normalized_tax_id: ruc(1),
          legal_name: 'EMPRESA A S.A.',
          normalized_legal_name: 'EMPRESA A',
          city: 'Asunción',
          region: 'Central',
          priority_score: '6017',
          raw_data: { unspsc_family: '4321', activity_text: 'Computadoras', website_domain: 'empresa-a.com.py', declared_size: 'SIN CATEGORIZAR' },
        },
        {
          record_identity_key: `tax:${ruc(2)}`,
          normalized_tax_id: ruc(2),
          legal_name: 'EMPRESA B S.A.',
          normalized_legal_name: 'EMPRESA B',
          city: null,
          region: null,
          priority_score: null,
          raw_data: { unspsc_family: 4321, activity_text: '', website_domain: null },
        },
      ],
    });
    const rows = await buildPyDncpDirectoryDiscoveryReads(client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 50 });
    assert.deepEqual(rows[0], {
      record_identity_key: `tax:${ruc(1)}`,
      ruc: ruc(1),
      legal_name: 'EMPRESA A S.A.',
      normalized_legal_name: 'EMPRESA A',
      city: 'Asunción',
      region: 'Central',
      unspsc_family: '4321',
      activity_text: 'Computadoras',
      website_domain: 'empresa-a.com.py',
      declared_size: 'SIN CATEGORIZAR',
      priority_score: 6017,
    });
    assert.equal(rows[1].unspsc_family, null);
    assert.equal(rows[1].activity_text, null);
    assert.equal(rows[1].priority_score, null);
    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['source_key', 'py_dncp_directory'],
      ['country_code', 'PY'],
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
    assert.deepEqual(await buildPyDncpDirectoryDiscoveryReads(idle.client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 0 }), []);
    assert.equal(idle.calls.length, 0);
    for (const failing of [{ error: { message: 'boom' } }, { throws: true }]) {
      assert.deepEqual(
        await buildPyDncpDirectoryDiscoveryReads(fakeClient(failing).client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 5 }),
        [],
      );
    }
  });
});

describe('puerta previa al pago con Paraguay', () => {
  function gate(rows: PyDncpDirectorySnapshotReadRow[], macroIndustryKey = 'technology') {
    return runPrePaidNoveltyGate(
      { provider: 'apollo', countryCode: 'PY', macroIndustryKey, requestedTarget: 2 },
      {
        countrySourceAdapter: buildPyDncpDirectoryDiscoveryAdapter(fakeReads(rows).reads),
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
    const result = await buildPyDncpDirectoryDiscoveryAdapter(reads)({ countryCode: 'PY', macroIndustryKey: 'technology', limit: 10 });
    const { withDomain, withoutDomain } = partitionFreeCompaniesByDomain(result.companies);
    assert.deepEqual(withDomain.map((c) => c.taxId), [ruc(1)]);
    const dispositions = buildUnverifiedFreeDispositionRows({ batchId: 'b', countryCode: 'PY', companies: withoutDomain });
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
    const code = read(`${DIR}/py-dncp-directory-snapshot-query.ts`);
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete|rpc)\s*\(/);
    assert.doesNotMatch(code, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(/);
  });

  it('el adapter, la tabla y la fila son puros', () => {
    for (const file of [
      `${DIR}/py-dncp-directory-discovery-adapter.ts`,
      `${DIR}/py-dncp-macro-table.ts`,
      'src/server/source-catalog/connectors/set-paraguay/py-dncp-directory-row.ts',
    ]) {
      assert.doesNotMatch(read(file), /supabase|process\.env|\bfetch\s*\(|\.from\(\s*['"]/i, file);
    }
  });

  it('el cableado de producción inyecta la lectura de Paraguay', () => {
    assert.match(
      read(`${DIR}/prepaid-novelty-gate.server.ts`),
      /pyDncpDirectoryDiscoveryReads:\s*buildPyDncpDirectoryDiscoveryReads\(adminClient\)/,
    );
  });
});
