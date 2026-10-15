/**
 * Tests — empresas LIBRES de HubSpot (HUBSPOT-FREE-POOL-SOURCE-1).
 *
 * Cubre la regla pura, el marcado de coincidencias del detector de duplicados, la
 * capa «primero HubSpot» del Agente 1 y el paso de aprobación (qué ficha se enlaza
 * y cuándo se cambia el dueño). Sin red: todo entra por puertas inyectadas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHubSpotOwnerDirectory,
  classifyHubSpotCompanyAvailability,
  hubSpotMacroIndustryValue,
  hubSpotPaisForCountryCode,
  isHubSpotPoolOwnerName,
  parseHubSpotTimestamp,
  RECENT_SALES_ACTIVITY_DAYS,
} from '../hubspot-free-company-policy';
import {
  buildFreePoolSearchSegments,
  lastHubSpotOwnerDirectoryFailure,
  loadHubSpotOwnerDirectory,
  resetHubSpotOwnerDirectoryCache,
  searchHubSpotFreeCompanies,
} from '../hubspot-free-company-pool.server';
import { fetchHubSpotWithRetry, hubSpotRetryDelayMs } from '../hubspot-rate-limit';
import {
  markFreeHubSpotMatchesPure,
  resolveHubSpotFreeToTake,
} from '@/server/agents/prospecting-toolkit/hubspot-free-match';
import { classifyDuplicateIdentityEvidence } from '@/server/agents/prospecting-toolkit/strong-identity-duplicate-match';
import type { DuplicateMatch, ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import {
  createHubSpotFreePoolDrawer,
  isConfirmedFreeCandidate,
  mapWithConcurrency,
} from '@/server/prospect-batches/hubspot-free-pool/hubspot-free-pool-draw';
import {
  blocksHubSpotCreate,
  decideFreePoolOwnerWrite,
  readStoredFreePoolCompanyId,
  resolveFreePoolApprovalLink,
} from '@/modules/prospect-batches/hubspot-free-pool-approval';

const NOW = new Date('2026-10-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const owners = buildHubSpotOwnerDirectory(
  [
    { id: '1', firstName: 'Sales', lastName: 'Colombia' },
    { id: '2', firstName: 'KAM', lastName: 'Virtual' },
    { id: '3', firstName: 'Jorge', lastName: 'Gamarra' },
    { id: '4', firstName: 'Marketing', lastName: 'UBITS' },
  ],
  [
    { id: '9', firstName: 'Miguel', lastName: 'Benedetti' },
    { id: '3', firstName: 'Jorge', lastName: 'Gamarra' },
  ],
);

const props = (overrides: Record<string, unknown> = {}) => ({
  hubspot_owner_id: '3',
  hs_lead_status: null,
  lifecyclestage: 'lead',
  hs_num_open_deals: '0',
  hs_last_sales_activity_timestamp: null,
  ...overrides,
});

describe('regla de empresa libre', () => {
  it('reconoce las bolsas por nombre y nada más', () => {
    assert.equal(isHubSpotPoolOwnerName('Sales Colombia'), true);
    assert.equal(isHubSpotPoolOwnerName('Sales  enterprise'), true);
    assert.equal(isHubSpotPoolOwnerName('Ventas UBits'), true);
    assert.equal(isHubSpotPoolOwnerName('Equipo UBITS'), true);
    assert.equal(isHubSpotPoolOwnerName('KAM Virtual'), true);
    assert.equal(isHubSpotPoolOwnerName('Marketing UBITS'), false);
    assert.equal(isHubSpotPoolOwnerName('Salesforce Admin Pérez'), false);
    assert.equal(isHubSpotPoolOwnerName('Jorge Gamarra'), false);
  });

  it('un dueño archivado que sigue activo NO es desactivado', () => {
    assert.equal(owners.deactivatedIds.has('3'), false);
    assert.equal(owners.deactivatedIds.has('9'), true);
    assert.deepEqual([...owners.poolIds].sort(), ['1', '2']);
  });

  it('las cuatro bolsas son libres', () => {
    assert.deepEqual(classifyHubSpotCompanyAvailability(props({ hs_lead_status: 'Recycled' }), owners, NOW), {
      free: true,
      reason: 'recycled',
    });
    assert.deepEqual(classifyHubSpotCompanyAvailability(props({ hubspot_owner_id: '1' }), owners, NOW), {
      free: true,
      reason: 'pool_owner',
    });
    assert.deepEqual(classifyHubSpotCompanyAvailability(props({ hubspot_owner_id: null }), owners, NOW), {
      free: true,
      reason: 'no_owner',
    });
    assert.deepEqual(classifyHubSpotCompanyAvailability(props({ hubspot_owner_id: '9' }), owners, NOW), {
      free: true,
      reason: 'deactivated_owner',
    });
  });

  it('un vendedor activo, o un dueño que nadie conoce, la tienen tomada', () => {
    assert.deepEqual(classifyHubSpotCompanyAvailability(props(), owners, NOW), { free: false, reason: 'active_owner' });
    assert.deepEqual(classifyHubSpotCompanyAvailability(props({ hubspot_owner_id: '777' }), owners, NOW), {
      free: false,
      reason: 'unknown_owner',
    });
  });

  it('cliente, negocio abierto o actividad reciente bloquean aunque esté reciclada', () => {
    const recycled = { hs_lead_status: 'Recycled' };
    assert.equal(
      classifyHubSpotCompanyAvailability(props({ ...recycled, lifecyclestage: '1443029400' }), owners, NOW).reason,
      'customer',
    );
    assert.equal(
      classifyHubSpotCompanyAvailability(props({ ...recycled, lifecyclestage: 'customer' }), owners, NOW).reason,
      'customer',
    );
    assert.equal(classifyHubSpotCompanyAvailability(props({ ...recycled, hs_num_open_deals: '2' }), owners, NOW).reason, 'open_deal');
    const recent = new Date(NOW.getTime() - (RECENT_SALES_ACTIVITY_DAYS - 1) * DAY).toISOString();
    assert.equal(
      classifyHubSpotCompanyAvailability(props({ ...recycled, hs_last_sales_activity_timestamp: recent }), owners, NOW).reason,
      'recent_sales_activity',
    );
    const old = new Date(NOW.getTime() - (RECENT_SALES_ACTIVITY_DAYS + 1) * DAY).toISOString();
    assert.equal(
      classifyHubSpotCompanyAvailability(props({ ...recycled, hs_last_sales_activity_timestamp: old }), owners, NOW).free,
      true,
    );
  });

  it('traduce país e industria a los valores del portal', () => {
    assert.equal(hubSpotPaisForCountryCode('bo'), 'Bolivia (Estado Plurinacional de)');
    assert.equal(hubSpotPaisForCountryCode('MX'), 'México');
    assert.equal(hubSpotPaisForCountryCode('ZZ'), null);
    assert.equal(hubSpotMacroIndustryValue('health_pharma'), 'Salud & Farmacéuticos');
    assert.equal(hubSpotMacroIndustryValue('services_company'), 'Compañía de Servicios');
    assert.equal(hubSpotMacroIndustryValue('no_existe'), null);
  });
});

describe('coincidencias con empresas libres', () => {
  const exactDomain: DuplicateMatch = {
    source: 'hubspot',
    status: 'existing_in_hubspot',
    confidence: 92,
    matchedId: '555',
    matchedName: 'Axon Group',
    matchedDomain: 'axongroup.com.co',
    reason: 'Dominio exacto coincide en HubSpot',
  };

  const free = () => ({ availability: { free: true as const, reason: 'recycled' as const }, ownerId: '3' });
  const taken = () => ({ availability: { free: false as const, reason: 'active_owner' as const }, ownerId: '3' });
  const sameIdName: DuplicateMatch = { ...exactDomain, status: 'possible_duplicate', confidence: 65, reason: 'nombre' };
  const otherIdName: DuplicateMatch = { ...exactDomain, matchedId: '999', status: 'possible_duplicate', confidence: 50, reason: 'nombre' };

  it('libre ⇒ deja de ser identidad (nadie la descarta) y conserva la ficha', () => {
    const [marked] = markFreeHubSpotMatchesPure([exactDomain], free);
    assert.equal(marked.status, 'new_candidate');
    assert.equal(marked.confidence, 92);
    assert.deepEqual(marked.hubspotFreeToTake, { hubspotCompanyId: '555', reason: 'recycled', ownerId: '3' });
    assert.equal(classifyDuplicateIdentityEvidence(marked).strength, 'none');
    assert.equal(classifyDuplicateIdentityEvidence(exactDomain).strength, 'strong');
  });

  it('tomada o sin veredicto ⇒ nada cambia', () => {
    assert.deepEqual(markFreeHubSpotMatchesPure([exactDomain], taken), [exactDomain]);
    assert.deepEqual(markFreeHubSpotMatchesPure([exactDomain], () => ({ availability: null, ownerId: null })), [exactDomain]);
  });

  it('🔴 un nombre parecido NUNCA se vuelve libre por sí solo (revisión 15-10)', () => {
    const nameOnly: DuplicateMatch = { ...exactDomain, status: 'existing_in_hubspot', confidence: 82, reason: 'nombre normalizado' };
    let asked = 0;
    const out = markFreeHubSpotMatchesPure([nameOnly, otherIdName], () => {
      asked += 1;
      return free();
    });
    assert.equal(asked, 0);
    assert.deepEqual(out, [nameOnly, otherIdName]);
  });

  it('lo débil de la MISMA ficha libre se marca con ella; lo de otra ficha bloquea', () => {
    const marked = markFreeHubSpotMatchesPure([exactDomain, sameIdName], free);
    assert.ok(marked.every((m) => m.status === 'new_candidate'));
    assert.equal(resolveHubSpotFreeToTake('new_candidate', marked)?.hubspotCompanyId, '555');

    const withOther = markFreeHubSpotMatchesPure([exactDomain, otherIdName], free);
    assert.equal(withOther[1].status, 'possible_duplicate');
    assert.equal(resolveHubSpotFreeToTake('new_candidate', withOther), undefined);
    assert.equal(resolveHubSpotFreeToTake('possible_duplicate', withOther), undefined);
  });

  it('SellUp o una ficha tomada bloquean', () => {
    const marked = markFreeHubSpotMatchesPure([exactDomain], free);
    assert.equal(resolveHubSpotFreeToTake('existing_in_hubspot', [...marked, { ...exactDomain, matchedId: '777' }]), undefined);
    assert.equal(resolveHubSpotFreeToTake('existing_in_sellup', marked), undefined);
  });
});

describe('fechas y reintentos', () => {
  it('lee fechas ISO y en milisegundos', () => {
    assert.equal(parseHubSpotTimestamp('2026-10-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'));
    assert.equal(parseHubSpotTimestamp('1727740800000'), 1727740800000);
    assert.equal(parseHubSpotTimestamp(''), null);
    assert.equal(parseHubSpotTimestamp('basura'), null);
  });

  it('429 ⇒ espera (Retry-After o creciente) y reintenta; tope de intentos', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return calls < 3
        ? new Response('{}', { status: 429, headers: calls === 1 ? { 'retry-after': '2' } : {} })
        : new Response('{}', { status: 200 });
    }) as typeof fetch;
    const res = await fetchHubSpotWithRetry('https://api.hubapi.com/x', {}, 1000, {
      fetchFn,
      sleep: async (ms) => {
        waits.push(ms);
      },
      random: () => 0,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(waits, [2000, 2000]);
    calls = -100;
    const always = await fetchHubSpotWithRetry('https://api.hubapi.com/x', {}, 1000, {
      fetchFn: (async () => new Response('{}', { status: 429 })) as typeof fetch,
      sleep: async () => {},
    });
    assert.equal(always.status, 429);
    assert.equal(hubSpotRetryDelayMs(null, 0, () => 0), 1000);
  });

  it('el directorio de dueños se pide UNA vez aunque lo pidan muchos a la vez', async () => {
    resetHubSpotOwnerDirectoryCache();
    let requests = 0;
    const fetchFn = (async () => {
      requests += 1;
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ results: [{ id: '1', firstName: 'Sales', lastName: 'Colombia' }] }));
    }) as typeof fetch;
    const all = await Promise.all(Array.from({ length: 20 }, () => loadHubSpotOwnerDirectory('t', { fetchFn })));
    assert.ok(all.every((d) => d?.poolIds.has('1')));
    assert.equal(requests, 2); // activos + archivados
  });

  it('un fallo del directorio se recuerda un minuto y se informa', async () => {
    resetHubSpotOwnerDirectoryCache();
    let requests = 0;
    const fetchFn = (async () => {
      requests += 1;
      return new Response('{}', { status: 403 });
    }) as typeof fetch;
    assert.equal(await loadHubSpotOwnerDirectory('t', { fetchFn, now: () => 1_000 }), null);
    assert.equal(await loadHubSpotOwnerDirectory('t', { fetchFn, now: () => 2_000 }), null);
    assert.equal(requests, 2);
    assert.deepEqual(lastHubSpotOwnerDirectoryFailure()?.httpStatus, 403);
    resetHubSpotOwnerDirectoryCache();
  });

  it('concurrencia acotada y orden conservado', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 2));
      live -= 1;
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
    assert.equal(peak, 2);
  });
});

describe('búsqueda de libres en HubSpot', () => {
  it('una búsqueda por bolsa, con los IN partidos de a 100', () => {
    const many = buildHubSpotOwnerDirectory(
      Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, firstName: 'Sales', lastName: `País ${i}` })),
      [],
    );
    const segments = buildFreePoolSearchSegments(many);
    assert.deepEqual(
      segments.map((s) => s.reason),
      ['recycled', 'pool_owner', 'pool_owner', 'no_owner'],
    );
    assert.equal(segments[1].filters[0].values?.length, 100);
    assert.equal(segments[2].filters[0].values?.length, 50);
  });

  it('pide por país e industria, aplica la regla y excluye lo ya ofrecido', async () => {
    resetHubSpotOwnerDirectoryCache();
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.includes('/crm/v3/owners')) {
        const archived = url.includes('archived=true');
        return new Response(
          JSON.stringify({
            results: archived
              ? [{ id: '9', firstName: 'Miguel', lastName: 'Benedetti' }]
              : [
                  { id: '1', firstName: 'Sales', lastName: 'Colombia' },
                  { id: '3', firstName: 'Jorge', lastName: 'Gamarra' },
                ],
          }),
        );
      }
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const filters = body.filterGroups[0].filters as Array<{ propertyName: string; value?: string }>;
      const isRecycled = filters.some((f) => f.propertyName === 'hs_lead_status');
      return new Response(
        JSON.stringify({
          results: isRecycled
            ? [
                { id: 'a', properties: { name: 'Axon', domain: 'axon.co', hs_lead_status: 'Recycled', hubspot_owner_id: '3', lifecyclestage: 'lead', hs_num_open_deals: '0', hs_last_sales_activity_timestamp: null, num_associated_contacts: '64' } },
                { id: 'b', properties: { name: 'Ya ofrecida', domain: 'b.co', hs_lead_status: 'Recycled', hubspot_owner_id: '3', lifecyclestage: 'lead', hs_num_open_deals: '0', hs_last_sales_activity_timestamp: null } },
                { id: 'c', properties: { name: 'Con negocio', domain: 'c.co', hs_lead_status: 'Recycled', hubspot_owner_id: '3', lifecyclestage: 'lead', hs_num_open_deals: '1', hs_last_sales_activity_timestamp: null } },
              ]
            : [],
        }),
      );
    }) as typeof fetch;

    const result = await searchHubSpotFreeCompanies(
      { countryCode: 'CO', macroIndustryKey: 'technology', limit: 5, excludeHubSpotCompanyIds: new Set(['b']) },
      { fetchFn, now: NOW, resolveToken: async () => 'token' },
    );
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.companies.map((c) => c.hubspotCompanyId), ['a']);
    assert.equal(result.companies[0].numContacts, 64);
    assert.deepEqual(result.byReason, { recycled: 1 });
    const common = (bodies[0].filterGroups as Array<{ filters: Array<{ propertyName: string; value?: string }> }>)[0].filters;
    assert.ok(common.some((f) => f.propertyName === 'pais' && f.value === 'Colombia'));
    assert.ok(common.some((f) => f.propertyName === 'industriaespecifica' && f.value === 'Tecnología'));
  });

  it('criterios que HubSpot no sabe filtrar ⇒ cero, sin llamar', async () => {
    let called = false;
    const result = await searchHubSpotFreeCompanies(
      { countryCode: 'ZZ', macroIndustryKey: 'technology', limit: 5 },
      { fetchFn: (async () => { called = true; return new Response('{}'); }) as typeof fetch, resolveToken: async () => 't' },
    );
    assert.equal(result.status, 'unsupported_criteria');
    assert.equal(called, false);
  });
});

function candidate(domain: string, freeId: string | null, status: 'new_candidate' | 'existing_in_sellup' = 'new_candidate') {
  return {
    name: domain,
    domain,
    website: `https://${domain}`,
    duplicateCheck: {
      status,
      confidence: 80,
      input: { name: domain },
      matches: [],
      summary: '',
      checkedSources: ['sellup', 'hubspot'],
      ...(freeId ? { hubspotFreeToTake: { hubspotCompanyId: freeId, reason: 'recycled', ownerId: null } } : {}),
    },
  } as unknown as ProspectingPipelineCandidate;
}

describe('capa «primero HubSpot» del Agente 1', () => {
  const company = (id: string, domain: string) => ({
    hubspotCompanyId: id,
    name: domain,
    domain,
    website: `https://${domain}`,
    countryCode: 'CO',
    city: null,
    region: null,
    taxIdentifier: null,
    employees: 500,
    linkedinUrl: null,
    description: null,
    ownerId: null,
    numContacts: 10,
    freeReason: 'recycled' as const,
  });

  it('sólo escribe las que el chequeo confirma libres y cuenta lo que mide el escritor', async () => {
    const written: string[][] = [];
    const drawer = createHubSpotFreePoolDrawer({
      industryName: 'Tecnología',
      resolveCap: () => 10,
      listAlreadyOffered: async () => new Set(['old']),
      search: async (input) => {
        assert.ok(input.excludeHubSpotCompanyIds.has('old'));
        return {
          status: 'ok',
          companies: [company('a', 'a.co'), company('b', 'b.co'), company('c', 'c.co')],
          recordsRead: 3,
          byReason: { recycled: 3 },
        };
      },
      buildCandidate: async (c) =>
        c.hubspotCompanyId === 'a'
          ? candidate('a.co', 'a')
          : c.hubspotCompanyId === 'b'
            ? candidate('b.co', null, 'existing_in_sellup')
            : candidate('c.co', 'otra-ficha'),
      write: async (input) => {
        written.push(input.candidates.map((c) => c.domain as string));
        return { candidatesCreated: 1, persistence: { completeValidCandidates: 1 } } as never;
      },
    });
    const out = await drawer({
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'technology',
      requestedTarget: 10,
      requestedByUserId: 'u',
      resolveBatchId: async () => 'batch',
    });
    assert.deepEqual(written, [['a.co']]);
    assert.equal(out.batchId, 'batch');
    assert.equal(out.persistedCount, 1);
    assert.equal(out.acceptedCount, 1);
    assert.equal(out.telemetry['not_confirmed'], 2);
  });

  it('nada libre ⇒ no materializa lote', async () => {
    let resolved = false;
    const drawer = createHubSpotFreePoolDrawer({
      industryName: 'Tecnología',
      resolveCap: () => 10,
      listAlreadyOffered: async () => null,
      search: async () => ({ status: 'ok', companies: [], recordsRead: 0, byReason: {} }),
      buildCandidate: async () => null,
      write: async () => {
        throw new Error('no debe escribir');
      },
    });
    const out = await drawer({
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'technology',
      requestedTarget: 10,
      requestedByUserId: 'u',
      resolveBatchId: async () => {
        resolved = true;
        return 'batch';
      },
    });
    assert.equal(out.persistedCount, 0);
    assert.equal(resolved, false);
  });

  it('confirma la ficha exacta', () => {
    assert.equal(isConfirmedFreeCandidate(candidate('a.co', 'a'), 'a'), true);
    assert.equal(isConfirmedFreeCandidate(candidate('a.co', 'x'), 'a'), false);
    assert.equal(isConfirmedFreeCandidate(candidate('a.co', 'a', 'existing_in_sellup'), 'a'), false);
  });
});

describe('aprobación de una empresa libre', () => {
  const free = { free: true as const, reason: 'recycled' as const };
  const base = { name: 'Axon', domain: 'axon.co', taxIdentifier: null, countryCode: 'CO' };
  const ports = (identities: Array<{ hubspotCompanyId: string; freeReason: 'recycled' | null }> | null, availability: unknown = free) => ({
    findStrongHubSpotIdentities: async () => identities,
    readLiveAvailability: async () => availability as never,
  });

  it('lee la ficha marcada por el escritor o por Importar', () => {
    assert.equal(readStoredFreePoolCompanyId({ hubspot_free_pool: { company_id: '555' } }), '555');
    assert.equal(
      readStoredFreePoolCompanyId({ validation: { hubspot_duplicate_check: { free_to_take: { company_id: '777' } } } }),
      '777',
    );
    assert.equal(readStoredFreePoolCompanyId({}), null);
  });

  it('ficha marcada ⇒ se enlaza y se comprueba en ese momento', async () => {
    const link = await resolveFreePoolApprovalLink(
      { ...base, candidateMetadata: { hubspot_free_pool: { company_id: '555' } }, matchedCompanyId: null, hubspotCheckStatus: null },
      ports(null),
    );
    assert.deepEqual(link, { kind: 'link', hubspotCompanyId: '555', source: 'candidate_metadata', availability: free });
  });

  it('sin marca ⇒ antes de CREAR vuelve a mirar HubSpot (fiscal, dominio, nombre)', async () => {
    const input = { ...base, candidateMetadata: {}, matchedCompanyId: null, hubspotCheckStatus: 'no_match' };
    assert.deepEqual(await resolveFreePoolApprovalLink(input, ports([{ hubspotCompanyId: '888', freeReason: 'recycled' }])), {
      kind: 'link',
      hubspotCompanyId: '888',
      source: 'live_check',
      availability: free,
    });
    // la tiene otro vendedor ⇒ ni enlazar ni crear
    const taken = await resolveFreePoolApprovalLink(input, ports([{ hubspotCompanyId: '888', freeReason: null }]));
    assert.equal(taken?.kind, 'taken');
    // dos fichas ⇒ revisión
    const two = await resolveFreePoolApprovalLink(input, ports([
      { hubspotCompanyId: '1', freeReason: 'recycled' },
      { hubspotCompanyId: '2', freeReason: null },
    ]));
    assert.deepEqual(two, { kind: 'ambiguous', hubspotCompanyIds: ['1', '2'] });
    // HubSpot no respondió ⇒ revisión, nunca crear a ciegas
    const down = await resolveFreePoolApprovalLink(input, ports(null));
    assert.equal(down?.kind, 'lookup_failed');
    // HubSpot no la tiene ⇒ se crea como siempre
    assert.equal(await resolveFreePoolApprovalLink(input, ports([])), null);
    for (const outcome of [taken, two, down]) assert.equal(blocksHubSpotCreate(outcome), true);
    assert.equal(blocksHubSpotCreate(null), false);
  });

  it('no se mete con coincidencias del flujo de siempre ni con posibles pendientes', async () => {
    let asked = false;
    const spy = {
      findStrongHubSpotIdentities: async () => {
        asked = true;
        return [];
      },
      readLiveAvailability: async () => free,
    };
    assert.equal(await resolveFreePoolApprovalLink({ ...base, candidateMetadata: {}, matchedCompanyId: '42', hubspotCheckStatus: 'match' }, spy), null);
    assert.equal(
      await resolveFreePoolApprovalLink({ ...base, candidateMetadata: {}, matchedCompanyId: null, hubspotCheckStatus: 'possible_match' }, spy),
      null,
    );
    assert.equal(asked, false);
  });

  it('el dueño sólo cambia con bandera, libre AHORA y con mapeo del vendedor', () => {
    assert.deepEqual(decideFreePoolOwnerWrite({ writebackEnabled: false, availability: free, sellerHubSpotOwnerId: '7' }), {
      write: false,
      reason: 'flag_off',
    });
    assert.deepEqual(
      decideFreePoolOwnerWrite({ writebackEnabled: true, availability: { free: false, reason: 'active_owner' }, sellerHubSpotOwnerId: '7' }),
      { write: false, reason: 'not_free_now' },
    );
    assert.deepEqual(decideFreePoolOwnerWrite({ writebackEnabled: true, availability: null, sellerHubSpotOwnerId: '7' }), {
      write: false,
      reason: 'availability_unknown',
    });
    assert.deepEqual(decideFreePoolOwnerWrite({ writebackEnabled: true, availability: free, sellerHubSpotOwnerId: null }), {
      write: false,
      reason: 'no_owner_mapping',
    });
    assert.deepEqual(decideFreePoolOwnerWrite({ writebackEnabled: true, availability: free, sellerHubSpotOwnerId: '7' }), {
      write: true,
      hubspotOwnerId: '7',
    });
  });
});
