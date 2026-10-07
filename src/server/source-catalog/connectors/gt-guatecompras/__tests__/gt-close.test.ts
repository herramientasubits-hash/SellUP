/**
 * SOURCES-GT-CLOSE-1 — NIT, nombres, dominios, filas de carga y resolvedor de
 * Guatemala. Cero E/S. Los nombres y NIT de empresas reales salen de fuentes
 * públicas (listado de agentes de retención del IVA de la SAT, Guatecompras).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { canonicalGuatemalaNit, guatemalaNitCheckDigit } from '../gt-nit';
import {
  endsWithGuatemalaLegalForm,
  guatemalaCandidateNameVariants,
  guatemalaNameCore,
  guatemalaPublicEntityKey,
  guatemalaRegistryAliasKeys,
  isGuatemalaPublicEntityCore,
} from '../gt-name-keys';
import {
  guatemalaCompanyDomainFromEmails,
  guatemalaSingleWordConfirmedByDomain,
  isGuatemalaPersonalEmailDomain,
  registrableGuatemalaDomain,
} from '../gt-domain';
import {
  buildGtGuatecomprasDirectoryRow,
  buildGtNitNameAliasRows,
  buildGtNitRegistryRow,
  gtEntryAliasKeys,
  gtGuatecomprasPriorityScore,
  gtOwnNameKeys,
  gtPreferredLegalName,
  isGtSatPersonName,
  mergeGuatemalaNitSources,
  parseGtGuatecomprasBuyer,
  parseGtGuatecomprasSupplier,
  parseGtSatIvaAgent,
  type GtGuatecomprasSupplier,
  type GtNitEntry,
} from '../gt-sources-rows';
import { normalizeGuatemalaNit } from '../../gt-rgae/gt-nit-normalizer';
import { CENTRAL_AMERICA_LEGAL_FORMS, normalizeCompanyNameCore } from '../../../company-name-core';
import { normalizeHondurasCompanyCore } from '../../hn-contrataciones-abiertas/hn-ocds-rtn-registry-rows';
import { normalizePanamaCompanyCore } from '../../panamacompra-pa/pa-panamacompra-ruc-rows';
import {
  createGuatemalaOfficialSourceResolver,
  type GuatemalaNameRow,
} from '@/server/agents/prospect-intake/resolvers/guatemala-official-source-resolver';
import { buildGuatemalaSnapshotNameQuery } from '@/server/prospect-batches/guatemala-snapshot-query';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';
import { GT_SAT_IVA_AGENT_BAND, workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '@/server/agents/prospecting-toolkit/employee-size-resolver';

describe('NIT de Guatemala', () => {
  it('dígito verificador módulo 11, con K cuando da 10 (NIT reales del listado de la SAT)', () => {
    for (const real of ['697656', '904945', '698827K', '2635828K', '332917', '2844', '4685']) {
      assert.equal(canonicalGuatemalaNit(real), real, real);
    }
    assert.equal(guatemalaNitCheckDigit('698827'), 'K');
    assert.equal(guatemalaNitCheckDigit('x'), null);
  });

  it('acepta el prefijo OCDS, guiones, puntos y la k minúscula; rechaza el verificador malo', () => {
    assert.equal(canonicalGuatemalaNit('GT-NIT-698827K'), '698827K');
    assert.equal(canonicalGuatemalaNit(' 69882-7k '), '698827K');
    assert.equal(canonicalGuatemalaNit('697657'), null);
    assert.equal(canonicalGuatemalaNit('AB'), null);
    assert.equal(canonicalGuatemalaNit(null), null);
  });

  it('el cargador del RGAE ya no pierde los NIT con K', () => {
    assert.deepEqual(normalizeGuatemalaNit('698827-k'), { isValid: true, normalized: '698827K', reason: null, observedLength: 7 });
    assert.equal(normalizeGuatemalaNit('ABC123').reason, 'non_numeric');
  });
});

describe('nombres de Guatemala', () => {
  it('quita la forma societaria por su estructura, también con erratas', () => {
    assert.equal(guatemalaNameCore('ASTROPHYSICS TECHNOLOGY, SOCIEDA ANÓNIMA'), 'ASTROPHYSICS TECHNOLOGY');
    assert.equal(guatemalaNameCore('CORPORACION PROYECO SOCIEDAD ANOMIMA'), 'CORPORACION PROYECO');
    assert.equal(guatemalaNameCore('DISTRIBUIDORA X SOCIEDAD AN NIMA'), 'DISTRIBUIDORA X');
    assert.equal(guatemalaNameCore('CONSTRUCTORA MARHNOS SOCIEDAD ANONIMA DE CAPITALVARIABLE'), 'CONSTRUCTORA MARHNOS');
    assert.equal(guatemalaNameCore("INDUSTRIAS ALIMENTICIAS KERN'S Y COMPAÑIA SOCIEDAD EN COMANDITA POR ACCIONES"), 'INDUSTRIAS ALIMENTICIAS KERNS');
    assert.equal(guatemalaNameCore('GRUPO COBA COPROPIEDAD'), 'GRUPO COBA');
    assert.equal(guatemalaNameCore('HLBAUER ID SERVICES GMBH'), 'HLBAUER ID SERVICES');
    assert.equal(guatemalaNameCore('JAGUAR ENERGY GUATEMALA LLC.'), 'JAGUAR ENERGY GUATEMALA');
  });

  it('«Y Compañía», sucursal, sigla final y nombre comercial tras la forma', () => {
    assert.equal(guatemalaNameCore('COFIÑO STAHL Y COMPAÑIA SOCIEDAD ANONIMA'), 'COFINO STAHL');
    assert.equal(guatemalaNameCore('EDUCTRADE, S.A. (SUCURSAL GUATEMALA)'), 'EDUCTRADE');
    assert.equal(guatemalaNameCore('EMPRESA PROPIETARIA DE LA RED, SOCIEDAD ANONIMA, SUCURSAL GUATEMALA'), 'EMPRESA PROPIETARIA DE LA RED');
    assert.equal(guatemalaNameCore('INSTITUTO DE FOMENTO MUNICIPAL -INFOM-'), 'INSTITUTO DE FOMENTO MUNICIPAL');
    assert.equal(guatemalaNameCore('AEROVIAS DEL CONTINENTE AMERICANO, SOCIEDAD ANONIMA, AVIANCA'), 'AEROVIAS DEL CONTINENTE AMERICANO');
    assert.ok(endsWithGuatemalaLegalForm('TECUN, SOCIEDAD ANONIMA'));
    assert.ok(!endsWithGuatemalaLegalForm('Tecun'));
  });

  it('«&» y «Centro América» se unifican en los dos lados', () => {
    assert.equal(guatemalaNameCore('BANCO G & T CONTINENTAL, SOCIEDAD ANONIMA'), guatemalaNameCore('Banco G&T Continental'));
    assert.equal(guatemalaNameCore('CERVECERIA CENTRO AMERICANA SOCIEDAD ANONIMA'), guatemalaNameCore('Cervecería Centroamericana'));
  });

  it('Honduras y Panamá siguen limpiando exactamente igual (no se tocó la limpieza compartida)', () => {
    const pinned: Array<[string, string]> = [
      ['COFIÑO STAHL Y COMPAÑIA SOCIEDAD ANONIMA', 'COFINO STAHL Y COMPANIA'],
      ['BANCO G & T CONTINENTAL, S.A.', 'BANCO G & T CONTINENTAL'],
      ['INVERSIONES DEL NORTE S. DE R.L. DE C.V.', 'INVERSIONES DEL NORTE'],
      ['CERVECERIA CENTRO AMERICANA SOCIEDAD ANONIMA', 'CERVECERIA CENTRO AMERICANA'],
    ];
    for (const [name, core] of pinned) {
      assert.equal(normalizeCompanyNameCore(name, CENTRAL_AMERICA_LEGAL_FORMS), core, name);
      assert.equal(normalizeHondurasCompanyCore(name), core, name);
      assert.equal(normalizePanamaCompanyCore(name), core, name);
    }
  });

  it('alias: sigla, nombre comercial, partes con «|» y clave de municipalidad sin departamento', () => {
    assert.deepEqual(guatemalaRegistryAliasKeys('INSTITUTO DE FOMENTO MUNICIPAL -INFOM-'), ['INFOM', 'INSTITUTO FOMENTO MUNICIPAL']);
    assert.deepEqual(guatemalaRegistryAliasKeys('AEROVIAS DEL CONTINENTE AMERICANO, SOCIEDAD ANONIMA, AVIANCA'), ['AVIANCA']);
    assert.ok(guatemalaRegistryAliasKeys('MAPFRE | SEGUROS GUATEMALA, SOCIEDAD ANONIMA').includes('MAPFRE'));
    assert.deepEqual(guatemalaRegistryAliasKeys('MUNICIPALIDAD DE COBÁN, ALTA VERAPAZ'), ['MUNICIPALIDAD COBAN']);
    assert.deepEqual(guatemalaRegistryAliasKeys('FIDEICOMISO DE GARANTIA X -FOGAX-'), []);
    assert.deepEqual(guatemalaRegistryAliasKeys('EDUCTRADE, S.A. (SUCURSAL GUATEMALA)'), []);
    assert.equal(guatemalaPublicEntityKey('Municipalidad de Cobán'), 'MUNICIPALIDAD COBAN');
    assert.equal(guatemalaPublicEntityKey('Pollo Campero'), null);
    assert.ok(isGuatemalaPublicEntityCore('MINISTERIO DE EDUCACION'));
  });

  it('variantes del candidato: con y sin «de Guatemala» (también de una palabra) y clave pública', () => {
    const cores = (name: string) => guatemalaCandidateNameVariants(name).map((v) => `${v.core}:${v.origin}`);
    assert.deepEqual(cores('Banco Promerica Guatemala'), [
      'BANCO PROMERICA GUATEMALA:name',
      'BANCO PROMERICA:without_guatemala',
      'BANCO PROMERICA DE GUATEMALA:with_guatemala',
    ]);
    assert.deepEqual(cores('Disagro'), ['DISAGRO:name', 'DISAGRO DE GUATEMALA:with_guatemala', 'DISAGRO GUATEMALA:with_guatemala']);
    assert.deepEqual(cores('Municipalidad de Cobán'), ['MUNICIPALIDAD DE COBAN:name', 'MUNICIPALIDAD COBAN:public']);
    assert.deepEqual(cores('Tigo - Comunicaciones Celulares, S.A.').slice(0, 3), [
      'TIGO COMUNICACIONES CELULARES:name',
      'TIGO:part',
      'COMUNICACIONES CELULARES:part',
    ]);
    assert.deepEqual(guatemalaCandidateNameVariants('  '), []);
  });
});

describe('dominios de Guatemala', () => {
  it('correos gratuitos con cualquier terminación, erratas, universidades y proveedores no son la web', () => {
    for (const host of ['gmail.com', 'yahoo.com.mx', 'hotmial.com', 'gmial.com', 'intelnett.com', 'itelgua.com']) {
      assert.ok(isGuatemalaPersonalEmailDomain(host), host);
    }
    assert.equal(guatemalaCompanyDomainFromEmails(['ana@gmail.com', 'luis@ufm.edu', 'x@uvg.edu.gt', 'y@sat.gob.gt']), null);
    assert.equal(guatemalaCompanyDomainFromEmails(['ana@gmail.com', 'ventas@grupo.cmi.com.gt']), 'cmi.com.gt');
    assert.equal(registrableGuatemalaDomain('www.tecun.com'), 'tecun.com');
  });

  it('una palabra sólo la confirma la web propia; un dominio del Estado sólo a una entidad pública', () => {
    assert.ok(guatemalaSingleWordConfirmedByDomain('https://www.tecun.com/', 'TECUN', { publicEntity: false }));
    assert.ok(!guatemalaSingleWordConfirmedByDomain('igssgt.org', 'IGSS', { publicEntity: true }));
    assert.ok(!guatemalaSingleWordConfirmedByDomain('indes.gob.gt', 'INDES', { publicEntity: false }));
    assert.ok(guatemalaSingleWordConfirmedByDomain('inde.gob.gt', 'INDE', { publicEntity: true }));
    assert.ok(!guatemalaSingleWordConfirmedByDomain('gmail.com', 'GMAIL', { publicEntity: false }));
  });
});

const supplier = (overrides: Partial<GtGuatecomprasSupplier> = {}): GtGuatecomprasSupplier => ({
  nit: '697656',
  name: 'BANCO INDUSTRIAL, SOCIEDAD ANONIMA',
  names: ['BANCO INDUSTRIAL, SOCIEDAD ANONIMA'],
  type: 'SOCIEDAD ANÓNIMA',
  region: 'GUATEMALA',
  locality: 'GUATEMALA',
  emails: ['licitaciones@bi.com.gt'],
  awards: 12,
  amountGtq: 8_000_000,
  buyers: 4,
  lastYear: 2026,
  fam: { '8413': 8_000_000 },
  activity: 'Seguros',
  ...overrides,
});

describe('filas de la carga', () => {
  it('lee las líneas de los extractores', () => {
    const s = parseGtGuatecomprasSupplier({ nit: '697656', name: 'X S.A.', names: ['X S.A.'], type: 'SOCIEDAD ANÓNIMA', emails: ['a@x.com'], awards: 2, amount_gtq: 10.5, buyers: 1, last_year: 2025, fam: { '4321': 10, bad: 3, '1': 2 } });
    assert.deepEqual(s?.fam, { '4321': 10 });
    assert.equal(s?.lastYear, 2025);
    assert.equal(parseGtGuatecomprasSupplier({ name: 'sin nit' }), null);
    assert.equal(parseGtGuatecomprasBuyer({ nit: '2551179', name: 'USAC', level: 'Universidad' })?.level, 'Universidad');
    assert.deepEqual(parseGtSatIvaAgent({ nit: '904945', name: 'POLLO CAMPERO SOCIEDAD ANONIMA', start: '1/11/2006', list_date: '2026-04-01' }), {
      nit: '904945', name: 'POLLO CAMPERO SOCIEDAD ANONIMA', start: '1/11/2006', listDate: '2026-04-01',
    });
  });

  it('personas del listado de la SAT: «APELLIDO,APELLIDO,,NOMBRE»', () => {
    assert.ok(isGtSatPersonName('ORDOÑEZ,GONZALEZ,,OSCAR,RENE'));
    assert.ok(!isGtSatPersonName('BANCO INDUSTRIAL SOCIEDAD ANONIMA'));
    assert.ok(!isGtSatPersonName('COFIÑO STAHL Y COMPAÑIA SOCIEDAD ANONIMA'));
  });

  it('une por NIT, valida el verificador y deja fuera personas y copropiedades', () => {
    const { entries, excluded } = mergeGuatemalaNitSources({
      suppliers: [
        supplier(),
        supplier({ nit: '1244', name: 'PELLECER,CASTRO,,CARLOS', type: 'INDIVIDUAL' }),
        supplier({ nit: '697657', name: 'NIT MALO, S.A.' }),
        supplier({ nit: '2635828k', name: 'COPROPIEDAD X', type: 'COPROPIEDAD' }),
      ],
      buyers: [{ nit: '2551179', name: 'UNIVERSIDAD DE SAN CARLOS DE GUATEMALA', names: [], level: 'Universidad', entityType: 'Entidades Descentralizadas', region: 'GUATEMALA', locality: 'GUATEMALA', processes: 9 }],
      satAgents: [
        { nit: '697656', name: 'BANCO INDUSTRIAL SOCIEDAD ANONIMA', start: '1/11/2006', listDate: '2026-04-01' },
        { nit: '7846', name: 'ORDOÑEZ,GONZALEZ,,OSCAR,RENE', start: null, listDate: null },
      ],
      rgae: [{ nit: '698827-K', name: 'CMI ALIMENTOS, SOCIEDAD ANÓNIMA', economicCapacityKind: 'numeric', economicCapacityGtq: 1e6, resolutionDate: '2025-02-01' }],
    });
    assert.deepEqual([...entries.keys()].sort(), ['2551179', '697656', '698827K']);
    assert.deepEqual(excluded['guatecompras_supplier'], { invalid_nit: 1, person: 2, no_name: 0 });
    assert.deepEqual(excluded['sat_iva_agent'], { invalid_nit: 0, person: 1, no_name: 0 });
    const bi = entries.get('697656')!;
    assert.equal(gtPreferredLegalName(bi), 'BANCO INDUSTRIAL SOCIEDAD ANONIMA');
  });

  const entry = (overrides: Partial<GtNitEntry> = {}): GtNitEntry => ({
    nit: '697656',
    supplier: supplier(),
    buyer: null,
    satAgent: { nit: '697656', name: 'BANCO INDUSTRIAL SOCIEDAD ANONIMA', start: '1/11/2006', listDate: '2026-04-01' },
    rgae: null,
    ...overrides,
  });
  const params = { sourceYear: 2026, importedAt: '2026-10-07T00:00:00.000Z' };

  it('registro: un NIT, una fila con su núcleo, orígenes y señales (nunca trabajadores)', () => {
    const row = buildGtNitRegistryRow(entry(), params)!;
    assert.equal(row.source_key, 'gt_nit_registry');
    assert.equal(row.normalized_tax_id, '697656');
    assert.equal(row.normalized_legal_name, 'BANCO INDUSTRIAL');
    assert.equal(row.record_identity_key, 'tax:697656');
    assert.deepEqual(row.raw_data['origins'], ['guatecompras_supplier', 'sat_iva_agent']);
    assert.equal(row.raw_data['sat_iva_agent_since'], '2006-11-01');
    assert.equal(row.raw_data['workers'], undefined);
    assert.equal(buildGtNitRegistryRow(entry({ supplier: null, satAgent: { nit: '697656', name: ' S.A. ', start: null, listDate: null } }), params), null);
  });

  it('alias: otros nombres del mismo NIT, nunca el nombre propio de otro NIT', () => {
    const avianca = entry({
      nit: '84132965',
      supplier: supplier({ nit: '84132965', name: 'AVIANCA', names: ['AVIANCA'] }),
      satAgent: { nit: '84132965', name: 'AEROVIAS DEL CONTINENTE AMERICANO, SOCIEDAD ANONIMA, AVIANCA', start: null, listDate: null },
    });
    const row = buildGtNitRegistryRow(avianca, params)!;
    assert.deepEqual(gtEntryAliasKeys(avianca, row.normalized_legal_name), ['AVIANCA']);
    assert.deepEqual(gtOwnNameKeys(row), ['AEROVIAS DEL CONTINENTE AMERICANO']);
    const aliasRows = buildGtNitNameAliasRows({ registryRow: row, keys: ['AVIANCA', 'AVIANCA', 'AEROVIAS DEL CONTINENTE AMERICANO'] });
    assert.equal(aliasRows.length, 1);
    assert.equal(aliasRows[0].source_key, 'gt_nit_name_alias');
    assert.equal(aliasRows[0].normalized_legal_name, 'AVIANCA');
    assert.equal(aliasRows[0].raw_data['alias_of'], 'AEROVIAS DEL CONTINENTE AMERICANO');
    assert.equal(aliasRows[0].record_identity_key, 'gt-name-alias:84132965:AVIANCA');
  });

  it('capa gratuita: sociedad relevante con macro dominante, web propia y relevancia', () => {
    const result = buildGtGuatecomprasDirectoryRow(entry({ supplier: supplier({ fam: { '4321': 900, '4410': 100 } }) }), { ...params, sharedDomains: new Set() });
    assert.ok('row' in result);
    if (!('row' in result)) return;
    assert.equal(result.row.source_key, 'gt_guatecompras_directory');
    assert.equal(result.row.raw_data['macro_industry_key'], 'technology');
    assert.equal(result.row.raw_data['website_domain'], 'bi.com.gt');
    assert.equal(result.row.raw_data['sat_iva_agent'], true);
    assert.equal(result.row.priority_score, gtGuatecomprasPriorityScore({ satIvaAgent: true, buyers: 4, awards: 12 }));
    // Un dominio de grupo compartido no se usa como web.
    const shared = buildGtGuatecomprasDirectoryRow(entry({ supplier: supplier({ fam: { '4321': 1 } }) }), { ...params, sharedDomains: new Set(['bi.com.gt']) });
    assert.ok('row' in shared && shared.row.raw_data['website_domain'] === undefined);
  });

  it('capa gratuita: fuera las que no son sociedad, consorcios, sin adjudicación, sin macro o poco relevantes', () => {
    const why = (e: GtNitEntry) => {
      const r = buildGtGuatecomprasDirectoryRow(e, { ...params, sharedDomains: new Set() });
      return 'excluded' in r ? r.excluded : 'row';
    };
    assert.equal(why(entry({ supplier: null })), 'not_a_company');
    assert.equal(why(entry({ supplier: supplier({ type: 'ASOCIACIÓN, FUNDACIÓN, INSTITUCIÓN RELIGIOSA Y OTRAS NO LUCRATIVAS' }) })), 'not_a_company');
    assert.equal(why(entry({ satAgent: null, supplier: supplier({ name: 'CONSORCIO VIAL NORTE' }) })), 'consortium');
    assert.equal(why(entry({ supplier: supplier({ awards: 0 }) })), 'no_awards');
    assert.equal(why(entry({ supplier: supplier({ fam: { '9010': 100 } }) })), 'no_dominant_macro');
    assert.equal(why(entry({ satAgent: null, supplier: supplier({ amountGtq: 4_000_000, fam: { '4321': 1 } }) })), 'not_relevant');
    assert.equal(why(entry({ satAgent: null, supplier: supplier({ amountGtq: 5_000_000, fam: { '4321': 1 } }) })), 'row');
  });
});

function candidate(name: string, domain: string | null = null, countryCode = 'GT'): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName: name, countryCode, domain, websiteUrl: null },
    criteria: { countryCode },
  } as unknown as OfficialSourceResolverInput;
}

function resolverWith(rows: Record<string, GuatemalaNameRow[]>) {
  const asked: string[] = [];
  const resolver = createGuatemalaOfficialSourceResolver({
    querySnapshots: async (core) => {
      asked.push(core);
      return rows[core] ?? [];
    },
  });
  return { resolver, asked };
}

describe('resolvedor de NIT por nombre (gt_nit_registry)', () => {
  it('un NIT con ese núcleo → fuerte, con la razón social del registro', async () => {
    const { resolver } = resolverWith({
      'BANCO INDUSTRIAL': [{ taxId: '697656', legalName: 'BANCO INDUSTRIAL SOCIEDAD ANONIMA', normalizedLegalName: 'BANCO INDUSTRIAL' }],
    });
    const result = await resolver.resolve(candidate('Banco Industrial'));
    assert.equal(result.status, 'matched');
    assert.equal(result.sourceKey, 'gt_nit_registry');
    assert.equal(result.taxIdentifier, '697656');
    assert.equal(result.taxIdentifierType, 'NIT');
    assert.equal(result.legalName, 'BANCO INDUSTRIAL SOCIEDAD ANONIMA');
  });

  it('variante sin «Guatemala» y alias: el mismo NIT por dos filas sigue siendo uno', async () => {
    const { resolver, asked } = resolverWith({
      'BANCO PROMERICA': [
        { taxId: '7112742', legalName: 'BANCO PROMERICA, SOCIEDAD ANONIMA', normalizedLegalName: 'BANCO PROMERICA' },
        { taxId: '7112742', legalName: 'BANCO PROMERICA, SOCIEDAD ANONIMA', normalizedLegalName: 'BANCO PROMERICA', alias: true },
      ],
    });
    const result = await resolver.resolve(candidate('Banco Promerica Guatemala'));
    assert.equal(result.status, 'matched');
    assert.deepEqual(asked, ['BANCO PROMERICA GUATEMALA', 'BANCO PROMERICA']);
    assert.equal(result.safeMetadata?.['nameVariant'], 'without_guatemala');
  });

  it('dos NIT distintos → pista, nunca fuerte', async () => {
    const { resolver } = resolverWith({
      'MUNICIPALIDAD SAN JOSE': [
        { taxId: '697656', legalName: 'MUNICIPALIDAD DE SAN JOSE, PETEN', normalizedLegalName: 'MUNICIPALIDAD SAN JOSE', alias: true },
        { taxId: '904945', legalName: 'MUNICIPALIDAD DE SAN JOSE, ESCUINTLA', normalizedLegalName: 'MUNICIPALIDAD SAN JOSE', alias: true },
      ],
    });
    const result = await resolver.resolve(candidate('Municipalidad de San José'));
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.safeMetadata?.['candidateCount'], 2);
  });

  it('una palabra: pista sin web; fuerte si la web lo confirma (también por «de Guatemala»)', async () => {
    const rows = {
      TECUN: [{ taxId: '94677026', legalName: 'TECUN, SOCIEDAD ANONIMA', normalizedLegalName: 'TECUN' }],
      'DISAGRO DE GUATEMALA': [{ taxId: '26702827', legalName: 'DISAGRO DE GUATEMALA, SOCIEDAD ANONIMA', normalizedLegalName: 'DISAGRO DE GUATEMALA' }],
    };
    const { resolver } = resolverWith(rows);
    assert.equal((await resolver.resolve(candidate('Tecun'))).status, 'low_confidence_match');
    assert.equal((await resolver.resolve(candidate('Tecun', 'tecun.com'))).status, 'matched');
    assert.equal((await resolver.resolve(candidate('Disagro'))).status, 'low_confidence_match');
    const confirmed = await resolver.resolve(candidate('Disagro', 'disagro.com'));
    assert.equal(confirmed.status, 'matched');
    assert.equal(confirmed.taxIdentifier, '26702827');
  });

  it('descarta filas con otro núcleo o NIT inválido; sin filas → no encontrado; sólo Guatemala', async () => {
    const { resolver } = resolverWith({
      'POLLO CAMPERO': [
        { taxId: '904946', legalName: 'POLLO CAMPERO SOCIEDAD ANONIMA', normalizedLegalName: 'POLLO CAMPERO' },
        { taxId: '904945', legalName: 'OTRO', normalizedLegalName: 'OTRO NUCLEO' },
      ],
    });
    assert.equal((await resolver.resolve(candidate('Pollo Campero'))).status, 'not_found');
    assert.equal(resolver.canResolve(candidate('Pollo Campero', null, 'HN')), false);
    assert.equal(resolver.canResolve(candidate('ab')), false);
    assert.equal(resolver.canResolve(candidate('Pollo Campero')), true);
  });
});

describe('lectura de producción (buildGuatemalaSnapshotNameQuery)', () => {
  function fakeClient(result: { data?: unknown; error?: unknown; throws?: boolean }) {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'eq', 'in']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.limit = (...args: unknown[]) => {
      calls.push({ method: 'limit', args });
      if (result.throws) return Promise.reject(new Error('down'));
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    };
    for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      builder[write] = () => {
        throw new Error(`escritura prohibida: ${write}`);
      };
    }
    return { client: builder as unknown as SupabaseClient, calls };
  }

  it('un SELECT acotado al registro y sus alias de GT, por núcleo exacto', async () => {
    const { client, calls } = fakeClient({
      data: [
        { source_key: 'gt_nit_registry', normalized_tax_id: '697656', legal_name: 'BANCO INDUSTRIAL SOCIEDAD ANONIMA', normalized_legal_name: 'BANCO INDUSTRIAL' },
        { source_key: 'gt_nit_name_alias', normalized_tax_id: '84132965', legal_name: 'AEROVIAS', normalized_legal_name: 'AVIANCA' },
      ],
    });
    const rows = await buildGuatemalaSnapshotNameQuery(client)(' BANCO INDUSTRIAL ');
    assert.deepEqual(rows.map((r) => r.alias), [false, true]);
    assert.deepEqual(calls.find((c) => c.method === 'in')?.args, ['source_key', ['gt_nit_registry', 'gt_nit_name_alias']]);
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['country_code', 'GT'],
      ['normalized_legal_name', 'BANCO INDUSTRIAL'],
    ]);
    assert.deepEqual(calls.at(-1), { method: 'limit', args: [20] });
  });

  it('vacío no consulta; un error o una excepción devuelven []', async () => {
    const idle = fakeClient({ data: [] });
    assert.deepEqual(await buildGuatemalaSnapshotNameQuery(idle.client)('  '), []);
    assert.equal(idle.calls.length, 0);
    assert.deepEqual(await buildGuatemalaSnapshotNameQuery(fakeClient({ error: {} }).client)('A B'), []);
    assert.deepEqual(await buildGuatemalaSnapshotNameQuery(fakeClient({ throws: true }).client)('A B'), []);
  });
});

describe('agente de retención del IVA (SAT) → filtro de tamaño', () => {
  const ivaBand = { workers: 0, year: 2026, source: 'gt_sat_iva_agent', maxWorkers: null, sizeBand: GT_SAT_IVA_AGENT_BAND };

  it('sólo un agente de retención da tramo; el año sale del listado o del de respaldo', () => {
    assert.deepEqual(workforceFromRawData({ sat_iva_agent: true, sat_list_date: '2026-04-01' }, 'gt_sat_iva_agent'), ivaBand);
    assert.deepEqual(workforceFromRawData({ sat_iva_agent: true }, 'gt_sat_iva_agent', 2026), ivaBand);
    assert.equal(workforceFromRawData({ sat_iva_agent: true }, 'gt_sat_iva_agent'), null);
    // No estar en la lista no prueba que sea pequeña.
    assert.equal(workforceFromRawData({ sat_iva_agent: false, awarded_gtq: 5_000_000 }, 'gt_sat_iva_agent', 2026), null);
  });

  it('la lectura trae raw_data y pone el tramo sólo en las filas de agentes', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'eq', 'in']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.limit = () =>
      Promise.resolve({
        data: [
          { source_key: 'gt_nit_registry', normalized_tax_id: '697656', legal_name: 'BANCO INDUSTRIAL', normalized_legal_name: 'BANCO INDUSTRIAL', raw_data: { sat_iva_agent: true, sat_list_date: '2026-04-01' } },
          { source_key: 'gt_nit_registry', normalized_tax_id: '904946', legal_name: 'OTRA', normalized_legal_name: 'BANCO INDUSTRIAL', raw_data: { awards: 1 } },
        ],
        error: null,
      });
    const rows = await buildGuatemalaSnapshotNameQuery(builder as unknown as SupabaseClient)('BANCO INDUSTRIAL');
    assert.match(String(calls.find((c) => c.method === 'select')?.args[0]), /raw_data/);
    assert.deepEqual(rows[0].workforce, ivaBand);
    assert.equal(rows[1].workforce, null);
  });

  it('el NIT seguro lleva el tramo a la ficha y NO decide (ni aprueba ni descarta)', async () => {
    const { resolver } = resolverWith({
      'BANCO INDUSTRIAL': [
        { taxId: '697656', legalName: 'BANCO INDUSTRIAL SOCIEDAD ANONIMA', normalizedLegalName: 'BANCO INDUSTRIAL', alias: true, workforce: ivaBand },
        { taxId: '697656', legalName: 'BANCO INDUSTRIAL SOCIEDAD ANONIMA', normalizedLegalName: 'BANCO INDUSTRIAL', workforce: null },
      ],
    });
    const out = await resolver.resolve(candidate('Banco Industrial'));
    assert.equal(out.status, 'matched');
    assert.deepEqual(out.workforce, ivaBand);

    const registry = extractOfficialRegistryWorkforce({
      officialSourceIdentity: { strongIdentityAvailable: true, officialSourceMetadata: { workforce: out.workforce } },
    });
    const resolved = resolveEmployeeSizeForIcpGate({ threshold: 200, referenceYear: 2026, officialRegistryWorkforce: registry });
    assert.equal(resolved.selectedSource, 'unknown');
    const attempt = resolved.attemptedSources.find((a) => a.source === 'official_registry_workers');
    assert.equal(attempt?.usable, false);
    assert.match(attempt?.reason ?? '', /agente de retención del IVA/);
  });

  it('una pista (dos NIT) no lleva tramo', async () => {
    const { resolver } = resolverWith({
      'MUNICIPALIDAD SAN JOSE': [
        { taxId: '697656', legalName: 'A', normalizedLegalName: 'MUNICIPALIDAD SAN JOSE', workforce: ivaBand },
        { taxId: '904945', legalName: 'B', normalizedLegalName: 'MUNICIPALIDAD SAN JOSE' },
      ],
    });
    const out = await resolver.resolve(candidate('Municipalidad de San José'));
    assert.equal(out.status, 'low_confidence_match');
    assert.equal(out.workforce, undefined);
  });
});

describe('guardas estáticas', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

  it('el factory construye Guatemala: registro unido primero y el RGAE de respaldo', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(
      wiring,
      /createFallbackOfficialSourceResolver\(\s*createGuatemalaOfficialSourceResolver\(\{\s*querySnapshots: buildGuatemalaSnapshotNameQuery\(snapshotClient\),\s*\}\),\s*createSnapshotNameOfficialSourceResolver\(\{\s*countryCode: 'GT',\s*sourceKey: 'gt_rgae_proveedores'/,
    );
  });

  it('la lectura y el resolvedor no escriben, no construyen cliente y no leen env', () => {
    for (const file of [
      'src/server/prospect-batches/guatemala-snapshot-query.ts',
      'src/server/agents/prospect-intake/resolvers/guatemala-official-source-resolver.ts',
    ]) {
      const code = read(file);
      assert.doesNotMatch(code, /\.(insert|update|upsert|delete|rpc)\s*\(/, file);
      assert.doesNotMatch(code, /createClient\s*\(|createSupabaseAdminClient\s*\(/, file);
      assert.doesNotMatch(code, /process\.env|\bfetch\s*\(/, file);
    }
  });

  it('la carga es dry-run por defecto, una clave cada vez y pasa por la valla de cargas masivas', () => {
    const etl = read('scripts/source-catalog/run-gt-sources-etl.ts');
    assert.match(etl, /const apply = argv\.includes\('--apply'\);/);
    assert.match(etl, /--apply exige --only=/);
    assert.match(etl, /assertLargeImportAllowed\(\{ sourceKey, countryCode: 'GT'/);
  });
});
