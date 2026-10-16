/**
 * AUDIT-A1-WS7 (16-10) — la bolsa libre de HubSpot ya no se agota:
 *
 *   · la regla de «libre» va en la búsqueda (etapa ≠ cliente, sin actividad de
 *     ventas en 30 días) dentro de los límites de HubSpot (≤ 5 grupos, ≤ 6 filtros
 *     por grupo, ≤ 18 en total); la regla completa sigue decidiendo en el cliente;
 *   · más páginas por bolsa cuando lo ya visto ocupa el principio del orden;
 *   · lo leído y rechazado se devuelve (y el drawer lo guarda en la metadata del
 *     lote) para no reprocesarlo en cada corrida.
 *
 *   LIVE_PROVIDER_CALLS = 0 · HUBSPOT_WRITES = 0
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFreePoolFilterGroups,
  HUBSPOT_FREE_POOL_MAX_PAGES_PER_SEGMENT,
  resetHubSpotOwnerDirectoryCache,
  searchHubSpotFreeCompanies,
} from '../hubspot-free-company-pool.server';
import {
  createHubSpotFreePoolDrawer,
  HUBSPOT_FREE_POOL_REJECTED_IDS_KEY,
} from '@/server/prospect-batches/hubspot-free-pool/hubspot-free-pool-draw';
import { listHubSpotFreePoolRecentlyRejected } from '@/server/prospect-batches/hubspot-free-pool/hubspot-free-pool-draw.server';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';

const NOW = new Date('2026-10-16T12:00:00.000Z');

type Filter = { propertyName: string; operator: string; value?: string; values?: string[] };

describe('buildFreePoolFilterGroups', () => {
  const common: Filter[] = [
    { propertyName: 'pais', operator: 'EQ', value: 'Colombia' },
    { propertyName: 'industriaespecifica', operator: 'EQ', value: 'Tecnología' },
    { propertyName: 'domain', operator: 'HAS_PROPERTY' },
  ];
  const groups = buildFreePoolFilterGroups(common, [{ propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' }], NOW);

  it('respeta los límites de HubSpot', () => {
    assert.ok(groups.length <= 5);
    for (const group of groups) assert.ok(group.filters.length <= 6, `filtros por grupo: ${group.filters.length}`);
    assert.ok(groups.reduce((n, g) => n + g.filters.length, 0) <= 18);
  });

  it('excluye clientes y la actividad de ventas de los últimos 30 días (LT o sin valor)', () => {
    for (const group of groups) {
      const lifecycle = group.filters.find((f) => f.propertyName === 'lifecyclestage');
      assert.equal(lifecycle?.operator, 'NOT_IN');
      assert.ok(lifecycle?.values?.includes('1443029400'));
    }
    const activity = groups.map((g) => g.filters.find((f) => f.propertyName === 'hs_last_sales_activity_timestamp'));
    assert.deepEqual(activity.map((f) => f?.operator).sort(), ['LT', 'NOT_HAS_PROPERTY']);
    const cutoff = Number(activity.find((f) => f?.operator === 'LT')?.value);
    assert.equal(cutoff, NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
  });
});

describe('searchHubSpotFreeCompanies — páginas y rechazados', () => {
  it('sigue paginando cuando lo ya ofrecido ocupa el principio y devuelve los rechazados', async () => {
    resetHubSpotOwnerDirectoryCache();
    let page = 0;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.includes('/crm/v3/owners')) return new Response(JSON.stringify({ results: [] }));
      const body = JSON.parse(String(init?.body));
      const isRecycled = (body.filterGroups[0].filters as Filter[]).some((f) => f.propertyName === 'hs_lead_status');
      if (!isRecycled) return new Response(JSON.stringify({ results: [] }));
      page += 1;
      const row = (id: string, extra: Record<string, string | null> = {}) => ({
        id,
        properties: {
          name: id, domain: `${id}.co`, hs_lead_status: 'Recycled', hubspot_owner_id: null, lifecyclestage: 'lead',
          hs_num_open_deals: '0', hs_last_sales_activity_timestamp: null, ...extra,
        },
      });
      // Páginas 1-3: lo ya ofrecido + una con negocio abierto; página 4: una nueva.
      const results = page < 4 ? [row(`old${page}`), row(`deal${page}`, { hs_num_open_deals: '2' })] : [row('nueva')];
      return new Response(JSON.stringify({ results, paging: page < 4 ? { next: { after: String(page) } } : undefined }));
    }) as typeof fetch;

    const result = await searchHubSpotFreeCompanies(
      { countryCode: 'CO', macroIndustryKey: 'technology', limit: 1, excludeHubSpotCompanyIds: new Set(['old1', 'old2', 'old3']) },
      { fetchFn, now: NOW, resolveToken: async () => 't' },
    );
    assert.ok(HUBSPOT_FREE_POOL_MAX_PAGES_PER_SEGMENT > 3);
    assert.deepEqual(result.companies.map((c) => c.hubspotCompanyId), ['nueva']);
    assert.deepEqual(result.rejectedHubSpotCompanyIds, ['deal1', 'deal2', 'deal3']);
    resetHubSpotOwnerDirectoryCache();
  });
});

describe('drawer — rechazados a la metadata del lote', () => {
  const company = (id: string) => ({
    hubspotCompanyId: id, name: id, domain: `${id}.co`, website: `https://${id}.co`, countryCode: 'CO', city: null,
    region: null, taxIdentifier: null, employees: 500, linkedinUrl: null, description: null, ownerId: null,
    numContacts: 1, freeReason: 'recycled' as const,
  });
  const candidate = (id: string, free: boolean) =>
    ({
      name: id,
      domain: `${id}.co`,
      duplicateCheck: {
        status: free ? 'new_candidate' : 'existing_in_sellup',
        matches: [],
        ...(free ? { hubspotFreeToTake: { hubspotCompanyId: id, reason: 'recycled', ownerId: null } } : {}),
      },
    }) as unknown as ProspectingPipelineCandidate;

  it('guarda los rechazados de la búsqueda y los no confirmados libres', async () => {
    const metadata: Array<Record<string, unknown>> = [];
    const drawer = createHubSpotFreePoolDrawer({
      industryName: 'Tecnología',
      resolveCap: () => 10,
      listAlreadyOffered: async () => new Set(),
      search: async () => ({
        status: 'ok',
        companies: [company('a'), company('b'), company('c')],
        recordsRead: 4,
        byReason: { recycled: 3 },
        rejectedHubSpotCompanyIds: ['tomada'],
      }),
      buildCandidate: async (c) => {
        if (c.hubspotCompanyId === 'c') throw new Error('boom');
        return candidate(c.hubspotCompanyId, c.hubspotCompanyId === 'a');
      },
      write: async (input) => {
        metadata.push(input.metadata);
        return { candidatesCreated: 1, persistence: { completeValidCandidates: 1 } } as never;
      },
    });
    const out = await drawer({
      countryCode: 'CO', countryName: 'Colombia', macroIndustryKey: 'technology', requestedTarget: 1,
      requestedByUserId: 'u', resolveBatchId: async () => 'b1',
    });
    const telemetry = metadata[0]['hubspot_free_pool_first'] as Record<string, unknown>;
    assert.deepEqual(telemetry[HUBSPOT_FREE_POOL_REJECTED_IDS_KEY], ['tomada', 'b', 'c']);
    assert.deepEqual(out.telemetry[HUBSPOT_FREE_POOL_REJECTED_IDS_KEY], ['tomada', 'b', 'c']);
  });

  it('listHubSpotFreePoolRecentlyRejected lee la metadata de lotes recientes (sólo SELECT)', async () => {
    const calls: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'not', 'gte']) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, args]);
        return builder;
      };
    }
    builder.limit = async () => ({ data: [{ rejected: ['x', 'y'] }, { rejected: null }, { rejected: ['y', 3] }], error: null });
    const client = { from: (table: string) => (calls.push(['from', [table]]), builder) };
    const ids = await listHubSpotFreePoolRecentlyRejected(client as never, NOW.getTime());
    assert.deepEqual([...ids].sort(), ['x', 'y']);
    assert.deepEqual(calls[0], ['from', ['prospect_batches']]);
    const since = calls.find(([m]) => m === 'gte')?.[1];
    assert.deepEqual(since, ['created_at', new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()]);
  });
});
