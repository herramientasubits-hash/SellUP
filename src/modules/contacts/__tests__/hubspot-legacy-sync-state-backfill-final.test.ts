/**
 * AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL — el lado TypeScript.
 *
 * Lo que se demuestra aquí:
 *  - la LÍNEA BASE tiene una procedencia propia y LEGIBLE (`baseline_source`), con vocabulario
 *    cerrado, leída con la misma severidad que el resto del bloque;
 *  - un `synced` de línea base NO se cuenta como un `synced` observado: la ficha lo dice en
 *    neutro, «Vinculado a HubSpot», y el check verde queda para lo que sí consta;
 *  - un contacto VINCULADO y sin estado durable legible deja de pintarse verde: se le nombra la
 *    ignorancia, «Estado de sincronización desconocido». Esa era la deducción que la UI hacía
 *    en DOS sitios a la vez, y ahora la decide UNA autoridad;
 *  - la línea base SOBREVIVE a lo que no la desmiente (marcar `stale`, un intento fallido) y la
 *    BORRA lo que sí (un intento con respuesta de HubSpot);
 *  - después de la línea base, la autoridad de `stale` deja de callarse — y el portero del
 *    PATCH automático sigue sin dejar salir nada, porque el backfill no deja nada pendiente;
 *  - la migración es, por lectura de su propio texto, incapaz de crear contactos, inventar
 *    vínculos, escribir teléfonos o alcanzar la red.
 *
 * Las propiedades que dependen de FILAS —a quién toca, a quién no, y qué pasa la segunda vez—
 * viven en la suite hermana `…-postgres-final`, contra PostgreSQL real: son propiedades de una
 * migración de datos, no del código.
 *
 * Sin red, sin DB, sin auth. `fetch` global queda envenenado.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HUBSPOT_SYNC_BASELINE_AT_FIELD,
  HUBSPOT_SYNC_BASELINE_LABEL,
  HUBSPOT_SYNC_BASELINE_SOURCES,
  HUBSPOT_SYNC_BASELINE_SOURCE_FIELD,
  HUBSPOT_SYNC_NOT_LINKED_LABEL,
  HUBSPOT_SYNC_STATUS_LABELS,
  HUBSPOT_SYNC_UNKNOWN_STATE_LABEL,
  markContactHubSpotSyncStaleForPhoneChange,
  readHubSpotSyncBaselineSource,
  readHubSpotSyncState,
  resolveHubSpotSyncPresentation,
  writeHubSpotSyncState,
  type HubSpotSyncState,
} from '../contact-hubspot-sync-state';
import {
  buildFailedSyncMetadata,
  buildSyncMetadata,
  buildUpdatedSyncMetadata,
} from '../contact-hubspot-sync-core';
import { resolveContactAutoPhoneUpdateGate } from '../contact-hubspot-auto-phone-update-core';
import { buildContactTraceabilityViewModel } from '../contact-traceability';
import type { Contact } from '../types';

// ── Prueba 15 — ninguna red real ────────────────────────────────

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

const HS_ID = 'hs-contact-legado';
const NOW = '2026-08-26T18:00:00.000Z';
const BASELINE_AT = '2026-08-26T09:00:00.000Z';
const OLD_PHONE = '+15550000001';
const NEW_PHONE = '+15550000002';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
const MIGRATION = 'supabase/migrations/132_agent2_hubspot_legacy_sync_state_backfill.sql';

/** El bloque EXACTO que el backfill deja: los ocho del contrato + las dos anotaciones. */
function baselineBlock(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'synced',
    method: null,
    attempted_at: null,
    last_error: null,
    hubspot_contact_id: HS_ID,
    stale_since: null,
    stale_reason: null,
    stale_source: null,
    [HUBSPOT_SYNC_BASELINE_SOURCE_FIELD]: 'legacy_link_backfill',
    [HUBSPOT_SYNC_BASELINE_AT_FIELD]: BASELINE_AT,
    ...over,
  };
}

