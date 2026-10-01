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

  it('la fecha de corte es inclusiva', () => {
    const row = buildUsSecRegistryRow(submission({ filings: { recent: { filingDate: ['2024-09-30'] } } }), secParams);
    assert.equal(row?.tax_id, '36-0698440');
  });

  it('núcleo: quita Inc., Corp., LLC… pero no «Company» ni «Foundation»', () => {
    assert.equal(normalizeUsCompanyCore('Apple Inc.'), 'APPLE');
    assert.equal(normalizeUsCompanyCore('AAR CORP'), 'AAR');
    assert.equal(normalizeUsCompanyCore('Enerpac Tool Group Corp.'), 'ENERPAC TOOL GROUP');
    assert.equal(normalizeUsCompanyCore('Acme Holdings, L.L.C.'), 'ACME HOLDINGS');
    assert.equal(normalizeUsCompanyCore('The Coca-Cola Company'), 'THE COCA COLA COMPANY');
    assert.equal(normalizeUsCompanyCore('Bill & Melinda Gates Foundation'), 'BILL & MELINDA GATES FOUNDATION');
  });
});

describe('IRS (organizaciones sin ánimo de lucro)', () => {
  it('manda el mayor entre ingresos y recaudación (Harvard trae recaudación 0)', () => {
    const row = buildUsIrsEoRegistryRow(irs(), base);
    assert.ok(row);
    assert.equal(row.source_key, 'us_irs_eo_registry');
    assert.equal(row.tax_id, '04-2103580');
    assert.equal(row.normalized_legal_name, 'PRESIDENT AND FELLOWS OF HARVARD COLLEGE');
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
