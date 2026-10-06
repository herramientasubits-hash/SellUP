// AGENT2A-HUBSPOT-FILL-EMPTY-ON-APPROVAL
//
// Cuando el contacto aprobado YA existía en HubSpot (`linked_existing`), SellUp completa SÓLO
// las propiedades que en HubSpot están vacías y que SellUp sí tiene (teléfonos, cargo, nombre,
// LinkedIn). Nunca sobrescribe un dato del CRM y nunca envía cadenas vacías.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SYNC_MESSAGES,
  buildHubSpotFillEmptyProperties,
  runSyncContactToHubSpot,
  type ContactForSync,
  type HubSpotContactFillProperties,
  type HubSpotExistingContactMatch,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';

function makeContact(overrides: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: 'contact-1',
    account_id: 'account-1',
    full_name: 'Ana María Pérez',
    first_name: 'Ana María',
    last_name: 'Pérez',
    email: 'ana@empresa.com',
    phone: '+57 1 555 0000',
    mobile_phone: '+57 300 555 0000',
    job_title: 'Gerente de RRHH',
    linkedin_url: 'https://linkedin.com/in/anaperez',
    hubspot_contact_id: null,
    metadata: {},
    ...overrides,
  };
}

interface Spy {
  fills: Array<{ id: string; props: HubSpotContactFillProperties }>;
  persisted: Array<{ hubspot_contact_id: string | null; metadata: Record<string, unknown> }>;
  created: number;
}

function makeDeps(
  existing: HubSpotExistingContactMatch | null,
  spy: Spy,
  overrides: Partial<SyncContactDeps> = {},
  contact: ContactForSync = makeContact(),
): SyncContactDeps {
  return {
    actorId: 'user-1',
    nowIso: '2026-10-06T12:00:00.000Z',
    method: 'auto',
    loadContact: async () => contact,
    loadAccount: async () => ({ id: 'account-1', name: 'Empresa', hubspot_company_id: 'hs-co-1' }),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => existing,
    createHubSpotContact: async () => {
      spy.created += 1;
      return { id: 'hs-new' };
    },
    updateHubSpotContact: async () => {
      throw new Error('PATCH_DE_TELEFONO_PROHIBIDO_EN_ALTA');
    },
    associateContactWithCompany: async () => ({ ok: true }),
    fillEmptyHubSpotContactProperties: async (id, props) => {
      spy.fills.push({ id, props });
      return { ok: true, written: Object.keys(props) as never };
    },
    persistSync: async (_id, patch) => {
      spy.persisted.push(patch);
      return {};
    },
    ...overrides,
  };
}

const freshSpy = (): Spy => ({ fills: [], persisted: [], created: 0 });

function fillBlock(spy: Spy): Record<string, unknown> | undefined {
  const sync = spy.persisted[0]?.metadata.hubspot_sync as Record<string, unknown> | undefined;
  return sync?.fill_empty as Record<string, unknown> | undefined;
}

// ── Regla pura ──────────────────────────────────────────────────

test('regla: sólo viajan las propiedades VACÍAS en HubSpot que SellUp tiene', () => {
  const fill = buildHubSpotFillEmptyProperties(makeContact(), {
    firstname: 'Ana',
    lastname: 'Pérez',
    jobtitle: '',
    phone: null,
    mobilephone: '   ',
    hs_linkedin_url: null,
  });
  assert.deepEqual(fill, {
    jobtitle: 'Gerente de RRHH',
    phone: '+57 1 555 0000',
    mobilephone: '+57 300 555 0000',
    hs_linkedin_url: 'https://linkedin.com/in/anaperez',
  });
});

test('regla: nunca sobrescribe un valor que HubSpot ya tiene, aunque sea distinto', () => {
  const fill = buildHubSpotFillEmptyProperties(makeContact(), {
    firstname: 'A.',
    lastname: 'P.',
    jobtitle: 'CEO',
    phone: '+1 999',
    mobilephone: '+1 888',
    hs_linkedin_url: 'https://linkedin.com/in/otra',
  });
  assert.deepEqual(fill, {});
});

test('regla: lo que SellUp no tiene no viaja (nunca cadenas vacías)', () => {
  const fill = buildHubSpotFillEmptyProperties(
    makeContact({ phone: null, mobile_phone: '  ', linkedin_url: null, job_title: null }),
    {},
  );
  assert.deepEqual(fill, { firstname: 'Ana María', lastname: 'Pérez' });
  for (const v of Object.values(fill ?? {})) assert.ok(v && v.trim().length > 0);
});

test('regla: sin propiedades leídas devuelve null (no se completa a ciegas)', () => {
  assert.equal(buildHubSpotFillEmptyProperties(makeContact(), undefined), null);
  assert.equal(buildHubSpotFillEmptyProperties(makeContact(), null), null);
});

// ── Motor ───────────────────────────────────────────────────────

