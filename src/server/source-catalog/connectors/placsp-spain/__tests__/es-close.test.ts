/**
 * SOURCES-ES-CLOSE-1 — España «estándar México»: núcleo del nombre por estructura,
 * alias, variantes, web, tablas CNAE/CPV aprobadas, filas de las cinco claves,
 * resolvedor de NIF y tamaño («GRAN EMPRESA» de la BDNS, plantilla de INVENTE) en el
 * filtro de tamaño. Nombres reales de la PLACSP, la BDNS, INVENTE y el Banco de
 * España (medidos el 13-10-2026). Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  endsWithSpainLegalForm,
  spainCandidateNameVariants,
  spainNameCore,
  spainPublicEntityKey,
  spainRegistryAliasKeys,
} from '../es-name-keys';
import {
  spainCompanyDomain,
  spainDomainNamesEntity,
  spainPublicEntityDomain,
  spainSingleWordConfirmedByDomain,
} from '../es-domain';
import { normalizeSpainCompanyCore } from '../es-placsp-registry-rows';
import {
  spainCompanyWebCandidates,
  spainCompanyWebLabels,
  spainCompanyWebNameKey,
  spainCompanyWebVerdict,
  type EsFetchedPage,
} from '../es-company-web';
import {
  buildEsFreeDirectoryRow,
  buildEsNifNameAliasRows,
  buildEsOfficialNifRegistryRow,
  buildEsPlacspNifRegistryRow,
  buildEsPublicEntityRow,
  esAliasKeysForNames,
  dominantCodeWithMajority,
  esDirectoryPriorityScore,
  ES_PUBLIC_ENTITY_PRIORITY_BASE,
  esPreferredLegalName,
  esPreferredPublicName,
  esPublicEntityDisplayName,
  ES_BDNS_LARGE_TAXPAYER_CATEGORY,
  ES_FREE_DIRECTORY_SOURCE_KEY,
  ES_NIF_NAME_ALIAS_SOURCE_KEY,
  ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY,
  ES_PUBLIC_ENTITIES_SOURCE_KEY,
  parseEsAwardee,
  parseEsBdnsBeneficiary,
  parseEsContractingBody,
  parseEsInventeEntity,
  type EsAwardee,
  type EsBdnsBeneficiary,
  type EsInventeEntity,
} from '../es-sources-rows';
import {
  isEsDirectoryRelevant,
  macroHasEsCoverage,
  parseSpainCnae,
  resolveSpainCnaeMacro,
  resolveSpainCpvMacro,
} from '@/server/prospect-batches/country-source-discovery/es-free-directory-macro-table';
import {
  createSpainOfficialSourceResolver,
  type SpainNameRow,
} from '@/server/agents/prospect-intake/resolvers/spain-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '@/server/agents/prospecting-toolkit/employee-size-resolver';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';

const params = { importedAt: '2026-10-13T00:00:00.000Z', sourceYear: 2026 };

// ─── Núcleo del nombre ─────────────────────────────────────────────────────

describe('núcleo del nombre español por estructura', () => {
  it('quita formas apiladas y del sector público (medido en Prod: 848 núcleos cambian)', () => {
    assert.equal(spainNameCore('Aena S.M.E., S.A.'), 'AENA');
    assert.equal(spainNameCore('NAVANTIA S.A. S.M.E.'), 'NAVANTIA');
    assert.equal(spainNameCore('Correos y Telégrafos S.A. S.M.E.'), 'CORREOS Y TELEGRAFOS');
    assert.equal(spainNameCore('Consum S.Coop. V.'), 'CONSUM');
    assert.equal(spainNameCore('TALLERES ATIENZA S. COOP DE C-LM'), 'TALLERES ATIENZA');
    assert.equal(spainNameCore('Radio Taxi Principado S.Coop.Asturiana'), 'RADIO TAXI PRINCIPADO');
    assert.equal(spainNameCore('Cooperativa del Campo San Isidro'), 'COOPERATIVA DEL CAMPO SAN ISIDRO');
    assert.equal(spainNameCore('Merlin Properties SOCIMI, S.A.'), 'MERLIN PROPERTIES');
    assert.equal(spainNameCore('UNION ALCOYANA SOCIEDAD ANONIMA DE SEGUROS Y REASEGUROS'), 'UNION ALCOYANA');
    assert.equal(spainNameCore('Sanitas S.A. de Seguros'), 'SANITAS');
    assert.equal(spainNameCore('TRANSPORTES J.CARRIÓN, S.A.UNIPERSONAL'), 'TRANSPORTES J CARRION');
    assert.equal(spainNameCore('HORMIFREX SAL'), 'HORMIFREX');
    assert.equal(spainNameCore('Correos Telecom, S.A. S.M.E., Sociedad Unipersonal'), 'CORREOS TELECOM');
  });

  it('el paréntesis final y lo que sigue a una forma en medio salen del núcleo', () => {
    assert.equal(spainNameCore('SERVICIOS ESPECIALES DE LIMPIEZA SA (SELSA)'), 'SERVICIOS ESPECIALES DE LIMPIEZA');
    assert.equal(spainNameCore('Iberia Líneas Aéreas de España, S.A. Operadora'), 'IBERIA LINEAS AEREAS DE ESPANA');
  });

  it('no rompe los casos ya fijados por SOURCES-ES-NIF-BY-NAME-1', () => {
    assert.equal(normalizeSpainCompanyCore('Produccions de Gastronomia, S.L.U.'), 'PRODUCCIONS DE GASTRONOMIA');
    assert.equal(normalizeSpainCompanyCore('Cooperativa del Campo S. Coop.'), 'COOPERATIVA DEL CAMPO');
    assert.equal(normalizeSpainCompanyCore('Palex Medical Sociedad Anónima'), 'PALEX MEDICAL');
  });

  it('un nombre que es sólo la forma no tiene núcleo; «S.A.» final se reconoce', () => {
    assert.equal(spainNameCore('S.A.'), '');
    assert.equal(endsWithSpainLegalForm('Mapfre, S.A.'), true);
    assert.equal(endsWithSpainLegalForm('Mapfre'), false);
  });
});

describe('alias y clave pública', () => {
  it('sigla entre paréntesis y nombre tras una forma en medio', () => {
    assert.deepEqual(spainRegistryAliasKeys('SERVICIOS ESPECIALES DE LIMPIEZA SA (SELSA)'), ['SELSA']);
    assert.deepEqual(spainRegistryAliasKeys('UTE DXIII TELEFONICA DE ESPAÑA - TELEFONICA MOVILES'), []);
  });

  it('el órgano y la entidad territorial dan la misma clave', () => {
    assert.equal(spainPublicEntityKey('Junta de Gobierno del Ayuntamiento de Cuenca'), 'AYUNTAMIENTO CUENCA');
    assert.equal(spainPublicEntityKey('Ayuntamiento de Cuenca'), 'AYUNTAMIENTO CUENCA');
    assert.equal(spainPublicEntityKey('Ajuntament de Barcelona'), 'AYUNTAMIENTO BARCELONA');
    assert.equal(spainPublicEntityKey('Diputación Provincial de Sevilla'), 'DIPUTACION SEVILLA');
    assert.equal(spainPublicEntityKey('Telefónica de España S.A.U.'), null);
  });

  it('variantes del candidato: con y sin «España», la clave pública detrás', () => {
    const cores = spainCandidateNameVariants('Vodafone España').map((v) => v.core);
    assert.deepEqual(cores.slice(0, 2), ['VODAFONE ESPANA', 'VODAFONE']);
    assert.ok(spainCandidateNameVariants('Indra Sistemas').some((v) => v.core === 'INDRA SISTEMAS ESPANA' && v.origin === 'with_spain'));
    const pub = spainCandidateNameVariants('Alcaldía del Ayuntamiento de Getafe');
    assert.ok(pub.some((v) => v.core === 'AYUNTAMIENTO GETAFE' && v.origin === 'public'));
    assert.ok(!pub.some((v) => v.origin === 'with_spain'));
  });
});

// ─── Web ───────────────────────────────────────────────────────────────────

describe('web de empresas y entidades públicas', () => {
  it('empresa: web publicada o correo corporativo; nunca gratuito ni del sector público', () => {
    assert.equal(spainCompanyDomain({ urls: ['https://www.sepides.es/'], emails: [] }), 'sepides.es');
    assert.equal(spainCompanyDomain({ urls: [], emails: ['x@telefonica.net', 'compras@empresa.com.es'] }), 'empresa.com.es');
    assert.equal(spainCompanyDomain({ urls: [], emails: ['a@gmail.com', 'b@hotmail.es'] }), null);
    assert.equal(spainCompanyDomain({ urls: ['https://contrataciondelestado.es/x'], emails: [] }), null);
  });

  it('entidad pública: la dirección la nombra; un dominio regional compartido no basta', () => {
    assert.equal(spainPublicEntityDomain({ name: 'Ayuntamiento de Cuenca', urls: ['http://www.cuenca.es'], emails: [] }), 'cuenca.es');
    assert.equal(spainPublicEntityDomain({ name: 'Instituto Aragonés de Servicios Sociales (IASS)', urls: ['https://www.aragon.es'], emails: [] }), null);
    assert.equal(spainPublicEntityDomain({ name: 'Ayuntamiento de Isla Mayor', urls: [], emails: ['juanmolero@gmail.com'] }), null);
    assert.equal(
      spainPublicEntityDomain({ name: 'Instituto Balear de Infraestructuras y Servicios Educativos (IBISEC)', urls: ['https://ibisec.caib.es'], emails: [] }),
      'ibisec.caib.es',
    );
    assert.equal(spainPublicEntityDomain({ name: 'Dirección General de Digitalización', urls: ['http://contratacion.castillalamancha.es/'], emails: [] }), null);
    assert.equal(spainDomainNamesEntity('aemet.es', 'Agencia Estatal de Meteorología (AEMET)'), true);
  });

  it('una palabra: sólo si la etiqueta del dominio es esa palabra', () => {
    assert.equal(spainSingleWordConfirmedByDomain('https://www.mapfre.com', 'MAPFRE', { publicEntity: false }), true);
    assert.equal(spainSingleWordConfirmedByDomain('mapfre-seguros.com', 'MAPFRE', { publicEntity: false }), false);
    assert.equal(spainSingleWordConfirmedByDomain(null, 'MAPFRE', { publicEntity: false }), false);
  });
});

// ─── Tablas aprobadas ──────────────────────────────────────────────────────

describe('tablas CNAE y CPV (aprobadas 13-10-2026)', () => {
  it('CNAE: división como Argentina v2, letra de sección, clase 4646 y formatos de INVENTE y BDNS', () => {
    assert.deepEqual(parseSpainCnae('M681'), { section: 'M', digits: '681' });
    assert.equal(resolveSpainCnaeMacro('88.1'), 'health_pharma');
    assert.equal(resolveSpainCnaeMacro('62'), 'technology');
    assert.equal(resolveSpainCnaeMacro('M681'), 'property_construction');
    assert.equal(resolveSpainCnaeMacro('4646'), 'health_pharma');
    assert.equal(resolveSpainCnaeMacro('H'), 'transport_logistics');
    assert.equal(resolveSpainCnaeMacro('O'), 'government');
    assert.equal(resolveSpainCnaeMacro('C'), null);
    assert.equal(resolveSpainCnaeMacro('S'), null);
    assert.equal(resolveSpainCnaeMacro('55'), null);
    assert.equal(resolveSpainCnaeMacro('85'), null);
  });

  it('CPV por división', () => {
    assert.equal(resolveSpainCpvMacro('72212000-4'), 'technology');
    assert.equal(resolveSpainCpvMacro('33600000'), 'health_pharma');
    assert.equal(resolveSpainCpvMacro('45233252'), 'property_construction');
    assert.equal(resolveSpainCpvMacro('90910000'), 'energy_mining_environment');
    assert.equal(resolveSpainCpvMacro('80500000'), null);
    assert.equal(resolveSpainCpvMacro('92000000'), null);
    assert.equal(macroHasEsCoverage('technology'), true);
    assert.equal(macroHasEsCoverage('government'), true);
  });

  it('cortes: adjudicatarias 1 M€; entes de INVENTE con 50+ o sin dato', () => {
    assert.equal(isEsDirectoryRelevant({ kind: 'placsp_awardee', awardedEur: 999_999, workers: null }), false);
    assert.equal(isEsDirectoryRelevant({ kind: 'placsp_awardee', awardedEur: 1_000_000, workers: null }), true);
    assert.equal(isEsDirectoryRelevant({ kind: 'invente_company', awardedEur: null, workers: 12 }), false);
    assert.equal(isEsDirectoryRelevant({ kind: 'invente_company', awardedEur: null, workers: null }), true);
    assert.equal(isEsDirectoryRelevant({ kind: 'bdns_large', awardedEur: null, workers: null }), true);
  });
});

// ─── Filas ─────────────────────────────────────────────────────────────────

function awardee(overrides: Partial<EsAwardee> = {}): EsAwardee {
  return {
    nif: 'A28599033',
    names: { 'INDRA SOLUCIONES TECNOLOGÍAS DE LA INFORMACIÓN, S.L.U.': 3, 'Indra Soluciones TI': 1 },
    cpv: { '72': 3, '48': 1 },
    eur: 2_500_000,
    contracts: 4,
    last: 2026,
    postal: '28108',
    ...overrides,
  };
}

function bdns(overrides: Partial<EsBdnsBeneficiary> = {}): EsBdnsBeneficiary {
  return { nif: 'A08055741', names: { 'MAPFRE ESPAÑA, COMPAÑIA DE SEGUROS Y REASEGUROS, S.A.': 2 }, cnae: { '65.1': 2 }, largeYear: 2025, region: 'Madrid', ...overrides };
}

function invente(overrides: Partial<EsInventeEntity> = {}): EsInventeEntity {
  return {
    nif: 'A83052407',
    name: 'Sociedad Estatal Correos y Telégrafos, S.A., S.M.E.',
    form: 'Sociedad mercantil',
    cnae: 'H5310',
    adscription: 'Administración General del Estado',
    web: 'www.correos.es',
    email: null,
    workers: 45_000,
    workersYear: 2024,
    inventeCode: 'INV00001234',
    ...overrides,
  };
}

describe('lectura de las líneas del extractor', () => {
  it('sólo NIF de sociedad con control válido', () => {
    assert.equal(parseEsAwardee({ nif: 'A28599033', names: { X: 1 } })?.nif, 'A28599033');
    assert.equal(parseEsAwardee({ nif: '***0612**', names: { X: 1 } }), null);
    assert.equal(parseEsBdnsBeneficiary({ nif: 'A08055741', names: { Y: 1 }, large_year: 2025 })?.largeYear, 2025);
    assert.equal(parseEsContractingBody({ nif: 'P1607900F', names: { Z: 1 }, urls: ['http://www.cuenca.es'] })?.urls[0], 'http://www.cuenca.es');
    assert.equal(parseEsInventeEntity({ nif: 'A83052407', name: 'Correos', workers: 10, workers_year: 2024 })?.workers, 10);
  });

  it('la razón social prefiere el nombre con forma societaria', () => {
    assert.equal(esPreferredLegalName({ 'Indra TI': 5, 'INDRA SOLUCIONES TI S.L.U.': 1 }), 'INDRA SOLUCIONES TI S.L.U.');
  });
});

describe('registros de NIF y alias', () => {
  it('adjudicataria: fila con el año de la carga (no el del contrato) y sin UTE', () => {
    const row = buildEsPlacspNifRegistryRow(awardee({ last: 2024 }), params)!;
    assert.equal(row.source_year, 2026);
    assert.equal(row.normalized_legal_name, 'INDRA SOLUCIONES TECNOLOGIAS DE LA INFORMACION');
    assert.equal(row.raw_data['awarded_eur'], 2_500_000);
    assert.equal(buildEsPlacspNifRegistryRow(awardee({ names: { 'UTE DXIII TELEFONICA': 1 } }), params), null);
  });

  it('otras fuentes: plantilla de INVENTE manda; si no, «GRAN EMPRESA» de la BDNS', () => {
    const correos = buildEsOfficialNifRegistryRow({ nif: 'A83052407', bdns: null, invente: invente(), bde: null }, params)!;
    assert.equal(correos.source_key, ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY);
    assert.equal(correos.normalized_legal_name, 'SOCIEDAD ESTATAL CORREOS Y TELEGRAFOS');
    assert.deepEqual([correos.raw_data['workers'], correos.raw_data['metrics_year']], [45_000, 2024]);
    const mapfre = buildEsOfficialNifRegistryRow({ nif: 'A08055741', bdns: bdns(), invente: null, bde: null }, params)!;
    assert.equal(mapfre.raw_data['taxpayer_category'], ES_BDNS_LARGE_TAXPAYER_CATEGORY);
    assert.equal(mapfre.raw_data['metrics_year'], 2025);
    const pyme = buildEsOfficialNifRegistryRow({ nif: 'A08055741', bdns: bdns({ largeYear: null }), invente: null, bde: null }, params)!;
    assert.equal(pyme.raw_data['taxpayer_category'], undefined);
  });

  it('alias: todos los nombres publicados, nunca el propio', () => {
    const row = buildEsPlacspNifRegistryRow(awardee(), params)!;
    const keys = esAliasKeysForNames(Object.keys(awardee().names), row.normalized_legal_name);
    assert.deepEqual(keys, ['INDRA SOLUCIONES TI']);
    const alias = buildEsNifNameAliasRows({ registryRow: row, keys });
    assert.equal(alias[0].source_key, ES_NIF_NAME_ALIAS_SOURCE_KEY);
    assert.equal(alias[0].record_identity_key, 'es-name-alias:A28599033:INDRA SOLUCIONES TI');
    assert.equal(alias[0].raw_data['alias_of'], row.normalized_legal_name);
  });

  it('familias: un NIF una fila; alias por (NIF, nombre)', () => {
    for (const key of [ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY, ES_FREE_DIRECTORY_SOURCE_KEY, ES_PUBLIC_ENTITIES_SOURCE_KEY]) {
      assert.equal(getSourceFamily(key), 'TAX_GRAIN', key);
    }
    assert.equal(getSourceFamily(ES_NIF_NAME_ALIAS_SOURCE_KEY), 'NATIVE_RECORD_GRAIN');
  });
});

describe('capa gratuita de empresas', () => {
  const directoryParams = { ...params, sharedDomains: new Set<string>() };

  it('ente de INVENTE: CNAE, plantilla y web oficial', () => {
    const result = buildEsFreeDirectoryRow({ nif: 'A83052407', awardee: null, bdns: null, invente: invente(), bde: null }, directoryParams);
    assert.ok('row' in result);
    assert.equal(result.row.raw_data['directory_kind'], 'invente_company');
    assert.equal(result.row.raw_data['macro_industry_key'], 'transport_logistics');
    assert.equal(result.row.raw_data['website_domain'], 'correos.es');
    assert.equal(result.row.raw_data['workers'], 45_000);
  });

  it('«GRAN EMPRESA» de la BDNS gana a la adjudicataria y marca «grande»', () => {
    const result = buildEsFreeDirectoryRow({ nif: 'A08055741', awardee: awardee({ nif: 'A08055741' }), bdns: bdns(), invente: null, bde: null }, directoryParams);
    assert.ok('row' in result);
    assert.equal(result.row.raw_data['directory_kind'], 'bdns_large');
    assert.equal(result.row.raw_data['macro_industry_key'], 'insurance_financial_services');
    assert.equal(result.row.raw_data['bdns_large_year'], 2025);
  });

  it('adjudicataria: por su CPV dominante y sólo con 1 M€ o más', () => {
    const ok = buildEsFreeDirectoryRow({ nif: 'A28599033', awardee: awardee(), bdns: null, invente: null, bde: null }, directoryParams);
    assert.ok('row' in ok);
    assert.equal(ok.row.raw_data['macro_industry_key'], 'technology');
    assert.equal(ok.row.raw_data['activity_code'], '72000000');
    const small = buildEsFreeDirectoryRow({ nif: 'A28599033', awardee: awardee({ eur: 300_000 }), bdns: null, invente: null, bde: null }, directoryParams);
    assert.deepEqual(small, { excluded: 'not_relevant' });
  });

  it('entidades públicas, UTE y sin industria quedan fuera', () => {
    assert.deepEqual(
      buildEsFreeDirectoryRow({ nif: 'P1607900F', awardee: awardee({ nif: 'P1607900F' }), bdns: null, invente: null, bde: null }, directoryParams),
      { excluded: 'public_entity' },
    );
    assert.deepEqual(
      buildEsFreeDirectoryRow({ nif: 'A28599033', awardee: awardee({ cpv: { '80': 2 } }), bdns: null, invente: null, bde: null }, directoryParams),
      { excluded: 'no_macro' },
    );
  });

  it('banco del Banco de España (sin intermediarios de crédito)', () => {
    const bank = buildEsFreeDirectoryRow(
      { nif: 'A39000013', awardee: null, bdns: null, invente: null, bde: { nif: 'A39000013', name: 'BANCO SANTANDER, S.A.', web: 'www.bancosantander.es', entityType: 'Banco' } },
      directoryParams,
    );
    assert.ok('row' in bank);
    assert.equal(bank.row.raw_data['website_domain'], 'bancosantander.es');
    const broker = buildEsFreeDirectoryRow(
      { nif: 'B10383917', awardee: null, bdns: null, invente: null, bde: { nif: 'B10383917', name: 'HIPOTECAS DIRECTAS, S.L.', web: null, entityType: 'Intermediario de crédito inmobiliario' } },
      directoryParams,
    );
    assert.deepEqual(broker, { excluded: 'no_macro' });
  });
});

describe('orden de la capa gratuita (SOURCES-ES-RANKING-1)', () => {
  const score = (kind: Parameters<typeof esDirectoryPriorityScore>[0]['kind'], workers: number | null, awardedEur: number, large = false) =>
    esDirectoryPriorityScore({ kind, workers, awardedEur, large });

  it('«gran empresa» y bancos primero; entes de INVENTE pequeños al final', () => {
    assert.ok(score('bdns_large', null, 0, true) > score('placsp_awardee', null, 200_000_000));
    assert.ok(score('bde_financial', null, 0) > score('invente_company', 45_000, 0));
    assert.ok(score('invente_company', 52, 0) < score('placsp_awardee', null, 1_000_000));
  });

  it('adjudicatarias y entes de INVENTE grandes se mezclan por fuerza', () => {
    assert.ok(score('placsp_awardee', null, 60_000_000) > score('invente_company', 300, 0));
    assert.ok(score('invente_company', 1_100, 0) > score('placsp_awardee', null, 2_000_000));
  });

  it('en Gobierno las entidades públicas van por delante de cualquier empresa', () => {
    assert.ok(ES_PUBLIC_ENTITY_PRIORITY_BASE > score('bdns_large', 99_999, 999_999_999, true));
  });

  it('la actividad de la BDNS sólo vale con más de la mitad de los programas (Eulen no es tecnológica)', () => {
    assert.equal(dominantCodeWithMajority({ '61': 1, H: 1, '84.1': 1, '96': 1 }, resolveSpainCnaeMacro), null);
    assert.equal(dominantCodeWithMajority({ '62': 2, '84.1': 1 }, resolveSpainCnaeMacro), '62');
    assert.equal(dominantCodeWithMajority({ '62': 1, C: 1 }, resolveSpainCnaeMacro), null);
    assert.equal(dominantCodeWithMajority({ '63.9': 1, '55': 1 }, resolveSpainCnaeMacro), null);
    const eulen = buildEsFreeDirectoryRow(
      { nif: 'A28517308', awardee: null, bdns: bdns({ nif: 'A28517308', names: { 'EULEN, S.A.': 1 }, cnae: { '61': 1, H: 1, '84.1': 1, '96': 1 } }), invente: null, bde: null },
      { ...params, sharedDomains: new Set<string>() },
    );
    assert.deepEqual(eulen, { excluded: 'no_macro' });
  });

  it('NIF de no residente (N) fuera', () => {
    const result = buildEsFreeDirectoryRow(
      { nif: 'N9007326C', awardee: null, bdns: null, invente: invente({ nif: 'N9007326C', name: 'Informa D&B Portugal, Lda.', cnae: 'J6201' }), bde: null },
      { ...params, sharedDomains: new Set<string>() },
    );
    assert.deepEqual(result, { excluded: 'foreign' });
  });
});

describe('capa gratuita de Gobierno', () => {
  const publicParams = { ...params, sharedDomains: new Set<string>() };

  it('nombre de la entidad sin el órgano delante', () => {
    assert.equal(esPublicEntityDisplayName('Junta de Gobierno del Ayuntamiento de Cuenca'), 'Ayuntamiento de Cuenca');
    assert.equal(esPublicEntityDisplayName('Presidencia del Organismo Autónomo Terra de Sanxenxo'), 'Organismo Autónomo Terra de Sanxenxo');
    assert.equal(esPublicEntityDisplayName('Consejo de Administración de Metropolitano de Tenerife, S.A.'), 'Metropolitano de Tenerife, S.A.');
    assert.equal(esPublicEntityDisplayName('Letrado-a Mayor del Senado'), 'Senado');
    assert.equal(esPreferredPublicName({ 'Alcaldía del Ayuntamiento de Getafe': 3, 'Pleno del Ayuntamiento de Getafe': 2 }), 'Ayuntamiento de Getafe');
  });

  it('órgano con NIF P y web que lo nombra', () => {
    const result = buildEsPublicEntityRow(
      { nif: 'P1607900F', body: { nif: 'P1607900F', dir3: 'L01160783', names: { 'Junta de Gobierno del Ayuntamiento de Cuenca': 3 }, urls: ['http://www.cuenca.es'], emails: ['contratacion@cuenca.es'], typeCode: '3' }, invente: null },
      publicParams,
    );
    assert.ok('row' in result);
    assert.equal(result.row.legal_name, 'Ayuntamiento de Cuenca');
    assert.equal(result.row.tax_id, 'P1607900F');
    assert.equal(result.row.raw_data['entity_kind'], 'municipality');
    assert.equal(result.row.raw_data['public_key'], 'AYUNTAMIENTO CUENCA');
    assert.equal(result.row.raw_data['macro_industry_key'], 'government');
  });

  it('Estado y comunidades antes que ayuntamientos; entre iguales, el que más contrata', () => {
    const body = (nif: string, name: string, url: string, n: number, typeCode: string | null) =>
      ({ nif, dir3: null, names: { [name]: n }, urls: [url], emails: [], typeCode });
    const row = (nif: string, name: string, url: string, n: number, typeCode: string | null) => {
      const r = buildEsPublicEntityRow({ nif, body: body(nif, name, url, n, typeCode), invente: null }, publicParams);
      assert.ok('row' in r, name);
      return r.row;
    };
    const ministry = row('Q2818014I', 'Ministerio de Cultura', 'https://www.cultura.gob.es', 3, '1');
    const big = row('P1607900F', 'Ayuntamiento de Cuenca', 'http://www.cuenca.es', 500, '3');
    const small = row('P2807900B', 'Ayuntamiento de Getafe', 'http://www.getafe.es', 2, '3');
    assert.ok(ministry.priority_score > big.priority_score);
    assert.ok(big.priority_score > small.priority_score);
    assert.ok(small.priority_score >= ES_PUBLIC_ENTITY_PRIORITY_BASE);
  });

  it('sin web propia, con NIF de sociedad o con web compartida: fuera', () => {
    const body = (nif: string, name: string, urls: string[], emails: string[] = []) => ({ nif, dir3: null, names: { [name]: 1 }, urls, emails, typeCode: null });
    assert.deepEqual(buildEsPublicEntityRow({ nif: 'P1607900F', body: body('P1607900F', 'Ayuntamiento de Isla Mayor', [], ['x@gmail.com']), invente: null }, publicParams), { excluded: 'no_website' });
    assert.deepEqual(buildEsPublicEntityRow({ nif: 'A28028744', body: body('A28028744', 'Agencia EFE S.A.U., S.M.E.', ['http://www.efe.com']), invente: null }, publicParams), { excluded: 'not_public' });
    assert.deepEqual(
      buildEsPublicEntityRow({ nif: 'Q2818014I', body: body('Q2818014I', 'Comandancia Guardia Civil de Lugo', ['https://www.guardiacivil.org']), invente: null }, { ...params, sharedDomains: new Set(['guardiacivil.org']) }),
      { excluded: 'shared_website' },
    );
  });

  it('ente público de INVENTE (universidad) entra aunque su NIF sea Q', () => {
    const result = buildEsPublicEntityRow(
      { nif: 'Q0332001G', body: null, invente: invente({ nif: 'Q0332001G', name: 'Universidad de Alicante', form: 'Universidad pública', cnae: 'P8543', web: 'https://www.ua.es', workers: 3_900 }) },
      publicParams,
    );
    assert.ok('row' in result);
    assert.equal(result.row.raw_data['entity_kind'], 'university_or_hospital');
    assert.equal(result.row.raw_data['website_domain'], 'ua.es');
  });
});

// ─── Resolvedor ────────────────────────────────────────────────────────────

function input(name: string, domain: string | null = null): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, countryCode: 'ES', domain, websiteUrl: null },
    criteria: { countryCode: 'ES' },
  } as unknown as OfficialSourceResolverInput;
}

function resolverOver(rows: SpainNameRow[]) {
  return createSpainOfficialSourceResolver({
    querySnapshots: async (core) => rows.filter((row) => row.normalizedLegalName === core),
  });
}

describe('resolvedor de NIF por nombre', () => {
  const rows: SpainNameRow[] = [
    { taxId: 'A28599033', legalName: 'INDRA SISTEMAS, S.A.', normalizedLegalName: 'INDRA SISTEMAS', sourceKey: 'es_placsp_registry' },
    { taxId: 'A83052407', legalName: 'Sociedad Estatal Correos y Telégrafos, S.A., S.M.E.', normalizedLegalName: 'CORREOS Y TELEGRAFOS', alias: true, workforce: workforceFromRawData({ workers: 45_000, metrics_year: 2024 }, 'es_invente_workforce') },
    { taxId: 'A83052407', legalName: 'Sociedad Estatal Correos y Telégrafos, S.A., S.M.E.', normalizedLegalName: 'SOCIEDAD ESTATAL CORREOS Y TELEGRAFOS', sourceKey: 'es_official_nif_registry', workforce: workforceFromRawData({ workers: 45_000, metrics_year: 2024 }, 'es_invente_workforce') },
    { taxId: 'A08055741', legalName: 'MAPFRE, S.A.', normalizedLegalName: 'MAPFRE', sourceKey: 'es_official_nif_registry', workforce: workforceFromRawData({ taxpayer_category: 'ES_BDNS_GRAN_EMPRESA', metrics_year: 2025 }, 'es_bdns_large_company') },
    { taxId: 'A48010615', legalName: 'VODAFONE ESPAÑA, S.A.U.', normalizedLegalName: 'VODAFONE ESPANA', sourceKey: 'es_placsp_registry' },
    { taxId: 'B10383917', legalName: 'GLOBALEX SL', normalizedLegalName: 'GLOBALEX' },
    { taxId: 'B62537774', legalName: 'GLOBALEX SA', normalizedLegalName: 'GLOBALEX' },
  ];
  const resolver = resolverOver(rows);

  it('sólo España', () => {
    assert.equal(resolver.canResolve(input('Indra Sistemas')), true);
    assert.equal(resolver.canResolve({ ...input('Indra Sistemas'), candidate: { canonicalName: 'Indra Sistemas', countryCode: 'MX' } } as never), false);
  });

  it('nombre con forma → NIF fuerte de la fuente que tiene la razón social', async () => {
    const out = await resolver.resolve(input('Indra Sistemas S.A.'));
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, 'A28599033');
    assert.equal(out.taxIdentifierType, 'NIF');
    assert.equal(out.sourceKey, 'es_placsp_registry');
  });

  it('por alias, con la plantilla de INVENTE', async () => {
    const out = await resolver.resolve(input('Correos y Telégrafos S.A. S.M.E.'));
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, 'A83052407');
    assert.equal(out.workforce?.workers, 45_000);
  });

  it('«Vodafone» sólo es fuerte por la variante si la web confirma la palabra', async () => {
    assert.equal((await resolver.resolve(input('Vodafone', 'vodafone.es'))).status, 'matched');
    assert.equal((await resolver.resolve(input('Vodafone'))).status, 'low_confidence_match');
  });

  it('una palabra con web → fuerte y con el tramo «gran empresa» de la BDNS', async () => {
    const out = await resolver.resolve(input('Mapfre', 'https://www.mapfre.com'));
    assert.equal(out.status, 'matched');
    assert.equal(out.workforce?.sizeBand, 'gran empresa (ayudas de Estado BDNS)');
  });

  it('homónimos → pista', async () => {
    const out = await resolver.resolve(input('Globalex S.L.'));
    assert.equal(out.status, 'low_confidence_match');
    assert.equal(out.safeMetadata?.['ambiguous'], true);
  });
});

// ─── Tamaño ────────────────────────────────────────────────────────────────

describe('tamaño de España en el filtro', () => {
  const gate = (raw: Record<string, unknown>) => {
    const workforce = workforceFromRawData(raw, 'es');
    const candidate = { officialSourceIdentity: { strongIdentityAvailable: true, officialSourceMetadata: { workforce } } };
    return resolveEmployeeSizeForIcpGate({
      threshold: 200,
      referenceYear: 2026,
      officialRegistryWorkforce: extractOfficialRegistryWorkforce(candidate),
    });
  };

  it('«GRAN EMPRESA» de la BDNS: tramo sin piso ni techo, no decide solo', () => {
    const workforce = workforceFromRawData({ taxpayer_category: ES_BDNS_LARGE_TAXPAYER_CATEGORY, metrics_year: 2025 }, 'es');
    assert.equal(workforce?.workers, 0);
    assert.equal(workforce?.maxWorkers, null);
    assert.notEqual(gate({ taxpayer_category: ES_BDNS_LARGE_TAXPAYER_CATEGORY, metrics_year: 2025 }).selectedSource, 'official_registry_workers');
  });

  it('plantilla de INVENTE: número oficial por el camino de siempre', () => {
    assert.equal(gate({ workers: 45_000, metrics_year: 2025 }).selectedSource, 'official_registry_workers');
  });
});

// ─── Catálogo ──────────────────────────────────────────────────────────────

describe('catálogo de España', () => {
  it('estados honestos: identidad en la corrida y capas gratuitas, nunca «connected»', () => {
    const byKey = new Map(CATALOG_SOURCES.map((s) => [s.key, s]));
    assert.equal(byKey.get('es_placsp_registry')?.aiFlowStatus, 'connected_identity_in_run');
    assert.equal(byKey.get('es_official_nif_registry')?.aiFlowStatus, 'connected_identity_in_run');
    assert.equal(byKey.get('es_free_directory')?.aiFlowStatus, 'connected_free_discovery');
    assert.equal(byKey.get('es_public_entities')?.aiFlowStatus, 'connected_free_discovery');
  });

  it('las claves nuevas no entran en las recomendaciones del contexto', () => {
    for (const depth of ['basic', 'standard', 'deep'] as const) {
      for (const industry of ['Tecnología', 'Salud', 'Gobierno']) {
        const keys = getCatalogContext({ country: 'España', countryCode: 'ES', industry, searchDepth: depth }).recommendedSources.map(
          (s) => (s as { key?: string }).key,
        );
        for (const key of ['es_official_nif_registry', 'es_free_directory', 'es_public_entities']) {
          assert.ok(!keys.includes(key), `${key} ${industry} ${depth}`);
        }
      }
    }
  });
});

// ─── Web por nombre (SOURCES-ES-WEBS-1) ────────────────────────────────────

describe('web por nombre comprobada con su página', () => {
  const page = (host: string, title: string, text: string, finalHost = host): EsFetchedPage => ({
    host,
    finalHost,
    status: 200,
    blocked: false,
    title,
    text,
  });

  it('candidatas sólo desde el nombre, sin forma ni «España»', () => {
    assert.equal(spainCompanyWebNameKey('VODAFONE ESPAÑA S.A.U.'), 'VODAFONE');
    assert.deepEqual(spainCompanyWebLabels('NUNSYS S A'), ['nunsys']);
    assert.ok(spainCompanyWebCandidates(['HIBERUS IT DEVELOPMENT SERVICES SLU']).includes('hiberus.es'));
    assert.ok(!spainCompanyWebLabels('GRUPO SERVICIOS GENERALES SL').includes('grupo'));
  });

  it('la página tiene que nombrar a la empresa', () => {
    const ok = spainCompanyWebVerdict(page('naturgy.es', 'Naturgy | Energía', 'Naturgy luz y gas'), ['NATURGY IBERIA, S.A.']);
    assert.ok('domain' in ok && ok.domain === 'naturgy.es');
    assert.deepEqual(spainCompanyWebVerdict(page('becsa.es', 'Otra cosa', 'Bienvenido'), ['BECSA SOCIEDAD ANONIMA']), { rejected: 'not_named' });
  });

  it('marca en el título sólo en .es; fuera de .es tiene que hablar de España', () => {
    const brand = spainCompanyWebVerdict(page('hiberus.es', 'Hiberus - Consultora', 'Software development en Zaragoza'), ['HIBERUS IT DEVELOPMENT SERVICES SLU']);
    assert.ok('domain' in brand && brand.check === 'title_names_brand');
    assert.ok('rejected' in spainCompanyWebVerdict(page('rover.com', 'Rover | Pet sitting', 'Book trusted sitters España'), ['ROVER INFRAESTRUCTURAS, SA']));
    assert.deepEqual(spainCompanyWebVerdict(page('acme.com', 'ACME', 'Welcome to ACME Corp'), ['ACME SL']), { rejected: 'not_spanish' });
  });

  it('precisión (14-10): ni nombre pegado corto ni marca sin segunda prueba', () => {
    // H SANTOS D → hsantos.es era Hoteles Santos: «HSANTOSD» dentro de «H Santos Desarrollo».
    assert.ok('rejected' in spainCompanyWebVerdict(page('hsantos.es', 'Hoteles Santos', 'H Santos Desarrollo hotelero'), ['H SANTOS D SL']));
    // SEREM CONSULTORIA EMPRESARIAL → serem.es era un centro de coaching.
    assert.ok('rejected' in spainCompanyWebVerdict(page('serem.es', 'Serem, coaching y psicología', 'Coaching empresarial en Gandia'), ['SEREM CONSULTORIA EMPRESARIAL S.L.']));
    // Con el NIF en la página, la marca sí vale.
    const withNif = spainCompanyWebVerdict(page('serem.es', 'Serem', 'Aviso legal CIF B-81153926'), ['SEREM CONSULTORIA EMPRESARIAL S.L.'], { nif: 'B81153926' });
    assert.ok('domain' in withNif && withNif.check === 'title_names_brand');
  });

  it('aparcadas y redirecciones a otra marca nunca valen', () => {
    assert.deepEqual(spainCompanyWebVerdict(page('becsa.es', 'Becsa', 'Este dominio está en venta'), ['BECSA SA']), { rejected: 'parked' });
    assert.deepEqual(
      spainCompanyWebVerdict(page('becsa.es', 'Becsa', 'Becsa', 'otraempresa.es'), ['BECSA SA']),
      { rejected: 'redirected_elsewhere' },
    );
  });

  it('la web comprobada sólo entra si la fuente no publica ninguna', () => {
    const viaName = buildEsFreeDirectoryRow(
      { nif: 'A28599033', awardee: awardee(), bdns: null, invente: null, bde: null, nameCheckedDomain: 'indra.es' },
      { ...params, sharedDomains: new Set<string>() },
    );
    assert.ok('row' in viaName);
    assert.equal(viaName.row.raw_data['website_domain'], 'indra.es');
    assert.equal(viaName.row.raw_data['website_origin'], 'name_page_check');
    const noWeb = buildEsFreeDirectoryRow(
      { nif: 'A28599033', awardee: awardee(), bdns: null, invente: null, bde: null },
      { ...params, sharedDomains: new Set<string>() },
    );
    assert.ok('row' in noWeb);
    assert.equal(viaName.row.priority_score - noWeb.row.priority_score, 10_000);
    // Con web va antes que la «gran empresa» más fuerte sin web; las públicas siguen por delante.
    assert.ok(viaName.row.priority_score > esDirectoryPriorityScore({ kind: 'bdns_large', workers: 99_999, awardedEur: 999_999_999, large: true }));
    assert.ok(ES_PUBLIC_ENTITY_PRIORITY_BASE > viaName.row.priority_score);
    const official = buildEsFreeDirectoryRow(
      { nif: 'A83052407', awardee: null, bdns: null, invente: invente(), bde: null, nameCheckedDomain: 'otra.es' },
      { ...params, sharedDomains: new Set<string>() },
    );
    assert.ok('row' in official);
    assert.equal(official.row.raw_data['website_domain'], 'correos.es');
  });
});
