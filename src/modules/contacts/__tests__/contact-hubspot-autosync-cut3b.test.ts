/**
 * AGENT2-CONTACT-HUBSPOT-AUTOSYNC-CUT3B — la sincronización AUTOMÁTICA tras aprobar.
 *
 * Lo que se demuestra aquí:
 *  - con la bandera APAGADA el sistema es indistinguible de CUT-3A: cero red, cero lecturas,
 *    cero escrituras y el estado durable intacto;
 *  - con la bandera encendida el alta se sincroniza sola REUSANDO el único motor que existe,
 *    con `method: 'auto'` como única diferencia;
 *  - los cuatro bloqueos (sin email, sin empresa, sin conexión, sin scope) resuelven con CERO
 *    peticiones a HubSpot, y los dos que son del WORKSPACE dejan un anexo operativo sin
 *    ensuciar el `status` del contacto;
 *  - un contacto YA vinculado nunca recibe un PATCH automático, ni siquiera con un cambio
 *    pendiente: reintentar la aprobación no es permiso para reescribir el CRM del cliente;
 *  - ningún `last_error` guarda PII, ni siquiera cuando el proveedor la cita en su mensaje.
 *
 * Sin red, sin DB, sin auth: todo inyectado, y `fetch` global envenenado para que una salida a
 * la red rompa la prueba en vez de pasar inadvertida.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  runContactHubSpotAutoSync,
  resolveContactAutoSyncGate,
  type ContactAutoSyncDeps,
  type ContactAutoSyncSubject,
} from '../contact-hubspot-autosync-core';
import {
  runSyncContactToHubSpot,
  buildSyncMetadata,
  type AccountForSync,
  type ContactForSync,
  type ContactHubSpotSyncPatch,
  type HubSpotContactCreateInput,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';
import {
  HUBSPOT_AUTO_SYNC_BLOCKED_REASONS,
  HUBSPOT_SYNC_ERROR_CODES,
  readContactAutoSyncAnnex,
  readHubSpotSyncState,
  writeContactAutoSyncAnnex,
} from '../contact-hubspot-sync-state';

// ── 20 · Ninguna red real en toda la suite ──────────────────────

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

const NOW = '2026-08-25T18:00:00.000Z';
const CONTACT_ID = 'contact-cut3b';

function makeContact(overrides: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: CONTACT_ID,
    account_id: 'account-1',
    full_name: 'Ana María Pérez',
    first_name: 'Ana María',
    last_name: 'Pérez',
    email: 'ana@empresa.com',
    phone: '+57 1 555 0000',
    mobile_phone: '+57 300 555 0000',
    job_title: 'Gerente de RRHH',
    linkedin_url: 'https://linkedin.com/in/ana',
    hubspot_contact_id: null,
    metadata: {
      hubspot_sync: {
        status: 'never_attempted',
        method: null,
        attempted_at: null,
        last_error: null,
        hubspot_contact_id: null,
        stale_since: null,
        stale_reason: null,
        // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
        stale_source: null,
      },
    },
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountForSync> = {}): AccountForSync {
  return { id: 'account-1', name: 'Empresa SA', hubspot_company_id: 'hs-company-1', ...overrides };
}

interface Spy {
  /** Todo lo que PUDO salir hacia HubSpot. Cualquier entrada aquí es una petición al proveedor. */
  hubspotCalls: string[];
  created: HubSpotContactCreateInput[];
  patched: { id: string; phone: string | null }[];
  persisted: ContactHubSpotSyncPatch[];
  annexes: Record<string, unknown>[];
  subjectReads: number;
}

function makeSpy(): Spy {
  return {
    hubspotCalls: [],
    created: [],
    patched: [],
    persisted: [],
    annexes: [],
    subjectReads: 0,
  };
}

/**
 * Construye las dependencias del MOTOR REAL con `method: 'auto'`.
 *
 * Es el motor de verdad, no un doble: probar el autosync contra una imitación demostraría que
 * la imitación funciona. Lo único inyectado son los bordes —HubSpot y la persistencia—.
 */
