/**
 * AGENT2-CONTACT-HUBSPOT-SYNC-STATE-CUT1 — el estado durable escrito por la sincronización
 * MANUAL, y el módulo que lo define.
 *
 * Lo que se demuestra: cada desenlace del clic manual deja escrito un estado que se corresponde
 * con lo que de verdad pasó —incluidos los que antes de este corte no escribían nada— y ningún
 * `last_error` guarda PII. Sin red, sin DB, sin auth: todo inyectado, y `fetch` envenenado para
 * que una salida a la red rompa la prueba.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runSyncContactToHubSpot,
  buildSyncMetadata,
  buildFailedSyncMetadata,
  type ContactForSync,
  type AccountForSync,
  type ContactHubSpotSyncPatch,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';
import {
  HUBSPOT_SYNC_ERROR_CODES,
  HUBSPOT_SYNC_STATUS_LABELS,
  buildInitialHubSpotSyncState,
  readHubSpotSyncState,
  resolveInitialHubSpotSyncStatus,
  writeHubSpotSyncState,
} from '../contact-hubspot-sync-state';

// ── Prueba 11 — ninguna red real ────────────────────────────────

const originalFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async () => {
    throw new Error('NETWORK_FORBIDDEN_IN_TEST');
  }) as typeof globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

// ── Fixtures ────────────────────────────────────────────────────

const NOW = '2026-08-25T15:00:00.000Z';

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
    metadata: {
      source: 'contact_enrichment_candidate',
      hubspot_sync: buildInitialHubSpotSyncState({
        email: 'ana@empresa.com',
        hubspotCompanyId: 'hs-company-99',
      }),
    },
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountForSync> = {}): AccountForSync {
  return { id: 'account-1', name: 'Empresa S.A.', hubspot_company_id: 'hs-company-99', ...overrides };
}

function makeDeps(overrides: Partial<SyncContactDeps> = {}): {
  deps: SyncContactDeps;
  writes: { id: string; patch: ContactHubSpotSyncPatch }[];
} {
  const writes: { id: string; patch: ContactHubSpotSyncPatch }[] = [];
  const deps: SyncContactDeps = {
    actorId: 'user-1',
    nowIso: NOW,
    // CUT-3B — este camino sigue siendo el MANUAL. Se declara, no se hereda.
    method: 'manual',
    loadContact: async () => makeContact(),
    loadAccount: async () => makeAccount(),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => null,
    createHubSpotContact: async () => ({ id: 'hs-contact-1' }),
    // CUT-2 — por defecto ENVENENADO: ningún camino del CUT-1 puede hacer un PATCH. Un test
    // que necesite actualizar lo sobreescribe explícitamente.
    updateHubSpotContact: async () => {
      throw new Error('PATCH_FORBIDDEN_IN_CUT1_FLOW');
    },
    associateContactWithCompany: async () => ({ ok: true }),
    persistSync: async (id, patch) => {
      writes.push({ id, patch });
      return {};
    },
    ...overrides,
  };
  return { deps, writes };
}

/** Estado que quedó escrito por la ÚLTIMA persistencia del intento. */
function lastState(writes: { patch: ContactHubSpotSyncPatch }[]) {
  assert.ok(writes.length > 0, 'se esperaba al menos una escritura de estado');
  return readHubSpotSyncState(writes[writes.length - 1].patch.metadata);
}

// ── El módulo de estado ─────────────────────────────────────────

