/**
 * SOURCES-HN-CLOSE-1 — descubrimiento gratuito de Honduras: proveedoras del Estado
 * por industria (UNSPSC u objeto del gasto) y entidades públicas con web para
 * Gobierno. Lectura inyectada, sin red ni DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHnHonducomprasDirectoryDiscoveryAdapter,
  HN_HONDUCOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type HnHonducomprasDirectorySnapshotReadRow,
} from '../hn-honducompras-directory-discovery-adapter';
import { HN_HONDUCOMPRAS_MACRO_TABLE_VERSION, macroHasHnHonducomprasCoverage } from '../hn-honducompras-macro-table';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';
import type { CountrySourceCriteria } from '../country-source-types';

function row(overrides: Partial<HnHonducomprasDirectorySnapshotReadRow> = {}): HnHonducomprasDirectorySnapshotReadRow {
  return {
    record_identity_key: 'tax:08019003241539',
    rtn: '08019003241539',
    legal_name: 'TECNOLOGIA DE HONDURAS, S. DE R. L.',
    normalized_legal_name: 'TECNOLOGIA DE HONDURAS',
    city: 'DISTRITO CENTRAL',
    region: 'Francisco Morazan',
    directory_kind: 'honducompras_supplier',
    activity_code: '4321',
    website_domain: 'tecnologiadehonduras.com',
    awarded_hnl: 12_000_000,
    last_award_year: 2025,
    priority_score: 5_010,
    ...overrides,
  };
}

const criteria = (macroIndustryKey: string, limit = 10): CountrySourceCriteria =>
  ({ countryCode: 'HN', macroIndustryKey, limit }) as unknown as CountrySourceCriteria;

function adapterOver(rows: HnHonducomprasDirectorySnapshotReadRow[], calls: string[] = []) {
  return buildHnHonducomprasDirectoryDiscoveryAdapter({
    async readCompaniesByMacro({ macroIndustryKey }) {
      calls.push(macroIndustryKey);
      return rows;
    },
  });
}

describe('descubrimiento gratuito de Honduras', () => {
  it('ofrece la empresa con RTN, web, rubro en palabras y la macro de la tabla', async () => {
    const out = await adapterOver([row()])(criteria('technology'));
    assert.equal(out.sourceKey, HN_HONDUCOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(out.companies.length, 1);
    const [company] = out.companies;
    assert.equal(company.taxId, '08019003241539');
    assert.equal(company.taxIdentifierType, 'RTN');
    assert.equal(company.domain, 'tecnologiadehonduras.com');
    assert.ok(company.declaredIndustry);
    assert.deepEqual(company.officialMacroIndustry, {
      macroIndustryKeys: ['technology'],
      tableVersion: HN_HONDUCOMPRAS_MACRO_TABLE_VERSION,
    });
  });

  it('la tabla de HOY manda y la relevancia se vuelve a comprobar', async () => {
    const out = await adapterOver([
      row({ activity_code: '4321' }),
      row({ rtn: '08019003241540', record_identity_key: 'tax:08019003241540', awarded_hnl: 10_000 }),
      row({ rtn: '08019003241541', record_identity_key: 'tax:08019003241541', last_award_year: 2020 }),
      row({ rtn: '08011985123456', record_identity_key: 'tax:08011985123456' }),
    ])(criteria('retail'));
    assert.equal(out.companies.length, 0);
  });

  it('objeto del gasto de SIAFI clasifica a quien no tiene artículos UNSPSC', async () => {
    const out = await adapterOver([row({ directory_kind: 'siafi_supplier', activity_code: '47210' })])(criteria('property_construction'));
    assert.equal(out.companies.length, 1);
    assert.equal(out.companies[0].declaredIndustry, 'Construcción de obras públicas');
  });

  it('Gobierno: entidades con web, con o sin RTN, una por web', async () => {
    const entity = (id: string, name: string, domain: string | null, rtn: string | null = null) =>
      row({
        record_identity_key: `hn-oncae-ce:${id}`,
        rtn,
        legal_name: name,
        normalized_legal_name: name.toUpperCase(),
        directory_kind: 'public_entity',
        activity_code: null,
        website_domain: domain,
        awarded_hnl: null,
        last_award_year: null,
      });
    const out = await adapterOver([
      entity('a', 'Secretaría de Salud', 'salud.gob.hn'),
      entity('b', 'Universidad Nacional Autónoma de Honduras', 'unah.edu.hn', '08019995354420'),
      entity('c', 'Alcaldía Municipal de Atima', null),
      entity('d', 'Secretaria de Salud Pública', 'salud.gob.hn'),
    ])(criteria('government'));
    assert.deepEqual(out.companies.map((c) => c.legalName), ['Secretaría de Salud', 'Universidad Nacional Autónoma de Honduras']);
    assert.equal(out.companies[0].taxId, null);
    assert.equal(out.companies[0].taxIdentifierType, null);
    assert.equal(out.companies[1].taxId, '08019995354420');
    assert.equal(out.companies[0].declaredIndustry, 'Entidad pública');
  });

  it('una macro sin cobertura no consulta; el tope es 200', async () => {
    const calls: string[] = [];
    const empty = await adapterOver([row()], calls)(criteria('no_such_macro'));
    assert.equal(empty.companies.length, 0);
    assert.deepEqual(calls, []);
    await adapterOver([row()], calls)(criteria('technology', 10_000));
    assert.deepEqual(calls, ['technology']);
    assert.equal(macroHasHnHonducomprasCoverage('government'), true);
  });
});

describe('capacidad por país', () => {
  it('Honduras tiene fuente gratuita propia y los demás conservan la suya', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('HN'));
    assert.deepEqual(resolveCountrySourceCapability(' hn '), {
      countryCode: 'HN',
      sourceKey: HN_HONDUCOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY,
    });
    assert.equal(resolveCountrySourceCapability('GT')?.sourceKey, 'gt_guatecompras_directory_discovery');
    assert.equal(resolveCountrySourceCapability('PA'), null);
  });

  it('cobertura: UNSPSC, objeto del gasto y Gobierno', () => {
    for (const macro of ['government', 'technology', 'property_construction', 'health_pharma', 'energy_mining_environment']) {
      assert.equal(countrySourceMacroHasCoverage('HN', macro), true, macro);
    }
    assert.equal(countrySourceMacroHasCoverage('HN', 'no_such_macro'), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open hacia el pago)', () => {
    assert.equal(buildCountrySourceAdapter('HN', {}), null);
    assert.notEqual(
      buildCountrySourceAdapter('HN', { hnHonducomprasDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } }),
      null,
    );
  });
});
