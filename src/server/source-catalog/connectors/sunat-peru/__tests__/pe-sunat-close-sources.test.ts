/**
 * SOURCES-PE-CLOSE-1 — piezas puras de las fuentes de Perú: catálogo CIIU de
 * SUNAT, fila del Padrón RUC abierto, trabajadores en `pe_sunat_registry`, claves
 * de nombre (alias, entidades públicas, variantes del candidato) y filas de
 * `pe_sunat_name_alias` / `pe_sunat_directory`. Los nombres son los reales que
 * se midieron el 06-10-2026; los RUC, los del padrón público.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePeSunatActivityText,
  PE_SUNAT_CIIU4_CODE_BY_ACTIVITY,
  resolvePeSunatCiiu4Code,
} from '../pe-sunat-ciiu4-activity-catalog';
import {
  isPeSunatOpenPadronHeader,
  parsePeSunatOpenPadronRow,
  PE_SUNAT_OPEN_PADRON_HEADER,
  type PeSunatOpenPadronRecord,
} from '../pe-sunat-open-padron';
import { buildPeSunatRegistryRow, normalizePeruCompanyCore } from '../pe-sunat-registry-row';
import {
  dropAliasKeysOwnedByOthers,
  endsWithPeruLegalForm,
  peruOwnNameKeys,
  peruCandidateNameVariants,
  peruPublicEntityKey,
  peruPublicEntityNameKeys,
  peruRegistryAliasKeys,
  splitPeruNameParts,
} from '../pe-name-keys';
import {
  buildPeSunatDirectoryRow,
  buildPeSunatNameAliasRows,
  PE_SUNAT_DIRECTORY_MIN_WORKERS,
} from '../pe-sunat-source-rows';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import { getSourceFamily } from '../../../record-identity';

function openCells(overrides: Partial<Record<(typeof PE_SUNAT_OPEN_PADRON_HEADER)[number], string>> = {}): string[] {
  const base: Record<string, string> = {
    RUC: '20100190797',
    Estado: 'ACTIVO',
    Condicion: 'HABIDO',
    Tipo: 'SOCIEDAD ANONIMA',
    Actividad_Economica_CIIU_revision3_Principal: 'ELABORACION DE PRODUCTOS LACTEOS',
    Actividad_Economica_CIIU_revision3_Secundaria: 'NO DISPONIBLE',
    Actividad_Economica_CIIU_revision4_Principal: 'ELABORACION DE PRODUCTOS LACTEOS',
    NroTrab: '2275',
    TipoFacturacion: 'MANUAL/COMPUTARIZADO',
    TipoContabilidad: 'COMPUTARIZADO',
    ComercioExterior: 'IMPORTADOR/EXPORTADOR',
    UBIGEO: '040129',
    Departamento: 'AREQUIPA',
    Provincia: 'AREQUIPA',
    Distrito: 'JOSE LUIS BUSTAMANTE Y RIVERO',
    PERIODO_PUBLICACION: '202609',
    ...overrides,
  };
  return PE_SUNAT_OPEN_PADRON_HEADER.map((name) => base[name]);
}

function open(overrides: Partial<PeSunatOpenPadronRecord> = {}): PeSunatOpenPadronRecord {
  return {
    ruc: '20100190797',
    taxpayerType: 'SOCIEDAD ANONIMA',
    activityText: 'ELABORACION DE PRODUCTOS LACTEOS',
    ciiu4Code: '1050',
    workers: 2275,
    metricsYear: 2026,
    department: 'AREQUIPA',
    province: 'AREQUIPA',
    ...overrides,
  };
}

const P = { sourceYear: 2026, importedAt: '2026-10-06T00:00:00.000Z' };
const reducedLine = (ruc: string, name: string) => `${ruc}|${name}|ACTIVO|HABIDO|150101|AV.|X|-|-|-|-|-|-|-|-|`;

describe('catálogo CIIU Rev. 4 de SUNAT', () => {
  it('traduce el texto del padrón a su clase, con tildes, Ñ y «no clasificados previamente»', () => {
    assert.equal(resolvePeSunatCiiu4Code('ELABORACION DE PRODUCTOS LACTEOS'), '1050');
    assert.equal(resolvePeSunatCiiu4Code('CULTIVO DE CAÑA DE AZUCAR'), '0114');
    assert.equal(resolvePeSunatCiiu4Code('  enseñanza superior '), '8530');
    assert.equal(resolvePeSunatCiiu4Code('OTRAS ACTIVIDADES DE SERVICIOS DE APOYO A LAS EMPRESAS NO CLASIFICADOS PREVIAMENTE'), '8299');
    assert.equal(resolvePeSunatCiiu4Code('ACTIVIDADES DE TELECOMUNICACIONES ALAMBICAS'), '6110'); // errata del padrón
    assert.equal(resolvePeSunatCiiu4Code('PROGRAMACION INFORMATICA'), '6201');
  });

  it('«NO DISPONIBLE», vacío o un texto desconocido no tienen código (no se adivina)', () => {
    for (const text of ['NO DISPONIBLE', '', null, undefined, 'ACTIVIDAD INVENTADA']) {
      assert.equal(resolvePeSunatCiiu4Code(text), null, String(text));
    }
  });

  it('415 textos, todos con clase de 4 dígitos y normalizados como la búsqueda', () => {
    assert.equal(PE_SUNAT_CIIU4_CODE_BY_ACTIVITY.size, 415);
    for (const [text, code] of PE_SUNAT_CIIU4_CODE_BY_ACTIVITY) {
      assert.match(code, /^\d{4}$/, text);
      assert.equal(normalizePeSunatActivityText(text), text);
    }
  });
});

describe('Padrón RUC abierto', () => {
  it('reconoce la cabecera del archivo', () => {
    assert.equal(isPeSunatOpenPadronHeader([...PE_SUNAT_OPEN_PADRON_HEADER]), true);
    assert.equal(isPeSunatOpenPadronHeader(['RUC', 'Estado']), false);
  });

  it('lee tipo, actividad, clase, trabajadores, año y ubicación de una sociedad activa y habida', () => {
    assert.deepEqual(parsePeSunatOpenPadronRow(openCells()), open());
  });

  it('«NO DISPONIBLE» deja los trabajadores en null; un 0 informado se conserva', () => {
    assert.equal(parsePeSunatOpenPadronRow(openCells({ NroTrab: 'NO DISPONIBLE' }))!.workers, null);
    assert.equal(parsePeSunatOpenPadronRow(openCells({ NroTrab: '0' }))!.workers, 0);
  });

  it('descarta personas naturales, bajas, no habidas y filas con otro número de columnas', () => {
    assert.equal(parsePeSunatOpenPadronRow(openCells({ RUC: '10000000065' })), null);
    assert.equal(parsePeSunatOpenPadronRow(openCells({ Estado: 'BAJA PROVISIONAL POR OFICIO' })), null);
    assert.equal(parsePeSunatOpenPadronRow(openCells({ Condicion: 'NO HABIDO' })), null);
    assert.equal(parsePeSunatOpenPadronRow(openCells().slice(1)), null);
  });
});

describe('pe_sunat_registry con trabajadores', () => {
  it('el núcleo del nombre NO cambia; raw_data suma tipo, clase y trabajadores', () => {
    const row = buildPeSunatRegistryRow(reducedLine('20100190797', 'LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.'), P, open())!;
    assert.equal(row.normalized_legal_name, normalizePeruCompanyCore('LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.'));
    assert.deepEqual(row.raw_data, {
      ubigeo: '150101',
      taxpayer_type: 'SOCIEDAD ANONIMA',
      ciiu4_code: '1050',
      workers: 2275,
      metrics_year: 2026,
    });
    // La misma forma que lee el filtro de tamaño (igual que el SII de Chile).
    assert.deepEqual(workforceFromRawData(row.raw_data, 'pe_sunat_registry', 2026), {
      workers: 2275,
      year: 2026,
      source: 'pe_sunat_registry',
      salesBracket: null,
    });
  });

  it('sin trabajadores informados no se inventa ninguno; sin padrón abierto la fila es la de siempre', () => {
    const noWorkers = buildPeSunatRegistryRow(reducedLine('20100055237', 'ALICORP S.A.A.'), P, open({ ruc: '20100055237', workers: null }))!;
    assert.equal('workers' in noWorkers.raw_data, false);
    assert.equal(workforceFromRawData(noWorkers.raw_data, 'pe_sunat_registry', 2026), null);
    assert.deepEqual(buildPeSunatRegistryRow(reducedLine('20100055237', 'ALICORP S.A.A.'), P)!.raw_data, { ubigeo: '150101' });
  });
});

describe('claves de nombre de Perú', () => {
  it('parte nombres por « - », «|», «/», «>», «: » y «(»', () => {
    assert.deepEqual(splitPeruNameParts('LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.'), ['LECHE GLORIA SOCIEDAD ANONIMA', 'GLORIA S.A.']);
    assert.deepEqual(splitPeruNameParts('Petroperú > Contáctanos'), ['Petroperú', 'Contáctanos']);
    assert.deepEqual(splitPeruNameParts('COSCO SHIPPING Ports Chancay Perú (Puerto de Chancay)'), ['COSCO SHIPPING Ports Chancay Perú', 'Puerto de Chancay']);
    assert.deepEqual(splitPeruNameParts('HOSPITAL REGIONAL DE CAÑETE-REZOLA'), ['HOSPITAL REGIONAL DE CAÑETE-REZOLA']);
  });

  it('reconoce la forma societaria al final, escrita de cualquier manera', () => {
    for (const name of ['GANO ITOUCH SOCIEDAD ANONIMA CERRADA', 'COFACO Industries S. A. C.', 'Acruta & Tapia Ingenieros S.A.C.', 'X E.I.R.L', 'X S.C.R.L.']) {
      assert.equal(endsWithPeruLegalForm(name), true, name);
    }
    assert.equal(endsWithPeruLegalForm('CLINICA DE ESPECIALIDADES MEDICAS'), false);
  });

  it('clave pública: entidades del Estado sin palabras de enlace; las privadas no tienen', () => {
    assert.equal(peruPublicEntityKey('MUNICIPALIDAD DISTRITAL DE USQUIL'), 'MUNICIPALIDAD DISTRITAL USQUIL');
    assert.equal(peruPublicEntityKey('HOSPITAL REGIONAL DEL CUSCO'), 'HOSPITAL REGIONAL CUSCO');
    assert.equal(peruPublicEntityKey('HOSPITAL REGIONAL CUSCO'), null); // ya no tiene nada que quitar
    assert.equal(peruPublicEntityKey('CLINICA LA LUZ'), null);
  });

  it('alias del padrón: el nombre conocido tras el guion y la razón social completa antes de él', () => {
    assert.deepEqual(peruRegistryAliasKeys('LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.', { taxpayerType: 'SOCIEDAD ANONIMA', workers: 2275 }), [
      'GLORIA',
      'LECHE GLORIA',
    ]);
    assert.deepEqual(
      peruRegistryAliasKeys('DIRECCIÓN REGIONAL DE SALUD DEL CALLAO - DIRESA CALLAO', { taxpayerType: 'INSTITUCIONES PUBLICAS', workers: 3667 }),
      // La clave pública de la razón social entera va primero; después, sus dos partes.
      ['DIRECCION REGIONAL SALUD CALLAO DIRESA CALLAO', 'DIRESA CALLAO', 'DIRECCION REGIONAL DE SALUD DEL CALLAO', 'DIRECCION REGIONAL SALUD CALLAO'],
    );
    assert.deepEqual(peruRegistryAliasKeys('MUNICIPALIDAD DISTRITAL  USQUIL', { taxpayerType: 'GOBIERNO REGIONAL LOCAL', workers: 114 }), []);
    assert.deepEqual(peruRegistryAliasKeys('MUNICIPALIDAD PROVINCIAL DE TACNA', { taxpayerType: 'GOBIERNO REGIONAL LOCAL', workers: 1354 }), [
      'MUNICIPALIDAD PROVINCIAL TACNA',
    ]);
  });

  it('una primera parte genérica de una empresa pequeña NO se guarda como alias', () => {
    const keys = peruRegistryAliasKeys('CLINICA DE ESPECIALIDADES MEDICAS - QUIRURGICAS SAN ANTONIO DEPADUA EIRL', {
      taxpayerType: 'EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
      workers: 2,
    });
    assert.equal(keys.includes('CLINICA DE ESPECIALIDADES MEDICAS'), false);
    assert.deepEqual(keys, ['QUIRURGICAS SAN ANTONIO DEPADUA']);
  });

  it('sindicatos, consorcios, CAFAE y asociaciones de cesantes no dan alias', () => {
    const cases: Array<[string, string | null]> = [
      ['SINDICATO NACIONAL DE PSICOLOGOS DEL SEGURO SOCIAL DE SALUD - ESSALUD', 'SINDICATOS Y FEDERACIONES'],
      ['CONSORCIO SUPERVISOR AXIOMA - ESAN', 'CONTRATOS COLABORACION EMPRESARIAL'],
      ['ASOCIACION DE CESANTES Y JUBILADOS D.L 20530 - PETROPERU', 'ASOCIACION'],
      ['CAFAE GOBIERNO REGIONAL CUSCO - CAFAE', null],
    ];
    for (const [name, type] of cases) assert.deepEqual(peruRegistryAliasKeys(name, { taxpayerType: type, workers: 900 }), [], name);
  });

  it('entidades contratantes del OECE: nombre completo, parte antes del guion y su clave pública', () => {
    assert.deepEqual(peruPublicEntityNameKeys('MUNICIPALIDAD PROVINCIAL DE SAN MARTIN - TARAPOTO'), [
      'MUNICIPALIDAD PROVINCIAL DE SAN MARTIN TARAPOTO',
      'MUNICIPALIDAD PROVINCIAL SAN MARTIN TARAPOTO',
      'MUNICIPALIDAD PROVINCIAL DE SAN MARTIN',
      'MUNICIPALIDAD PROVINCIAL SAN MARTIN',
      'TARAPOTO',
    ]);
  });

  it('variantes del candidato en orden: núcleo de siempre primero', () => {
    const cores = (name: string) => peruCandidateNameVariants(name).map((v) => `${v.origin}:${v.core}`);
    assert.deepEqual(cores('Gloria'), ['name:GLORIA']);
    assert.deepEqual(cores('Laboratorios Bagó S.A.'), ['name:LABORATORIOS BAGO', 'with_peru:LABORATORIOS BAGO DEL PERU', 'with_peru:LABORATORIOS BAGO PERU']);
    assert.deepEqual(cores('METRICA Perú'), ['name:METRICA PERU', 'without_peru:METRICA']);
    assert.deepEqual(cores('Volcan.com.pe'), ['name:VOLCAN COM PE', 'web:VOLCAN']);
    assert.deepEqual(cores('Petroperú > Contáctanos').slice(0, 2), ['name:PETROPERU CONTACTANOS', 'part:PETROPERU']);
    assert.deepEqual(cores('MUNICIPALIDAD PROVINCIAL DE ESPINAR - CUSCO').slice(0, 4), [
      'name:MUNICIPALIDAD PROVINCIAL DE ESPINAR CUSCO',
      'public:MUNICIPALIDAD PROVINCIAL ESPINAR CUSCO',
      'part:MUNICIPALIDAD PROVINCIAL DE ESPINAR',
      'public:MUNICIPALIDAD PROVINCIAL ESPINAR',
    ]);
  });

  it('una parte posterior sólo cuenta si es una razón social completa', () => {
    const cores = (name: string) => peruCandidateNameVariants(name).filter((v) => v.origin === 'part').map((v) => v.core);
    assert.deepEqual(cores('ICCGSA - Ingenieros Civiles y Contratistas Generales S.A.'), ['ICCGSA', 'INGENIEROS CIVILES Y CONTRATISTAS GENERALES']);
    assert.deepEqual(cores('Medical Assistant - Salud Ocupacional'), ['MEDICAL ASSISTANT']);
  });

  it('nombres vacíos no tienen variantes', () => {
    assert.deepEqual(peruCandidateNameVariants(''), []);
    assert.deepEqual(peruCandidateNameVariants(null), []);
  });
});

describe('filas de pe_sunat_name_alias', () => {
  it('una fila por clave, con identidad de registro (no fiscal) y los trabajadores de la sociedad', () => {
    const rows = buildPeSunatNameAliasRows({
      ruc: '20100190797',
      legalName: 'LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.',
      keys: ['GLORIA', 'LECHE GLORIA', 'GLORIA', ' '],
      origin: 'sunat_legal_name',
      open: open(),
      ...P,
    });
    assert.deepEqual(rows.map((r) => r.normalized_legal_name), ['GLORIA', 'LECHE GLORIA']);
    assert.deepEqual(rows.map((r) => r.record_identity_key), ['pe-name-alias:20100190797:GLORIA', 'pe-name-alias:20100190797:LECHE GLORIA']);
    assert.equal(rows[0].source_key, 'pe_sunat_name_alias');
    assert.equal(rows[0].normalized_tax_id, '20100190797');
    assert.equal(rows[0].raw_data['alias_origin'], 'sunat_legal_name');
    assert.equal(rows[0].raw_data['workers'], 2275);
    assert.equal(getSourceFamily('pe_sunat_name_alias'), 'NATIVE_RECORD_GRAIN');
  });

  it('nunca para personas naturales ni sin nombre', () => {
    assert.deepEqual(buildPeSunatNameAliasRows({ ruc: '10452159428', legalName: 'X', keys: ['X'], origin: 'oece_entity', open: null, ...P }), []);
    assert.deepEqual(buildPeSunatNameAliasRows({ ruc: '20100190797', legalName: ' ', keys: ['X'], origin: 'oece_entity', open: null, ...P }), []);
  });
});

describe('filas de pe_sunat_directory (capa gratuita)', () => {
  const name = 'LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.';

  it('una sociedad grande con actividad clasificada entra, con su macro, tamaño y ubicación', () => {
    const row = buildPeSunatDirectoryRow({ open: open(), legalName: name, importedAt: P.importedAt })!;
    assert.equal(row.source_key, 'pe_sunat_directory');
    assert.equal(row.record_identity_key, 'tax:20100190797');
    assert.equal(row.priority_score, 2275);
    assert.equal(row.department, 'AREQUIPA');
    assert.equal(row.sector, '1050');
    assert.equal(row.raw_data['macro_industry_key'], 'consumer_goods');
    assert.equal(row.raw_data['workers'], 2275);
    assert.equal(getSourceFamily('pe_sunat_directory'), 'TAX_GRAIN');
  });

  it('menos de 200 trabajadores, sin dato, sin macro o tipo excluido no entran', () => {
    assert.equal(PE_SUNAT_DIRECTORY_MIN_WORKERS, 200);
    assert.ok(buildPeSunatDirectoryRow({ open: open({ workers: 200 }), legalName: name, importedAt: P.importedAt }));
    assert.equal(buildPeSunatDirectoryRow({ open: open({ workers: 199 }), legalName: name, importedAt: P.importedAt }), null);
    assert.equal(buildPeSunatDirectoryRow({ open: open({ workers: null }), legalName: name, importedAt: P.importedAt }), null);
    assert.equal(buildPeSunatDirectoryRow({ open: open({ ciiu4Code: '5510' }), legalName: name, importedAt: P.importedAt }), null);
    assert.equal(buildPeSunatDirectoryRow({ open: open({ ciiu4Code: null }), legalName: name, importedAt: P.importedAt }), null);
    for (const type of ['JUNTA DE PROPIETARIOS', 'SINDICATOS Y FEDERACIONES', 'CONTRATOS COLABORACION EMPRESARIAL']) {
      assert.equal(buildPeSunatDirectoryRow({ open: open({ taxpayerType: type }), legalName: name, importedAt: P.importedAt }), null, type);
    }
    assert.equal(buildPeSunatDirectoryRow({ open: open(), legalName: ' ', importedAt: P.importedAt }), null);
  });

  it('las entidades públicas grandes sí entran (Gobierno es cliente de UBITS)', () => {
    const row = buildPeSunatDirectoryRow({
      open: open({ ruc: '20147797100', taxpayerType: 'GOBIERNO REGIONAL LOCAL', ciiu4Code: '8411', workers: 1354 }),
      legalName: 'MUNICIPALIDAD PROVINCIAL DE TACNA',
      importedAt: P.importedAt,
    })!;
    assert.equal(row.raw_data['macro_industry_key'], 'government');
  });
});

describe('un alias nunca usa el nombre propio de otra sociedad (SOURCES-PE-ALIAS-OWNERSHIP-1)', () => {
  it('nombres propios: el núcleo y, en entidades públicas, su clave pública', () => {
    assert.deepEqual(peruOwnNameKeys('GOBIERNO REGIONAL DE LORETO'), ['GOBIERNO REGIONAL DE LORETO', 'GOBIERNO REGIONAL LORETO']);
    assert.deepEqual(peruOwnNameKeys('LECHE GLORIA SOCIEDAD ANONIMA GLORIA'), ['LECHE GLORIA SOCIEDAD ANONIMA GLORIA']);
    assert.deepEqual(peruOwnNameKeys('X'), []);
  });

  it('la subunidad del OECE no se queda con el nombre del Gobierno Regional; su propio alias sí vale', () => {
    const owners = new Map<string, Set<string>>([
      ['GOBIERNO REGIONAL DE LORETO', new Set(['20493196902'])],
      ['GOBIERNO REGIONAL LORETO', new Set(['20493196902'])],
      ['LIMA', new Set(['20614437180'])],
    ]);
    const subunit = '20408560137';
    assert.deepEqual(
      dropAliasKeysOwnedByOthers(['GOBIERNO REGIONAL DE LORETO', 'GOBIERNO REGIONAL LORETO', 'GERENCIA SUB REGIONAL ALTO AMAZONAS YURIMAGUAS', 'LIMA'], subunit, owners),
      ['GERENCIA SUB REGIONAL ALTO AMAZONAS YURIMAGUAS'],
    );
    // El dueño del nombre conserva sus claves.
    assert.deepEqual(dropAliasKeysOwnedByOthers(['GOBIERNO REGIONAL LORETO'], '20493196902', owners), ['GOBIERNO REGIONAL LORETO']);
    // Una clave que no es el nombre de nadie se conserva (GLORIA).
    assert.deepEqual(dropAliasKeysOwnedByOthers(['GLORIA'], '20100190797', owners), ['GLORIA']);
  });
});