const metadataWith = (block: unknown): Record<string, unknown> => ({
  source: 'contact_enrichment_candidate',
  hubspot_sync: block,
});

function observedState(over: Partial<HubSpotSyncState> = {}): HubSpotSyncState {
  return {
    status: 'synced',
    method: 'manual',
    attempted_at: '2026-08-20T10:00:00.000Z',
    last_error: null,
    hubspot_contact_id: HS_ID,
    stale_since: null,
    stale_reason: null,
    stale_source: null,
    ...over,
  };
}

const contactLike = (over: Partial<Contact>): Contact =>
  ({
    id: 'contact-1',
    source: 'apollo',
    metadata: {},
    hubspot_contact_id: null,
    ...over,
  }) as Contact;

// ═══════════════════════════════════════════════════════════════
// 1 · la procedencia de la línea base, leída con severidad
// ═══════════════════════════════════════════════════════════════

describe('1. `baseline_source` es un vocabulario CERRADO, no texto libre', () => {
  it('lee el único miembro del vocabulario', () => {
    assert.equal(
      readHubSpotSyncBaselineSource(metadataWith(baselineBlock())),
      HUBSPOT_SYNC_BASELINE_SOURCES.legacyLinkBackfill,
    );
  });

  it('un valor fuera del vocabulario se lee como AUSENTE, no como su valor crudo', () => {
    // La misma severidad que `stale_source`, y por la misma razón: la UI decide el copy con
    // esto. Un `baseline_source: 'legacy'` mal escrito no puede hacerse pasar por nada.
    for (const raw of ['legacy', 'legacy_link_backfill ', '', 42, true, null, {}]) {
      assert.equal(
        readHubSpotSyncBaselineSource(
          metadataWith(baselineBlock({ [HUBSPOT_SYNC_BASELINE_SOURCE_FIELD]: raw })),
        ),
        null,
        `aceptó ${JSON.stringify(raw)}`,
      );
    }
  });

  it('un bloque ausente, escalar o array no tiene procedencia', () => {
    assert.equal(readHubSpotSyncBaselineSource(null), null);
    assert.equal(readHubSpotSyncBaselineSource({}), null);
    assert.equal(readHubSpotSyncBaselineSource(metadataWith('sincronizado')), null);
    assert.equal(readHubSpotSyncBaselineSource(metadataWith([baselineBlock()])), null);
  });

  it('el bloque de línea base SÍ es un estado durable legible', () => {
    const state = readHubSpotSyncState(metadataWith(baselineBlock()));
    assert.ok(state);
    assert.equal(state.status, 'synced');
    // Y no inventa nada: sin intento no hay método ni hora.
    assert.equal(state.method, null);
    assert.equal(state.attempted_at, null);
    assert.equal(state.hubspot_contact_id, HS_ID);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 · LO QUE LA FICHA DICE (prueba 21)
// ═══════════════════════════════════════════════════════════════

describe('2. la presentación: una sola autoridad, y el verde se gana', () => {
  it('vínculo SIN estado durable → NEUTRO y explícito, nunca «Sincronizado»', () => {
    const p = resolveHubSpotSyncPresentation({
      state: null,
      baselineSource: null,
      hubspotContactId: HS_ID,
    });
    assert.equal(p.label, HUBSPOT_SYNC_UNKNOWN_STATE_LABEL);
    assert.equal(p.tone, 'neutral');
    // El defecto que este corte cierra, dicho al revés para que un retroceso se vea.
    assert.notEqual(p.label, HUBSPOT_SYNC_STATUS_LABELS.synced);
    assert.notEqual(p.tone, 'synced');
  });

  it('sin vínculo y sin estado → «Sin sincronizar»', () => {
    for (const id of [null, undefined, '', '   ']) {
      const p = resolveHubSpotSyncPresentation({
        state: null,
        baselineSource: null,
        hubspotContactId: id,
      });
      assert.equal(p.label, HUBSPOT_SYNC_NOT_LINKED_LABEL);
      assert.equal(p.tone, 'neutral');
    }
  });

  it('`synced` de LÍNEA BASE → «Vinculado a HubSpot», en neutro', () => {
    const p = resolveHubSpotSyncPresentation({
      state: readHubSpotSyncState(metadataWith(baselineBlock())),
      baselineSource: readHubSpotSyncBaselineSource(metadataWith(baselineBlock())),
      hubspotContactId: HS_ID,
    });
    // El vínculo consta; la frescura de los campos NO. El copy no puede sugerir lo segundo.
    assert.equal(p.label, HUBSPOT_SYNC_BASELINE_LABEL);
    assert.equal(p.tone, 'neutral');
  });

  it('`synced` OBSERVADO → «Sincronizado», en verde. El verde sigue existiendo', () => {
    const p = resolveHubSpotSyncPresentation({
      state: observedState(),
      baselineSource: null,
      hubspotContactId: HS_ID,
    });
    assert.equal(p.label, HUBSPOT_SYNC_STATUS_LABELS.synced);
    assert.equal(p.tone, 'synced');
  });

  it('la línea base MANDA sobre el `method`: primero si consta, luego cómo', () => {
    const p = resolveHubSpotSyncPresentation({
      state: observedState({ method: 'auto' }),
      baselineSource: 'legacy_link_backfill',
      hubspotContactId: HS_ID,
    });
    assert.equal(p.label, HUBSPOT_SYNC_BASELINE_LABEL);
  });

  it('`auto` sin línea base sigue diciéndose distinto de `manual` (CUT-3B intacto)', () => {
    assert.equal(
      resolveHubSpotSyncPresentation({
        state: observedState({ method: 'auto' }),
        baselineSource: null,
        hubspotContactId: HS_ID,
      }).label,
      'Sincronizado automáticamente',
    );
  });

  it('`stale` y `failed` conservan su vocabulario y su tono (CUT-2 intacto)', () => {
    const stale = resolveHubSpotSyncPresentation({
      state: observedState({ status: 'stale', stale_reason: 'phone_changed', stale_since: NOW }),
      baselineSource: 'legacy_link_backfill',
      hubspotContactId: HS_ID,
    });
    assert.equal(stale.label, HUBSPOT_SYNC_STATUS_LABELS.stale);
    assert.equal(stale.tone, 'pending');

    const failedPending = resolveHubSpotSyncPresentation({
      state: observedState({ status: 'failed', stale_reason: 'phone_removed' }),
      baselineSource: null,
      hubspotContactId: HS_ID,
    });
    assert.equal(failedPending.label, 'Error al actualizar');
    assert.equal(failedPending.tone, 'error');

    const failedPlain = resolveHubSpotSyncPresentation({
      state: observedState({ status: 'failed' }),
      baselineSource: null,
      hubspotContactId: HS_ID,
    });
    assert.equal(failedPlain.label, HUBSPOT_SYNC_STATUS_LABELS.failed);
  });

  it('los seis estados del vocabulario producen etiqueta y tono, sin huecos', () => {
    for (const status of Object.keys(HUBSPOT_SYNC_STATUS_LABELS) as Array<
      keyof typeof HUBSPOT_SYNC_STATUS_LABELS
    >) {
      const p = resolveHubSpotSyncPresentation({
        state: observedState({ status }),
        baselineSource: null,
        hubspotContactId: HS_ID,
      });
      assert.equal(typeof p.label, 'string');
      assert.ok(p.label.length > 0, `${status} sin etiqueta`);
      assert.ok(['synced', 'neutral', 'pending', 'error'].includes(p.tone), `${status}: ${p.tone}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3 · las dos superficies que deducían, ya no deducen
// ═══════════════════════════════════════════════════════════════

describe('3. la UI ya no infiere «Sincronizado» del vínculo (prueba 21)', () => {
  it('el ViewModel de trazabilidad: vínculo sin estado → desconocido, no sincronizado', () => {
    const vm = buildContactTraceabilityViewModel(
      contactLike({ hubspot_contact_id: 'hs-999', metadata: {} }),
    );
    assert.equal(vm.hubspotSyncLabel, HUBSPOT_SYNC_UNKNOWN_STATE_LABEL);
    assert.equal(vm.hubspotSyncTone, 'neutral');
    // El id sigue visible: ocultarlo perdería la única pista del vínculo.
    assert.equal(vm.hubspotContactId, 'hs-999');
  });

  it('el ViewModel: línea base → «Vinculado a HubSpot», y el `mode` legado sobrevive', () => {
    const vm = buildContactTraceabilityViewModel(
      contactLike({
        hubspot_contact_id: HS_ID,
        metadata: metadataWith(baselineBlock({ mode: 'created' })),
      }),
    );
    assert.equal(vm.hubspotSyncLabel, HUBSPOT_SYNC_BASELINE_LABEL);
    assert.equal(vm.hubspotSyncTone, 'neutral');
    assert.equal(vm.hubspotMode, 'created');
  });

  it('el ViewModel: `synced` observado → verde', () => {
    const vm = buildContactTraceabilityViewModel(
      contactLike({
        hubspot_contact_id: HS_ID,
        metadata: writeHubSpotSyncState({}, observedState()),
      }),
    );
    assert.equal(vm.hubspotSyncTone, 'synced');
  });

  it('el drawer pide el copy a la autoridad y NO tiene un camino verde propio', () => {
    const sheet = read('src/components/contacts/contact-detail-sheet.tsx');
    // AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — el badge se MUDÓ a su propio módulo, sin `'use
    // client'`, para que la página de detalle legada (componente de SERVIDOR) pudiera dejar de
    // hardcodear «Sincronización no activa». La afirmación NO se relaja: se sigue exigiendo que
    // el copy lo pida la autoridad, sólo que se exige donde ahora vive, y se exige además que el
    // drawer consuma ESE badge y no uno propio.
    const badge = read('src/components/contacts/contact-hubspot-sync-badge.tsx');
    assert.match(badge, /resolveHubSpotSyncPresentation\(/);
    assert.match(badge, /readHubSpotSyncBaselineSource\(/);
    assert.match(sheet, /ContactHubSpotSyncBadge/);
    // Y el drawer no puede haberse quedado una copia: nombrar la autoridad de presentación por
    // su cuenta sería justo la segunda deducción que este contrato existe para impedir.
    assert.equal(
      /resolveHubSpotSyncPresentation\(/.test(sheet),
      false,
      'el drawer volvió a resolver la presentación por su cuenta',
    );
    // El trinquete: el badge ya no puede tener una rama que pinte verde por tener vínculo.
    assert.equal(
      /if \(contact\.hubspot_contact_id\) \{[\s\S]{0,400}?HUBSPOT_SYNC_STATUS_LABELS\.synced/.test(
        sheet,
      ),
      false,
      'el badge volvió a deducir «Sincronizado» del vínculo',
    );
    // Y la tarjeta de trazabilidad tampoco: el check verde depende del TONO, no del id.
    assert.match(sheet, /vm\.hubspotSyncTone === 'synced'/);
    assert.equal(sheet.includes('<span>Sincronizado con HubSpot</span>'), false);
  });

  it('el ViewModel no deduce nada por su cuenta: el `isSynced` por vínculo desapareció', () => {
    const vmSource = read('src/modules/contacts/contact-traceability.ts');
    assert.equal(vmSource.includes('const isSynced = hubspotContactId !== null'), false);
    assert.match(vmSource, /resolveHubSpotSyncPresentation\(/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4 · qué borra la línea base y qué no
// ═══════════════════════════════════════════════════════════════

describe('4. la anotación sobrevive a lo que no la desmiente', () => {
  it('marcar `stale` la CONSERVA: marcar no es sincronizar', () => {
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(baselineBlock()),
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
      nowIso: NOW,
      source: 'user_edit',
    });
    assert.equal(decision.marked, true);
    assert.ok(decision.marked);
    assert.equal(decision.state.status, 'stale');
    assert.equal(decision.state.stale_source, 'user_edit');
    assert.equal(readHubSpotSyncBaselineSource(decision.metadata), 'legacy_link_backfill');
  });

  it('un intento FALLIDO la conserva: HubSpot rechazó, luego no observó nada', () => {
    const metadata = buildFailedSyncMetadata({
      existing: metadataWith(baselineBlock({ status: 'stale', stale_reason: 'phone_changed', stale_source: 'user_edit', stale_since: NOW })),
      status: 'failed',
      lastError: 'hubspot_update_failed',
      nowIso: NOW,
      method: 'auto',
    });
    assert.equal(readHubSpotSyncBaselineSource(metadata), 'legacy_link_backfill');
    // Y el pendiente sobrevive con su procedencia, como exige CUT-3C.
    assert.equal(readHubSpotSyncState(metadata)?.stale_source, 'user_edit');
  });

  it('un PATCH EXITOSO la BORRA: desde aquí el `synced` ya no es deducido', () => {
    const metadata = buildUpdatedSyncMetadata({
      existing: metadataWith(baselineBlock({ status: 'stale', stale_reason: 'phone_changed', stale_source: 'user_edit' })),
      hubspotContactId: HS_ID,
      actorId: 'actor-1',
      nowIso: NOW,
      method: 'manual',
    });
    assert.equal(readHubSpotSyncBaselineSource(metadata), null);
    const block = metadata.hubspot_sync as Record<string, unknown>;
    assert.equal(block[HUBSPOT_SYNC_BASELINE_AT_FIELD], null);
    // El estado que queda sí es observado: hay hora de intento.
    assert.equal(readHubSpotSyncState(metadata)?.attempted_at, NOW);
  });

  it('una sincronización COMPLETA también la borra', () => {
    const metadata = buildSyncMetadata({
      existing: metadataWith(baselineBlock()),
      hubspotContactId: HS_ID,
      mode: 'linked_existing',
      hubspotCompanyId: 'hs-company-1',
      companyAssociation: 'associated',
      actorId: 'actor-1',
      nowIso: NOW,
      method: 'manual',
    });
    assert.equal(readHubSpotSyncBaselineSource(metadata), null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5 · lo que la línea base DESBLOQUEA — y lo que sigue sin desbloquear
// ═══════════════════════════════════════════════════════════════

describe('5. antes invisible, ahora participa — pero sin exportar nada solo', () => {
  it('SIN línea base la autoridad se calla: `no_durable_state` (el defecto)', () => {
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: { source: 'contact_enrichment_candidate' },
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
      nowIso: NOW,
      source: 'user_edit',
    });
    assert.equal(decision.marked, false);
    assert.ok(!decision.marked);
    assert.equal(decision.reason, 'no_durable_state');
  });

  it('CON línea base, los cuatro causantes marcan y conservan su procedencia', () => {
    for (const source of ['user_edit', 'merge', 'reveal', 'privacy'] as const) {
      const decision = markContactHubSpotSyncStaleForPhoneChange({
        metadata: metadataWith(baselineBlock()),
        hubspotContactId: HS_ID,
        previous: { phone: OLD_PHONE, mobile_phone: null },
        next: { phone: null, mobile_phone: null },
        nowIso: NOW,
        source,
      });
      assert.ok(decision.marked, `${source} no marcó`);
      assert.equal(decision.state.stale_reason, 'phone_removed');
      assert.equal(decision.state.stale_source, source);
    }
  });

  it('el backfill por sí solo NO abre la puerta del PATCH: nada pendiente (prueba 20)', () => {
    const gate = resolveContactAutoPhoneUpdateGate({
      id: 'contact-1',
      hubspot_contact_id: HS_ID,
      metadata: metadataWith(baselineBlock()),
    });
    assert.equal(gate.proceed, false);
    assert.ok(!gate.proceed);
    assert.equal(gate.outcome, 'skipped_no_pending_change');
  });

  it('una erasure POSTERIOR a la línea base sigue sin exportarse (prueba 19)', () => {
    const marked = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(baselineBlock()),
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: null, mobile_phone: null },
      nowIso: NOW,
      source: 'privacy',
    });
    assert.ok(marked.marked);
    const gate = resolveContactAutoPhoneUpdateGate({
      id: 'contact-1',
      hubspot_contact_id: HS_ID,
      metadata: marked.metadata,
    });
    assert.equal(gate.proceed, false);
    assert.ok(!gate.proceed);
    assert.equal(gate.outcome, 'skipped_privacy_hold');
  });

  it('un cambio LEGÍTIMO posterior sí es exportable: la línea base no bloquea nada', () => {
    const marked = markContactHubSpotSyncStaleForPhoneChange({
      metadata: metadataWith(baselineBlock()),
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: NEW_PHONE, mobile_phone: null },
      nowIso: NOW,
      source: 'reveal',
    });
    assert.ok(marked.marked);
    const gate = resolveContactAutoPhoneUpdateGate({
      id: 'contact-1',
      hubspot_contact_id: HS_ID,
      metadata: marked.metadata,
    });
    assert.equal(gate.proceed, true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6 · auditoría del TEXTO de la migración
// ═══════════════════════════════════════════════════════════════

describe('6. la migración, por lectura de su propio texto', () => {
  const sql = read(MIGRATION);
  /** Sólo el SQL ejecutable: la prosa explica lo que NO hace y no debe contar como que lo hace. */
  const code = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('declara que NO está aplicada en Producción ni en remoto', () => {
    assert.match(sql, /APPLIED IN PRODUCTION: NO/);
    assert.match(sql, /APPLIED REMOTE:\s+NO/);
    assert.match(sql, /LOCAL ONLY:\s+YES/);
  });

  it('lleva el prefijo canónico 132, y dice lo que el número cambia', () => {
    // OLD_ASSERTION: el archivo NO lleva prefijo numérico, y su cabecera declara la consecuencia
    // (quedar fuera de las guardas de techo) en vez de disimularla.
    //
    // WHY_OBSOLETE: AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 lo canonicalizó a 132. Ya no
    // queda fuera de las guardas de techo: entra en ellas, que era la condición que esa misma
    // cabecera declaraba para poder aplicarse alguna vez.
    //
    // NEW_INVARIANT: el prefijo es el 132 —el último del tramo, que es donde el orden DECLARADO
    // lo pone— y la cabecera sigue diciendo qué cambia el número en vez de callarlo.
    assert.match(MIGRATION.split('/').pop() as string, /^132_/);
    assert.match(sql, /guardas de techo/);
  });

  it('NO crea contactos, NO inventa vínculos y NO escribe teléfonos (prueba 12)', () => {
    assert.equal(/INSERT\s+INTO\s+public\.contacts/i.test(code), false);
    assert.equal(/DELETE\s+FROM\s+public\.contacts/i.test(code), false);
    // El ÚNICO UPDATE toca `metadata`, y ninguna otra columna aparece a la izquierda de un `=`.
    const updates = code.match(/UPDATE\s+public\.contacts[\s\S]*?WHERE/gi) ?? [];
    assert.equal(updates.length, 1);
    assert.match(updates[0], /SET\s+metadata\s*=/);
    for (const col of ['phone', 'mobile_phone', 'hubspot_contact_id', 'archived_at', 'email']) {
      assert.equal(
        new RegExp(`\\b${col}\\s*=`).test(updates[0]),
        false,
        `el UPDATE escribe ${col}`,
      );
    }
  });

  it('NO alcanza la red ni nombra a ningún proveedor', () => {
    for (const forbidden of ['http', 'apollo', 'lusha', 'pg_net', 'dblink', 'COPY ']) {
      assert.equal(
        code.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `la migración nombra ${forbidden}`,
      );
    }
  });

  it('escribe la procedencia con el MISMO literal que TypeScript lee', () => {
    assert.match(code, /'baseline_source',\s*'legacy_link_backfill'/);
    assert.equal(HUBSPOT_SYNC_BASELINE_SOURCES.legacyLinkBackfill, 'legacy_link_backfill');
    assert.equal(HUBSPOT_SYNC_BASELINE_SOURCE_FIELD, 'baseline_source');
    assert.equal(HUBSPOT_SYNC_BASELINE_AT_FIELD, 'baseline_at');
  });

  it('escribe los OCHO campos del contrato, ninguno inventado (prueba 14)', () => {
    for (const [field, value] of [
      ['status', "'synced'"],
      ['method', 'NULL::text'],
      ['attempted_at', 'NULL::text'],
      ['last_error', 'NULL::text'],
      ['stale_since', 'NULL::text'],
      ['stale_reason', 'NULL::text'],
      ['stale_source', 'NULL::text'],
    ] as const) {
      assert.match(code, new RegExp(`'${field}',\\s*${value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
    }
    // `hubspot_contact_id` sale de la COLUMNA, no del bloque.
    assert.match(code, /'hubspot_contact_id',\s*BTRIM\(c\.hubspot_contact_id\)/);
    // Y no se estampa ninguna hora de sincronización.
    assert.equal(/'synced_at'\s*,/.test(code), false);
    assert.equal(/'synced_by'\s*,/.test(code), false);
  });

  it('el vocabulario de `status` es EXACTAMENTE el del contrato de TypeScript', () => {
    const declared = Object.keys(HUBSPOT_SYNC_STATUS_LABELS).sort();
    const block = code.slice(code.indexOf('c_statuses'), code.indexOf('c_statuses') + 260);
    const inSql = (block.match(/'([a-z_]+)'/g) ?? []).map((s) => s.slice(1, -1)).sort();
    assert.deepEqual(inSql, declared);
  });

  it('el `mode` legado NO se mapea a `method` en ninguna parte (prueba 8)', () => {
    assert.equal(code.includes("'created'"), false);
    assert.equal(code.includes("'linked_existing'"), false);
    assert.equal(code.includes("'manual'"), false);
    assert.equal(code.includes("'auto'"), false);
  });

  it('la elegibilidad exige vínculo, no archivado y estado ilegible (prueba 1)', () => {
    assert.match(code, /hubspot_legacy_sync_backfill_class\(\s*\n?\s*c\.hubspot_contact_id,\s*c\.archived_at,\s*c\.metadata\s*\n?\s*\)\s*=\s*'eligible'/);
    assert.match(code, /p_archived_at IS NOT NULL/);
    assert.match(code, /RETURN 'archived_linked'/);
  });

  it('las tres funciones quedan fuera del alcance de `anon` y `authenticated`', () => {
    for (const fn of [
      'hubspot_legacy_sync_backfill_class',
      'hubspot_legacy_sync_backfill_census',
      'backfill_legacy_hubspot_sync_state',
    ]) {
      for (const role of ['PUBLIC', 'anon', 'authenticated']) {
        assert.match(
          code,
          new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM ${role};`),
          `falta el REVOKE de ${fn} a ${role}`,
        );
      }
      assert.match(
        code,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*TO postgres, service_role;`),
        `falta el GRANT de ${fn}`,
      );
    }
  });

  it('no crea tabla de auditoría: la observabilidad es un valor de retorno', () => {
    assert.equal(/CREATE\s+TABLE/i.test(code), false);
    assert.match(code, /RETURNS jsonb/);
    assert.match(code, /'updated_count'/);
    assert.match(code, /'eligible_count'/);
    assert.match(code, /'conflict_count'/);
    assert.match(code, /'skipped_valid_state_count'/);
  });

  it('se ejecuta una vez dentro de la propia migración, y en una transacción', () => {
    assert.match(code, /^BEGIN;/m);
    assert.match(code, /^COMMIT;/m);
    assert.match(code, /backfill_legacy_hubspot_sync_state\(now\(\)\)/);
  });
});
