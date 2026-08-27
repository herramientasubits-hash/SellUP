/**
 * AGENT2-CONTACT-HUBSPOT-UPDATE-CUT2 — contactos YA vinculados que quedan desactualizados.
 *
 * Lo que se demuestra:
 *  - un cambio local de teléfono sobre un contacto sincronizado deja `stale` escrito, y sólo
 *    entonces: ni sin vínculo, ni sin estado previo `synced`, ni cuando el número no cambia;
 *  - el clic manual distingue crear/vincular, ACTUALIZAR, reparar y no-hacer-nada, y sólo la
 *    rama de actualizar hace un PATCH —contra el id durable y con una única propiedad—;
 *  - un PATCH fallido deja `failed` SIN borrar la prueba de que sigue habiendo algo por enviar;
 *  - marcar `stale` no llama a HubSpot: no hay autosync en este corte.
 *
 * Sin red, sin DB, sin auth: todo inyectado, y `fetch` envenenado para que cualquier salida a
 * la red rompa la prueba.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  runSyncContactToHubSpot,
  buildHubSpotContactProperties,
  buildFailedSyncMetadata,
  buildUpdatedSyncMetadata,
  SYNC_MESSAGES,
  type ContactForSync,
  type AccountForSync,
  type ContactHubSpotSyncPatch,
  type HubSpotContactUpdateInput,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';
import {
  HUBSPOT_SYNC_ERROR_CODES,
  HUBSPOT_SYNC_STATUS_LABELS,
  hasPendingHubSpotPhoneChange,
  markContactHubSpotSyncStaleForPhoneChange,
  readHubSpotSyncState,
  resolveOutboundHubSpotPhone,
  writeHubSpotSyncState,
  type HubSpotSyncState,
} from '../contact-hubspot-sync-state';

// ── Prueba 22 — ninguna red real ────────────────────────────────

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
const STALE_AT = '2026-08-24T09:30:00.000Z';
const SYNCED_AT = '2026-08-20T10:00:00.000Z';
const HS_ID = 'hs-contact-7';

const OLD_PHONE = '+57 1 555 0000';
const NEW_PHONE = '+57 1 555 9999';
const MOBILE = '+57 300 111 2222';

function state(overrides: Partial<HubSpotSyncState> = {}): HubSpotSyncState {
  return {
    status: 'synced',
    method: 'manual',
    attempted_at: SYNCED_AT,
    last_error: null,
    hubspot_contact_id: HS_ID,
    stale_since: null,
    stale_reason: null,
    // CUT-3C — el campo existe en el contrato; estas suites siguen probando CUT-2/CUT-3A y por
    // defecto describen un contacto sin nada pendiente, así que no hay causante que nombrar.
    stale_source: null,
    ...overrides,
  };
}

/** Metadata realista: el bloque de sincronización convive con trazabilidad ajena. */
function metadataWith(s: HubSpotSyncState | null): Record<string, unknown> {
  const base: Record<string, unknown> = {
    source: 'contact_enrichment_candidate',
    source_candidate_id: 'cand-1',
    normalization: { status: 'normalized', fields: ['full_name'] },
  };
  return s ? writeHubSpotSyncState(base, s, { synced_at: SYNCED_AT, mode: 'created' }) : base;
}

function makeContact(overrides: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: 'contact-1',
    account_id: 'account-1',
    full_name: 'Ana María Pérez',
    first_name: 'Ana María',
    last_name: 'Pérez',
    email: 'ana@empresa.com',
    phone: NEW_PHONE,
    mobile_phone: null,
    job_title: 'Gerente de RRHH',
    linkedin_url: 'https://linkedin.com/in/anaperez',
    hubspot_contact_id: HS_ID,
    metadata: metadataWith(state()),
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountForSync> = {}): AccountForSync {
  return {
    id: 'account-1',
    name: 'Empresa S.A.',
    hubspot_company_id: 'hs-company-99',
    ...overrides,
  };
}

interface Spy {
  patches: Array<{ id: string; input: HubSpotContactUpdateInput }>;
  creates: number;
  searches: number;
  associations: number;
  writes: Array<{ id: string; patch: ContactHubSpotSyncPatch }>;
  audits: Array<Record<string, unknown>>;
}