describe('contrato del estado', () => {
  it('el email manda sobre la empresa', () => {
    assert.equal(
      resolveInitialHubSpotSyncStatus({ email: null, hubspotCompanyId: 'hs-1' }),
      'blocked_no_email',
    );
    assert.equal(
      resolveInitialHubSpotSyncStatus({ email: 'a@b.com', hubspotCompanyId: null }),
      'blocked_no_hubspot_company',
    );
    assert.equal(
      resolveInitialHubSpotSyncStatus({ email: 'a@b.com', hubspotCompanyId: 'hs-1' }),
      'never_attempted',
    );
  });

  it('un status fuera del vocabulario se lee como ausente, no como conocido', () => {
    assert.equal(readHubSpotSyncState({ hubspot_sync: { status: 'error' } }), null);
    assert.equal(readHubSpotSyncState({ hubspot_sync: 'synced' }), null);
    assert.equal(readHubSpotSyncState({}), null);
    assert.equal(readHubSpotSyncState(null), null);
  });

  it('escribir el estado no toca el resto de la metadata', () => {
    const meta = writeHubSpotSyncState(
      { source: 'x', normalization: { status: 'normalized' } },
      buildInitialHubSpotSyncState({ email: 'a@b.com', hubspotCompanyId: 'hs-1' }),
    );
    assert.equal(meta.source, 'x');
    assert.deepEqual(meta.normalization, { status: 'normalized' });
    assert.equal(readHubSpotSyncState(meta)?.status, 'never_attempted');
  });

  it('todos los estados del vocabulario tienen etiqueta legible', () => {
    // CUT-2 añadió `stale`. La afirmación sigue siendo EXHAUSTIVA: un estado nuevo sin
    // etiqueta rompe aquí, que es justo lo que este test defiende.
    assert.deepEqual(HUBSPOT_SYNC_STATUS_LABELS, {
      never_attempted: 'Nunca sincronizado',
      blocked_no_email: 'Bloqueado: falta email',
      blocked_no_hubspot_company: 'Bloqueado: empresa no está en HubSpot',
      synced: 'Sincronizado',
      stale: 'Pendiente de actualizar',
      failed: 'Error de sincronización',
    });
  });
});

// ── 5-7. Desenlaces exitosos ────────────────────────────────────

