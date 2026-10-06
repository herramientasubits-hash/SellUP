/**
 * SOURCES-MX-DENUE-FREE-DISCOVERY-1 — descubrimiento gratuito de México (DENUE).
 *
 * Tabla aprobada (trinquete), adapter con consulta doble, consulta en vivo con un
 * fetch doble (sin red) y la puerta previa al pago real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import {
  macroHasMxCoverage,
  MX_DENUE_ESTRATOS,
  MX_DENUE_MACRO_TABLE_VERSION,
  MX_DENUE_QUERY_PLAN,
  MX_SCIAN_MACRO,
  resolveScianMacro,
} from '../mx-denue-macro-table';
import {
  buildMxDenueDiscoveryAdapter,
  completeGenericPublicEntityName,
  completeGenericStateGovernmentName,
  denueWebsiteToDomain,
  MX_DENUE_DISCOVERY_MAX_ROWS,
  MX_DENUE_DISCOVERY_SOURCE_KEY,
  type DenueEstablishment,
  type MxDenueDiscoveryReads,
} from '../mx-denue-discovery-adapter';
import {
  buildDenueActivityUrl,
  buildMxDenueLiveReads,
} from '@/server/source-catalog/connectors/denue-mexico/denue-activity-live-reads';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import {
  buildCountrySourceAdapter,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';

function est(id: string, overrides: Partial<DenueEstablishment> = {}): DenueEstablishment {
  return {
    id,
    name: `EMPRESA SINTETICA ${id}`,
    legalName: `EMPRESA SINTETICA ${id} S.A. DE C.V.`,
    activityCode: '541510',
    activityName: 'Servicios de diseño de sistemas de cómputo y servicios relacionados',
    estrato: '101 a 250 personas',
    website: `WWW.EMPRESA${id}.COM.MX`,
    location: '     , Guadalajara, JALISCO',
    ...overrides,
  };
}

/** Consulta doble: devuelve `byEstrato[estrato]` para cualquier filtro. */
function fakeReads(byEstrato: Record<string, DenueEstablishment[]>) {
  const calls: Array<{ filter: { sector: string; subsector: string; rama: string }; estrato: string; limit: number }> = [];
  const reads: MxDenueDiscoveryReads = {
    async readEstablishments(input) {
      calls.push(input);
      return input.filter === MX_DENUE_QUERY_PLAN.technology[0] ? (byEstrato[input.estrato] ?? []) : [];
    },
  };
  return { reads, calls };
}

function noMatch(input: DuplicateCheckInput): DuplicateCheckResult {
  return { status: 'new_candidate', confidence: 0, input, matches: [], summary: 'no_match', checkedSources: ['sellup', 'hubspot'] };
}

