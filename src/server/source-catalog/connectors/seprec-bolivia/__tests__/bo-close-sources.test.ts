/**
 * SOURCES-BO-CLOSE-1 — Bolivia: núcleo del nombre, web que confirma la marca, lista
 * de grandes contribuyentes y entidades públicas de gob.bo.
 *
 * Nombres y NIT tal como los devolvió el SEPREC el 06-10 (razones sociales públicas
 * del registro de comercio). Cero E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  boliviaDomainConfirmsName,
  boliviaDomainLabel,
  boliviaLegalNameAliases,
  boliviaNameCarriesLegalForm,
  boliviaWebsiteHost,
  normalizeBoliviaCompanyCore,
} from '../bo-company-name-core';
import { isBoliviaPublicEntityName } from '../seprec-name-live-query';
import {
  buildBoLargeTaxpayerRow,
  buildBoLargeTaxpayerRows,
  isBoliviaCompanyNit,
  type BoSeprecCrawlRecord,
} from '../../sin-bolivia/bo-large-taxpayer-rows';
import {
  boPublicEntityDomain,
  buildBoPublicEntityRows,
  classifyBoPublicEntityKind,
  normalizeBoliviaPublicEntityCore,
  parseGobBoEntityPage,
  type GobBoEntity,
} from '../../gob-bo/bo-public-entity-rows';
import {
  BO_ACTIVITY_RULES,
  boCiiuMacro,
  classifyBoliviaActivity,
  macroHasBoCoverage,
} from '@/server/prospect-batches/country-source-discovery/bo-activity-macro-table';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import { getSourceFamily } from '@/server/source-catalog/record-identity';

describe('núcleo del nombre boliviano: la forma societaria por su estructura', () => {
  const cases: [string, string][] = [
    ['CERVECERIA BOLIVIANA NACIONAL S.A.', 'CERVECERIA BOLIVIANA NACIONAL'],
    ['BOLIVIAN EXPRESS CARGO S.R.L.', 'BOLIVIAN EXPRESS CARGO'],
    ['Opecebol S. R. L.', 'OPECEBOL'],
    ['DATEC LTDA.', 'DATEC'],
    ['JOFRASA LIMITADA', 'JOFRASA'],
    ['SINTESIS SOCIEDAD ANONIMA', 'SINTESIS'],
    ['PAPELERA TISSU SOCIEDAD DE RESPONSABILIDAD LIMITADA', 'PAPELERA TISSU'],
    ['EMPRESA MIXTA S.A.M.', 'EMPRESA MIXTA'],
    ['Credifondo SAFI', 'CREDIFONDO'],
    ['CREDIFONDO SOCIEDAD ADMINISTRADORA DE FONDOS DE INVERSION S.A.', 'CREDIFONDO'],
    ['Fondo Alfa S.A.F.I.', 'FONDO ALFA'],
    ['"SOLUCREDIT S.R.L."', 'SOLUCREDIT'],
    // la forma EN MEDIO corta el nombre: lo de detrás es descripción o sigla
    ['DAPIBOL S.A. AGENCIA DESPACHANTE DE ADUANA', 'DAPIBOL'],
    ['ALMACENES PACIFICO SUR S.A.  ALPASUR', 'ALMACENES PACIFICO SUR'],
    ['3M CHILE S.A. SUCURSAL BOLIVIA', '3M CHILE'],
    ['COGNOS SOLUCIONES & SERVICIOS S.R.L. COGNOS S & S S.R.L.', 'COGNOS SOLUCIONES & SERVICIOS'],
    // la sigla entre paréntesis acompaña al nombre
    ['TELEFONICA CELULAR DE BOLIVIA (TELECEL) S.A.', 'TELEFONICA CELULAR DE BOLIVIA'],
    // web y país pegados por el proveedor
    ['Cognos.com.bo', 'COGNOS'],
    ['www.intersoft.com.bo', 'INTERSOFT'],
    ['Get Server Bolivia', 'GET SERVER'],
    ['KÄRCHER BOLIVIA S.R.L.', 'KARCHER'],
    ['Datec Corp', 'DATEC'],
    // «de Bolivia» es parte del nombre
    ['Banco Central de Bolivia', 'BANCO CENTRAL DE BOLIVIA'],
    ['Bolivia', 'BOLIVIA'],
    ['S.A.', 'S A'],
  ];
  for (const [raw, core] of cases) {
    it(`${raw} → ${core}`, () => assert.equal(normalizeBoliviaCompanyCore(raw), core));
  }

  it('lo mismo a los dos lados: candidata y razón social dan el mismo núcleo', () => {
    assert.equal(normalizeBoliviaCompanyCore('Credifondo SAFI'), normalizeBoliviaCompanyCore('CREDIFONDO SOCIEDAD ADMINISTRADORA DE FONDOS DE INVERSION S.A.'));
    assert.equal(normalizeBoliviaCompanyCore('Dapibol S.A.'), normalizeBoliviaCompanyCore('DAPIBOL S.A. AGENCIA DESPACHANTE DE ADUANA'));
  });

  it('forma societaria de verdad (no la web, el país ni «Corp»)', () => {
    for (const name of ['Datec Ltda.', 'Opecebol S. R. L.', 'Dapibol S.A. Agencia Despachante', 'Credifondo SAFI', 'Sintesis Sociedad Anónima']) {
      assert.equal(boliviaNameCarriesLegalForm(name), true, name);
    }
    for (const name of ['Cognos.com.bo', 'Get Server Bolivia', 'Datec Corp', 'Intersoft', 'SA']) {
      assert.equal(boliviaNameCarriesLegalForm(name), false, name);
    }
  });

  it('sigla detrás de la forma o entre paréntesis → clave secundaria', () => {
    assert.deepEqual(boliviaLegalNameAliases('ALMACENES PACIFICO SUR S.A.  ALPASUR'), ['ALPASUR']);
    assert.deepEqual(boliviaLegalNameAliases('TELEFONICA CELULAR DE BOLIVIA (TELECEL) S.A.'), ['TELECEL']);
    assert.deepEqual(boliviaLegalNameAliases('DATEC LTDA.'), []);
  });
});

describe('la web propia confirma la marca', () => {
  it('etiqueta del dominio', () => {
    assert.equal(boliviaWebsiteHost('https://www.getserver.com.bo/contacto'), 'getserver.com.bo');
    assert.equal(boliviaDomainLabel('cognos.com.bo'), 'cognos');
    assert.equal(boliviaDomainLabel('dapibol.com'), 'dapibol');
    assert.equal(boliviaDomainLabel('lbc.bo'), 'lbc');
  });

  it('confirma: misma palabra, o con la forma o el país pegados', () => {
    assert.equal(boliviaDomainConfirmsName('datec.com.bo', 'DATEC'), true);
    assert.equal(boliviaDomainConfirmsName('alpasur.com.bo', 'ALPASUR'), true);
    assert.equal(boliviaDomainConfirmsName('https://www.getserver.com.bo/', 'GET SERVER'), true);
    assert.equal(boliviaDomainConfirmsName('credifondosafi.com.bo', 'CREDIFONDO'), true);
    assert.equal(boliviaDomainConfirmsName('digitalharborbolivia.com', 'DIGITAL HARBOR'), true);
  });

  it('no confirma: otra palabra, dominios del Estado o de plataformas, palabras muy cortas', () => {
    assert.equal(boliviaDomainConfirmsName('infinitysoftwarebolivia.com', 'INFINITYSOFT'), false);
    assert.equal(boliviaDomainConfirmsName('entel.gob.bo', 'ENTEL'), false);
    assert.equal(boliviaDomainConfirmsName('facebook.com', 'FACEBOOK'), false);
    assert.equal(boliviaDomainConfirmsName('ab.bo', 'AB'), false);
    assert.equal(boliviaDomainConfirmsName(null, 'DATEC'), false);
  });
});

describe('entidades públicas: el SEPREC no se consulta', () => {
  it('reconoce los nombres del Estado', () => {
    for (const name of ['Caja Nacional de Salud', 'Caja de Salud de Caminos Y R.A.', 'Gobierno Autónomo Municipal de La Paz', 'Ministerio de Salud y Deportes', 'Universidad Mayor de San Andrés']) {
      assert.equal(isBoliviaPublicEntityName(normalizeBoliviaCompanyCore(name)), true, name);
    }
    for (const name of ['Banco Mercantil Santa Cruz', 'Cervecería Boliviana Nacional', 'Clínica Alemana']) {
      assert.equal(isBoliviaPublicEntityName(normalizeBoliviaCompanyCore(name)), false, name);
    }
  });
});

describe('tabla de industrias por palabras (borrador para aprobar)', () => {
  it('la razón social manda sobre el objeto social', () => {
    const c = classifyBoliviaActivity('EMPRESA CONSTRUCTORA GISHAY S.R.L.', 'IMPORTACION Y COMERCIALIZACION DE EQUIPOS');
    assert.equal(c.macroIndustryKey, 'property_construction');
    assert.equal(c.basis, 'legal_name');
  });

  it('sin palabra de sector en el nombre, el comienzo del objeto social', () => {
    const c = classifyBoliviaActivity('GARO BOLIVIA S.R.L.', 'SERVICIOS DE TELECOMUNICACIONES, CONSTRUCCIONES, AMPLIACIONES');
    assert.equal(c.macroIndustryKey, 'technology');
    assert.equal(c.basis, 'social_purpose');
  });

  it('palabras pegadas de la escritura transcrita', () => {
    assert.equal(classifyBoliviaActivity('FARMEDICAL S.R.L.', 'VENTA AL POR MAYOR DE COMPUESTOS Y PRODUCTOSFARMACEUTICOS').macroIndustryKey, 'health_pharma');
  });

  it('«a cargo de» en el objeto social no es transporte; «CARGO» en el nombre sí', () => {
    assert.notEqual(classifyBoliviaActivity('ALFA S.R.L.', 'ADMINISTRACION A CARGO DE LOS SOCIOS').macroIndustryKey, 'transport_logistics');
    assert.equal(classifyBoliviaActivity('BOLIVIAN EXPRESS CARGO S.R.L.', null).macroIndustryKey, 'transport_logistics');
  });

  it('hoteles, educación y medios no tienen macro (igual que Argentina)', () => {
    assert.equal(classifyBoliviaActivity('EMPRESA HOTELERA CALACOTO LTDA.', 'HOTELERA').macroIndustryKey, null);
    assert.equal(classifyBoliviaActivity('INSTITUTO TECNICO DE EXCELENCIA S.R.L.', 'FORMACION EDUCATIVA').macroIndustryKey, null);
  });

  it('comercio general → Retail; farmacias → Salud; integradores → Tecnología (tabla AR v2)', () => {
    assert.equal(classifyBoliviaActivity('HERGO LTDA.', 'IMPORTACION Y COMERCIALIZACION DE PRODUCTOS').macroIndustryKey, 'retail');
    assert.equal(classifyBoliviaActivity('FARMACIA OKINAWA S.R.L.', null).macroIndustryKey, 'health_pharma');
    assert.equal(boCiiuMacro('4651'), 'technology');
    assert.equal(boCiiuMacro('46'), 'retail');
  });

  it('objeto social genérico sin palabra de sector → sin macro (no se ofrece)', () => {
    assert.equal(classifyBoliviaActivity('KAOBA S.R.L.', 'ACTOS Y OPERACIONES DE COMERCIO EN FORMA GENERAL').macroIndustryKey, null);
  });

  it('cada regla con macro apunta a una macro existente; cobertura', () => {
    for (const rule of BO_ACTIVITY_RULES) {
      if (rule.ciiu !== null) assert.notEqual(boCiiuMacro(rule.ciiu), null, rule.label);
    }
    assert.equal(macroHasBoCoverage('technology'), true);
    assert.equal(macroHasBoCoverage('no_existe'), false);
  });
});

const record = (overrides: Partial<BoSeprecCrawlRecord> = {}): BoSeprecCrawlRecord => ({
  nit: '1028269024',
  flags: ['graco'],
  found: true,
  legalName: 'HORMIPRET S.R.L.',
  status: 'ACTIVO',
  unitTypeCode: '04',
  unitType: 'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  renewalCode: '0',
  department: 'SANTA CRUZ',
  detailStatus: 200,
  detailNit: '1028269024',
  socialPurpose: 'FABRICACION DE HORMIGON PREMEZCLADO Y PREFABRICADOS',
  lastUpdateYear: '2025',
  ...overrides,
});

describe('lista de grandes contribuyentes (bo_large_taxpayers)', () => {
  it('una fila por NIT, con núcleo, categoría, macro y año de la categorización', () => {
    const result = buildBoLargeTaxpayerRow(record());
    assert.ok('row' in result);
    const row = result.row;
    assert.equal(row.record_identity_key, 'tax:1028269024');
    assert.equal(row.normalized_legal_name, 'HORMIPRET');
    assert.equal(row.raw_data.taxpayer_category, 'GRACO');
    assert.equal(row.raw_data.metrics_year, 2025);
    assert.equal(row.raw_data.macro_industry_key, 'industry_manufacturing_chemicals_automotive');
    assert.equal(row.raw_data.matricula_renewed, true);
    assert.equal(row.department, 'SANTA CRUZ');
    assert.equal(getSourceFamily(row.source_key), 'TAX_GRAIN');
  });

  it('PRICO pesa más que GRACO; las listas de la Aduana suman', () => {
    const prico = buildBoLargeTaxpayerRow(record({ flags: ['prico', 'prio'] }));
    const graco = buildBoLargeTaxpayerRow(record());
    assert.ok('row' in prico && 'row' in graco);
    assert.equal(prico.row.raw_data.taxpayer_category, 'PRICO');
    assert.deepEqual(prico.row.raw_data.lists, ['prico', 'prio']);
    assert.ok(prico.row.priority_score > graco.row.priority_score);
  });

  it('matrícula no renovada: entra (vale para el NIT por nombre) marcada como no renovada', () => {
    const result = buildBoLargeTaxpayerRow(record({ renewalCode: '1', detailStatus: 412, detailNit: null, socialPurpose: null }));
    assert.ok('row' in result);
    assert.equal(result.row.raw_data.matricula_renewed, false);
  });

  it('fuera: personas, unipersonales, inactivas, no encontradas y NIT que la ficha contradice', () => {
    assert.deepEqual(buildBoLargeTaxpayerRow(record({ nit: '4923220013' })), { skip: 'not_a_company_nit' });
    assert.deepEqual(buildBoLargeTaxpayerRow(record({ unitTypeCode: '01' })), { skip: 'sole_trader' });
    assert.deepEqual(buildBoLargeTaxpayerRow(record({ status: 'INACTIVO' })), { skip: 'inactive' });
    assert.deepEqual(buildBoLargeTaxpayerRow(record({ found: false })), { skip: 'not_in_seprec' });
    assert.deepEqual(buildBoLargeTaxpayerRow(record({ detailNit: '1000000020' })), { skip: 'nit_mismatch' });
    assert.equal(isBoliviaCompanyNit('1020255020'), true);
    assert.equal(isBoliviaCompanyNit('6082096011'), false);
  });

  it('un NIT repetido entra una sola vez; nunca se guardan contactos', () => {
    const { rows, skipped } = buildBoLargeTaxpayerRows([record(), record(), record({ nit: '1000009022', found: false })]);
    assert.equal(rows.length, 1);
    assert.equal(skipped.not_in_seprec, 1);
    assert.equal(JSON.stringify(rows).includes('contacto'), false);
  });

  it('la categoría llega al tamaño como un tramo SIN personas: no decide', () => {
    const workforce = workforceFromRawData({ taxpayer_category: 'GRACO', metrics_year: 2025 }, 'bo_large_taxpayers');
    assert.deepEqual(workforce, { workers: 0, year: 2025, source: 'bo_large_taxpayers', maxWorkers: null, sizeBand: 'gran contribuyente (GRACO)' });
    assert.equal(workforceFromRawData({ taxpayer_category: 'RESTO', metrics_year: 2025 }, 'bo_large_taxpayers'), null);
    // México y Chile, igual que antes
    assert.equal(workforceFromRawData({ workers: 300, metrics_year: 2024 }, 'cl_sii_registry')?.workers, 300);
  });
});

/** Fragmento con la forma real del payload de gob.bo (06-10). */
function gobBoPage(entity: { slug: string; name: string; web?: string | null; email?: string | null; parent?: string | null; municipio?: string; departamento?: string }): string {
  const parent = entity.parent ? `{\\"id\\":\\"9\\",\\"nombre\\":\\"${entity.parent}\\",\\"slug\\":\\"x\\",\\"sigla\\":\\"X\\"}` : 'null';
  const web = entity.web ? `\\"${entity.web}\\"` : 'null';
  const email = entity.email ? `\\"${entity.email}\\"` : 'null';
  const location = entity.municipio
    ? `[{\\"nombre\\":\\"Oficina\\",\\"tipo\\":\\"Oficina central\\",\\"latitud\\":\\"-1\\",\\"longitud\\":\\"-1\\",\\"direccion\\":\\"Calle 1\\",\\"municipio\\":\\"${entity.municipio}\\",\\"provincia\\":\\"Cercado\\",\\"departamento\\":\\"${entity.departamento}\\"}]`
    : '[]';
  return `<script>self.__next_f.push([1,"8:[[\\"$\\",\\"$L1d\\",null,{\\"entidadEdicion\\":{\\"id\\":\\"1\\",\\"padre\\":${parent},\\"nombre\\":\\"${entity.name}\\",\\"slug\\":\\"${entity.slug}\\",\\"sigla\\":\\"S\\",\\"urlPaginaWeb\\":${web},\\"telefonoContacto\\":null,\\"correoElectronicoContacto\\":${email},\\"descripcion\\":null},\\"tramitesData\\":[],\\"ubicacionesList\\":${location}}]]\\n"])</script>`;
}