function makeSyncDeps(
  spy: Spy,
  overrides: Partial<SyncContactDeps> = {},
  contact: ContactForSync = makeContact(),
  account: AccountForSync = makeAccount(),
): SyncContactDeps {
  return {
    actorId: 'user-1',
    nowIso: NOW,
    method: 'auto',
    loadContact: async () => contact,
    loadAccount: async () => account,
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async (email) => {
      spy.hubspotCalls.push(`search:${email}`);
      return null;
    },
    createHubSpotContact: async (input) => {
      spy.hubspotCalls.push('create');
      spy.created.push(input);
      return { id: 'hs-contact-9' };
    },
    updateHubSpotContact: async (id, input) => {
      spy.hubspotCalls.push('update');
      spy.patched.push({ id, phone: input.phone });
      return { ok: true };
    },
    associateContactWithCompany: async () => {
      spy.hubspotCalls.push('associate');
      return { ok: true };
    },
    persistSync: async (_id, patch) => {
      spy.persisted.push(patch);
      return {};
    },
    ...overrides,
  };
}

function makeAutoSyncDeps(
  spy: Spy,
  args: {
    enabled?: boolean;
    contact?: ContactForSync;
    account?: AccountForSync;
    syncOverrides?: Partial<SyncContactDeps>;
    subject?: ContactAutoSyncSubject | null;
  } = {},
): ContactAutoSyncDeps {
  const contact = args.contact ?? makeContact();
  const subject =
    args.subject === undefined
      ? {
          id: contact.id,
          hubspot_contact_id: contact.hubspot_contact_id,
          metadata: contact.metadata,
        }
      : args.subject;

  return {
    enabled: args.enabled ?? true,
    nowIso: NOW,
    loadSubject: async () => {
      spy.subjectReads += 1;
      return subject;
    },
    runSync: async (id) =>
      runSyncContactToHubSpot(
        id,
        makeSyncDeps(spy, args.syncOverrides ?? {}, contact, args.account ?? makeAccount()),
      ),
    persistAnnex: async (_id, metadata) => {
      spy.annexes.push(metadata);
      return {};
    },
  };
}

/** El estado durable que quedó escrito, leído por la MISMA autoridad que lo define. */
function lastPersistedState(spy: Spy) {
  const last = spy.persisted.at(-1);
  return last ? readHubSpotSyncState(last.metadata) : null;
}

// ════════════════════════════════════════════════════════════════
// 1 · Bandera APAGADA
// ════════════════════════════════════════════════════════════════

describe('1. bandera APAGADA — la aprobación es exactamente la de CUT-3A', () => {
  it('un contacto perfectamente elegible NO se sincroniza: cero red y cero lecturas', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { enabled: false }),
    );

    assert.equal(report.outcome, 'flag_off');
    assert.equal(report.attempted, false);
    assert.deepEqual(spy.hubspotCalls, []);
    // Ni siquiera se lee el contacto: apagar la bandera no añade una sola consulta.
    assert.equal(spy.subjectReads, 0);
    assert.deepEqual(spy.persisted, []);
    assert.deepEqual(spy.annexes, []);
  });

  it('el estado durable se queda como estaba: `never_attempted` sin método', () => {
    // Nadie escribió, así que el estado sigue siendo el que la aprobación dejó (CUT-1).
    const state = readHubSpotSyncState(makeContact().metadata);
    assert.equal(state?.status, 'never_attempted');
    assert.equal(state?.method, null);
    assert.equal(state?.attempted_at, null);
  });
});

// ════════════════════════════════════════════════════════════════
// 2-3 · Bandera ENCENDIDA y contacto elegible
// ════════════════════════════════════════════════════════════════

