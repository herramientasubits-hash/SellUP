/**
 * SOURCES-SV-LARGE-TAXPAYERS-1 — los Grandes Contribuyentes de El Salvador que no
 * venden al Estado entran en la capa gratuita con la industria de una tabla por NIT
 * (revisada por la dueña, como la de Panamá). Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isValidSalvadoranNitCheckDigit } from '../sv-nit';
import {
  buildSvLargeTaxpayerDirectoryRow,
  SV_LARGE_TAXPAYER_DIRECTORY_SOURCE_KEY,
  type SvSnapshotRow,
} from '../sv-sources-rows';
import {
  resolveSvLargeTaxpayerMacro,
  resolveSvLargeTaxpayerWebsite,
  SV_LARGE_TAXPAYER_MACRO_TABLE_APPROVED,
  SV_LARGE_TAXPAYER_TABLE,
} from '@/server/prospect-batches/country-source-discovery/sv-large-taxpayer-macro-table';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import {
  buildSvComprasalDirectoryDiscoveryAdapter,
  type SvComprasalDirectorySnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/sv-comprasal-directory-discovery-adapter';
import { macroHasSvCoverage, resolveSvDirectoryMacro } from '@/server/prospect-batches/country-source-discovery/sv-comprasal-macro-table';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import type { CountrySourceCriteria } from '@/server/prospect-batches/country-source-discovery/country-source-types';

const importedAt = '2026-10-08T00:00:00.000Z';

// Banco Agrícola (Grandes 2019) y Almacenes Simán.
const BANCO_AGRICOLA = '06143101550016';
const SIMAN = '06141702660013';

function registryRow(nit: string, name: string, core: string): SvSnapshotRow {
  return {
    source_key: 'sv_nit_registry',
    country_code: 'SV',
    source_year: 2019,
    tax_id: nit,
    normalized_tax_id: nit,
    legal_name: name,
    normalized_legal_name: core,
    city: null,
    region: null,
    priority_score: 0,
    raw_data: { tax_identifier_type: 'NIT', origins: ['dgii_large_2019'], taxpayer_category: 'SV_GRAN_CONTRIBUYENTE', metrics_year: 2019 },
    imported_at: importedAt,
    record_identity_key: `tax:${nit}` as SvSnapshotRow['record_identity_key'],
  };
}

describe('tabla de Grandes Contribuyentes por NIT', () => {
  it('sigue sin aprobar', () => {
    assert.equal(SV_LARGE_TAXPAYER_MACRO_TABLE_APPROVED, false);
  });

  it('cada NIT pasa el verificador, cada macro es del catálogo y cada web tiene forma de dominio', () => {
    const entries = Object.entries(SV_LARGE_TAXPAYER_TABLE);
    assert.ok(entries.length >= 500, `${entries.length} filas`);
    for (const [nit, [macro, web]] of entries) {
      assert.equal(isValidSalvadoranNitCheckDigit(nit), true, nit);
      assert.ok((MACRO_INDUSTRY_KEYS as readonly string[]).includes(macro), `${nit} ${macro}`);
      assert.notEqual(macro, 'government', nit);
      if (web !== null) assert.match(web, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, nit);
    }
  });

  it('resuelve por NIT; un NIT ajeno no tiene macro', () => {
    assert.equal(resolveSvLargeTaxpayerMacro(BANCO_AGRICOLA), 'insurance_financial_services');
    assert.equal(resolveSvLargeTaxpayerMacro(SIMAN), 'retail');
    assert.equal(resolveSvLargeTaxpayerMacro('06142410901023'), null);
    assert.equal(resolveSvLargeTaxpayerWebsite('06142410901023'), null);
  });
});

describe('fila de la capa gratuita', () => {
  it('Gran Contribuyente con macro de la tabla, su NIT, su tramo y su web si la hay', () => {
    const result = buildSvLargeTaxpayerDirectoryRow(registryRow(SIMAN, 'ALMACENES SIMAN, S.A. DE C.V.', 'ALMACENES SIMAN'), { importedAt });
    assert.ok('row' in result, JSON.stringify(result));
    assert.equal(result.row.source_key, SV_LARGE_TAXPAYER_DIRECTORY_SOURCE_KEY);
    assert.equal(result.row.tax_id, SIMAN);
    assert.equal(result.row.record_identity_key, `tax:${SIMAN}`);
    assert.equal(result.row.raw_data['directory_kind'], 'large_taxpayer');
    assert.equal(result.row.raw_data['macro_industry_key'], 'retail');
    assert.equal(result.row.raw_data['activity_code'], SIMAN);
    assert.equal(result.row.raw_data['taxpayer_category'], 'SV_GRAN_CONTRIBUYENTE');
  });

  it('fuera: NIT sin macro en la tabla («A L S», sin palabra clara)', () => {
    assert.deepEqual(buildSvLargeTaxpayerDirectoryRow(registryRow('06140506011033', 'A L S, S.A. DE C.V.', 'A L S'), { importedAt }), { excluded: 'no_macro' });
  });

  it('familia TAX_GRAIN', () => {
    assert.equal(getSourceFamily(SV_LARGE_TAXPAYER_DIRECTORY_SOURCE_KEY), 'TAX_GRAIN');
  });
});

describe('descubrimiento gratuito con Grandes Contribuyentes', () => {
  const row = (nit: string, overrides: Partial<SvComprasalDirectorySnapshotReadRow> = {}): SvComprasalDirectorySnapshotReadRow => ({
    record_identity_key: `tax:${nit}`,
    nit,
    legal_name: 'ALMACENES SIMAN, S.A. DE C.V.',
    normalized_legal_name: 'ALMACENES SIMAN',
    city: null,
    region: null,
    directory_kind: 'large_taxpayer',
    activity_code: nit,
    website_domain: null,
    awarded_usd: null,
    last_award_year: null,
    priority_score: 0,
    ...overrides,
  });
  const criteria = (macroIndustryKey: string): CountrySourceCriteria =>
    ({ countryCode: 'SV', macroIndustryKey, limit: 10 }) as unknown as CountrySourceCriteria;

  it('la macro sale de la tabla de HOY por el NIT, sin exigir monto adjudicado', async () => {
    const adapter = buildSvComprasalDirectoryDiscoveryAdapter({ readCompaniesByMacro: async () => [row(SIMAN)] });
    const out = await adapter(criteria('retail'));
    assert.equal(out.companies.length, 1);
    assert.equal(out.companies[0].taxId, SIMAN);
    assert.equal(out.companies[0].declaredIndustry, 'Gran contribuyente (Hacienda)');
    assert.equal(resolveSvDirectoryMacro('large_taxpayer', SIMAN), 'retail');
    const none = await adapter(criteria('technology'));
    assert.equal(none.companies.length, 0);
  });

  it('Retail ya tiene cobertura en El Salvador', () => {
    assert.equal(macroHasSvCoverage('retail'), true);
  });
});
