/**
 * AGENT2-CONTACT-HUBSPOT-STALE-COMPLETENESS-CUT3A — el lado TypeScript.
 *
 * Lo que se demuestra aquí:
 *  - BORRAR el teléfono saliente es una sincronización real: se marca (`phone_removed`), se
 *    envía como un PATCH que LIMPIA la propiedad, y tiene UNA sola representación en el cable;
 *  - la RAZÓN se redereiva del saliente actual mientras el `stale_since` y el `status` se
 *    conservan, porque la razón instruye al PATCH en vez de recordar cómo empezó;
 *  - la supresión de privacidad marca DENTRO de su propio UPDATE y NO llama a nadie;
 *  - TODOS los escritores del teléfono oficial están clasificados por un audit estático:
 *    ninguno queda sin cablear y sin explicación.
 *
 * La atomicidad del merge y de la erasure vive en la suite hermana `…-postgres-cut3a`, contra
 * PostgreSQL real: es una propiedad de las transacciones, no del código.
 *
 * Sin red, sin DB, sin auth. `fetch` global queda envenenado.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  runSyncContactToHubSpot,
  buildHubSpotContactUpdateProperties,
  buildUpdatedSyncMetadata,
  SYNC_MESSAGES,
  type ContactForSync,
  type ContactHubSpotSyncPatch,
  type HubSpotContactUpdateInput,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';
import {
  HUBSPOT_SYNC_ERROR_CODES,
  HUBSPOT_SYNC_STALE_REASONS,
  hasPendingHubSpotPhoneChange,
  markContactHubSpotSyncStaleForPhoneChange,
  readHubSpotSyncState,
  resolveHubSpotStaleReasonForOutbound,
  writeHubSpotSyncState,
  type HubSpotSyncState,
} from '../contact-hubspot-sync-state';
import {
  buildContactPhoneSuppressionPatch,
  buildPhoneCacheSuppressionPlan,
  type SuppressibleContact,
} from '@/modules/contact-enrichment/phone-cache-suppression-core';

// ── Prueba 17 — ninguna red real ────────────────────────────────

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

function metadataWith(s: HubSpotSyncState): Record<string, unknown> {
  return writeHubSpotSyncState(
    { source: 'contact_enrichment_candidate', source_candidate_id: 'cand-1' },
    s,
    { synced_at: SYNCED_AT, mode: 'created', company_association: 'associated' },
  );
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
    metadata: metadataWith(
      state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_changed' }),
    ),
    ...overrides,
  };
}

interface Spy {
  patches: Array<{ id: string; input: HubSpotContactUpdateInput }>;
  writes: Array<{ id: string; patch: ContactHubSpotSyncPatch }>;
  creates: number;
  searches: number;
}

function makeDeps(overrides: Partial<SyncContactDeps> = {}): { deps: SyncContactDeps; spy: Spy } {
  const spy: Spy = { patches: [], writes: [], creates: 0, searches: 0 };
  const deps: SyncContactDeps = {
    actorId: 'user-1',
    nowIso: NOW,
    // CUT-3B — este camino sigue siendo el MANUAL. Se declara, no se hereda.
    method: 'manual',
    loadContact: async () => makeContact(),
    loadAccount: async () => ({ id: 'account-1', name: 'X', hubspot_company_id: 'hs-co' }),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => {
      spy.searches += 1;
      return null;
    },
    createHubSpotContact: async () => {
      spy.creates += 1;
      return { id: 'hs-new' };
    },
    updateHubSpotContact: async (id, input) => {
      spy.patches.push({ id, input });
      return { ok: true };
    },
    associateContactWithCompany: async () => ({ ok: true }),
    persistSync: async (id, patch) => {
      spy.writes.push({ id, patch });
      return {};
    },
    ...overrides,
  };
  return { deps, spy };
}

function lastState(spy: Spy): HubSpotSyncState {
  assert.ok(spy.writes.length > 0, 'se esperaba una escritura de estado');
  const read = readHubSpotSyncState(spy.writes[spy.writes.length - 1].patch.metadata);
  assert.ok(read, 'la última escritura no dejó un estado legible');
  return read;
}

// ════════════════════════════════════════════════════════════════
// 9 · El saliente que se vacía
// ════════════════════════════════════════════════════════════════

describe('9. VALOR → NULL es una sincronización real', () => {
  it('un contacto `synced` que pierde su saliente queda `stale` con `phone_removed`', () => {
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(state()),
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: null, mobile_phone: null },
      nowIso: NOW,
      // CUT-3C — la edición manual del formulario.
      source: 'user_edit',
    });

    assert.ok(decision.marked);
    assert.equal(decision.state.status, 'stale');
    assert.equal(decision.state.stale_reason, HUBSPOT_SYNC_STALE_REASONS.phoneRemoved);
    assert.equal(decision.state.stale_since, NOW);
    // El vínculo NO se toca: se retiró un dato, no se desvinculó el contacto.
    assert.equal(decision.state.hubspot_contact_id, HS_ID);
  });

  it('8. vaciar el móvil dejando al descubierto un fijo DISTINTO ⇒ `phone_changed`', () => {
    // El saliente era el móvil y ahora es el fijo: hay algo que enviar, y ese algo es un
    // NÚMERO. Tratarlo como borrado destruiría en HubSpot un teléfono que SellUp sí tiene.
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(state()),
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: MOBILE },
      next: { phone: OLD_PHONE, mobile_phone: null },
      nowIso: NOW,
      // CUT-3C — la edición manual del formulario.
      source: 'user_edit',
    });

    assert.ok(decision.marked);
    assert.equal(decision.state.stale_reason, 'phone_changed');
  });

  it('vaciar el móvil con el fijo presente SÍ marca ahora: los dos campos viajan por separado', () => {
    // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC: antes esto no marcaba porque el fijo (igual
    // en los dos lados) "tapaba" el móvil en el valor colapsado que se mandaba a un único campo
    // de HubSpot. Ahora los dos campos viajan por separado, así que borrar `mobile_phone`
    // SIEMPRE es un cambio real, tape o no tape al fijo.
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(state()),
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: OLD_PHONE },
      next: { phone: OLD_PHONE, mobile_phone: null },
      nowIso: NOW,
      source: 'user_edit',
    });

    assert.ok(decision.marked);
    assert.equal(decision.state.stale_reason, 'phone_changed');
  });

  it('`phone_removed` cuenta como pendiente para el ejecutor', () => {
    // Si no contara, el único caso en el que HubSpot conserva un dato que SellUp ya no tiene
    // sería invisible para el clic que puede corregirlo.
    assert.equal(
      hasPendingHubSpotPhoneChange(
        state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_removed' }),
      ),
      true,
    );
    assert.equal(
      hasPendingHubSpotPhoneChange(
        state({ status: 'failed', stale_since: STALE_AT, stale_reason: 'phone_removed' }),
      ),
      true,
    );
  });
});

// ════════════════════════════════════════════════════════════════
// La razón se redereiva; la hora y el estado no
// ════════════════════════════════════════════════════════════════

describe('la razón describe la operación PENDIENTE, no la que la originó', () => {
  it('la deriva es de UNA función y nadie elige la razón a mano', () => {
    assert.equal(resolveHubSpotStaleReasonForOutbound(null), 'phone_removed');
    assert.equal(resolveHubSpotStaleReasonForOutbound(OLD_PHONE), 'phone_changed');
  });

  it('3. un `phone_changed` pendiente que se vacía pasa a `phone_removed` y CONSERVA la hora', () => {
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(
        state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_changed' }),
      ),
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: null, mobile_phone: null },
      nowIso: NOW,
      // CUT-3C — la edición manual del formulario.
      source: 'user_edit',
    });

    assert.ok(decision.marked);
    assert.equal(decision.state.stale_reason, 'phone_removed');
    // Desde CUÁNDO HubSpot está desactualizado no lo pone al día un segundo cambio.
    assert.equal(decision.state.stale_since, STALE_AT);
    assert.equal(decision.state.status, 'stale');
  });

  it('4. un FALLO con `phone_removed` que recupera número no se degrada a `stale`', () => {
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(
        state({
          status: 'failed',
          last_error: HUBSPOT_SYNC_ERROR_CODES.hubspotUpdateFailed,
          stale_since: STALE_AT,
          stale_reason: 'phone_removed',
        }),
      ),
      hubspotContactId: HS_ID,
      previous: { phone: null, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
      nowIso: NOW,
      // CUT-3C — la edición manual del formulario.
      source: 'user_edit',
    });

    assert.ok(decision.marked);
    // «El último intento falló» y «queda algo por enviar» son dos hechos distintos.
    assert.equal(decision.state.status, 'failed');
    assert.equal(decision.state.last_error, HUBSPOT_SYNC_ERROR_CODES.hubspotUpdateFailed);
    assert.equal(decision.state.stale_since, STALE_AT);
    // Pero lo que hay que ENVIAR cambió, y la razón lo dice.
    assert.equal(decision.state.stale_reason, 'phone_changed');
  });

  it('cuando la razón ya es la correcta no se escribe nada', () => {
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(
        state({
          status: 'stale',
          stale_since: STALE_AT,
          stale_reason: 'phone_changed',
          // CUT-3C — el pendiente previo lleva YA el causante que este cambio vuelve a
          // afirmar. Sin él el par (razón, causante) diferiría y sí habría algo que escribir
          // —la adquisición de procedencia—, que es un caso distinto y tiene su propia prueba
          // en la suite de CUT-3C. Lo que ESTA prueba defiende sigue intacto: cuando no queda
          // ni un campo por cambiar, no se genera una escritura.
          stale_source: 'user_edit',
        }),
      ),
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
      nowIso: NOW,
      // CUT-3C — la edición manual del formulario.
      source: 'user_edit',
    });

    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'already_pending');
  });

  it('el vocabulario está CERRADO: nada fuera de él sobrevive a una lectura', () => {
    for (const bad of ['email_changed', 'phone_deleted', 'PHONE_REMOVED', '', 42, null]) {
      const read = readHubSpotSyncState({
        hubspot_sync: { status: 'stale', stale_reason: bad, stale_since: NOW },
      });
      assert.equal(read?.stale_reason, null, `${String(bad)} no puede leerse como razón`);
    }
    for (const good of ['phone_changed', 'phone_removed']) {
      const read = readHubSpotSyncState({
        hubspot_sync: { status: 'stale', stale_reason: good, stale_since: NOW },
      });
      assert.equal(read?.stale_reason, good);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 10-12 · El PATCH que BORRA
// ════════════════════════════════════════════════════════════════

describe('10. el cuerpo EXACTO del PATCH', () => {
  it('un saliente con valor manda ese valor', () => {
    assert.deepEqual(
      buildHubSpotContactUpdateProperties({ phone: OLD_PHONE, mobilePhone: null }),
      { phone: OLD_PHONE, mobilephone: '' },
    );
  });

  it('un saliente NULO manda la CADENA VACÍA, que es como HubSpot borra una propiedad', () => {
    assert.deepEqual(buildHubSpotContactUpdateProperties({ phone: null, mobilePhone: null }), {
      phone: '',
      mobilephone: '',
    });
  });

  it('borrar NO se representa OMITIENDO la propiedad', () => {
    // Omitirla la deja como estaba: sería un no-op silencioso y el contacto volvería a
    // `synced` sobre un número que HubSpot conserva.
    const props = buildHubSpotContactUpdateProperties({ phone: null, mobilePhone: null });
    assert.equal(Object.hasOwn(props, 'phone'), true);
    // AGENT2A extiende el cuerpo con `mobilephone`: ya no es una sola propiedad, son las dos
    // que el contrato declara — ninguna extra, ninguna de menos.
    assert.equal(Object.keys(props).length, 2, 'phone y mobilephone, ni una más ni una menos');
  });

  it('hay UNA sola representación del borrado en todo el árbol', () => {
    const adapter = readFileSync(
      join(process.cwd(), 'src/server/integrations/hubspot-contact-sync.ts'),
      'utf-8',
    );
    const core = readFileSync(
      join(process.cwd(), 'src/modules/contacts/contact-hubspot-sync-core.ts'),
      'utf-8',
    );
    // El adaptador NO construye el objeto: lo pide.
    assert.match(adapter, /properties: buildHubSpotContactUpdateProperties\(input\)/);
    // Y `?? ''` aparece exactamente una vez, en la función canónica.
    const occurrences = (core.match(/input\.phone \?\? ''/g) ?? []).length;
    assert.equal(occurrences, 1, 'la traducción a cadena vacía vive en un solo sitio');
    assert.equal(/\?\? ''/.test(adapter), false, 'el adaptador no puede tener su propia copia');
  });
});

describe('10-12. el clic manual sobre un pendiente de BORRADO', () => {
  const removedContact = (over: Partial<ContactForSync> = {}) =>
    makeContact({
      phone: null,
      mobile_phone: null,
      metadata: metadataWith(
        state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_removed' }),
      ),
      ...over,
    });

  it('10. envía un PATCH de LIMPIEZA contra el id durable, y nada más', async () => {
    const { deps, spy } = makeDeps({ loadContact: async () => removedContact() });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(result.ok);
    assert.equal(result.status, 'updated');
    assert.equal(spy.patches.length, 1);
    assert.equal(spy.patches[0].id, HS_ID);
    assert.deepEqual(spy.patches[0].input, { phone: null });
    // Ni búsqueda por email ni creación: la identidad es el id durable.
    assert.equal(spy.searches, 0);
    assert.equal(spy.creates, 0);
    assert.equal(result.message, SYNC_MESSAGES.cleared);
  });

  it('11. si el PATCH entra ⇒ `synced` y los marcadores se LIMPIAN', async () => {
    const { deps, spy } = makeDeps({ loadContact: async () => removedContact() });
    await runSyncContactToHubSpot('contact-1', deps);

    const written = lastState(spy);
    assert.equal(written.status, 'synced');
    assert.equal(written.stale_since, null);
    assert.equal(written.stale_reason, null);
    assert.equal(written.last_error, null);
    assert.equal(written.hubspot_contact_id, HS_ID);
    // El vínculo no se reescribe en la columna: el PATCH no lo cambió.
    assert.equal(spy.writes[0].patch.hubspot_contact_id, null);
  });

  it('12. si el PATCH falla ⇒ `failed` y `phone_removed` SOBREVIVE', async () => {
    const { deps, spy } = makeDeps({
      loadContact: async () => removedContact(),
      updateHubSpotContact: async () => ({ error: 'HUBSPOT_UPDATE_HTTP_500' }),
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(!result.ok);
    assert.equal(result.errorCode, 'HUBSPOT_ERROR');

    const written = lastState(spy);
    assert.equal(written.status, 'failed');
    assert.equal(written.last_error, HUBSPOT_SYNC_ERROR_CODES.hubspotUpdateFailed);
    // Sin esto, el borrado pendiente desaparecería con el intento fallido y nadie volvería a
    // saber que HubSpot conserva el número.
    assert.equal(written.stale_reason, 'phone_removed');
    assert.equal(written.stale_since, STALE_AT);
  });

  it('el PATCH lo decide la FILA de ahora, no la razón guardada', async () => {
    // Un `phone_removed` obsoleto sobre un contacto que YA tiene número volvería a borrar en
    // HubSpot un teléfono vigente. La fila manda.
    const { deps, spy } = makeDeps({
      loadContact: async () =>
        makeContact({
          phone: NEW_PHONE,
          metadata: metadataWith(
            state({ status: 'stale', stale_since: STALE_AT, stale_reason: 'phone_removed' }),
          ),
        }),
    });
    await runSyncContactToHubSpot('contact-1', deps);

    assert.deepEqual(spy.patches[0].input, { phone: NEW_PHONE });
  });

  it('un PATCH de borrado exitoso que no se puede anotar deja el pendiente puesto', async () => {
    const { deps, spy } = makeDeps({
      loadContact: async () => removedContact(),
      persistSync: async (id, patch) => {
        spy.writes.push({ id, patch });
        return spy.writes.length === 1 ? { error: 'db down' } : {};
      },
    });
    const result = await runSyncContactToHubSpot('contact-1', deps);

    assert.ok(!result.ok);
    // El siguiente clic vuelve a mandar el MISMO borrado —idempotente— y converge.
    const written = lastState(spy);
    assert.equal(written.status, 'failed');
    assert.equal(written.last_error, HUBSPOT_SYNC_ERROR_CODES.localStateFailed);
    assert.equal(written.stale_reason, 'phone_removed');
    assert.equal(written.stale_since, STALE_AT);
  });

  it('el constructor del PATCH exitoso limpia AMBAS razones por igual', () => {
    for (const reason of ['phone_changed', 'phone_removed'] as const) {
      const metadata = buildUpdatedSyncMetadata({
        existing: metadataWith(
          state({ status: 'stale', stale_since: STALE_AT, stale_reason: reason }),
        ),
        hubspotContactId: HS_ID,
        actorId: 'user-1',
        nowIso: NOW,
        // CUT-3B — este camino sigue siendo el MANUAL. Se declara, no se hereda.
        method: 'manual',
      });
      const read = readHubSpotSyncState(metadata);
      assert.equal(read?.status, 'synced');
      assert.equal(read?.stale_reason, null);
      assert.equal(read?.stale_since, null);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 13 · Privacidad
// ════════════════════════════════════════════════════════════════

describe('13. la supresión de privacidad marca, y NO exporta', () => {
  const linkedContact = (over: Partial<SuppressibleContact> = {}): SuppressibleContact => ({
    id: 'contact-1',
    accountId: 'account-1',
    sourceCandidateId: 'cand-1',
    mergedCandidateIds: null,
    phoneSource: 'apollo_reveal',
    phone: OLD_PHONE,
    mobilePhone: null,
    hubspotContactId: HS_ID,
    metadata: metadataWith(state()),
    ...over,
  });

  it('el patch de borrado lleva la metadata ya marcada: UNA sola escritura', () => {
    const patch = buildContactPhoneSuppressionPatch(linkedContact(), NOW);

    // Las siete columnas de 4O-E4 siguen exactamente como estaban.
    assert.equal(patch.phone, null);
    assert.equal(patch.phone_source, null);
    assert.equal(patch.phone_processing_basis, null);
    // Y el estado viaja DENTRO del mismo objeto, no en un segundo `.update(...)`.
    const read = readHubSpotSyncState(patch.metadata);
    assert.equal(read?.status, 'stale');
    assert.equal(read?.stale_reason, 'phone_removed');
    assert.equal(read?.stale_since, NOW);
  });

  it('`mobile_phone` sigue FUERA del patch, pero borrar `phone` SÍ marca ahora (4O-E4.1 + AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)', () => {
    const patch = buildContactPhoneSuppressionPatch(
      linkedContact({ mobilePhone: MOBILE }),
      NOW,
    );
    assert.equal(Object.hasOwn(patch, 'mobile_phone'), false);
    // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC: los dos campos viajan por separado ahora, así
    // que borrar `phone` es un cambio real aunque el móvil siga presente y sin tocar. La razón
    // sigue siendo `phone_changed` (no `phone_removed`): el saliente colapsado —el que decide
    // QUÉ enviar— sigue siendo el móvil, que no desapareció.
    const read = readHubSpotSyncState(patch.metadata);
    assert.equal(read?.status, 'stale');
    assert.equal(read?.stale_reason, 'phone_changed');
    assert.equal(read?.stale_since, NOW);
  });

  it('sin vínculo HubSpot no se marca nada', () => {
    const patch = buildContactPhoneSuppressionPatch(
      linkedContact({ hubspotContactId: null }),
      NOW,
    );
    assert.equal(patch.metadata, undefined);
  });

  it('un contacto que nunca estuvo `synced` no queda desactualizado', () => {
    const patch = buildContactPhoneSuppressionPatch(
      linkedContact({ metadata: metadataWith(state({ status: 'never_attempted' })) }),
      NOW,
    );
    assert.equal(patch.metadata, undefined);
  });

  it('el plan completo entrega el patch marcado, y nunca deja un `synced` falso', () => {
    const planned = buildPhoneCacheSuppressionPlan(
      {
        providerPersonId: '5f1a2b3c4d5e6f7a8b9c0d1e',
        accountId: 'account-1',
        countryCode: 'CO',
        // Vocabulario del PLAN (`PHONE_CACHE_SUPPRESSION_REASON_CODES`), que NO es el de la
        // colección canónica (114): el core es dueño de la traducción entre los dos.
        reason: 'dsar_erasure_request',
        actorUserId: 'user-1',
        actorRoleKey: 'admin',
      },
      {
        nowIso: NOW,
        candidates: [
          {
            id: 'cand-1',
            accountId: 'account-1',
            enrichmentRunId: 'run-1',
            enrichmentMetadata: {},
            createdContactId: 'contact-1',
            matchedContactId: null,
          },
        ],
        contacts: [linkedContact()],
      },
    );

    assert.ok(planned.ok);
    assert.equal(planned.plan.contactPatches.length, 1);
    const read = readHubSpotSyncState(planned.plan.contactPatches[0].patch.metadata);
    assert.equal(read?.status, 'stale');
    assert.equal(read?.stale_reason, 'phone_removed');
  });

  it('la supresión no importa NI NOMBRA ningún cliente de HubSpot', () => {
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const forbidden =
      /from\s+'[^']*(?:integrations\/hubspot|hubspot-contact-sync|hubspot-company)/;

    for (const rel of [
      'src/modules/contact-enrichment/phone-cache-suppression-core.ts',
      'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
    ]) {
      const src = strip(readFileSync(join(process.cwd(), rel), 'utf-8'));
      assert.equal(forbidden.test(src), false, `${rel} no puede importar un cliente HubSpot`);
      assert.equal(/api\.hubapi\.com/.test(src), false, `${rel} no puede nombrar la API`);
      assert.equal(/\bfetch\(/.test(src), false, `${rel} no puede salir a la red`);
    }
    // Guarda en negativo: la regla SÍ detecta un import real.
    assert.equal(
      forbidden.test("import { updateHubSpotContact } from '@/server/integrations/hubspot-contact-sync';"),
      true,
    );
  });
});