describe('sincronización manual exitosa', () => {
  it('5. creación en HubSpot ⇒ synced', async () => {
    const { deps, writes } = makeDeps();
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok, true);
    assert.equal(res.ok === true && res.status, 'created');
    assert.deepEqual(lastState(writes), {
      status: 'synced',
      method: 'manual',
      attempted_at: NOW,
      last_error: null,
      hubspot_contact_id: 'hs-contact-1',
      stale_since: null,
      stale_reason: null,
      // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
      stale_source: null,
    });
    assert.equal(writes[0].patch.hubspot_contact_id, 'hs-contact-1');
  });

  it('6. vínculo con un contacto existente en HubSpot ⇒ synced', async () => {
    const { deps, writes } = makeDeps({
      findHubSpotContactByEmail: async () => ({ id: 'hs-existing-7' }),
      createHubSpotContact: async () => {
        throw new Error('no debe crear cuando ya existe');
      },
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok === true && res.status, 'linked_existing');
    assert.equal(lastState(writes)?.status, 'synced');
    assert.equal(lastState(writes)?.hubspot_contact_id, 'hs-existing-7');
  });

  it('la auditoría de 17A.4C sobrevive junto al estado nuevo', async () => {
    const { deps, writes } = makeDeps();
    await runSyncContactToHubSpot('contact-1', deps);

    const block = writes[0].patch.metadata.hubspot_sync as Record<string, unknown>;
    assert.equal(block.synced_at, NOW);
    assert.equal(block.synced_by, 'user-1');
    assert.equal(block.mode, 'created');
    assert.equal(block.hubspot_company_id, 'hs-company-99');
    assert.equal(block.company_association, 'associated');
    // 12. y la metadata ajena al bloque tampoco se pierde.
    assert.equal(writes[0].patch.metadata.source, 'contact_enrichment_candidate');
  });

  it('7. already_synced sigue siendo synced y no reescribe nada', async () => {
    const synced = makeContact({
      hubspot_contact_id: 'hs-contact-1',
      metadata: {
        source: 'contact_enrichment_candidate',
        hubspot_sync: {
          status: 'synced',
          method: 'manual',
          attempted_at: '2026-08-20T09:00:00.000Z',
          last_error: null,
          hubspot_contact_id: 'hs-contact-1',
          synced_at: '2026-08-20T09:00:00.000Z',
        },
      },
    });
    const { deps, writes } = makeDeps({
      loadContact: async () => synced,
      createHubSpotContact: async () => {
        throw new Error('no debe llamar a HubSpot');
      },
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok === true && res.status, 'already_synced');
    // Cero escrituras: reescribir pisaría el `attempted_at` del intento que creó el vínculo
    // con la hora de una simple consulta.
    assert.equal(writes.length, 0);
    assert.equal(readHubSpotSyncState(synced.metadata)?.attempted_at, '2026-08-20T09:00:00.000Z');
  });

  it('un vínculo sin estado `synced` se repara sin estampar una hora nueva', async () => {
    // Contacto vinculado por otra vía cuyo estado durable seguía diciendo `never_attempted`.
    const { deps, writes } = makeDeps({
      loadContact: async () =>
        makeContact({
          hubspot_contact_id: 'hs-contact-9',
          metadata: {
            source: 'x',
            hubspot_sync: buildInitialHubSpotSyncState({
              email: 'ana@empresa.com',
              hubspotCompanyId: 'hs-company-99',
            }),
          },
        }),
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok === true && res.status, 'already_synced');
    assert.deepEqual(lastState(writes), {
      status: 'synced',
      method: null,
      attempted_at: null,
      last_error: null,
      hubspot_contact_id: 'hs-contact-9',
      stale_since: null,
      stale_reason: null,
      // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
      stale_source: null,
    });
    // No se toca la columna del vínculo: ya está puesta.
    assert.equal(writes[0].patch.hubspot_contact_id, null);
    assert.equal(writes[0].patch.metadata.source, 'x');
  });
});

// ── 8-10. Desenlaces bloqueados y fallidos ──────────────────────

describe('sincronización manual bloqueada o fallida', () => {
  it('8. fallo de HubSpot ⇒ failed con código mecánico sin PII', async () => {
    const { deps, writes } = makeDeps({
      createHubSpotContact: async () => ({
        error: 'HubSpot 409: contact ana@empresa.com already exists (+57 300 555 0000)',
      }),
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.errorCode, 'HUBSPOT_ERROR');
    assert.deepEqual(lastState(writes), {
      status: 'failed',
      method: 'manual',
      attempted_at: NOW,
      last_error: HUBSPOT_SYNC_ERROR_CODES.hubspotCreateFailed,
      hubspot_contact_id: null,
      stale_since: null,
      stale_reason: null,
      // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
      stale_source: null,
    });
    // El mensaje del proveedor cita email y teléfono: nada de eso puede quedar en la fila.
    const serialized = JSON.stringify(writes[writes.length - 1].patch.metadata);
    assert.equal(serialized.includes('ana@empresa.com'), false);
    assert.equal(serialized.includes('555 0000'), false);
  });

  it('8b. si HubSpot creó pero SellUp no pudo guardar el vínculo ⇒ failed', async () => {
    let call = 0;
    const writes: ContactHubSpotSyncPatch[] = [];
    const { deps } = makeDeps({
      persistSync: async (_id, patch) => {
        writes.push(patch);
        call += 1;
        return call === 1 ? { error: 'db down' } : {};
      },
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok === false && res.errorCode, 'UNKNOWN_ERROR');
    assert.equal(readHubSpotSyncState(writes[1].metadata)?.status, 'failed');
    assert.equal(
      readHubSpotSyncState(writes[1].metadata)?.last_error,
      HUBSPOT_SYNC_ERROR_CODES.localLinkFailed,
    );
  });

  it('9. falta email durante la sincronización ⇒ blocked_no_email', async () => {
    const { deps, writes } = makeDeps({
      loadContact: async () => makeContact({ email: null }),
      createHubSpotContact: async () => {
        throw new Error('no debe llamar a HubSpot');
      },
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok === false && res.errorCode, 'MISSING_EMAIL');
    assert.deepEqual(lastState(writes), {
      status: 'blocked_no_email',
      method: 'manual',
      attempted_at: NOW,
      last_error: null,
      hubspot_contact_id: null,
      stale_since: null,
      stale_reason: null,
      // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
      stale_source: null,
    });
    assert.equal(writes[0].patch.hubspot_contact_id, null);
  });

  it('10. la cuenta no está en HubSpot ⇒ blocked_no_hubspot_company', async () => {
    const { deps, writes } = makeDeps({
      loadAccount: async () => makeAccount({ hubspot_company_id: null }),
      createHubSpotContact: async () => {
        throw new Error('no debe llamar a HubSpot');
      },
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok === false && res.errorCode, 'MISSING_HUBSPOT_COMPANY');
    assert.equal(lastState(writes)?.status, 'blocked_no_hubspot_company');
    assert.equal(lastState(writes)?.attempted_at, NOW);
  });

  it('registrar el estado es best-effort: no sustituye al veredicto del intento', async () => {
    const { deps } = makeDeps({
      loadContact: async () => makeContact({ email: null }),
      persistSync: async () => {
        throw new Error('db down');
      },
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    // El humano sigue viendo la causa accionable, no un error de base de datos.
    assert.equal(res.ok === false && res.errorCode, 'MISSING_EMAIL');
  });

  it('una condición del WORKSPACE no se escribe como estado del contacto', async () => {
    for (const connection of [
      { connected: false, canWriteContacts: false },
      { connected: true, canWriteContacts: false },
    ]) {
      const { deps, writes } = makeDeps({ checkConnection: async () => connection });
      const res = await runSyncContactToHubSpot('contact-1', deps);
      assert.equal(res.ok, false);
      // HubSpot desconectado o sin scope es igual para TODOS los contactos: marcar cada ficha
      // como `failed` culparía al contacto de una configuración que no es suya.
      assert.equal(writes.length, 0);
    }
  });

  it('un contacto sin cuenta no se marca como bloqueado por HubSpot', async () => {
    const { deps, writes } = makeDeps({
      loadContact: async () => makeContact({ account_id: null }),
    });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok === false && res.errorCode, 'MISSING_ACCOUNT');
    assert.equal(writes.length, 0);
  });

  it('un contacto inexistente no produce escritura alguna', async () => {
    const { deps, writes } = makeDeps({ loadContact: async () => null });
    const res = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(res.ok === false && res.errorCode, 'CONTACT_NOT_FOUND');
    assert.equal(writes.length, 0);
  });
});

// ── Constructores de metadata ───────────────────────────────────

describe('constructores de metadata', () => {
  it('buildFailedSyncMetadata conserva la metadata ajena al bloque', () => {
    const meta = buildFailedSyncMetadata({
      existing: { source: 'x', keep: true, hubspot_sync: { status: 'never_attempted' } },
      status: 'failed',
      lastError: HUBSPOT_SYNC_ERROR_CODES.hubspotCreateFailed,
      nowIso: NOW,
      // CUT-3B — este camino sigue siendo el MANUAL. Se declara, no se hereda.
      method: 'manual',
    });
    assert.equal(meta.source, 'x');
    assert.equal(meta.keep, true);
    assert.deepEqual(readHubSpotSyncState(meta), {
      status: 'failed',
      method: 'manual',
      attempted_at: NOW,
      last_error: HUBSPOT_SYNC_ERROR_CODES.hubspotCreateFailed,
      hubspot_contact_id: null,
      stale_since: null,
      stale_reason: null,
      // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
      stale_source: null,
    });
  });

  it('buildSyncMetadata escribe el contrato completo', () => {
    const meta = buildSyncMetadata({
      existing: { source: 'x' },
      hubspotContactId: 'hs-1',
      mode: 'linked_existing',
      hubspotCompanyId: 'hs-company-99',
      companyAssociation: 'failed',
      actorId: 'user-1',
      nowIso: NOW,
      // CUT-3B — este camino sigue siendo el MANUAL. Se declara, no se hereda.
      method: 'manual',
    });
    assert.deepEqual(readHubSpotSyncState(meta), {
      status: 'synced',
      method: 'manual',
      attempted_at: NOW,
      last_error: null,
      hubspot_contact_id: 'hs-1',
      stale_since: null,
      stale_reason: null,
      // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
      stale_source: null,
    });
    assert.equal((meta.hubspot_sync as Record<string, unknown>).company_association, 'failed');
  });
});
