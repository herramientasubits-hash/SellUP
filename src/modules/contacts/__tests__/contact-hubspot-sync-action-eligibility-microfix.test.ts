/**
 * AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — la honestidad de lo que la UI OFRECE.
 *
 * El defecto que cierra: tres superficies deducían «ya está sincronizado» de
 * `!!contact.hubspot_contact_id` y pintaban un control DESHABILITADO con check verde
 * «Sincronizado». En una fila de LÍNEA BASE (`baseline_source = legacy_link_backfill`) eso era
 * una contradicción literal dentro de la misma tarjeta —badge neutro «Vinculado a HubSpot» al
 * lado de un botón verde «Sincronizado»— y una afirmación de paridad de campos que el backfill
 * se niega a hacer, porque nunca se observó ninguna.
 *
 * Lo que se demuestra aquí:
 *  1. una línea base + vínculo dice «Vinculado a HubSpot», y no «Sincronizado»;
 *  2. una línea base NO puede lucir el check verde: su `kind` no es el que lo autoriza;
 *  3. una línea base NO ofrece ninguna acción que pueda salir a la red;
 *  4. un `synced` observado manual sigue diciendo «Sincronizado»;
 *  5. un `synced` observado automático sigue diciendo «Sincronizado automáticamente»;
 *  6. vínculo SIN estado durable legible dice «Estado de sincronización desconocido», en neutro;
 *  7. `stale` sigue ofreciendo «Actualizar en HubSpot», con red;
 *  8. `failed` con pendiente sigue ofreciendo «Reintentar actualización», con red;
 *  9. el drawer y el menú de la lista consumen LA MISMA autoridad, y ninguno deduce por su cuenta;
 * 10. la página de detalle legada ya no hardcodea «Sincronización no activa»;
 * 11. este microfix NO añade una sola línea de red HubSpot.
 *
 * Sin red, sin DB, sin auth. `fetch` global queda envenenado.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HUBSPOT_SYNC_ACTION_LABEL,
  HUBSPOT_SYNC_BASELINE_DETAIL,
  HUBSPOT_SYNC_BASELINE_LABEL,
  HUBSPOT_SYNC_BASELINE_SOURCE_FIELD,
  HUBSPOT_SYNC_BASELINE_AT_FIELD,
  HUBSPOT_SYNC_NO_EMAIL_LABEL,
  HUBSPOT_SYNC_RETRY_UPDATE_LABEL,
  HUBSPOT_SYNC_STATUS_LABELS,
  HUBSPOT_SYNC_UNKNOWN_STATE_LABEL,
  HUBSPOT_SYNC_UPDATE_LABEL,
  readHubSpotSyncBaselineSource,
  readHubSpotSyncState,
  resolveHubSpotSyncAction,
  resolveHubSpotSyncPresentation,
  type HubSpotSyncActionKind,
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

// ── Fixtures ────────────────────────────────────────────────────

const HS_ID = 'hs-contact-legado';
const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * El CÓDIGO de un archivo, sin sus comentarios.
 *
 * Hace falta porque los trinquetes de abajo buscan el patrón defectuoso —`alreadySynced`,
 * `if (contact.hubspot_contact_id) return;`, «Sincronización no activa»— y los comentarios que
 * explican POR QUÉ se retiró cada uno lo citan literalmente. Sin esto, la propia explicación
 * del arreglo haría fallar la guarda del arreglo, y la única salida sería dejar de explicarlo.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

const SHEET = 'src/components/contacts/contact-detail-sheet.tsx';
const ROW_ACTIONS = 'src/components/contacts/contact-row-actions.tsx';
const BUTTON = 'src/components/contacts/contact-hubspot-sync-button.tsx';
const BADGE = 'src/components/contacts/contact-hubspot-sync-badge.tsx';
const DETAIL_PAGE = 'src/app/(sellup)/contacts/[contactId]/page.tsx';
const AUTHORITY = 'src/modules/contacts/contact-hubspot-sync-state.ts';

function state(over: Partial<HubSpotSyncState> = {}): HubSpotSyncState {
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

/** El bloque EXACTO que el backfill deja en `metadata`, leído por los lectores reales. */
const baselineMetadata = (): Record<string, unknown> => ({
  hubspot_sync: {
    status: 'synced',
    method: null,
    attempted_at: null,
    last_error: null,
    hubspot_contact_id: HS_ID,
    stale_since: null,
    stale_reason: null,
    stale_source: null,
    [HUBSPOT_SYNC_BASELINE_SOURCE_FIELD]: 'legacy_link_backfill',
    [HUBSPOT_SYNC_BASELINE_AT_FIELD]: '2026-08-26T09:00:00.000Z',
  },
});

