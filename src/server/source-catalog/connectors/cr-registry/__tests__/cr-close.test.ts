/**
 * SOURCES-CR-CLOSE-1 — Costa Rica «estándar México»: núcleo por estructura,
 * alias, entidades públicas (cédulas 2…/4…), Zona Franca, SUGEF, siglas de
 * MIDEPLAN, tramo PYME del MEIC al filtro de tamaño y directorio gratuito por
 * industria. Filas con la forma real de los archivos oficiales. Sin red, sin DB,
 * sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  costaRicaCandidateNameVariants,
  costaRicaNameCore,
  costaRicaPublicEntityKey,
  currentCostaRicaName,
  formerCostaRicaNames,
} from '../cr-name-keys';
import { buildCrCompanyRegistry, type CrSourceRecords } from '../cr-company-registry-rows';
import {
  matchCrMideplanInstitutions,
  parseCrNamedCedulaListText,
  splitCrInstitutionAcronym,
} from '../cr-official-lists';
import {
  buildCrPublicEntityRow,
  buildCrSicopSupplierRow,
  buildCrZonaFrancaRow,
  costaRicaWebsiteDomain,
  extractCaecrActivities,
  mergeCrFreeDirectoryRows,
  type CrRegistryLookup,
} from '../cr-free-directory-row';
import { costaRicaSingleWordConfirmedByDomain, costaRicaWebAliasKey, registrableCostaRicaDomain } from '../cr-domain';
import { createCostaRicaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/costa-rica-official-source-resolver';
import { workforceFromRawData, CR_MEIC_BANDS } from '@/server/prospect-batches/snapshot-name-query';
import { DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY } from '@/server/agents/prospect-intake/source-enrichment';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';
import { resolveEmployeeSizeForIcpGate } from '@/server/agents/prospecting-toolkit/employee-size-resolver';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import {
  buildCrFreeDirectoryDiscoveryAdapter,
  CR_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type CrFreeDirectorySnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/cr-free-directory-discovery-adapter';
import {
  macroHasCrCoverage,
  resolveCrDirectoryMacro,
} from '@/server/prospect-batches/country-source-discovery/cr-free-directory-macro-table';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '@/server/prospect-batches/country-source-discovery/country-source-capability';

const params = { sourceYear: 2026, importedAt: '2026-10-06T00:00:00.000Z' };

describe('núcleo costarricense por estructura', () => {
  it('quita todas las escrituras de la forma societaria, sólo al final', () => {
    const cases: Array<[string, string]> = [
      ['3102741764 S.R.LTDA', '3102741764'],
      ['3-105-621623 E.I.R.L.', '3 105 621623'],
      ['COOCIQUE R.L.', 'COOCIQUE'],
      ['OVA COMMERCIAL LOGISTICS SOCIEDAD DE RESPONSABILIDAD LIMITADAILIDAD LIMITADA', 'OVA COMMERCIAL LOGISTICS'],
      ['ABINGTON INVESTMENTS INC SOCIEDAD ANONIMA.', 'ABINGTON INVESTMENTS'],
      ['ACOPIO Y RECICLAJE EL JOBO, SOCIEDAD CIVIL', 'ACOPIO Y RECICLAJE EL JOBO'],
      ['Holcim (Costa Rica) S. A.', 'HOLCIM COSTA RICA'],
      ['Banco Davivienda (Costa Rica) S.A.', 'BANCO DAVIVIENDA COSTA RICA'],
      ['DISTRIBUIDORA S.A. DE SAN JOSE', 'DISTRIBUIDORA S A DE SAN JOSE'],
      ['SOCIEDAD ANONIMA', 'SOCIEDAD ANONIMA'],
    ];
    for (const [raw, core] of cases) assert.equal(costaRicaNameCore(raw), core, raw);
  });

  it('el nombre actual corta «(antes …», «(fusionada con …» y las plantas de Zona Franca', () => {
    assert.equal(
      currentCostaRicaName('ACCENTURE S.R.L. (antes Avventa Worldwide, S.R.L., fusionada con ONPROCESS)'),
      'ACCENTURE S.R.L.',
    );
    assert.equal(
      currentCostaRicaName('BOSTON SCIENTIFIC DE COSTA RICA S.R.L. (fusionada con BAYLIS MEDICAL DE COSTA RICA SOCIEDA'),
      'BOSTON SCIENTIFIC DE COSTA RICA S.R.L.',
    );
    assert.equal(
      currentCostaRicaName('AMAZON SUPPORT SERVICES COSTA RICA S.R.L.    \n\nZF981647 - Planta satélite: Fuera de Parque'),
      'AMAZON SUPPORT SERVICES COSTA RICA S.R.L.',
    );
    assert.equal(currentCostaRicaName('X S.A. ZF981647 - Planta satélite'), 'X S.A.');
    assert.equal(
      currentCostaRicaName('COSTA RICA CONTACT CENTER CRCC, S.A. (se fusionó con Teleperformance Costa Rica SRL)'),
      'COSTA RICA CONTACT CENTER CRCC, S.A.',
    );
    assert.deepEqual(formerCostaRicaNames('Davibank (Costa Rica) S.A. (antes Scotiabank de Costa Rica S.A.)'), [
      'Scotiabank de Costa Rica S.A.',
    ]);
    assert.deepEqual(
      formerCostaRicaNames('ACCENTURE S.R.L. (antes Avventa Worldwide, S.R.L., fusionada con ONPROCESS)'),
      ['Avventa Worldwide, S.R.L.'],
    );
    assert.deepEqual(formerCostaRicaNames('PURDY MOTOR S.A.'), []);
  });

  it('clave de municipalidad y concejo municipal: la misma forma en los dos lados', () => {
    assert.equal(costaRicaPublicEntityKey('MUNICIPALIDAD DEL CANTON CENTRAL DE SAN JOSE'), 'MUNICIPALIDAD SAN JOSE');
    assert.equal(costaRicaPublicEntityKey('MUNICIPALIDAD DE SAN JOSE'), 'MUNICIPALIDAD SAN JOSE');
    assert.equal(costaRicaPublicEntityKey('MUNICIPALIDAD DEL CANTON DE SANTA ANA'), 'MUNICIPALIDAD SANTA ANA');
    assert.equal(costaRicaPublicEntityKey('MUNICIPALIDAD DE LA UNION'), 'MUNICIPALIDAD LA UNION');
    assert.equal(costaRicaPublicEntityKey('CONSEJO MUNICIPAL DE DISTRITO DE LEPANTO'), 'CONCEJO MUNICIPAL LEPANTO');
    assert.equal(costaRicaPublicEntityKey('PURDY MOTOR'), null);
  });

  it('variantes del candidato: con y sin «de Costa Rica», nunca «Banco» a secas', () => {
    const cores = (name: string) => costaRicaCandidateNameVariants(name).map((v) => v.core);
    assert.deepEqual(cores('Medtronic'), ['MEDTRONIC', 'MEDTRONIC DE COSTA RICA', 'MEDTRONIC COSTA RICA', 'MEDTRONIC CR']);
    assert.ok(cores('Holcim Costa Rica').includes('HOLCIM'));
    assert.ok(cores('Banco Promerica').includes('BANCO PROMERICA DE COSTA RICA'));
    assert.ok(!cores('Banco de Costa Rica').includes('BANCO'));
    assert.ok(cores('elangel.co.cr').includes('ELANGEL'));
    assert.ok(cores('Municipalidad de San José').includes('MUNICIPALIDAD SAN JOSE'));
    // Una entidad pública no se inventa «de Costa Rica».
    assert.ok(!cores('Ministerio de Salud').some((c) => c.endsWith('COSTA RICA')));
  });
});

describe('registro combinado', () => {
  const records: CrSourceRecords = {
    pymes: [
      { IDENTIFICACION: '3101052623', NOMBRE: 'PLASTICOS ZEBRA SOCIEDAD ANONIMA', TAMAÑO: 'Pequeña', PROVINCIA: 'SAN JOSE', 'ACTIVIDAD CIIU': '2220' },
      { IDENTIFICACION: '3102415369', NOMBRE: 'ACCENTURE LIMITADA', TAMAÑO: 'Mediana', PROVINCIA: 'HEREDIA', 'ACTIVIDAD CIIU': '8211' },
    ],
    zonaFranca: [
      {
        'CED. JURID.': '3-102-415369',
        Empresa: 'ACCENTURE S.R.L. (antes Avventa Worldwide, S.R.L., fusionada con NAVISITE)\n\nZF981852 - PARQUE',
      },
      { 'CED. JURID.': '3-101-018721', Empresa: 'ALIMENTOS PRO SALUD S.A. (antes SARDIMAR S.A.)' },
    ],
    sugef: [{ cedula: '3-101-046536', name: 'Davibank (Costa Rica) S.A. (antes Scotiabank de Costa Rica S.A.)' }],
    institutions: [
      { cedula: '4000042139', name: 'INSTITUTO COSTARRICENSE DE ELECTRICIDAD' },
      { cedula: '3014042058', name: 'MUNICIPALIDAD DEL CANTÓN CENTRAL DE SAN JOSÉ' },
      // Otra cédula cuyo NOMBRE PROPIO es «SARDIMAR»: el alias de Prosalud no puede pisarlo.
      { cedula: '3101999999', name: 'SARDIMAR' },
    ],
    acronymsByCedula: new Map([['4000042139', ['ICE']]]),
  };
  const { registry, aliases } = buildCrCompanyRegistry(records, params);
  const row = (cedula: string) => registry.find((r) => r.tax_id === cedula);
  const aliasKeys = (cedula: string) => aliases.filter((a) => a.tax_id === cedula).map((a) => a.normalized_legal_name);

  it('entes públicos con cédula 4… y municipalidades 3-014 entran', () => {
    assert.equal(row('4000042139')?.legal_name, 'INSTITUTO COSTARRICENSE DE ELECTRICIDAD');
    assert.equal(row('3014042058')?.raw_data.origin, 'sicop_institution');
  });

  it('Zona Franca pone el nombre; el tramo del MEIC viaja igual', () => {
    const accenture = row('3102415369');
    assert.equal(accenture?.legal_name, 'ACCENTURE S.R.L.');
    assert.equal(accenture?.normalized_legal_name, 'ACCENTURE');
    assert.deepEqual(accenture?.raw_data.origins, ['procomer_zona_franca', 'meic_pymes']);
    assert.equal(accenture?.raw_data.cr_meic_size, 'MEDIANA');
    assert.equal(accenture?.raw_data.cr_meic_size_year, 2025);
  });

  it('alias: nombre anterior, sigla oficial, clave de municipalidad; nunca el nombre propio de otra cédula', () => {
    assert.ok(aliasKeys('3102415369').includes('AVVENTA WORLDWIDE'));
    assert.ok(aliasKeys('3101046536').includes('SCOTIABANK DE COSTA RICA'));
    assert.ok(aliasKeys('4000042139').includes('ICE'));
    assert.ok(aliasKeys('3014042058').includes('MUNICIPALIDAD SAN JOSE'));
    assert.ok(!aliasKeys('3101018721').includes('SARDIMAR'));
    for (const alias of aliases) {
      assert.equal(alias.source_key, 'cr_company_name_alias');
      assert.match(String(alias.record_identity_key), /^cr-name-alias:/);
    }
  });

  it('fuentes de grano correcto', () => {
    assert.equal(getSourceFamily('cr_company_registry'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('cr_company_name_alias'), 'NATIVE_RECORD_GRAIN');
    assert.equal(getSourceFamily('cr_free_directory'), 'TAX_GRAIN');
  });
});

describe('listas oficiales en texto y MIDEPLAN', () => {
  const sugef = [
    '1.3 BANCOS PRIVADOS (Total: 10)  NG-1/ NG-2/',
    '1. Banco BAC San José S.A.',
    '3-101-012009',
    '10. Davibank (Costa Rica) S.A. (antes',
    'Scotiabank de Costa Rica S.A.)',
    '3-101-046536',
    '1. Banco de Costa Rica',
    '4-000-000019',
    'Instituto Nacional de Seguros   4-000-001902',
  ].join('\n');

  it('cédula en la línea siguiente, nombre en varias líneas o en la misma línea', () => {
    assert.deepEqual(parseCrNamedCedulaListText(sugef), [
      { cedula: '3101012009', name: 'Banco BAC San José S.A.' },
      { cedula: '3101046536', name: 'Davibank (Costa Rica) S.A. (antes Scotiabank de Costa Rica S.A.)' },
      { cedula: '4000000019', name: 'Banco de Costa Rica' },
      { cedula: '4000001902', name: 'Instituto Nacional de Seguros' },
    ]);
  });

  it('sigla oficial de MIDEPLAN y cruce por nombre exacto con la cédula', () => {
    assert.deepEqual(splitCrInstitutionAcronym('Instituto Costarricense de Electricidad (ICE)'), {
      name: 'Instituto Costarricense de Electricidad',
      acronym: 'ICE',
    });
    assert.deepEqual(splitCrInstitutionAcronym('Agencia de Protección de Datos de los Habitantes (Prodhab)').acronym, 'PRODHAB');
    assert.equal(splitCrInstitutionAcronym('Holcim (Costa Rica) S.A.').acronym, null);
    const matched = matchCrMideplanInstitutions(
      [
        { cedula: '4000042139', name: 'INSTITUTO COSTARRICENSE DE ELECTRICIDAD' },
        { cedula: '3014042058', name: 'MUNICIPALIDAD DEL CANTÓN CENTRAL DE SAN JOSÉ' },
      ],
      [
        { name: 'Instituto Costarricense de Electricidad (ICE)', web: 'https://www.grupoice.com/wps/portal' },
        { name: 'Municipalidad de San José', web: 'https://www.msj.go.cr' },
        { name: 'Ente sin cédula (ESC)', web: null },
      ],
    );
    assert.deepEqual(matched.get('4000042139'), { acronym: 'ICE', web: 'https://www.grupoice.com/wps/portal' });
    assert.deepEqual(matched.get('3014042058'), { acronym: null, web: 'https://www.msj.go.cr' });
    assert.equal(matched.size, 2);
  });
});

describe('dominios de Costa Rica', () => {
  it('dominio registrable y confirmación de una palabra', () => {
    assert.equal(registrableCostaRicaDomain('www.ice.go.cr'), 'ice.go.cr');
    assert.equal(registrableCostaRicaDomain('a.purdy.co.cr'), 'purdy.co.cr');
    assert.equal(costaRicaSingleWordConfirmedByDomain('ccss.sa.cr', 'CCSS', { publicEntity: true }), true);
    assert.equal(costaRicaSingleWordConfirmedByDomain('ccss.sa.cr', 'CCSS', { publicEntity: false }), false);
    assert.equal(costaRicaSingleWordConfirmedByDomain('https://www.medtronic.com', 'MEDTRONIC', { publicEntity: false }), true);
    assert.equal(costaRicaSingleWordConfirmedByDomain('gmail.com', 'GMAIL', { publicEntity: false }), false);
    assert.equal(costaRicaWebsiteDomain('https://www.grupoice.com/wps/portal'), 'grupoice.com');
    assert.equal(costaRicaWebsiteDomain('https://www.facebook.com/muni'), null);
  });
});

describe('resolvedor de cédula por nombre', () => {
  const { registry, aliases } = buildCrCompanyRegistry(
    {
      pymes: [
        { IDENTIFICACION: '3101052623', NOMBRE: 'PLASTICOS ZEBRA SOCIEDAD ANONIMA', TAMAÑO: 'Micro' },
        { IDENTIFICACION: '3101111111', NOMBRE: 'SERVICIOS ALFA S.A.', TAMAÑO: 'Micro' },
        { IDENTIFICACION: '3101222222', NOMBRE: 'SERVICIOS ALFA LIMITADA', TAMAÑO: 'Micro' },
      ],
      zonaFranca: [{ 'CED. JURID.': '3-101-211041', Empresa: 'MEDTRONIC COSTA RICA SOCIEDAD ANONIMA' }],
      institutions: [
        { cedula: '4000042147', name: 'CAJA COSTARRICENSE DE SEGURO SOCIAL' },
        { cedula: '3014042059', name: 'MUNICIPALIDAD DEL CANTÓN DE SANTA ANA' },
      ],
      acronymsByCedula: new Map([['4000042147', ['CCSS']]]),
    },
    params,
  );
  const rows = [...registry, ...aliases];
  const resolver = createCostaRicaOfficialSourceResolver({
    querySnapshots: async (core) =>
      rows
        .filter((r) => r.normalized_legal_name === core)
        .map((r) => ({
          taxId: r.tax_id,
          legalName: r.legal_name,
          normalizedLegalName: r.normalized_legal_name,
          workforce: workforceFromRawData(r.raw_data, 'cr_meic_pymes'),
          alias: r.source_key === 'cr_company_name_alias',
        })),
  });
  const resolve = (canonicalName: string, domain: string | null = null) =>
    resolver.resolve({
      candidate: { canonicalName, countryCode: 'CR', domain, websiteUrl: null },
      criteria: { countryCode: 'CR' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    } as unknown as OfficialSourceResolverInput);

  it('nombre con otra forma → cédula fuerte con el tramo del MEIC', async () => {
    const out = await resolve('Plásticos Zebra S.R.L.');
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '3101052623');
    assert.equal(out.taxIdentifierType, 'cedula_juridica');
    assert.deepEqual(out.workforce, { workers: 0, year: 2025, source: 'cr_meic_pymes', maxWorkers: 10, sizeBand: 'micro' });
  });

  it('entidad pública con cédula 4… y municipalidad por su clave', async () => {
    assert.equal((await resolve('Caja Costarricense de Seguro Social')).taxIdentifier, '4000042147');
    const muni = await resolve('Municipalidad de Santa Ana');
    assert.equal(muni.status, 'matched');
    assert.equal(muni.taxIdentifier, '3014042059');
  });

  it('una sigla sola sólo es segura si la web de la candidata la confirma', async () => {
    assert.equal((await resolve('CCSS', 'ccss.sa.cr')).status, 'matched');
    // Sin la web que la confirme, una sigla nunca da cédula segura (pista o nada).
    assert.notEqual((await resolve('CCSS', 'otro.com')).status, 'matched');
  });

  it('una palabra + «Costa Rica» añadido por la variante sigue siendo una palabra', async () => {
    const withoutWeb = await resolve('Medtronic');
    assert.equal(withoutWeb.status, 'low_confidence_match');
    assert.equal(withoutWeb.taxIdentifier, '3101211041');
    assert.equal((await resolve('Medtronic', 'medtronic.com')).status, 'matched');
    assert.equal((await resolve('Medtronic Costa Rica')).status, 'matched');
  });

  it('homónimos → pista, nunca cédula fuerte', async () => {
    const out = await resolve('Servicios Alfa');
    assert.equal(out.status, 'low_confidence_match');
  });

  it('no está → sin cédula; otro país → no aplica', async () => {
    assert.equal((await resolve('Empresa Inexistente del Pacífico')).status, 'not_found');
    assert.equal(
      resolver.canResolve({
        candidate: { canonicalName: 'Purdy Motor', countryCode: 'PA' },
        criteria: { countryCode: 'PA' },
      } as unknown as OfficialSourceResolverInput),
      false,
    );
  });
});

describe('tramo PYME del MEIC → filtro de tamaño (aprobado 06-10-2026)', () => {
  const gate = (size: string) => {
    const workforce = workforceFromRawData({ cr_meic_size: size, cr_meic_size_year: 2025 }, 'cr_meic_pymes');
    return resolveEmployeeSizeForIcpGate({
      threshold: 200,
      referenceYear: 2026,
      officialRegistryWorkforce: workforce
        ? { workers: workforce.workers, year: workforce.year, source: workforce.source, maxWorkers: workforce.maxWorkers, band: workforce.sizeBand }
        : null,
    });
  };

  it('micro (0-10) y pequeña (11-35) son pequeñas: el filtro las descarta', () => {
    assert.deepEqual(CR_MEIC_BANDS.MICRO, { min: 0, max: 10, label: 'micro' });
    assert.equal(gate('MICRO').icpInput.sizeRange, '0-10');
    assert.equal(gate('PEQUEÑA').icpInput.sizeRange, '11-35');
    assert.equal(gate('Pequeña').selectedSource, 'official_registry_workers');
  });

  it('mediana (36-100) no decide sola', () => {
    const out = gate('MEDIANA');
    assert.notEqual(out.selectedSource, 'official_registry_workers');
  });

  it('un tramo desconocido no inventa tamaño', () => {
    assert.equal(workforceFromRawData({ cr_meic_size: 'GRANDE', cr_meic_size_year: 2025 }, 'x'), null);
  });
});

describe('directorio gratuito', () => {
  const registry: CrRegistryLookup = (cedula) =>
    ({
      '3101005744': { legalName: 'PURDY MOTOR SOCIEDAD ANONIMA', meicSize: null },
      '3101363887': { legalName: 'CORPORACION QUIMISOL SOCIEDAD ANONIMA', meicSize: 'MICRO' },
      '3101083187': { legalName: 'RICOH COSTA RICA SOCIEDAD ANONIMA', meicSize: 'MEDIANA' },
    })[cedula] ?? null;

  it('proveedora de SICOP: nombre del registro, macro por UNSPSC (≥ 50 %), sin micro ni pequeñas', () => {
    const purdy = buildCrSicopSupplierRow({
      summary: { cedula: '3101005744', amountByFamily: { '2510': 900, '7818': 100 }, buyers: 120, offers: 3000, lastOfferYear: 2024 },
      registry,
      ...params,
    });
    assert.ok('row' in purdy);
    assert.equal(purdy.row.raw_data.macro_industry_key, 'retail');
    assert.equal(purdy.row.raw_data.activity_code, '2510');
    assert.equal(purdy.row.priority_score, 120 * 1000 + 300);
    assert.deepEqual(
      buildCrSicopSupplierRow({ summary: { cedula: '3101363887', amountByFamily: { '4321': 1 }, buyers: 200, offers: 1, lastOfferYear: 2024 }, registry, ...params }),
      { excluded: 'meic_small' },
    );
    assert.deepEqual(
      buildCrSicopSupplierRow({ summary: { cedula: '3101777777', amountByFamily: { '4321': 1 }, buyers: 2, offers: 1, lastOfferYear: 2024 }, registry, ...params }),
      { excluded: 'no_name' },
    );
    assert.deepEqual(
      buildCrSicopSupplierRow({ summary: { cedula: '3002042023', amountByFamily: { '8610': 1 }, buyers: 2, offers: 1, lastOfferYear: 2024 }, registry, ...params }),
      { excluded: 'not_prospect_company' },
    );
    const mixed = buildCrSicopSupplierRow({
      summary: { cedula: '3101083187', amountByFamily: { '4321': 40, '2510': 30, '8510': 30 }, buyers: 5, offers: 5, lastOfferYear: 2024 },
      registry,
      ...params,
    });
    assert.deepEqual(mixed, { excluded: 'no_dominant_macro' });
  });

  it('Zona Franca: actividad CAECR con la tabla CIIU aprobada; los parques van detrás', () => {
    assert.deepEqual(
      extractCaecrActivities('CAECR “8211 Actividades combinadas de servicios administrativos de oficina”, con …; CAECR "6201 Actividades de programación informática"'),
      [
        { code: '8211', label: 'Actividades combinadas de servicios administrativos de oficina' },
        { code: '6201', label: 'Actividades de programación informática' },
      ],
    );
    const zf = buildCrZonaFrancaRow({
      company: {
        cedula: '3-102-474379',
        name: 'AMAZON SUPPORT SERVICES COSTA RICA S.R.L.\n\nZF981647 - Planta satélite',
        activity: 'CAECR "6201 Actividades de programación informática"',
        companyType: 'EMPRESA DE SERVICIOS',
        canton: 'SAN JOSÉ',
        province: 'SAN JOSÉ',
      },
      registry,
      ...params,
    });
    assert.ok('row' in zf);
    assert.equal(zf.row.legal_name, 'AMAZON SUPPORT SERVICES COSTA RICA S.R.L.');
    assert.equal(zf.row.raw_data.macro_industry_key, 'technology');
    assert.equal(zf.row.raw_data.directory_kind, 'zona_franca');
    const park = buildCrZonaFrancaRow({
      company: { cedula: '3-101-742030', name: 'ZONA FRANCA DEL ESTE S.A.', activity: 'CAECR “6810 ACTIVIDADES INMOBILIARIAS”', companyType: 'ADMINISTRADORA DE PARQUES', canton: null, province: null },
      registry,
      ...params,
    });
    assert.ok('row' in park);
    assert.ok(park.row.priority_score < zf.row.priority_score);
    assert.deepEqual(
      buildCrZonaFrancaRow({ company: { cedula: '3-101-000001', name: 'X Y S.A.', activity: 'SIN CÓDIGO', companyType: null, canton: null, province: null }, registry, ...params }),
      { excluded: 'no_dominant_macro' },
    );
    // Una sociedad que se llama como su cédula no se propone.
    assert.deepEqual(
      buildCrZonaFrancaRow({ company: { cedula: '3-101-742029', name: '3-101-742029 SOCIEDAD ANONIMA', activity: 'CAECR “6201 Programación”', companyType: null, canton: null, province: null }, registry, ...params }),
      { excluded: 'numbered_name' },
    );
  });

  it('Zona Franca: manda la actividad productiva sobre la comercial de exportación; más plantas, más arriba', () => {
    const abbott = buildCrZonaFrancaRow({
      company: {
        cedula: '3-102-522153',
        name: 'ABBOTT MEDICAL COSTA RICA LIMITADA (antes St. Jude Medical Costa Rica Ltda.)\n\nZF900921 - Planta satélite\nZF900922 - Planta satélite',
        activity: 'CAECR"4690 Venta al por mayor de otros productos no especializada" … CAECR “6201 Actividades de programación informática” … CAECR “3250 Fabricación de instrumentos y suministros médicos y odontológicos”',
        companyType: 'Empresa comercial de exportación, empresa de servicios, y procesadora',
        canton: 'ALAJUELA',
        province: 'ALAJUELA',
      },
      registry,
      ...params,
    });
    assert.ok('row' in abbott);
    assert.equal(abbott.row.legal_name, 'ABBOTT MEDICAL COSTA RICA LIMITADA');
    assert.equal(abbott.row.raw_data.activity_code, '3250');
    assert.equal(abbott.row.raw_data.macro_industry_key, 'industry_manufacturing_chemicals_automotive');
    assert.equal(abbott.row.raw_data.plants, 3);
    const phillips = buildCrZonaFrancaRow({
      company: { cedula: '3-101-000002', name: 'CASA PROVEEDORA PHILLIPS, S.A. (Planta principal)', activity: 'CAECR "4690 Venta al por mayor"', companyType: 'COMERCIAL', canton: null, province: null },
      registry,
      ...params,
    });
    assert.ok('row' in phillips);
    assert.equal(phillips.row.legal_name, 'CASA PROVEEDORA PHILLIPS, S.A.');
    assert.equal(phillips.row.raw_data.macro_industry_key, 'retail');
    assert.ok(abbott.row.priority_score > phillips.row.priority_score);
  });

  it('entidad pública → Gobierno con la web de MIDEPLAN; asociaciones y fundaciones fuera', () => {
    const ice = buildCrPublicEntityRow({
      entity: { cedula: '4000042139', name: 'INSTITUTO COSTARRICENSE DE ELECTRICIDAD', purchaseRequests: 23507, website: 'https://www.grupoice.com/wps/portal', acronym: 'ICE' },
      ...params,
    });
    assert.ok('row' in ice);
    assert.equal(ice.row.raw_data.macro_industry_key, 'government');
    assert.equal(ice.row.raw_data.website_domain, 'grupoice.com');
    assert.deepEqual(
      buildCrPublicEntityRow({ entity: { cedula: '3002042023', name: 'ASOCIACION PRO HOSPITAL', purchaseRequests: 3 }, ...params }),
      { excluded: 'not_public_entity' },
    );
  });

  it('una fila por cédula: entidad pública > Zona Franca > SICOP', () => {
    const sicop = buildCrSicopSupplierRow({
      summary: { cedula: '3101005744', amountByFamily: { '2510': 1 }, buyers: 1, offers: 1, lastOfferYear: 2024 },
      registry,
      ...params,
    });
    const zf = buildCrZonaFrancaRow({
      company: { cedula: '3101005744', name: 'PURDY MOTOR S.A.', activity: 'CAECR "4510 Venta de vehículos"', companyType: 'COMERCIAL', canton: null, province: null },
      registry,
      ...params,
    });
    assert.ok('row' in sicop && 'row' in zf);
    const merged = mergeCrFreeDirectoryRows([sicop.row, zf.row]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].raw_data.directory_kind, 'zona_franca');
  });
});

describe('descubrimiento gratuito de Costa Rica', () => {
  const read = (overrides: Partial<CrFreeDirectorySnapshotReadRow>): CrFreeDirectorySnapshotReadRow => ({
    record_identity_key: `tax:${overrides.cedula ?? '3101005744'}`,
    cedula: '3101005744',
    legal_name: 'PURDY MOTOR SOCIEDAD ANONIMA',
    normalized_legal_name: 'PURDY MOTOR',
    city: null,
    region: null,
    directory_kind: 'sicop_supplier',
    activity_code: '2510',
    activity_text: null,
    website_domain: null,
    meic_size: null,
    priority_score: 1,
    ...overrides,
  });

  it('Costa Rica tiene fuente y cobertura por las tablas que reutiliza', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('CR'));
    assert.equal(resolveCountrySourceCapability('cr')?.sourceKey, CR_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    for (const macro of ['government', 'technology', 'retail', 'health_pharma', 'services_company']) {
      assert.equal(countrySourceMacroHasCoverage('CR', macro), true, macro);
      assert.equal(macroHasCrCoverage(macro), true, macro);
    }
    assert.equal(macroHasCrCoverage('no_such_macro'), false);
    assert.equal(resolveCrDirectoryMacro('public_entity', null), 'government');
    assert.equal(resolveCrDirectoryMacro('zona_franca', '6201'), 'technology');
    assert.equal(resolveCrDirectoryMacro('sicop_supplier', '2510'), 'retail');
    assert.equal(buildCountrySourceAdapter('CR', {}), null);
  });

  it('ofrece sólo la macro pedida (clasificación de hoy), una por cédula, sin micro ni pequeñas', async () => {
    const asked: Array<{ macroIndustryKey: string; limit: number }> = [];
    const adapter = buildCrFreeDirectoryDiscoveryAdapter({
      async readCompaniesByMacro(input) {
        asked.push(input);
        return [
          read({}),
          read({}),
          read({ cedula: '3101363887', meic_size: 'MICRO' }),
          read({ cedula: '3101083187', activity_code: '4321' }),
          read({ cedula: '4000042139', directory_kind: 'public_entity', activity_code: null }),
          read({ cedula: '0105230456' }),
        ];
      },
    });
    const out = await adapter({ countryCode: 'CR', macroIndustryKey: 'retail', limit: 999 } as never);
    assert.equal(out.sourceKey, CR_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.deepEqual(asked, [{ macroIndustryKey: 'retail', limit: 200 }]);
    assert.deepEqual(out.companies.map((c) => c.taxId), ['3101005744']);
    const purdy = out.companies[0];
    assert.equal(purdy.taxIdentifierType, 'cedula_juridica');
    assert.equal(purdy.countryCode, 'CR');
    assert.deepEqual(purdy.officialMacroIndustry?.macroIndustryKeys, ['retail']);
    assert.equal(typeof purdy.declaredIndustry, 'string');
  });

  it('Gobierno: entidades públicas con su web', async () => {
    const adapter = buildCrFreeDirectoryDiscoveryAdapter({
      async readCompaniesByMacro() {
        return [read({ cedula: '4000042139', legal_name: 'INSTITUTO COSTARRICENSE DE ELECTRICIDAD', directory_kind: 'public_entity', activity_code: null, activity_text: 'Sector público', website_domain: 'grupoice.com' })];
      },
    });
    const out = await adapter({ countryCode: 'CR', macroIndustryKey: 'government', limit: 10 } as never);
    assert.equal(out.companies[0]?.domain, 'grupoice.com');
    assert.equal(out.companies[0]?.declaredIndustry, 'Sector público');
  });

  it('una macro sin cobertura no consulta nada', async () => {
    let called = false;
    const adapter = buildCrFreeDirectoryDiscoveryAdapter({
      async readCompaniesByMacro() {
        called = true;
        return [];
      },
    });
    const out = await adapter({ countryCode: 'CR', macroIndustryKey: 'no_such_macro', limit: 10 } as never);
    assert.equal(called, false);
    assert.deepEqual(out.companies, []);
  });
});

describe('cédula por la web oficial de una entidad pública (corrida CR×Tec 07-10: «TEC» con tec.ac.cr)', () => {
  it('clave de alias por web: dominio propio, nunca un segundo nivel suelto ni una red social', () => {
    assert.equal(costaRicaWebAliasKey('https://www.tec.ac.cr/'), 'web:tec.ac.cr');
    assert.equal(costaRicaWebAliasKey('https://www.grupoice.com/wps/portal'), 'web:grupoice.com');
    assert.equal(costaRicaWebAliasKey('go.cr'), null);
    assert.equal(costaRicaWebAliasKey('https://www.facebook.com/muni'), null);
    assert.equal(costaRicaWebAliasKey(null), null);
  });

  const { registry, aliases } = buildCrCompanyRegistry(
    {
      institutions: [
        { cedula: '4000042145', name: 'INSTITUTO TECNOLÓGICO DE COSTA RICA' },
        { cedula: '2100042010', name: 'MINISTERIO DE SALUD' },
        { cedula: '3007999991', name: 'AUDITORIA GENERAL DE SERVICIOS DE SALUD' },
        { cedula: '3007999992', name: 'ENTE A' },
        { cedula: '3007999993', name: 'ENTE B' },
      ],
      websitesByCedula: new Map([
        ['4000042145', 'https://www.tec.ac.cr/'],
        // El órgano adscrito apunta a una página dentro de la web del ministerio.
        ['2100042010', 'https://www.ministeriodesalud.go.cr/'],
        ['3007999991', 'https://www.ministeriodesalud.go.cr/index.php/281-comisiones/1324-auditoria'],
        // Dos entes con la misma web en la raíz: no identifica a ninguno.
        ['3007999992', 'https://www.compartida.go.cr/'],
        ['3007999993', 'https://www.compartida.go.cr/'],
      ]),
    },
    params,
  );
  const owner = (key: string) => aliases.filter((a) => a.normalized_legal_name === key).map((a) => a.tax_id);

  it('la web identifica a su entidad; la compartida sólo a la que la tiene en la raíz', () => {
    assert.deepEqual(owner('web:tec.ac.cr'), ['4000042145']);
    assert.deepEqual(owner('web:ministeriodesalud.go.cr'), ['2100042010']);
    assert.deepEqual(owner('web:compartida.go.cr'), []);
  });

  const rows = [...registry, ...aliases];
  const resolver = createCostaRicaOfficialSourceResolver({
    querySnapshots: async (core) =>
      rows
        .filter((r) => r.normalized_legal_name === core)
        .map((r) => ({ taxId: r.tax_id, legalName: r.legal_name, normalizedLegalName: r.normalized_legal_name, alias: r.source_key === 'cr_company_name_alias' })),
  });
  const resolve = (canonicalName: string, domain: string | null) =>
    resolver.resolve({
      candidate: { canonicalName, countryCode: 'CR', domain, websiteUrl: null },
      criteria: { countryCode: 'CR' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    } as unknown as OfficialSourceResolverInput);

  it('«TEC» con tec.ac.cr → cédula del Instituto Tecnológico, por web', async () => {
    const out = await resolve('TEC', 'tec.ac.cr');
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '4000042145');
    assert.equal(out.matchMethod, 'domain');
    assert.deepEqual(out.safeMetadata, { matchedOfficialWebsite: 'tec.ac.cr' });
  });

  it('sin web o con otra web, el nombre sigue mandando', async () => {
    assert.equal((await resolve('TEC', 'otra.com')).status, 'not_found');
    assert.equal((await resolve('Instituto Tecnológico de Costa Rica', null)).taxIdentifier, '4000042145');
  });
});