describe('2. bandera ENCENDIDA — el alta se crea sola y queda marcada como automática', () => {
  it('crea en HubSpot, vincula y estampa `method: auto`', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(CONTACT_ID, makeAutoSyncDeps(spy));

    assert.equal(report.outcome, 'attempted_created');
    assert.equal(report.attempted, true);
    assert.equal(report.hubspotContactId, 'hs-contact-9');

    // Se REUSÓ el flujo existente: buscar por email antes de crear, y asociar después.
    assert.deepEqual(spy.hubspotCalls, ['search:ana@empresa.com', 'create', 'associate']);

    const state = lastPersistedState(spy);
    assert.equal(state?.status, 'synced');
    assert.equal(state?.method, 'auto');
    assert.equal(state?.attempted_at, NOW);
    assert.equal(state?.hubspot_contact_id, 'hs-contact-9');
    assert.equal(state?.last_error, null);
    // El vínculo se escribe en la COLUMNA, no sólo en la metadata.
    assert.equal(spy.persisted.at(-1)?.hubspot_contact_id, 'hs-contact-9');
  });

  it('el `method` no se hereda de un valor por defecto: es el que se inyectó', async () => {
    const spy = makeSpy();
    await runContactHubSpotAutoSync(CONTACT_ID, makeAutoSyncDeps(spy));
    assert.notEqual(lastPersistedState(spy)?.method, 'manual');
  });
});

describe('3. ya existía en HubSpot por email — se VINCULA, no se duplica', () => {
  it('linked_existing con method auto y sin una sola creación', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        syncOverrides: {
          findHubSpotContactByEmail: async (email) => {
            spy.hubspotCalls.push(`search:${email}`);
            return { id: 'hs-existing-42' };
          },
        },
      }),
    );

    assert.equal(report.outcome, 'attempted_linked_existing');
    assert.equal(report.hubspotContactId, 'hs-existing-42');
    assert.equal(spy.created.length, 0, 'la deduplicación por email no cambia en el autosync');
    assert.equal(spy.hubspotCalls.includes('create'), false);

    const state = lastPersistedState(spy);
    assert.equal(state?.status, 'synced');
    assert.equal(state?.method, 'auto');
    assert.equal(state?.hubspot_contact_id, 'hs-existing-42');
  });
});

// ════════════════════════════════════════════════════════════════
// 4-5 · Bloqueos que son del CONTACTO
// ════════════════════════════════════════════════════════════════

describe('4. sin email — cero red, y la razón queda durable', () => {
  it('blocked_no_email sin una sola petición a HubSpot', async () => {
    const spy = makeSpy();
    const contact = makeContact({ email: null });
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { contact }),
    );

    assert.equal(report.outcome, 'blocked_no_email');
    assert.equal(report.attempted, false);
    assert.deepEqual(spy.hubspotCalls, []);

    const state = lastPersistedState(spy);
    assert.equal(state?.status, 'blocked_no_email');
    assert.equal(state?.method, 'auto');
    // La columna se OMITE: registrar un bloqueo no puede borrar un vínculo.
    assert.equal(spy.persisted.at(-1)?.hubspot_contact_id, null);
  });
});

describe('5. la cuenta no tiene empresa en HubSpot — cero red', () => {
  it('blocked_no_hubspot_company, y NO se crea ninguna empresa', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { account: makeAccount({ hubspot_company_id: null }) }),
    );

    assert.equal(report.outcome, 'blocked_no_hubspot_company');
    assert.deepEqual(spy.hubspotCalls, []);
    assert.equal(lastPersistedState(spy)?.status, 'blocked_no_hubspot_company');
    assert.equal(lastPersistedState(spy)?.method, 'auto');
  });
});

// ════════════════════════════════════════════════════════════════
// 6-7 · Bloqueos que son del WORKSPACE
// ════════════════════════════════════════════════════════════════