/** La misma entrada que las superficies construyen: metadata cruda → autoridad. */
function actionFor(args: {
  metadata: Record<string, unknown> | null;
  hubspotContactId: string | null;
  hasEmail?: boolean;
}) {
  return resolveHubSpotSyncAction({
    state: readHubSpotSyncState(args.metadata),
    baselineSource: readHubSpotSyncBaselineSource(args.metadata),
    hubspotContactId: args.hubspotContactId,
    hasEmail: args.hasEmail ?? true,
  });
}

/** El ÚNICO `kind` autorizado a lucir el check verde. Se nombra una vez. */
const GREEN_CHECK_KIND: HubSpotSyncActionKind = 'observed_synced';

// ═══════════════════════════════════════════════════════════════
// 1 · la línea base: vinculada, y nada más
// ═══════════════════════════════════════════════════════════════

describe('1. línea base legada — el vínculo consta, la paridad NO', () => {
  it('1 · dice «Vinculado a HubSpot»', () => {
    const action = actionFor({ metadata: baselineMetadata(), hubspotContactId: HS_ID });
    assert.equal(action.label, HUBSPOT_SYNC_BASELINE_LABEL);
    assert.equal(action.label, 'Vinculado a HubSpot');
  });

  it('2 · NO dice «Sincronizado», y su `kind` no es el que autoriza el check verde', () => {
    const action = actionFor({ metadata: baselineMetadata(), hubspotContactId: HS_ID });
    assert.equal(action.kind, 'linked_no_parity');
    assert.notEqual(action.kind, GREEN_CHECK_KIND);
    assert.notEqual(action.label, HUBSPOT_SYNC_STATUS_LABELS.synced);
    assert.equal(/Sincronizado/.test(action.label), false);
  });

  it('3 · no ofrece NINGUNA acción que pueda salir a la red', () => {
    const action = actionFor({ metadata: baselineMetadata(), hubspotContactId: HS_ID });
    assert.equal(action.triggersNetwork, false);
  });

  it('3b · y lo dice: explica por qué no ofrece nada en vez de dejarlo adivinar', () => {
    const action = actionFor({ metadata: baselineMetadata(), hubspotContactId: HS_ID });
    assert.equal(action.detail, HUBSPOT_SYNC_BASELINE_DETAIL);
    assert.match(action.detail ?? '', /no se verificó/);
  });

  it('3c · el badge de al lado dice LO MISMO: una autoridad, un copy', () => {
    const metadata = baselineMetadata();
    const presentation = resolveHubSpotSyncPresentation({
      state: readHubSpotSyncState(metadata),
      baselineSource: readHubSpotSyncBaselineSource(metadata),
      hubspotContactId: HS_ID,
    });
    const action = actionFor({ metadata, hubspotContactId: HS_ID });
    assert.equal(action.label, presentation.label);
    assert.equal(presentation.tone, 'neutral');
  });

  it('3d · sin email tampoco se convierte en «no se puede»: el vínculo manda', () => {
    // Un contacto legado vinculado y sin email no es un caso de «falta email»: no hay nada que
    // enviar. Decirle «No se puede sincronizar» culparía al contacto de un requisito que no
    // aplica a su situación.
    const action = actionFor({
      metadata: baselineMetadata(),
      hubspotContactId: HS_ID,
      hasEmail: false,
    });
    assert.equal(action.kind, 'linked_no_parity');
    assert.equal(action.label, HUBSPOT_SYNC_BASELINE_LABEL);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 · lo OBSERVADO sigue intacto
// ═══════════════════════════════════════════════════════════════

describe('2. lo que sí consta no se toca', () => {
  it('4 · `synced` observado manual sigue diciendo «Sincronizado», con check verde', () => {
    const action = resolveHubSpotSyncAction({
      state: state({ method: 'manual' }),
      baselineSource: null,
      hubspotContactId: HS_ID,
      hasEmail: true,
    });
    assert.equal(action.kind, GREEN_CHECK_KIND);
    assert.equal(action.label, 'Sincronizado');
    assert.equal(action.label, HUBSPOT_SYNC_STATUS_LABELS.synced);
    assert.equal(action.triggersNetwork, false);
  });

  it('5 · `synced` observado automático sigue diciendo «Sincronizado automáticamente»', () => {
    const action = resolveHubSpotSyncAction({
      state: state({ method: 'auto' }),
      baselineSource: null,
      hubspotContactId: HS_ID,
      hasEmail: true,
    });
    assert.equal(action.kind, GREEN_CHECK_KIND);
    assert.equal(action.label, 'Sincronizado automáticamente');
    assert.equal(action.triggersNetwork, false);
  });

  it('6 · vínculo SIN estado durable legible: neutro y explícito', () => {
    for (const metadata of [null, {}, { hubspot_sync: 'no-es-un-objeto' }]) {
      const action = actionFor({
        metadata: metadata as Record<string, unknown> | null,
        hubspotContactId: HS_ID,
      });
      assert.equal(action.kind, 'linked_no_parity');
      assert.equal(action.label, HUBSPOT_SYNC_UNKNOWN_STATE_LABEL);
      assert.equal(action.triggersNetwork, false);
      // No es una línea base: no hay nada que explicar sobre una anotación que no existe.
      assert.equal(action.detail, null);
    }
  });

  it('7 · `stale` no cambia: «Actualizar en HubSpot», y SÍ sale a la red', () => {
    const action = resolveHubSpotSyncAction({
      state: state({ status: 'stale', stale_reason: 'phone_changed', stale_source: 'user_edit' }),
      baselineSource: null,
      hubspotContactId: HS_ID,
      hasEmail: true,
    });
    assert.equal(action.kind, 'update');
    assert.equal(action.label, HUBSPOT_SYNC_UPDATE_LABEL);
    assert.equal(action.triggersNetwork, true);
  });

  it('7b · un `stale` sobre una línea base TAMBIÉN se envía: lo pendiente manda', () => {
    // La línea base no puede sepultar un cambio real: si hay algo que el PATCH sabe enviar, se
    // ofrece enviarlo. Ese envío es justamente lo que CONVIERTE la línea base en observada.
    const metadata = baselineMetadata();
    (metadata.hubspot_sync as Record<string, unknown>).status = 'stale';
    (metadata.hubspot_sync as Record<string, unknown>).stale_reason = 'phone_changed';
    const action = actionFor({ metadata, hubspotContactId: HS_ID });
    assert.equal(action.kind, 'update');
    assert.equal(action.triggersNetwork, true);
  });

  it('8 · `failed` con pendiente no cambia: «Reintentar actualización»', () => {
    const action = resolveHubSpotSyncAction({
      state: state({
        status: 'failed',
        stale_reason: 'phone_removed',
        stale_source: 'user_edit',
        last_error: 'hubspot_update_failed',
      }),
      baselineSource: null,
      hubspotContactId: HS_ID,
      hasEmail: true,
    });
    assert.equal(action.kind, 'retry_update');
    assert.equal(action.label, HUBSPOT_SYNC_RETRY_UPDATE_LABEL);
    assert.equal(action.triggersNetwork, true);
  });

  it('8b · `failed` SIN pendiente y con vínculo: neutro, no verde', () => {
    // No hay nada que reenviar y no consta paridad. Antes esta fila mostraba «Sincronizado»
    // verde por tener id, que es la peor de las tres mentiras posibles aquí.
    const action = resolveHubSpotSyncAction({
      state: state({ status: 'failed', last_error: 'hubspot_create_failed' }),
      baselineSource: null,
      hubspotContactId: HS_ID,
      hasEmail: true,
    });
    assert.equal(action.kind, 'linked_no_parity');
    assert.notEqual(action.kind, GREEN_CHECK_KIND);
    assert.equal(action.triggersNetwork, false);
    assert.equal(action.label, HUBSPOT_SYNC_STATUS_LABELS.failed);
  });

  it('8c · los estados BLOQUEADOS con vínculo tampoco pintan verde, y su copy es el suyo', () => {
    for (const status of ['blocked_no_email', 'blocked_no_hubspot_company'] as const) {
      const action = resolveHubSpotSyncAction({
        state: state({ status }),
        baselineSource: null,
        hubspotContactId: HS_ID,
        hasEmail: true,
      });
      assert.equal(action.kind, 'linked_no_parity');
      assert.equal(action.label, HUBSPOT_SYNC_STATUS_LABELS[status]);
      assert.equal(action.triggersNetwork, false);
    }
  });

  it('sin vínculo se sigue OFRECIENDO sincronizar, y sin email se dice que no se puede', () => {
    const offered = actionFor({ metadata: null, hubspotContactId: null });
    assert.equal(offered.kind, 'sync');
    assert.equal(offered.label, HUBSPOT_SYNC_ACTION_LABEL);
    assert.equal(offered.triggersNetwork, true);

    const blocked = actionFor({ metadata: null, hubspotContactId: null, hasEmail: false });
    assert.equal(blocked.kind, 'no_email');
    assert.equal(blocked.label, HUBSPOT_SYNC_NO_EMAIL_LABEL);
    assert.equal(blocked.triggersNetwork, false);
  });

  it('EXACTAMENTE un `kind` sale a la red por cada operación que el ejecutor sabe hacer', () => {
    // El barrido de la matriz entera: ningún `kind` no accionable puede colarse con
    // `triggersNetwork: true`, y ninguno accionable puede quedarse sin él.
    const NETWORK_KINDS: readonly HubSpotSyncActionKind[] = ['update', 'retry_update', 'sync'];
    const cases: Array<ReturnType<typeof resolveHubSpotSyncAction>> = [
      actionFor({ metadata: baselineMetadata(), hubspotContactId: HS_ID }),
      actionFor({ metadata: null, hubspotContactId: HS_ID }),
      actionFor({ metadata: null, hubspotContactId: null }),
      actionFor({ metadata: null, hubspotContactId: null, hasEmail: false }),
      resolveHubSpotSyncAction({
        state: state(),
        baselineSource: null,
        hubspotContactId: HS_ID,
        hasEmail: true,
      }),
      resolveHubSpotSyncAction({
        state: state({ status: 'stale', stale_reason: 'phone_changed' }),
        baselineSource: null,
        hubspotContactId: HS_ID,
        hasEmail: true,
      }),
      resolveHubSpotSyncAction({
        state: state({ status: 'failed', stale_reason: 'phone_changed' }),
        baselineSource: null,
        hubspotContactId: HS_ID,
        hasEmail: true,
      }),
    ];
    for (const action of cases) {
      assert.equal(
        action.triggersNetwork,
        NETWORK_KINDS.includes(action.kind),
        `${action.kind} declara una red que no le corresponde`,
      );
      assert.ok(action.label.trim().length > 0, `${action.kind} sin copy`);
    }
    // Y el check verde es de UNO solo.
    assert.equal(cases.filter((a) => a.kind === GREEN_CHECK_KIND).length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3 · las tres superficies, alineadas y sin deducir
// ═══════════════════════════════════════════════════════════════

describe('3. las superficies consumen la autoridad y no deducen', () => {
  it('9a · el drawer NO deduce de `hubspot_contact_id` y delega en el botón', () => {
    const sheet = code(SHEET);
    assert.equal(
      /alreadySynced/.test(sheet),
      false,
      'el drawer volvió a pasar un `alreadySynced` deducido',
    );
    assert.equal(
      /!!contact\.hubspot_contact_id/.test(sheet),
      false,
      'el drawer volvió a deducir del vínculo',
    );
    assert.match(sheet, /<ContactHubSpotSyncButton/);
  });

  it('9b · el menú de la lista consume LA MISMA autoridad, no un campo', () => {
    const rowActions = code(ROW_ACTIONS);
    assert.match(rowActions, /resolveHubSpotSyncAction\(/);
    // El trinquete exacto del defecto: el guard del handler y la rama del ítem deshabilitado
    // eran los dos `contact.hubspot_contact_id`.
    assert.equal(
      /if \(contact\.hubspot_contact_id\) return;/.test(rowActions),
      false,
      'el guard volvió a ser el campo',
    );
    assert.equal(
      /\{contact\.hubspot_contact_id \? \(/.test(rowActions),
      false,
      'el ítem del menú volvió a deducir del vínculo',
    );
    // El permiso de red es `triggersNetwork`, y sólo eso.
    assert.match(rowActions, /if \(!hubspotAction\.triggersNetwork\) return;/);
  });

  it('9c · el botón deriva la elegibilidad y sólo `observed_synced` luce el check verde', () => {
    const button = code(BUTTON);
    assert.match(button, /resolveHubSpotSyncAction\(/);
    assert.equal(/alreadySynced/.test(button), false);
    // Un solo sitio nombra el check verde, y su guard es el `kind`.
    const greenAt = button.indexOf('text-emerald-500');
    assert.ok(greenAt > 0, 'el botón debe seguir teniendo un estado verde para lo observado');
    assert.equal(
      button.split('text-emerald-500').length - 1,
      1,
      'hay más de un camino verde en el botón',
    );
    assert.match(
      button.slice(Math.max(0, greenAt - 400), greenAt),
      /action\.kind === 'observed_synced'/,
    );
  });

  it('9d · el drawer y el menú producen el MISMO veredicto sobre el mismo contacto', () => {
    // Las dos superficies llaman a la misma función con la misma entrada derivada del contacto.
    // Se afirma sobre la autoridad —no sobre dos renders— porque es ahí donde la unicidad vive:
    // si divergieran, tendrían que hacerlo aquí.
    const metadata = baselineMetadata();
    const drawer = actionFor({ metadata, hubspotContactId: HS_ID });
    const menu = actionFor({ metadata, hubspotContactId: HS_ID });
    assert.deepEqual(drawer, menu);
    assert.equal(drawer.kind, 'linked_no_parity');

    // Y las dos leen los mismos tres lectores, en el mismo orden lógico.
    for (const surface of [code(BUTTON), code(ROW_ACTIONS)]) {
      assert.match(surface, /readHubSpotSyncState\(/);
      assert.match(surface, /readHubSpotSyncBaselineSource\(/);
      assert.match(surface, /resolveHubSpotSyncAction\(/);
    }
  });

  it('10 · la página de detalle ya no hardcodea «Sincronización no activa»', () => {
    // El literal sólo puede sobrevivir dentro del comentario que explica su retirada.
    const page = code(DETAIL_PAGE);
    assert.equal(
      /Sincronización no activa/.test(page),
      false,
      'la página volvió a hardcodear el estado',
    );
    assert.match(read(DETAIL_PAGE), /<ContactHubSpotSyncBadge/);
    // Y no se trajo una copia de la deducción.
    assert.equal(/resolveHubSpotSyncPresentation\(/.test(page), false);
    // El párrafo de propiedades ya no afirma que la sync esté sin activar.
    assert.equal(/antes de activar la sync/.test(page), false);
  });

  it('el badge compartido es renderizable desde el SERVIDOR: sin `use client`', () => {
    // Es la propiedad que permitió que la página de detalle deje de hardcodear: un componente
    // marcado `'use client'` no lo habría podido importar.
    const badge = read(BADGE);
    assert.equal(/^['"]use client['"]/m.test(badge), false);
    assert.match(badge, /resolveHubSpotSyncPresentation\(/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4 · el alcance: presentación y elegibilidad, nada más
// ═══════════════════════════════════════════════════════════════

describe('4. el microfix no añade red ni toca el motor', () => {
  it('11 · ninguna superficie tocada contiene una llamada HubSpot', () => {
    for (const rel of [SHEET, ROW_ACTIONS, BUTTON, BADGE, DETAIL_PAGE, AUTHORITY]) {
      const source = code(rel);
      for (const forbidden of [
        /api\.hubapi\.com/,
        /\bfetch\s*\(/,
        /hubspotFetch/,
        /findHubSpotContactByEmail/,
        /updateHubSpotContact/,
        /createHubSpotContact/,
      ]) {
        assert.equal(forbidden.test(source), false, `${rel} no puede contener ${forbidden}`);
      }
    }
  });

  it('11b · la autoridad de elegibilidad es PURA: no importa nada', () => {
    const authority = code(AUTHORITY);
    // Un solo módulo, cero imports: es lo que la hace testeable en aislamiento y lo que impide
    // que alguien meta una lectura de DB o una llamada dentro de la decisión.
    assert.equal(/^import /m.test(authority), false);
    assert.match(authority, /export function resolveHubSpotSyncAction\(/);
  });

  it('11c · el ejecutor y su vocabulario NO cambiaron de forma observable', () => {
    // El microfix es de presentación y elegibilidad. Si hubiera tocado el motor, estas dos
    // afirmaciones —las que el resto de la cadena CUT-1→3C da por ciertas— cambiarían.
    const core = read('src/modules/contacts/contact-hubspot-sync-core.ts');
    assert.match(core, /status: 'already_synced'/);
    assert.match(core, /if \(priorState\?\.status !== 'synced'\) \{/);
    const authority = read(AUTHORITY);
    assert.match(authority, /HUBSPOT_SYNC_STATUS_LABELS: Readonly<Record<HubSpotSyncStatus, string>>/);
    // El vocabulario de estados sigue teniendo SEIS miembros.
    const vocab = authority.slice(
      authority.indexOf('export type HubSpotSyncStatus'),
      authority.indexOf("| 'failed';") + 12,
    );
    assert.equal(vocab.split('|').length - 1, 6, 'el vocabulario de estados cambió de tamaño');
  });
});