function makeDeps(overrides: Partial<SyncContactDeps> = {}): { deps: SyncContactDeps; spy: Spy } {
  const spy: Spy = { patches: [], creates: 0, searches: 0, associations: 0, writes: [], audits: [] };
  const deps: SyncContactDeps = {
    actorId: 'user-1',
    nowIso: NOW,
    // CUT-3B — este camino sigue siendo el MANUAL. Se declara, no se hereda.
    method: 'manual',
    loadContact: async () => makeContact(),
    loadAccount: async () => makeAccount(),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => {
      spy.searches += 1;
      return null;
    },
    createHubSpotContact: async () => {
      spy.creates += 1;
      return { id: 'hs-contact-new' };
    },
    updateHubSpotContact: async (id, input) => {
      spy.patches.push({ id, input });
      return { ok: true };
    },
    associateContactWithCompany: async () => {
      spy.associations += 1;
      return { ok: true };
    },
    persistSync: async (id, patch) => {
      spy.writes.push({ id, patch });
      return {};
    },
    logAudit: async (entry) => {
      spy.audits.push(entry as unknown as Record<string, unknown>);
    },
    ...overrides,
  };
  return { deps, spy };
}

function lastWrittenState(spy: Spy): HubSpotSyncState {
  assert.ok(spy.writes.length > 0, 'se esperaba al menos una escritura de estado');
  const read = readHubSpotSyncState(spy.writes[spy.writes.length - 1].patch.metadata);
  assert.ok(read, 'la última escritura no dejó un estado legible');
  return read;
}

/** Aplica la autoridad central sobre un contacto y devuelve el estado resultante (o `null`). */
function markPhoneChange(args: {
  contactState: HubSpotSyncState | null;
  hubspotContactId?: string | null;
  previous: { phone: string | null; mobile_phone: string | null };
  next: { phone: string | null; mobile_phone: string | null };
  nowIso?: string;
}) {
  return markContactHubSpotSyncStaleForPhoneChange({
    metadata: metadataWith(args.contactState),
    hubspotContactId:
      args.hubspotContactId === undefined ? HS_ID : args.hubspotContactId,
    previous: args.previous,
    next: args.next,
    nowIso: args.nowIso ?? NOW,
    // CUT-3C — el helper de esta suite representa la edición manual del formulario.
    source: 'user_edit',
  });
}

// ════════════════════════════════════════════════════════════════
// Transición a `stale` — la autoridad central
// ════════════════════════════════════════════════════════════════

