/**
 * SOURCES-VE-CLOSE-1 — RIF, nombres, dominios, filas de carga, resolvedor y capa
 * gratuita de Venezuela. Cero E/S. Los nombres y RIF de empresas reales salen de
 * fuentes públicas (Bolsa de Caracas, SUDEASEG, SUNAVAL, GLEIF, webs oficiales).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  calculateVenezuelaRifCheckDigit,
  getTaxIdentifierRule,
  normalizeVenezuelaRif,
  validateTaxIdentifier,
} from '@/modules/prospect-batches/tax-identifier-rules';
import {
  hasVenezuelaLegalForm,
  venezuelaCandidateNameVariants,
  venezuelaNameCore,
  venezuelaPublicEntityKey,
  venezuelaRegistryAliasKeys,
} from '../ve-name-keys';
import {
  isVenezuelaPersonalEmailDomain,
  venezuelaCompanyDomain,
  venezuelaPublicEntityDomain,
  venezuelaSingleWordConfirmedByDomain,
} from '../ve-domain';
import {
  canonicalVenezuelaRif,
  parseVeBvcIssuer,
  parseVeBvcMember,
  parseVeGleifEntity,
  parseVeSudeasegEntity,
  parseVeSunavalEntity,
  type VeBvcIssuer,
  type VeBvcMember,
  type VeGleifEntity,
  type VeSudeasegEntity,
  type VeSunavalEntity,
} from '../ve-sources-input';
import {
  buildVeFreeDirectoryRows,
  buildVeRegistryAndAliasRows,
  mergeVenezuelaRifSources,
  parseVeCompanyWebLine,
  veWebListings,
  type VeCompanyWebMatch,
} from '../ve-sources-rows';
import { VE_WEB_ENTITIES, type VeWebEntity } from '../ve-web-entities';
import { VE_PUBLIC_ENTITIES, type VePublicEntity } from '../ve-public-entities';
import { veCompanyWebCandidates, veCompanyWebVerdict, type VeFetchedPage } from '../ve-company-web';
import {
  createVenezuelaOfficialSourceResolver,
  type VenezuelaNameRow,
} from '@/server/agents/prospect-intake/resolvers/venezuela-official-source-resolver';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';
import { toVenezuelaNameRow } from '@/server/prospect-batches/venezuela-snapshot-query';
import {
  buildVeFreeDirectoryDiscoveryAdapter,
  VE_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type VeFreeDirectorySnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/ve-free-directory-discovery-adapter';
import {
  macroHasVeCoverage,
  resolveVeDirectoryMacro,
} from '@/server/prospect-batches/country-source-discovery/ve-free-directory-macro-table';
import { VE_LISTED_COMPANY_MACRO } from '@/server/prospect-batches/country-source-discovery/ve-listed-company-macro-table';
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

const CEMEX: VeBvcIssuer = {
  code: '136',
  name: 'CEMEX VENEZUELA, SACA. (ANT.VENCEMOS)',
  rif: 'J-00282860-9',
  sector: 'Industria Manufacturera y Construccion',
  activity: 'Su objeto es la fabricacion y el comercio de toda clase de cementos',
  web: 'www.cemex.com.ve',
  emailDomains: ['cemex.com'],
};
const BNC: VeBvcIssuer = {
  code: '57',
  name: 'BANCO NACIONAL DE CREDITO, C.A. BCO.UNIV',
  rif: 'J-30984132-7',
  sector: 'Banca Universal',
  activity: 'Bancos universales',
  web: 'www.bncenlinea.com',
  emailDomains: [],
};
const COBECA: VeBvcIssuer = {
  code: '409',
  name: 'COMERCIAL BELLOSO, C.A. (COBECA)',
  rif: 'J-07000397-9',
  sector: 'Comercio y Hoteles',
  activity: 'Comercialización de medicinas',
  web: 'www.grupocobeca.com',
  emailDomains: ['gmail.com'],
};
const VENCRED: VeBvcMember = { code: '2', name: 'VALORES VENCRED CASA DE BOLSA, S.A.', rif: 'J-00222609-9', web: 'www.valoresvencred.com', emailDomains: ['valoresvencred.com'] };
const SEGUROS_CARACAS: VeSudeasegEntity = { name: 'SEGUROS CARACAS, C.A', rif: 'J-00038923-3', category: 'empresas-seguros' };
const OCCIDENTAL: VeSudeasegEntity = { name: 'C.A. DE SEGUROS LA OCCIDENTAL', rif: 'J-00016718-0', category: 'empresas-seguros' };
const BOD_SUNAVAL: VeSunavalEntity = { name: 'BANCO OCCIDENTAL DE DESCUENTO, BANCO UNIVERSAL, C.A.', rif: 'J-30061946-0', kind: 'emisor' };
const CONTADORES: VeSunavalEntity = { name: 'YANES & YANES CONTADORES PÚBLICOS', rif: 'J-30123456-0', kind: 'firma_contadores' };
const DIGITEL_GLEIF: VeGleifEntity = { name: 'Corporación Digitel, C.A.', otherNames: [], rif: 'J-30468971-3', active: true };

const web = (overrides: Partial<VeWebEntity>): VeWebEntity => ({
  qid: 'Q5276240',
  name: 'Corporación Digitel',
  domain: 'digitel.com.ve',
  kind: 'company',
  macro: 'technology',
  rif: 'J-30468971-3',
  ...overrides,
});
const pub = (overrides: Partial<VePublicEntity>): VePublicEntity => ({
  domain: 'mpps.gob.ve',
  name: 'Ministerio del Poder Popular para la Salud',
  kind: 'national',
  rif: null,
  wikidata: null,
  ...overrides,
});

function build(input: {
  bvcIssuers?: VeBvcIssuer[];
  bvcMembers?: VeBvcMember[];
  sudeaseg?: VeSudeasegEntity[];
  sunaval?: VeSunavalEntity[];
  gleif?: VeGleifEntity[];
  webEntities?: VeWebEntity[];
  publicEntities?: VePublicEntity[];
  webByRif?: Map<string, VeCompanyWebMatch>;
}) {
  const listings = veWebListings({ webEntities: input.webEntities ?? [], publicEntities: input.publicEntities ?? [] });
  const entries = mergeVenezuelaRifSources({
    bvcIssuers: input.bvcIssuers ?? [],
    bvcMembers: input.bvcMembers ?? [],
    sudeaseg: input.sudeaseg ?? [],
    sunaval: input.sunaval ?? [],
    gleif: input.gleif ?? [],
    listings,
  });
  const params = { sourceYear: 2026, importedAt: '2026-10-13T00:00:00.000Z' };
  const { registryRows, aliasRows } = buildVeRegistryAndAliasRows(entries, params);
  const directory = buildVeFreeDirectoryRows({ entries, registryRows, aliasRows, listings, webByRif: input.webByRif, ...params });
  return { entries, registryRows, aliasRows, ...directory };
}

// ─── RIF ───────────────────────────────────────────────────────────────────

describe('RIF de Venezuela', () => {
  it('dígito verificador: letra ×4 + 8 dígitos ×3,2,7,6,5,4,3,2; 10 u 11 → 0', () => {
    assert.equal(calculateVenezuelaRifCheckDigit('J', '07013380'), 5); // Banesco
    assert.equal(calculateVenezuelaRifCheckDigit('J', '00282860'), 9); // Cemex
    assert.equal(calculateVenezuelaRifCheckDigit('G', '20000110'), 0); // BCV
    assert.equal(calculateVenezuelaRifCheckDigit('X', '00000001'), null);
  });

  it('las fuentes lo escriben de muchas maneras; el canónico es «J-00282860-9»', () => {
    assert.equal(canonicalVenezuelaRif('J - 002828609'), 'J-00282860-9');
    assert.equal(canonicalVenezuelaRif('J002828609'), 'J-00282860-9');
    assert.equal(canonicalVenezuelaRif('j-30984132-7'), 'J-30984132-7');
    assert.equal(canonicalVenezuelaRif('J-50237306.3'), 'J-50237306-3');
    assert.equal(canonicalVenezuelaRif('G-20009997-6'), 'G-20009997-6');
  });

  it('verificador malo, relleno, persona natural o longitud imposible: no es RIF de empresa', () => {
    assert.equal(canonicalVenezuelaRif('J-00282860-8'), null);
    assert.equal(canonicalVenezuelaRif('J-12345678-9'), null);
    assert.equal(canonicalVenezuelaRif('V-12345678-1'), null);
    assert.equal(canonicalVenezuelaRif('J29815152'), null);
    assert.equal(canonicalVenezuelaRif(''), null);
  });

  it('regla de captura: RIF con verificador, tipo «RIF»', () => {
    const rule = getTaxIdentifierRule('VE');
    assert.equal(rule?.label, 'RIF');
    assert.equal(normalizeVenezuelaRif('j 07013380 5'), 'J-07013380-5');
    assert.deepEqual(validateTaxIdentifier('J-07013380-5', 'VE'), { valid: true, normalized: 'J-07013380-5' });
    assert.equal(validateTaxIdentifier('J-07013380-4', 'VE').valid, false);
    assert.equal(validateTaxIdentifier('ABC', 'VE').valid, false);
  });

  it('la migración 146 sólo amplía el CHECK de tipos fiscales con RIF', () => {
    const sql = read('supabase/migrations/146_tax_identifier_type_rif.sql').replace(/--.*$/gm, '');
    assert.match(sql, /'EIN', 'NIF', 'RIF'\s*\)\);/);
    assert.match(sql, /'EIN', 'NIF', 'RIF', NULL/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|create table|create function|create trigger)\b/i);
  });
});

// ─── Nombres ───────────────────────────────────────────────────────────────

describe('núcleo del nombre', () => {
  it('la forma al final y lo que la sigue sale del núcleo', () => {
    assert.equal(venezuelaNameCore('BANCO NACIONAL DE CREDITO, C.A. BANCO UNIVERSAL'), 'BANCO NACIONAL DE CREDITO');
    assert.equal(venezuelaNameCore('MARSH VENEZUELA C.A., SOCIEDAD DE CORRETAJE DE SEGUROS.'), 'MARSH VENEZUELA');
    assert.equal(venezuelaNameCore('CERÁMICA CARABOBO, S.A.C.A.'), 'CERAMICA CARABOBO');
    assert.equal(venezuelaNameCore('AJUSTES NARANJO AJUSNAR AJUSTADORES DE PÉRDIDAS S.R.L.'), 'AJUSTES NARANJO AJUSNAR AJUSTADORES DE PERDIDAS');
    assert.equal(venezuelaNameCore('ASOCIACIÓN COOPERATIVA LÍDER DE SEGUROS PARA VEHÍCULOS, R.L.'), 'ASOCIACION COOPERATIVA LIDER DE SEGUROS PARA VEHICULOS');
  });

  it('la forma al principio también sale («C.A. DE SEGUROS LA OCCIDENTAL»)', () => {
    assert.equal(venezuelaNameCore('C.A. DE SEGUROS LA OCCIDENTAL'), 'SEGUROS LA OCCIDENTAL');
    assert.equal(venezuelaNameCore('C.A. RON SANTA TERESA,'), 'RON SANTA TERESA');
    assert.equal(venezuelaNameCore('C.N.A. DE SEGUROS LA PREVISORA'), 'SEGUROS LA PREVISORA');
  });

  it('el descriptor sin forma («BANCO UNIVERSAL», «CASA DE BOLSA») sale', () => {
    assert.equal(venezuelaNameCore('Bancamiga Banco Universal'), 'BANCAMIGA');
    assert.equal(venezuelaNameCore('KAIZEN CASA DE BOLSA C.A.'), 'KAIZEN');
  });

  it('paréntesis: la sigla es alias; el nombre anterior, el estado o una nota nunca', () => {
    assert.equal(venezuelaNameCore('COMERCIAL BELLOSO, C.A. (COBECA)'), 'COMERCIAL BELLOSO');
    assert.deepEqual(venezuelaRegistryAliasKeys('COMERCIAL BELLOSO, C.A. (COBECA)'), ['COBECA']);
    assert.deepEqual(venezuelaRegistryAliasKeys('CEMEX VENEZUELA, SACA. (ANT.VENCEMOS)'), []);
    assert.deepEqual(venezuelaRegistryAliasKeys('VIDA MEDICINA PREPAGADA, C.A. (ANTES ASISTENSI)'), []);
    assert.deepEqual(venezuelaRegistryAliasKeys('(SUSPENDIDA) INTERFIN FINANCIADORA DE PRIMAS, C.A'), []);
    assert.deepEqual(venezuelaRegistryAliasKeys('INDUSTRIAS HUGG 82, C.A. (PYMES)'), []);
    assert.equal(venezuelaNameCore('(SUSPENDIDA) INTERFIN FINANCIADORA DE PRIMAS, C.A'), 'INTERFIN FINANCIADORA DE PRIMAS');
  });

  it('«Corporación X» también se busca como «X»', () => {
    assert.deepEqual(venezuelaRegistryAliasKeys('Corporación Digitel, C.A.'), ['DIGITEL']);
    // Un ente público no pierde «Corporación»: sólo gana su clave pública.
    assert.deepEqual(venezuelaRegistryAliasKeys('CORPORACION VENEZOLANA DE GUAYANA'), ['CORPORACION VENEZOLANA GUAYANA']);
  });

  it('sólo la forma no deja núcleo', () => {
    assert.equal(venezuelaNameCore('C.A.'), '');
    assert.equal(venezuelaNameCore('S.A.'), '');
    assert.equal(hasVenezuelaLegalForm('Seguros Caracas C.A.'), true);
    assert.equal(hasVenezuelaLegalForm('Seguros Caracas'), false);
  });

  it('entes públicos: «Alcaldía del Municipio Chacao» = «Alcaldía de Chacao»; sin «Poder Popular»', () => {
    assert.equal(venezuelaPublicEntityKey('Alcaldía del Municipio Chacao'), 'ALCALDIA CHACAO');
    assert.equal(venezuelaPublicEntityKey('ALCALDIA DE CHACAO'), 'ALCALDIA CHACAO');
    assert.equal(venezuelaPublicEntityKey('Gobernación Bolivariana del Estado Miranda'), 'GOBERNACION MIRANDA');
    assert.equal(venezuelaPublicEntityKey('Ministerio del Poder Popular para la Salud'), 'MINISTERIO SALUD');
    assert.equal(venezuelaPublicEntityKey('Ministerio de Salud'), 'MINISTERIO SALUD');
    assert.equal(venezuelaPublicEntityKey('Farmatodo'), null);
  });

  it('variantes del candidato: con y sin «Venezuela»; los bancos y entes no pierden el país', () => {
    const cores = (name: string) => venezuelaCandidateNameVariants(name).map((v) => v.core);
    assert.deepEqual(cores('Cemex Venezuela').slice(0, 2), ['CEMEX VENEZUELA', 'CEMEX']);
    assert.ok(cores('Cemex').includes('CEMEX VENEZUELA'));
    assert.deepEqual(cores('Banco de Venezuela'), ['BANCO DE VENEZUELA']);
    assert.equal(cores('Universidad Central de Venezuela').includes('UNIVERSIDAD CENTRAL'), false);
  });
});

// ─── Dominios ──────────────────────────────────────────────────────────────

describe('dominios', () => {
  it('web de empresa: registrable, sin correos gratuitos, de proveedores, del Estado ni plataformas', () => {
    assert.equal(venezuelaCompanyDomain('www.bancaribe.com.ve'), 'bancaribe.com.ve');
    assert.equal(venezuelaCompanyDomain('https://portal.unitec.edu.ve/inicio'), 'unitec.edu.ve');
    assert.equal(venezuelaCompanyDomain('ventas@cemex.com'), 'cemex.com');
    assert.equal(venezuelaCompanyDomain('alguien@gmail.com'), null);
    assert.equal(venezuelaCompanyDomain('alguien@cantv.net'), null);
    assert.equal(venezuelaCompanyDomain('corpoelec.gob.ve'), null);
    assert.equal(venezuelaCompanyDomain('instagram.com/bodegaspomar'), null);
    assert.equal(isVenezuelaPersonalEmailDomain('hotmail.com'), true);
  });

  it('web de ente público: el subdominio .gob.ve se guarda entero', () => {
    assert.equal(venezuelaPublicEntityDomain('http://www.mpps.gob.ve/'), 'mpps.gob.ve');
    assert.equal(venezuelaPublicEntityDomain('corposalud.merida.gob.ve'), 'corposalud.merida.gob.ve');
    assert.equal(venezuelaPublicEntityDomain('www.ucv.ve'), 'ucv.ve');
  });

  it('una palabra sólo se confirma con la etiqueta exacta; un dominio del Estado sólo a un ente', () => {
    assert.equal(venezuelaSingleWordConfirmedByDomain('digitel.com.ve', 'DIGITEL', { publicEntity: false }), true);
    assert.equal(venezuelaSingleWordConfirmedByDomain('digitel-shop.com', 'DIGITEL', { publicEntity: false }), false);
    assert.equal(venezuelaSingleWordConfirmedByDomain('cantv.gob.ve', 'CANTV', { publicEntity: false }), false);
    assert.equal(venezuelaSingleWordConfirmedByDomain('seniat.gob.ve', 'SENIAT', { publicEntity: true }), true);
  });
});

// ─── Líneas de los extractores ─────────────────────────────────────────────

describe('líneas de los extractores', () => {
  it('Bolsa de Caracas: RIF normalizado; casas de bolsa sólo activas', () => {
    const issuer = parseVeBvcIssuer({ code: '1', name: 'X, C.A.', rif: 'J000146780', sector: 'S', activity: 'a', web: 'x.com', email_domains: ['x.com'] });
    assert.equal(issuer?.rif, 'J-00014678-0');
    assert.equal(parseVeBvcIssuer({ code: '1', name: 'X', rif: 'J29815152' }), null);
    assert.equal(parseVeBvcMember({ code: '2', name: 'Y', rif: 'J-00222609-9', status: 'A' })?.rif, 'J-00222609-9');
    assert.equal(parseVeBvcMember({ code: '2', name: 'Y', rif: 'J-00222609-9', status: 'I' }), null);
  });

  it('SUDEASEG y SUNAVAL: sólo activas con RIF válido', () => {
    assert.ok(parseVeSudeasegEntity({ name: 'SEGUROS CARACAS, C.A', rif: 'J - 000389233', category: 'empresas-seguros', status: 'activo' }));
    assert.equal(parseVeSudeasegEntity({ name: 'INTERFIN', rif: 'J - 405456485', category: 'financiadoras-primas', status: 'suspendido' }), null);
    assert.ok(parseVeSunavalEntity({ kind: 'emisor', name: 'NETUNO, C.A.', rif: 'J-30108335-0', status: 'ACTIVO' }));
    assert.equal(parseVeSunavalEntity({ kind: 'emisor', name: 'COCA-COLA FEMSA', rif: 'J-3038621-6', status: 'ACTIVO' }), null);
  });

  it('GLEIF: el RIF sale de «registeredAs» sólo si es un RIF válido', () => {
    assert.equal(parseVeGleifEntity({ name: 'X', registered_as: 'J070133805', entity_status: 'ACTIVE' })?.rif, 'J-07013380-5');
    assert.equal(parseVeGleifEntity({ name: 'X', registered_as: '178-237', entity_status: 'ACTIVE' }), null);
  });
});

// ─── Registro y alias ──────────────────────────────────────────────────────

describe('ve_rif_registry y ve_rif_name_alias', () => {
  it('un RIF, una fila: la Bolsa manda en la razón social; orígenes y marca de cotizada', () => {
    const { registryRows } = build({ bvcIssuers: [CEMEX], gleif: [{ ...DIGITEL_GLEIF, rif: CEMEX.rif, name: 'Cemex Venezuela S.A.C.A.' }] });
    assert.equal(registryRows.length, 1);
    const row = registryRows[0];
    assert.equal(row.tax_id, 'J-00282860-9');
    assert.equal(row.legal_name, CEMEX.name);
    assert.equal(row.normalized_legal_name, 'CEMEX VENEZUELA');
    assert.equal(row.record_identity_key, 'tax:J-00282860-9');
    assert.deepEqual(row.raw_data['origins'], ['bvc_issuer', 'gleif']);
    assert.equal(row.raw_data['stock_exchange_listed'], true);
    assert.equal(row.raw_data['tax_identifier_type'], 'RIF');
  });

  it('alias: la sigla, el nombre en otra fuente y «sin Corporación»', () => {
    const { aliasRows } = build({ bvcIssuers: [COBECA], gleif: [DIGITEL_GLEIF] });
    const keys = aliasRows.map((r) => `${r.tax_id}:${r.normalized_legal_name}`).sort();
    assert.deepEqual(keys, ['J-07000397-9:COBECA', 'J-30468971-3:DIGITEL']);
    assert.ok(aliasRows.every((r) => String(r.record_identity_key).startsWith('ve-name-alias:')));
  });

  it('un alias nunca es el nombre propio de otro RIF', () => {
    const other: VeSudeasegEntity = { name: 'COBECA, C.A.', rif: 'J-30108335-0', category: 'corretaje-seguros' };
    const { aliasRows } = build({ bvcIssuers: [COBECA], sudeaseg: [other] });
    assert.equal(aliasRows.some((r) => r.normalized_legal_name === 'COBECA'), false);
  });

  it('la lectura del registro marca el alias y nunca trae tamaño', () => {
    const { aliasRows } = build({ bvcIssuers: [COBECA] });
    const row = toVenezuelaNameRow(aliasRows[0] as unknown as Record<string, unknown>);
    assert.equal(row.alias, true);
    assert.equal(row.taxId, 'J-07000397-9');
    assert.equal('workforce' in row, false);
  });
});

// ─── Resolvedor ────────────────────────────────────────────────────────────

function candidate(name: string, domain: string | null = null, countryCode = 'VE'): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, countryCode, domain, websiteUrl: null },
    criteria: { countryCode },
  } as unknown as OfficialSourceResolverInput;
}

function resolverWith(rows: Record<string, VenezuelaNameRow[]>) {
  const asked: string[] = [];
  const resolver = createVenezuelaOfficialSourceResolver({
    querySnapshots: async (core) => {
      asked.push(core);
      return rows[core] ?? [];
    },
  });
  return { resolver, asked };
}

describe('resolvedor de RIF por nombre (ve_rif_registry)', () => {
  it('un RIF con ese núcleo → fuerte, tipo RIF, sin tamaño', async () => {
    const { resolver } = resolverWith({
      'SEGUROS CARACAS': [{ taxId: 'J-00038923-3', legalName: 'SEGUROS CARACAS, C.A', normalizedLegalName: 'SEGUROS CARACAS' }],
    });
    const result = await resolver.resolve(candidate('Seguros Caracas'));
    assert.equal(result.status, 'matched');
    assert.equal(result.sourceKey, 've_rif_registry');
    assert.equal(result.taxIdentifier, 'J-00038923-3');
    assert.equal(result.taxIdentifierType, 'RIF');
    assert.equal(result.workforce, undefined);
  });

  it('variante con «Venezuela»: «Cemex» encuentra CEMEX VENEZUELA pero es UNA palabra', async () => {
    const rows = { 'CEMEX VENEZUELA': [{ taxId: 'J-00282860-9', legalName: CEMEX.name, normalizedLegalName: 'CEMEX VENEZUELA' }] };
    const withoutWeb = await resolverWith(rows).resolver.resolve(candidate('Cemex'));
    assert.equal(withoutWeb.status, 'low_confidence_match');
    const withWeb = await resolverWith(rows).resolver.resolve(candidate('Cemex', 'cemex.com.ve'));
    assert.equal(withWeb.status, 'matched');
  });

  it('por alias: «Digitel» con su web → fuerte', async () => {
    const { resolver } = resolverWith({
      DIGITEL: [{ taxId: 'J-30468971-3', legalName: 'Corporación Digitel, C.A.', normalizedLegalName: 'DIGITEL', alias: true }],
    });
    const result = await resolver.resolve(candidate('Digitel', 'digitel.com.ve'));
    assert.equal(result.status, 'matched');
    assert.equal(result.legalName, 'Corporación Digitel, C.A.');
    assert.equal(result.safeMetadata?.['matchedAlias'], true);
  });

  it('dos RIF distintos → pista, nunca fuerte', async () => {
    const { resolver } = resolverWith({
      'SEGUROS LA FE': [
        { taxId: 'J-00038923-3', legalName: 'SEGUROS LA FE, C.A', normalizedLegalName: 'SEGUROS LA FE' },
        { taxId: 'J-30108335-0', legalName: 'SEGUROS LA FE S.A.', normalizedLegalName: 'SEGUROS LA FE' },
      ],
    });
    const result = await resolver.resolve(candidate('Seguros La Fe'));
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.safeMetadata?.['ambiguous'], true);
  });

  it('sólo Venezuela; un RIF con verificador malo se ignora', async () => {
    const { resolver } = resolverWith({ 'SEGUROS CARACAS': [{ taxId: 'J-00038923-4', legalName: 'X', normalizedLegalName: 'SEGUROS CARACAS' }] });
    assert.equal(resolver.canResolve(candidate('Seguros Caracas', null, 'CO')), false);
    assert.equal(resolver.canResolve(candidate('Seguros Caracas')), true);
    assert.equal((await resolver.resolve(candidate('Seguros Caracas'))).status, 'not_found');
  });
});

// ─── Capa gratuita ─────────────────────────────────────────────────────────

describe('clasificación de la capa gratuita', () => {
  it('cotizadas por su tabla; SUDEASEG, casas de bolsa y SUNAVAL por su tipo; entes → Gobierno', () => {
    assert.equal(resolveVeDirectoryMacro('listed_company', 'J-00282860-9'), 'industry_manufacturing_chemicals_automotive');
    assert.equal(resolveVeDirectoryMacro('listed_company', 'J-07000397-9'), 'health_pharma');
    assert.equal(resolveVeDirectoryMacro('listed_company', 'J-40338659-5'), null); // Tesorería Ymas: sin macro a propósito
    assert.equal(resolveVeDirectoryMacro('sudeaseg', 'medicina-prepagada'), 'insurance_financial_services');
    assert.equal(resolveVeDirectoryMacro('sudeaseg', 'agentes'), null);
    assert.equal(resolveVeDirectoryMacro('bvc_member', null), 'insurance_financial_services');
    assert.equal(resolveVeDirectoryMacro('sunaval', 'firma_contadores'), 'services_company');
    assert.equal(resolveVeDirectoryMacro('public_entity', 'territorial_municipality'), 'government');
    assert.equal(resolveVeDirectoryMacro('public_entity', 'otro'), null);
    assert.equal(resolveVeDirectoryMacro('private_university', 'Q7894286'), 'services_company');
    assert.equal(resolveVeDirectoryMacro('company', 'Q5276240'), 'technology');
    assert.equal(resolveVeDirectoryMacro('company', 'Q0'), null);
  });

  it('las tablas sólo traen RIF válidos y webs sin repetir', () => {
    for (const rif of Object.keys(VE_LISTED_COMPANY_MACRO)) assert.equal(canonicalVenezuelaRif(rif), rif, rif);
    const domains = [...VE_WEB_ENTITIES.map((e) => e.domain), ...VE_PUBLIC_ENTITIES.map((e) => e.domain)];
    assert.equal(new Set(domains).size, domains.length);
    for (const entity of [...VE_WEB_ENTITIES, ...VE_PUBLIC_ENTITIES]) {
      if (entity.rif !== null) assert.equal(canonicalVenezuelaRif(entity.rif), entity.rif, entity.name);
    }
  });

  it('cobertura: sólo macros con alguna fuente clasificada', () => {
    assert.equal(macroHasVeCoverage('insurance_financial_services'), true);
    assert.equal(macroHasVeCoverage('government'), true);
    assert.equal(macroHasVeCoverage('no_existe'), false);
  });
});

describe('filas de la capa gratuita', () => {
  it('cotizada con RIF y web de la Bolsa; aseguradora por categoría', () => {
    const { taxRows } = build({ bvcIssuers: [CEMEX], sudeaseg: [SEGUROS_CARACAS] });
    const cemex = taxRows.find((r) => r.tax_id === CEMEX.rif)!;
    assert.equal(cemex.source_key, 've_free_directory');
    assert.equal(cemex.raw_data['macro_industry_key'], 'industry_manufacturing_chemicals_automotive');
    assert.equal(cemex.raw_data['website_domain'], 'cemex.com.ve');
    const caracas = taxRows.find((r) => r.tax_id === SEGUROS_CARACAS.rif)!;
    assert.equal(caracas.raw_data['directory_kind'], 'sudeaseg');
    assert.equal(caracas.raw_data['website_domain'], undefined);
    assert.ok(cemex.priority_score > caracas.priority_score);
  });

  it('nunca un correo gratuito como web; la casa de bolsa usa su web', () => {
    const { taxRows } = build({ bvcIssuers: [{ ...COBECA, web: null }], bvcMembers: [VENCRED] });
    assert.equal(taxRows.find((r) => r.tax_id === COBECA.rif)!.raw_data['website_domain'], undefined);
    assert.equal(taxRows.find((r) => r.tax_id === VENCRED.rif)!.raw_data['website_domain'], 'valoresvencred.com');
  });

  it('la web por nombre comprobada se usa sólo si la fuente no trae web, y queda marcada', () => {
    const webByRif = new Map([[SEGUROS_CARACAS.rif, { domain: 'seguroscaracas.com', check: 'page_names_company' }]]);
    const { taxRows } = build({ sudeaseg: [SEGUROS_CARACAS], webByRif });
    const row = taxRows[0];
    assert.equal(row.raw_data['website_domain'], 'seguroscaracas.com');
    assert.equal(row.raw_data['website_origin'], 'name_domain_verified');
    assert.deepEqual(parseVeCompanyWebLine({ rif: 'J - 000389233', domain: 'www.seguroscaracas.com', check: 'page_names_company' }), {
      rif: 'J-00038923-3',
      web: { domain: 'seguroscaracas.com', check: 'page_names_company' },
    });
  });

  it('web con el RIF en la portada: se une a su RIF (una empresa, una fila)', () => {
    const { taxRows, webRows } = build({ gleif: [DIGITEL_GLEIF], webEntities: [web({})] });
    assert.equal(webRows.length, 0);
    const digitel = taxRows.find((r) => r.tax_id === DIGITEL_GLEIF.rif)!;
    assert.equal(digitel.raw_data['macro_industry_key'], 'technology');
    assert.equal(digitel.raw_data['website_domain'], 'digitel.com.ve');
  });

  it('sin RIF: entra sólo con web propia, identidad por dominio', () => {
    const { webRows } = build({ publicEntities: [pub({})], webEntities: [web({ rif: null, qid: 'Q7894286', name: 'Universidad Metropolitana', domain: 'unimet.edu.ve', kind: 'private_university', macro: 'services_company' })] });
    const keys = webRows.map((r) => String(r.record_identity_key)).sort();
    assert.deepEqual(keys, ['ve-web:mpps.gob.ve', 've-web:unimet.edu.ve']);
    const ministry = webRows.find((r) => r.legal_name.startsWith('Ministerio'))!;
    assert.equal(ministry.raw_data['macro_industry_key'], 'government');
    assert.equal(ministry.raw_data['public_entity_kind'], 'national');
    for (const row of webRows) assert.doesNotMatch(JSON.stringify(row.raw_data), /@/);
  });

  it('una universidad pública es un ente público (Gobierno)', () => {
    const { webRows } = build({ webEntities: [web({ rif: null, qid: 'Q6156560', name: 'UNET', domain: 'unet.edu.ve', kind: 'public_university', macro: 'government' })] });
    assert.equal(webRows[0].raw_data['directory_kind'], 'public_entity');
    assert.equal(webRows[0].raw_data['public_entity_kind'], 'public_university');
  });

  it('un dominio compartido por dos entidades no identifica a ninguna', () => {
    const { webRows } = build({ publicEntities: [pub({}), pub({ name: 'Otro ente', wikidata: 'Q1' })] });
    assert.equal(webRows.length, 1);
  });

  it('los emisores de la SUNAVAL usan la tabla de cotizadas; las contadoras son servicios', () => {
    const { taxRows } = build({ sunaval: [BOD_SUNAVAL, CONTADORES] });
    assert.equal(taxRows.find((r) => r.tax_id === BOD_SUNAVAL.rif)!.raw_data['macro_industry_key'], 'insurance_financial_services');
    assert.equal(taxRows.find((r) => r.tax_id === CONTADORES.rif)!.raw_data['macro_industry_key'], 'services_company');
  });

  it('una aseguradora con nombre al revés («C.A. DE SEGUROS…») queda buscable por su núcleo', () => {
    const { registryRows } = build({ sudeaseg: [OCCIDENTAL] });
    assert.equal(registryRows[0].normalized_legal_name, 'SEGUROS LA OCCIDENTAL');
  });
});

// ─── Web por nombre ────────────────────────────────────────────────────────

describe('web por nombre comprobada', () => {
  const page = (overrides: Partial<VeFetchedPage>): VeFetchedPage => ({
    host: 'lamundialdeseguros.com',
    finalHost: 'lamundialdeseguros.com',
    status: 200,
    blocked: false,
    title: 'La Mundial de Seguros',
    text: 'La Mundial de Seguros, C.A. — Caracas, Venezuela',
    ...overrides,
  });

  it('candidatas sólo desde el nombre, sin palabras genéricas solas', () => {
    const hosts = veCompanyWebCandidates(['LA MUNDIAL DE SEGUROS, C.A']);
    assert.ok(hosts.includes('lamundialdeseguros.com'));
    assert.equal(veCompanyWebCandidates(['SEGUROS CARACAS, C.A']).includes('seguros.com'), false);
  });

  it('vale si la página nombra a la empresa y es de Venezuela', () => {
    const verdict = veCompanyWebVerdict(page({}), ['LA MUNDIAL DE SEGUROS, C.A']);
    assert.deepEqual(verdict, { domain: 'lamundialdeseguros.com', check: 'page_names_company', matchedKey: 'LA MUNDIAL DE SEGUROS' });
  });

  it('no vale: aparcada, de otro país, sin nombrarla o redirigida a otra empresa', () => {
    const names = ['LA MUNDIAL DE SEGUROS, C.A'];
    assert.deepEqual(veCompanyWebVerdict(page({ text: 'This domain is for sale' }), names), { rejected: 'parked' });
    assert.deepEqual(veCompanyWebVerdict(page({ text: 'La Mundial de Seguros — Madrid, España' }), names), { rejected: 'not_venezuelan' });
    assert.deepEqual(veCompanyWebVerdict(page({ title: 'Inicio', text: 'Seguros en Venezuela' }), names), { rejected: 'not_named' });
    assert.deepEqual(veCompanyWebVerdict(page({ finalHost: 'otraempresa.com' }), names), { rejected: 'redirected_elsewhere' });
    assert.deepEqual(veCompanyWebVerdict(page({ status: null, finalHost: null }), names), { rejected: 'no_response' });
  });
});

// ─── Adaptador ─────────────────────────────────────────────────────────────

function readRow(overrides: Partial<VeFreeDirectorySnapshotReadRow>): VeFreeDirectorySnapshotReadRow {
  return {
    record_identity_key: 'tax:J-00282860-9',
    rif: 'J-00282860-9',
    legal_name: 'CEMEX VENEZUELA, SACA.',
    normalized_legal_name: 'CEMEX VENEZUELA',
    city: null,
    region: null,
    directory_kind: 'listed_company',
    activity_code: 'J-00282860-9',
    public_entity_kind: null,
    website_domain: 'cemex.com.ve',
    priority_score: 1_000_001,
    ...overrides,
  };
}

describe('adaptador de la capa gratuita de Venezuela', () => {
  const adapterWith = (rows: VeFreeDirectorySnapshotReadRow[]) => {
    const asked: string[] = [];
    const adapter = buildVeFreeDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async ({ macroIndustryKey }) => {
        asked.push(macroIndustryKey);
        return rows;
      },
    });
    return { adapter, asked };
  };

  it('ofrece la empresa con RIF, web y tabla oficial; sin tamaño oficial', async () => {
    const { adapter } = adapterWith([readRow({})]);
    const result = await adapter({ macroIndustryKey: 'industry_manufacturing_chemicals_automotive', limit: 10 } as never);
    assert.equal(result.sourceKey, VE_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.companies.length, 1);
    const company = result.companies[0];
    assert.equal(company.taxId, 'J-00282860-9');
    assert.equal(company.taxIdentifierType, 'RIF');
    assert.equal(company.countryCode, 'VE');
    assert.equal(company.domain, 'cemex.com.ve');
    assert.equal(company.officialSizeBand, undefined);
    assert.deepEqual(company.officialMacroIndustry?.macroIndustryKeys, ['industry_manufacturing_chemicals_automotive']);
  });

  it('manda la clasificación de HOY: una fila cuya macro cambió no se ofrece', async () => {
    const { adapter } = adapterWith([readRow({})]);
    const result = await adapter({ macroIndustryKey: 'technology', limit: 10 } as never);
    assert.equal(result.companies.length, 0);
  });

  it('sin RIF sólo con web; el ente dice su tipo; el mismo RIF no se repite', async () => {
    const { adapter } = adapterWith([
      readRow({ record_identity_key: 've-web:mpps.gob.ve', rif: null, legal_name: 'Ministerio del Poder Popular para la Salud', directory_kind: 'public_entity', activity_code: 'national', public_entity_kind: 'national', website_domain: 'mpps.gob.ve' }),
      readRow({ record_identity_key: 've-web:x', rif: null, legal_name: 'Sin web', directory_kind: 'public_entity', activity_code: 'national', public_entity_kind: 'national', website_domain: null }),
    ]);
    const result = await adapter({ macroIndustryKey: 'government', limit: 10 } as never);
    assert.equal(result.companies.length, 1);
    assert.equal(result.companies[0].domain, 'mpps.gob.ve');
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
  it('la fábrica usa el resolvedor de Venezuela con su lectura (registro + alias), sólo lectura', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /createVenezuelaOfficialSourceResolver\(\{\s*querySnapshots: buildVenezuelaSnapshotNameQuery\(snapshotClient\),\s*\}\)/);
    const query = read('src/server/prospect-batches/venezuela-snapshot-query.ts');
    assert.match(query, /\.in\('source_key', \[VE_RIF_REGISTRY_SOURCE_KEY, VE_RIF_NAME_ALIAS_SOURCE_KEY\]\)/);
    assert.doesNotMatch(query, /\.(insert|update|upsert|delete)\(/);
    const discovery = read('src/server/prospect-batches/country-source-discovery/ve-free-directory-snapshot-query.ts');
    assert.doesNotMatch(discovery, /\.(insert|update|upsert|delete)\(/);
  });

  it('la capa gratuita de Venezuela está cableada', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('VE'));
    assert.equal(resolveCountrySourceCapability('VE')?.sourceKey, VE_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(countrySourceMacroHasCoverage('VE', 'insurance_financial_services'), true);
    assert.equal(countrySourceMacroHasCoverage('VE', 'no_existe'), false);
    const gate = read('src/server/prospect-batches/country-source-discovery/prepaid-novelty-gate.server.ts');
    assert.match(gate, /veFreeDirectoryDiscoveryReads: buildVeFreeDirectoryDiscoveryReads\(adminClient\)/);
  });

  it('familias: un RIF una fila en registro y directorio; varias en alias y en la capa sin RIF', () => {
    assert.equal(getSourceFamily('ve_rif_registry'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('ve_free_directory'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('ve_rif_name_alias'), 'NATIVE_RECORD_GRAIN');
    assert.equal(getSourceFamily('ve_free_directory_web'), 'NATIVE_RECORD_GRAIN');
  });

  it('catálogo: estado honesto (conectada) y fuera de las recomendaciones', () => {
    const expected = {
      ve_rif_registry: 'connected_identity_in_run',
      ve_free_directory: 'connected_free_discovery',
      ve_free_directory_web: 'connected_free_discovery',
    } as const;
    for (const [key, status] of Object.entries(expected)) {
      const source = CATALOG_SOURCES.find((s) => s.key === key);
      assert.ok(source, key);
      assert.deepEqual(source.countryCodes, ['VE']);
      assert.equal(source.aiFlowStatus, status);
      assert.equal(source.connectionMode, 'read_only_snapshot');
      assert.deepEqual(source.sectors, []);
      for (const depth of ['basic', 'standard', 'deep'] as const) {
        for (const industry of ['technology', 'insurance_financial_services', 'government']) {
          const ctx = getCatalogContext({ country: 'VE', countryCode: 'VE', industry, searchDepth: depth });
          assert.equal(ctx.recommendedSources.some((r) => r.key === key), false, `${key} ${industry} ${depth}`);
        }
      }
    }
    assert.doesNotMatch(COUNTRY_RISKS.VE.join(' '), /Sin número fiscal por nombre/);
  });
});
