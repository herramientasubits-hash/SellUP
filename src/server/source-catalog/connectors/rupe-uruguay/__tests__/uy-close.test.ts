/**
 * SOURCES-UY-CLOSE-1 — nombres, filas del RUPE y sus alias, entidades públicas,
 * webs por nombre, tabla del catálogo SICE, capa gratuita, resolvedor y cableado de
 * Uruguay. Cero E/S. Los nombres y RUT de empresas reales salen de fuentes públicas
 * (RUPE de setiembre de 2026 y adjudicaciones OCDS de ARCE, catalogodatos.gub.uy).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  endsWithUruguayLegalForm,
  joinedInitials,
  uruguayCandidateNameVariants,
  uruguayNameCore,
  uruguayRegistryAliasKeys,
} from '../uy-name-keys';
import { buildUyRupeRegistryRow, isUruguayOrganizationName } from '../uy-rupe-registry-row';
import {
  buildUyPublicEntityRow,
  groupUyPublicEntities,
  isUruguayPublicEntityName,
  mergeUyPublicEntities,
  parseUyTransparencyReferent,
  UY_INTENDENCIAS,
  type UyTransparencyReferent,
} from '../uy-public-entities';
import {
  isUruguayPersonalEmailDomain,
  uruguayDomainNamesEntity,
  uruguaySingleWordConfirmedByDomain,
} from '../uy-domain';
import {
  isWeakUyCompanyName,
  uyCompanyWebCandidates,
  uyCompanyWebVerdict,
  type UyFetchedPage,
} from '../uy-company-web';
import { buildUyArceDirectoryRow, parseUyArceSupplierLine, type UyArceSupplierSummary } from '../uy-arce-directory-row';
import { buildUyArceDirectory, buildUyPublicEntityRows, buildUyRegistry } from '../uy-sources-build';
import {
  macroHasUyArceCoverage,
  resolveUyArceClassMacro,
  resolveUyArceSupplierMacro,
  UY_ARCE_MACRO_TABLE_APPROVED,
  uyArceItemMacro,
} from '@/server/prospect-batches/country-source-discovery/uy-arce-macro-table';
import {
  buildUyArceDirectoryDiscoveryAdapter,
  UY_ARCE_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type UyArceDirectorySnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/uy-arce-directory-discovery-adapter';
import {
  createUruguayOfficialSourceResolver,
  type UruguayNameRow,
} from '@/server/agents/prospect-intake/resolvers/uruguay-official-source-resolver';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';
import {
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '@/server/prospect-batches/country-source-discovery/country-source-capability';
import { getSourceFamily } from '../../../record-identity/source-family-registry';
import { CATALOG_SOURCES, COUNTRY_RISKS } from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';

const read = (relative: string): string => readFileSync(join(process.cwd(), relative), 'utf8');

const params = { sourceYear: 2026, importedAt: '2026-10-13T00:00:00.000Z' };

const rupe = (identificacion: string, denominacion: string, estado = 'ACTIVO') => ({
  pais_prov: 'URUGUAY',
  identificacion_prov: identificacion,
  denominacion_social_prov: denominacion,
  domicilio_fiscal: 'X',
  localidad_prov: 'Montevideo',
  departamento_prov: 'Montevideo',
  estado_prov: estado,
});

// ─── Nombres ───────────────────────────────────────────────────────────────

describe('núcleo del nombre uruguayo', () => {
  it('quita la forma escrita de cualquier manera, sólo al final', () => {
    assert.equal(uruguayNameCore('TEJAR SOCIEDAD DE RESP.LTDA.'), 'TEJAR');
    assert.equal(uruguayNameCore('CANELONES SOCIEDAD RESPONSABILIDAD LTDA.'), 'CANELONES');
    assert.equal(uruguayNameCore('PAGUERO SOCIEDAD AGRARIA DE RESPONSABILIDAD LIMITADA'), 'PAGUERO');
    assert.equal(uruguayNameCore('EL MONARCA SOCIEDAD DE RESPONSABLIDAD LIMITADA'), 'EL MONARCA');
    assert.equal(uruguayNameCore('CENTRO VETERINARIO REGIONAL SOCIEDAD COMERCIAL SAS'), 'CENTRO VETERINARIO REGIONAL SOCIEDAD COMERCIAL');
    assert.equal(uruguayNameCore('HENDERSON Y CIA S A'), 'HENDERSON');
    assert.equal(uruguayNameCore('Hormetal Uruguay Sociedad Anónima'), 'HORMETAL URUGUAY');
    assert.equal(uruguayNameCore('TEYMA URUGUAY S A'), 'TEYMA URUGUAY');
  });

  it('el paréntesis final sale del núcleo («… SOCIEDAD ANONIMA (COME SA)»)', () => {
    assert.equal(uruguayNameCore('CORPORACION OMNIBUS MICRO ESTE SOCIEDAD ANONIMA (COME SA)'), 'CORPORACION OMNIBUS MICRO ESTE');
    assert.equal(uruguayNameCore('ADMINISTRACION NACIONAL DE PUERTOS (ANP)'), 'ADMINISTRACION NACIONAL DE PUERTOS');
  });

  it('una forma sola no es un nombre y una palabra que contiene la forma no se corta', () => {
    assert.equal(endsWithUruguayLegalForm('S.A.'), false);
    assert.equal(uruguayNameCore('SAMSA'), 'SAMSA');
    assert.equal(uruguayNameCore('PANADERIA LA SAMANTA'), 'PANADERIA LA SAMANTA');
  });

  it('sigla con puntos pegada', () => {
    assert.equal(joinedInitials('S I U R'), 'SIUR');
    assert.equal(joinedInitials('TEYMA URUGUAY'), null);
  });
});

describe('alias del RUPE', () => {
  it('la sigla entre paréntesis y la parte tras el guion', () => {
    assert.ok(uruguayRegistryAliasKeys('CORPORACION OMNIBUS MICRO ESTE SOCIEDAD ANONIMA (COME SA)').includes('COME'));
    assert.ok(uruguayRegistryAliasKeys('COOPERATIVA AGRARIA  PUNTAS DE SARANDI - COOPUNSA').includes('COOPUNSA'));
  });

  it('el nombre antes del descriptor de mutualista y sin artículo inicial', () => {
    assert.ok(uruguayRegistryAliasKeys('CASMU INSTITUCION DE ASISTENCIA MEDICA PRIVADA DE PROFESIONALES SIN FINES DE LUCRO').includes('CASMU'));
    assert.ok(uruguayRegistryAliasKeys('ASOCIACION ESPAÑOLA PRIMERA DE SOCORROS MUTUOS').includes('ASOCIACION ESPANOLA'));
    assert.ok(uruguayRegistryAliasKeys('LA SOCIEDAD HOSPITAL BRITANICO EN EL URUGUAY').includes('HOSPITAL BRITANICO'));
  });

  it('la sigla OFICIAL de un ente del Estado (tabla cerrada)', () => {
    assert.ok(uruguayRegistryAliasKeys('ADMINISTRACION NACIONAL DE USINAS Y TRASMISIONES E').includes('UTE'));
    assert.ok(uruguayRegistryAliasKeys('ADMINISTRACION DE LAS OBRAS SANITARIAS DEL ESTADO').includes('OSE'));
    assert.ok(uruguayRegistryAliasKeys('BANCO DE LA REPUBLICA ORIENTAL DEL URUGUAY').includes('BROU'));
  });

  it('nunca un alias que sólo dice el país, ni alias de sindicatos o asociaciones de funcionarios', () => {
    assert.ok(!uruguayRegistryAliasKeys('HUAWEI TECHNOLOGIES (URUGUAY) S.A').includes('URUGUAY'));
    assert.deepEqual(uruguayRegistryAliasKeys('ASOCIACION DE FUNCIONARIOS DEL CASMU'), []);
    assert.deepEqual(uruguayRegistryAliasKeys('UNION DE TRABAJADORES DE CUTCSA (UTC)'), []);
  });
});

describe('variantes del candidato', () => {
  it('con y sin «(del) Uruguay»', () => {
    const cores = uruguayCandidateNameVariants('Itaú Uruguay').map((v) => v.core);
    assert.deepEqual(cores.slice(0, 2), ['ITAU URUGUAY', 'ITAU']);
    assert.ok(uruguayCandidateNameVariants('IBM').some((v) => v.core === 'IBM'));
    assert.ok(uruguayCandidateNameVariants('Banco Itaú').some((v) => v.core === 'BANCO ITAU URUGUAY'));
  });
});

// ─── Filas del RUPE ────────────────────────────────────────────────────────

describe('organizaciones del RUPE', () => {
  it('entran cooperativas, mutualistas y entes sin forma societaria', () => {
    assert.ok(buildUyRupeRegistryRow(rupe('216309010011', 'CASMU INSTITUCION DE ASISTENCIA MEDICA PRIVADA DE PROFESIONALES SIN FINES DE LUCRO'), params));
    assert.ok(buildUyRupeRegistryRow(rupe('210778720012', 'ADMINISTRACION NACIONAL DE USINAS Y TRASMISIONES E'), params));
    assert.ok(buildUyRupeRegistryRow(rupe('212567060019', 'ASOCIACION ESPAÑOLA PRIMERA DE SOCORROS MUTUOS'), params));
  });

  it('fuera: personas, consorcios y disueltas', () => {
    assert.equal(isUruguayOrganizationName('VERA GALLO VERONICA SAMANTHA'), false);
    assert.equal(isUruguayOrganizationName('STILER S A, PEUSA SOCIEDAD ANONIMA Y OTROS'), false);
    assert.equal(isUruguayOrganizationName('STILER S A Y TIBEFOX SOCIEDAD ANONIMA'), false);
    assert.equal(isUruguayOrganizationName('ALUR S A DISUELTA LEY 19.288'), false);
    assert.equal(isUruguayOrganizationName('STILER S A'), true);
  });

  it('un RUT, una fila (gana la activa) y los alias no repiten el nombre propio de otra', () => {
    const registry = buildUyRegistry(
      [
        rupe('210778720012', 'ADMINISTRACION NACIONAL DE USINAS Y TRASMISIONES E'),
        rupe('211428940011', 'ABITAB S A'),
        rupe('211428940011', 'ABITAB S A', 'EN INGRESO'),
        rupe('219999990016', 'UTE SOCIEDAD ANONIMA'),
      ],
      params,
    );
    assert.equal(registry.registryRows.filter((r) => r.tax_id === '211428940011').length, 1);
    assert.equal(registry.byRut.get('211428940011')?.raw_data['rupe_state'], 'active');
    // «UTE» es el nombre propio de UTE S.A.: no puede ser alias del ente.
    assert.ok(!registry.aliasRows.some((r) => r.normalized_legal_name === 'UTE' && r.tax_id === '210778720012'));
  });
});

// ─── Entidades públicas ────────────────────────────────────────────────────

const referent = (overrides: Partial<UyTransparencyReferent>): UyTransparencyReferent => ({
  inciso: '07',
  incisoName: 'MINISTERIO DE GANADERÍA AGRICULTURA Y PESCA',
  unit: '01',
  unitName: 'Dirección General de Secretaría',
  shortName: 'DGS - MGAP',
  group: 'Poder Ejecutivo',
  emailDomain: 'mgap.gub.uy',
  ...overrides,
});

describe('entidades públicas', () => {
  it('del CSV de la UAIP sólo se usa el dominio del correo, nunca la persona', () => {
    const parsed = parseUyTransparencyReferent({
      Inciso: '04',
      'Nombre Inciso': 'MINISTERIO DEL INTERIOR',
      'Unidad Ejecutora': '01',
      'Nombre Unidad Ejecutora o dependencia u organismo': 'Secretaría del Ministerio del Interior',
      'Nombre Corto UE': 'SMI - MI',
      'Grupos de organismos': 'Poder Ejecutivo',
      Nombre: 'Persona Ejemplo',
      Telefono: '1234',
      Email: 'persona@minterior.gub.uy',
      'Habilitado (Si o No)': 'Sí',
    });
    assert.equal(parsed?.emailDomain, 'minterior.gub.uy');
    assert.equal(JSON.stringify(parsed).includes('Persona'), false);
  });

  it('una entidad por ministerio; la web sólo si su dirección la nombra', () => {
    const entities = groupUyPublicEntities([
      referent({}),
      referent({ unit: '05', unitName: 'Dirección General Forestal', shortName: 'DIGEFO - MGAP' }),
      referent({ inciso: '03', incisoName: 'MINISTERIO DE DEFENSA NACIONAL', shortName: 'DGS - MDN', emailDomain: 'msp.gub.uy' }),
    ]);
    assert.equal(entities.length, 2);
    assert.equal(entities.find((e) => e.name.startsWith('Ministerio de Ganadería'))?.domain, 'mgap.gub.uy');
    assert.equal(entities.find((e) => e.name.startsWith('Ministerio de Defensa'))?.domain, null);
  });

  it('las 19 intendencias, con web oficial (Lavalleja sin dominio propio)', () => {
    assert.equal(UY_INTENDENCIAS.length, 19);
    const merged = mergeUyPublicEntities([]);
    assert.equal(merged.find((e) => e.name.endsWith('Montevideo'))?.domain, 'montevideo.gub.uy');
    assert.equal(merged.find((e) => e.name.endsWith('Lavalleja'))?.domain, null);
  });

  it('el RUT sólo por el nombre o la sigla OFICIAL, y nunca el de una sociedad («MEF S.R.L.»)', () => {
    const registry = buildUyRegistry([rupe('213743290016', 'MEF S R L'), rupe('210475730011', 'ADMINISTRACION NACIONAL DE COMBUSTIBLES ALCOHOL Y PORTLAND')], params);
    const rows = buildUyPublicEntityRows({
      referents: [
        referent({ inciso: '05', incisoName: 'MINISTERIO DE ECONOMÍA Y FINANZAS', shortName: 'DGS - MEF', emailDomain: 'mef.gub.uy' }),
        referent({ inciso: '60', incisoName: 'ANCAP', unitName: 'ANCAP', shortName: 'ANCAP', group: 'Entes autónomos', emailDomain: 'ancap.com.uy' }),
      ],
      registry,
      ...params,
    });
    assert.equal(rows.find((r) => r.legal_name.startsWith('Ministerio de Economía'))?.tax_id, null);
    assert.equal(rows.find((r) => r.raw_data['website_domain'] === 'ancap.com.uy')?.tax_id, '210475730011');
  });

  it('sin web ni RUT no entra; Gobierno con identidad propia', () => {
    assert.equal(buildUyPublicEntityRow({ entity: { key: 'x', name: 'X', acronyms: [], group: 'Poder Ejecutivo', domain: null }, rut: null, ...params }), null);
    const row = buildUyPublicEntityRow({ entity: { key: 'inciso:04', name: 'Ministerio del Interior', acronyms: ['MI'], group: 'Poder Ejecutivo', domain: 'minterior.gub.uy' }, rut: null, ...params });
    assert.equal(row?.raw_data['macro_industry_key'], 'government');
    assert.match(String(row?.record_identity_key), /^uy-public-entity:inciso:04$/);
  });

  it('nombres de entes del Estado', () => {
    assert.equal(isUruguayPublicEntityName('ADMINISTRACION NACIONAL DE PUERTOS'), true);
    assert.equal(isUruguayPublicEntityName('INTENDENCIA DEPARTAMENTAL DE ROCHA'), true);
    assert.equal(isUruguayPublicEntityName('LA SOCIEDAD HOSPITAL BRITANICO EN EL URUGUAY'), false);
  });
});

// ─── Dominios y webs por nombre ────────────────────────────────────────────

describe('dominios', () => {
  it('correos gratuitos y de proveedores de internet nunca son la web', () => {
    assert.equal(isUruguayPersonalEmailDomain('adinet.com.uy'), true);
    assert.equal(isUruguayPersonalEmailDomain('gmail.com'), true);
    assert.equal(isUruguayPersonalEmailDomain('tilsor.com.uy'), false);
  });

  it('la web de un ente sólo si la dirección lo nombra; una sigla corta sólo si ES la etiqueta', () => {
    assert.equal(uruguayDomainNamesEntity('imcanelones.gub.uy', 'Intendencia Departamental de Canelones'), true);
    assert.equal(uruguayDomainNamesEntity('ute.com.uy', 'Administración Nacional de Usinas', ['UTE']), true);
    assert.equal(uruguayDomainNamesEntity('computer.com.uy', 'Administración Nacional de Usinas', ['UTE']), false);
    assert.equal(uruguayDomainNamesEntity('msp.gub.uy', 'Ministerio de Defensa Nacional', ['MDN']), false);
  });

  it('una palabra: sólo si la etiqueta es exactamente esa palabra', () => {
    assert.equal(uruguaySingleWordConfirmedByDomain('tilsor.com.uy', 'TILSOR', { publicEntity: false }), true);
    assert.equal(uruguaySingleWordConfirmedByDomain('tilsorgroup.com', 'TILSOR', { publicEntity: false }), false);
    assert.equal(uruguaySingleWordConfirmedByDomain('ute.gub.uy', 'UTE', { publicEntity: false }), false);
  });
});

const page = (host: string, title: string, text: string, finalHost = host): UyFetchedPage => ({
  host,
  finalHost,
  status: 200,
  blocked: false,
  title,
  text,
});

describe('webs por nombre', () => {
  it('direcciones candidatas desde el nombre (sin «Uruguay» ni la forma)', () => {
    const hosts = uyCompanyWebCandidates(['LOGICALIS URUGUAY S.A.']);
    assert.deepEqual(hosts.slice(0, 3), ['logicalis.com.uy', 'logicalis.uy', 'logicalis.com']);
  });

  it('la página tiene que nombrar a la empresa (título para una palabra distintiva)', () => {
    const ok = uyCompanyWebVerdict(page('tilsor.com.uy', 'Tilsor | Tecnología', 'Montevideo'), ['TILSOR S A']);
    assert.ok('domain' in ok && ok.domain === 'tilsor.com.uy');
    const no = uyCompanyWebVerdict(page('tilsor.com.uy', 'Otra empresa', 'Montevideo'), ['TILSOR S A']);
    assert.deepEqual(no, { rejected: 'not_named' });
  });

  it('nombre débil: sólo junto a su forma societaria (medido: avance.com.uy era un taller)', () => {
    assert.equal(isWeakUyCompanyName('AVANCE'), true);
    assert.equal(isWeakUyCompanyName('GRUPO MAS'), true);
    assert.equal(isWeakUyCompanyName('TILSOR'), false);
    const taller = uyCompanyWebVerdict(page('avance.com.uy', 'AVANCE Automecánica', 'Taller en Montevideo'), ['AVANCE S R L']);
    assert.deepEqual(taller, { rejected: 'not_named' });
    const argas = uyCompanyWebVerdict(page('argas.com.uy', 'Argas S.A.', 'Calefones, Montevideo'), ['ARGAS SA']);
    assert.ok('domain' in argas);
  });

  it('fuera de .uy tiene que hablar de Uruguay; páginas aparcadas y redirecciones ajenas nunca', () => {
    assert.deepEqual(uyCompanyWebVerdict(page('kensur.com', 'Kensur', 'Global company'), ['KENSUR S A']), { rejected: 'not_uruguayan' });
    assert.deepEqual(uyCompanyWebVerdict(page('kensur.com.uy', 'Kensur', 'Domain for sale'), ['KENSUR S A']), { rejected: 'parked' });
    assert.deepEqual(
      uyCompanyWebVerdict(page('kensur.com.uy', 'Kensur', 'Montevideo', 'otra.com'), ['KENSUR S A']),
      { rejected: 'redirected_elsewhere' },
    );
  });
});

// ─── Tabla y capa gratuita ─────────────────────────────────────────────────

describe('tabla del catálogo SICE', () => {
  it('la clase manda sobre la subfamilia; las subfamilias «otros» sólo por clase', () => {
    assert.equal(uyArceItemMacro(3, 10, 1), 'technology');
    assert.equal(uyArceItemMacro(2, 13, 1), 'health_pharma');
    assert.equal(uyArceItemMacro(3, 8, 2), 'health_pharma');
    assert.equal(uyArceItemMacro(3, 8, 9), 'services_company');
    assert.equal(uyArceItemMacro(3, 9, 9), null);
    assert.equal(uyArceItemMacro(3, 9, 1), 'services_company');
    assert.equal(uyArceItemMacro(1, 1, 1), null);
  });

  it('macro dominante sólo si pesa al menos la mitad', () => {
    assert.equal(resolveUyArceSupplierMacro([[3, 10, 1, 600], [2, 13, 1, 400]])?.macro, 'technology');
    assert.equal(resolveUyArceSupplierMacro([[3, 10, 1, 400], [2, 13, 1, 300], [6, 2, 1, 300]]), null);
    assert.equal(resolveUyArceSupplierMacro([[3, 9, 9, 900], [3, 10, 1, 100]]), null);
  });

  it('cobertura: Gobierno y las macros de la tabla; la tabla espera el visto bueno de la dueña', () => {
    assert.equal(macroHasUyArceCoverage('government'), true);
    assert.equal(macroHasUyArceCoverage('technology'), true);
    assert.equal(macroHasUyArceCoverage('no_existe'), false);
    assert.equal(resolveUyArceClassMacro('3-10-1'), 'technology');
    assert.equal(typeof UY_ARCE_MACRO_TABLE_APPROVED, 'boolean');
  });
});

const TILSOR: UyArceSupplierSummary = {
  rut: '211400110014',
  name: 'TILSOR S A',
  amountByYear: { '2023': 300_000, '2025': 200_000 },
  awards: 40,
  buyers: 12,
  amountUsd: 500_000,
  classes: [[3, 10, 1, 400_000], [10, 43, 1, 100_000]],
};

describe('filas de la capa gratuita', () => {
  it('una organización del RUPE con USD 50.000+ y adjudicación reciente entra con su clase y su web', () => {
    const result = buildUyArceDirectoryRow({
      summary: TILSOR,
      registryLegalName: 'TILSOR S A',
      classLabels: { '3-10-1': 'Servicios de informática' },
      web: { domain: 'tilsor.com.uy', origin: 'name_domain_verified', check: 'page_names_company' },
      ...params,
    });
    assert.ok('row' in result);
    assert.equal(result.row.raw_data['macro_industry_key'], 'technology');
    assert.equal(result.row.raw_data['sice_class'], '3-10-1');
    assert.equal(result.row.raw_data['website_domain'], 'tilsor.com.uy');
    assert.equal(result.row.priority_score, 12_040);
    assert.equal(result.row.record_identity_key, 'tax:211400110014');
  });

  it('fuera: sin RUPE, entes del Estado, poco monto, sin adjudicación reciente, sin industria', () => {
    const exclusion = (summary: Partial<UyArceSupplierSummary>, name: string | null = 'TILSOR S A') => {
      const result = buildUyArceDirectoryRow({ summary: { ...TILSOR, ...summary }, registryLegalName: name, ...params });
      return 'excluded' in result ? result.excluded : null;
    };
    assert.equal(exclusion({}, null), 'not_in_registry');
    assert.equal(exclusion({}, 'ADMINISTRACION NACIONAL DE TELECOMUNICACIONES'), 'public_entity');
    assert.equal(exclusion({ amountUsd: 49_000 }), 'below_amount');
    assert.equal(exclusion({ amountByYear: { '2023': 500_000 } }), 'no_recent_award');
    assert.equal(exclusion({ classes: [[3, 9, 9, 500_000]] }), 'no_dominant_macro');
  });

  it('la línea del extractor se lee igual que la escribe Python', () => {
    const parsed = parseUyArceSupplierLine({
      rut: '211400110014',
      name: 'TILSOR S A',
      years: { '2024': 1000 },
      awards: 2,
      buyers: 1,
      amount_usd: 1000,
      classes: [[3, 10, 1, 1000]],
    });
    assert.deepEqual(parsed?.classes, [[3, 10, 1, 1000]]);
    assert.equal(parseUyArceSupplierLine({ rut: '123' }), null);
  });

  it('el armado completo no repite RUT y ordena por organismos compradores', () => {
    const registry = buildUyRegistry([rupe('211400110014', 'TILSOR S A'), rupe('211428940011', 'ABITAB S A')], params);
    const { rows } = buildUyArceDirectory({
      suppliers: [TILSOR, { ...TILSOR, rut: '211428940011', buyers: 30 }, TILSOR],
      registry,
      ...params,
    });
    assert.deepEqual(rows.map((r) => r.tax_id), ['211428940011', '211400110014']);
  });
});

const readRow = (overrides: Partial<UyArceDirectorySnapshotReadRow>): UyArceDirectorySnapshotReadRow => ({
  record_identity_key: 'tax:211400110014',
  rut: '211400110014',
  legal_name: 'TILSOR S A',
  normalized_legal_name: 'TILSOR',
  city: null,
  region: 'Montevideo',
  directory_kind: null,
  sice_class: '3-10-1',
  activity_text: 'Servicios de informática',
  website_domain: 'tilsor.com.uy',
  priority_score: 12_040,
  ...overrides,
});

describe('adaptador de la capa gratuita de Uruguay', () => {
  it('ofrece la empresa con RUT, web y rubro; la tabla de HOY manda', async () => {
    const adapter = buildUyArceDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async () => [readRow({}), readRow({ rut: '219999990016', sice_class: '2-13-1' }), readRow({})],
    });
    const result = await adapter({ countryCode: 'UY', macroIndustryKey: 'technology', limit: 10 } as never);
    assert.equal(result.sourceKey, UY_ARCE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.companies.length, 1);
    assert.equal(result.companies[0].taxId, '211400110014');
    assert.equal(result.companies[0].taxIdentifierType, 'RUT');
    assert.equal(result.companies[0].domain, 'tilsor.com.uy');
    assert.equal(result.companies[0].declaredIndustry, 'Servicios de informática');
  });

  it('Gobierno: entidad sin RUT con web sí; sin RUT ni web no', async () => {
    const adapter = buildUyArceDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async () => [
        readRow({ directory_kind: 'public_entity', rut: null, legal_name: 'Ministerio del Interior', website_domain: 'minterior.gub.uy', record_identity_key: 'native:uy-public-entity:inciso:04' }),
        readRow({ directory_kind: 'public_entity', rut: null, legal_name: 'Junta Departamental de Rocha', website_domain: null, record_identity_key: 'native:uy-public-entity:x' }),
      ],
    });
    const result = await adapter({ countryCode: 'UY', macroIndustryKey: 'government', limit: 10 } as never);
    assert.deepEqual(result.companies.map((c) => c.legalName), ['Ministerio del Interior']);
    assert.equal(result.companies[0].declaredIndustry, 'Entidad pública');
  });

  it('una macro sin cobertura no consulta', async () => {
    let asked = false;
    const adapter = buildUyArceDirectoryDiscoveryAdapter({
      readCompaniesByMacro: async () => {
        asked = true;
        return [];
      },
    });
    await adapter({ countryCode: 'UY', macroIndustryKey: 'no_existe', limit: 10 } as never);
    assert.equal(asked, false);
  });
});

// ─── Resolvedor ────────────────────────────────────────────────────────────

function candidate(name: string, domain: string | null = null): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, countryCode: 'UY', domain, websiteUrl: null },
    criteria: { countryCode: 'UY' },
  } as unknown as OfficialSourceResolverInput;
}

function resolverWith(rows: Record<string, UruguayNameRow[]>) {
  const asked: string[] = [];
  const resolver = createUruguayOfficialSourceResolver({
    querySnapshots: async (core) => {
      asked.push(core);
      return rows[core] ?? [];
    },
  });
  return { resolver, asked };
}

describe('resolvedor de RUT por nombre (uy_rupe_registry)', () => {
  it('un RUT con ese núcleo → fuerte', async () => {
    const { resolver } = resolverWith({
      'BANCO SANTANDER': [{ taxId: '211307180016', legalName: 'BANCO SANTANDER SOCIEDAD ANONIMA', normalizedLegalName: 'BANCO SANTANDER' }],
    });
    const result = await resolver.resolve(candidate('Banco Santander Uruguay'));
    assert.equal(result.status, 'matched');
    assert.equal(result.sourceKey, 'uy_rupe_registry');
    assert.equal(result.taxIdentifier, '211307180016');
    assert.equal(result.taxIdentifierType, 'RUT');
  });

  it('por el alias de mutualista, con la razón social del RUPE', async () => {
    const { resolver } = resolverWith({
      'MEDICA URUGUAYA': [{ taxId: '212701040013', legalName: 'MEDICA URUGUAYA CORPORACION DE ASISTENCIA MEDICA', normalizedLegalName: 'MEDICA URUGUAYA', alias: true }],
    });
    const result = await resolver.resolve(candidate('Médica Uruguaya'));
    assert.equal(result.status, 'matched');
    assert.equal(result.legalName, 'MEDICA URUGUAYA CORPORACION DE ASISTENCIA MEDICA');
  });

  it('sigla OFICIAL de un ente → fuerte aunque sea una palabra', async () => {
    const { resolver } = resolverWith({
      UTE: [{ taxId: '210778720012', legalName: 'ADMINISTRACION NACIONAL DE USINAS Y TRASMISIONES E', normalizedLegalName: 'UTE', alias: true }],
    });
    const result = await resolver.resolve(candidate('UTE'));
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, '210778720012');
  });

  it('una palabra: «CLARO S.R.L.» no es Claro aunque la web sea claro.com.uy (pista)', async () => {
    const { resolver } = resolverWith({
      CLARO: [{ taxId: '215949830012', legalName: 'CLARO S.R.L.', normalizedLegalName: 'CLARO' }],
    });
    const result = await resolver.resolve(candidate('Claro Uruguay', 'claro.com.uy'));
    assert.equal(result.status, 'low_confidence_match');
  });

  it('una palabra: S.A. activa confirmada por su web → fuerte; sin web → pista', async () => {
    const rows = { TILSOR: [{ taxId: '211400110014', legalName: 'TILSOR S A', normalizedLegalName: 'TILSOR', rupeState: 'active' }] };
    assert.equal((await resolverWith(rows).resolver.resolve(candidate('Tilsor', 'tilsor.com.uy'))).status, 'matched');
    assert.equal((await resolverWith(rows).resolver.resolve(candidate('Tilsor'))).status, 'low_confidence_match');
  });

  it('una palabra: mutualista sin forma societaria confirmada por su web → fuerte', async () => {
    const { resolver } = resolverWith({
      CASMU: [{ taxId: '216309010011', legalName: 'CASMU INSTITUCION DE ASISTENCIA MEDICA PRIVADA DE PROFESIONALES SIN FINES DE LUCRO', normalizedLegalName: 'CASMU', alias: true, rupeState: 'active' }],
    });
    assert.equal((await resolver.resolve(candidate('CASMU', 'casmu.com.uy'))).status, 'matched');
  });

  it('dos RUT con la misma clave → pista (ambiguo)', async () => {
    const { resolver } = resolverWith({
      'SAN ROQUE': [
        { taxId: '210354300016', legalName: 'SAN ROQUE SOCIEDAD ANONIMA', normalizedLegalName: 'SAN ROQUE' },
        { taxId: '217000550016', legalName: 'SAN ROQUE SRL', normalizedLegalName: 'SAN ROQUE' },
      ],
    });
    const result = await resolver.resolve(candidate('San Roque'));
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.safeMetadata?.['ambiguous'], true);
  });

  it('otro país no se resuelve aquí', () => {
    const { resolver } = resolverWith({});
    assert.equal(resolver.canResolve({ ...candidate('Tilsor'), candidate: { canonicalName: 'Tilsor', countryCode: 'PY' } } as never), false);
  });
});

// ─── Cableado ──────────────────────────────────────────────────────────────

describe('cableado y familias de fuente', () => {
  it('la fábrica usa el resolvedor de Uruguay con su lectura (RUPE + alias), sólo lectura', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /createUruguayOfficialSourceResolver\(\{\s*querySnapshots: buildUruguaySnapshotNameQuery\(snapshotClient\),\s*\}\)/);
    const query = read('src/server/prospect-batches/uruguay-snapshot-query.ts');
    assert.match(query, /\.in\('source_key', \[UY_RUPE_REGISTRY_SOURCE_KEY, UY_RUPE_NAME_ALIAS_SOURCE_KEY\]\)/);
    assert.doesNotMatch(query, /\.(insert|update|upsert|delete)\(/);
    const discovery = read('src/server/prospect-batches/country-source-discovery/uy-arce-directory-snapshot-query.ts');
    assert.doesNotMatch(discovery, /\.(insert|update|upsert|delete)\(/);
  });

  it('la capa gratuita de Uruguay está cableada', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('UY'));
    assert.equal(resolveCountrySourceCapability('UY')?.sourceKey, UY_ARCE_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(countrySourceMacroHasCoverage('UY', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('UY', 'government'), true);
    assert.equal(countrySourceMacroHasCoverage('UY', 'no_existe'), false);
    const gate = read('src/server/prospect-batches/country-source-discovery/prepaid-novelty-gate.server.ts');
    assert.match(gate, /uyArceDirectoryDiscoveryReads: buildUyArceDirectoryDiscoveryReads\(adminClient\)/);
  });

  it('familias: un RUT una fila en el RUPE y la capa gratuita; varias en alias y Gobierno', () => {
    assert.equal(getSourceFamily('uy_rupe_registry'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('uy_arce_directory'), 'TAX_GRAIN');
    assert.equal(getSourceFamily('uy_rupe_name_alias'), 'NATIVE_RECORD_GRAIN');
    assert.equal(getSourceFamily('uy_public_entities'), 'NATIVE_RECORD_GRAIN');
  });

  it('catálogo: estado honesto (conectada, cargada y verificada en Prod) y fuera de las recomendaciones', () => {
    const expected = {
      uy_rupe_registry: 'connected_identity_in_run',
      uy_arce_directory: 'connected_free_discovery',
      uy_public_entities: 'connected_free_discovery',
    } as const;
    for (const [key, status] of Object.entries(expected)) {
      const source = CATALOG_SOURCES.find((s) => s.key === key);
      assert.ok(source, key);
      assert.deepEqual(source.countryCodes, ['UY']);
      assert.equal(source.aiFlowStatus, status);
      assert.equal(source.connectionMode, 'read_only_snapshot');
      assert.deepEqual(source.sectors, []);
      assert.equal(source.operationalStatus, 'operational_verified', `${key}: cargada y verificada en Prod el 13-10-2026`);
      for (const depth of ['basic', 'standard', 'deep'] as const) {
        for (const industry of ['technology', 'health_pharma', 'government']) {
          const ctx = getCatalogContext({ country: 'UY', countryCode: 'UY', industry, searchDepth: depth });
          assert.equal(ctx.recommendedSources.some((r) => r.key === key), false, `${key} ${industry} ${depth}`);
        }
      }
    }
    assert.ok(CATALOG_SOURCES.find((s) => s.key === 'latam_curated_directory')?.countryCodes.includes('UY'));
    assert.doesNotMatch(COUNTRY_RISKS.UY.join(' '), /sólo cubre empresas que alguna vez fueron proveedoras/);
  });

  it('el ETL viejo del RUPE ya no escribe; el nuevo exige --confirm y la tabla aprobada', () => {
    assert.match(read('scripts/source-catalog/run-uy-rupe-registry-etl.ts'), /blocked: usa scripts\/source-catalog\/run-uy-sources-etl\.ts/);
    const etl = read('scripts/source-catalog/run-uy-sources-etl.ts');
    assert.match(etl, /--apply exige --only= \(una carga cada vez\) y --confirm/);
    assert.match(etl, /UY_ARCE_MACRO_TABLE_APPROVED/);
  });
});