describe('tabla SCIAN aprobada', () => {
  it('fija la tabla aprobada por la dueña (trinquete)', () => {
    assert.equal(Object.keys(MX_SCIAN_MACRO).length, 42);
    assert.equal(MX_SCIAN_MACRO['5415'], 'technology');
    assert.equal(MX_SCIAN_MACRO['515'], null);
    assert.equal(MX_SCIAN_MACRO['61'], null);
    assert.equal(MX_SCIAN_MACRO['72'], null);
    assert.equal(MX_SCIAN_MACRO['4641'], 'health_pharma');
    assert.deepEqual([...MX_DENUE_ESTRATOS], ['7', '6', '5']);
  });

  it('la 519 ya no es Tecnología entera: bibliotecas públicas → Gobierno, portales → Tecnología (dueña, 01-10)', () => {
    assert.equal(MX_SCIAN_MACRO['519'], undefined);
    assert.equal(resolveScianMacro('519212'), 'government');
    assert.equal(resolveScianMacro('519290'), 'technology');
    assert.equal(resolveScianMacro('519211'), null);
    assert.equal(resolveScianMacro('519110'), null);
    // Y se consultan donde corresponde: Gobierno pide la 5192; Tecnología también,
    // pero la tabla descarta las bibliotecas al re-clasificar.
    assert.ok(MX_DENUE_QUERY_PLAN.government.some((f) => f.rama === '5192'));
    assert.ok(MX_DENUE_QUERY_PLAN.technology.some((f) => f.rama === '5192'));
    assert.equal(MX_DENUE_QUERY_PLAN.technology.some((f) => f.subsector === '519' && f.rama === '0'), false);
  });

  it('una búsqueda de Tecnología descarta las bibliotecas públicas y una de Gobierno las ofrece', async () => {
    const rows = [
      est('B1', { activityCode: '519212', name: 'BIBLIOTECA DE MEXICO', legalName: 'BIBLIOTECA DE MEXICO' }),
      est('P1', { activityCode: '519290', name: 'PORTAL SINTETICO', legalName: 'PORTAL SINTETICO S.A. DE C.V.' }),
    ];
    const reads: MxDenueDiscoveryReads = {
      async readEstablishments({ filter, estrato }) {
        return estrato === '7' && filter.rama === '5192' ? rows : [];
      },
    };
    const tech = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(tech.companies.map((c) => c.industryCode), ['519290']);
    const gov = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'government', limit: 10 });
    assert.deepEqual(gov.companies.map((c) => c.industryCode), ['519212']);
  });

  it('gana el prefijo más largo', () => {
    assert.equal(resolveScianMacro('541510'), 'technology'); // 5415 > 54
    assert.equal(resolveScianMacro('541110'), 'services_company'); // bufetes → 54
    assert.equal(resolveScianMacro('541711'), null); // investigación
    assert.equal(resolveScianMacro('325412'), 'health_pharma'); // farmacéutica > 32
    assert.equal(resolveScianMacro('326110'), 'industry_manufacturing_chemicals_automotive');
    assert.equal(resolveScianMacro('311511'), 'consumer_goods');
    assert.equal(resolveScianMacro('464111'), 'health_pharma'); // farmacias > 46
    assert.equal(resolveScianMacro('461110'), 'retail');
    assert.equal(resolveScianMacro('515110'), null); // radio
    assert.equal(resolveScianMacro('511210'), 'technology'); // edición de software
    assert.equal(resolveScianMacro('511110'), null); // periódicos
    assert.equal(resolveScianMacro('562111'), 'energy_mining_environment');
  });

  it('entradas inválidas o sin tabla no tienen macro', () => {
    assert.equal(resolveScianMacro('99'), null);
    assert.equal(resolveScianMacro('abc'), null);
    assert.equal(resolveScianMacro(null), null);
  });

  it('cada macro con plan tiene cobertura; una desconocida no', () => {
    for (const macro of Object.keys(MX_DENUE_QUERY_PLAN)) assert.equal(macroHasMxCoverage(macro), true, macro);
    assert.equal(macroHasMxCoverage('no_existe'), false);
    assert.equal(macroHasMxCoverage(undefined), false);
  });
});

