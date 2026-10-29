// AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION
//
// Los candidatos de «Primero HubSpot» se VINCULAN al aprobar (antes del sync), así que el sync
// no pasaba por `linked_existing` y lo que SellUp reveló (teléfono, LinkedIn) nunca llegaba al
// CRM. Ahora la reparación del primer sync (rama D) completa SÓLO las propiedades VACÍAS del
// contacto, leído por id. Nunca sobrescribe, nunca crea, nunca usa el PATCH del teléfono.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runSyncContactToHubSpot,
  type ContactForSync,
  type HubSpotContactFillProperties,
  type HubSpotExistingContactMatch,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';

function linkedContact(overrides: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: 'contact-1',
    account_id: 'account-1',
    full_name: 'Ana Ficticia',
    first_name: 'Ana',
    last_name: 'Ficticia',
    email: 'ana@empresa.test',
    phone: '+57 1 555 0000',
    mobile_phone: null,
    job_title: 'Gerente de RRHH',
    linkedin_url: 'https://www.linkedin.com/in/ana-ficticia',
    hubspot_contact_id: 'hs-123',
    // Recién aprobado y vinculado: todavía no hay estado `synced`.
    metadata: {},
    ...overrides,
  };
}

interface Spy {
  emailFills: Array<{ id: string; email: string }>;
  fills: Array<{ id: string; props: HubSpotContactFillProperties }>;
  persisted: Array<{ hubspot_contact_id: string | null; metadata: Record<string, unknown> }>;
  reads: string[];
}

function deps(
  spy: Spy,
  existing: HubSpotExistingContactMatch | null | Error,
  overrides: Partial<SyncContactDeps> = {},
  contact: ContactForSync = linkedContact(),
): SyncContactDeps {
  return {
    actorId: 'user-1',
    nowIso: '2026-10-29T12:00:00.000Z',
    method: 'auto',
    loadContact: async () => contact,
    loadAccount: async () => ({ id: 'account-1', name: 'Empresa', hubspot_company_id: 'hs-co-1' }),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => {
      throw new Error('NO_DEBE_BUSCAR_POR_EMAIL_SI_YA_ESTA_VINCULADO');
    },
    createHubSpotContact: async () => {
      throw new Error('NO_DEBE_CREAR');
    },
    updateHubSpotContact: async () => {
      throw new Error('NO_DEBE_HACER_PATCH_DEL_TELEFONO');
    },
    associateContactWithCompany: async () => ({ ok: true }),
    fillEmptyHubSpotContactProperties: async (id, props) => {
      spy.fills.push({ id, props });
      return { ok: true, written: Object.keys(props) as never };
    },
    fillEmptyHubSpotContactEmail: async (id, email) => {
      spy.emailFills.push({ id, email });
      return { ok: true };
    },
    findHubSpotContactById: async (id) => {
      spy.reads.push(id);
      if (existing instanceof Error) throw existing;
      return existing;
    },
    persistSync: async (_id, patch) => {
      spy.persisted.push(patch);
      return {};
    },
    ...overrides,
  };
}

const fresh = (): Spy => ({ emailFills: [], fills: [], persisted: [], reads: [] });
const fillBlock = (spy: Spy) =>
  (spy.persisted[0]?.metadata.hubspot_sync as Record<string, unknown> | undefined)?.fill_empty as
    | Record<string, unknown>
    | undefined;