describe('6. HubSpot no está conectado — el contacto NO carga con la culpa', () => {
  it('cero creación, `status` intacto y anexo operativo con su hora', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        syncOverrides: {
          checkConnection: async () => ({ connected: false, canWriteContacts: false }),
        },
      }),
    );

    assert.equal(report.outcome, 'blocked_workspace_not_connected');
    assert.equal(report.blockedReason, HUBSPOT_AUTO_SYNC_BLOCKED_REASONS.notConnected);
    assert.deepEqual(spy.hubspotCalls, []);

    // El motor NO escribió estado: una condición del workspace no ensucia la ficha.
    assert.deepEqual(spy.persisted, []);

    // Pero el hecho SÍ queda observable, sin sobrecargar `failed`.
    assert.equal(spy.annexes.length, 1);
    const annex = readContactAutoSyncAnnex(spy.annexes[0]);
    assert.equal(annex?.blocked_reason, 'hubspot_not_connected');
    assert.equal(annex?.checked_at, NOW);

    // Y el estado durable sigue diciendo la VERDAD: nunca se intentó.
    const state = readHubSpotSyncState(spy.annexes[0]);
    assert.equal(state?.status, 'never_attempted');
    assert.equal(state?.method, null);
    assert.equal(state?.attempted_at, null);
  });
});

describe('7. falta el scope de escritura de contactos — mismo principio', () => {
  it('cero creación, `status` intacto y anexo `hubspot_scope_missing`', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        syncOverrides: {
          checkConnection: async () => ({ connected: true, canWriteContacts: false }),
        },
      }),
    );

    assert.equal(report.outcome, 'blocked_scope_missing');
    assert.equal(report.blockedReason, HUBSPOT_AUTO_SYNC_BLOCKED_REASONS.scopeMissing);
    assert.deepEqual(spy.hubspotCalls, []);
    assert.deepEqual(spy.persisted, []);
    assert.equal(readContactAutoSyncAnnex(spy.annexes[0])?.blocked_reason, 'hubspot_scope_missing');
  });

  it('el escritor del anexo es INCAPAZ de tocar el estado, no sólo se abstiene', () => {
    const before = {
      hubspot_sync: {
        status: 'synced',
        method: 'manual',
        attempted_at: '2026-01-01T00:00:00.000Z',
        hubspot_contact_id: 'hs-1',
      },
      otra_cosa: true,
    };
    const after = writeContactAutoSyncAnnex(before, {
      blocked_reason: 'hubspot_not_connected',
      checked_at: NOW,
    });
    const state = readHubSpotSyncState(after);
    assert.equal(state?.status, 'synced');
    assert.equal(state?.method, 'manual');
    assert.equal(state?.attempted_at, '2026-01-01T00:00:00.000Z');
    assert.equal(state?.hubspot_contact_id, 'hs-1');
    assert.equal((after as Record<string, unknown>).otra_cosa, true);
  });
});

// ════════════════════════════════════════════════════════════════
// 8-10 · Fallos con la aprobación ya confirmada
// ════════════════════════════════════════════════════════════════

describe('8. la búsqueda por email falla — FALLA CERRADO', () => {
  it('cero creación y `failed` con un código propio', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        syncOverrides: {
          findHubSpotContactByEmail: async () => {
            spy.hubspotCalls.push('search');
            throw new Error('HubSpot contact search error: HTTP 502');
          },
        },
      }),
    );

    assert.equal(report.outcome, 'attempted_failed');
    // Se buscó, pero NO se creó: no poder comprobar si existe nunca autoriza a duplicar.
    assert.deepEqual(spy.hubspotCalls, ['search']);
    assert.equal(spy.created.length, 0);

    const state = lastPersistedState(spy);
    assert.equal(state?.status, 'failed');
    assert.equal(state?.method, 'auto');
    assert.equal(state?.last_error, HUBSPOT_SYNC_ERROR_CODES.hubspotSearchFailed);
  });
});

describe('9. la creación en HubSpot falla', () => {
  it('`failed` con `hubspot_create_failed`, y el vínculo no se inventa', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        syncOverrides: {
          createHubSpotContact: async () => {
            spy.hubspotCalls.push('create');
            return { error: 'HTTP 400: invalid property for ana@empresa.com' };
          },
        },
      }),
    );

    assert.equal(report.outcome, 'attempted_failed');
    assert.equal(report.hubspotContactId, null);
    const state = lastPersistedState(spy);
    assert.equal(state?.status, 'failed');
    assert.equal(state?.method, 'auto');
    assert.equal(state?.last_error, HUBSPOT_SYNC_ERROR_CODES.hubspotCreateFailed);
    assert.equal(state?.hubspot_contact_id, null);
  });
});