describe('buildMxDenueDiscoveryAdapter', () => {
  it('ofrece de mayor a menor estrato, con macro de la tabla y dominio de la web', async () => {
    const { reads, calls } = fakeReads({
      '7': [est('1', { estrato: '251 y más personas' })],
      '6': [est('2')],
      '5': [est('3', { estrato: '51 a 100 personas' })],
    });
    const result = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 10 });

    assert.equal(result.sourceKey, MX_DENUE_DISCOVERY_SOURCE_KEY);
    assert.deepEqual(result.companies.map((c) => c.recordIdentityKey), ['denue:1', 'denue:2', 'denue:3']);
    const [first] = result.companies;
    assert.equal(first.countryCode, 'MX');
    assert.equal(first.taxId, null);
    assert.equal(first.domain, 'empresa1.com.mx');
    assert.equal(first.city, 'Guadalajara');
    assert.equal(first.region, 'JALISCO');
    assert.equal(first.industryCode, '541510');
    assert.deepEqual(first.officialMacroIndustry, { macroIndustryKeys: ['technology'], tableVersion: MX_DENUE_MACRO_TABLE_VERSION });
    // 5 filtros de tecnología × 3 estratos
    assert.equal(calls.length, 15);
    assert.deepEqual([...new Set(calls.map((c) => c.estrato))], ['7', '6', '5']);
  });

  it('no baja de estrato si ya cubrió el límite', async () => {
    const { reads, calls } = fakeReads({ '7': [est('1'), est('2')] });
    const result = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 2 });
    assert.equal(result.companies.length, 2);
    assert.deepEqual([...new Set(calls.map((c) => c.estrato))], ['7']);
  });

  it('agrupa sucursales de la misma empresa y descarta otras macros', async () => {
    const { reads } = fakeReads({
      '7': [
        est('1', { legalName: 'ACME SOFTWARE S.A. DE C.V.' }),
        est('2', { legalName: 'Acme Software, S.A. de C.V.' }), // sucursal
        est('3', { activityCode: '515110' }), // radio: sin macro
        est('4', { activityCode: '541110' }), // bufete: servicios
        est('5', { legalName: null, name: null }),
      ],
    });
    const result = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.recordIdentityKey), ['denue:1']);
  });

  it('intercala las actividades: Tecnología no se llena sólo con telecomunicaciones (517)', async () => {
    // Cada actividad del plan devuelve SUS filas; antes la primera (517) llenaba el
    // objetivo entero. Hoy se toma una de cada actividad por turno.
    const byRama: Record<string, DenueEstablishment[]> = {
      '5112': [est('S1', { activityCode: '511210' }), est('S2', { activityCode: '511210' })],
      '517': [est('T1', { activityCode: '517311' }), est('T2', { activityCode: '517312' }), est('T3', { activityCode: '517311' })],
      '518': [],
      '5192': [],
      '5415': [est('C1', { activityCode: '541510' })],
    };
    const reads: MxDenueDiscoveryReads = {
      async readEstablishments({ filter, estrato }) {
        if (estrato !== '7') return [];
        const key = filter.rama !== '0' ? filter.rama : filter.subsector;
        return byRama[key] ?? [];
      },
    };
    const result = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 3 });
    assert.deepEqual(
      result.companies.map((company) => company.industryCode),
      ['511210', '517311', '541510'],
    );
  });

  it('una empresa = una fila también por nombre comercial (MEGACABLE y su razón social completa)', async () => {
    const { reads } = fakeReads({
      '7': [
        est('M1', { name: 'MEGACABLE', legalName: 'MEGACABLE', activityCode: '517311' }),
        est('M2', { name: 'MEGACABLE', legalName: 'MEGACABLE COMUNICACIONES DE MEXICO S.A. DE C.V.', activityCode: '517311' }),
        est('X1', { name: 'AXTEL', legalName: 'AXTEL S.A.B. DE C.V.', activityCode: '517311' }),
      ],
    });
    const result = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((company) => company.legalName), ['MEGACABLE', 'AXTEL S.A.B. DE C.V.']);
  });

  it('una macro sin plan no consulta; límite 0 tampoco; techo 200', async () => {
    const { reads, calls } = fakeReads({ '7': [est('1')] });
    const adapter = buildMxDenueDiscoveryAdapter(reads);
    assert.equal((await adapter({ countryCode: 'MX', macroIndustryKey: 'no_existe', limit: 5 })).companies.length, 0);
    assert.equal((await adapter({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 0 })).companies.length, 0);
    assert.equal(calls.length, 0);
    assert.equal(MX_DENUE_DISCOVERY_MAX_ROWS, 200);
  });

  it('dominio: sólo webs con forma de dominio', () => {
    assert.equal(denueWebsiteToDomain('WWW.ATOS.NET'), 'atos.net');
    assert.equal(denueWebsiteToDomain('https://www.axa.mx/contacto'), 'axa.mx');
    assert.equal(denueWebsiteToDomain(''), null);
    assert.equal(denueWebsiteToDomain('NO TIENE'), null);
    assert.equal(denueWebsiteToDomain(null), null);
  });

  it('dominio: una web tecleada mal en DENUE no se convierte en un dominio falso', () => {
    assert.equal(denueWebsiteToDomain('htpsalincebpo.netecc'), null);
    assert.equal(denueWebsiteToDomain('WWW.EMPRESA.COM.MX'), 'empresa.com.mx');
    assert.equal(denueWebsiteToDomain('bibliotecamexico.gob.mx'), 'bibliotecamexico.gob.mx');
    assert.equal(denueWebsiteToDomain('BLUETAB.NET'), 'bluetab.net');
  });
});

