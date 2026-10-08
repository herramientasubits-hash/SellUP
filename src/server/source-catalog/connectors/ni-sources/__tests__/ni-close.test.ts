/**
 * SOURCES-NI-CLOSE-2 — RUC, nombres, dominios, filas de carga, resolvedor y capa
 * gratuita de Nicaragua. Cero E/S. Los nombres y RUC de empresas reales salen de
 * fuentes públicas (lista de Grandes Contribuyentes de la DGI en el Internet
 * Archive, licencias sanitarias del MINSA, Directorio Industrial de la CNZF).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  endsWithNicaraguaLegalForm,
  nicaraguaCandidateNameVariants,
  nicaraguaNameCore,
  nicaraguaPublicEntityKey,
  nicaraguaRegistryAliasKeys,
} from '../ni-name-keys';
import {
  isNicaraguaPersonalEmailDomain,
  nicaraguaCompanyDomain,
  nicaraguaSingleWordConfirmedByDomain,
  registrableNicaraguaDomain,
} from '../ni-domain';
import {
  buildNiFreeDirectoryRows,
  buildNiRucNameAliasRows,
  buildNiRucRegistryRow,
  canonicalNicaraguaRuc,
  mergeNicaraguaRucSources,
  niEntryAliasKeys,
  niOwnNameKeys,
  niPreferredLegalName,
  niWebListings,
  parseNiCnzfCompany,
  parseNiConamiImf,
  parseNiLargeTaxpayer,
  parseNiMinsaLicense,
  NI_LARGE_TAXPAYER_CATEGORY,
  type NiCnzfCompany,
  type NiConamiImf,
  type NiLargeTaxpayer,
  type NiMinsaLicense,
  type NiSnapshotRow,
} from '../ni-sources-rows';
import { NI_PUBLIC_ENTITIES, type NiPublicEntity } from '../ni-public-entities';
import { dropAliasKeysOwnedByOthers } from '../../sunat-peru/pe-name-keys';
import {
  createNicaraguaOfficialSourceResolver,
  type NicaraguaNameRow,
} from '@/server/agents/prospect-intake/resolvers/nicaragua-official-source-resolver';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import { toNicaraguaNameRow } from '@/server/prospect-batches/nicaragua-snapshot-query';
import {
  buildNiFreeDirectoryDiscoveryAdapter,
  NI_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY,
  NI_LARGE_TAXPAYER_SIZE_LABEL,
  type NiFreeDirectorySnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/ni-free-directory-discovery-adapter';
import {
  macroHasNiCoverage,
  niCnzfEffectiveSection,
  resolveNiDirectoryMacro,
} from '@/server/prospect-batches/country-source-discovery/ni-free-directory-macro-table';
import { NI_LARGE_TAXPAYER_MACRO } from '@/server/prospect-batches/country-source-discovery/ni-large-taxpayer-macro-table';
import {
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '@/server/prospect-batches/country-source-discovery/country-source-capability';
import { CATALOG_SOURCES, COUNTRY_RISKS } from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import { getSourceFamily } from '../../../record-identity/source-family-registry';

const read = (relative: string): string => readFileSync(join(process.cwd(), relative), 'utf8');

// ─── Fixtures (filas reales de las fuentes) ────────────────────────────────

const CASA_PELLAS: NiLargeTaxpayer = { ruc: 'J0310000002371', name: 'CASA PELLAS SOCIEDAD ANONIMA', tradeName: 'CASA PELLAS', snapshots: ['20190924', '20191229', '20200320'] };
const SINSA: NiLargeTaxpayer = { ruc: 'J0310000001812', name: 'SILVA INTERNACIONAL SOCIEDAD ANONIMA.', tradeName: 'S I N S A', snapshots: ['20200320'] };
const CARGILL: NiLargeTaxpayer = {
  ruc: 'J0310000003203',
  name: 'CARGILL DE NICARAGUA , SOCIEDAD ANONIMA',
  tradeName: 'CARGILL , CARGILL DE NICARAGUA, S.A. , TIP TOP',
  snapshots: ['20200320'],
};
const CUT_NAME: NiLargeTaxpayer = { ruc: 'J0310000000727', name: 'MANUFACTURERA CENTROAMERICANA DE SACOS, SOCIEDAD A', tradeName: 'MACSA', snapshots: ['20200320'] };
const CONSORTIUM: NiLargeTaxpayer = { ruc: 'J0210000217918', name: 'ASOCIACION MOMENTANEA CONSORCIO GUARMESA', tradeName: 'CONSORCIO GUARMESA', snapshots: ['20200320'] };
const HOTEL: NiLargeTaxpayer = { ruc: 'J0310000003629', name: 'HOTEL PLAZA REAL SOCIEDAD ANONIMA', tradeName: 'INTERCONTINENTAL METROCENTRO', snapshots: ['20200320'] };

const lic = (ruc: string, name: string, licenseType: string, status = 'VIGENTE', tradeName: string | null = null): NiMinsaLicense => ({
  ruc,
  name,
  tradeName,
  licenseType,
  status,
});

const RAMOS_LIC = lic('J0210000150015', 'LABORATORIOS RAMOS, S.A.', 'farmacia');
const SOLKA_LIC = lic('J0310000120935', 'LABORATORIOS SOLKA, SOCIEDAD ANÓNIMA', 'farmacia');
const OLD_LIC = lic('J0310000999999', 'DISTRIBUIDORA VENCIDA, S.A.', 'dispositivo_medico', 'VENCIDA');
const MACSA_FULL = lic('J0310000000727', 'MANUFACTURERA CENTROAMERICANA DE SACOS, SOCIEDAD ANÓNIMA', 'alimentos_bebidas');

const cnzf = (name: string, section: string, domains: string[] = [], activity: string | null = null): NiCnzfCompany => ({
  name,
  section,
  activity,
  originCountry: 'USA',
  domains,
});

const P = { sourceYear: 2026, importedAt: '2026-10-07T00:00:00.000Z' };

function build(input: {
  largeTaxpayers?: NiLargeTaxpayer[];
  licenses?: NiMinsaLicense[];
  cnzf?: NiCnzfCompany[];
  conami?: NiConamiImf[];
  publicEntities?: NiPublicEntity[];
}) {
  const entries = mergeNicaraguaRucSources({ largeTaxpayers: input.largeTaxpayers ?? [], licenses: input.licenses ?? [] });
  const registryRows = [...entries.values()].map((e) => buildNiRucRegistryRow(e, P)).filter((r): r is NiSnapshotRow => r !== null);
  const owners = new Map<string, Set<string>>();
  for (const row of registryRows) for (const key of niOwnNameKeys(row)) owners.set(key, (owners.get(key) ?? new Set()).add(row.tax_id!));
  const aliasRows = registryRows.flatMap((row) =>
    buildNiRucNameAliasRows({
      registryRow: row,
      keys: dropAliasKeysOwnedByOthers(niEntryAliasKeys(entries.get(row.tax_id!)!, row.normalized_legal_name), row.tax_id!, owners),
    }),
  );
  const listings = niWebListings({ cnzf: input.cnzf ?? [], conami: input.conami ?? [], publicEntities: input.publicEntities ?? [] });
  const directory = buildNiFreeDirectoryRows({ entries, registryRows, aliasRows, listings, ...P });
  return { entries, registryRows, aliasRows, ...directory };
}

// ─── RUC ───────────────────────────────────────────────────────────────────

describe('RUC de Nicaragua', () => {
  it('persona jurídica: «J» + 13 dígitos, con o sin separadores', () => {
    assert.equal(canonicalNicaraguaRuc('J0310000002371'), 'J0310000002371');
    assert.equal(canonicalNicaraguaRuc('j031-0000-002371'), 'J0310000002371');
  });

  it('cédulas de personas naturales y largos imposibles no son RUC de empresa', () => {
    assert.equal(canonicalNicaraguaRuc('0010101800001A'), null);
    assert.equal(canonicalNicaraguaRuc('2811502710018R'), null);
    assert.equal(canonicalNicaraguaRuc('J031000000237'), null);
    assert.equal(canonicalNicaraguaRuc(null), null);
  });
});

// ─── Nombres ───────────────────────────────────────────────────────────────

describe('núcleo del nombre', () => {
  it('quita la forma societaria escrita de cualquier manera y apilada', () => {
    assert.equal(nicaraguaNameCore('CASA PELLAS SOCIEDAD ANONIMA'), 'CASA PELLAS');
    assert.equal(nicaraguaNameCore('FERRETERIA TECNICA,SOCIEDAD ANONIMA'), 'FERRETERIA TECNICA');
    assert.equal(nicaraguaNameCore('ASSA COMPAÑIA DE SEGUROS S,A'), 'ASSA COMPANIA DE SEGUROS');
    assert.equal(nicaraguaNameCore('KIMBERLY CLARK NICARAGUA & COMPAÑIA LIMITADA'), 'KIMBERLY CLARK NICARAGUA');
    assert.equal(nicaraguaNameCore('ALVARADO Y COMPAÑIA LIMITADA'), 'ALVARADO');
    assert.equal(nicaraguaNameCore('UNION DE COOPERATIVAS AGROPECUARIAS SAN JUAN RIO COCO R.L'), 'UNION DE COOPERATIVAS AGROPECUARIAS SAN JUAN RIO COCO');
    assert.equal(nicaraguaNameCore('ASTALDI S.P.A SUCURSAL NICARAGUA'), 'ASTALDI');
    assert.equal(nicaraguaNameCore('PROFESIONALES DE LA CONSTRUCCION S.A DE C.V'), 'PROFESIONALES DE LA CONSTRUCCION');
  });

  it('la forma cortada por la DGI a 50 caracteres también sale', () => {
    assert.equal(nicaraguaNameCore('CORPORACION ELECTRICA NICARAGUENSE, SOCIEDAD ANONI'), 'CORPORACION ELECTRICA NICARAGUENSE');
    assert.equal(nicaraguaNameCore('MANUFACTURERA CENTROAMERICANA DE SACOS, SOCIEDAD A'), 'MANUFACTURERA CENTROAMERICANA DE SACOS');
    assert.equal(nicaraguaNameCore('COMUNICACION TRESCIENTOS SESENTA, SOC ANONIMA'), 'COMUNICACION TRESCIENTOS SESENTA');
  });

  it('sigla o marca entre paréntesis o tras un guion: fuera del núcleo, como alias', () => {
    assert.equal(nicaraguaNameCore('HOLCIM (NICARAGUA) SOCIEDAD ANONIMA'), 'HOLCIM');
    assert.equal(nicaraguaNameCore('Textiles del Mundo de Nicaragua, S.A. - MUNDOTEX'), 'TEXTILES DEL MUNDO DE NICARAGUA');
    assert.deepEqual(nicaraguaRegistryAliasKeys('Textiles del Mundo de Nicaragua, S.A. - MUNDOTEX'), ['MUNDOTEX']);
    assert.deepEqual(nicaraguaRegistryAliasKeys('HOLCIM (NICARAGUA) SOCIEDAD ANONIMA'), []);
  });

  it('sólo la forma no deja núcleo; una forma en medio no se toca', () => {
    assert.equal(nicaraguaNameCore('S.A.'), '');
    assert.equal(nicaraguaNameCore('SA COMERCIAL DE NICARAGUA'), 'SA COMERCIAL DE NICARAGUA');
    assert.equal(endsWithNicaraguaLegalForm('Casa Pellas, S.A.'), true);
    assert.equal(endsWithNicaraguaLegalForm('Casa Pellas'), false);
  });

  it('entidades públicas: «Alcaldía Municipal de X» = «Alcaldía de X» = «Municipio de X»', () => {
    assert.equal(nicaraguaPublicEntityKey('Alcaldía Municipal de Managua'), 'ALCALDIA MANAGUA');
    assert.equal(nicaraguaPublicEntityKey('ALCALDIA DE MANAGUA'), 'ALCALDIA MANAGUA');
    assert.equal(nicaraguaPublicEntityKey('Municipio de Managua'), 'ALCALDIA MANAGUA');
    assert.equal(nicaraguaPublicEntityKey('Casa Pellas'), null);
  });

  it('variantes del candidato: con y sin «Nicaragua» (y la abreviatura «NIC» de la DGI)', () => {
    assert.deepEqual(nicaraguaCandidateNameVariants('Cemex Nicaragua').map((v) => v.core), ['CEMEX NICARAGUA', 'CEMEX', 'CEMEX DE NICARAGUA']);
    assert.deepEqual(nicaraguaCandidateNameVariants('Tropigas de Nic').map((v) => v.core), ['TROPIGAS DE NIC', 'TROPIGAS', 'TROPIGAS NICARAGUA', 'TROPIGAS DE NICARAGUA']);
    assert.deepEqual(nicaraguaCandidateNameVariants('Banpro').map((v) => [v.core, v.origin]), [
      ['BANPRO', 'name'],
      ['BANPRO NICARAGUA', 'with_nicaragua'],
      ['BANPRO DE NICARAGUA', 'with_nicaragua'],
    ]);
  });

  it('una entidad pública no gana ni pierde «Nicaragua»', () => {
    assert.deepEqual(nicaraguaCandidateNameVariants('Banco Central de Nicaragua').map((v) => v.core), ['BANCO CENTRAL DE NICARAGUA', 'BANCO CENTRAL NICARAGUA']);
  });
});

// ─── Dominios ──────────────────────────────────────────────────────────────

describe('dominios', () => {
  it('dominio registrable y dominio de empresa desde un correo o una web', () => {
    assert.equal(registrableNicaraguaDomain('ventas.casapellas.com.ni'), 'casapellas.com.ni');
    assert.equal(registrableNicaraguaDomain('ni.hansae.com'), 'hansae.com');
    assert.equal(nicaraguaCompanyDomain('mikyong@ni.hansae.com'), 'hansae.com');
    assert.equal(nicaraguaCompanyDomain('http://www.credifacilnicaragua.com/'), 'credifacilnicaragua.com');
  });

  it('correos gratuitos, de proveedores de internet o del Estado no son la web de una empresa', () => {
    assert.equal(nicaraguaCompanyDomain('tabacaleraalfambra@gmail.com'), null);
    assert.equal(nicaraguaCompanyDomain('x@ibw.com.ni'), null);
    assert.equal(nicaraguaCompanyDomain('x@yahoo.es'), null);
    assert.equal(nicaraguaCompanyDomain('x@minsa.gob.ni'), null);
    assert.equal(isNicaraguaPersonalEmailDomain('hotmail.com'), true);
  });

  it('una palabra sólo se confirma con la etiqueta exacta del dominio', () => {
    assert.equal(nicaraguaSingleWordConfirmedByDomain('www.sinsa.com.ni', 'SINSA', { publicEntity: false }), true);
    assert.equal(nicaraguaSingleWordConfirmedByDomain('sinsaonline.com', 'SINSA', { publicEntity: false }), false);
    assert.equal(nicaraguaSingleWordConfirmedByDomain('enel.gob.ni', 'ENEL', { publicEntity: false }), false);
    assert.equal(nicaraguaSingleWordConfirmedByDomain('enel.gob.ni', 'ENEL', { publicEntity: true }), true);
  });
});

// ─── Líneas de los extractores ─────────────────────────────────────────────

describe('líneas de los extractores', () => {
  it('Grandes Contribuyentes: sólo personas jurídicas', () => {
    assert.deepEqual(parseNiLargeTaxpayer({ ruc: 'J0310000002371', name: 'CASA PELLAS SOCIEDAD ANONIMA', trade_name: 'CASA PELLAS', snapshots: ['20200320'] }), {
      ruc: 'J0310000002371',
      name: 'CASA PELLAS SOCIEDAD ANONIMA',
      tradeName: 'CASA PELLAS',
      snapshots: ['20200320'],
    });
    assert.equal(parseNiLargeTaxpayer({ ruc: '1232212400003B', name: 'PERSONA' }), null);
  });

  it('licencias del MINSA: sólo personas jurídicas, estado en mayúscula', () => {
    assert.equal(parseNiMinsaLicense({ ruc: 'J0210000150015', name: 'LABORATORIOS RAMOS', license_type: 'farmacia', status: 'vigente' })?.status, 'VIGENTE');
    assert.equal(parseNiMinsaLicense({ ruc: '0810610740018E', name: 'CLÍNICA X', license_type: 'establecimiento_salud' }), null);
  });

  it('CNZF y CONAMI', () => {
    assert.equal(parseNiCnzfCompany({ name: 'Kaizen, S.A.', section: 'textil_vestuario', domains: ['kaizen.com.ni'] })?.domains[0], 'kaizen.com.ni');
    assert.equal(parseNiCnzfCompany({ name: null }), null);
    assert.equal(parseNiConamiImf({ name: 'FAMA', legal_name: 'FAMA, SOCIEDAD ANÓNIMA', url: 'www.financierafama.com.ni' })?.url, 'www.financierafama.com.ni');
  });
});

// ─── Registro y alias ──────────────────────────────────────────────────────

describe('ni_ruc_registry y ni_ruc_name_alias', () => {
  it('Gran Contribuyente: categoría y tramo para el filtro de tamaño; identidad fiscal', () => {
    const { registryRows } = build({ largeTaxpayers: [CASA_PELLAS] });
    const row = registryRows[0];
    assert.equal(row.source_key, 'ni_ruc_registry');
    assert.equal(row.country_code, 'NI');
    assert.equal(row.normalized_tax_id, 'J0310000002371');
    assert.equal(row.normalized_legal_name, 'CASA PELLAS');
    assert.equal(row.record_identity_key, 'tax:J0310000002371');
    assert.equal(row.raw_data['taxpayer_category'], NI_LARGE_TAXPAYER_CATEGORY);
    assert.equal(row.raw_data['official_size_band'], 'large');
    assert.equal(row.raw_data['metrics_year'], 2020);
  });

  it('la razón social de la DGI manda, salvo que venga cortada y el MINSA traiga la entera', () => {
    const entries = mergeNicaraguaRucSources({ largeTaxpayers: [CUT_NAME, CASA_PELLAS], licenses: [MACSA_FULL, lic(CASA_PELLAS.ruc, 'CASA PELLAS Y CIA', 'farmacia')] });
    assert.equal(niPreferredLegalName(entries.get(CUT_NAME.ruc)!), 'MANUFACTURERA CENTROAMERICANA DE SACOS, SOCIEDAD ANÓNIMA');
    assert.equal(niPreferredLegalName(entries.get(CASA_PELLAS.ruc)!), 'CASA PELLAS SOCIEDAD ANONIMA');
  });

  it('licencias del MINSA: vigentes por tipo en la fila', () => {
    const { registryRows } = build({ licenses: [RAMOS_LIC, lic(RAMOS_LIC.ruc, RAMOS_LIC.name!, 'dispositivo_medico', 'VENCIDA')] });
    assert.equal(registryRows[0].raw_data['minsa_licenses'], 2);
    assert.equal(registryRows[0].raw_data['minsa_active_licenses'], 1);
    assert.deepEqual(registryRows[0].raw_data['minsa_active_by_type'], { farmacia: 1 });
  });

  it('alias: nombre comercial, sigla letra por letra y cada marca del nombre comercial', () => {
    const { aliasRows } = build({ largeTaxpayers: [SINSA, CARGILL, CUT_NAME] });
    const keysOf = (ruc: string) => aliasRows.filter((r) => r.normalized_tax_id === ruc).map((r) => r.normalized_legal_name);
    assert.deepEqual(keysOf(SINSA.ruc), ['SINSA']);
    assert.ok(keysOf(CARGILL.ruc).includes('TIP TOP'));
    assert.ok(keysOf(CARGILL.ruc).includes('CARGILL'));
    assert.deepEqual(keysOf(CUT_NAME.ruc), ['MACSA']);
    const alias = aliasRows.find((r) => r.normalized_legal_name === 'SINSA')!;
    assert.equal(alias.source_key, 'ni_ruc_name_alias');
    assert.equal(alias.record_identity_key, 'ni-name-alias:J0310000001812:SINSA');
    assert.equal(alias.raw_data['alias_of'], 'SILVA INTERNACIONAL');
  });

  it('un consorcio no presta su nombre como alias, y un alias nunca es el nombre propio de otro RUC', () => {
    const other: NiLargeTaxpayer = { ruc: 'J0310000000001', name: 'CASA PELLAS SOCIEDAD ANONIMA', tradeName: null, snapshots: [] };
    const fake: NiLargeTaxpayer = { ruc: 'J0310000000002', name: 'INVERSIONES X SOCIEDAD ANONIMA', tradeName: 'CASA PELLAS', snapshots: [] };
    const { aliasRows } = build({ largeTaxpayers: [CONSORTIUM, other, fake] });
    assert.equal(aliasRows.filter((r) => r.normalized_tax_id === CONSORTIUM.ruc).length, 0);
    assert.equal(aliasRows.some((r) => r.normalized_tax_id === fake.ruc && r.normalized_legal_name === 'CASA PELLAS'), false);
  });
});

// ─── Tamaño ────────────────────────────────────────────────────────────────

describe('tamaño: gran contribuyente sin número de personas', () => {
  it('llega como tramo «gran contribuyente (DGI Nicaragua)» que no decide solo', () => {
    const workforce = workforceFromRawData({ taxpayer_category: 'NI_GRAN_CONTRIBUYENTE', metrics_year: 2020 }, 'ni_dgi_large_taxpayers');
    assert.deepEqual(workforce, { workers: 0, year: 2020, source: 'ni_dgi_large_taxpayers', maxWorkers: null, sizeBand: 'gran contribuyente (DGI Nicaragua)' });
  });

  it('la lectura del registro lo trae; sin la marca no hay tramo', () => {
    const { registryRows } = build({ largeTaxpayers: [CASA_PELLAS], licenses: [RAMOS_LIC] });
    const pellas = toNicaraguaNameRow(registryRows.find((r) => r.tax_id === CASA_PELLAS.ruc)! as unknown as Record<string, unknown>);
    const ramos = toNicaraguaNameRow(registryRows.find((r) => r.tax_id === RAMOS_LIC.ruc)! as unknown as Record<string, unknown>);
    assert.equal(pellas.workforce?.sizeBand, 'gran contribuyente (DGI Nicaragua)');
    assert.equal(ramos.workforce, null);
    assert.equal(pellas.alias, false);
  });
});

// ─── Resolvedor ────────────────────────────────────────────────────────────

function candidate(name: string, domain: string | null = null, countryCode = 'NI'): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, countryCode, domain, websiteUrl: null },
    criteria: { countryCode },
  } as unknown as OfficialSourceResolverInput;
}

function resolverWith(rows: Record<string, NicaraguaNameRow[]>) {
  const asked: string[] = [];
  const resolver = createNicaraguaOfficialSourceResolver({
    querySnapshots: async (core) => {
      asked.push(core);
      return rows[core] ?? [];
    },
  });
  return { resolver, asked };
}

describe('resolvedor de RUC por nombre (ni_ruc_registry)', () => {
  const workforce = { workers: 0, year: 2020, source: 'ni_dgi_large_taxpayers', maxWorkers: null, sizeBand: 'gran contribuyente (DGI Nicaragua)' };

  it('un RUC con ese núcleo → fuerte; el tamaño «gran contribuyente» viaja', async () => {
    const { resolver } = resolverWith({
      'CASA PELLAS': [{ taxId: 'J0310000002371', legalName: 'CASA PELLAS SOCIEDAD ANONIMA', normalizedLegalName: 'CASA PELLAS', workforce }],
    });
    const result = await resolver.resolve(candidate('Casa Pellas'));
    assert.equal(result.status, 'matched');
    assert.equal(result.sourceKey, 'ni_ruc_registry');
    assert.equal(result.taxIdentifier, 'J0310000002371');
    assert.equal(result.taxIdentifierType, 'RUC');
    assert.deepEqual(result.workforce, workforce);
  });

  it('variante sin «Nicaragua»: Cemex Nicaragua encuentra CEMEX NICARAGUA primero', async () => {
    const { resolver, asked } = resolverWith({
      'CEMEX NICARAGUA': [{ taxId: 'J0310000001820', legalName: 'CEMEX NICARAGUA S.A.', normalizedLegalName: 'CEMEX NICARAGUA' }],
    });
    const result = await resolver.resolve(candidate('Cemex Nicaragua'));
    assert.equal(result.status, 'matched');
    assert.deepEqual(asked, ['CEMEX NICARAGUA']);
  });

  it('por su alias (nombre comercial)', async () => {
    const { resolver } = resolverWith({
      'SUPERMERCADOS LA COLONIA': [
        { taxId: 'J0310000003858', legalName: 'CASA COMERCIAL MANTICA SOCIEDAD ANONIMA', normalizedLegalName: 'SUPERMERCADOS LA COLONIA', alias: true },
      ],
    });
    const result = await resolver.resolve(candidate('Supermercados La Colonia'));
    assert.equal(result.status, 'matched');
    assert.equal(result.legalName, 'CASA COMERCIAL MANTICA SOCIEDAD ANONIMA');
    assert.equal(result.safeMetadata?.['matchedAlias'], true);
  });

  it('dos RUC distintos → pista, nunca fuerte', async () => {
    const { resolver } = resolverWith({
      'DISTRIBUIDORA X': [
        { taxId: 'J0310000000011', legalName: 'DISTRIBUIDORA X S.A.', normalizedLegalName: 'DISTRIBUIDORA X' },
        { taxId: 'J0310000000012', legalName: 'DISTRIBUIDORA X SOCIEDAD ANONIMA', normalizedLegalName: 'DISTRIBUIDORA X' },
      ],
    });
    const result = await resolver.resolve(candidate('Distribuidora X'));
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.safeMetadata?.['ambiguous'], true);
  });

  it('una palabra: pista sin web; fuerte si la web de la candidata la confirma', async () => {
    const rows = { SINSA: [{ taxId: 'J0310000001812', legalName: 'SILVA INTERNACIONAL SOCIEDAD ANONIMA.', normalizedLegalName: 'SINSA', alias: true }] };
    const withoutWeb = await resolverWith(rows).resolver.resolve(candidate('Sinsa'));
    assert.equal(withoutWeb.status, 'low_confidence_match');
    assert.equal(withoutWeb.safeMetadata?.['singleWordName'], true);
    const withWeb = await resolverWith(rows).resolver.resolve(candidate('Sinsa', 'sinsa.com.ni'));
    assert.equal(withWeb.status, 'matched');
    assert.equal(withWeb.safeMetadata?.['singleWordConfirmedByDomain'], true);
  });

  it('sólo Nicaragua; un RUC con forma rara se ignora', async () => {
    const { resolver } = resolverWith({ 'CASA PELLAS': [{ taxId: '0010101800001A', legalName: 'X', normalizedLegalName: 'CASA PELLAS' }] });
    assert.equal(resolver.canResolve(candidate('Casa Pellas', null, 'HN')), false);
    assert.equal(resolver.canResolve(candidate('Casa Pellas')), true);
    assert.equal((await resolver.resolve(candidate('Casa Pellas'))).status, 'not_found');
  });
});

// ─── Capa gratuita ─────────────────────────────────────────────────────────

describe('clasificación de la capa gratuita', () => {
  it('sección de la CNZF; «Parques Industriales» se reparte por nombre y actividad', () => {
    assert.equal(resolveNiDirectoryMacro('cnzf', 'textil_vestuario'), 'industry_manufacturing_chemicals_automotive');
    assert.equal(resolveNiDirectoryMacro('cnzf', 'servicios_externalizados'), 'services_company');
    assert.equal(resolveNiDirectoryMacro('cnzf', 'otros'), null);
    assert.equal(niCnzfEffectiveSection('parque_industrial', 'Zona Franca Las Palmeras, S.A.', null), 'operadora_zona_franca');
    assert.equal(niCnzfEffectiveSection('parque_industrial', 'A.J. Fernández Cigars, S.A.', null), 'tabaco');
    assert.equal(niCnzfEffectiveSection('parque_industrial', 'Index de Nicaragua, S.A.', null), null);
    assert.equal(resolveNiDirectoryMacro('cnzf', 'operadora_zona_franca'), 'property_construction');
  });

  it('tipo de licencia del MINSA, CONAMI, Estado y tabla de Grandes Contribuyentes', () => {
    assert.equal(resolveNiDirectoryMacro('minsa_license', 'farmacia'), 'health_pharma');
    assert.equal(resolveNiDirectoryMacro('minsa_license', 'alimentos_bebidas'), 'consumer_goods');
    assert.equal(resolveNiDirectoryMacro('conami_imf', null), 'insurance_financial_services');
    assert.equal(resolveNiDirectoryMacro('public_entity', 'territorial'), 'government');
    assert.equal(resolveNiDirectoryMacro('large_taxpayer', 'J0310000002371'), 'retail');
    assert.equal(resolveNiDirectoryMacro('large_taxpayer', HOTEL.ruc), null);
  });

  it('la tabla de Grandes Contribuyentes sólo trae RUC de persona jurídica', () => {
    for (const ruc of Object.keys(NI_LARGE_TAXPAYER_MACRO)) assert.match(ruc, /^J\d{13}$/, ruc);
    assert.ok(Object.keys(NI_LARGE_TAXPAYER_MACRO).length >= 400);
  });

  it('cobertura: sólo macros con alguna fuente clasificada', () => {
    assert.equal(macroHasNiCoverage('health_pharma'), true);
    assert.equal(macroHasNiCoverage('government'), true);
    assert.equal(macroHasNiCoverage('no_existe'), false);
  });
});

describe('filas de la capa gratuita', () => {
  it('Gran Contribuyente clasificado entra con RUC y tamaño «grande»; un hotel no tiene macro', () => {
    const { taxRows, excluded } = build({ largeTaxpayers: [CASA_PELLAS, HOTEL] });
    assert.equal(taxRows.length, 1);
    assert.equal(taxRows[0].source_key, 'ni_free_directory');
    assert.equal(taxRows[0].raw_data['directory_kind'], 'large_taxpayer');
    assert.equal(taxRows[0].raw_data['macro_industry_key'], 'retail');
    assert.equal(taxRows[0].raw_data['official_size_band'], 'large');
    assert.equal(excluded.no_macro, 1);
  });

  it('MINSA: sólo con una licencia vigente; el tipo dominante clasifica', () => {
    const { taxRows, excluded } = build({ licenses: [RAMOS_LIC, SOLKA_LIC, OLD_LIC] });
    assert.deepEqual(taxRows.map((r) => r.normalized_tax_id).sort(), [RAMOS_LIC.ruc, SOLKA_LIC.ruc].sort());
    assert.equal(taxRows[0].raw_data['directory_kind'], 'minsa_license');
    assert.equal(taxRows[0].raw_data['activity_code'], 'farmacia');
    assert.equal(excluded.not_relevant, 1);
  });

  it('una ficha de la CNZF con el nombre de un RUC del registro se une a él (y le da su web)', () => {
    const { taxRows, webRows } = build({ largeTaxpayers: [CASA_PELLAS], cnzf: [cnzf('Casa Pellas, S.A.', 'servicios_logisticos', ['casapellas.com'])] });
    assert.equal(webRows.length, 0);
    assert.equal(taxRows.length, 1);
    assert.equal(taxRows[0].raw_data['directory_kind'], 'cnzf');
    assert.equal(taxRows[0].raw_data['website_domain'], 'casapellas.com');
    assert.equal(taxRows[0].raw_data['free_zone'], true);
  });

  it('sin RUC: entra sólo con web propia, identidad por dominio; nunca correo, contacto ni teléfono', () => {
    const { webRows, excluded } = build({
      cnzf: [cnzf('Kaizen, S.A.', 'textil_vestuario', ['kaizen.com.ni']), cnzf('Hoja Latina, S.A.', 'tabaco')],
      conami: [{ name: 'FAMA', legalName: 'FAMA, SOCIEDAD ANÓNIMA', url: 'www.financierafama.com.ni', category: 'B' }],
      publicEntities: [{ domain: 'minsa.gob.ni', name: 'Ministerio de Salud', kind: 'national' }],
    });
    assert.deepEqual(webRows.map((r) => r.record_identity_key).sort(), ['ni-web:financierafama.com.ni', 'ni-web:kaizen.com.ni', 'ni-web:minsa.gob.ni']);
    assert.ok(webRows.every((r) => r.source_key === 'ni_free_directory_web' && r.normalized_tax_id === null));
    assert.equal(excluded.no_ruc_no_web, 1);
    const serialized = JSON.stringify(webRows);
    assert.doesNotMatch(serialized, /@|contact|phone|telefono/i);
    const ministry = webRows.find((r) => r.record_identity_key === 'ni-web:minsa.gob.ni')!;
    assert.equal(ministry.raw_data['macro_industry_key'], 'government');
    assert.equal(ministry.raw_data['website_origin'], 'official_site');
  });

  it('un dominio compartido por dos fichas no identifica a ninguna', () => {
    const { webRows } = build({
      cnzf: [cnzf('Empresa Uno, S.A.', 'textil_vestuario', ['grupo.com']), cnzf('Empresa Dos, S.A.', 'textil_vestuario', ['grupo.com'])],
    });
    assert.equal(webRows.length, 0);
  });

  it('un consorcio no entra', () => {
    const { taxRows, excluded } = build({ largeTaxpayers: [CONSORTIUM] });
    assert.equal(taxRows.length, 0);
    assert.equal(excluded.consortium, 1);
  });

  it('las entidades públicas de la tabla tienen dominio .gob.ni o .edu.ni y no se repiten', () => {
    const domains = NI_PUBLIC_ENTITIES.map((e) => e.domain);
    assert.equal(new Set(domains).size, domains.length);
    for (const d of domains) assert.match(d, /\.(gob|edu)\.ni$/, d);
  });
});

// ─── Adaptador ─────────────────────────────────────────────────────────────

function readRow(overrides: Partial<NiFreeDirectorySnapshotReadRow>): NiFreeDirectorySnapshotReadRow {
  return {
    record_identity_key: 'tax:J0310000002371',
    ruc: 'J0310000002371',
    legal_name: 'CASA PELLAS SOCIEDAD ANONIMA',
    normalized_legal_name: 'CASA PELLAS',
    city: null,
    region: null,
    directory_kind: 'large_taxpayer',
    activity_code: 'J0310000002371',
    public_entity_kind: null,
    website_domain: null,
    official_size_band: 'large',
    priority_score: 1_000_000,
    ...overrides,
  };
}

describe('adaptador de la capa gratuita de Nicaragua', () => {
  const adapterWith = (rows: NiFreeDirectorySnapshotReadRow[]) => {
    const asked: string[] = [];
    const adapter = buildNiFreeDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async ({ macroIndustryKey }) => {
        asked.push(macroIndustryKey);
        return rows;
      },
    });
    return { adapter, asked };
  };

  it('ofrece la empresa con RUC, tabla oficial y tamaño «grande»', async () => {
    const { adapter } = adapterWith([readRow({})]);
    const result = await adapter({ macroIndustryKey: 'retail', limit: 10 } as never);
    assert.equal(result.sourceKey, NI_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.companies.length, 1);
    const company = result.companies[0];
    assert.equal(company.taxId, 'J0310000002371');
    assert.equal(company.taxIdentifierType, 'RUC');
    assert.equal(company.countryCode, 'NI');
    assert.deepEqual(company.officialSizeBand, { band: 'large', sourceLabel: NI_LARGE_TAXPAYER_SIZE_LABEL });
    assert.deepEqual(company.officialMacroIndustry?.macroIndustryKeys, ['retail']);
  });

  it('manda la clasificación de HOY: una fila cuya macro cambió no se ofrece', async () => {
    const { adapter } = adapterWith([readRow({})]);
    const result = await adapter({ macroIndustryKey: 'technology', limit: 10 } as never);
    assert.equal(result.companies.length, 0);
  });

  it('sin RUC sólo con web; la entidad pública dice su tipo', async () => {
    const { adapter } = adapterWith([
      readRow({ record_identity_key: 'ni-web:minsa.gob.ni', ruc: null, legal_name: 'Ministerio de Salud', directory_kind: 'public_entity', activity_code: 'national', public_entity_kind: 'national', website_domain: 'minsa.gob.ni', official_size_band: null }),
      readRow({ record_identity_key: 'ni-web:x', ruc: null, legal_name: 'Sin web', directory_kind: 'public_entity', activity_code: 'national', public_entity_kind: 'national', website_domain: null, official_size_band: null }),
    ]);
    const result = await adapter({ macroIndustryKey: 'government', limit: 10 } as never);
    assert.equal(result.companies.length, 1);
    assert.equal(result.companies[0].domain, 'minsa.gob.ni');
    assert.equal(result.companies[0].taxId, null);
    assert.equal(result.companies[0].declaredIndustry, 'Entidad pública nacional');
  });

  it('una macro sin fuente clasificada no consulta', async () => {
    const { adapter, asked } = adapterWith([readRow({})]);
    const result = await adapter({ macroIndustryKey: 'no_existe', limit: 10 } as never);
    assert.equal(result.companies.length, 0);
    assert.deepEqual(asked, []);
  });
});

// ─── Cableado, familias y catálogo ─────────────────────────────────────────

describe('cableado y familias de fuente', () => {
  it('la fábrica usa el resolvedor de Nicaragua con su lectura (registro + alias), sólo lectura', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /createNicaraguaOfficialSourceResolver\(\{\s*querySnapshots: buildNicaraguaSnapshotNameQuery\(snapshotClient\),\s*\}\)/);
    const query = read('src/server/prospect-batches/nicaragua-snapshot-query.ts');
    assert.match(query, /\.in\('source_key', \[NI_RUC_REGISTRY_SOURCE_KEY, NI_RUC_NAME_ALIAS_SOURCE_KEY\]\)/);
    assert.doesNotMatch(query, /\.(insert|update|upsert|delete)\(/);
    const discovery = read('src/server/prospect-batches/country-source-discovery/ni-free-directory-snapshot-query.ts');
    assert.doesNotMatch(discovery, /\.(insert|update|upsert|delete)\(/);
  });

  it('la capa gratuita de Nicaragua está cableada', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('NI'));
    const capability = resolveCountrySourceCapability('NI');
    assert.equal(capability?.sourceKey, NI_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(countrySourceMacroHasCoverage('NI', 'health_pharma'), true);
    assert.equal(countrySourceMacroHasCoverage('NI', 'no_existe'), false);
    const gate = read('src/server/prospect-batches/country-source-discovery/prepaid-novelty-gate.server.ts');
    assert.match(gate, /niFreeDirectoryDiscoveryReads: buildNiFreeDirectoryDiscoveryReads\(adminClient\)/);
  });

  it('familias: un RUC una fila en registro y directorio; varias en alias y en la capa sin RUC', () => {
    assert.equal(getSourceFamily('ni_ruc_registry'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('ni_free_directory'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('ni_ruc_name_alias'), 'NATIVE_RECORD_GRAIN');
    assert.equal(getSourceFamily('ni_free_directory_web'), 'NATIVE_RECORD_GRAIN');
  });

  it('catálogo: estado honesto (conectada, pendiente de carga) y fuera de las recomendaciones', () => {
    const expected = {
      ni_ruc_registry: 'connected_identity_in_run',
      ni_free_directory: 'connected_free_discovery',
      ni_free_directory_web: 'connected_free_discovery',
    } as const;
    for (const [key, status] of Object.entries(expected)) {
      const source = CATALOG_SOURCES.find((s) => s.key === key);
      assert.ok(source, key);
      assert.deepEqual(source.countryCodes, ['NI']);
      assert.equal(source.aiFlowStatus, status);
      assert.equal(source.connectionMode, 'read_only_snapshot');
      assert.equal(source.operationalStatus, 'pending_validation', `${key}: no está cargada todavía`);
      assert.deepEqual(source.sectors, []);
      for (const depth of ['basic', 'standard', 'deep'] as const) {
        for (const industry of ['technology', 'health_pharma', 'government']) {
          const ctx = getCatalogContext({ country: 'NI', countryCode: 'NI', industry, searchDepth: depth });
          assert.equal(ctx.recommendedSources.some((r) => r.key === key), false, `${key} ${industry} ${depth}`);
        }
      }
    }
    assert.doesNotMatch(COUNTRY_RISKS.NI.join(' '), /no publica una fuente gratuita y accesible/);
  });
});
