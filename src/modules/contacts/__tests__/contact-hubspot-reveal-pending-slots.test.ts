/**
 * AGENT2A-REVEAL-PHONE-SLOTS — la segunda fase de un pendiente que dejó un REVEAL.
 *
 * Un pendiente `stale_source: 'reveal'` NO hace el PATCH de la edición manual (que pisa `phone` y
 * borra `mobilephone` vacío). Sólo completa campos vacíos con `planRevealedPhonesForHubSpot` y
 * cierra el pendiente. Las demás procedencias siguen exactamente igual.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runSyncContactToHubSpot,
  SYNC_MESSAGES,
  type ContactForSync,
  type HubSpotContactFillProperties,
  type HubSpotContactUpdateInput,
  type HubSpotExistingContactMatch,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';
import {
  readHubSpotSyncState,
  writeHubSpotSyncState,
  type HubSpotSyncState,
} from '../contact-hubspot-sync-state';

const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('NETWORK_FORBIDDEN_IN_TEST');
  }) as typeof globalThis.fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

const NOW = '2026-11-04T15:00:00.000Z';
const HS_ID = 'hs-contact-7';
const REVEALED = '+57 300 111 2222';

function state(overrides: Partial<HubSpotSyncState> = {}): HubSpotSyncState {
  return {
    status: 'stale',
    method: 'auto',
    attempted_at: '2026-11-01T10:00:00.000Z',
    last_error: null,
    hubspot_contact_id: HS_ID,
    stale_since: '2026-11-04T14:59:00.000Z',
    stale_reason: 'phone_changed',
    stale_source: 'reveal',
    ...overrides,
  };
}

function makeContact(overrides: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: 'contact-1',
    account_id: 'account-1',
    full_name: 'Ana Pérez',
    first_name: 'Ana',
    last_name: 'Pérez',
    email: 'ana@empresa.com',
    phone: REVEALED,
    mobile_phone: null,
    job_title: null,
    linkedin_url: null,
    hubspot_contact_id: HS_ID,
    metadata: writeHubSpotSyncState({}, state(), { synced_at: '2026-11-01T10:00:00.000Z', mode: 'created' }),
    ...overrides,
  };
}

function remote(properties: HubSpotExistingContactMatch['properties']): HubSpotExistingContactMatch {
  return { id: HS_ID, properties, email: 'ana@empresa.com' };
}

interface Spy {
  patches: HubSpotContactUpdateInput[];
  fills: HubSpotContactFillProperties[];
  writes: Record<string, unknown>[];
}

function makeDeps(
  opts: {
    contact?: ContactForSync;
    existing?: HubSpotExistingContactMatch | null;
    revealed?: { phone: string; type?: string | null }[];
    fillError?: boolean;
  } = {},
): { deps: SyncContactDeps; spy: Spy } {
  const spy: Spy = { patches: [], fills: [], writes: [] };
  const deps: SyncContactDeps = {
    actorId: 'user-1',
    nowIso: NOW,
    method: 'auto',
    loadContact: async () => opts.contact ?? makeContact(),
    loadAccount: async () => ({ id: 'account-1', name: 'Empresa', hubspot_company_id: 'hs-co-1' }),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => null,
    createHubSpotContact: async () => ({ error: 'no debería crear' }),
    updateHubSpotContact: async (_id, input) => {
      spy.patches.push(input);
      return { ok: true };
    },
    associateContactWithCompany: async () => ({ ok: true }),
    findHubSpotContactById: async () =>
      opts.existing === undefined ? remote({ phone: null, mobilephone: null }) : opts.existing,
    fillEmptyHubSpotContactProperties: async (_id, properties) => {
      spy.fills.push(properties);
      if (opts.fillError) return { error: 'HTTP 400' };
      return { ok: true, written: Object.keys(properties) as never };
    },
    loadRevealedPhones: opts.revealed ? async () => opts.revealed! : undefined,
    persistSync: async (_id, patch) => {
      spy.writes.push(patch.metadata);
      return {};
    },
  };
  return { deps, spy };
}

describe("rama B' — pendiente de un reveal: sólo campos vacíos", () => {
  it('HubSpot sin números ⇒ el revelado va a `phone` y el pendiente se cierra', async () => {
    const { deps, spy } = makeDeps();
    const result = await runSyncContactToHubSpot('contact-1', deps);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.status, 'updated');
    assert.deepEqual(spy.patches, [], 'nunca el PATCH que pisa/borra');
    assert.deepEqual(spy.fills, [{ phone: REVEALED }]);
    const after = readHubSpotSyncState(spy.writes[0]);
    assert.equal(after?.status, 'synced');
    assert.equal(after?.stale_source, null);
  });

  it('`phone` con otro número ⇒ el revelado va a `mobilephone`, `phone` intacto', async () => {
    const { deps, spy } = makeDeps({ existing: remote({ phone: '+57 601 555 0000', mobilephone: null }) });
    await runSyncContactToHubSpot('contact-1', deps);
    assert.deepEqual(spy.fills, [{ mobilephone: REVEALED }]);
  });

  it('dos números del contacto y HubSpot vacío ⇒ uno a cada campo', async () => {
    const { deps, spy } = makeDeps({
      revealed: [{ phone: REVEALED, type: 'direct_dial' }, { phone: '+57 315 444 5555', type: 'other' }],
    });
    await runSyncContactToHubSpot('contact-1', deps);
    assert.deepEqual(spy.fills, [{ phone: REVEALED, mobilephone: '+57 315 444 5555' }]);
  });

  it('HubSpot ya tenía el número ⇒ cero escrituras a HubSpot, pendiente cerrado', async () => {
    const { deps, spy } = makeDeps({ existing: remote({ phone: '3001112222', mobilephone: null }) });
    const result = await runSyncContactToHubSpot('contact-1', deps);
    assert.deepEqual(spy.fills, []);
    assert.equal(result.ok && result.message, SYNC_MESSAGES.revealPhonesAlreadyPresent);
    assert.equal(readHubSpotSyncState(spy.writes[0])?.status, 'synced');
  });

  it('no se puede leer HubSpot ⇒ no se escribe nada y el pendiente sobrevive', async () => {
    const { deps, spy } = makeDeps({ existing: null });
    const result = await runSyncContactToHubSpot('contact-1', deps);
    assert.equal(result.ok, false);
    assert.deepEqual(spy.fills, []);
    const after = readHubSpotSyncState(spy.writes[0]);
    assert.equal(after?.status, 'failed');
    assert.equal(after?.stale_source, 'reveal');
  });

  it('HubSpot rechaza el llenado ⇒ `failed` y el pendiente sobrevive', async () => {
    const { deps, spy } = makeDeps({ fillError: true });
    const result = await runSyncContactToHubSpot('contact-1', deps);
    assert.equal(result.ok, false);
    assert.equal(readHubSpotSyncState(spy.writes[0])?.stale_source, 'reveal');
  });

  it('otra procedencia (`user_edit`) sigue con el PATCH de siempre', async () => {
    const { deps, spy } = makeDeps({
      contact: makeContact({
        metadata: writeHubSpotSyncState({}, state({ stale_source: 'user_edit' }), {
          synced_at: '2026-11-01T10:00:00.000Z',
          mode: 'created',
        }),
      }),
    });
    await runSyncContactToHubSpot('contact-1', deps);
    assert.deepEqual(spy.fills, []);
    assert.deepEqual(spy.patches, [{ phone: REVEALED, mobilePhone: null }]);
  });
});