describe('CUT-2 · cuándo un contacto queda desactualizado', () => {
  it('1 · sincronizado + cambia `phone` ⇒ stale', () => {
    const decision = markPhoneChange({
      contactState: state(),
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
    });

    assert.equal(decision.marked, true);
    assert.ok(decision.marked);
    assert.equal(decision.state.status, 'stale');
    assert.equal(decision.state.stale_reason, 'phone_changed');
    assert.equal(decision.state.stale_since, NOW);
  });

  it('2 · sincronizado + cambia `mobile_phone` ⇒ stale', () => {
    const decision = markPhoneChange({
      contactState: state(),
      previous: { phone: OLD_PHONE, mobile_phone: MOBILE },
      next: { phone: OLD_PHONE, mobile_phone: '+57 300 999 8888' },
    });

    assert.ok(decision.marked);
    assert.equal(decision.state.status, 'stale');
    assert.equal(decision.state.stale_reason, 'phone_changed');
  });

  it('3 · reescribir EXACTAMENTE el mismo teléfono ⇒ sigue synced', () => {
    const decision = markPhoneChange({
      contactState: state(),
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: OLD_PHONE, mobile_phone: null },
    });

    assert.equal(decision.marked, false);
    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'no_outbound_change');
  });

  it('3b · un cambio que sólo añade espacios NO es un cambio', () => {
    const decision = markPhoneChange({
      contactState: state(),
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: `  ${OLD_PHONE}  `, mobile_phone: null },
    });

    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'no_outbound_change');
  });

  it('4 · sin `hubspot_contact_id` ⇒ no hay nada desactualizado', () => {
    const decision = markPhoneChange({
      contactState: state({ status: 'synced', hubspot_contact_id: null }),
      hubspotContactId: null,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
    });

    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'not_linked');
  });

  it('5 · never_attempted + cambio de teléfono ⇒ estado intacto', () => {
    const decision = markPhoneChange({
      contactState: state({ status: 'never_attempted', method: null, attempted_at: null }),
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
    });

    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'not_previously_synced');
  });

  it('6 · blocked_no_email + cambio de teléfono ⇒ estado intacto', () => {
    const decision = markPhoneChange({
      contactState: state({ status: 'blocked_no_email', method: null, attempted_at: null }),
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
    });

    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'not_previously_synced');
  });

  it('6b · sin bloque durable legible ⇒ territorio de reparación, no de `stale`', () => {
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: { source: 'legacy' },
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
      nowIso: NOW,
      // CUT-3C — la edición manual del formulario.
      source: 'user_edit',
    });

    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'no_durable_state');
  });

  it('6c · un `mobile_phone` que TAPA el escalar hace que cambiar `phone` no sea saliente', () => {
    // El PATCH enviaría `mobile_phone ?? phone`: con móvil puesto, cambiar el fijo no cambia
    // NADA de lo que HubSpot recibiría. Marcarlo prometería una actualización que es un no-op.
    const decision = markPhoneChange({
      contactState: state(),
      previous: { phone: OLD_PHONE, mobile_phone: MOBILE },
      next: { phone: NEW_PHONE, mobile_phone: MOBILE },
    });

    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'no_outbound_change');

    // Y cuando ese móvil se retira, el saliente SÍ cambia y la marca salta entonces: la
    // información no se pierde, se sella cuando de verdad hay algo que enviar.
    const later = markPhoneChange({
      contactState: state(),
      previous: { phone: NEW_PHONE, mobile_phone: MOBILE },
      next: { phone: NEW_PHONE, mobile_phone: null },
    });
    assert.ok(later.marked);
    assert.equal(later.state.status, 'stale');
  });

  it('6d · CUT-3A · vaciar el teléfono SÍ marca, con `phone_removed`', () => {
    // ⚠️ ESTA PRUEBA AFIRMABA LO CONTRARIO EN CUT-2, y su cambio es el hito, no una regresión.
    // CUT-2 callaba porque no existía forma de BORRAR una propiedad en HubSpot y «Pendiente de
    // actualizar» sobre una operación inejecutable habría sido una promesa muerta. CUT-3A
    // construye esa operación, y desde entonces el silencio es la afirmación falsa MÁS grave
    // del conjunto: SellUp borra el número y la ficha sigue diciendo `synced` mientras HubSpot
    // lo conserva y lo sigue sirviendo.
    const decision = markPhoneChange({
      contactState: state(),
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: null, mobile_phone: null },
    });

    assert.ok(decision.marked);
    assert.equal(decision.state.status, 'stale');
    assert.equal(decision.state.stale_reason, 'phone_removed');
    assert.equal(decision.state.stale_since, NOW);
  });

  it('20 · segundo cambio antes de enviar ⇒ idempotente, conserva el `stale_since` original', () => {
    // Reelegir el principal de la colección oficial reproyecta el escalar. Si el saliente
    // vuelve a cambiar antes de que nadie pulse, sigue habiendo UN pendiente, y lleva
    // pendiente desde el PRIMERO: HubSpot no se puso al día por el camino.
    const alreadyStale = state({
      status: 'stale',
      stale_since: STALE_AT,
      stale_reason: 'phone_changed',
      // CUT-3C — el pendiente previo lo causó la misma edición manual que este segundo cambio,
      // así que el par (razón, causante) coincide y sigue sin haber nada que escribir. Un
      // causante DISTINTO sí produciría una escritura, y eso es correcto: cambiaría a quién se
      // atribuye el pendiente. Ese caso tiene su propia prueba en la suite de CUT-3C.
      stale_source: 'user_edit',
    });

    const second = markPhoneChange({
      contactState: alreadyStale,
      previous: { phone: NEW_PHONE, mobile_phone: null },
      next: { phone: '+57 1 555 7777', mobile_phone: null },
    });
    assert.ok(!second.marked);
    assert.equal(second.reason, 'already_pending');

    // El estado guardado sigue siendo el mismo pendiente, con su hora original.
    const persisted = readHubSpotSyncState(metadataWith(alreadyStale));
    assert.equal(persisted?.stale_since, STALE_AT);
    assert.equal(hasPendingHubSpotPhoneChange(persisted), true);
  });

  it('20b · aplicar la autoridad dos veces con el MISMO cambio no mueve nada', () => {
    const first = markPhoneChange({
      contactState: state(),
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
    });
    assert.ok(first.marked);

    const again = markContactHubSpotSyncStaleForPhoneChange({
      metadata: first.metadata,
      hubspotContactId: HS_ID,
      previous: { phone: NEW_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
      nowIso: '2026-08-26T00:00:00.000Z',
      // CUT-3C — la edición manual del formulario.
      source: 'user_edit',
    });
    assert.ok(!again.marked);
    assert.equal(readHubSpotSyncState(first.metadata)?.stale_since, NOW);
  });

  it('marcar `stale` conserva el vínculo, la procedencia y la metadata ajena', () => {
    const decision = markPhoneChange({
      contactState: state(),
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
    });
    assert.ok(decision.marked);

    assert.equal(decision.state.hubspot_contact_id, HS_ID);
    // No fue un intento: no estampa `attempted_at` nuevo ni inventa un `method`.
    assert.equal(decision.state.attempted_at, SYNCED_AT);
    assert.equal(decision.state.method, 'manual');
    assert.equal(decision.metadata.source, 'contact_enrichment_candidate');
    assert.equal(decision.metadata.source_candidate_id, 'cand-1');
    const block = decision.metadata.hubspot_sync as Record<string, unknown>;
    assert.equal(block.synced_at, SYNCED_AT, 'la auditoría previa del 17A.4C sobrevive');
    assert.equal(block.mode, 'created');
  });
});

