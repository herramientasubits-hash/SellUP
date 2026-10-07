/**
 * SOURCES-HN-CLOSE-1 — Honduras «estándar México»: núcleo del nombre por estructura,
 * alias, variantes, web, filas de las cuatro claves, resolvedor de RTN y tramo
 * «*MIPYME*» en el filtro de tamaño. Nombres reales de ONCAE / SEFIN (OCDS
 * 2018-2026, medidos el 07-10-2026). Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  endsWithHondurasLegalForm,
  hondurasCandidateNameVariants,
  hondurasNameCore,
  hondurasPublicEntityKey,
  hondurasRegistryAliasKeys,
} from '../hn-name-keys';
import {
  hondurasCompanyDomainFromEmails,
  hondurasDomainNamesEntity,
  hondurasPublicEntityDomain,
  hondurasSingleWordConfirmedByDomain,
} from '../hn-domain';
import { normalizeHondurasCompanyCore } from '../hn-ocds-rtn-registry-rows';
import {
  buildHnHonducomprasDirectoryRow,
  buildHnPublicEntityRow,
  buildHnRtnNameAliasRows,
  buildHnRtnRegistryRow,
  cnbsAcronymsByCore,
  hnPreferredLegalName,
  hnSupplierAliasKeys,
  HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY,
  HN_PUBLIC_ENTITIES_SOURCE_KEY,
  HN_RTN_NAME_ALIAS_SOURCE_KEY,
  parseCnbsInstitutionsCsv,
  parseHnOcdsBuyer,
  parseHnOcdsSupplier,
  type HnOcdsSupplier,
} from '../hn-sources-rows';
import {
  resolveHnObjetoMacro,
  resolveHnSupplierMacro,
  isHnHonducomprasRelevant,
} from '@/server/prospect-batches/country-source-discovery/hn-honducompras-macro-table';
import {
  createHondurasOfficialSourceResolver,
  type HondurasNameRow,
} from '@/server/agents/prospect-intake/resolvers/honduras-official-source-resolver';
import { HN_MIPYME_BAND, workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '@/server/agents/prospecting-toolkit/employee-size-resolver';
import { evaluateIcpSizeGate } from '@/server/agents/prospecting-toolkit/icp-size-gate';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';

const importedAt = '2026-10-07T00:00:00.000Z';

function supplier(overrides: Partial<HnOcdsSupplier> = {}): HnOcdsSupplier {
  return {
    rtn: '08019003077680',
    names: { 'CERVECERÍA HONDUREÑA S.A. DE C.V.': 10 },
    emails: ['compras@cerveceriahondurena.com'],
    region: 'Francisco Morazan',
    locality: 'DISTRITO CENTRAL',
    first: '2019-02-01',
    last: '2025-11-03',
    sources: ['oncae'],
    contracts: 12,
    hnl: 9_000_000,
    buyers: 4,
    fam: { '5020': 9_000_000 },
    obj: {},
    mipymeYear: null,
    ...overrides,
  };
}

// ─── Nombres ───────────────────────────────────────────────────────────────

describe('núcleo del nombre por estructura', () => {
  it('quita la forma escrita de cualquier manera (23 % del registro la conservaba)', () => {
    const cases: Array<[string, string]> = [
      ['PUBLICITY S DE RL', 'PUBLICITY'],
      ['INVERSIONES PM S DE RL DE CV', 'INVERSIONES PM'],
      ['SUPLIDORA DEL NORTE SA DE CV', 'SUPLIDORA DEL NORTE'],
      ['Tiendas Carrion, S. A. de C. V. * Compra Menor', 'TIENDAS CARRION'],
      ['TOURIST OPTIONS S. DE R.L.*MIPYME*', 'TOURIST OPTIONS'],
      ['AGENCIA PUBLICITARIA DEL CARIBE S.U. DE R.L.', 'AGENCIA PUBLICITARIA DEL CARIBE'],
      ['EYETECH SOLUTIONS, SOCIEDAD ANONIMA DE CAPITAL VARIABLE', 'EYETECH SOLUTIONS'],
      ['INGENIERIA Y SOLUCIONES ESPECIALIZADAS S.A.S.', 'INGENIERIA Y SOLUCIONES ESPECIALIZADAS'],
      ["TRUJILLO'S RESORT SA DE CV", 'TRUJILLOS RESORT'],
      ['LARACH Y CIA, S. DE R.L. DE C.V.', 'LARACH'],
      ['COMPAÑIA GENERAL DE INVERSIONES S.A.', 'COMPANIA GENERAL DE INVERSIONES'],
    ];
    for (const [name, core] of cases) assert.equal(hondurasNameCore(name), core, name);
  });

  it('forma cortada al final y «DE HOND» completado', () => {
    assert.equal(hondurasNameCore('EDITORIAL Y PROVEEDORES GRAFICOS PUBLICITARIOS, S DE RL DE C'), 'EDITORIAL Y PROVEEDORES GRAFICOS PUBLICITARIOS');
    assert.equal(hondurasNameCore('AGENCIA DE VIAJES SUN TRAVEL S.A. D'), 'AGENCIA DE VIAJES SUN TRAVEL');
    assert.equal(hondurasNameCore('SUPERMERCADOS LA COLONIA DE HOND S A'), 'SUPERMERCADOS LA COLONIA DE HONDURAS');
  });

  it('sigla entre paréntesis y forma en medio: la razón social es lo de delante', () => {
    assert.equal(hondurasNameCore('ENERGIA RENOVABLE S A DE C V  (ENERSA)'), 'ENERGIA RENOVABLE');
    assert.equal(hondurasNameCore('LACTEOS DE HONDURAS S.A. DIVISION SULA CENTRO'), 'LACTEOS DE HONDURAS');
    assert.equal(hondurasNameCore('BANCO DE AMERICA CENTRAL HONDURAS S A BAC BAMER'), 'BANCO DE AMERICA CENTRAL HONDURAS');
  });

  it('un nombre que es sólo la forma no tiene núcleo; «Publicity» sin forma es el mismo núcleo', () => {
    assert.equal(hondurasNameCore('S.A.'), '');
    assert.equal(hondurasNameCore('S. DE R.L.'), '');
    assert.equal(hondurasNameCore('Publicity'), hondurasNameCore('PUBLICITY S. DE R.L.'));
    assert.ok(endsWithHondurasLegalForm('PUBLICITY S DE RL'));
    assert.ok(!endsWithHondurasLegalForm('Publicity'));
  });

  it('la limpieza compartida con Guatemala y Panamá no cambió', () => {
    assert.equal(normalizeHondurasCompanyCore('INDUSTRIAS QUIBA, S.A. DE C.V. * Compra Menor'), 'INDUSTRIAS QUIBA');
    assert.equal(normalizeHondurasCompanyCore('COFIÑO STAHL Y COMPAÑIA SOCIEDAD ANONIMA'), 'COFINO STAHL Y COMPANIA');
  });
});

describe('alias y variantes', () => {
  it('sigla, nombre tras la forma y partes con «/»; una división no es alias', () => {
    assert.deepEqual(hondurasRegistryAliasKeys('ENERGIA RENOVABLE S A DE C V  (ENERSA)'), ['ENERSA']);
    assert.deepEqual(hondurasRegistryAliasKeys('BANCO DE AMERICA CENTRAL HONDURAS S A BAC BAMER'), ['BAC BAMER']);
    assert.deepEqual(hondurasRegistryAliasKeys('LACTEOS DE HONDURAS S.A. DIVISION SULA CENTRO'), []);
    assert.ok(hondurasRegistryAliasKeys('Banco Financiera Comercial Hondureña S.A./Banco Ficohsa').includes('BANCO FICOHSA'));
    assert.ok(hondurasRegistryAliasKeys('EMPRESA HONDUREÑA DE TELECOMUNICACIONES(HONDUTEL)').includes('HONDUTEL'));
    assert.deepEqual(hondurasRegistryAliasKeys('CONSORCIO VIAL DEL NORTE (CVN)'), []);
  });

  it('clave pública: alcaldía = municipalidad, secretaría sin «de Estado en el Despacho de»', () => {
    assert.equal(hondurasPublicEntityKey('Municipalidad de San Pedro Sula, Cortés'), 'ALCALDIA SAN PEDRO SULA');
    assert.equal(hondurasPublicEntityKey('Alcaldía Municipal de San Pedro Sula'), 'ALCALDIA SAN PEDRO SULA');
    assert.equal(hondurasPublicEntityKey('Secretaría de Estado en el Despacho de Salud'), 'SECRETARIA SALUD');
    assert.equal(hondurasPublicEntityKey('Secretaría de Salud'), 'SECRETARIA SALUD');
    assert.equal(hondurasPublicEntityKey('Cervecería Hondureña'), null);
  });

  it('el candidato prueba con y sin «(de) Honduras» y con «Hondureña»', () => {
    const cores = hondurasCandidateNameVariants('Nestlé Honduras').map((v) => v.core);
    assert.deepEqual(cores, ['NESTLE HONDURAS', 'NESTLE', 'NESTLE DE HONDURAS', 'NESTLE HONDURENA']);
    assert.ok(hondurasCandidateNameVariants('Grupo Jaremar').some((v) => v.core === 'GRUPO JAREMAR DE HONDURAS'));
  });
});

// ─── Web ───────────────────────────────────────────────────────────────────

describe('web', () => {
  it('correos gratuitos, con errata, de relleno, de internet o del Estado no son la web de una empresa', () => {
    assert.equal(hondurasCompanyDomainFromEmails(['x@gmai.com', 'y@notiene.com', 'z@cablecolor.hn', 'w@sefin.gob.hn']), null);
    assert.equal(hondurasCompanyDomainFromEmails(['a@gmail.com', 'ventas@corp.lacthosa.com.hn']), 'lacthosa.com.hn');
  });

  it('la web de una entidad pública debe nombrarla (sigla, iniciales o palabra distintiva)', () => {
    assert.equal(hondurasDomainNamesEntity('salud.gob.hn', 'Secretaría de Salud'), true);
    assert.equal(hondurasDomainNamesEntity('unah.edu.hn', 'Universidad Nacional Autónoma de Honduras'), true);
    assert.equal(hondurasDomainNamesEntity('senasa-sag.gob.hn', 'Servicio Nacional de Sanidad e Inocuidad Agroalimentaria (SENASA)'), true);
    assert.equal(hondurasDomainNamesEntity('sanpedrosula.hn', 'Municipalidad de San Pedro Sula, Cortés'), true);
    assert.equal(hondurasDomainNamesEntity('bch.hn', 'Gabinete de Conducción y Regulacion Economica'), false);
    assert.equal(hondurasDomainNamesEntity('umaps.hn', 'Municipalidad del Distrito Central, Francisco Morazan'), false);
    assert.equal(hondurasDomainNamesEntity('aguasdesiguatepeque.com', 'Municipalidad de Siguatepeque, Comayagua'), false);
  });

  it('entidad: nunca la mesa de ayuda de HonduCompras ni un correo gratuito', () => {
    assert.equal(
      hondurasPublicEntityDomain({ name: 'Alcaldía Municipal de Atima', urls: [], emails: ['mesadeayuda@honducompras.gob.hn', 'atima@yahoo.com'] }),
      null,
    );
    assert.equal(
      hondurasPublicEntityDomain({ name: 'Secretaria de Salud Pública', urls: ['http://www.salud.gob.hn'], emails: [] }),
      'salud.gob.hn',
    );
  });

  it('una palabra sólo la confirma su propia web; un .gob.hn sólo a una entidad pública', () => {
    assert.equal(hondurasSingleWordConfirmedByDomain('lacthosa.com', 'LACTHOSA', { publicEntity: false }), true);
    assert.equal(hondurasSingleWordConfirmedByDomain('www.hondutel.hn', 'HONDUTEL', { publicEntity: true }), true);
    assert.equal(hondurasSingleWordConfirmedByDomain('salud.gob.hn', 'SALUD', { publicEntity: false }), false);
    assert.equal(hondurasSingleWordConfirmedByDomain('lacthosa-shop.com', 'LACTHOSA', { publicEntity: false }), false);
  });
});

// ─── Industria y relevancia ────────────────────────────────────────────────

describe('tablas de industria', () => {
  it('UNSPSC (tabla PY) primero; objeto del gasto de SIAFI sólo sin artículos', () => {
    assert.equal(resolveHnObjetoMacro('47210'), 'property_construction');
    assert.equal(resolveHnObjetoMacro('35210'), 'health_pharma');
    assert.equal(resolveHnObjetoMacro('25600'), null); // publicidad: sin macro
    assert.equal(resolveHnSupplierMacro({ amountByFamily: {}, amountByObjeto: { '47210': 10, '29100': 2 } })?.kind, 'siafi_supplier');
    assert.equal(resolveHnSupplierMacro({ amountByFamily: { '4321': 5 }, amountByObjeto: { '47210': 99 } })?.macroIndustryKey, 'technology');
  });

  it('relevancia: activa desde 2022, sin MIPYME reciente, al menos L 5 millones', () => {
    assert.equal(isHnHonducomprasRelevant({ awardedHnl: 5_000_000, lastYear: 2024, mipymeYear: null }), true);
    assert.equal(isHnHonducomprasRelevant({ awardedHnl: 4_999_999, lastYear: 2024, mipymeYear: null }), false);
    assert.equal(isHnHonducomprasRelevant({ awardedHnl: 9e9, lastYear: 2021, mipymeYear: null }), false);
    assert.equal(isHnHonducomprasRelevant({ awardedHnl: 9e9, lastYear: 2025, mipymeYear: 2023 }), false);
    assert.equal(isHnHonducomprasRelevant({ awardedHnl: 9e9, lastYear: 2025, mipymeYear: 2019 }), true);
  });
});

// ─── Filas ─────────────────────────────────────────────────────────────────

describe('filas de las cuatro claves', () => {
  it('lee las líneas del extractor y rechaza RTN de persona natural', () => {
    const line = { rtn: '08019003077680', names: { X: 1 }, emails: [], fam: { '5020': 1 }, obj: {}, contracts: 1, hnl: 1, buyers: 1, mipyme_year: 2025 };
    assert.equal(parseHnOcdsSupplier(line)?.mipymeYear, 2025);
    assert.equal(parseHnOcdsSupplier({ ...line, rtn: '08011985123456' }), null);
    assert.equal(parseHnOcdsBuyer({ id: 'abc', name: 'Secretaría de Salud', urls: [], emails: [] })?.name, 'Secretaría de Salud');
  });

  it('razón social: la que termina en forma gana a la más publicada sin forma', () => {
    assert.equal(
      hnPreferredLegalName({ names: { 'BANCO FICOHSA FIDUCIARIO': 5076, 'Banco Financiera Comercial Hondureña  S.A./Banco Ficohsa': 90 } }),
      'Banco Financiera Comercial Hondureña S.A.',
    );
  });

  it('registro: núcleo nuevo y marca MIPYME para el filtro de tamaño', () => {
    const row = buildHnRtnRegistryRow(supplier({ names: { 'PUBLICITY S DE RL*MIPYME*': 3 }, mipymeYear: 2025 }), { importedAt })!;
    assert.equal(row.normalized_legal_name, 'PUBLICITY');
    assert.equal(row.raw_data['hn_mipyme_year'], 2025);
    assert.equal(row.record_identity_key, 'tax:08019003077680');
    assert.equal(getSourceFamily('hn_ocds_rtn_registry'), 'TAX_GRAIN');
  });

  it('alias: nombres de otra fuente y sigla de la CNBS por cualquiera de sus nombres', () => {
    const cnbs = parseCnbsInstitutionsCsv('_id,TipoInstitución,Institución,Descripción,Logo\n1,01,14," BANCO HONDURENO DEL CAFE, S.A.",  BANHCAFE\n2,01,02," BANCO DE HONDURAS, S.A.", HONDURAS\n');
    const acronyms = cnbsAcronymsByCore(cnbs);
    assert.deepEqual(acronyms.get('BANCO HONDURENO DEL CAFE'), ['BANHCAFE']);
    assert.equal(acronyms.has('BANCO DE HONDURAS'), false);
    const s = supplier({ rtn: '08019000234446', names: { 'BANCO HONDUREÑO DEL CAFE, S.A.': 4, 'BANHCAFE S.A.': 1 } });
    const registryRow = buildHnRtnRegistryRow(s, { importedAt })!;
    const keys = hnSupplierAliasKeys(s, registryRow.normalized_legal_name, acronyms);
    assert.deepEqual(keys, ['BANHCAFE']);
    const aliasRows = buildHnRtnNameAliasRows({ registryRow, keys });
    assert.equal(aliasRows[0].source_key, HN_RTN_NAME_ALIAS_SOURCE_KEY);
    assert.equal(aliasRows[0].record_identity_key, 'hn-name-alias:08019000234446:BANHCAFE');
    assert.equal(getSourceFamily(HN_RTN_NAME_ALIAS_SOURCE_KEY), 'NATIVE_RECORD_GRAIN');
  });

  it('capa gratuita: sólo relevantes, sin consorcios, MIPYME ni entidades públicas', () => {
    const params = { importedAt, sharedDomains: new Set<string>() };
    const ok = buildHnHonducomprasDirectoryRow(supplier(), params);
    assert.ok('row' in ok);
    assert.equal(ok.row.source_key, HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY);
    assert.equal(ok.row.raw_data['website_domain'], 'cerveceriahondurena.com');
    assert.equal(ok.row.raw_data['directory_kind'], 'honducompras_supplier');
    assert.deepEqual(buildHnHonducomprasDirectoryRow(supplier({ names: { 'CONSORCIO VIAL NORTE': 1 } }), params), { excluded: 'consortium' });
    assert.deepEqual(buildHnHonducomprasDirectoryRow(supplier({ mipymeYear: 2024 }), params), { excluded: 'not_relevant' });
    assert.deepEqual(buildHnHonducomprasDirectoryRow(supplier({ hnl: 100_000 }), params), { excluded: 'not_relevant' });
    assert.deepEqual(
      buildHnHonducomprasDirectoryRow(supplier({ names: { 'UNIVERSIDAD NACIONAL AUTONOMA DE HONDURAS (UNAH)': 1 } }), params),
      { excluded: 'public_entity' },
    );
    // Un dominio compartido por varios RTN (bufete, grupo) no se guarda como web.
    const shared = buildHnHonducomprasDirectoryRow(supplier(), { importedAt, sharedDomains: new Set(['cerveceriahondurena.com']) });
    assert.ok('row' in shared && shared.row.raw_data['website_domain'] === undefined);
    // Sólo SIAFI: clasificada por objeto del gasto.
    const siafi = buildHnHonducomprasDirectoryRow(supplier({ fam: {}, obj: { '47210': 8_000_000 } }), params);
    assert.ok('row' in siafi && siafi.row.raw_data['directory_kind'] === 'siafi_supplier' && siafi.row.raw_data['activity_code'] === '47210');
    assert.equal(getSourceFamily(HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY), 'TAX_GRAIN');
  });

  it('Gobierno: entidad con web propia, RTN si también vende al Estado; sin ONG ni sociedades', () => {
    const params = { importedAt, sharedDomains: new Set<string>(), rtnByPublicKey: new Map([['UNIVERSIDAD NACIONAL AUTONOMA DE HONDURAS', '08019995354420']]) };
    const unah = buildHnPublicEntityRow(
      { id: '7rXy', name: 'Universidad Nacional Autónoma de Honduras', urls: ['http://www.unah.hn'], emails: [], region: null, locality: null, last: '2025-03-01' },
      params,
    );
    assert.ok('row' in unah);
    assert.equal(unah.row.source_key, HN_PUBLIC_ENTITIES_SOURCE_KEY);
    assert.equal(unah.row.tax_id, '08019995354420');
    assert.equal(unah.row.raw_data['macro_industry_key'], 'government');
    assert.equal(unah.row.record_identity_key, 'hn-oncae-ce:7rXy');
    const noWeb = buildHnPublicEntityRow({ id: 'a', name: 'Alcaldía Municipal de Atima', urls: [], emails: ['x@yahoo.com'], region: null, locality: null, last: null }, params);
    assert.deepEqual(noWeb, { excluded: 'no_website' });
    const ngo = buildHnPublicEntityRow({ id: 'b', name: 'Fundación Ayuda en Acción', urls: ['https://ayudaenaccion.org'], emails: [], region: null, locality: null, last: null }, params);
    assert.deepEqual(ngo, { excluded: 'not_public' });
    const company = buildHnPublicEntityRow({ id: 'c', name: 'Aguas de Choloma SA de CV', urls: ['https://aguasdecholoma.com'], emails: [], region: null, locality: null, last: null }, params);
    assert.deepEqual(company, { excluded: 'not_public' });
    assert.equal(getSourceFamily(HN_PUBLIC_ENTITIES_SOURCE_KEY), 'NATIVE_RECORD_GRAIN');
  });
});

// ─── Resolvedor ────────────────────────────────────────────────────────────

function input(name: string, domain: string | null = null): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, countryCode: 'HN', domain, websiteUrl: null },
    criteria: { countryCode: 'HN' },
  } as unknown as OfficialSourceResolverInput;
}

function resolverOver(rows: HondurasNameRow[]) {
  return createHondurasOfficialSourceResolver({
    querySnapshots: async (core) => rows.filter((row) => row.normalizedLegalName === core),
  });
}

describe('resolvedor de RTN por nombre', () => {
  const rows: HondurasNameRow[] = [
    { taxId: '08019003077680', legalName: 'CERVECERÍA HONDUREÑA S.A. DE C.V.', normalizedLegalName: 'CERVECERIA HONDURENA' },
    { taxId: '08019002264186', legalName: 'NESTLE HONDUREÑA SA', normalizedLegalName: 'NESTLE HONDURENA' },
    { taxId: '05019003256756', legalName: 'LACTEOS DE HONDURAS S.A.', normalizedLegalName: 'LACTHOSA', alias: true },
    { taxId: '08019017397542', legalName: 'PUBLICITY S DE RL', normalizedLegalName: 'PUBLICITY' },
    { taxId: '08019017397543', legalName: 'PUBLICITY S.A.', normalizedLegalName: 'PUBLICITY' },
    {
      taxId: '08019014636065',
      legalName: 'TOURIST OPTIONS S. DE R.L.',
      normalizedLegalName: 'TOURIST OPTIONS',
      workforce: workforceFromRawData({ hn_mipyme_year: 2025 }, 'hn_honducompras_mipyme'),
    },
    { taxId: '08011985123456', legalName: 'PERSONA NATURAL', normalizedLegalName: 'PERSONA NATURAL' },
  ];
  const resolver = resolverOver(rows);

  it('sólo Honduras', () => {
    assert.equal(resolver.canResolve(input('Cervecería Hondureña')), true);
    assert.equal(resolver.canResolve({ ...input('Cervecería Hondureña'), candidate: { canonicalName: 'X Y Z', countryCode: 'GT' } } as never), false);
  });

  it('nombre sin forma → RTN fuerte; «Nestlé Honduras» por la variante «Hondureña»', async () => {
    const a = await resolver.resolve(input('Cervecería Hondureña'));
    assert.equal(a.status, 'matched');
    assert.equal(a.taxIdentifier, '08019003077680');
    assert.equal(a.taxIdentifierType, 'RTN');
    const b = await resolver.resolve(input('Nestlé Honduras'));
    assert.equal(b.status, 'matched');
    assert.equal(b.safeMetadata?.['nameVariant'], 'with_honduras');
  });

  it('una palabra: fuerte sólo si la web lo confirma', async () => {
    assert.equal((await resolver.resolve(input('Lacthosa', 'lacthosa.com'))).status, 'matched');
    assert.equal((await resolver.resolve(input('Lacthosa'))).status, 'low_confidence_match');
  });

  it('homónimos → pista; persona natural nunca', async () => {
    const out = await resolver.resolve(input('Publicity S.A. de C.V.'));
    assert.equal(out.status, 'low_confidence_match');
    assert.equal(out.safeMetadata?.['ambiguous'], true);
    assert.equal((await resolver.resolve(input('Persona Natural S.A.'))).status, 'not_found');
  });

  it('la marca MIPYME viaja con el RTN fuerte', async () => {
    const out = await resolver.resolve(input('Tourist Options'));
    assert.equal(out.status, 'matched');
    assert.equal(out.workforce?.maxWorkers, 150);
    assert.equal(out.workforce?.declaredBelowIcp, true);
  });
});

// ─── Tamaño ────────────────────────────────────────────────────────────────

describe('tramo «*MIPYME*» en el filtro de tamaño', () => {
  const gate = (raw: Record<string, unknown>) => {
    const workforce = workforceFromRawData(raw, 'hn_honducompras_mipyme');
    const candidate = {
      officialSourceIdentity: { strongIdentityAvailable: true, officialSourceMetadata: { workforce } },
    };
    return resolveEmployeeSizeForIcpGate({
      threshold: 200,
      referenceYear: 2026,
      officialRegistryWorkforce: extractOfficialRegistryWorkforce(candidate),
    });
  };

  it('MIPYME (hasta 150) queda entero bajo el umbral 200: el filtro la descarta', () => {
    assert.deepEqual(HN_MIPYME_BAND, { min: 0, max: 150, label: 'mipyme' });
    const out = gate({ hn_mipyme_year: 2025 });
    assert.equal(out.selectedSource, 'official_registry_workers');
    assert.equal(out.icpInput.sizeRange, '0-150');
    assert.match(out.reason, /whole band below ICP threshold 200/);
    assert.equal(evaluateIcpSizeGate(out.icpInput).decision, 'block');
  });

  it('una marca vieja (más de 3 años) no decide; sin marca no se inventa tamaño', () => {
    assert.notEqual(gate({ hn_mipyme_year: 2019 }).selectedSource, 'official_registry_workers');
    assert.equal(workforceFromRawData({ last_release: '2025-01-01' }, 'x'), null);
  });

  it('otros tramos sin la marca siguen igual (mediana de Costa Rica 36-100 no decide)', () => {
    const out = resolveEmployeeSizeForIcpGate({
      threshold: 200,
      referenceYear: 2026,
      officialRegistryWorkforce: { workers: 36, year: 2025, source: 'cr_meic_size', maxWorkers: 100, band: 'mediana' },
    });
    assert.notEqual(out.selectedSource, 'official_registry_workers');
  });
});