describe('10. el contacto SÍ quedó en HubSpot pero SellUp no pudo guardar el vínculo', () => {
  it('`local_link_failed` — honesto sobre dónde falló', async () => {
    const spy = makeSpy();
    let firstWrite = true;
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        syncOverrides: {
          persistSync: async (_id, patch) => {
            spy.persisted.push(patch);
            if (firstWrite) {
              firstWrite = false;
              return { error: 'connection reset' };
            }
            return {};
          },
        },
      }),
    );

    assert.equal(report.outcome, 'attempted_failed');
    // El contacto SÍ se creó en HubSpot: eso ocurrió y no se niega.
    assert.equal(spy.created.length, 1);
    const state = lastPersistedState(spy);
    assert.equal(state?.status, 'failed');
    assert.equal(state?.method, 'auto');
    assert.equal(state?.last_error, HUBSPOT_SYNC_ERROR_CODES.localLinkFailed);
  });
});

// ════════════════════════════════════════════════════════════════
// 11-13 · Idempotencia: el portero
// ════════════════════════════════════════════════════════════════

describe('11. segundo intento de aprobación sobre un contacto YA sincronizado', () => {
  it('cero red: el portero no deja arrancar el motor', async () => {
    const spy = makeSpy();
    const contact = makeContact({
      hubspot_contact_id: 'hs-contact-9',
      metadata: {
        hubspot_sync: {
          status: 'synced',
          method: 'auto',
          attempted_at: NOW,
          last_error: null,
          hubspot_contact_id: 'hs-contact-9',
          stale_since: null,
          stale_reason: null,
          // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
          stale_source: null,
        },
      },
    });
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { contact }),
    );

    assert.equal(report.outcome, 'skipped_already_synced');
    assert.equal(report.attempted, false);
    assert.deepEqual(spy.hubspotCalls, []);
    assert.deepEqual(spy.persisted, []);
    assert.deepEqual(spy.annexes, []);
  });
});

describe('12. `already_approved` + `never_attempted` + elegible — UNA recuperación segura', () => {
  it('sin vínculo se intenta una vez, y el intento siguiente ya no toca la red', async () => {
    // Primera pasada: el contacto no tiene vínculo, así que el alta pendiente se ejecuta.
    const spy = makeSpy();
    const first = await runContactHubSpotAutoSync(CONTACT_ID, makeAutoSyncDeps(spy));
    assert.equal(first.outcome, 'attempted_created');
    assert.equal(spy.hubspotCalls.length, 3);

    // Segunda pasada sobre el estado que la primera dejó: ya hay vínculo → cero red.
    const spy2 = makeSpy();
    const linked = makeContact({
      hubspot_contact_id: 'hs-contact-9',
      metadata: spy.persisted.at(-1)!.metadata,
    });
    const second = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy2, { contact: linked }),
    );
    assert.equal(second.outcome, 'skipped_already_synced');
    assert.deepEqual(spy2.hubspotCalls, []);
  });

  it('la regla se decide por el VÍNCULO de la fila, no por el `status` del bloque', () => {
    // Estado ilegible + vínculo real: no se toca. Un `status` puede faltar; la columna no miente.
    assert.deepEqual(
      resolveContactAutoSyncGate({
        id: CONTACT_ID,
        hubspot_contact_id: 'hs-1',
        metadata: { hubspot_sync: { status: 'lo-que-sea' } },
      }),
      { proceed: false, outcome: 'skipped_already_synced' },
    );
    // Sin vínculo, aunque el bloque diga `failed`: el alta sigue sin ocurrir.
    assert.deepEqual(
      resolveContactAutoSyncGate({
        id: CONTACT_ID,
        hubspot_contact_id: null,
        metadata: { hubspot_sync: { status: 'failed' } },
      }),
      { proceed: true },
    );
    // Cadena vacía o espacios NO son un vínculo.
    assert.deepEqual(
      resolveContactAutoSyncGate({ id: CONTACT_ID, hubspot_contact_id: '   ', metadata: null }),
      { proceed: true },
    );
  });
});

