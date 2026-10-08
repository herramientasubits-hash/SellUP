/**
 * SOURCES-LATAM-CURATED-1 — capa común de listas curadas: unión entre listas,
 * macro por tipo de lista (educación privada → Servicios, decisión 08-10-2026),
 * suma detrás de la fuente del país sin repetir y traza de la fuente propia.
 * Sin red, sin DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLatamCuratedRows,
  normalizeLatamCuratedName,
  normalizeLatamCuratedTaxId,
  type LatamCuratedEntry,
} from '../latam-curated-rows';
import {
  resolveLatamCuratedMacro,
  resolveLatamCuratedSectorMacro,
} from '@/server/prospect-batches/country-source-discovery/latam-curated-macro-table';
import {
  buildLatamCuratedDiscoveryAdapter,
  latamCuratedRowToCompany,
  withLatamCuratedLayer,
  type LatamCuratedSnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/latam-curated-discovery-adapter';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
} from '@/server/prospect-batches/country-source-discovery/country-source-types';

const params = { sourceYear: 2026, importedAt: '2026-10-08T00:00:00.000Z' };

const entry = (overrides: Partial<LatamCuratedEntry> & Pick<LatamCuratedEntry, 'name' | 'list' | 'kind'>): LatamCuratedEntry => ({
  country: 'CO',
  list_label: overrides.list,
  ...overrides,
});

describe('nombre y número fiscal comparables', () => {
  it('quita tildes, signos y la forma societaria final', () => {
    assert.equal(normalizeLatamCuratedName('Pontificia Universidad Javeriana'), 'PONTIFICIA UNIVERSIDAD JAVERIANA');
    assert.equal(normalizeLatamCuratedName('Alicorp S.A.A.'), 'ALICORP');
    assert.equal(normalizeLatamCuratedName('Grupo Bimbo, S.A.B. de C.V.'), 'GRUPO BIMBO');
    assert.equal(normalizeLatamCuratedName('Bancolombia S.A.'), 'BANCOLOMBIA');
    assert.equal(normalizeLatamCuratedName('Johnson & Johnson'), 'JOHNSON Y JOHNSON');
  });

  it('deja sólo dígitos y el dígito K del RUT', () => {
    assert.equal(normalizeLatamCuratedTaxId('860.007.738-9'), '8600077389');
    assert.equal(normalizeLatamCuratedTaxId('96.505.760-K'), '96505760K');
    assert.equal(normalizeLatamCuratedTaxId('abc'), null);
  });

  it('una web sin dominio real («http://ND») no cuenta', () => {
    const { rows } = buildLatamCuratedRows(
      [entry({ list: 'ec_direx', kind: 'exporter', name: 'Exportadora', sector: 'PESCA', website: 'http://ND' })],
      params,
    );
    assert.equal(rows[0].raw_data.website_domain, undefined);
  });
});

describe('macro de la capa curada', () => {
  it('educación: pública → Gobierno, privada → Servicios', () => {
    assert.equal(resolveLatamCuratedMacro({ kind: 'university', isPublic: true }), 'government');
    assert.equal(resolveLatamCuratedMacro({ kind: 'university', isPublic: false }), 'services_company');
    assert.equal(resolveLatamCuratedMacro({ kind: 'school', isPublic: null }), 'services_company');
  });

  it('reguladores: la lista dice qué es la entidad', () => {
    assert.equal(resolveLatamCuratedMacro({ kind: 'insurer' }), 'insurance_financial_services');
    assert.equal(resolveLatamCuratedMacro({ kind: 'bank' }), 'insurance_financial_services');
    assert.equal(resolveLatamCuratedMacro({ kind: 'health_provider' }), 'health_pharma');
  });

  it('rankings y emisores: manda el sector, en inglés o en español', () => {
    assert.equal(resolveLatamCuratedSectorMacro('Software & Computer Services'), 'technology');
    assert.equal(resolveLatamCuratedSectorMacro('Banks'), 'insurance_financial_services');
    assert.equal(resolveLatamCuratedSectorMacro('Industria alimentaria'), 'consumer_goods');
    assert.equal(resolveLatamCuratedMacro({ kind: 'ranking', sector: 'Construcción' }), 'property_construction');
    assert.equal(resolveLatamCuratedMacro({ kind: 'ranking', sector: null }), null);
  });

  it('sectores cortos de los rankings (Merco): primera regla que acierta', () => {
    const cases: Array<[string, string | null]> = [
      ['BANCARIO', 'insurance_financial_services'],
      ['CEMENTERAS', 'industry_manufacturing_chemicals_automotive'],
      ['TRANSPORTE DE VIAJEROS', 'transport_logistics'],
      ['CADENA DE FARMACIAS', 'retail'],
      ['FARMACÉUTICO', 'health_pharma'],
      ['EDUCACIÓN SUPERIOR', 'services_company'],
      ['AGROINDUSTRIAL', 'agroindustry'],
      ['ALIMENTACIÓN Y BEBIDAS', 'consumer_goods'],
      ['SUPERMERCADOS / DISTRIBUCIÓN DE ALIMENTOS', 'retail'],
      ['TELECOMUNICACIONES', 'technology'],
      ['HOTELERÍA', null],
      ['MEDIOS DE COMUNICACIÓN', null],
      ['HOLDING', null],
    ];
    for (const [sector, macro] of cases) assert.equal(resolveLatamCuratedSectorMacro(sector), macro, sector);
  });

  it('Pro Ecuador: sector cerrado, cuenta el primero; servicios y artesanías sin macro', () => {
    assert.equal(resolveLatamCuratedSectorMacro('FLORES Y PLANTAS'), 'agroindustry');
    assert.equal(resolveLatamCuratedSectorMacro('ALIMENTOS PROCESADOS,BANANO Y PLATANO'), 'consumer_goods');
    assert.equal(resolveLatamCuratedSectorMacro('PLASTICOS'), 'industry_manufacturing_chemicals_automotive');
    assert.equal(resolveLatamCuratedSectorMacro('SERVICIOS'), null);
    assert.equal(resolveLatamCuratedSectorMacro('ARTESANIAS'), null);
  });
});

describe('filas de la capa curada', () => {
  it('une la misma entidad de dos listas en una fila con ambos orígenes', () => {
    const { rows } = buildLatamCuratedRows(
      [
        entry({ list: 'co_snies', list_label: 'SNIES', kind: 'university', is_public: false, name: 'Universidad de los Andes', tax_id: '860.007.386-1', website: 'https://uniandes.edu.co' }),
        entry({ list: 'merco_co_2025', list_label: 'Merco Empresas 2025', kind: 'ranking', name: 'Universidad de los Andes', size_large: true }),
      ],
      params,
    );
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.normalized_tax_id, '8600073861');
    assert.equal(row.raw_data.macro_industry_key, 'services_company');
    assert.equal(row.raw_data.website_domain, 'uniandes.edu.co');
    assert.equal(row.raw_data.official_size_band, 'large');
    assert.deepEqual((row.raw_data.origins as { list: string }[]).map((o) => o.list), ['co_snies', 'merco_co_2025']);
    assert.ok(row.record_identity_key);
  });

  it('deja fuera lo que no tiene macro ni por tipo ni por sector', () => {
    const { rows, excluded } = buildLatamCuratedRows(
      [entry({ list: 'merco_co_2025', kind: 'ranking', name: 'Empresa Sin Sector' })],
      params,
    );
    assert.equal(rows.length, 0);
    assert.equal(excluded.no_macro, 1);
  });

  it('ignora entradas sin país válido o sin nombre', () => {
    const { rows } = buildLatamCuratedRows(
      [
        entry({ list: 'x', kind: 'bank', name: '' }),
        { ...entry({ list: 'x', kind: 'bank', name: 'Banco Uno' }), country: 'Colombia' },
      ],
      params,
    );
    assert.equal(rows.length, 0);
  });
});

const read = (overrides: Partial<LatamCuratedSnapshotReadRow> = {}): LatamCuratedSnapshotReadRow => ({
  record_identity_key: 'k-andes',
  tax_id: '860007386-1',
  tax_type: 'NIT',
  legal_name: 'Universidad de los Andes',
  normalized_legal_name: 'UNIVERSIDAD DE LOS ANDES',
  city: 'Bogotá',
  region: null,
  kind: 'university',
  is_public: false,
  sector: null,
  website_domain: 'uniandes.edu.co',
  official_size_band: 'large',
  official_size_source: 'Merco Empresas 2025',
  workers: null,
  origin_labels: ['SNIES', 'Merco Empresas 2025'],
  ...overrides,
});

describe('adaptador de la capa curada', () => {
  it('convierte la fila con macro oficial, web, tamaño grande y su propia fuente', () => {
    const company = latamCuratedRowToCompany(read(), 'CO', 'services_company');
    assert.ok(company);
    assert.equal(company.domain, 'uniandes.edu.co');
    assert.equal(company.taxIdentifierType, 'NIT');
    assert.deepEqual(company.officialMacroIndustry?.macroIndustryKeys, ['services_company']);
    assert.equal(company.officialSizeBand?.band, 'large');
    assert.equal(company.originSourceKey, 'latam_curated_directory');
    assert.equal(company.declaredIndustry, 'Educación superior');
  });

  it('no devuelve la fila en otra macro (la clasificación de hoy manda)', () => {
    assert.equal(latamCuratedRowToCompany(read(), 'CO', 'technology'), null);
  });

  it('sin número fiscal: queda para que el registro oficial lo ponga por nombre', () => {
    const company = latamCuratedRowToCompany(read({ tax_id: null }), 'CO', 'services_company');
    assert.equal(company?.taxId, null);
    assert.equal(company?.taxIdentifierType, null);
  });

  it('lee por país y macro con el tope', async () => {
    const asked: unknown[] = [];
    const adapter = buildLatamCuratedDiscoveryAdapter({
      readByCountryAndMacro: async (input) => {
        asked.push(input);
        return [read()];
      },
    });
    const out = await adapter({ countryCode: 'co', macroIndustryKey: 'services_company', limit: 999 });
    assert.deepEqual(asked, [{ countryCode: 'CO', macroIndustryKey: 'services_company', limit: 100 }]);
    assert.equal(out.companies.length, 1);
  });
});

const company = (taxId: string | null, name: string): CountrySourceCompany => ({
  recordIdentityKey: `k-${name}`,
  legalName: name,
  normalizedLegalName: name.toUpperCase(),
  taxId,
  taxIdentifierType: taxId ? 'NIT' : null,
  countryCode: 'CO',
  city: null,
  region: null,
  domain: null,
  declaredIndustry: null,
  industryCode: null,
  coarseSector: null,
});

describe('suma de la capa curada a la fuente del país', () => {
  const primary: CountrySourceAdapter = async () => ({
    sourceKey: 'co_siis_discovery',
    companies: [company('8600073861', 'Universidad de los Andes'), company('900000001', 'Otra')],
    recordsRead: 2,
  });

  it('pone lo del país primero y agrega sólo lo curado que el país no trajo', async () => {
    const curated: CountrySourceAdapter = async () => ({
      sourceKey: 'latam_curated_directory',
      companies: [
        { ...company('860007386-1', 'Universidad de los Andes'), originSourceKey: 'latam_curated_directory' },
        { ...company(null, 'Universidad Nueva'), originSourceKey: 'latam_curated_directory' },
      ],
      recordsRead: 2,
    });
    const out = await withLatamCuratedLayer(primary, curated)({ countryCode: 'CO', macroIndustryKey: 'services_company', limit: 10 });
    assert.equal(out.sourceKey, 'co_siis_discovery');
    assert.deepEqual(out.companies.map((c) => c.legalName), ['Universidad de los Andes', 'Otra', 'Universidad Nueva']);
    assert.equal(out.companies[2].originSourceKey, 'latam_curated_directory');
  });

  it('si falla lo curado, devuelve lo del país', async () => {
    const curated: CountrySourceAdapter = async () => {
      throw new Error('db down');
    };
    const out = await withLatamCuratedLayer(primary, curated)({ countryCode: 'CO', macroIndustryKey: 'services_company', limit: 10 });
    assert.equal(out.companies.length, 2);
  });

  it('si falla el país, falla igual que antes', async () => {
    const broken: CountrySourceAdapter = async () => {
      throw new Error('source down');
    };
    const curated: CountrySourceAdapter = async () => ({ sourceKey: 'latam_curated_directory', companies: [], recordsRead: 0 });
    await assert.rejects(withLatamCuratedLayer(broken, curated)({ countryCode: 'CO', macroIndustryKey: 'x', limit: 1 }));
  });
});

describe('Catálogo de fuentes', () => {
  it('latam_curated_directory: capa gratuita conectada, snapshot, sin tocar la puntuación', () => {
    const s = CATALOG_SOURCES.find((source) => source.key === 'latam_curated_directory');
    assert.ok(s);
    assert.equal(s.aiFlowStatus, 'connected_free_discovery');
    assert.equal(s.connectionMode, 'read_only_snapshot');
    assert.ok(s.countryCodes.includes('CO') && s.countryCodes.includes('MX'));
    for (const country of s.countryCodes) {
      const context = getCatalogContext({ countryCode: country, industry: '' } as never);
      const keys = (context.recommendedSources ?? []).map((r: { key: string }) => r.key);
      assert.ok(!keys.includes('latam_curated_directory'), country);
    }
  });
});
