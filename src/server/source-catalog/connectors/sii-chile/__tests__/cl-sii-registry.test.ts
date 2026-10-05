/**
 * SOURCES-CL-SII-REGISTRY-1 — Chile: personas jurídicas del SII (RUT por nombre +
 * trabajadores informados). Líneas con la forma real de los archivos del SII
 * (02-10). Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildClSiiRegistryRow,
  canonicalizeChilePublicEntityCore,
  normalizeChileSiiCore,
  CL_SII_EXCLUDED_SUBTYPES,
  parseClSiiActivityLine,
  parseClSiiCompanyLine,
  parseClSiiNamesLine,
} from '../cl-sii-registry-rows';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import {
  buildOfficialSourceEnrichmentMetadata,
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import { buildSnapshotNameQuery, workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import { normalizeChileCompanyCore } from '@/server/source-catalog/connectors/res-chile/cl-res-registry-row';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const params = { sourceYear: 2024, importedAt: '2026-10-02T00:00:00.000Z' };
const nameLine = (rut: string, dv: string, subtype: string, name: string, end = '') =>
  [rut, dv, subtype, name, '01-01-1993', end].join('\t');
const companyLine = (rut: string, dv: string, bracket: string, workers: string, activity: string) =>
  ['2024', rut, dv, 'X', bracket, workers, '1993-01-01', '', '1993-01-01', '', 'PERSONA JURIDICA COMERCIAL', 'X', '', '', 'R', 'S', activity, 'XIII', 'Santiago', 'LAS CONDES', '', ''].join('\t');

describe('lectura de los archivos del SII', () => {
  it('nómina de nombres: RUT con DV válido, subtipo, razón social y término de giro', () => {
    assert.deepEqual(parseClSiiNamesLine(nameLine('96505760', '9', '213', 'ENTEL PCS TELECOMUNICACIONES S.A.')), {
      rut: '96505760-9',
      subtype: '213',
      legalName: 'ENTEL PCS TELECOMUNICACIONES S.A.',
      terminated: false,
    });
    assert.equal(parseClSiiNamesLine(nameLine('96505760', '9', '213', 'X', '31-12-2020'))?.terminated, true);
    assert.equal(parseClSiiNamesLine(nameLine('96505760', '1', '213', 'DV INVALIDO')), null);
    assert.equal(parseClSiiNamesLine('RUT\tDV\tCOD_SUBTIPO\tRAZON_SOCIAL\tFECHA_INICIO_VIG\tFECHA_TG_VIG'), null);
  });

  it('empresas del año: tramo, trabajadores y actividad', () => {
    assert.deepEqual(parseClSiiCompanyLine(companyLine('96505760', '9', '13', '3500', 'TELECOMUNICACIONES MOVILES')), [
      '96505760-9',
      { year: 2024, salesBracket: '13', workers: 3500, activity: 'TELECOMUNICACIONES MOVILES' },
    ]);
    assert.equal(parseClSiiCompanyLine(companyLine('96505760', '9', '', '', ''))?.[1].workers, null);
  });

  it('actividades: código de 6 dígitos', () => {
    assert.deepEqual(parseClSiiActivityLine('96505760\t9\t612010\tTELEFONIA MOVIL\t01-01-1993\tS\t1'), ['96505760-9', '612010']);
    assert.equal(parseClSiiActivityLine('96505760\t9\tXX\tY'), null);
  });
});

describe('qué entra en cl_sii_registry', () => {
  it('fila mínima con métricas y código de actividad', () => {
    const row = buildClSiiRegistryRow(
      parseClSiiNamesLine(nameLine('96505760', '9', '213', 'ENTEL PCS TELECOMUNICACIONES S.A.'))!,
      { year: 2024, salesBracket: '13', workers: 3500, activity: 'TELECOMUNICACIONES MOVILES' },
      '612010',
      params,
    );
    assert.equal(row?.normalized_tax_id, '96505760-9');
    assert.equal(row?.normalized_legal_name, 'ENTEL PCS TELECOMUNICACIONES');
    assert.equal(row?.record_identity_key, 'tax:96505760-9');
    assert.deepEqual(row?.raw_data, {
      subtype: '213',
      metrics_year: 2024,
      workers: 3500,
      sales_bracket: '13',
      activity: 'TELECOMUNICACIONES MOVILES',
      activity_code: '612010',
    });
  });

  it('sin métricas: sólo el subtipo (raw_data mínimo)', () => {
    const row = buildClSiiRegistryRow(parseClSiiNamesLine(nameLine('76086428', '5', '223', 'ALFA SPA'))!, null, null, params);
    assert.deepEqual(row?.raw_data, { subtype: '223' });
  });

  it('fuera: término de giro, EIRL, sin personalidad jurídica, juntas de vecinos, clubes, sindicatos', () => {
    const record = parseClSiiNamesLine(nameLine('76086428', '5', '223', 'ALFA SPA'))!;
    assert.equal(buildClSiiRegistryRow({ ...record, terminated: true }, null, null, params), null);
    for (const subtype of ['212', '311', '312', '313', '811', '812', '816']) {
      assert.equal(CL_SII_EXCLUDED_SUBTYPES.has(subtype), true, subtype);
      assert.equal(buildClSiiRegistryRow({ ...record, subtype }, null, null, params), null, subtype);
    }
  });

  it('universidades, organismos públicos, municipalidades y fundaciones SÍ entran (clientes UBITS)', () => {
    const record = parseClSiiNamesLine(nameLine('76086428', '5', '223', 'ALFA SPA'))!;
    for (const subtype of ['516', '511', '611', '813', '214', '411']) {
      assert.notEqual(buildClSiiRegistryRow({ ...record, subtype }, null, null, params), null, subtype);
    }
  });

  it('grano fiscal: un RUT, una fila', () => {
    assert.equal(getSourceFamily('cl_sii_registry'), 'TAX_GRAIN');
  });
});

describe('trabajadores en la corrida (sólo con RUT fuerte)', () => {
  const candidate = (canonicalName: string) =>
    ({
      sourceProvider: 'apollo', providerRecordId: 'r', providerRequestId: 'q', canonicalName,
      normalizedName: canonicalName.toLowerCase(), commercialName: canonicalName, legalName: null,
      websiteUrl: null, domain: null, corporateLinkedinUrl: null, country: 'Chile', countryCode: 'CL',
      requestedCountryCode: 'CL', region: null, city: null, industry: null, subindustry: null, industryCodes: {},
      employeeCount: null, employeeRange: null, sourceUrl: null, sourceConfidence: null, searchCriteria: {},
      warnings: [], issues: [], providerMetadataSafe: {},
      trace: { sourceProvider: 'apollo', providerRecordId: 'r', providerRequestId: 'q', sourceUrl: null },
    }) as NormalizedProspectCandidate;

  /** Cliente falso de lectura que responde filas como las de source_company_snapshots. */
  const fakeClient = (rows: Record<string, unknown>[]) => {
    const selects: string[] = [];
    const chain: Record<string, unknown> = {};
    chain.select = (columns: string) => { selects.push(columns); return chain; };
    chain.eq = () => chain;
    chain.limit = async () => ({ data: rows, error: null });
    return { client: { from: () => chain } as never, selects };
  };

  const resolverWith = (rows: Record<string, unknown>[]) => {
    const fake = fakeClient(rows);
    return {
      selects: fake.selects,
      resolver: createSnapshotNameOfficialSourceResolver({
        countryCode: 'CL',
        sourceKey: 'cl_sii_registry',
        taxIdentifierType: 'RUT',
        validTaxId: /^\d{7,8}-[\dK]$/,
        normalizeCore: normalizeChileCompanyCore,
        querySnapshots: buildSnapshotNameQuery(fake.client, 'cl_sii_registry', 'CL', { withWorkforce: true }),
      }),
    };
  };

  const entel = {
    normalized_tax_id: '96505760-9',
    legal_name: 'ENTEL PCS TELECOMUNICACIONES S.A.',
    normalized_legal_name: 'ENTEL PCS TELECOMUNICACIONES',
    raw_data: { subtype: '213', metrics_year: 2024, workers: 3500, sales_bracket: '13' },
  };

  it('RUT fuerte → el resultado y la metadata guardada llevan los trabajadores con su año y fuente', async () => {
    const { resolver, selects } = resolverWith([entel]);
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Entel PCS Telecomunicaciones S.A.'),
      { country: 'Chile', countryCode: 'CL' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, '96505760-9');
    assert.match(selects[0], /raw_data/);
    assert.deepEqual(buildOfficialSourceEnrichmentMetadata(enriched).workforce, {
      workers: 3500,
      year: 2024,
      source: 'cl_sii_registry',
      salesBracket: '13',
    });
  });

  it('homónimos (sólo señal) → sin trabajadores; y la metadata no gana la clave', async () => {
    const { resolver } = resolverWith([entel, { ...entel, normalized_tax_id: '76086428-5' }]);
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Entel PCS Telecomunicaciones S.A.'),
      { country: 'Chile', countryCode: 'CL' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.equal('workforce' in buildOfficialSourceEnrichmentMetadata(enriched), false);
  });

  it('sin métricas en raw_data → match fuerte sin trabajadores', async () => {
    const { resolver } = resolverWith([{ ...entel, raw_data: { subtype: '213' } }]);
    const out = await resolver.resolve({
      candidate: candidate('Entel PCS Telecomunicaciones S.A.'),
      criteria: { countryCode: 'CL' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    });
    assert.equal(out.status, 'matched');
    assert.equal(out.workforce, undefined);
  });

  it('un «matched» por debajo del umbral fuerte NO proyecta trabajadores', async () => {
    const weak = {
      countryCode: 'CL',
      sourceKey: 'cl_sii_registry',
      async resolve() {
        return {
          status: 'matched' as const, countryCode: 'CL', sourceKey: 'cl_sii_registry', confidence: 0.7,
          matchMethod: 'normalized_name' as const, taxIdentifier: '96505760-9', taxIdentifierType: 'RUT',
          warnings: [], issues: [], workforce: { workers: 3500, year: 2024, source: 'cl_sii_registry' },
        };
      },
    };
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Entel PCS Telecomunicaciones S.A.'),
      { country: 'Chile', countryCode: 'CL' },
      [weak as never],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, false);
    assert.equal('workforce' in buildOfficialSourceEnrichmentMetadata(enriched), false);
  });

  it('sin la opción, aunque la fila traiga raw_data con trabajadores, la consulta no los devuelve', async () => {
    const fake = fakeClient([entel]);
    const rows = await buildSnapshotNameQuery(fake.client, 'cl_sii_registry', 'CL')('ENTEL PCS TELECOMUNICACIONES');
    assert.equal(rows[0].workforce, undefined);
  });

  it('workforceFromRawData exige número entero y año', () => {
    assert.equal(workforceFromRawData({ workers: '10', metrics_year: 2024 }, 's'), null);
    assert.equal(workforceFromRawData({ workers: 10 }, 's'), null);
    assert.equal(workforceFromRawData({ workers: -1, metrics_year: 2024 }, 's'), null);
    assert.equal(workforceFromRawData(null, 's'), null);
    assert.deepEqual(workforceFromRawData({ workers: 0, metrics_year: 2024 }, 's'), { workers: 0, year: 2024, source: 's', salesBracket: null });
  });

  it('las demás fuentes no piden raw_data (la consulta no cambia)', () => {
    const fake = fakeClient([]);
    void buildSnapshotNameQuery(fake.client, 'pe_sunat_registry', 'PE')('X');
    assert.equal(fake.selects[0], 'normalized_tax_id, legal_name, normalized_legal_name');
  });

  it('cableado: Chile = SII primero y, si no hay RUT fuerte, el RES', () => {
    const wiring = readFileSync(join(process.cwd(), 'src/server/prospect-batches/official-source-resolvers.ts'), 'utf8');
    const i = wiring.indexOf('sourceKey: CL_SII_REGISTRY_SOURCE_KEY');
    const j = wiring.indexOf("sourceKey: 'cl_res_registry'");
    assert.ok(i > 0 && j > i);
    assert.match(wiring.slice(i - 400, i), /createFallbackOfficialSourceResolver\(/);
    assert.match(wiring.slice(i, j), /withWorkforce: true/);
  });
});