describe('13. contacto `stale` + reintento de aprobación — JAMÁS un PATCH automático', () => {
  const staleContact = () =>
    makeContact({
      hubspot_contact_id: 'hs-contact-9',
      mobile_phone: '+57 300 999 9999',
      metadata: {
        hubspot_sync: {
          status: 'stale',
          method: 'manual',
          attempted_at: '2026-08-01T00:00:00.000Z',
          last_error: null,
          hubspot_contact_id: 'hs-contact-9',
          stale_since: '2026-08-20T00:00:00.000Z',
          stale_reason: 'phone_changed',
        },
      },
    });

  it('cero red, cero PATCH y el pendiente sobrevive intacto', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { contact: staleContact() }),
    );

    assert.equal(report.outcome, 'skipped_pending_manual_update');
    assert.equal(report.attempted, false);
    assert.deepEqual(spy.hubspotCalls, []);
    assert.deepEqual(spy.patched, [], 'un reintento de aprobación no reescribe el CRM del cliente');
    assert.deepEqual(spy.persisted, []);
  });

  it('lo mismo cuando el pendiente es un BORRADO (`phone_removed`)', async () => {
    const spy = makeSpy();
    const contact = staleContact();
    contact.phone = null;
    contact.mobile_phone = null;
    (contact.metadata.hubspot_sync as Record<string, unknown>).stale_reason = 'phone_removed';

    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { contact }),
    );
    assert.equal(report.outcome, 'skipped_pending_manual_update');
    assert.deepEqual(spy.hubspotCalls, []);
  });

  it('un `failed` con pendiente tampoco autoriza el PATCH automático', async () => {
    const spy = makeSpy();
    const contact = staleContact();
    (contact.metadata.hubspot_sync as Record<string, unknown>).status = 'failed';
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { contact }),
    );
    assert.equal(report.outcome, 'skipped_pending_manual_update');
    assert.deepEqual(spy.hubspotCalls, []);
  });
});

// ════════════════════════════════════════════════════════════════
// 14-15 · El teléfono en el momento del alta
// ════════════════════════════════════════════════════════════════

describe('14-15. el payload de creación usa el contrato de teléfono que ya existía', () => {
  it('con teléfono y móvil disponibles al aprobar, los DOS viajan de forma independiente', async () => {
    // ⚠️ ESTA PRUEBA AFIRMABA QUE SÓLO VIAJABA EL SALIENTE COLAPSADO (`mobile_phone ?? phone`),
    // y su cambio es el hito de AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC (Tasks A2-A4), no una
    // regresión: `phone` y `mobile_phone` ahora viajan cada uno a su propio destino en HubSpot.
    const spy = makeSpy();
    await runContactHubSpotAutoSync(CONTACT_ID, makeAutoSyncDeps(spy));
    assert.equal(spy.created[0].phone, '+57 1 555 0000');
    assert.equal(spy.created[0].mobilePhone, '+57 300 555 0000');
  });

  it('sin `mobile_phone`, `phone` viaja igual y `mobilePhone` viaja explícito en `null`', async () => {
    const spy = makeSpy();
    await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { contact: makeContact({ mobile_phone: null }) }),
    );
    assert.equal(spy.created[0].phone, '+57 1 555 0000');
    assert.equal(spy.created[0].mobilePhone, null);
  });

  it('sin ningún teléfono, los DOS campos son `null` — el contrato de creación no cambia', async () => {
    const spy = makeSpy();
    await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { contact: makeContact({ phone: null, mobile_phone: null }) }),
    );
    assert.equal(spy.created[0].phone, null);
    assert.equal(spy.created[0].mobilePhone, null);
    // Y el resto del payload sigue siendo el de siempre.
    assert.deepEqual(Object.keys(spy.created[0]).sort(), [
      'email',
      'firstname',
      'jobtitle',
      'lastname',
      'mobilePhone',
      'phone',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════
// 17-18 · Lo que el autosync NO inventa
// ════════════════════════════════════════════════════════════════

describe('17. sin email NO hay recurso alternativo: ni LinkedIn ni nombre', () => {
  it('un contacto con LinkedIn y nombre completo pero sin email no llega a la red', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        contact: makeContact({
          email: null,
          linkedin_url: 'https://linkedin.com/in/ana',
          full_name: 'Ana María Pérez',
        }),
      }),
    );
    assert.equal(report.outcome, 'blocked_no_email');
    assert.deepEqual(spy.hubspotCalls, []);
  });

  it('LinkedIn tampoco viaja en el payload cuando SÍ hay email', async () => {
    const spy = makeSpy();
    await runContactHubSpotAutoSync(CONTACT_ID, makeAutoSyncDeps(spy));
    const props = spy.created[0] as unknown as Record<string, unknown>;
    assert.equal('linkedin_url' in props, false);
    assert.equal('hs_linkedin_url' in props, false);
    assert.equal('website' in props, false);
  });
});

