/**
 * SOURCES-ES-CLOSE-1 — descubrimiento gratuito de España: sociedades con NIF por
 * industria (INVENTE, Banco de España, «GRAN EMPRESA» de la BDNS, adjudicatarias de
 * 1 M€ o más) y entidades públicas con web para Gobierno. Lectura inyectada, sin
 * red ni DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEsFreeDirectoryDiscoveryAdapter,
  ES_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type EsFreeDirectorySnapshotReadRow,
} from '../es-free-directory-discovery-adapter';
import { ES_FREE_DIRECTORY_MACRO_TABLE_VERSION } from '../es-free-directory-macro-table';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';
import type { CountrySourceCriteria } from '../country-source-types';

function row(overrides: Partial<EsFreeDirectorySnapshotReadRow> = {}): EsFreeDirectorySnapshotReadRow {
  return {
    record_identity_key: 'tax:A28599033',
    nif: 'A28599033',
    legal_name: 'INDRA SOLUCIONES TECNOLOGÍAS DE LA INFORMACIÓN, S.L.U.',
    normalized_legal_name: 'INDRA SOLUCIONES TECNOLOGIAS DE LA INFORMACION',
    city: null,
    region: null,
    directory_kind: 'placsp_awardee',
    activity_code: '72000000',
    website_domain: null,
    awarded_eur: 2_500_000,
    workers: null,
    metrics_year: null,
    bdns_large_year: null,
    priority_score: 2_006,
    ...overrides,
  };
}

const criteria = (macroIndustryKey: string, limit = 10): CountrySourceCriteria =>
  ({ countryCode: 'ES', macroIndustryKey, limit }) as unknown as CountrySourceCriteria;

function adapterOver(rows: EsFreeDirectorySnapshotReadRow[], calls: string[] = []) {
  return buildEsFreeDirectoryDiscoveryAdapter({
    async readCompaniesByMacro({ macroIndustryKey }) {
      calls.push(macroIndustryKey);
      return rows;
    },
  });
}

describe('descubrimiento gratuito de España', () => {
  it('ofrece la adjudicataria con NIF, rubro y la macro de la tabla', async () => {
    const out = await adapterOver([row()])(criteria('technology'));
    assert.equal(out.sourceKey, ES_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(out.companies.length, 1);
    const [company] = out.companies;
    assert.equal(company.taxId, 'A28599033');
    assert.equal(company.taxIdentifierType, 'NIF');
    assert.equal(company.countryCode, 'ES');
    assert.equal(company.domain, null);
    assert.deepEqual(company.officialMacroIndustry, { macroIndustryKeys: ['technology'], tableVersion: ES_FREE_DIRECTORY_MACRO_TABLE_VERSION });
  });

  it('la tabla de HOY manda: otra macro no se ofrece; una adjudicataria bajo 1 M€ tampoco', async () => {
    assert.equal((await adapterOver([row()])(criteria('health_pharma'))).companies.length, 0);
    assert.equal((await adapterOver([row({ awarded_eur: 200_000 })])(criteria('technology'))).companies.length, 0);
  });

  it('«GRAN EMPRESA» de la BDNS viaja como tramo «grande»; la plantilla de INVENTE como número', async () => {
    const large = await adapterOver([row({ directory_kind: 'bdns_large', activity_code: '62', awarded_eur: null, bdns_large_year: 2025 })])(criteria('technology'));
    assert.deepEqual(large.companies[0].officialSizeBand, { band: 'large', sourceLabel: 'BDNS – Gran empresa' });
    assert.equal(large.companies[0].officialWorkforce, null);
    const ente = await adapterOver([
      row({ directory_kind: 'invente_company', activity_code: 'H5310', awarded_eur: null, workers: 45_000, metrics_year: 2024, website_domain: 'correos.es' }),
    ])(criteria('transport_logistics'));
    assert.deepEqual(ente.companies[0].officialWorkforce, { workers: 45_000, year: 2024, sourceLabel: 'INVENTE (Hacienda)' });
    assert.equal(ente.companies[0].officialSizeBand, undefined);
    assert.equal(ente.companies[0].domain, 'correos.es');
  });

  it('Gobierno: sólo entidades con web; un NIF, una empresa', async () => {
    const pub = (overrides: Partial<EsFreeDirectorySnapshotReadRow>) =>
      row({ directory_kind: 'public_entity', activity_code: null, awarded_eur: null, ...overrides });
    const out = await adapterOver([
      pub({ nif: 'P1607900F', record_identity_key: 'tax:P1607900F', legal_name: 'Ayuntamiento de Cuenca', website_domain: 'cuenca.es' }),
      pub({ nif: 'P1607900F', record_identity_key: 'tax:P1607900F', legal_name: 'Ayuntamiento de Cuenca', website_domain: 'cuenca.es' }),
      pub({ nif: 'Q2818014I', record_identity_key: 'tax:Q2818014I', legal_name: 'Sin web', website_domain: null }),
    ])(criteria('government'));
    assert.deepEqual(out.companies.map((c) => c.taxId), ['P1607900F']);
    assert.equal(out.companies[0].declaredIndustry, 'Entidad pública');
  });

  it('una macro sin cobertura no consulta', async () => {
    const calls: string[] = [];
    const out = await adapterOver([row()], calls)(criteria('no_existe'));
    assert.equal(out.companies.length, 0);
    assert.deepEqual(calls, []);
  });

  it('España está cableada en la capa gratuita', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('ES'));
    const capability = resolveCountrySourceCapability('ES');
    assert.equal(capability?.sourceKey, ES_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(countrySourceMacroHasCoverage('ES', 'technology'), true);
    const adapter = buildCountrySourceAdapter('ES', { esFreeDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } });
    assert.equal(typeof adapter, 'function');
    assert.equal(buildCountrySourceAdapter('ES', {}), null);
  });
});
