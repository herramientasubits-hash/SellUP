/**
 * Tests — tomar una empresa libre en HubSpot (HUBSPOT-FREE-POOL-SOURCE-1).
 *
 * Decisión de la dueña (15-10): al tomarla, dueño = vendedor, estado de lead «New»,
 * y los contactos pasan al vendedor salvo los de OTRO
 * vendedor activo. Sin red: HubSpot simulado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHubSpotClaimProperties,
  buildHubSpotOwnerDirectory,
  classifyHubSpotCompanyAvailability,
  selectContactsToReassign,
} from '../hubspot-free-company-policy';
import { resetHubSpotOwnerDirectoryCache } from '../hubspot-free-company-pool.server';
import { claimHubSpotCompanyForOwner } from '../hubspot-free-company-claim.server';
import { resolveSellerHubSpotOwner } from '@/modules/prospect-batches/hubspot-free-pool-approval';

const NOW = new Date('2026-10-15T12:00:00Z');
const owners = buildHubSpotOwnerDirectory(
  [
    { id: 'pool', firstName: 'Sales', lastName: 'Colombia' },
    { id: 'seller', firstName: 'Ana', lastName: 'Vendedora' },
    { id: 'other', firstName: 'Otro', lastName: 'Vendedor' },
    { id: 'prev', firstName: 'Dueño', lastName: 'Anterior' },
  ],
  [{ id: 'gone', firstName: 'Ya', lastName: 'Noestá' }],
);

describe('propiedades al tomarla', () => {
  it('dueño y estado «New»; la Fecha Asignación la pone HubSpot', () => {
    assert.deepEqual(buildHubSpotClaimProperties('seller'), {
      hubspot_owner_id: 'seller',
      hs_lead_status: 'New',
    });
  });

  it('tomada ⇒ deja de verse libre (aunque antes estuviera Recycled)', () => {
    const before = classifyHubSpotCompanyAvailability(
      { hs_lead_status: 'Recycled', hubspot_owner_id: 'prev', lifecyclestage: 'lead', hs_num_open_deals: '0', hs_last_sales_activity_timestamp: null },
      owners,
      NOW,
    );
    assert.equal(before.free, true);
    const after = classifyHubSpotCompanyAvailability(
      { ...buildHubSpotClaimProperties('seller'), lifecyclestage: 'lead', hs_num_open_deals: '0', hs_last_sales_activity_timestamp: null },
      owners,
      NOW,
    );
    assert.deepEqual(after, { free: false, reason: 'active_owner' });
  });
});

describe('qué contactos pasan al vendedor', () => {
  it('sin dueño, bolsa, desactivado y dueño anterior sí; otro vendedor activo o desconocido no', () => {
    const plan = selectContactsToReassign(
      [
        { id: 'c1', ownerId: null },
        { id: 'c2', ownerId: '' },
        { id: 'c3', ownerId: 'pool' },
        { id: 'c4', ownerId: 'gone' },
        { id: 'c5', ownerId: 'prev' },
        { id: 'c6', ownerId: 'other' },
        { id: 'c7', ownerId: 'seller' },
        { id: 'c8', ownerId: 'nadie-sabe' },
      ],
      owners,
      'prev',
      'seller',
    );
    assert.deepEqual(plan.reassign, ['c1', 'c2', 'c3', 'c4', 'c5']);
    assert.deepEqual(plan.keptOtherActiveOwner, ['c6', 'c8']);
    assert.equal(plan.alreadyOwned, 1);
  });
});

type Call = { method: string; url: string; body: unknown };

type CompanyNow = Record<string, unknown>;

// AGENT1-AUDIT-WS4 — antes la ficha simulada sólo traía `hubspot_owner_id: 'prev'`
// (un vendedor ACTIVO) y la toma se la quitaba igual: era justo el defecto. Ahora
// la toma vuelve a aplicar la regla con las propiedades frescas, así que el caso
// feliz es una ficha LIBRE (reciclada) cuyo dueño anterior es 'prev'.
const FREE_RECYCLED: CompanyNow = {
  hubspot_owner_id: 'prev',
  hs_lead_status: 'Recycled',
  lifecyclestage: 'lead',
  hs_num_open_deals: '0',
  hs_last_sales_activity_timestamp: null,
};

function fakeHubSpot(
  opts: { patchStatus?: number; contactsUpdateStatus?: number; associationsStatus?: number; companyNow?: CompanyNow; ownersStatus?: number } = {},
) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.includes('/crm/v3/owners')) {
      if (opts.ownersStatus) return json({}, opts.ownersStatus);
      return json({
        results: url.includes('archived=true')
          ? [{ id: 'gone', firstName: 'Ya', lastName: 'Noestá' }]
          : [
              { id: 'pool', firstName: 'Sales', lastName: 'Colombia' },
              { id: 'seller', firstName: 'Ana', lastName: 'Vendedora' },
              { id: 'other', firstName: 'Otro', lastName: 'Vendedor' },
              { id: 'prev', firstName: 'Dueño', lastName: 'Anterior' },
            ],
      });
    }
    if (method === 'GET' && url.includes('/crm/v3/objects/companies/555?properties=hubspot_owner_id')) {
      return json({ properties: opts.companyNow ?? FREE_RECYCLED });
    }
    if (method === 'PATCH') return json({}, opts.patchStatus ?? 200);
    if (url.includes('/associations/contacts')) {
      return json({ results: [{ toObjectId: 1 }, { toObjectId: 2 }, { toObjectId: 3 }] }, opts.associationsStatus ?? 200);
    }
    if (url.endsWith('/contacts/batch/read')) {
      return json({
        results: [
          { id: '1', properties: { hubspot_owner_id: 'prev' } },
          { id: '2', properties: { hubspot_owner_id: 'other' } },
          { id: '3', properties: { hubspot_owner_id: null } },
        ],
      });
    }
    if (url.endsWith('/contacts/batch/update')) return json({}, opts.contactsUpdateStatus ?? 200);
    return json({}, 404);
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe('tomar la empresa en HubSpot', () => {
  it('escribe la empresa y reasigna sólo los contactos permitidos', async () => {
    resetHubSpotOwnerDirectoryCache();
    const hs = fakeHubSpot();
    const out = await claimHubSpotCompanyForOwner(
      { hubspotCompanyId: '555', newOwnerId: 'seller' },
      { fetchFn: hs.fetchFn, resolveToken: async () => 't' },
    );
    assert.equal(out.companyWritten, true);
    assert.equal(out.previousOwnerId, 'prev');
    const patch = hs.calls.find((c) => c.method === 'PATCH');
    assert.deepEqual(patch?.body, { properties: { hubspot_owner_id: 'seller', hs_lead_status: 'New' } });
    const update = hs.calls.find((c) => c.url.endsWith('/contacts/batch/update'));
    assert.deepEqual(update?.body, {
      inputs: [
        { id: '1', properties: { hubspot_owner_id: 'seller' } },
        { id: '3', properties: { hubspot_owner_id: 'seller' } },
      ],
    });
    assert.deepEqual(out.contacts, { associated: 3, reassigned: 2, keptOtherActiveOwner: 1, alreadyOwned: 0, failed: 0, error: null });
  });

  it('si la empresa no se pudo tomar, los contactos no se tocan', async () => {
    resetHubSpotOwnerDirectoryCache();
    const hs = fakeHubSpot({ patchStatus: 403 });
    const out = await claimHubSpotCompanyForOwner(
      { hubspotCompanyId: '555', newOwnerId: 'seller' },
      { fetchFn: hs.fetchFn, resolveToken: async () => 't' },
    );
    assert.equal(out.companyWritten, false);
    assert.equal(out.companyError, 'company_update_http_403');
    assert.equal(hs.calls.some((c) => c.url.includes('/contacts/')), false);
  });

  it('un fallo en contactos NO deshace la toma y queda registrado', async () => {
    resetHubSpotOwnerDirectoryCache();
    const hs = fakeHubSpot({ contactsUpdateStatus: 500 });
    const out = await claimHubSpotCompanyForOwner(
      { hubspotCompanyId: '555', newOwnerId: 'seller' },
      { fetchFn: hs.fetchFn, resolveToken: async () => 't' },
    );
    assert.equal(out.companyWritten, true);
    assert.equal(out.contacts.reassigned, 0);
    assert.equal(out.contacts.failed, 2);
    assert.equal(out.contacts.error, 'contacts_update_http_500');
  });

  it('otro vendedor la tomó entre medio ⇒ taken_now: ni PATCH ni contactos', async () => {
    resetHubSpotOwnerDirectoryCache();
    const hs = fakeHubSpot({
      companyNow: { ...FREE_RECYCLED, hubspot_owner_id: 'other', hs_lead_status: 'New' },
    });
    const out = await claimHubSpotCompanyForOwner(
      { hubspotCompanyId: '555', newOwnerId: 'seller' },
      { fetchFn: hs.fetchFn, resolveToken: async () => 't', now: NOW },
    );
    assert.equal(out.companyWritten, false);
    assert.equal(out.abortedReason, 'taken_now');
    assert.equal(out.takenReasonNow, 'active_owner');
    assert.equal(out.previousOwnerId, 'other');
    assert.equal(hs.calls.some((c) => c.method === 'PATCH'), false);
    assert.equal(hs.calls.some((c) => c.url.includes('/contacts/')), false);
  });

  it('abrieron un negocio entre medio ⇒ taken_now (open_deal)', async () => {
    resetHubSpotOwnerDirectoryCache();
    const hs = fakeHubSpot({ companyNow: { ...FREE_RECYCLED, hs_num_open_deals: '1' } });
    const out = await claimHubSpotCompanyForOwner(
      { hubspotCompanyId: '555', newOwnerId: 'seller' },
      { fetchFn: hs.fetchFn, resolveToken: async () => 't', now: NOW },
    );
    assert.equal(out.abortedReason, 'taken_now');
    assert.equal(out.takenReasonNow, 'open_deal');
    assert.equal(hs.calls.some((c) => c.method === 'PATCH'), false);
  });

  it('sin directorio de dueños no se puede comprobar ⇒ no se toca', async () => {
    resetHubSpotOwnerDirectoryCache();
    const hs = fakeHubSpot({ ownersStatus: 500 });
    const out = await claimHubSpotCompanyForOwner(
      { hubspotCompanyId: '555', newOwnerId: 'seller' },
      { fetchFn: hs.fetchFn, resolveToken: async () => 't', now: NOW },
    );
    assert.equal(out.abortedReason, 'availability_unknown');
    assert.equal(hs.calls.some((c) => c.method === 'PATCH'), false);
  });

  it('ya es del vendedor ⇒ no se reescribe', async () => {
    resetHubSpotOwnerDirectoryCache();
    const hs = fakeHubSpot({ companyNow: { ...FREE_RECYCLED, hubspot_owner_id: 'seller' } });
    const out = await claimHubSpotCompanyForOwner(
      { hubspotCompanyId: '555', newOwnerId: 'seller' },
      { fetchFn: hs.fetchFn, resolveToken: async () => 't', now: NOW },
    );
    assert.equal(out.abortedReason, 'already_owner');
    assert.equal(hs.calls.some((c) => c.method === 'PATCH'), false);
  });

  it('sin credencial ⇒ nada se escribe', async () => {
    const hs = fakeHubSpot();
    const out = await claimHubSpotCompanyForOwner(
      { hubspotCompanyId: '555', newOwnerId: 'seller' },
      { fetchFn: hs.fetchFn, resolveToken: async () => null },
    );
    assert.equal(out.companyError, 'token_unavailable');
    assert.equal(hs.calls.length, 0);
  });
});

describe('dueño de HubSpot del vendedor', () => {
  const ports = (mapped: string | null, byEmail: string | null, calls: string[] = []) => ({
    findMappedOwnerId: async (e: string) => {
      calls.push(`map:${e}`);
      return mapped;
    },
    findHubSpotOwnerIdByEmail: async (e: string) => {
      calls.push(`hs:${e}`);
      return byEmail;
    },
  });

  it('primero la tabla de mapeo; HubSpot sólo si no está', async () => {
    const calls: string[] = [];
    assert.deepEqual(await resolveSellerHubSpotOwner(' EGarcia@ubits.co ', ports('11', '22', calls)), { ownerId: '11', source: 'mapping' });
    assert.deepEqual(calls, ['map:egarcia@ubits.co']);
    assert.deepEqual(await resolveSellerHubSpotOwner('egarcia@ubits.co', ports(null, '80684306')), {
      ownerId: '80684306',
      source: 'hubspot_email',
    });
  });

  it('sin correo o sin dueño en ninguna parte ⇒ ninguno (la toma se salta)', async () => {
    assert.deepEqual(await resolveSellerHubSpotOwner(null, ports('1', '2')), { ownerId: null, source: 'none' });
    assert.deepEqual(await resolveSellerHubSpotOwner('x@ubits.co', ports(null, null)), { ownerId: null, source: 'none' });
  });

  it('una puerta que falla cuenta como «no encontrado» y sigue con la otra', async () => {
    const out = await resolveSellerHubSpotOwner('a@ubits.co', {
      findMappedOwnerId: async () => {
        throw new Error('db caída');
      },
      findHubSpotOwnerIdByEmail: async () => '9',
    });
    assert.deepEqual(out, { ownerId: '9', source: 'hubspot_email' });
  });
});