describe('consulta en vivo (fetch doble, sin red)', () => {
  const filter = MX_DENUE_QUERY_PLAN.technology[4]; // 5415

  it('arma la URL de BuscarAreaActEstr para todo el país', () => {
    assert.equal(
      buildDenueActivityUrl({ ...filter, estrato: '6', limit: 100, token: 'TKN' }),
      'https://www.inegi.org.mx/app/api/denue/v1/consulta/BuscarAreaActEstr/00/0/0/0/0/54/541/5415/0/0/1/100/0/6/TKN',
    );
  });

  it('pide la clave una sola vez y convierte las filas de DENUE', async () => {
    let tokenCalls = 0;
    const urls: string[] = [];
    const reads = buildMxDenueLiveReads({
      getToken: async () => {
        tokenCalls++;
        return 'TKN';
      },
      fetchImpl: async (url) => {
        urls.push(url);
        return {
          ok: true,
          text: async () =>
            JSON.stringify([
              { Id: '934599', Nombre: 'ATIO', Razon_social: 'ATIO', CLASE_ACTIVIDAD_ID: '541510', Clase_actividad: 'Diseño de sistemas', Estrato: '251 y más personas', Sitio_internet: 'WWW.ATIOGROUP.COM.MX', Ubicacion: ', Cuauhtémoc, CIUDAD DE MÉXICO' },
              { Nombre: 'SIN ID' },
            ]),
        };
      },
    });
    const first = await reads.readEstablishments({ filter, estrato: '7', limit: 50 });
    await reads.readEstablishments({ filter, estrato: '6', limit: 50 });
    assert.equal(tokenCalls, 1);
    assert.equal(urls.length, 2);
    assert.deepEqual(first, [
      { id: '934599', name: 'ATIO', legalName: 'ATIO', activityCode: '541510', activityName: 'Diseño de sistemas', estrato: '251 y más personas', website: 'WWW.ATIOGROUP.COM.MX', location: ', Cuauhtémoc, CIUDAD DE MÉXICO' },
    ]);
  });

  it('sin clave, respuesta de texto, error HTTP o excepción → vacío', async () => {
    const noToken = buildMxDenueLiveReads({ getToken: async () => null, fetchImpl: async () => { throw new Error('no debe llamarse'); } });
    assert.deepEqual(await noToken.readEstablishments({ filter, estrato: '7', limit: 5 }), []);
    const textBody = buildMxDenueLiveReads({ getToken: async () => 'T', fetchImpl: async () => ({ ok: true, text: async () => 'No hay resultados.' }) });
    assert.deepEqual(await textBody.readEstablishments({ filter, estrato: '7', limit: 5 }), []);
    const http = buildMxDenueLiveReads({ getToken: async () => 'T', fetchImpl: async () => ({ ok: false, text: async () => '[]' }) });
    assert.deepEqual(await http.readEstablishments({ filter, estrato: '7', limit: 5 }), []);
    const boom = buildMxDenueLiveReads({ getToken: async () => 'T', fetchImpl: async () => { throw new Error('red caída'); } });
    assert.deepEqual(await boom.readEstablishments({ filter, estrato: '7', limit: 5 }), []);
    const tokenFails = buildMxDenueLiveReads({ getToken: async () => { throw new Error('vault'); }, fetchImpl: async () => { throw new Error('no'); } });
    assert.deepEqual(await tokenFails.readEstablishments({ filter, estrato: '7', limit: 5 }), []);
  });
});

describe('capacidad y puerta previa al pago con México', () => {
  it('México tiene fuente propia; su cobertura sale de su tabla', () => {
    assert.deepEqual(resolveCountrySourceCapability('mx'), { countryCode: 'MX', sourceKey: 'mx_denue_discovery' });
    assert.equal(countrySourceMacroHasCoverage('MX', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('MX', 'no_existe'), false);
    assert.equal(buildCountrySourceAdapter('MX', {}), null);
    assert.ok(buildCountrySourceAdapter('MX', { mxDenueDiscoveryReads: fakeReads({}).reads }));
  });

  it('dos empresas nuevas cierran el objetivo sin pagar', async () => {
    const result = await runPrePaidNoveltyGate(
      { provider: 'lusha', countryCode: 'MX', macroIndustryKey: 'technology', requestedTarget: 2 },
      {
        countrySourceAdapter: buildMxDenueDiscoveryAdapter(fakeReads({ '7': [est('1'), est('2')] }).reads),
        checkCompanyDuplicate: async (input) => noMatch(input),
        listKnownExclusionDomains: async () => [],
      },
    );
    assert.equal(result.context.residualGap, 0);
    assert.equal(result.context.providerRequired, false);
    assert.equal(result.acceptedCompanies.length, 2);
  });
});

describe('«GOBIERNO DEL ESTADO» sin estado (SOURCES-MX-RFC-PUBLIC-LISTS-1)', () => {
  it('se completa con el estado de la ubicación; los demás nombres no cambian', () => {
    assert.equal(completeGenericStateGovernmentName('GOBIERNO DEL ESTADO', 'SONORA'), 'GOBIERNO DEL ESTADO DE SONORA');
    assert.equal(completeGenericStateGovernmentName('Gobierno del Estado Libre y Soberano', 'Jalisco'), 'Gobierno del Estado Libre y Soberano DE JALISCO');
    assert.equal(completeGenericStateGovernmentName('GOBIERNO DEL ESTADO DE JALISCO', 'JALISCO'), 'GOBIERNO DEL ESTADO DE JALISCO');
    assert.equal(completeGenericStateGovernmentName('SECRETARIA DE SALUD', 'TABASCO'), 'SECRETARIA DE SALUD');
    assert.equal(completeGenericStateGovernmentName('GOBIERNO DEL ESTADO', null), 'GOBIERNO DEL ESTADO');
  });

  it('dos gobiernos estatales con el mismo nombre genérico quedan como dos empresas', async () => {
    const generic = { name: 'GOBIERNO DEL ESTADO', legalName: 'GOBIERNO DEL ESTADO', website: null };
    const { reads } = fakeReads({
      '7': [
        est('g1', { ...generic, location: ', Hermosillo, SONORA' }),
        est('g2', { ...generic, location: ', Guadalajara, JALISCO' }),
        est('g3', { ...generic, location: ', Cajeme, SONORA' }),
      ],
    });
    const result = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.legalName), ['GOBIERNO DEL ESTADO DE SONORA', 'GOBIERNO DEL ESTADO DE JALISCO']);
  });
});