describe('organismos públicos con la forma del SII (SOURCES-CL-PUBLIC-ENTITY-ALIASES-1)', () => {
  it('municipalidades: sin «I» ni «ILUSTRE» delante, en los dos lados', () => {
    assert.equal(normalizeChileSiiCore('I MUNICIPALIDAD DE CURICO'), 'MUNICIPALIDAD DE CURICO');
    assert.equal(normalizeChileSiiCore('ILUSTRE MUNICIPALIDAD COCHAMO'), 'MUNICIPALIDAD COCHAMO');
    assert.equal(normalizeChileSiiCore('Municipalidad de Curicó'), 'MUNICIPALIDAD DE CURICO');
    assert.equal(normalizeChileSiiCore('I. Municipalidad de San Ramón'), 'MUNICIPALIDAD DE SAN RAMON');
  });

  it('hospitales bajo un «SERVICIO … SALUD»: desde HOSPITAL', () => {
    assert.equal(normalizeChileSiiCore('SERVICIO NACIONAL DE SALUD HOSPITAL CARLOS VAN BUREN'), 'HOSPITAL CARLOS VAN BUREN');
    assert.equal(normalizeChileSiiCore('SERVICIO SALUD ARAUCANIA HOSPITAL DE COLLIPULLI'), 'HOSPITAL DE COLLIPULLI');
    assert.equal(normalizeChileSiiCore('Hospital Carlos Van Buren'), 'HOSPITAL CARLOS VAN BUREN');
  });

  it('lo demás no cambia', () => {
    for (const core of ['ENTEL PCS TELECOMUNICACIONES', 'CORPORACION DE DEPORTES DE LA MUNICIPALIDAD DE CURICO', 'INVERSIONES I MUNICIPALIDAD', 'SERVICIO DE ADUANAS ADMINISTRACION DE ARICA', 'HOSPITAL CLINICO SAN BORJA', 'IMPORTADORA ILUSTRE']) {
      assert.equal(canonicalizeChilePublicEntityCore(core), core, core);
    }
    assert.equal(normalizeChileSiiCore('Asociación de Funcionarios del Hospital Carlos Van Buren'), 'ASOCIACION DE FUNCIONARIOS DEL HOSPITAL CARLOS VAN BUREN');
  });

  it('la fila del SII guarda el núcleo común; el RES no cambia', () => {
    const row = buildClSiiRegistryRow(parseClSiiNamesLine(nameLine('69253900', '1', '611', 'I MUNICIPALIDAD DE SAN RAMON'))!, null, null, params);
    assert.equal(row?.normalized_legal_name, 'MUNICIPALIDAD DE SAN RAMON');
    assert.equal(normalizeChileCompanyCore('I MUNICIPALIDAD DE CURICO'), 'I MUNICIPALIDAD DE CURICO');
  });

  it('cableado: el resolvedor del SII usa el mismo núcleo que la carga', () => {
    const wiring = readFileSync(join(process.cwd(), 'src/server/prospect-batches/official-source-resolvers.ts'), 'utf8');
    const i = wiring.indexOf('sourceKey: CL_SII_REGISTRY_SOURCE_KEY');
    assert.match(wiring.slice(i, i + 300), /normalizeCore: normalizeChileSiiCore,/);
    const j = wiring.indexOf("sourceKey: 'cl_res_registry'");
    assert.match(wiring.slice(j, j + 300), /normalizeCore: normalizeChileCompanyCore,/);
  });
});
