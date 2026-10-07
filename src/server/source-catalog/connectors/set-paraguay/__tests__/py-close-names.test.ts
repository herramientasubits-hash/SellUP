/**
 * SOURCES-PY-CLOSE-1 — Paraguay: núcleo por estructura, alias del padrón,
 * variantes del candidato, web y regla de una palabra, tamaño MIPYME declarado.
 *
 * Razones sociales REALES del padrón de RUC de la DNIT (octubre de 2026). Sin E/S,
 * sin DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  endsWithParaguayLegalForm,
  paraguayCandidateNameVariants,
  paraguayNameCore,
  paraguayOwnNameKeys,
  paraguayPublicEntityKey,
  paraguayRegistryAliasKeys,
} from '../py-name-keys';
import { paraguayCompanyDomain, paraguaySingleWordConfirmedByDomain } from '../py-domain';
import {
  buildPySetNameAliasRows,
  buildPySetRegistryRow,
  PY_SET_NAME_ALIAS_SOURCE_KEY,
  type PySetRegistryRow,
} from '../py-set-registry-row';
import { dropAliasKeysOwnedByOthers } from '../../sunat-peru/pe-name-keys';
import {
  createParaguayOfficialSourceResolver,
  type ParaguayNameRow,
} from '@/server/agents/prospect-intake/resolvers/paraguay-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '@/server/agents/prospecting-toolkit/employee-size-resolver';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY } from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const params = { sourceYear: 2026, importedAt: '2026-10-06T00:00:00.000Z' };

describe('núcleo: la forma societaria se reconoce por su estructura', () => {
  const cases: Array<[string, string]> = [
    ['NUCLEO E.A.S.', 'NUCLEO'],
    ['"ACIV" E.A.S. UNIPERSONAL', 'ACIV'],
    ['ENEX GROUP EAS', 'ENEX GROUP'],
    ['BANCO CONTINENTAL SA EMISORA DE CAPITAL ABIERTO', 'BANCO CONTINENTAL'],
    ['BANCO GNB  PARAGUAY SOCIEDAD ANONIMA EMISORA DE CAPITAL ABIERTO', 'BANCO GNB PARAGUAY'],
    ['MUSIC HALL S.A.E.C.A', 'MUSIC HALL'],
    ['FORTALEZA INMUEBLES SOCIEDAD ANONIMA EMISORA', 'FORTALEZA INMUEBLES'],
    ['INTEC INGENIERIA S.A. EMISORA S.A.E.', 'INTEC INGENIERIA'],
    ['"AGRO SERVIC LABRANZA" S.A.C.I.', 'AGRO SERVIC LABRANZA'],
    ["''OKF '' SOCIEDAD RESPONSABILIDAD LIMITADA", 'OKF'],
    ['COOP. MULT.DE AHORRO CRED. Y SERV. MEDALLA MILAGROSA LIMITADA', 'COOP MULT DE AHORRO CRED Y SERV MEDALLA MILAGROSA'],
    ['PETROBRAS PARAGUAY DISTRIBUCION LIMITED.', 'PETROBRAS PARAGUAY DISTRIBUCION'],
    ['FRIGORIFICO GUARANI S.A.C.I.', 'FRIGORIFICO GUARANI'],
    ['BANCO ITAU PARAGUAY S.A', 'BANCO ITAU PARAGUAY'],
  ];
  for (const [legal, core] of cases) {
    it(`${legal} → ${core}`, () => assert.equal(paraguayNameCore(legal), core));
  }

  it('el paréntesis final sale del núcleo (la sigla queda como alias)', () => {
    assert.equal(paraguayNameCore('COMPAÑIA PARAGUAYA DE COMUNICACIONES SA (COPACO SA)'), 'COMPANIA PARAGUAYA DE COMUNICACIONES');
    assert.equal(paraguayNameCore('CHACOMER SOCIEDAD ANONIMA EMISORA (CHACOMER S.A.E.)'), 'CHACOMER');
    assert.equal(paraguayNameCore('" CORSAN - CORVIAM CONSTRUCCION " S.A. ( SUCURSAL PARAGUAY)'), 'CORSAN CORVIAM CONSTRUCCION');
  });

  it('una forma que es todo el nombre o una palabra que la contiene no se toca', () => {
    assert.equal(paraguayNameCore('S.A.'), 'S A');
    assert.equal(paraguayNameCore('BEPSA'), 'BEPSA');
    assert.equal(paraguayNameCore('ROSHKA'), 'ROSHKA');
    assert.equal(paraguayNameCore(''), '');
    assert.equal(paraguayNameCore(null), '');
  });

  it('sabe si un nombre trae forma societaria', () => {
    assert.equal(endsWithParaguayLegalForm('Bancard S.A.'), true);
    assert.equal(endsWithParaguayLegalForm('Nucleo E.A.S.'), true);
    assert.equal(endsWithParaguayLegalForm('Bancard'), false);
  });
});

describe('entidades públicas: misma clave en los dos lados', () => {
  it('gobernaciones', () => {
    assert.equal(paraguayPublicEntityKey('GOBIERNO DEPARTAMENTAL DE ITAPUA'), 'GOBERNACION ITAPUA');
    assert.equal(paraguayPublicEntityKey('GOBERNACION DEPARTAMENTO CENTRAL'), 'GOBERNACION CENTRAL');
    assert.equal(paraguayPublicEntityKey('GOBERNACION DE CENTRAL'), 'GOBERNACION CENTRAL');
    assert.equal(paraguayPublicEntityKey('GOBERNACION DEL ALTO PARANA'), 'GOBERNACION ALTO PARANA');
  });

  it('municipalidades, con o sin «de la ciudad de»', () => {
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DE LA CIUDAD DE ASUNCION'), 'MUNICIPALIDAD ASUNCION');
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DE ASUNCION'), 'MUNICIPALIDAD ASUNCION');
  });

  it('municipalidades escritas con «distrito», «ciudad» o títulos abreviados', () => {
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DE CIUDAD PDTE FRANCO'), 'MUNICIPALIDAD PRESIDENTE FRANCO');
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DE PRESIDENTE FRANCO'), 'MUNICIPALIDAD PRESIDENTE FRANCO');
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DISTRITO YGUAZU'), 'MUNICIPALIDAD YGUAZU');
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DEL DISTRITO DE SANTA RITA'), 'MUNICIPALIDAD SANTA RITA');
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DE FDO DE LA MORA'), 'MUNICIPALIDAD FERNANDO MORA');
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DE MCAL FRANCISCO SOLANO LOPEZ'), 'MUNICIPALIDAD MARISCAL FRANCISCO SOLANO LOPEZ');
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD DE CIUDAD DEL ESTE'), 'MUNICIPALIDAD CIUDAD ESTE');
  });

  it('una empresa privada no tiene clave pública', () => {
    assert.equal(paraguayPublicEntityKey('BANCO ATLAS'), null);
    assert.equal(paraguayPublicEntityKey('MUNICIPALIDAD'), null);
  });
});

describe('alias del padrón', () => {
  it('la sigla del paréntesis y la parte tras el guion son alias', () => {
    assert.deepEqual(paraguayRegistryAliasKeys('COMPAÑIA PARAGUAYA DE COMUNICACIONES SA (COPACO SA)'), ['COPACO']);
    assert.ok(paraguayRegistryAliasKeys('ADMINISTRACION NACIONAL DE ELECTRICIDAD - ANDE').includes('ANDE'));
    assert.ok(paraguayRegistryAliasKeys('TELEF. CELULAR DEL PARAGUAY SAE (TELECEL SAE)').includes('TELECEL'));
    assert.ok(paraguayRegistryAliasKeys('CORP. PYA. DISTRI. DE DERIV. DE PETROLEO SA - COPETROL').includes('COPETROL'));
  });

  it('la entidad pública suma su clave', () => {
    assert.deepEqual(paraguayRegistryAliasKeys('MUNICIPALIDAD DE LA CIUDAD DE ASUNCION'), ['MUNICIPALIDAD ASUNCION']);
  });

  it('fideicomisos, sindicatos y asociaciones de funcionarios NO dan alias', () => {
    assert.deepEqual(paraguayRegistryAliasKeys('FIDEICOMISO DE GARANTIA - CARPICENTER S.A. - BANCO ATLAS S.A.'), []);
    assert.deepEqual(paraguayRegistryAliasKeys('SIND.DE TRAB.DE LA MUNICIPALIDAD DE ASUNCION (SITRAMA)'), []);
    assert.deepEqual(
      paraguayRegistryAliasKeys('AFUMA ASOC. DE FUNCIONARIOS DE LA MUNICIPALIDAD DE ASUNCION'),
      [],
    );
  });

  it('un alias nunca es el nombre propio de otra sociedad', () => {
    const owners = new Map<string, Set<string>>([['BANCO ATLAS', new Set(['80024928-3'])]]);
    for (const key of paraguayOwnNameKeys('BANCO ATLAS')) assert.ok(owners.has(key));
    assert.deepEqual(dropAliasKeysOwnedByOthers(['BANCO ATLAS', 'OTRA'], '80000001-0', owners), ['OTRA']);
  });

  it('filas de alias: mismo RUC y razón social del padrón, identidad por clave', () => {
    const registry = buildPySetRegistryRow(
      '80023541|COMPAÑIA PARAGUAYA DE COMUNICACIONES SA (COPACO SA)|0|CPCA000000A|ACTIVO|',
      params,
    ) as PySetRegistryRow;
    assert.equal(registry.normalized_legal_name, 'COMPANIA PARAGUAYA DE COMUNICACIONES');
    const aliases = buildPySetNameAliasRows({
      registryRow: registry,
      keys: ['COPACO', 'COPACO', registry.normalized_legal_name],
    });
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].source_key, PY_SET_NAME_ALIAS_SOURCE_KEY);
    assert.equal(aliases[0].tax_id, '80023541-0');
    assert.equal(aliases[0].normalized_legal_name, 'COPACO');
    assert.equal(aliases[0].legal_name, registry.legal_name);
    assert.match(aliases[0].record_identity_key ?? '', /^py-name-alias:/);
    assert.equal(getSourceFamily(PY_SET_NAME_ALIAS_SOURCE_KEY), 'NATIVE_RECORD_GRAIN');
    assert.equal(getSourceFamily('py_dncp_directory'), 'TAX_GRAIN');
  });
});

describe('variantes del nombre del candidato', () => {
  const cores = (name: string) => paraguayCandidateNameVariants(name).map((v) => v.core);

  it('el núcleo de siempre va primero', () => {
    assert.equal(cores('Banco Continental S.A.E.C.A.')[0], 'BANCO CONTINENTAL');
  });

  it('con y sin «de/del Paraguay»', () => {
    assert.ok(cores('Unilever Paraguay').includes('UNILEVER DE PARAGUAY'));
    assert.ok(cores('Ajinomoto del Paraguay').includes('AJINOMOTO'));
    assert.ok(cores('Bepsa').length === 1);
  });

  it('restos de la web y partes', () => {
    assert.ok(cores('konecta.com.py').includes('KONECTA'));
    assert.ok(cores('ANDE - Administración Nacional de Electricidad').includes('ANDE'));
  });

  it('la clave pública va justo detrás de su variante', () => {
    const variants = paraguayCandidateNameVariants('Gobernación de Central');
    assert.deepEqual(variants.slice(0, 2).map((v) => v.core), ['GOBERNACION DE CENTRAL', 'GOBERNACION CENTRAL']);
    assert.equal(variants[1].origin, 'public');
  });
});

describe('web de la fuente y confirmación de una palabra', () => {
  it('web declarada primero; si no, el correo corporativo; nunca un correo gratuito', () => {
    assert.deepEqual(paraguayCompanyDomain({ url: 'www.konecta.com.py', email: 'x@gmail.com' }), {
      domain: 'konecta.com.py',
      origin: 'url',
    });
    assert.deepEqual(paraguayCompanyDomain({ url: null, email: 'patricia@alephsrl.com.py' }), {
      domain: 'alephsrl.com.py',
      origin: 'email',
    });
    assert.equal(paraguayCompanyDomain({ url: null, email: 'agosto7srl@hotmail.com' }), null);
    assert.equal(paraguayCompanyDomain({ url: null, email: 'altamirasrl@tigo.com.py' }), null);
    assert.equal(paraguayCompanyDomain({ url: 'http://ventas.gmail.com', email: null }), null);
  });

  it('la etiqueta del dominio confirma la palabra; un dominio del Estado sólo a una entidad pública', () => {
    assert.equal(paraguaySingleWordConfirmedByDomain('bancard.com.py', 'BANCARD', { publicEntity: false }), true);
    assert.equal(paraguaySingleWordConfirmedByDomain('https://www.ande.gov.py/', 'ANDE', { publicEntity: true }), true);
    assert.equal(paraguaySingleWordConfirmedByDomain('ande.gov.py', 'ANDE', { publicEntity: false }), false);
    assert.equal(paraguaySingleWordConfirmedByDomain('pilar.com.py', 'BANCARD', { publicEntity: false }), false);
    assert.equal(paraguaySingleWordConfirmedByDomain(null, 'BANCARD', { publicEntity: false }), false);
  });
});

describe('tamaño MIPYME declarado a la DNCP', () => {
  it('llega como tramo con techo (Ley 4457: micro 10, pequeña 30, mediana 50)', () => {
    const raw = buildPySetRegistryRow('80027374|KONECTA SA|5|X|ACTIVO|', {
      ...params,
      declaredSize: { size: 'MEDIANA', year: 2026 },
    })?.raw_data;
    assert.deepEqual(workforceFromRawData(raw, 'py_dncp_mipyme_size'), {
      workers: 31,
      year: 2026,
      source: 'py_dncp_mipyme_size',
      maxWorkers: 50,
      sizeBand: 'mediana',
    });
    assert.equal(workforceFromRawData({ py_mipyme_size: 'GRANDE', py_mipyme_size_year: 2026 }, 's'), null);
    assert.equal(workforceFromRawData({ py_mipyme_size: 'MICRO' }, 's'), null);
  });

  it('el filtro de tamaño la trata como empresa pequeña (mismo camino que México)', () => {
    const workforce = workforceFromRawData({ py_mipyme_size: 'MEDIANA', py_mipyme_size_year: 2026 }, 'py_dncp_mipyme_size');
    const registry = extractOfficialRegistryWorkforce({
      officialSourceIdentity: { strongIdentityAvailable: true, officialSourceMetadata: { workforce } },
    });
    assert.deepEqual(registry, { workers: 31, year: 2026, source: 'py_dncp_mipyme_size', maxWorkers: 50, band: 'mediana' });
    const out = resolveEmployeeSizeForIcpGate({ officialRegistryWorkforce: registry, referenceYear: 2026, threshold: 200 });
    assert.equal(out.selectedSource, 'official_registry_workers');
    assert.equal(out.icpInput.sizeRange, '31-50');
  });
});

describe('resolvedor de RUC por nombre de Paraguay', () => {
  const registry = (line: string, declared?: 'MICRO' | 'PEQUEÑA' | 'MEDIANA') =>
    buildPySetRegistryRow(line, { ...params, declaredSize: declared ? { size: declared, year: 2026 } : null }) as PySetRegistryRow;
  const rows: PySetRegistryRow[] = [
    registry('80019270|BANCO CONTINENTAL SA EMISORA DE CAPITAL ABIERTO|2|X|ACTIVO|'),
    registry('80023541|COMPAÑIA PARAGUAYA DE COMUNICACIONES SA (COPACO SA)|0|X|ACTIVO|'),
    registry('80013884|BANCARD SA|8|X|ACTIVO|'),
    registry('80102995|PILAR S.A.|3|X|ACTIVO|'),
    registry('80017437|NUCLEO SA|2|X|ACTIVO|'),
    registry('80166598|NUCLEO E.A.S.|1|X|ACTIVO|'),
    registry('80002491|MUNICIPALIDAD DE LA CIUDAD DE ASUNCION|5|X|ACTIVO|'),
    registry('80023081|UNILEVER DE PARAGUAY SA|7|X|ACTIVO|'),
    registry('80027374|KONECTA SA|5|X|ACTIVO|', 'PEQUEÑA'),
  ];
  const aliases = rows.flatMap((row) =>
    buildPySetNameAliasRows({ registryRow: row, keys: paraguayRegistryAliasKeys(row.legal_name) }),
  );
  const table: ParaguayNameRow[] = [...rows, ...aliases].map((row) => ({
    taxId: row.normalized_tax_id,
    legalName: row.legal_name,
    normalizedLegalName: row.normalized_legal_name,
    workforce: workforceFromRawData(row.raw_data, 'py_dncp_mipyme_size'),
    alias: row.source_key === PY_SET_NAME_ALIAS_SOURCE_KEY,
  }));
  const asked: string[] = [];
  const resolver = createParaguayOfficialSourceResolver({
    querySnapshots: async (core) => {
      asked.push(core);
      return table.filter((row) => row.normalizedLegalName === core);
    },
  });
  const candidate = (canonicalName: string, domain: string | null = null): NormalizedProspectCandidate =>
    ({ canonicalName, domain, websiteUrl: null, countryCode: 'PY' }) as unknown as NormalizedProspectCandidate;
  const resolve = (name: string, domain: string | null = null) =>
    resolver.resolve({ candidate: candidate(name, domain), criteria: { countryCode: 'PY' }, policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY });

  it('sólo resuelve candidatas de Paraguay', () => {
    assert.equal(resolver.canResolve({ candidate: candidate('Banco Continental'), criteria: {}, policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY }), true);
    assert.equal(
      resolver.canResolve({ candidate: { ...candidate('Banco Continental'), countryCode: 'PE' }, criteria: {}, policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY }),
      false,
    );
  });

  it('forma escrita de otra manera → RUC fuerte', async () => {
    const out = await resolve('Banco Continental S.A.E.C.A.');
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '80019270-2');
    assert.equal(out.sourceKey, 'py_set_registry');
  });

  it('la sigla del padrón con su web → RUC fuerte y razón social del padrón', async () => {
    const out = await resolve('Copaco', 'copaco.com.py');
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '80023541-0');
    assert.equal(out.legalName, 'COMPAÑIA PARAGUAYA DE COMUNICACIONES SA (COPACO SA)');
  });

  it('una palabra sin web que la confirme → sólo pista («Pilar» no es Manufactura de Pilar)', async () => {
    const pilar = await resolve('Pilar');
    assert.equal(pilar.status, 'low_confidence_match');
    const bancard = await resolve('Bancard', 'https://www.bancard.com.py');
    assert.equal(bancard.status, 'matched');
    const withForm = await resolve('Pilar S.A.');
    assert.equal(withForm.status, 'matched');
  });

  it('homónimos (NUCLEO SA y NUCLEO E.A.S.) → pista, nunca RUC fuerte', async () => {
    const out = await resolve('Núcleo S.A.');
    assert.equal(out.status, 'low_confidence_match');
    assert.equal(out.safeMetadata?.['ambiguous'], true);
  });

  it('entidad pública con otra redacción → RUC fuerte por la clave pública', async () => {
    const out = await resolve('Municipalidad de Asunción');
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '80002491-5');
  });

  it('«Unilever Paraguay» encuentra UNILEVER DE PARAGUAY SA', async () => {
    const out = await resolve('Unilever Paraguay');
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '80023081-7');
  });

  it('el tamaño declarado viaja con el RUC fuerte', async () => {
    const out = await resolve('Konecta S.A.');
    assert.equal(out.status, 'matched');
    assert.equal(out.workforce?.sizeBand, 'pequeña');
    assert.equal(out.workforce?.maxWorkers, 30);
  });

  it('nada en el padrón → not_found', async () => {
    const out = await resolve('Empresa Inexistente del Chaco');
    assert.equal(out.status, 'not_found');
  });
});
