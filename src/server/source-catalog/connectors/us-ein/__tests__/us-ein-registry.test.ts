/**
 * SOURCES-US-EIN-BY-NAME-1 — Estados Unidos: EIN por nombre (SEC EDGAR, luego IRS).
 *
 * Registros con la forma real de submissions.zip (SEC) y del Exempt Organizations
 * BMF (IRS), septiembre de 2026. Sin E/S de red, sin DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildUsIrsEoRegistryRow,
  buildUsSecRegistryRow,
  formatEin,
  normalizeUsCompanyCore,
  US_IRS_EO_MIN_REVENUE_USD,
} from '../us-ein-registry-rows';
import { getTaxIdentifierRule, validateTaxIdentifier } from '@/modules/prospect-batches/tax-identifier-rules';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { createFallbackOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/fallback-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';
import type { UsEinRegistryRow } from '../us-ein-registry-rows';
import {
  buildUsIpedsDirectoryRow,
  buildUsIrsDirectoryRow,
  buildUsSecDirectoryRow,
  classifySecFilerCategory,
  ipedsWebsiteDomain,
  US_FREE_DIRECTORY_SOURCE_KEY,
} from '../us-free-directory-rows';
import { attachSamWebsites, buildSamWebIndex, samWebsiteDomain } from '../us-sam-websites';
import {
  buildUsPublicEntityRows,
  dotGovDomainNamesEntity,
  placeNameKey,
  US_PUBLIC_ENTITIES_SOURCE_KEY,
  type DotGovDomainRecord,
} from '../us-public-entities';
import {
  macroHasUsFreeDirectoryCoverage,
  resolveUsIpedsMacro,
  resolveUsIrsMacro,
  resolveUsSicMacro,
} from '@/server/prospect-batches/country-source-discovery/us-free-directory-macro-table';
import {
  buildUsFreeDirectoryDiscoveryAdapter,
  US_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type UsFreeDirectorySnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/us-free-directory-discovery-adapter';
import {
  buildCountrySourceAdapter,
  countrySourceMacroHasCoverage,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  resolveCountrySourceCapability,
} from '@/server/prospect-batches/country-source-discovery/country-source-capability';

const base = { sourceYear: 2026, importedAt: '2026-09-30T00:00:00.000Z' };
const secParams = { ...base, activeSince: '2024-09-30' };

const submission = (overrides: Record<string, unknown> = {}) => ({
  cik: '0000001800',
  entityType: 'operating',
  sic: '2834',
  sicDescription: 'Pharmaceutical Preparations',
  name: 'ABBOTT LABORATORIES',
  ein: '360698440',
  addresses: { business: { stateOrCountry: 'IL' } },
  filings: { recent: { filingDate: ['2026-08-01', '2025-02-14', '2019-03-01'] } },
  ...overrides,
});

const irs = (overrides: Record<string, string> = {}) => ({
  EIN: '042103580',
  NAME: 'PRESIDENT AND FELLOWS OF HARVARD COLLEGE',
  CITY: 'CAMBRIDGE',
  STATE: 'MA',
  INCOME_AMT: '1999999998',
  REVENUE_AMT: '0',
  NTEE_CD: 'B500',
  ...overrides,
});

describe('regla del EIN', () => {
  it('está registrada para US, sólo de forma (el EIN no tiene dígito verificador)', () => {
    const rule = getTaxIdentifierRule('us');
    assert.equal(rule?.label, 'EIN');
    assert.equal(rule?.validationLevel, 'format_only');
  });

  it('acepta 9 dígitos con o sin guion y lo deja como «12-3456789»', () => {
    for (const ein of ['36-0698440', '360698440', '36 0698440']) {
      assert.equal(validateTaxIdentifier(ein, 'US').valid, true, ein);
    }
    assert.equal(validateTaxIdentifier('360698440', 'US').normalized, '36-0698440');
    assert.equal(validateTaxIdentifier('3606984', 'US').valid, false);
  });

  it('formatEin: 9 dígitos útiles o nada', () => {
    assert.equal(formatEin('360698440'), '36-0698440');
    assert.equal(formatEin(42103580), null); // 8 dígitos: un número pierde el cero inicial
    assert.equal(formatEin('000000000'), null);
    assert.equal(formatEin(''), null);
    assert.equal(formatEin(null), null);
  });
});

describe('SEC EDGAR', () => {
  it('una empresa operativa activa → fila con EIN, SIC y estado', () => {
    const row = buildUsSecRegistryRow(submission(), secParams);
    assert.ok(row);
    assert.equal(row.source_key, 'us_sec_edgar_registry');
    assert.equal(row.country_code, 'US');
    assert.equal(row.tax_id, '36-0698440');
    assert.equal(row.normalized_legal_name, 'ABBOTT LABORATORIES');
    assert.deepEqual(row.raw_data, { sic: '2834', sic_description: 'Pharmaceutical Preparations', state: 'IL', cik: '0000001800' });
    assert.equal(row.record_identity_key, 'tax:36-0698440');
  });

  it('fuera: fondos y personas, sin EIN, sin SIC, EIN todo ceros, y sin presentaciones desde la fecha de corte', () => {
    assert.equal(buildUsSecRegistryRow(submission({ entityType: 'other' }), secParams), null);
    assert.equal(buildUsSecRegistryRow(submission({ ein: null }), secParams), null);
    assert.equal(buildUsSecRegistryRow(submission({ ein: '000000000' }), secParams), null);
    assert.equal(buildUsSecRegistryRow(submission({ sic: '' }), secParams), null);
    assert.equal(
      buildUsSecRegistryRow(submission({ filings: { recent: { filingDate: ['2019-03-01', '2024-09-29'] } } }), secParams),
      null,
    );
    assert.equal(buildUsSecRegistryRow(submission({ filings: {} }), secParams), null);
  });

  it('la última presentación se busca en toda la lista, aunque no venga primero', () => {
    const row = buildUsSecRegistryRow(submission({ filings: { recent: { filingDate: ['2019-03-01', '2026-08-01'] } } }), secParams);
    assert.equal(row?.tax_id, '36-0698440');
  });

  it('un nombre sin núcleo utilizable no entra', () => {
    assert.equal(buildUsSecRegistryRow(submission({ name: 'X' }), secParams), null);
  });

  it('la fecha de corte es inclusiva', () => {
    const row = buildUsSecRegistryRow(submission({ filings: { recent: { filingDate: ['2024-09-30'] } } }), secParams);
    assert.equal(row?.tax_id, '36-0698440');
  });

  it('núcleo: quita Inc., Corp., LLC… pero no «Company» ni «Foundation»', () => {
    assert.equal(normalizeUsCompanyCore('Apple Inc.'), 'APPLE');
    assert.equal(normalizeUsCompanyCore('AAR CORP'), 'AAR');
    assert.equal(normalizeUsCompanyCore('Enerpac Tool Group Corp.'), 'ENERPAC TOOL GROUP');
    assert.equal(normalizeUsCompanyCore('Acme Holdings, L.L.C.'), 'ACME HOLDINGS');
    assert.equal(normalizeUsCompanyCore('The Coca-Cola Company'), 'COCA COLA');
    assert.equal(normalizeUsCompanyCore('BANK OF AMERICA CORP /DE/'), 'BANK OF AMERICA');
    assert.equal(normalizeUsCompanyCore('Alphabet Inc. /NEW/'), 'ALPHABET');
    assert.equal(normalizeUsCompanyCore('Acme Services LLC d/b/a Acme Pro'), 'ACME SERVICES');
    assert.equal(normalizeUsCompanyCore('Johnson and Johnson'), 'JOHNSON & JOHNSON');
    assert.equal(normalizeUsCompanyCore('Smith Law Group, PLLC'), 'SMITH LAW GROUP');
    assert.equal(normalizeUsCompanyCore('Cleveland Clinic Foundation, The'), 'CLEVELAND CLINIC FOUNDATION');
    assert.equal(normalizeUsCompanyCore('AT&T Inc.'), 'AT&T');
    assert.equal(normalizeUsCompanyCore('JPMORGAN CHASE & CO'), 'JPMORGAN CHASE');
    assert.equal(normalizeUsCompanyCore('COSTCO WHOLESALE CORP /NEW'), 'COSTCO WHOLESALE');
    assert.equal(normalizeUsCompanyCore('Bill & Melinda Gates Foundation'), 'BILL & MELINDA GATES FOUNDATION');
  });
});

describe('IRS (organizaciones sin ánimo de lucro)', () => {
  it('manda el mayor entre ingresos y recaudación (Harvard trae recaudación 0)', () => {
    const row = buildUsIrsEoRegistryRow(irs(), base);
    assert.ok(row);
    assert.equal(row.source_key, 'us_irs_eo_registry');
    assert.equal(row.tax_id, '04-2103580');
    assert.equal(row.normalized_legal_name, 'PRESIDENT & FELLOWS OF HARVARD COLLEGE');
    assert.deepEqual(row.raw_data, { ntee: 'B500', state: 'MA', city: 'CAMBRIDGE' });
  });

  it(`fuera: por debajo de ${US_IRS_EO_MIN_REVENUE_USD} USD, sin montos, sin EIN o sin nombre`, () => {
    assert.equal(buildUsIrsEoRegistryRow(irs({ INCOME_AMT: '4999999', REVENUE_AMT: '4999999' }), base), null);
    assert.equal(buildUsIrsEoRegistryRow(irs({ INCOME_AMT: '', REVENUE_AMT: '' }), base), null);
    assert.equal(buildUsIrsEoRegistryRow(irs({ EIN: '' }), base), null);
    assert.equal(buildUsIrsEoRegistryRow(irs({ NAME: '  ' }), base), null);
  });

  it('el umbral es inclusivo y configurable', () => {
    assert.ok(buildUsIrsEoRegistryRow(irs({ INCOME_AMT: '5000000', REVENUE_AMT: '0' }), base));
    assert.ok(buildUsIrsEoRegistryRow(irs({ INCOME_AMT: '0', REVENUE_AMT: '5000000' }), base));
    assert.ok(buildUsIrsEoRegistryRow(irs({ INCOME_AMT: '41497', REVENUE_AMT: '41497' }), { ...base, minRevenue: 0 }));
  });

  it('las dos fuentes son de grano fiscal (un EIN, una fila)', () => {
    assert.equal(getSourceFamily('us_sec_edgar_registry'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('us_irs_eo_registry'), 'TAX_GRAIN');
  });
});

describe('EIN por nombre dentro de la corrida (SEC, luego IRS)', () => {
  const resolverFor = (sourceKey: string, rows: UsEinRegistryRow[]) =>
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'US',
      sourceKey,
      taxIdentifierType: 'EIN',
      validTaxId: /^\d{2}-\d{7}$/,
      normalizeCore: normalizeUsCompanyCore,
      querySnapshots: async (core) =>
        rows
          .filter((row) => row.normalized_legal_name === core)
          .map((row) => ({ taxId: row.normalized_tax_id, legalName: row.legal_name, normalizedLegalName: row.normalized_legal_name })),
    });

  const sec = [buildUsSecRegistryRow(submission(), secParams)].filter((row) => row !== null);
  const eo = [buildUsIrsEoRegistryRow(irs(), base)].filter((row) => row !== null);
  const resolver = createFallbackOfficialSourceResolver(
    resolverFor('us_sec_edgar_registry', sec),
    resolverFor('us_irs_eo_registry', eo),
  );

  const candidate = (canonicalName: string): NormalizedProspectCandidate =>
    ({
      sourceProvider: 'apollo',
      providerRecordId: 'rec-us-1',
      providerRequestId: 'req-us-1',
      canonicalName,
      normalizedName: canonicalName.toLowerCase(),
      commercialName: canonicalName,
      legalName: null,
      websiteUrl: null,
      domain: null,
      corporateLinkedinUrl: null,
      country: 'United States',
      countryCode: 'US',
      requestedCountryCode: 'US',
      region: null,
      city: null,
      industry: 'Health',
      subindustry: null,
      industryCodes: {},
      employeeCount: 5000,
      employeeRange: null,
      sourceUrl: null,
      sourceConfidence: null,
      searchCriteria: {},
      warnings: [],
      issues: [],
      providerMetadataSafe: {},
      trace: { sourceProvider: 'apollo', providerRecordId: 'rec-us-1', providerRequestId: 'req-us-1', sourceUrl: null },
    }) as NormalizedProspectCandidate;

  it('una empresa de la SEC → EIN fuerte en las columnas tipadas, con tipo EIN', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Abbott Laboratories Inc.'),
      { country: 'United States', countryCode: 'US' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, '36-0698440');
    assert.equal(enriched.taxIdentifierType, 'EIN');
    assert.equal(validateTaxIdentifier(enriched.taxIdentifier ?? '', 'US').valid, true);
  });

  it('una universidad que no está en la SEC → la encuentra el IRS', async () => {
    const out = await resolver.resolve({
      candidate: candidate('President and Fellows of Harvard College'),
      criteria: { countryCode: 'US' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    });
    assert.equal(out.status, 'matched');
    assert.equal(out.sourceKey, 'us_irs_eo_registry');
    assert.equal(out.taxIdentifier, '04-2103580');
  });
});

describe('migración 141', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/141_tax_identifier_type_ein_nif.sql'), 'utf8');
  const body = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('añade EIN y NIF a los dos CHECK sin quitar ningún tipo existente', () => {
    const existing = ['NIT', 'RFC', 'RUT', 'RUC', 'CUIT', 'CNPJ', 'RNC', 'RTN', 'cedula_juridica', 'other'];
    for (const table of ['accounts', 'prospect_candidates']) {
      const block = new RegExp(`ADD CONSTRAINT ${table}_tax_identifier_type_check\\s+CHECK \\(tax_identifier_type IN \\(([^)]*)\\)\\)`).exec(body);
      assert.ok(block, table);
      for (const type of [...existing, 'EIN', 'NIF']) assert.ok(block[1].includes(`'${type}'`), `${table}: ${type}`);
    }
    assert.match(body, /prospect_candidates_tax_identifier_type_check[\s\S]*'NIF', NULL/);
  });

  it('sólo toca esos dos CHECK: ni tablas, ni funciones, ni datos', () => {
    assert.doesNotMatch(body, /CREATE\s+(TABLE|FUNCTION|TRIGGER|INDEX)|\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
    assert.equal((body.match(/ALTER TABLE/g) ?? []).length, 4);
  });
});

// ── SOURCES-US-CLOSE-1 — buscador gratuito de Estados Unidos ────────────────

describe('tabla NTEE/SIC → macro (aprobada el 14-10-2026)', () => {
  it('NTEE: salud, educación y servicios humanos; fundaciones y arte sin macro', () => {
    assert.equal(resolveUsIrsMacro({ ntee: 'E22', subsection: '03', legalName: 'MAYO CLINIC' }), 'health_pharma');
    assert.equal(resolveUsIrsMacro({ ntee: 'B43', subsection: '03', legalName: 'YALE UNIVERSITY' }), 'services_company');
    assert.equal(resolveUsIrsMacro({ ntee: 'P20', subsection: '03', legalName: 'X' }), 'services_company');
    assert.equal(resolveUsIrsMacro({ ntee: 'K31', subsection: '03', legalName: 'X' }), 'agroindustry');
    assert.equal(resolveUsIrsMacro({ ntee: 'T20', subsection: '03', legalName: 'GATES FOUNDATION' }), null);
    assert.equal(resolveUsIrsMacro({ ntee: 'A51', subsection: '03', legalName: 'MUSEUM' }), null);
  });

  it('sindicatos, clubes y VEBA nunca; sin NTEE sólo las cooperativas eléctricas', () => {
    assert.equal(resolveUsIrsMacro({ ntee: 'E22', subsection: '09', legalName: 'HEALTH TRUST' }), null);
    assert.equal(resolveUsIrsMacro({ ntee: 'J40', subsection: '05', legalName: 'UNION' }), null);
    assert.equal(resolveUsIrsMacro({ ntee: '', subsection: '12', legalName: 'MOUNTAIN ELECTRIC COOPERATIVE INC' }), 'energy_mining_environment');
    assert.equal(resolveUsIrsMacro({ ntee: '', subsection: '12', legalName: 'FARMERS MUTUAL IRRIGATION' }), null);
    assert.equal(resolveUsIrsMacro({ ntee: '', subsection: '03', legalName: 'JEROME HOME' }), null);
  });

  it('SIC: grupos mayores; cascarones (67) y titulizaciones (61) fuera', () => {
    assert.equal(resolveUsSicMacro('7372'), 'technology');
    assert.equal(resolveUsSicMacro('2834'), 'health_pharma');
    assert.equal(resolveUsSicMacro('6022'), 'insurance_financial_services');
    assert.equal(resolveUsSicMacro('5331'), 'retail');
    assert.equal(resolveUsSicMacro('6770'), null);
    assert.equal(resolveUsSicMacro('6189'), null);
    assert.equal(resolveUsSicMacro('100'), null); // agricultura: sin macro en SIC
    assert.equal(resolveUsSicMacro('abc'), null);
  });

  it('cobertura: Gobierno sólo por las universidades públicas de IPEDS', () => {
    assert.equal(macroHasUsFreeDirectoryCoverage('health_pharma'), true);
    assert.equal(macroHasUsFreeDirectoryCoverage('government'), true);
    assert.equal(resolveUsIpedsMacro('public_institution'), 'government');
    assert.equal(resolveUsIpedsMacro('private_nonprofit_institution'), 'services_company');
    assert.equal(resolveUsIpedsMacro('x'), null);
  });
});

describe('filas de us_free_directory', () => {
  const irsRecord = (overrides: Record<string, string> = {}) => ({
    EIN: '410693991',
    NAME: 'MAYO CLINIC',
    CITY: 'ROCHESTER',
    STATE: 'MN',
    SUBSECTION: '03',
    NTEE_CD: 'E22',
    REVENUE_AMT: '17000000000',
    INCOME_AMT: '0',
    ...overrides,
  });

  it('IRS: ≥ US$ 25 M con macro; grande desde US$ 100 M; relevancia = ingresos en millones', () => {
    const row = buildUsIrsDirectoryRow(irsRecord(), base);
    assert.ok(row);
    assert.equal(row.source_key, US_FREE_DIRECTORY_SOURCE_KEY);
    assert.equal(row.tax_id, '41-0693991');
    assert.equal(row.region, 'MN');
    assert.equal(row.priority_score, 17000);
    assert.equal(row.raw_data['macro_industry_key'], 'health_pharma');
    assert.equal(row.raw_data['size_band'], 'large');
    assert.equal(row.raw_data['activity_text'], 'Salud');
    assert.equal(getSourceFamily(row.source_key), 'TAX_GRAIN');

    const mid = buildUsIrsDirectoryRow(irsRecord({ REVENUE_AMT: '40000000' }), base);
    assert.equal(mid?.raw_data['size_band'], null);
    assert.equal(buildUsIrsDirectoryRow(irsRecord({ REVENUE_AMT: '24999999' }), base), null);
    assert.equal(buildUsIrsDirectoryRow(irsRecord({ NTEE_CD: 'T20' }), base), null);
    assert.equal(buildUsIrsDirectoryRow(irsRecord({ SUBSECTION: '09' }), base), null);
  });

  it('SEC: sólo «Large accelerated» y «Accelerated», con SIC útil, sede en EE. UU. y activa', () => {
    const large = buildUsSecDirectoryRow(submission({ category: 'Large accelerated filer' }), secParams);
    assert.ok(large);
    assert.equal(large.raw_data['size_band'], 'large');
    assert.equal(large.raw_data['macro_industry_key'], 'health_pharma');
    assert.equal(large.priority_score, 1000);

    const accelerated = buildUsSecDirectoryRow(submission({ category: 'Accelerated filer' }), secParams);
    assert.equal(accelerated?.raw_data['size_band'], null);
    assert.equal(accelerated?.priority_score, 100);
    // «Smaller reporting company» = ingresos < US$ 100 M: fuera aunque sea «Accelerated».
    assert.equal(buildUsSecDirectoryRow(submission({ category: 'Accelerated filer<br>Smaller reporting company' }), secParams), null);

    assert.equal(buildUsSecDirectoryRow(submission({ category: 'Non-accelerated filer<br>Smaller reporting company' }), secParams), null);
    assert.equal(buildUsSecDirectoryRow(submission({ category: 'Large accelerated filer', sic: '6770' }), secParams), null);
    assert.equal(
      buildUsSecDirectoryRow(
        submission({ category: 'Large accelerated filer', addresses: { business: { stateOrCountry: 'K3' } } }),
        secParams,
      ),
      null,
    );
    assert.equal(classifySecFilerCategory('Large Accelerated'), 'large');
    assert.equal(classifySecFilerCategory(''), null);
  });
});

describe('IPEDS: universidades y colegios con 5.000+ estudiantes', () => {
  const hd = (overrides: Record<string, string> = {}) => ({
    UNITID: '100751',
    INSTNM: 'The University of Alabama',
    IALIAS: 'UA | Bama',
    CITY: 'Tuscaloosa',
    STABBR: 'AL',
    EIN: '636001138 ',
    WEBADDR: 'www.ua.edu/',
    CONTROL: '1',
    INSTSIZE: '5',
    CYACTIVE: '1',
    ...overrides,
  });

  it('pública → Gobierno con su EIN, web y tamaño; privada → Servicios', () => {
    const row = buildUsIpedsDirectoryRow(hd(), base);
    assert.ok(row);
    assert.equal(row.tax_id, '63-6001138');
    assert.equal(row.normalized_legal_name, 'UNIVERSITY OF ALABAMA');
    assert.equal(row.raw_data['macro_industry_key'], 'government');
    assert.equal(row.raw_data['website_domain'], 'ua.edu');
    assert.equal(row.raw_data['size_band'], 'large');
    assert.equal(row.priority_score, 500);
    const priv = buildUsIpedsDirectoryRow(hd({ CONTROL: '2', INSTSIZE: '3' }), base);
    assert.equal(priv?.raw_data['macro_industry_key'], 'services_company');
    assert.equal(priv?.raw_data['size_band'], null);
  });

  it('fuera: menos de 5.000 estudiantes, con fines de lucro, cerradas o sin EIN', () => {
    assert.equal(buildUsIpedsDirectoryRow(hd({ INSTSIZE: '2' }), base), null);
    assert.equal(buildUsIpedsDirectoryRow(hd({ CONTROL: '3' }), base), null);
    assert.equal(buildUsIpedsDirectoryRow(hd({ CYACTIVE: '2' }), base), null);
    assert.equal(buildUsIpedsDirectoryRow(hd({ EIN: '-2' }), base), null);
  });

  it('la web de IPEDS se reduce al dominio', () => {
    assert.equal(ipedsWebsiteDomain('https://www.uab.edu/'), 'uab.edu');
    assert.equal(ipedsWebsiteDomain('www.harvard.edu'), 'harvard.edu');
    assert.equal(ipedsWebsiteDomain(''), null);
    assert.equal(ipedsWebsiteDomain('n/a'), null);
  });
});

describe('adapter de descubrimiento de Estados Unidos', () => {
  const readRow = (overrides: Partial<UsFreeDirectorySnapshotReadRow> = {}): UsFreeDirectorySnapshotReadRow => ({
    record_identity_key: 'tax:41-0693991',
    ein: '41-0693991',
    legal_name: 'MAYO CLINIC',
    normalized_legal_name: 'MAYO CLINIC',
    city: 'ROCHESTER',
    region: 'MN',
    directory_kind: 'irs_eo',
    activity_system: 'NTEE',
    activity_code: 'E22',
    activity_text: 'Salud',
    size_band: 'large',
    size_source: 'IRS – ingresos declarados',
    website_domain: null,
    priority_score: 17000,
    ...overrides,
  });

  it('ofrece la macro pedida con EIN, tamaño «grande» y la tabla de HOY; un EIN una vez', async () => {
    const adapter = buildUsFreeDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async () => [
        readRow(),
        readRow({ record_identity_key: 'dup' }),
        readRow({ ein: '13-1111111', activity_code: 'B43' }), // hoy es Servicios: fuera
        readRow({ ein: '22-2222222', directory_kind: 'sec', activity_system: 'SIC', activity_code: '2834', size_band: null }),
        readRow({ ein: 'bad' }),
      ],
    });
    const result = await adapter({ macroIndustryKey: 'health_pharma', limit: 10 } as never);
    assert.equal(result.sourceKey, US_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.deepEqual(result.companies.map((c) => c.taxId), ['41-0693991', '22-2222222']);
    const [mayo, sec] = result.companies;
    assert.equal(mayo.taxIdentifierType, 'EIN');
    assert.equal(mayo.countryCode, 'US');
    assert.deepEqual(mayo.officialSizeBand, { band: 'large', sourceLabel: 'IRS – ingresos declarados' });
    assert.equal(mayo.officialWorkforce, null);
    assert.equal(sec.officialSizeBand, null);
    assert.equal(result.recordsRead, 5);
  });

  it('IPEDS pública en Gobierno, con su web', async () => {
    const adapter = buildUsFreeDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async () => [
        readRow({
          ein: '63-6001138',
          legal_name: 'The University of Alabama',
          directory_kind: 'ipeds',
          activity_system: 'IPEDS',
          activity_code: 'public_institution',
          website_domain: 'ua.edu',
          size_source: 'IPEDS – estudiantes matriculados',
        }),
      ],
    });
    const result = await adapter({ macroIndustryKey: 'government', limit: 10 } as never);
    assert.equal(result.companies.length, 1);
    assert.equal(result.companies[0].domain, 'ua.edu');
  });

  it('macro sin cobertura (Agro en la SEC no; Consumo sí) no consulta', async () => {
    let called = false;
    const adapter = buildUsFreeDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async () => {
        called = true;
        return [];
      },
    });
    const result = await adapter({ macroIndustryKey: 'not_a_macro', limit: 10 } as never);
    assert.equal(result.companies.length, 0);
    assert.equal(called, false);
  });

  it('EE. UU. está cableado como país con buscador gratuito', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('US'));
    assert.equal(resolveCountrySourceCapability('us')?.sourceKey, US_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(countrySourceMacroHasCoverage('US', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('US', 'government'), true);
    assert.equal(buildCountrySourceAdapter('US', {}), null);
    assert.notEqual(
      buildCountrySourceAdapter('US', { usFreeDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } }),
      null,
    );
  });
});

describe('entidades públicas (.gov de CISA + Censo 2024)', () => {
  const rec = (domain: string, domainType: string, organization: string, extra: Partial<DotGovDomainRecord> = {}): DotGovDomainRecord => ({
    domain,
    domainType,
    organization,
    suborganization: null,
    city: null,
    state: null,
    ...extra,
  });
  const population = {
    county: (name: string, state: string) => (name === 'king' && state === 'Washington' ? 2_340_000 : name === 'tiny' ? 9_000 : null),
    city: (name: string, state: string) => (name === 'twentynine palms' && state === 'California' ? 28_000 : name === 'austin' && state === 'Texas' ? 993_000 : null),
  };

  it('la web .gov vale sólo si nombra a la entidad o lleva su sigla', () => {
    assert.equal(dotGovDomainNamesEntity('austintexas.gov', 'City of Austin'), true);
    assert.equal(dotGovDomainNamesEntity('cdc.gov', 'Centers for Disease Control and Prevention'), true);
    assert.equal(dotGovDomainNamesEntity('alabc.gov', 'Alabama Alcoholic Beverage Control Board'), true);
    assert.equal(dotGovDomainNamesEntity('usda.gov', 'Department of Agriculture'), true);
    assert.equal(dotGovDomainNamesEntity('farmers.gov', 'Office of Communications'), false);
    assert.equal(dotGovDomainNamesEntity('choosemyplate.gov', 'Food and Nutrition Service'), false);
  });

  it('el nombre del lugar se cruza con el Censo sin «City of» ni «County»', () => {
    assert.equal(placeNameKey('City of Twentynine Palms'), 'twentynine palms');
    assert.equal(placeNameKey('King County'), 'king');
    assert.equal(placeNameKey('Austin city'), 'austin');
    assert.equal(placeNameKey('St. Louis County'), 'st louis');
  });

  it('federal, estatal y locales ≥ 50.000 habitantes; una fila por entidad con la web más corta que la nombra', () => {
    const rows = buildUsPublicEntityRows(
      [
        rec('cdc.gov', 'Federal - Executive', 'Department of Health and Human Services', { suborganization: 'Centers for Disease Control and Prevention' }),
        rec('cdcfoundationprogram.gov', 'Federal - Executive', 'Department of Health and Human Services', { suborganization: 'Centers for Disease Control and Prevention' }),
        rec('kingcounty.gov', 'County', 'King County', { state: 'WA' }),
        rec('tinycounty.gov', 'County', 'Tiny County', { state: 'WA' }),
        rec('29palms.gov', 'City', 'City of Twentynine Palms', { state: 'CA', city: 'Twentynine Palms' }),
        rec('austintexas.gov', 'City', 'City of Austin', { state: 'TX', city: 'Austin' }),
        rec('votetexas.gov', 'State or territory - Election', 'Texas Secretary of State', { state: 'TX' }),
        rec('choosemyplate.gov', 'Federal - Executive', 'Department of Agriculture', { suborganization: 'Food and Nutrition Service' }),
      ],
      population,
      base,
    );
    assert.deepEqual(rows.map((row) => row.raw_data['website_domain']), ['cdc.gov', 'kingcounty.gov', 'austintexas.gov']);
    const [cdc, king, austin] = rows;
    assert.equal(cdc.source_key, US_PUBLIC_ENTITIES_SOURCE_KEY);
    assert.equal(cdc.legal_name, 'Centers for Disease Control and Prevention');
    assert.equal(cdc.raw_data['parent_organization'], 'Department of Health and Human Services');
    assert.equal(cdc.tax_id, null);
    assert.equal(cdc.record_identity_key, 'us-public-entity:cdc.gov');
    assert.equal(king.raw_data['inhabitants'], 2_340_000);
    assert.equal(king.raw_data['size_band'], 'large');
    assert.equal(austin.city, 'Austin');
    assert.equal(getSourceFamily(US_PUBLIC_ENTITIES_SOURCE_KEY), 'NATIVE_RECORD_GRAIN');
    for (const row of rows) assert.equal(JSON.stringify(row).includes('@'), false); // nunca el correo de contacto
  });

  it('el adapter ofrece la entidad pública sin EIN por su web, sólo en Gobierno', async () => {
    const entity = {
      record_identity_key: 'us-public-entity:kingcounty.gov',
      ein: null,
      legal_name: 'King County',
      normalized_legal_name: 'KING COUNTY',
      city: null,
      region: 'WA',
      directory_kind: 'public_entity',
      activity_system: null,
      activity_code: null,
      activity_text: 'Entidad pública',
      size_band: 'large',
      size_source: 'Censo 2024 – habitantes',
      website_domain: 'kingcounty.gov',
      priority_score: 2340,
    };
    const adapter = buildUsFreeDirectoryDiscoveryAdapter({ readCompaniesByMacro: async () => [entity, { ...entity, record_identity_key: 'dup' }] });
    const gov = await adapter({ macroIndustryKey: 'government', limit: 10 } as never);
    assert.equal(gov.companies.length, 1);
    assert.equal(gov.companies[0].taxId, null);
    assert.equal(gov.companies[0].taxIdentifierType, null);
    assert.equal(gov.companies[0].domain, 'kingcounty.gov');
    const health = await adapter({ macroIndustryKey: 'health_pharma', limit: 10 } as never);
    assert.equal(health.companies.length, 0);
    const noWeb = buildUsFreeDirectoryDiscoveryAdapter({ readCompaniesByMacro: async () => [{ ...entity, website_domain: null }] });
    assert.equal((await noWeb({ macroIndustryKey: 'government', limit: 10 } as never)).companies.length, 0);
  });
});

describe('web desde SAM.gov (nombre + estado)', () => {
  const irsRow = (name: string, state: string, revenue: string, ein: string) =>
    buildUsIrsDirectoryRow(
      { EIN: ein, NAME: name, STATE: state, CITY: 'X', SUBSECTION: '03', NTEE_CD: 'E22', REVENUE_AMT: revenue, INCOME_AMT: '0' },
      base,
    )!;

  it('dominio útil: fuera «null», redes y correo gratuito', () => {
    assert.equal(samWebsiteDomain('https://www.jax.org/'), 'jax.org');
    assert.equal(samWebsiteDomain('null'), null);
    assert.equal(samWebsiteDomain('www.facebook.com/acme'), null);
    assert.equal(samWebsiteDomain('acme.wixsite.com'), null);
  });

  it('pone la web cuando nombre + estado apuntan a una sola; una web, una organización (la mayor)', () => {
    const index = buildSamWebIndex([
      { legalBusinessName: 'JACKSON LABORATORY', dbaName: null, state: 'ME', entityUrl: 'https://www.jax.org', uei: 'ABC123DEF456' },
      { legalBusinessName: 'CENTRAL MAINE MEDICAL CENTER', dbaName: null, state: 'ME', entityUrl: 'cmhc.org', uei: null },
      { legalBusinessName: 'RUMFORD HOSPITAL', dbaName: null, state: 'ME', entityUrl: 'cmhc.org', uei: null },
      { legalBusinessName: 'AMBIGUOUS CENTER', dbaName: null, state: 'ME', entityUrl: 'a.org', uei: null },
      { legalBusinessName: 'AMBIGUOUS CENTER', dbaName: null, state: 'ME', entityUrl: 'b.org', uei: null },
    ]);
    const rows = [
      irsRow('JACKSON LABORATORY', 'ME', '500000000', '010211513'),
      irsRow('CENTRAL MAINE MEDICAL CENTER', 'ME', '600000000', '010211501'),
      irsRow('RUMFORD HOSPITAL', 'ME', '40000000', '010211502'),
      irsRow('AMBIGUOUS CENTER', 'ME', '40000000', '010211503'),
      irsRow('JACKSON LABORATORY', 'CA', '40000000', '010211504'), // otro estado
    ];
    const before = JSON.stringify(rows);
    const { rows: out, attached } = attachSamWebsites(rows, index);
    assert.equal(JSON.stringify(rows), before); // no modifica las recibidas
    assert.equal(attached, 2);
    assert.deepEqual(out.map((row) => row.raw_data['website_domain']), ['jax.org', 'cmhc.org', null, null, null]);
    assert.equal(out[0].raw_data['website_source'], 'SAM.gov');
    assert.equal(out[0].raw_data['sam_uei'], 'ABC123DEF456');
  });
});
