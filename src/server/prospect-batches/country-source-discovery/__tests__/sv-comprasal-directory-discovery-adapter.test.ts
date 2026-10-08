/**
 * SOURCES-SV-CLOSE-1 — descubrimiento gratuito de El Salvador: proveedoras de
 * COMPRASAL con NIT de Hacienda por industria (palabras del proceso) e instituciones
 * vigentes con web o NIT para Gobierno. Lectura inyectada, sin red ni DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSvComprasalDirectoryDiscoveryAdapter,
  SV_COMPRASAL_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type SvComprasalDirectorySnapshotReadRow,
} from '../sv-comprasal-directory-discovery-adapter';
import { macroHasSvCoverage, SV_COMPRASAL_MACRO_TABLE_VERSION } from '../sv-comprasal-macro-table';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';
import type { CountrySourceCriteria } from '../country-source-types';

function row(overrides: Partial<SvComprasalDirectorySnapshotReadRow> = {}): SvComprasalDirectorySnapshotReadRow {
  return {
    record_identity_key: 'tax:06142410901022',
    nit: '06142410901022',
    legal_name: '3M EL SALVADOR, S.A. DE C.V.',
    normalized_legal_name: '3M EL SALVADOR',
    city: null,
    region: null,
    directory_kind: 'comprasal_supplier',
    activity_code: 'medicamentos',
    website_domain: null,
    awarded_usd: 250_000,
    last_award_year: 2026,
    priority_score: 12_040,
    ...overrides,
  };
}

const criteria = (macroIndustryKey: string, limit = 10): CountrySourceCriteria =>
  ({ countryCode: 'SV', macroIndustryKey, limit }) as unknown as CountrySourceCriteria;

function adapterOver(rows: SvComprasalDirectorySnapshotReadRow[], calls: string[] = []) {
  return buildSvComprasalDirectoryDiscoveryAdapter({
    async readCompaniesByMacro({ macroIndustryKey }) {
      calls.push(macroIndustryKey);
      return rows;
    },
  });
}

describe('descubrimiento gratuito de El Salvador', () => {
  it('ofrece la empresa con NIT, sin web, rubro en palabras y la macro de la tabla', async () => {
    const out = await adapterOver([row()])(criteria('health_pharma'));
    assert.equal(out.sourceKey, SV_COMPRASAL_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(out.companies.length, 1);
    const [company] = out.companies;
    assert.equal(company.taxId, '06142410901022');
    assert.equal(company.taxIdentifierType, 'NIT');
    assert.equal(company.countryCode, 'SV');
    assert.equal(company.domain, null);
    assert.equal(company.declaredIndustry, 'Medicinas e insumos médicos');
    assert.deepEqual(company.officialMacroIndustry, { macroIndustryKeys: ['health_pharma'], tableVersion: SV_COMPRASAL_MACRO_TABLE_VERSION });
  });

  it('la tabla de HOY manda; relevancia y NIT se vuelven a comprobar', async () => {
    const out = await adapterOver([
      row({ activity_code: 'informatica' }),
      row({ nit: '06140506011033', record_identity_key: 'tax:06140506011033', awarded_usd: 10_000 }),
      row({ nit: '06140506011034', record_identity_key: 'tax:06140506011034' }),
      row({ nit: null, record_identity_key: 'x' }),
    ])(criteria('health_pharma'));
    assert.equal(out.companies.length, 0);
  });

  it('Gobierno: instituciones con web o NIT, una por NIT o web', async () => {
    const entity = (key: string, name: string, domain: string | null, nit: string | null = null) =>
      row({
        record_identity_key: `sv-public-entity:${key}`,
        nit,
        legal_name: name,
        normalized_legal_name: name.toUpperCase(),
        directory_kind: 'public_entity',
        activity_code: null,
        website_domain: domain,
        awarded_usd: null,
        last_award_year: null,
      });
    const out = await adapterOver([
      entity('MINISTERIO JUSTICIA SEGURIDAD PUBLICA', 'Ministerio de Justicia y Seguridad Publica', 'seguridad.gob.sv', '06140101071012'),
      entity('HOSPITAL NACIONAL ILOBASCO', 'Hospital Nacional de Ilobasco', null, '09031006961016'),
      entity('MUNICIPALIDAD CHALATENANGO NORTE', 'Municipalidad de Chalatenango Norte', null),
      entity('MINISTERIO JUSTICIA', 'Ministerio de Justicia', 'seguridad.gob.sv', '06140101071012'),
    ])(criteria('government'));
    assert.deepEqual(out.companies.map((c) => c.legalName), ['Ministerio de Justicia y Seguridad Publica', 'Hospital Nacional de Ilobasco']);
    assert.equal(out.companies[1].domain, null);
    assert.equal(out.companies[1].taxIdentifierType, 'NIT');
    assert.equal(out.companies[0].declaredIndustry, 'Entidad pública');
  });

  it('una macro sin cobertura no consulta; el tope es 200', async () => {
    const calls: string[] = [];
    const empty = await adapterOver([row()], calls)(criteria('retail'));
    assert.equal(empty.companies.length, 0);
    assert.deepEqual(calls, []);
    await adapterOver([row()], calls)(criteria('health_pharma', 10_000));
    assert.deepEqual(calls, ['health_pharma']);
    assert.equal(macroHasSvCoverage('government'), true);
  });
});

describe('capacidad por país', () => {
  it('El Salvador tiene fuente gratuita propia y los demás conservan la suya', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('SV'));
    assert.deepEqual(resolveCountrySourceCapability(' sv '), { countryCode: 'SV', sourceKey: SV_COMPRASAL_DIRECTORY_DISCOVERY_SOURCE_KEY });
    assert.equal(resolveCountrySourceCapability('HN')?.sourceKey, 'hn_honducompras_directory_discovery');
    assert.equal(resolveCountrySourceCapability('PA')?.sourceKey, 'pa_free_directory_discovery');
  });

  it('cobertura: palabras del proceso y Gobierno; sin regla de comercio, no hay Retail', () => {
    for (const macro of ['government', 'technology', 'property_construction', 'health_pharma', 'energy_mining_environment']) {
      assert.equal(countrySourceMacroHasCoverage('SV', macro), true, macro);
    }
    assert.equal(countrySourceMacroHasCoverage('SV', 'retail'), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open hacia el pago)', () => {
    assert.equal(buildCountrySourceAdapter('SV', {}), null);
    assert.notEqual(buildCountrySourceAdapter('SV', { svComprasalDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } }), null);
  });
});