describe('organismos públicos genéricos y sucursales de institución (SOURCES-MX-DENUE-QUALITY-1)', () => {
  it('IMSS e ISSSTE: la sucursal es la institución', () => {
    assert.equal(completeGenericPublicEntityName('IMSS CLINICA 76', 'MÉXICO', 'Ecatepec de Morelos'), 'INSTITUTO MEXICANO DEL SEGURO SOCIAL');
    assert.equal(completeGenericPublicEntityName('ISSSTE HOSPITAL REGIONAL', 'JALISCO', 'Zapopan'), 'INSTITUTO DE SEGURIDAD Y SERVICIOS SOCIALES DE LOS TRABAJADORES DEL ESTADO');
    assert.equal(completeGenericPublicEntityName('IMSS BIENESTAR HOSPITAL RURAL', 'OAXACA', 'Tlacolula'), 'IMSS BIENESTAR HOSPITAL RURAL', 'IMSS-Bienestar es otro organismo');
    assert.equal(completeGenericPublicEntityName('PEMEX SERVICIO LAS FLORES', 'JALISCO', 'Guadalajara'), 'PEMEX SERVICIO LAS FLORES', 'gasolinera privada: no se toca');
  });

  it('organismo estatal genérico → con su estado; la Secretaría de Salud en CDMX es la federal', () => {
    assert.equal(completeGenericPublicEntityName('SECRETARIA DE SALUD', 'TABASCO', 'Centro'), 'SECRETARIA DE SALUD DE TABASCO');
    assert.equal(completeGenericPublicEntityName('SERVICIOS DE SALUD', 'VERACRUZ DE IGNACIO DE LA LLAVE', 'Xalapa'), 'SERVICIOS DE SALUD DE VERACRUZ DE IGNACIO DE LA LLAVE');
    assert.equal(completeGenericPublicEntityName('PODER JUDICIAL DEL ESTADO', 'NUEVO LEÓN', 'Monterrey'), 'PODER JUDICIAL DEL ESTADO DE NUEVO LEÓN');
    assert.equal(completeGenericPublicEntityName('SECRETARIA DE SALUD', 'CIUDAD DE MÉXICO', 'Cuauhtémoc'), 'SECRETARIA DE SALUD');
    assert.equal(completeGenericPublicEntityName('SECRETARIA DE SALUD DE MICHOACAN', 'MICHOACÁN DE OCAMPO', 'Morelia'), 'SECRETARIA DE SALUD DE MICHOACAN');
  });

  it('ayuntamiento o municipio genérico → con su municipio', () => {
    assert.equal(completeGenericPublicEntityName('H. AYUNTAMIENTO', 'MÉXICO', 'Tlalnepantla de Baz'), 'H. AYUNTAMIENTO DE TLALNEPANTLA DE BAZ');
    assert.equal(completeGenericPublicEntityName('PRESIDENCIA MUNICIPAL', 'JALISCO', null), 'PRESIDENCIA MUNICIPAL');
  });

  it('sucursales del IMSS con nombre comercial distinto quedan como UNA empresa', async () => {
    const imss = (id: string, name: string) => est(id, { name, legalName: null, website: null, location: ', Ecatepec de Morelos, MÉXICO' });
    const { reads } = fakeReads({ '7': [imss('i1', 'IMSS CLINICA 76'), imss('i2', 'IMSS HOSPITAL GENERAL DE ZONA 68')] });
    const result = await buildMxDenueDiscoveryAdapter(reads)({ countryCode: 'MX', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.legalName), ['INSTITUTO MEXICANO DEL SEGURO SOCIAL']);
  });
});