describe('18. el autosync NO crea empresas: Agente 1 es su dueño', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/modules/contacts/contact-hubspot-autosync-core.ts'),
    'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('el módulo no nombra ninguna creación de empresa ni ninguna red', () => {
    for (const forbidden of [
      'createHubSpotCompany',
      'hubspot_company_id',
      'companies',
      'fetch(',
      'process.env',
    ]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} no pertenece al portero`);
    }
  });

  it('tampoco nombra a Apollo, a Lusha ni a ningún crédito', () => {
    for (const forbidden of ['apollo', 'lusha', 'credit', 'reveal']) {
      assert.equal(
        new RegExp(forbidden, 'i').test(source),
        false,
        `${forbidden} no pertenece al portero`,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 19 · PII
// ════════════════════════════════════════════════════════════════

describe('19. ningún `last_error` guarda PII, ni aunque el proveedor la escupa', () => {
  const POISON =
    'HTTP 400 Bad Request: property "email" with value ana@empresa.com and phone ' +
    '+57 300 555 0000 was rejected (token sk-live-abcdef)';

  it('el mensaje del proveedor NO aparece en ninguna parte de lo persistido', async () => {
    const spy = makeSpy();
    await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        syncOverrides: { createHubSpotContact: async () => ({ error: POISON }) },
      }),
    );

    const dump = JSON.stringify(spy.persisted);
    for (const secret of ['ana@empresa.com', '+57 300 555 0000', 'sk-live-abcdef', 'HTTP 400']) {
      assert.equal(dump.includes(secret), false, `${secret} no puede quedar persistido`);
    }
    // Sólo el código mecánico, en snake_case.
    assert.match(lastPersistedState(spy)!.last_error!, /^[a-z_]+$/);
  });

  it('el anexo tampoco tiene sitio donde meter PII: sólo razón y hora', async () => {
    const spy = makeSpy();
    await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, {
        syncOverrides: {
          checkConnection: async () => {
            throw new Error(POISON);
          },
        },
      }),
    );
    assert.equal(JSON.stringify(spy.annexes).includes('ana@empresa.com'), false);
  });

  it('el informe en memoria no lleva cuerpos de petición ni de respuesta', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(CONTACT_ID, makeAutoSyncDeps(spy));
    assert.deepEqual(Object.keys(report).sort(), [
      'attempted',
      'blockedReason',
      'hubspotContactId',
      'outcome',
      'syncResult',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════
// 21 · El camino MANUAL no se movió
// ════════════════════════════════════════════════════════════════

describe('21. la sincronización manual conserva su contrato byte a byte', () => {
  it('`buildSyncMetadata` con `method: manual` produce el bloque de CUT-1 exacto', () => {
    const meta = buildSyncMetadata({
      existing: { source: 'x' },
      hubspotContactId: 'hs-1',
      mode: 'created',
      hubspotCompanyId: 'hs-company-1',
      companyAssociation: 'associated',
      actorId: 'user-1',
      nowIso: NOW,
      method: 'manual',
    });
    assert.deepEqual(meta, {
      source: 'x',
      hubspot_sync: {
        status: 'synced',
        method: 'manual',
        attempted_at: NOW,
        last_error: null,
        hubspot_contact_id: 'hs-1',
        stale_since: null,
        stale_reason: null,
        // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
        stale_source: null,
        synced_at: NOW,
        synced_by: 'user-1',
        mode: 'created',
        hubspot_company_id: 'hs-company-1',
        company_association: 'associated',
        // BACKFILL LEGACY — un intento con respuesta de HubSpot BORRA la anotación de línea
        // base, y la borra escribiéndola a `null` en vez de omitiendo la clave: es la misma
        // forma que ya tienen los tres marcadores de pendiente, y omitir dejaría que un
        // `...prior` resucitara la advertencia sobre un `synced` que ya está observado.
        baseline_source: null,
        baseline_at: null,
      },
    });
  });

  it('un contacto vinculado CON pendiente sigue recibiendo su PATCH cuando el método es manual', async () => {
    // Es el contraste exacto de la prueba 13: la operación existe y funciona; lo que CUT-3B
    // decide es QUIÉN puede dispararla.
    const spy = makeSpy();
    const contact = makeContact({
      hubspot_contact_id: 'hs-contact-9',
      mobile_phone: '+57 300 999 9999',
      metadata: {
        hubspot_sync: {
          status: 'stale',
          method: 'manual',
          attempted_at: '2026-08-01T00:00:00.000Z',
          last_error: null,
          hubspot_contact_id: 'hs-contact-9',
          stale_since: '2026-08-20T00:00:00.000Z',
          stale_reason: 'phone_changed',
        },
      },
    });
    const result = await runSyncContactToHubSpot(
      CONTACT_ID,
      makeSyncDeps(spy, { method: 'manual' }, contact),
    );

    assert.equal(result.ok && result.status, 'updated');
    // AGENT2A Task A4: `phone` viaja de forma independiente ahora — es el `phone` de la fila
    // (`+57 1 555 0000`, el default de `makeContact`), no el saliente colapsado con prioridad
    // al móvil que este PATCH enviaba antes. El spy no registra `mobilePhone` (ver su shape más
    // arriba), pero el móvil también viaja, por su propio campo.
    assert.deepEqual(spy.patched, [{ id: 'hs-contact-9', phone: '+57 1 555 0000' }]);
    assert.equal(lastPersistedState(spy)?.method, 'manual');
    assert.equal(lastPersistedState(spy)?.status, 'synced');
  });
});

// ════════════════════════════════════════════════════════════════
// Contrato del motor: nunca lanza
// ════════════════════════════════════════════════════════════════

describe('el autosync NUNCA lanza: una excepción sería una aprobación falsamente fallida', () => {
  it('una dependencia que explota se traduce en informe, no en excepción', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(CONTACT_ID, {
      ...makeAutoSyncDeps(spy),
      loadSubject: async () => {
        throw new Error('DB caída');
      },
    });
    assert.equal(report.outcome, 'attempted_failed');
  });

  it('un contacto que ya no se puede leer no se confunde con un fallo de HubSpot', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(
      CONTACT_ID,
      makeAutoSyncDeps(spy, { subject: null }),
    );
    assert.equal(report.outcome, 'skipped_contact_unavailable');
    assert.deepEqual(spy.hubspotCalls, []);
  });

  it('un fallo al guardar el anexo no cambia lo que se reporta de HubSpot', async () => {
    const spy = makeSpy();
    const report = await runContactHubSpotAutoSync(CONTACT_ID, {
      ...makeAutoSyncDeps(spy, {
        syncOverrides: {
          checkConnection: async () => ({ connected: false, canWriteContacts: false }),
        },
      }),
      persistAnnex: async () => {
        throw new Error('no se pudo escribir');
      },
    });
    assert.equal(report.outcome, 'blocked_workspace_not_connected');
  });
});
