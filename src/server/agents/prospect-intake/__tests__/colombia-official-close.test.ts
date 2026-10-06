/**
 * SOURCES-CO-CLOSE-1 — Colombia de punta a punta: nombres con la forma societaria
 * escrita de cualquier manera, NIT por la WEB (entidades públicas y SIIS) y marcas
 * de una palabra confirmadas por su propia web.
 *
 * Todo con dobles inyectados: sin red, sin DB, sin proveedores. Los casos son los
 * de las corridas reales de Colombia (30 días al 06-10-2026).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY } from '../source-enrichment';
import type { NormalizedProspectCandidate, ProspectSearchCriteria } from '../types';
import {
  createColombiaDomainOfficialSourceResolver,
  distinctiveCoNameTokens,
  pickCoDomainMatch,
  type CoDomainRow,
} from '../resolvers/colombia-domain-official-source-resolver';
import {
  createSnapshotNameOfficialSourceResolver,
  type SnapshotNameRow,
} from '../resolvers/snapshot-name-official-source-resolver';
import { normalizeColombiaCompanyNameCore } from '@/server/source-catalog/connectors/personas-juridicas-cc-colombia/co-company-name-core';
import {
  coDomainLookupKeys,
  coSingleWordConfirmedByDomain,
  emailDomain,
  isColombianInstitutionalDomain,
  isColombianPublicSectorDomain,
  normalizeWebsiteHost,
  registrableCoDomain,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

const criteria: ProspectSearchCriteria = { country: 'Colombia', countryCode: 'CO', sector: 'Gobierno' };

function candidate(canonicalName: string, domain: string | null): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-co',
    providerRequestId: 'req-co',
    canonicalName,
    normalizedName: canonicalName.toLowerCase(),
    commercialName: canonicalName,
    legalName: null,
    websiteUrl: null,
    domain,
    corporateLinkedinUrl: null,
    country: 'Colombia',
    countryCode: 'CO',
    requestedCountryCode: 'CO',
    region: null,
    city: null,
    industry: null,
    subindustry: null,
    industryCodes: {},
    employeeCount: null,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-co', providerRequestId: 'req-co', sourceUrl: null },
  };
}

const input = (name: string, domain: string | null) => ({
  candidate: candidate(name, domain),
  criteria,
  policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
});

describe('nombre: la forma societaria se reconoce por su estructura', () => {
  it('quita S.A.S., S.A., LTDA y sus variantes con puntos y espacios', () => {
    for (const [raw, core] of [
      ['ALGORITMO SOFTWARE S.A.S', 'ALGORITMO SOFTWARE'],
      ['KOOMBEA S. A. S.', 'KOOMBEA'],
      ['HEIMCORE S AS', 'HEIMCORE'],
      ['PIXELIA SA S', 'PIXELIA'],
      ['ITMCOL S A S', 'ITMCOL'],
      ['CARNICOS S.A.', 'CARNICOS'],
      ['ACTSIS LTDA.', 'ACTSIS'],
      ['INDUSTRIAS X LIMITADA', 'INDUSTRIAS X'],
    ] as const) {
      assert.equal(normalizeColombiaCompanyNameCore(raw), core, raw);
    }
  });

  it('quita las formas apiladas (BIC, E.S.P., E.S.E.) y las sociedades en comandita', () => {
    for (const [raw, core] of [
      ['CAMPUSLANDS S.A.S. BIC', 'CAMPUSLANDS'],
      ['TRANSPORTES VIGIA S.A.S E.S.P.', 'TRANSPORTES VIGIA'],
      ['HOSPITAL SAN FELIX E.S.E.', 'HOSPITAL SAN FELIX'],
      ['BAVARIA & CIA S.C.A', 'BAVARIA & CIA'],
      ['LUIS ESTRADA Y CIA S. EN C.', 'LUIS ESTRADA Y CIA'],
      ['INVERSIONES ABC S EN C S', 'INVERSIONES ABC'],
      ['COOVISER C.T.A.', 'COOVISER'],
      ['DISTRIBUIDORA X SOCIEDAD POR ACCIONES SIMPLIFICADA', 'DISTRIBUIDORA X'],
    ] as const) {
      assert.equal(normalizeColombiaCompanyNameCore(raw), core, raw);
    }
  });

  it('nunca deja el nombre vacío ni toca palabras largas o «EN LIQUIDACION»', () => {
    assert.equal(normalizeColombiaCompanyNameCore('S.A.S.'), 'S A S');
    assert.equal(normalizeColombiaCompanyNameCore('HOSPITAL SAN JOSE'), 'HOSPITAL SAN JOSE');
    assert.equal(normalizeColombiaCompanyNameCore('TELEOBANDO EN LIQUIDACION'), 'TELEOBANDO EN LIQUIDACION');
    assert.equal(normalizeColombiaCompanyNameCore(null), '');
  });
});

describe('dominios de Colombia', () => {
  it('reduce la web publicada al host comparable', () => {
    assert.equal(normalizeWebsiteHost('WWW.POSTOBON.COM'), 'postobon.com');
    assert.equal(normalizeWebsiteHost('http://www.hci.gov.co'), 'hci.gov.co');
    assert.equal(normalizeWebsiteHost('https://www.ipiales-narino.gov.co/inicio?x=1'), 'ipiales-narino.gov.co');
    assert.equal(normalizeWebsiteHost('no tiene'), null);
    assert.equal(normalizeWebsiteHost('ventas@x.com'), null);
    assert.equal(emailDomain('NOTIFICACIONES@AB-INBEV.COM'), 'ab-inbev.com');
  });

  it('registrable y llaves de búsqueda: el host exacto y su dominio registrable', () => {
    assert.equal(registrableCoDomain('sed.narino.gov.co'), 'narino.gov.co');
    assert.equal(registrableCoDomain('co.kuehne-nagel.com'), 'kuehne-nagel.com');
    assert.deepEqual(coDomainLookupKeys('www.sed.narino.gov.co'), ['sed.narino.gov.co', 'narino.gov.co']);
    assert.deepEqual(coDomainLookupKeys('cali.gov.co'), ['cali.gov.co']);
  });

  it('distingue dominios del Estado e institucionales', () => {
    assert.equal(isColombianPublicSectorDomain('army.mil.co'), true);
    assert.equal(isColombianPublicSectorDomain('sena.edu.co'), false);
    assert.equal(isColombianInstitutionalDomain('sena.edu.co'), true);
    assert.equal(isColombianInstitutionalDomain('koombea.com'), false);
  });

  it('una marca de una palabra sólo la confirma una web propia, idéntica y privada', () => {
    assert.equal(coSingleWordConfirmedByDomain('koombea.com', 'KOOMBEA'), true);
    assert.equal(coSingleWordConfirmedByDomain('www.tul.com.co', 'TUL'), true);
    assert.equal(coSingleWordConfirmedByDomain('visionsoftware.com.co', 'VISION'), false);
    // La Superintendencia de Salud no es la empresa privada «SUPERSALUD S.A.».
    assert.equal(coSingleWordConfirmedByDomain('supersalud.gov.co', 'SUPERSALUD'), false);
    assert.equal(coSingleWordConfirmedByDomain('gmail.com', 'GMAIL'), false);
    assert.equal(coSingleWordConfirmedByDomain(null, 'KOOMBEA'), false);
  });
});

function row(overrides: Partial<CoDomainRow>): CoDomainRow {
  return { sourceKey: 'co_public_entities', taxId: '800099095', legalName: 'ALCALDIA DE IPIALES', websiteDomain: 'ipiales-narino.gov.co', ...overrides };
}

describe('NIT por la web: elección entre las filas que la comparten', () => {
  it('fichas distintivas: sin «Alcaldía municipal de», ni letras sueltas', () => {
    assert.deepEqual([...distinctiveCoNameTokens('Alcaldía Municipal De Girardot')], ['GIRARDOT']);
    assert.deepEqual([...distinctiveCoNameTokens('Alcaldía de Santa Marta D.T.C.H.')], ['SANTA', 'MARTA']);
    assert.deepEqual([...distinctiveCoNameTokens('Gobernación del Atlántico')], ['ATLANTICO']);
  });

  it('un solo NIT ⇒ fuerte', () => {
    const pick = pickCoDomainMatch([row({})], 'alcaldia ipiales');
    assert.equal(pick?.strong, true);
    assert.equal(pick?.row.taxId, '800099095');
  });

  it('varios NIT ⇒ gana el que lleva el mismo nombre que la candidata', () => {
    const pick = pickCoDomainMatch(
      [
        row({ taxId: '890501776', legalName: 'ALCALDIA DE CACHIRA', entityHead: true }),
        row({ taxId: '807004206', legalName: 'INSTITUTO MUNICIPAL DE DEPORTES DE CACHIRA' }),
      ],
      'Cachira',
    );
    assert.equal(pick?.row.taxId, '890501776');
    assert.equal(pick?.strong, true);
  });

  it('sin nombre que coincida ⇒ la cabeza de la entidad si es una sola', () => {
    const pick = pickCoDomainMatch(
      [
        row({ taxId: '899999042', legalName: 'MINISTERIO DE RELACIONES EXTERIORES', entityHead: true }),
        row({ taxId: '860511071', legalName: 'FONDO ROTATORIO DEL MINISTERIO DE RELACIONES EXTERIORES' }),
      ],
      'Cancillería',
    );
    assert.equal(pick?.row.taxId, '899999042');
    assert.equal(pick?.strong, true);
  });

  it('sin nombre ni cabeza única ⇒ sólo pista, la de más servidores', () => {
    const pick = pickCoDomainMatch(
      [
        row({ taxId: '830085129', legalName: 'FONDO SOCIAL DE VIVIENDA', workforce: { workers: 10, year: 2026, source: 'co_public_entities' } }),
        row({ taxId: '899999737', legalName: 'FONDO ROTATORIO', workforce: { workers: 90, year: 2026, source: 'co_public_entities' } }),
      ],
      'Otra cosa',
    );
    assert.equal(pick?.strong, false);
    assert.equal(pick?.ambiguous, true);
    assert.equal(pick?.row.taxId, '899999737');
  });

  it('NIT que no es de persona jurídica se ignora', () => {
    assert.equal(pickCoDomainMatch([row({ taxId: '101010101' }), row({ taxId: '000000000' })], 'x'), null);
  });
});

describe('resolvedor por web', () => {
  const workforce = { workers: 158, year: 2026, source: 'co_public_entities' };

  it('entidad pública: NIT fuerte con su tamaño oficial', async () => {
    let asked: readonly string[] = [];
    const resolver = createColombiaDomainOfficialSourceResolver({
      queryByDomain: async (keys) => {
        asked = keys;
        return [row({ workforce })];
      },
    });
    const result = await resolver.resolve(input('alcaldia ipiales', 'www.ipiales-narino.gov.co'));
    // «ipiales-narino.gov.co» ya es registrable: una sola llave.
    assert.deepEqual([...asked], ['ipiales-narino.gov.co']);
    assert.equal(result.status, 'matched');
    assert.equal(result.confidence, 0.85);
    assert.equal(result.matchMethod, 'domain');
    assert.equal(result.taxIdentifier, '800099095');
    assert.equal(result.taxIdentifierType, 'NIT');
    assert.equal(result.sourceKey, 'co_public_entities');
    assert.deepEqual(result.workforce, workforce);
  });

  it('el host exacto manda sobre el registrable (Guataquí no es la Gobernación)', async () => {
    const resolver = createColombiaDomainOfficialSourceResolver({
      queryByDomain: async () => [
        row({ taxId: '800004574', legalName: 'GUATAQUI', websiteDomain: 'guataqui.cundinamarca.gov.co' }),
        row({ taxId: '899999114', legalName: 'GOBERNACION DE CUNDINAMARCA', websiteDomain: 'cundinamarca.gov.co', entityHead: true }),
      ],
    });
    const result = await resolver.resolve(input('Alcaldía de Guataquí', 'guataqui.cundinamarca.gov.co'));
    assert.equal(result.taxIdentifier, '800004574');
    assert.equal(result.status, 'matched');
  });

  it('subdominio sin fila propia ⇒ el registrable, marcado', async () => {
    const resolver = createColombiaDomainOfficialSourceResolver({
      queryByDomain: async () => [row({ taxId: '800103923', legalName: 'GOBERNACION DE NARIÑO', websiteDomain: 'narino.gov.co', entityHead: true })],
    });
    const result = await resolver.resolve(input('Secretaria de educacion Departamental de Nariño', 'sed.narino.gov.co'));
    assert.equal(result.taxIdentifier, '800103923');
    assert.equal(result.safeMetadata?.['viaRegistrableDomain'], true);
  });

  it('un dominio del Estado nunca identifica a una empresa del SIIS', async () => {
    const resolver = createColombiaDomainOfficialSourceResolver({
      queryByDomain: async () => [row({ sourceKey: 'co_siis', taxId: '805013143', legalName: 'SUPERSALUD S.A.', websiteDomain: 'supersalud.gov.co' })],
    });
    const result = await resolver.resolve(input('Supersalud', 'supersalud.gov.co'));
    assert.equal(result.status, 'not_found');
  });

  it('empresa del SIIS por su web cargada: NIT fuerte, sin tamaño inventado', async () => {
    const resolver = createColombiaDomainOfficialSourceResolver({
      queryByDomain: async () => [row({ sourceKey: 'co_siis', taxId: '890900281', legalName: 'INDUSTRIAS HACEB S.A.', websiteDomain: 'haceb.com' })],
    });
    const result = await resolver.resolve(input('Haceb', 'www.haceb.com'));
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, '890900281');
    assert.equal(result.workforce, undefined);
  });

  it('sin web no se intenta; un error de lectura es «no encontrado»', async () => {
    const resolver = createColombiaDomainOfficialSourceResolver({
      queryByDomain: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(resolver.canResolve(input('Alcaldía de X', null)), false);
    assert.equal(resolver.canResolve({ ...input('X', 'x.com'), criteria: { ...criteria, countryCode: 'PE' }, candidate: { ...candidate('X', 'x.com'), countryCode: 'PE' } }), false);
    const result = await resolver.resolve(input('Alcaldía de X', 'x.gov.co'));
    assert.equal(result.status, 'not_found');
  });
});

describe('cámaras: una palabra confirmada por su propia web', () => {
  const rues = (rows: SnapshotNameRow[]) =>
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'CO',
      sourceKey: 'co_personas_juridicas_cc',
      taxIdentifierType: 'NIT',
      validTaxId: /^[89]\d{8}$/,
      normalizeCore: normalizeColombiaCompanyNameCore,
      querySnapshots: async () => rows,
      singleWordIsSignalOnly: true,
      singleWordConfirmedByDomain: coSingleWordConfirmedByDomain,
    });
  const koombea: SnapshotNameRow = { taxId: '900182503', legalName: 'KOOMBEA S.A.S.', normalizedLegalName: 'KOOMBEA' };

  it('Koombea con koombea.com ⇒ NIT fuerte', async () => {
    const result = await rues([koombea]).resolve(input('Koombea', 'koombea.com'));
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, '900182503');
    assert.equal(result.safeMetadata?.['singleWordConfirmedByDomain'], true);
  });

  it('sin web, o con una web que no es la suya, sigue siendo pista', async () => {
    assert.equal((await rues([koombea]).resolve(input('Koombea', null))).status, 'low_confidence_match');
    assert.equal((await rues([koombea]).resolve(input('Koombea', 'koombea-labs.io'))).status, 'low_confidence_match');
  });

  it('homónimos siguen siendo pista aunque la web confirme la palabra', async () => {
    const result = await rues([koombea, { ...koombea, taxId: '901000001' }]).resolve(input('Koombea', 'koombea.com'));
    assert.equal(result.status, 'low_confidence_match');
  });
});