test('linked_existing: completa el teléfono vacío en HubSpot y lo anota', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps(
      {
        id: 'hs-42',
        properties: {
          firstname: 'Ana María',
          lastname: 'Pérez',
          jobtitle: 'Gerente de RRHH',
          phone: null,
          mobilephone: null,
          hs_linkedin_url: null,
        },
      },
      spy,
    ),
  );
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.status, 'linked_existing');
  assert.equal(res.ok === true && res.message, SYNC_MESSAGES.linkedExistingFilled);
  assert.equal(spy.created, 0);
  assert.deepEqual(spy.fills, [
    {
      id: 'hs-42',
      props: {
        phone: '+57 1 555 0000',
        mobilephone: '+57 300 555 0000',
        hs_linkedin_url: 'https://linkedin.com/in/anaperez',
      },
    },
  ]);
  assert.equal(spy.persisted[0].hubspot_contact_id, 'hs-42');
  assert.deepEqual(fillBlock(spy), {
    outcome: 'filled',
    properties: ['phone', 'mobilephone', 'hs_linkedin_url'],
    error: null,
  });
});

test('linked_existing sin nada vacío: cero escrituras de completado', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps(
      {
        id: 'hs-42',
        properties: {
          firstname: 'x',
          lastname: 'x',
          jobtitle: 'x',
          phone: 'x',
          mobilephone: 'x',
          hs_linkedin_url: 'x',
        },
      },
      spy,
    ),
  );
  assert.equal(res.ok === true && res.message, SYNC_MESSAGES.linkedExisting);
  assert.equal(spy.fills.length, 0);
  assert.equal(fillBlock(spy)?.outcome, 'nothing_to_fill');
});

test('linked_existing sin propiedades leídas: no completa (fail closed)', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot('contact-1', makeDeps({ id: 'hs-42' }, spy));
  assert.equal(res.ok === true && res.status, 'linked_existing');
  assert.equal(spy.fills.length, 0);
  assert.equal(fillBlock(spy)?.outcome, 'existing_unreadable');
});

test('fallo del completado: el vínculo sigue siendo un éxito y el fallo queda anotado', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ id: 'hs-42', properties: {} }, spy, {
      fillEmptyHubSpotContactProperties: async () => ({ error: 'HUBSPOT_FILL_HTTP_500' }),
    }),
  );
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.message, SYNC_MESSAGES.linkedExisting);
  assert.equal(spy.persisted[0].hubspot_contact_id, 'hs-42');
  const sync = spy.persisted[0].metadata.hubspot_sync as Record<string, unknown>;
  assert.equal(sync.status, 'synced');
  assert.deepEqual(fillBlock(spy), {
    outcome: 'failed',
    properties: [],
    error: 'HUBSPOT_FILL_HTTP_500',
  });
});

test('excepción del completado: tampoco rompe el vínculo', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ id: 'hs-42', properties: {} }, spy, {
      fillEmptyHubSpotContactProperties: async () => {
        throw new Error('boom');
      },
    }),
  );
  assert.equal(res.ok, true);
  assert.equal(fillBlock(spy)?.outcome, 'failed');
});

test('created: el completado no participa (el alta ya envía todo)', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot('contact-1', makeDeps(null, spy));
  assert.equal(res.ok === true && res.status, 'created');
  assert.equal(spy.fills.length, 0);
  assert.equal(fillBlock(spy), undefined);
});

test('sin escritor cableado: comportamiento anterior, sin anotación', async () => {
  const spy = freshSpy();
  const deps = makeDeps({ id: 'hs-42', properties: {} }, spy);
  delete deps.fillEmptyHubSpotContactProperties;
  const res = await runSyncContactToHubSpot('contact-1', deps);
  assert.equal(res.ok === true && res.status, 'linked_existing');
  assert.equal(fillBlock(spy), undefined);
});

test('contacto ya vinculado: el portero no completa nada (cero red)', async () => {
  const spy = freshSpy();
  const linked = makeContact({
    hubspot_contact_id: 'hs-42',
    metadata: { hubspot_sync: { status: 'synced', hubspot_contact_id: 'hs-42' } },
  });
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ id: 'hs-42', properties: {} }, spy, {}, linked),
  );
  assert.equal(res.ok === true && res.status, 'already_synced');
  assert.equal(spy.fills.length, 0);
});

// ── Cableado real ───────────────────────────────────────────────

test('el runner real cablea el escritor de completado', () => {
  const src = readFileSync(resolve(__dirname, '../contact-hubspot-sync-runner.ts'), 'utf8');
  assert.match(src, /fillEmptyHubSpotContactProperties,/);
});

test('la búsqueda por email pide las propiedades a completar (incluida LinkedIn)', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../server/integrations/hubspot-contact-sync.ts'),
    'utf8',
  );
  assert.match(src, /properties: \['email', \.\.\.HUBSPOT_FILL_EMPTY_PROPERTY_NAMES\]/);
});