// ════════════════════════════════════════════════════════════════
// Reveal post-aprobación — el caso que motivó el corte
// ════════════════════════════════════════════════════════════════

describe('CUT-2 · reveal posterior a la aprobación', () => {
  it('18 · contacto ya sincronizado + reveal proyectado ⇒ stale, SIN llamar a HubSpot', () => {
    // El reveal proyecta el número sobre el contacto oficial. La proyección es local: marcar
    // pendiente no puede salir a la red (`fetch` está envenenado en esta suite).
    const decision = markPhoneChange({
      contactState: state(),
      previous: { phone: null, mobile_phone: null },
      next: { phone: '+57 310 444 5555', mobile_phone: null },
    });

    assert.ok(decision.marked);
    assert.equal(decision.state.status, 'stale');
    assert.equal(decision.state.stale_reason, 'phone_changed');
    assert.equal(decision.state.hubspot_contact_id, HS_ID);
  });

  it('19 · reveal ANTES del primer sync ⇒ no hay stale', () => {
    // Nunca se envió nada: no puede haber quedado desactualizado. La ficha sigue diciendo
    // «Nunca sincronizado», que es la verdad.
    const decision = markPhoneChange({
      contactState: state({
        status: 'never_attempted',
        method: null,
        attempted_at: null,
        hubspot_contact_id: null,
      }),
      hubspotContactId: null,
      previous: { phone: null, mobile_phone: null },
      next: { phone: '+57 310 444 5555', mobile_phone: null },
    });

    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'not_linked');
  });
});

// ════════════════════════════════════════════════════════════════
// El clic manual — cuatro desenlaces
// ════════════════════════════════════════════════════════════════

