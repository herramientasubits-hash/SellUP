// AGENT2A-HUBSPOT-FIRST-APPROVAL-SYNC
//
// Bug: al aprobar un candidato de «Primero HubSpot» el contacto quedaba en «Nunca sincronizado».
// La aprobación lo vincula (`linkApprovedHubSpotCandidate`) ANTES del autosync, y el portero del
// autosync cortaba todo contacto vinculado como `skipped_already_synced`: el motor nunca corría,
// su rama D (completar vacíos + marcar `synced`) nunca se alcanzaba y lo revelado no viajaba.
//
// Ahora el portero deja pasar un contacto vinculado cuyo estado LEGIBLE dice que el alta nunca
// ocurrió. Todo lo demás (synced, stale con pendiente, failed, estado ilegible) sigue sin red.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveContactAutoSyncGate,
  runContactHubSpotAutoSync,
  type ContactAutoSyncDeps,
} from '../contact-hubspot-autosync-core';
import {
  runSyncContactToHubSpot,
  type ContactForSync,
  type HubSpotContactFillProperties,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';

const NOW = '2026-10-29T20:00:00.000Z';

const syncBlock = (status: string, extra: Record<string, unknown> = {}) => ({
  hubspot_sync: {
    status,
    method: null,
    attempted_at: null,
    last_error: null,
    hubspot_contact_id: null,
    stale_since: null,
    stale_reason: null,
    stale_source: null,
    ...extra,
  },
});

function approvedHubSpotFirstContact(overrides: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: 'contact-1',
    account_id: 'account-1',
    full_name: 'Ana Ficticia',
    first_name: 'Ana',
    last_name: 'Ficticia',
    email: 'ana@empresa.test',
    phone: '+57 300 555 0000',
    mobile_phone: null,
    job_title: 'Gerente de RRHH',
    linkedin_url: 'https://www.linkedin.com/in/ana-ficticia',
    // Vinculado por la aprobación, justo antes del autosync.
    hubspot_contact_id: 'hs-123',
    // El estado INICIAL que escribe la aprobación.
    metadata: syncBlock('never_attempted'),
    ...overrides,
  };
}

describe('portero: vinculado al aprobar y nunca sincronizado', () => {
  for (const status of ['never_attempted', 'blocked_no_email', 'blocked_no_hubspot_company']) {
    it(`vinculado + ${status} ⇒ pasa al motor`, () => {
      assert.deepEqual(
        resolveContactAutoSyncGate({ id: 'c', hubspot_contact_id: 'hs-1', metadata: syncBlock(status) }),
        { proceed: true },
      );
    });
  }

  it('vinculado + synced ⇒ sigue sin red', () => {
    assert.deepEqual(
      resolveContactAutoSyncGate({ id: 'c', hubspot_contact_id: 'hs-1', metadata: syncBlock('synced') }),
      { proceed: false, outcome: 'skipped_already_synced' },
    );
  });

  it('vinculado + failed ⇒ sigue sin red', () => {
    assert.deepEqual(
      resolveContactAutoSyncGate({ id: 'c', hubspot_contact_id: 'hs-1', metadata: syncBlock('failed') }),
      { proceed: false, outcome: 'skipped_already_synced' },
    );
  });

  it('vinculado + estado ilegible o ausente ⇒ sigue sin red', () => {
    assert.deepEqual(
      resolveContactAutoSyncGate({ id: 'c', hubspot_contact_id: 'hs-1', metadata: {} }),
      { proceed: false, outcome: 'skipped_already_synced' },
    );
    assert.deepEqual(
      resolveContactAutoSyncGate({ id: 'c', hubspot_contact_id: 'hs-1', metadata: syncBlock('lo-que-sea') }),
      { proceed: false, outcome: 'skipped_already_synced' },
    );
  });
});