describe('entidades públicas de gob.bo (bo_public_entities)', () => {
  it('lee la ficha: nombre, web, entidad madre y ubicación; comillas dentro del nombre', () => {
    const entity = parseGobBoEntityPage(
      gobBoPage({ slug: 'empresa-nacional-de-electricidad', name: 'Empresa Nacional de Electricidad', web: 'https://www.ende.bo', email: 'ende@ende.bo', parent: 'Ministerio de Hidrocarburos y Energías', municipio: 'Cochabamba', departamento: 'Cochabamba' }),
      'empresa-nacional-de-electricidad',
    );
    assert.deepEqual(entity, {
      slug: 'empresa-nacional-de-electricidad',
      name: 'Empresa Nacional de Electricidad',
      acronym: 'S',
      website: 'https://www.ende.bo',
      contactEmail: 'ende@ende.bo',
      parentName: 'Ministerio de Hidrocarburos y Energías',
      municipality: 'Cochabamba',
      department: 'Cochabamba',
    });
    const quoted = parseGobBoEntityPage(gobBoPage({ slug: 'mi-teleferico', name: 'Empresa Estatal de Transporte por Cable \\\\\\"Mi teleférico\\\\\\"' }), 'mi-teleferico');
    assert.equal(quoted?.name, 'Empresa Estatal de Transporte por Cable "Mi teleférico"');
    assert.equal(parseGobBoEntityPage('<html></html>', 'nada'), null);
  });

  it('forma corta de los gobiernos autónomos', () => {
    assert.equal(normalizeBoliviaPublicEntityCore('Gobierno Autónomo Municipal de La Paz'), 'GAM LA PAZ');
    assert.equal(normalizeBoliviaPublicEntityCore('Alcaldía de La Paz'), 'GAM LA PAZ');
    assert.equal(normalizeBoliviaPublicEntityCore('Gobierno Autónomo Departamental de Santa Cruz'), 'GAD SANTA CRUZ');
    assert.equal(normalizeBoliviaPublicEntityCore('Gobernación de Santa Cruz'), 'GAD SANTA CRUZ');
  });

  it('tipo de entidad y macro con la que se ofrece', () => {
    const entities: GobBoEntity[] = [
      { slug: 'gam-lpz', name: 'Gobierno Autónomo Municipal de La Paz', acronym: null, website: null, contactEmail: null, parentName: null, department: 'La Paz', municipality: 'La Paz' },
      { slug: 'gam-auc', name: 'Gobierno Autónomo Municipal de Aucapata', acronym: null, website: null, contactEmail: null, parentName: null, department: null, municipality: null },
      { slug: 'gad-scz', name: 'Gobierno Autónomo Departamental de Santa Cruz', acronym: null, website: null, contactEmail: null, parentName: null, department: null, municipality: null },
      { slug: 'ende', name: 'Empresa Nacional de Electricidad', acronym: null, website: 'https://www.ende.bo', contactEmail: null, parentName: 'Ministerio de Hidrocarburos y Energías', department: null, municipality: null },
      { slug: 'emapa-mun', name: 'Empresa Municipal de Áreas Verdes', acronym: null, website: null, contactEmail: null, parentName: 'Gobierno Autónomo Municipal de Sucre', department: null, municipality: null },
      { slug: 'cns', name: 'Caja Nacional de Salud', acronym: null, website: null, contactEmail: 'contacto@cns.gob.bo', parentName: null, department: null, municipality: null },
      { slug: 'asfi', name: 'Autoridad de Supervisión del Sistema Financiero', acronym: null, website: 'https://www.asfi.gob.bo/index.html', contactEmail: null, parentName: 'Ministerio de Economía', department: null, municipality: null },
    ];
    const rows = buildBoPublicEntityRows(entities);
    const by = (slug: string) => rows.find((row) => row.raw_data.gobbo_slug === slug);
    assert.equal(by('gam-lpz')?.raw_data.macro_industry_key, 'government');
    assert.equal(by('gam-auc')?.raw_data.macro_industry_key, null, 'alcaldía pequeña: en la tabla, no se ofrece');
    assert.equal(by('gad-scz')?.raw_data.macro_industry_key, 'government');
    assert.equal(by('ende')?.raw_data.macro_industry_key, 'energy_mining_environment');
    assert.equal(by('emapa-mun')?.raw_data.macro_industry_key, null);
    assert.equal(by('cns')?.raw_data.macro_industry_key, 'health_pharma');
    assert.equal(by('cns')?.raw_data.website_domain, 'cns.gob.bo');
    assert.equal(by('cns')?.raw_data.website_domain_source, 'email');
    assert.equal(by('asfi')?.raw_data.website_domain, 'asfi.gob.bo');
    assert.equal(by('ende')?.record_identity_key, 'gobbo:ende');
    assert.equal(by('ende')?.tax_id, null, 'nunca un NIT inventado');
    assert.equal(classifyBoPublicEntityKind('Ministerio de Salud y Deportes'), 'ministry');
    assert.equal(getSourceFamily('bo_public_entities'), 'NATIVE_RECORD_GRAIN');
    assert.equal(JSON.stringify(rows).includes('contacto@'), false, 'nunca se guarda el correo');
  });

  it('el correo gratuito nunca da la web', () => {
    assert.deepEqual(boPublicEntityDomain({ website: null, contactEmail: 'emav-s@hotmail.com' }), { domain: null, source: null });
  });
});