describe('CUT-2 · sincronización manual sobre un contacto vinculado', () => {
  const staleContact = (overrides: Partial<ContactForSync> = {}) =>
    makeContact({
      metadata: metadataWith(
        state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_changed' }),
      ),
      ...overrides,
    });

  it('7 · stale + clic ⇒ PATCH contra el id durable EXACTO', async () => {
    const { deps, spy } = makeDeps({ loadContact: async () => staleContact() });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    assert.equal(result.status, 'updated');
    assert.equal(spy.patches.length, 1);
    assert.equal(spy.patches[0].id, HS_ID);
    // Identidad = id durable. NO se busca por email ni se crea nada.
    assert.equal(spy.searches, 0, 'un PATCH no busca por email');
    assert.equal(spy.creates, 0, 'un PATCH no crea');
    assert.equal(spy.associations, 0, 'un PATCH no reintenta la asociación con la empresa');
  });

  it('8+10 · el PATCH lleva SÓLO `phone`', async () => {
    const { deps, spy } = makeDeps({ loadContact: async () => staleContact() });
    await runSyncContactToHubSpot('contact-1', deps);

    const keys = Object.keys(spy.patches[0].input);
    assert.deepEqual(keys, ['phone']);
    for (const forbidden of ['email', 'linkedin', 'linkedin_url', 'contact_phones', 'jobtitle']) {
      assert.equal(keys.includes(forbidden), false, `${forbidden} no puede viajar en el PATCH`);
    }
  });

  it('9 · el teléfono enviado es `mobile_phone ?? phone`', async () => {
    const { deps, spy } = makeDeps({
      loadContact: async () => staleContact({ phone: NEW_PHONE, mobile_phone: MOBILE }),
    });
    await runSyncContactToHubSpot('contact-1', deps);
    assert.equal(spy.patches[0].input.phone, MOBILE);

    const { deps: d2, spy: s2 } = makeDeps({
      loadContact: async () => staleContact({ phone: NEW_PHONE, mobile_phone: null }),
    });
    await runSyncContactToHubSpot('contact-1', d2);
    assert.equal(s2.patches[0].input.phone, NEW_PHONE);

    // La MISMA autoridad que usa el alta: si divergieran, se marcaría un cambio que no se envía.
    assert.equal(
      buildHubSpotContactProperties(
        makeContact({ phone: NEW_PHONE, mobile_phone: MOBILE }),
        'ana@empresa.com',
      ).phone,
      resolveOutboundHubSpotPhone({ phone: NEW_PHONE, mobile_phone: MOBILE }),
    );
  });

  it('11+12 · PATCH exitoso ⇒ synced y sin marcadores de pendiente', async () => {
    const { deps, spy } = makeDeps({ loadContact: async () => staleContact() });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    const written = lastWrittenState(spy);
    assert.equal(written.status, 'synced');
    assert.equal(written.stale_since, null);
    assert.equal(written.stale_reason, null);
    assert.equal(written.last_error, null);
    assert.equal(written.method, 'manual');
    assert.equal(written.attempted_at, NOW);
    // El vínculo se conserva y la columna NO se reescribe: ya estaba bien en la fila.
    assert.equal(written.hubspot_contact_id, HS_ID);
    assert.equal(spy.writes[0].patch.hubspot_contact_id, null);
  });

  it('13+14 · PATCH fallido ⇒ failed, conservando razón y hora del pendiente', async () => {
    const { deps, spy } = makeDeps({
      loadContact: async () => staleContact(),
      updateHubSpotContact: async () => ({ error: 'HUBSPOT_UPDATE_HTTP_400' }),
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.errorCode, 'HUBSPOT_ERROR');

    const written = lastWrittenState(spy);
    assert.equal(written.status, 'failed');
    assert.equal(written.last_error, HUBSPOT_SYNC_ERROR_CODES.hubspotUpdateFailed);
    // Los dos hechos conviven: el intento falló Y el teléfono sigue sin viajar.
    assert.equal(written.stale_reason, 'phone_changed');
    assert.equal(written.stale_since, STALE_AT, 'la hora del pendiente NO se re-sella');
    assert.equal(hasPendingHubSpotPhoneChange(written), true);
  });

  it('14b · tras el fallo, el siguiente clic vuelve a intentar el PATCH', async () => {
    const failedWithPending = makeContact({
      metadata: metadataWith(
        state({
          status: 'failed',
          last_error: HUBSPOT_SYNC_ERROR_CODES.hubspotUpdateFailed,
          attempted_at: NOW,
          stale_since: STALE_AT,
          stale_reason: 'phone_changed',
        }),
      ),
    });
    const { deps, spy } = makeDeps({ loadContact: async () => failedWithPending });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    assert.equal(result.status, 'updated');
    assert.equal(spy.patches.length, 1);
    assert.equal(lastWrittenState(spy).status, 'synced');
  });

  it('15 · synced sin nada pendiente + clic ⇒ CERO PATCH y CERO escrituras', async () => {
    const { deps, spy } = makeDeps({ loadContact: async () => makeContact() });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    assert.equal(result.status, 'already_synced');
    assert.equal(spy.patches.length, 0);
    assert.equal(spy.writes.length, 0, 'no se pisa el `attempted_at` del intento real');
    assert.equal(spy.creates, 0);
    assert.equal(spy.searches, 0);
  });

  it('16 · vinculado sin estado durable ⇒ reparación, NUNCA PATCH', async () => {
    const legacy = makeContact({ metadata: { source: 'hubspot_import' } });
    const { deps, spy } = makeDeps({ loadContact: async () => legacy });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    assert.equal(result.status, 'already_synced');
    assert.equal(spy.patches.length, 0, 'sin evidencia de pendiente no se envía nada');
    // Sí se repara el estado: el vínculo existe y ahora el bloque lo dice.
    const written = lastWrittenState(spy);
    assert.equal(written.status, 'synced');
    assert.equal(written.hubspot_contact_id, HS_ID);
    // Reparar no inventa un intento que nadie hizo.
    assert.equal(written.attempted_at, null);
    assert.equal(written.method, null);
  });

  it('CUT-3A · un pendiente sin teléfono que enviar ES un borrado, y se envía', async () => {
    // ⚠️ EN CUT-2 esto devolvía `MISSING_PHONE` y no enviaba nada, porque enviar un vacío
    // habría borrado en HubSpot un número que aquel corte no sabía gestionar. CUT-3A sí lo
    // sabe: el borrado es la operación, no el obstáculo.
    const { deps, spy } = makeDeps({
      loadContact: async () => staleContact({ phone: null, mobile_phone: null }),
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    assert.equal(result.status, 'updated');
    assert.equal(spy.patches.length, 1);
    // El dominio manda `null`; la cadena vacía del cable la pone UNA sola función.
    assert.deepEqual(spy.patches[0].input, { phone: null });
    // Y el mensaje distingue borrar de actualizar: decir «actualizado» sobre un borrado le
    // contaría a la persona que envió un número cuando lo que hizo fue quitarlo.
    assert.equal(result.message, SYNC_MESSAGES.cleared);
  });

  it('HubSpot desconectado no ensucia el estado del contacto ni pierde el pendiente', async () => {
    const { deps, spy } = makeDeps({
      loadContact: async () => staleContact(),
      checkConnection: async () => ({ connected: false, canWriteContacts: false }),
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(!result.ok);
    assert.equal(result.errorCode, 'HUBSPOT_NOT_CONNECTED');
    assert.equal(spy.patches.length, 0);
    assert.equal(spy.writes.length, 0, 'una condición del workspace no es culpa del contacto');
  });

  it('un PATCH que entra pero no se puede anotar deja el pendiente puesto', async () => {
    const { deps, spy } = makeDeps({
      loadContact: async () => staleContact(),
      persistSync: async (id, patch) => {
        spy.writes.push({ id, patch });
        // Sólo falla la escritura del éxito; la del registro del fallo sí entra.
        return spy.writes.length === 1 ? { error: 'db down' } : {};
      },
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(!result.ok);
    assert.equal(result.errorCode, 'UNKNOWN_ERROR');
    const written = lastWrittenState(spy);
    assert.equal(written.status, 'failed');
    assert.equal(written.last_error, HUBSPOT_SYNC_ERROR_CODES.localStateFailed);
    assert.equal(written.stale_reason, 'phone_changed', 'el siguiente clic reenvía y converge');
  });

  it('la auditoría de un PATCH no afirma nada sobre la empresa', async () => {
    const { deps, spy } = makeDeps({ loadContact: async () => staleContact() });
    await runSyncContactToHubSpot('contact-1', deps);

    assert.equal(spy.audits.length, 1);
    assert.equal(spy.audits[0].mode, 'updated');
    assert.equal(spy.audits[0].hubspotCompanyId, null);
    assert.equal(spy.audits[0].companyAssociation, null);
  });
});

// ════════════════════════════════════════════════════════════════
// No regresión del alta (CUT-1)
// ════════════════════════════════════════════════════════════════

describe('CUT-2 · el alta del 17A.4C sigue intacta', () => {
  it('17 · sin vínculo ⇒ se crea y se vincula, sin PATCH', async () => {
    const unlinked = makeContact({
      hubspot_contact_id: null,
      metadata: metadataWith(
        state({
          status: 'never_attempted',
          method: null,
          attempted_at: null,
          hubspot_contact_id: null,
        }),
      ),
    });
    const { deps, spy } = makeDeps({
      loadContact: async () => unlinked,
      updateHubSpotContact: async () => {
        throw new Error('PATCH_FORBIDDEN_IN_CREATE_FLOW');
      },
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    assert.equal(result.status, 'created');
    assert.equal(spy.creates, 1);
    assert.equal(spy.associations, 1);
    assert.equal(spy.patches.length, 0);

    const written = lastWrittenState(spy);
    assert.equal(written.status, 'synced');
    assert.equal(written.stale_since, null);
    assert.equal(written.stale_reason, null);
  });

  it('17b · vincular un contacto existente por email tampoco hace PATCH', async () => {
    const unlinked = makeContact({
      hubspot_contact_id: null,
      metadata: metadataWith(state({ status: 'never_attempted', method: null, attempted_at: null })),
    });
    const { deps, spy } = makeDeps({
      loadContact: async () => unlinked,
      findHubSpotContactByEmail: async () => {
        spy.searches += 1;
        return { id: 'hs-existing-3' };
      },
      updateHubSpotContact: async () => {
        throw new Error('PATCH_FORBIDDEN_IN_LINK_FLOW');
      },
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    assert.equal(result.status, 'linked_existing');
    assert.equal(spy.patches.length, 0);
    assert.equal(spy.creates, 0);
  });
});

// ════════════════════════════════════════════════════════════════
// Privacidad y forma del contrato
// ════════════════════════════════════════════════════════════════

describe('CUT-2 · privacidad y vocabulario', () => {
  it('21 · el error del proveedor NO se persiste: sólo un código mecánico', async () => {
    const PII = 'Invalid phone "+57 300 111 2222" for ana@empresa.com';
    const { deps, spy } = makeDeps({
      loadContact: async () =>
        makeContact({
          metadata: metadataWith(
            state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_changed' }),
          ),
        }),
      updateHubSpotContact: async () => ({ error: PII }),
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(!result.ok);
    const serialized = JSON.stringify(spy.writes);
    for (const leak of ['+57 300 111 2222', 'ana@empresa.com', 'Invalid phone']) {
      assert.equal(serialized.includes(leak), false, `${leak} no puede quedar guardado`);
    }
    assert.equal(lastWrittenState(spy).last_error, HUBSPOT_SYNC_ERROR_CODES.hubspotUpdateFailed);
    // Tampoco viaja a la UI.
    assert.equal(result.message.includes('ana@empresa.com'), false);
  });

  it('`stale` es parte del vocabulario cerrado y tiene etiqueta propia', () => {
    assert.equal(HUBSPOT_SYNC_STATUS_LABELS.stale, 'Pendiente de actualizar');
    // Una razón fuera del vocabulario no se disfraza de conocida.
    const read = readHubSpotSyncState({
      hubspot_sync: { status: 'stale', stale_reason: 'email_changed', stale_since: NOW },
    });
    assert.equal(read?.status, 'stale');
    assert.equal(read?.stale_reason, null);
  });

  it('un intento BLOQUEADO tampoco borra la prueba de que hay algo pendiente', () => {
    const existing = metadataWith(
      state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_changed' }),
    );
    const written = readHubSpotSyncState(
      buildFailedSyncMetadata({
        existing,
        status: 'blocked_no_email',
        lastError: null,
        nowIso: NOW,
        // CUT-3B — este camino sigue siendo el MANUAL. Se declara, no se hereda.
        method: 'manual',
      }),
    );

    assert.equal(written?.status, 'blocked_no_email');
    assert.equal(written?.stale_since, STALE_AT);
    assert.equal(written?.stale_reason, 'phone_changed');
  });

  it('el constructor del PATCH exitoso no reescribe `mode` ni la asociación', () => {
    const metadata = buildUpdatedSyncMetadata({
      existing: metadataWith(
        state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_changed' }),
      ),
      hubspotContactId: HS_ID,
      actorId: 'user-1',
      nowIso: NOW,
      // CUT-3B — este camino sigue siendo el MANUAL. Se declara, no se hereda.
      method: 'manual',
    });
    const block = metadata.hubspot_sync as Record<string, unknown>;

    assert.equal(block.mode, 'created', 'el PATCH no cambia cómo se obtuvo el vínculo');
    assert.equal(block.synced_at, NOW);
    assert.equal(block.synced_by, 'user-1');
    assert.equal(block.stale_since, null);
    assert.equal(block.stale_reason, null);
  });

  it('22 · el cliente HTTP hace PATCH sobre el id y manda una sola propiedad', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/server/integrations/hubspot-contact-sync.ts'),
      'utf-8',
    );
    const at = src.indexOf('export async function updateHubSpotContact');
    assert.ok(at > 0, 'falta el cliente de actualización');
    const fn = src.slice(at, src.indexOf('\n}', src.indexOf('catch (err)', at)));

    assert.match(fn, /method: 'PATCH'/);
    assert.match(fn, /crm\/v3\/objects\/contacts\/\$\{encodeURIComponent\(hubspotContactId\)\}/);
    // CUT-3A: el cuerpo lo construye LA función canónica, no este archivo. Que el adaptador
    // no pueda escribir su propia representación del borrado es justo lo que impide que
    // existan dos.
    assert.match(fn, /properties: buildHubSpotContactUpdateProperties\(input\)/);
    assert.equal(/phone: input\.phone/.test(fn), false, 'sin una segunda representación');
    // Ni búsqueda por email, ni creación, ni asociación: identidad = id durable.
    for (const forbidden of ['/search', "method: 'POST'", 'associations']) {
      assert.equal(fn.includes(forbidden), false, `${forbidden} no puede existir en el PATCH`);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// Los escritores del teléfono oficial — UNA sola autoridad
// ════════════════════════════════════════════════════════════════

/** Quita comentarios para que «nombrarlo» no se confunda con «citarlo». */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf-8');
}

describe('CUT-2 · la edición manual marca pendiente dentro de su propia escritura', () => {
  const actions = stripComments(readSource('src/modules/contacts/actions.ts'));
  const at = actions.indexOf('export async function updateContact');
  const updateFn = actions.slice(at, actions.indexOf('\nexport ', at + 1));

  it('`updateContact` delega en la autoridad central, no reimplementa la regla', () => {
    assert.ok(at > 0, 'falta updateContact');
    assert.match(updateFn, /markContactHubSpotSyncStaleForPhoneChange\(/);
    // La regla no se copia: aquí no puede aparecer el vocabulario del estado.
    for (const forbidden of ["'stale'", 'stale_since', "'phone_changed'"]) {
      assert.equal(
        updateFn.includes(forbidden),
        false,
        `${forbidden} pertenece a la autoridad, no a este escritor`,
      );
    }
  });

  it('la marca viaja en el MISMO update: no hay una segunda escritura', () => {
    const markAt = updateFn.indexOf('markContactHubSpotSyncStaleForPhoneChange');
    const writeAt = updateFn.indexOf(".from('contacts').update(payload)");
    assert.ok(writeAt > markAt, 'la decisión debe tomarse ANTES del UPDATE');
    assert.match(updateFn, /if \(staleDecision\.marked\) payload\.metadata = staleDecision\.metadata;/);
    // Una sola escritura de la fila editada. (El reseteo de `is_primary` toca OTRAS filas.)
    const payloadWrites = updateFn.match(/\.update\(payload\)/g) ?? [];
    assert.equal(payloadWrites.length, 1);
  });

  it('marcar pendiente NO llama a HubSpot: en CUT-2 no hay autosync', () => {
    for (const forbidden of [
      'syncContactToHubSpot',
      'updateHubSpotContact',
      'createHubSpotContact',
      'fetch(',
    ]) {
      assert.equal(updateFn.includes(forbidden), false, `${forbidden} sería autosync`);
    }
  });

  it('sólo el módulo de estado produce `stale`: ningún escritor lo escribe por su cuenta', () => {
    const producers = [
      'src/modules/contacts/actions.ts',
      'src/modules/contacts/contact-hubspot-sync-core.ts',
      'src/modules/contact-enrichment/candidate-review-core.ts',
    ];
    for (const rel of producers) {
      const code = stripComments(readSource(rel));
      assert.equal(
        /status:\s*'stale'/.test(code),
        false,
        `${rel} no puede construir el estado stale a mano`,
      );
    }
    // Y la autoridad sí lo hace, una sola vez.
    const authority = stripComments(readSource('src/modules/contacts/contact-hubspot-sync-state.ts'));
    assert.equal((authority.match(/status:\s*'stale'/g) ?? []).length, 1);
  });
});