describe('aprobación de un candidato de HubSpot: queda sincronizado y completa vacíos', () => {
  function wire(contact: ContactForSync, remote: Record<string, string | null>) {
    const spy = {
      fills: [] as Array<{ id: string; props: HubSpotContactFillProperties }>,
      persisted: [] as Array<Record<string, unknown>>,
    };
    const syncDeps: SyncContactDeps = {
      actorId: 'user-1',
      nowIso: NOW,
      method: 'auto',
      loadContact: async () => contact,
      loadAccount: async () => ({ id: 'account-1', name: 'Empresa', hubspot_company_id: 'hs-co-1' }),
      checkConnection: async () => ({ connected: true, canWriteContacts: true }),
      findHubSpotContactByEmail: async () => {
        throw new Error('NO_DEBE_BUSCAR_POR_EMAIL');
      },
      createHubSpotContact: async () => {
        throw new Error('NO_DEBE_CREAR');
      },
      updateHubSpotContact: async () => {
        throw new Error('NO_DEBE_HACER_PATCH_DEL_TELEFONO');
      },
      associateContactWithCompany: async () => ({ ok: true }),
      findHubSpotContactById: async (id) => ({ id, properties: remote, email: 'ana@empresa.test' }),
      fillEmptyHubSpotContactProperties: async (id, props) => {
        spy.fills.push({ id, props });
        return { ok: true, written: Object.keys(props) as never };
      },
      fillEmptyHubSpotContactEmail: async () => ({ ok: true }),
      persistSync: async (_id, patch) => {
        spy.persisted.push(patch.metadata);
        return {};
      },
    };
    const autoDeps: ContactAutoSyncDeps = {
      enabled: true,
      nowIso: NOW,
      loadSubject: async () => ({ id: contact.id, hubspot_contact_id: contact.hubspot_contact_id, metadata: contact.metadata }),
      runSync: (id) => runSyncContactToHubSpot(id, syncDeps),
      persistAnnex: async () => ({}),
    };
    return { spy, autoDeps };
  }

  it('antes «Nunca sincronizado»; ahora `synced` y el teléfono revelado llega a HubSpot', async () => {
    const { spy, autoDeps } = wire(approvedHubSpotFirstContact(), {
      firstname: 'Ana',
      lastname: 'Ficticia',
      jobtitle: 'Gerente',
      phone: null,
      mobilephone: null,
      hs_linkedin_url: 'https://www.linkedin.com/in/ana-ficticia',
    });
    const report = await runContactHubSpotAutoSync('contact-1', autoDeps);

    assert.equal(report.outcome, 'attempted_linked_existing');
    assert.equal(report.attempted, true);
    assert.equal(report.hubspotContactId, 'hs-123');
    assert.deepEqual(spy.fills, [{ id: 'hs-123', props: { phone: '+57 300 555 0000' } }]);
    const block = spy.persisted.at(-1)?.hubspot_sync as Record<string, unknown>;
    assert.equal(block.status, 'synced');
  });

  it('sin correo (llegó sólo con LinkedIn) también se sincroniza', async () => {
    const { spy, autoDeps } = wire(
      approvedHubSpotFirstContact({ email: null, metadata: syncBlock('blocked_no_email') }),
      { phone: null, mobilephone: null, hs_linkedin_url: null },
    );
    const report = await runContactHubSpotAutoSync('contact-1', autoDeps);
    assert.equal(report.outcome, 'attempted_linked_existing');
    assert.equal((spy.persisted.at(-1)?.hubspot_sync as Record<string, unknown>).status, 'synced');
  });

  it('una segunda aprobación ya no toca la red', async () => {
    const { spy, autoDeps } = wire(
      approvedHubSpotFirstContact({ metadata: syncBlock('synced', { hubspot_contact_id: 'hs-123' }) }),
      { phone: null },
    );
    const report = await runContactHubSpotAutoSync('contact-1', autoDeps);
    assert.equal(report.outcome, 'skipped_already_synced');
    assert.deepEqual(spy.fills, []);
    assert.deepEqual(spy.persisted, []);
  });
});