test('vinculado al aprobar: completa teléfono y LinkedIn vacíos en HubSpot y queda synced', async () => {
  const spy = fresh();
  const result = await runSyncContactToHubSpot(
    'contact-1',
    deps(spy, {
      id: 'hs-123',
      properties: { firstname: 'Ana', lastname: 'Ficticia', jobtitle: 'Gerente', phone: null, mobilephone: null, hs_linkedin_url: '' },
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(spy.reads, ['hs-123']);
  assert.deepEqual(spy.fills, [
    { id: 'hs-123', props: { phone: '+57 1 555 0000', hs_linkedin_url: 'https://www.linkedin.com/in/ana-ficticia' } },
  ]);
  const sync = spy.persisted[0].metadata.hubspot_sync as Record<string, unknown>;
  assert.equal(sync.status, 'synced');
  assert.equal(spy.persisted[0].hubspot_contact_id, null, 'el vínculo no se reescribe');
  assert.equal(fillBlock(spy)?.outcome, 'filled');
});

test('nunca sobrescribe lo que HubSpot ya tiene', async () => {
  const spy = fresh();
  await runSyncContactToHubSpot(
    'contact-1',
    deps(spy, {
      id: 'hs-123',
      properties: { firstname: 'A', lastname: 'F', jobtitle: 'CEO', phone: '+1 999', mobilephone: null, hs_linkedin_url: 'https://www.linkedin.com/in/otra' },
    }),
  );
  assert.equal(spy.fills.length, 0);
  assert.equal(fillBlock(spy)?.outcome, 'nothing_to_fill');
});

test('si no se puede leer el contacto, no se escribe nada y la reparación sigue', async () => {
  const spy = fresh();
  const result = await runSyncContactToHubSpot('contact-1', deps(spy, new Error('HTTP 500')));
  assert.equal(result.ok, true);
  assert.equal(spy.fills.length, 0);
  assert.equal(fillBlock(spy)?.outcome, 'existing_unreadable');
  assert.equal((spy.persisted[0].metadata.hubspot_sync as Record<string, unknown>).status, 'synced');
});

test('sin permiso de escritura: ni lee ni escribe', async () => {
  const spy = fresh();
  await runSyncContactToHubSpot(
    'contact-1',
    deps(spy, { id: 'hs-123', properties: {} }, {
      checkConnection: async () => ({ connected: true, canWriteContacts: false }),
    }),
  );
  assert.equal(spy.reads.length, 0);
  assert.equal(spy.fills.length, 0);
});

test('ya synced: cero red (la rama C no cambia)', async () => {
  const spy = fresh();
  await runSyncContactToHubSpot(
    'contact-1',
    deps(spy, { id: 'hs-123', properties: {} }, {}, linkedContact({
      metadata: { hubspot_sync: { status: 'synced', hubspot_contact_id: 'hs-123' } },
    })),
  );
  assert.equal(spy.reads.length, 0);
  assert.equal(spy.fills.length, 0);
  assert.equal(spy.persisted.length, 0);
});

test('sin la dependencia de lectura la rama D se comporta como antes (sin red)', async () => {
  const spy = fresh();
  await runSyncContactToHubSpot(
    'contact-1',
    deps(spy, { id: 'hs-123', properties: {} }, { findHubSpotContactById: undefined }),
  );
  assert.equal(spy.fills.length, 0);
  assert.equal(fillBlock(spy), undefined);
});

const emailBlock = (spy: Spy) =>
  (spy.persisted[0]?.metadata.hubspot_sync as Record<string, unknown> | undefined)?.email_fill as
    | Record<string, unknown>
    | undefined;

test('correo revelado y vacío en HubSpot: se completa APARTE del resto', async () => {
  const spy = fresh();
  await runSyncContactToHubSpot(
    'contact-1',
    deps(spy, { id: 'hs-123', properties: { phone: null }, email: '' }),
  );
  assert.deepEqual(spy.emailFills, [{ id: 'hs-123', email: 'ana@empresa.test' }]);
  assert.equal('email' in spy.fills[0].props, false, 'el correo nunca viaja con el resto');
  assert.equal(emailBlock(spy)?.outcome, 'filled');
});

test('HubSpot ya tiene correo: no se toca', async () => {
  const spy = fresh();
  await runSyncContactToHubSpot('contact-1', deps(spy, { id: 'hs-123', properties: {}, email: 'otro@empresa.test' }));
  assert.equal(spy.emailFills.length, 0);
  assert.equal(emailBlock(spy), undefined);
});

test('correo no leído (undefined): no se escribe', async () => {
  const spy = fresh();
  await runSyncContactToHubSpot('contact-1', deps(spy, { id: 'hs-123', properties: {} }));
  assert.equal(spy.emailFills.length, 0);
});

test('409 de HubSpot (correo de otro contacto) queda anotado y no frena el resto', async () => {
  const spy = fresh();
  const result = await runSyncContactToHubSpot(
    'contact-1',
    deps(spy, { id: 'hs-123', properties: { phone: null }, email: null }, {
      fillEmptyHubSpotContactEmail: async () => ({ error: 'HUBSPOT_EMAIL_HTTP_409' }),
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(spy.fills.length, 1, 'el teléfono sí viajó');
  assert.deepEqual(emailBlock(spy), { outcome: 'failed', error: 'HUBSPOT_EMAIL_HTTP_409' });
});

test('vinculado SIN correo (vino sólo con LinkedIn): el primer sync completa vacíos en vez de bloquearse', async () => {
  const spy = fresh();
  const result = await runSyncContactToHubSpot(
    'contact-1',
    deps(
      spy,
      {
        id: 'hs-123',
        properties: { firstname: 'Ana', lastname: 'Ficticia', jobtitle: 'Gerente', phone: null, mobilephone: null, hs_linkedin_url: null },
        email: null,
      },
      {},
      linkedContact({ email: null }),
    ),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(spy.fills[0].props, {
    phone: '+57 1 555 0000',
    hs_linkedin_url: 'https://www.linkedin.com/in/ana-ficticia',
  });
  assert.equal(spy.emailFills.length, 0, 'sin correo local no hay correo que enviar');
  assert.equal((spy.persisted[0].metadata.hubspot_sync as Record<string, unknown>).status, 'synced');
});

test('NO vinculado y sin correo: sigue bloqueado como siempre', async () => {
  const spy = fresh();
  const result = await runSyncContactToHubSpot(
    'contact-1',
    deps(spy, null, {}, linkedContact({ email: null, hubspot_contact_id: null })),
  );
  assert.equal(result.ok === false && result.errorCode, 'MISSING_EMAIL');
  assert.equal(spy.reads.length + spy.fills.length, 0);
});
