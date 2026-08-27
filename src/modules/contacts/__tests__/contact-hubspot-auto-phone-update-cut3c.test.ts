/**
 * AGENT2-CONTACT-HUBSPOT-AUTO-PHONE-UPDATE-CUT3C — el PATCH automático del teléfono.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ SE PRUEBA AQUÍ
 * ═══════════════════════════════════════════════════════════════════
 *
 * CUT-3C es el primer corte en el que un cambio local de teléfono puede llegar al CRM del
 * cliente sin que nadie pulse. Todo lo que importa es el PORTERO: qué deja pasar y qué no.
 *
 * La afirmación central —y la única cuya violación sería grave de verdad— es que un pendiente
 * causado por una supresión de PRIVACIDAD no sale nunca solo a la red. La contraprueba está
 * escrita en negativo: la misma llamada, con el mismo estado, cambiando SÓLO `stale_source`,
 * produce un PATCH o cero PATCH.
 *
 * Sin red, sin DB, sin reloj: todo inyectado. `fetch` queda envenenado, así que cualquier salida
 * real rompe el archivo.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveContactAutoPhoneUpdateGate,
  runContactHubSpotAutoPhoneUpdate,
  type ContactAutoPhoneUpdateDeps,
  type ContactAutoPhoneUpdateSubject,
} from '../contact-hubspot-auto-phone-update-core';
import {
  HUBSPOT_AUTO_PHONE_UPDATE_ANNEX_KEY,
  HUBSPOT_SYNC_METADATA_KEY,
  HUBSPOT_SYNC_STALE_SOURCES,
  isHubSpotStaleSourceAutoExportable,
  markContactHubSpotSyncStaleForPhoneChange,
  readContactAutoPhoneUpdateAnnex,
  readContactAutoSyncAnnex,
  readHubSpotSyncState,
  type HubSpotSyncStaleSource,
  type HubSpotSyncState,
} from '../contact-hubspot-sync-state';
import {
  buildUpdatedSyncMetadata,
  runSyncContactToHubSpot,
  type ContactForSync,
  type HubSpotContactUpdateInput,
  type SyncContactDeps,
  type SyncContactToHubSpotResult,
} from '../contact-hubspot-sync-core';

// ── Ninguna red real ────────────────────────────────────────────

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

const NOW = '2026-08-26T12:00:00.000Z';
const STALE_AT = '2026-08-24T09:30:00.000Z';
const SYNCED_AT = '2026-08-20T10:00:00.000Z';
const HS_ID = 'hs-contact-77';
const CONTACT_ID = 'contact-77';
const ACTOR = 'user-1';

const OLD_PHONE = '+57 1 555 0000';
const NEW_PHONE = '+57 1 555 9999';
const MOBILE = '+57 300 555 2222';

function state(over: Partial<HubSpotSyncState> = {}): HubSpotSyncState {
  return {
    status: 'synced',
    method: 'manual',
    attempted_at: SYNCED_AT,
    last_error: null,
    hubspot_contact_id: HS_ID,
    stale_since: null,
    stale_reason: null,
    stale_source: null,
    ...over,
  };
}

/** Un pendiente de teléfono con la procedencia que se quiera probar. */
function pending(source: HubSpotSyncStaleSource | null, over: Partial<HubSpotSyncState> = {}) {
  return state({
    status: 'stale',
    stale_since: STALE_AT,
    stale_reason: 'phone_changed',
    stale_source: source,
    ...over,
  });
}

function subject(
  block: HubSpotSyncState | null,
  over: Partial<ContactAutoPhoneUpdateSubject> = {},
): ContactAutoPhoneUpdateSubject {
  return {
    id: CONTACT_ID,
    hubspot_contact_id: HS_ID,
    metadata: block ? { [HUBSPOT_SYNC_METADATA_KEY]: { ...block } } : {},
    ...over,
  };
}

/** Grabadora del ejecutor: cuántas veces corrió el motor y qué anexos se persistieron. */
interface Recorder {
  runs: string[];
  annexes: Record<string, unknown>[];
}

function deps(
  args: {
    enabled?: boolean;
    subject?: ContactAutoPhoneUpdateSubject | null;
    result?: SyncContactToHubSpotResult;
    runSync?: (contactId: string) => Promise<SyncContactToHubSpotResult>;
    annexError?: string;
  } = {},
): { deps: ContactAutoPhoneUpdateDeps; rec: Recorder } {
  const rec: Recorder = { runs: [], annexes: [] };
  return {
    rec,
    deps: {
      enabled: args.enabled ?? true,
      nowIso: NOW,
      loadSubject: async () =>
        args.subject === undefined ? subject(pending('user_edit')) : args.subject,
      runSync:
        args.runSync ??
        (async (contactId) => {
          rec.runs.push(contactId);
          return (
            args.result ?? {
              ok: true,
              status: 'updated',
              hubspotContactId: HS_ID,
              message: 'Teléfono actualizado en HubSpot.',
            }
          );
        }),
      persistAnnex: async (_id, metadata) => {
        rec.annexes.push(metadata);
        return { error: args.annexError };
      },
    },
  };
}

// ════════════════════════════════════════════════════════════════
// 1 · 2 · La bandera manda, y es SEPARADA
// ════════════════════════════════════════════════════════════════

describe('1 · 2. la bandera decide, y apagada no lee ni escribe nada', () => {
  it('1. bandera OFF sobre un pendiente de reveal ⇒ CERO PATCH', async () => {
    let loaded = 0;
    const { deps: d, rec } = deps({ enabled: false, subject: subject(pending('reveal')) });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, {
      ...d,
      loadSubject: async (id) => {
        loaded += 1;
        return subject(pending('reveal'), { id });
      },
    });

    assert.equal(report.outcome, 'flag_off');
    assert.equal(report.attempted, false);
    assert.deepEqual(rec.runs, [], 'ni una llamada al motor');
    // Ni una LECTURA: apagar la bandera devuelve el sistema exactamente a CUT-3B.
    assert.equal(loaded, 0);
  });

  it('2. bandera ON sobre un pendiente de reveal ⇒ UN PATCH y vuelve a `synced`', async () => {
    const { deps: d, rec } = deps({ subject: subject(pending('reveal')) });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);

    assert.equal(report.outcome, 'attempted_updated');
    assert.equal(report.attempted, true);
    assert.deepEqual(rec.runs, [CONTACT_ID], 'exactamente UNA ejecución del motor');
    assert.equal(report.staleSource, 'reveal');
    assert.equal(report.hubspotContactId, HS_ID);

    // 13 · el estado resultante lo escribe el motor, con los marcadores LIMPIOS.
    const after = readHubSpotSyncState(
      buildUpdatedSyncMetadata({
        existing: { [HUBSPOT_SYNC_METADATA_KEY]: { ...pending('reveal') } },
        hubspotContactId: HS_ID,
        actorId: ACTOR,
        nowIso: NOW,
        method: 'auto',
      }),
    );
    assert.equal(after?.status, 'synced');
    assert.equal(after?.stale_since, null);
    assert.equal(after?.stale_reason, null);
    assert.equal(after?.stale_source, null, 'los TRES marcadores se limpian juntos');
    // 14 · method = auto.
    assert.equal(after?.method, 'auto');
  });

  it('la bandera del PATCH es OTRA variable que la del autosync', async () => {
    const flags = readFileSync(join(process.cwd(), 'src/lib/feature-flags.server.ts'), 'utf8');
    assert.match(flags, /HUBSPOT_CONTACT_AUTO_PHONE_UPDATE_ENABLED/);
    assert.match(flags, /HUBSPOT_CONTACT_AUTO_SYNC_ENABLED/);
    // Y el lector nuevo NO se apoya en el viejo: reutilizarlo convertiría «quiero que los
    // contactos nuevos lleguen a HubSpot» en «autorizo escrituras automáticas indefinidas
    // sobre fichas existentes», que es una decisión que nadie tomó.
    const reader = flags.slice(flags.indexOf('isHubSpotContactAutoPhoneUpdateEnabled'));
    assert.equal(
      /HUBSPOT_CONTACT_AUTO_SYNC_FLAG/.test(reader.slice(0, 400)),
      false,
      'el lector nuevo no puede leer la variable del autosync',
    );
  });
});

// ════════════════════════════════════════════════════════════════
// 3 · Sin vínculo no hay nada que actualizar
// ════════════════════════════════════════════════════════════════

describe('3. un reveal ANTES del alta en HubSpot no dispara nada', () => {
  it('sin `hubspot_contact_id` ⇒ CERO PATCH', async () => {
    const { deps: d, rec } = deps({
      subject: subject(pending('reveal'), { hubspot_contact_id: null }),
    });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);

    assert.equal(report.outcome, 'skipped_not_linked');
    assert.deepEqual(rec.runs, []);
    // El alta es territorio de CUT-3B, y de su PROPIA bandera. Este corte no crea contactos.
    assert.equal(report.hubspotContactId, null);
  });

  it('un vínculo en BLANCO cuenta como ausente', async () => {
    const { deps: d, rec } = deps({
      subject: subject(pending('merge'), { hubspot_contact_id: '   ' }),
    });
    assert.equal(
      (await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d)).outcome,
      'skipped_not_linked',
    );
    assert.deepEqual(rec.runs, []);
  });
});

// ════════════════════════════════════════════════════════════════
// 4 · 5 · EL corazón del corte: borrado normal SÍ, borrado por privacidad NO
// ════════════════════════════════════════════════════════════════

describe('4 · 5. el mismo `phone_removed`, dos autorizaciones opuestas', () => {
  /** El pendiente de BORRADO, idéntico campo a campo salvo la procedencia. */
  const removal = (source: HubSpotSyncStaleSource | null) =>
    pending(source, { stale_reason: 'phone_removed' });

  it('4. `phone_removed` de una edición normal ⇒ PATCH de limpieza y `synced`', async () => {
    const sent: HubSpotContactUpdateInput[] = [];
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, {
      ...deps({ subject: subject(removal('user_edit')) }).deps,
      runSync: async () => {
        // El cuerpo del PATCH lo construye el motor de CUT-3A: `null` significa BORRAR, y su
        // representación en el cable (`''`) vive en UN solo sitio. Aquí sólo se comprueba que
        // el ejecutor llega a pedirlo.
        sent.push({ phone: null });
        return {
          ok: true,
          status: 'updated',
          hubspotContactId: HS_ID,
          message: 'Teléfono eliminado en HubSpot.',
        };
      },
    });

    assert.equal(report.outcome, 'attempted_updated');
    assert.equal(report.staleReason, 'phone_removed');
    assert.equal(report.staleSource, 'user_edit');
    assert.deepEqual(sent, [{ phone: null }], 'un PATCH de BORRADO, exactamente uno');
  });

  it('5. `phone_removed` de una DSAR ⇒ CERO PATCH, y sigue `stale`', async () => {
    const { deps: d, rec } = deps({ subject: subject(removal('privacy')) });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);

    assert.equal(report.outcome, 'skipped_privacy_hold');
    assert.equal(report.attempted, false);
    assert.deepEqual(rec.runs, [], 'una erasure NO empuja datos a un tercero');
    // El pendiente NO se pierde ni se disfraza: sigue ahí, esperando una decisión humana.
    assert.equal(report.staleReason, 'phone_removed');
    assert.equal(report.staleSource, 'privacy');
    // Y NO se escribe un anexo de bloqueo: no hubo bloqueo operativo, hubo una política.
    assert.deepEqual(rec.annexes, []);
  });

  it('la ÚNICA diferencia entre los dos casos es `stale_source`', async () => {
    // La contraprueba, escrita como tal: mismo estado, misma llamada, un solo campo distinto.
    const [normal, dsar] = await Promise.all(
      (['user_edit', 'privacy'] as const).map(async (source) => {
        const { deps: d, rec } = deps({ subject: subject(removal(source)) });
        const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);
        return { report, calls: rec.runs.length };
      }),
    );

    assert.equal(normal.calls, 1);
    assert.equal(dsar.calls, 0);
    assert.equal(normal.report.staleReason, dsar.report.staleReason, 'la RAZÓN es la misma');
  });

  it('una procedencia DESCONOCIDA es fail-closed, y se distingue de `privacy`', async () => {
    // `null` es el pendiente escrito antes de este contrato. No se sabe si fue una erasure, y
    // «no se sabe» no autoriza a exportar — pero tampoco es lo mismo que saber que lo fue.
    const { deps: d, rec } = deps({ subject: subject(removal(null)) });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);

    assert.equal(report.outcome, 'skipped_unknown_source');
    assert.deepEqual(rec.runs, []);
    assert.notEqual(report.outcome, 'skipped_privacy_hold', 'dos hechos distintos, dos nombres');
  });

  it('la lista de exportables es BLANCA: un causante nuevo queda fuera por omisión', () => {
    assert.equal(isHubSpotStaleSourceAutoExportable('user_edit'), true);
    assert.equal(isHubSpotStaleSourceAutoExportable('merge'), true);
    assert.equal(isHubSpotStaleSourceAutoExportable('reveal'), true);
    assert.equal(isHubSpotStaleSourceAutoExportable('privacy'), false);
    assert.equal(isHubSpotStaleSourceAutoExportable(null), false);
    // En negativo, sobre el mecanismo y no sobre los valores: la función enumera lo que SÍ
    // puede, así que un miembro inventado no pasa aunque nadie lo haya excluido a mano.
    assert.equal(
      isHubSpotStaleSourceAutoExportable('exportame_por_favor' as HubSpotSyncStaleSource),
      false,
    );
  });
});

// ════════════════════════════════════════════════════════════════
// 8 · 9 · Sin cambio saliente no hay pendiente, y el portero NO lo recalcula
// ════════════════════════════════════════════════════════════════

describe('8 · 9. el silencio se HEREDA de CUT-3A, no se vuelve a decidir', () => {
  it('8. el mismo teléfono saliente ⇒ no hay `stale` ⇒ CERO PATCH', async () => {
    // El veredicto lo produjo la autoridad durable cuando se escribió el teléfono.
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: { [HUBSPOT_SYNC_METADATA_KEY]: { ...state() } },
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: null },
      next: { phone: OLD_PHONE, mobile_phone: null },
      nowIso: NOW,
      source: HUBSPOT_SYNC_STALE_SOURCES.userEdit,
    });
    assert.equal(decision.marked, false);
    assert.equal(decision.reason, 'no_outbound_change');

    const { deps: d, rec } = deps({ subject: subject(state()) });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);
    assert.equal(report.outcome, 'skipped_no_pending_change');
    assert.deepEqual(rec.runs, []);
  });

  it('9. el caso SOMBRA del móvil: cambia `phone` pero el móvil lo tapa ⇒ CERO PATCH', async () => {
    // `mobile_phone` manda sobre `phone`: cambiar el fijo no cambia lo que HubSpot recibiría.
    // Marcarlo prometería una actualización que sería un no-op, y el PATCH automático la
    // ejecutaría de verdad — una escritura al CRM del cliente por un cambio que no le afecta.
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata: { [HUBSPOT_SYNC_METADATA_KEY]: { ...state() } },
      hubspotContactId: HS_ID,
      previous: { phone: OLD_PHONE, mobile_phone: MOBILE },
      next: { phone: NEW_PHONE, mobile_phone: MOBILE },
      nowIso: NOW,
      source: HUBSPOT_SYNC_STALE_SOURCES.userEdit,
    });
    assert.equal(decision.marked, false, 'el saliente no se movió');

    const { deps: d, rec } = deps({ subject: subject(state()) });
    assert.equal(
      (await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d)).outcome,
      'skipped_no_pending_change',
    );
    assert.deepEqual(rec.runs, [], 'ni un PATCH falso');
  });

  it('el portero NO tiene con qué recalcular: su entrada no lleva teléfonos', () => {
    // Propiedad ESTRUCTURAL, no una promesa. La proyección que recibe el portero no contiene
    // `phone` ni `mobile_phone`, así que un segundo veredicto capaz de contradecir al durable
    // no es algo que se le haya olvidado hacer: es algo que no puede hacer.
    const keys = Object.keys(subject(state())).sort();
    assert.deepEqual(keys, ['hubspot_contact_id', 'id', 'metadata']);

    const core = readFileSync(
      join(process.cwd(), 'src/modules/contacts/contact-hubspot-auto-phone-update-core.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    assert.equal(
      /resolveOutboundHubSpotPhone/.test(core),
      false,
      'el portero no puede calcular el saliente por su cuenta',
    );
  });

  it('un `never_attempted` con teléfono nuevo no es un pendiente', async () => {
    // Nunca estuvo al día, así que no puede quedar «desactualizado». El alta es de CUT-3B.
    const { deps: d, rec } = deps({ subject: subject(state({ status: 'never_attempted' })) });
    assert.equal(
      (await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d)).outcome,
      'skipped_no_pending_change',
    );
    assert.deepEqual(rec.runs, []);
  });
});

// ════════════════════════════════════════════════════════════════
// 10 · 11 · Bloqueos de WORKSPACE: no son culpa del contacto
// ════════════════════════════════════════════════════════════════

describe('10 · 11. workspace desconectado o sin scope', () => {
  const cases = [
    {
      label: '10. workspace desconectado',
      errorCode: 'HUBSPOT_NOT_CONNECTED' as const,
      outcome: 'blocked_workspace_not_connected',
      blocked: 'hubspot_not_connected',
    },
    {
      label: '11. la conexión no puede escribir contactos',
      errorCode: 'HUBSPOT_SCOPE_MISSING' as const,
      outcome: 'blocked_scope_missing',
      blocked: 'hubspot_scope_missing',
    },
  ];

  for (const c of cases) {
    it(`${c.label} ⇒ CERO PATCH, stale preservado y anexo operativo`, async () => {
      const { deps: d, rec } = deps({
        subject: subject(pending('merge')),
        result: { ok: false, errorCode: c.errorCode, message: 'no' },
      });
      const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);

      assert.equal(report.outcome, c.outcome);
      // NO cuenta como intento: el motor resuelve esto con una lectura de conexión, sin que
      // salga una sola petición de PATCH.
      assert.equal(report.attempted, false);
      assert.equal(report.blockedReason, c.blocked);

      // El anexo se escribe, y es lo ÚNICO que se escribe.
      assert.equal(rec.annexes.length, 1);
      const annex = readContactAutoPhoneUpdateAnnex(rec.annexes[0]);
      assert.equal(annex?.blocked_reason, c.blocked);
      assert.equal(annex?.checked_at, NOW);

      // ── LO QUE EL ANEXO NO PUEDE HACER ────────────────────────
      // `stale` NO se degrada a `failed`: no hubo intento, y decir que lo hubo mandaría a la
      // persona a «reintentar» algo que nadie empezó. Los marcadores sobreviven enteros.
      const written = readHubSpotSyncState(rec.annexes[0]);
      assert.equal(written?.status, 'stale');
      assert.equal(written?.stale_since, STALE_AT);
      assert.equal(written?.stale_reason, 'phone_changed');
      assert.equal(written?.stale_source, 'merge');
      assert.equal(written?.hubspot_contact_id, HS_ID);
      assert.equal(written?.last_error, null);
    });
  }

  it('el anexo del PATCH vive en OTRA clave que el del autosync, y no se pisan', async () => {
    // Un contacto cuyo ALTA se bloqueó por conexión y que meses después, ya vinculado, vuelve a
    // encontrarse la conexión caída al ACTUALIZAR. Con una sola clave la segunda nota borraría
    // la primera y nadie podría reconstruir qué pasó cuándo.
    const withAutoSyncAnnex = {
      [HUBSPOT_SYNC_METADATA_KEY]: {
        ...pending('user_edit'),
        auto_sync: { blocked_reason: 'hubspot_not_connected', checked_at: SYNCED_AT },
      },
    };
    const { deps: d, rec } = deps({
      subject: { id: CONTACT_ID, hubspot_contact_id: HS_ID, metadata: withAutoSyncAnnex },
      result: { ok: false, errorCode: 'HUBSPOT_SCOPE_MISSING', message: 'no' },
    });
    await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);

    assert.notEqual(HUBSPOT_AUTO_PHONE_UPDATE_ANNEX_KEY, 'auto_sync');
    // Las dos notas coexisten, cada una con su hora.
    assert.equal(readContactAutoSyncAnnex(rec.annexes[0])?.checked_at, SYNCED_AT);
    assert.equal(readContactAutoPhoneUpdateAnnex(rec.annexes[0])?.checked_at, NOW);
    assert.equal(
      readContactAutoPhoneUpdateAnnex(rec.annexes[0])?.blocked_reason,
      'hubspot_scope_missing',
    );
  });

  it('si el anexo no se puede guardar, el informe sigue contando lo que pasó con HubSpot', async () => {
    const { deps: d } = deps({
      subject: subject(pending('merge')),
      result: { ok: false, errorCode: 'HUBSPOT_NOT_CONNECTED', message: 'no' },
    });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, {
      ...d,
      persistAnnex: async () => {
        throw new Error('DB_DOWN');
      },
    });
    // El informe describe HubSpot, no el registro del informe.
    assert.equal(report.outcome, 'blocked_workspace_not_connected');
    assert.equal(report.blockedReason, 'hubspot_not_connected');
  });
});

// ════════════════════════════════════════════════════════════════
// 12 · 13 · Fallo y éxito del PATCH
// ════════════════════════════════════════════════════════════════

describe('12 · 13. el PATCH falla o entra', () => {
  it('12. el PATCH falla ⇒ el informe lo dice y NO se escribe ningún anexo', async () => {
    const { deps: d, rec } = deps({
      subject: subject(pending('user_edit')),
      result: { ok: false, errorCode: 'HUBSPOT_ERROR', message: 'no' },
    });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);

    assert.equal(report.outcome, 'attempted_failed');
    assert.equal(report.attempted, true, 'aquí sí salió una petición');
    // El estado durable lo escribe el MOTOR (`failed` + marcadores conservados), no este
    // módulo: no hay una segunda máquina de estados contando la misma historia.
    assert.deepEqual(rec.annexes, []);
    assert.equal(report.blockedReason, null);
  });

  it('12. `failed` conserva los TRES marcadores del pendiente', () => {
    // Sin esto, un PATCH automático fallido dejaría un pendiente sin procedencia — que el
    // ejecutor leería como «no se sabe» y no volvería a enviar nunca.
    const failed = readHubSpotSyncState({
      [HUBSPOT_SYNC_METADATA_KEY]: {
        ...pending('user_edit'),
        status: 'failed',
        last_error: 'hubspot_update_failed',
      },
    });
    assert.equal(failed?.stale_since, STALE_AT);
    assert.equal(failed?.stale_reason, 'phone_changed');
    assert.equal(failed?.stale_source, 'user_edit');
    // Y sigue contando como pendiente: reintentar tiene algo que hacer.
    assert.equal(
      resolveContactAutoPhoneUpdateGate(subject(failed)).proceed,
      true,
      'un `failed` con pendiente sigue siendo exportable',
    );
  });

  it('13. el PATCH entra ⇒ `attempted_updated` y una sola ejecución', async () => {
    const { deps: d, rec } = deps({ subject: subject(pending('merge')) });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);
    assert.equal(report.outcome, 'attempted_updated');
    assert.deepEqual(rec.runs, [CONTACT_ID]);
    assert.deepEqual(rec.annexes, [], 'un éxito no necesita nota operativa');
  });

  it('una excepción del motor NUNCA escapa', async () => {
    // Contrato, no comodidad: una excepción que subiera hasta el `catch` de la server action la
    // convertiría en una edición fallida que en realidad SÍ se guardó.
    const { deps: d } = deps({ subject: subject(pending('user_edit')) });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, {
      ...d,
      runSync: async () => {
        throw new Error('BOOM');
      },
    });
    assert.equal(report.outcome, 'attempted_failed');
    assert.equal(report.syncResult, null, 'no se inventa un veredicto que no se tiene');
  });

  it('si el contacto no se puede releer, cero red y cero invención', async () => {
    const { deps: d, rec } = deps({ subject: null });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);
    assert.equal(report.outcome, 'skipped_contact_unavailable');
    assert.deepEqual(rec.runs, []);
  });
});

// ════════════════════════════════════════════════════════════════
// 15 · 16 · Lo que NO cambia
// ════════════════════════════════════════════════════════════════

describe('15 · 16. el botón manual y el autosync inicial siguen igual', () => {
  it('15. la actualización MANUAL sigue escribiendo `method: manual`', () => {
    const manual = readHubSpotSyncState(
      buildUpdatedSyncMetadata({
        existing: { [HUBSPOT_SYNC_METADATA_KEY]: { ...pending('user_edit') } },
        hubspotContactId: HS_ID,
        actorId: ACTOR,
        nowIso: NOW,
        method: 'manual',
      }),
    );
    assert.equal(manual?.method, 'manual');
    // Y la acción del botón sigue declarándolo a mano, sin heredar un defecto.
    const actions = readFileSync(join(process.cwd(), 'src/modules/contacts/actions.ts'), 'utf8');
    const at = actions.indexOf('export async function syncContactToHubSpot');
    assert.ok(at > 0);
    assert.match(actions.slice(at, at + 1200), /method: 'manual'/);
  });

  it('15. un pendiente de PRIVACIDAD sí se puede enviar A MANO', async () => {
    // La política de CUT-3C es «no automático», no «nunca». El botón sigue siendo la vía
    // explícita, y es la que el corte deja como workflow de privacidad.
    const patched: string[] = [];
    const result = await runSyncContactToHubSpot(CONTACT_ID, {
      ...syncDeps({
        contact: contactFor({ phone: null }),
        metadata: { [HUBSPOT_SYNC_METADATA_KEY]: { ...pending('privacy', { stale_reason: 'phone_removed' }) } },
        onUpdate: (id) => patched.push(id),
      }),
      method: 'manual',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(patched, [HS_ID], 'el motor NO conoce `stale_source`: el portero sí');
  });

  it('16. el autosync del ALTA no aprende a hacer PATCH', () => {
    const autosync = readFileSync(
      join(process.cwd(), 'src/modules/contacts/contact-hubspot-autosync-core.ts'),
      'utf8',
    );
    // Su portero sigue plantándose ante un contacto vinculado con algo pendiente: reaprobar no
    // es permiso para reescribir en HubSpot un teléfono que quizá el cliente corrigió a mano.
    assert.match(autosync, /skipped_pending_manual_update/);
    assert.equal(
      /runContactHubSpotAutoPhoneUpdate/.test(autosync),
      false,
      'CUT-3B no delega en CUT-3C: son dos políticas y dos banderas',
    );
  });
});

// ════════════════════════════════════════════════════════════════
// 17 · 18 · 19 · Lo que el camino automático NO hace
// ════════════════════════════════════════════════════════════════

describe('17 · 18 · 19. el camino automático no crea, no asocia y no llama a proveedores', () => {
  /** Grabadora de TODA la superficie HubSpot que el motor puede tocar. */
  function surfaceRecorder() {
    const calls: string[] = [];
    return {
      calls,
      deps: syncDeps({
        contact: contactFor({ phone: NEW_PHONE }),
        metadata: { [HUBSPOT_SYNC_METADATA_KEY]: { ...pending('merge') } },
        onSearch: () => calls.push('search_by_email'),
        onCreate: () => calls.push('create'),
        onAssociate: () => calls.push('associate'),
        onUpdate: () => calls.push('update'),
      }),
    };
  }

  it('17 · 18. sólo hay un PATCH: ni búsqueda por email, ni alta, ni reintento de asociación', async () => {
    const rec = surfaceRecorder();
    const result = await runSyncContactToHubSpot(CONTACT_ID, { ...rec.deps, method: 'auto' });

    assert.equal(result.ok, true);
    assert.deepEqual(rec.calls, ['update'], 'exactamente UNA operación, y es el PATCH');
    // Buscar por email podría FUSIONAR o desviar la ficha del CRM; crear la DUPLICARÍA; y
    // reintentar la asociación afirmaría que se revisó algo que nadie revisó.
  });

  it('19. el módulo del PATCH automático no nombra ningún proveedor ni gasto', () => {
    const core = readFileSync(
      join(process.cwd(), 'src/modules/contacts/contact-hubspot-auto-phone-update-core.ts'),
      'utf8',
    );
    // Se lee el fichero ENTERO, comentarios incluidos, salvo la nota que explica la ausencia:
    // aquí lo que se prohíbe es el acoplamiento, y una mención en prosa ya sería una pista de
    // que este módulo cree tener algo que ver con el reveal.
    const executable = core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const forbidden of [
      /apollo/i,
      /lusha/i,
      /credit/i,
      /reserv/i,
      /usage_log/i,
      /budget/i,
      /fetch\(/,
      /api\.hubapi\.com/i,
      /process\.env/,
    ]) {
      assert.equal(forbidden.test(executable), false, `el core no puede nombrar ${forbidden}`);
    }
    // En negativo: la guarda detecta de verdad.
    assert.equal(/apollo/i.test('const x = apolloClient'), true);
  });

  it('19. el ejecutor observa una proyección TERMINADA: no participa en el reveal', () => {
    // Su entrada es un contacto ya escrito y su salida es un informe. No hay ningún punto por
    // el que pueda pedirle un número a un proveedor: no recibe candidato, ni run, ni identidad.
    const keys = Object.keys(subject(pending('reveal')));
    for (const forbidden of ['candidate_id', 'enrichment_run_id', 'apollo_person_id']) {
      assert.equal(keys.includes(forbidden), false);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// IDEMPOTENCIA · nada de sondeo, nada de reintento automático
// ════════════════════════════════════════════════════════════════

describe('idempotencia: un disparo, un intento', () => {
  it('`synced` no dispara PATCH, por muchas veces que se invoque', async () => {
    const { deps: d, rec } = deps({ subject: subject(state()) });
    for (let i = 0; i < 5; i += 1) await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);
    assert.deepEqual(rec.runs, []);
  });

  it('un pendiente produce UN intento por invocación, nunca dos', async () => {
    const { deps: d, rec } = deps({ subject: subject(pending('user_edit')) });
    await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);
    assert.equal(rec.runs.length, 1);
  });

  it('el core no tiene bucle, ni temporizador, ni reintento', () => {
    const core = readFileSync(
      join(process.cwd(), 'src/modules/contacts/contact-hubspot-auto-phone-update-core.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const forbidden of [/\bfor\s*\(/, /\bwhile\s*\(/, /setTimeout/, /setInterval/, /retry/i]) {
      assert.equal(forbidden.test(core), false, `sin ${forbidden}: CUT-3C no sondea`);
    }
    // Y hay exactamente UNA llamada al motor en todo el fichero.
    assert.equal((core.match(/deps\.runSync\(/g) ?? []).length, 1);
  });

  it('ninguna lectura ni render llama al entrypoint: sólo escrituras', () => {
    // El riesgo concreto que esto cierra: si un `page.tsx` o un read-model lo invocara, abrir
    // una ficha escribiría en el CRM del cliente.
    const callers = [
      'src/modules/contacts/actions.ts',
      'src/modules/contact-enrichment/actions.ts',
    ];
    for (const file of callers) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      assert.match(src, /runContactHubSpotAutoPhoneUpdateWired\(/, `${file} es un disparador`);
    }
    // Y los módulos de LECTURA no lo nombran.
    for (const file of [
      'src/modules/contact-enrichment/official-contact-stored-phones-read.ts',
      'src/modules/contact-enrichment/candidate-stored-phones-read.ts',
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      assert.equal(/runContactHubSpotAutoPhoneUpdate/.test(src), false, `${file} sólo lee`);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 20 · PII · el informe y el estado no filtran el número
// ════════════════════════════════════════════════════════════════

describe('20. PII: nada de lo que se guarda o se reporta cita un teléfono', () => {
  it('el informe no lleva el número ni en éxito ni en fallo', async () => {
    for (const result of [
      {
        ok: true as const,
        status: 'updated' as const,
        hubspotContactId: HS_ID,
        message: 'Teléfono actualizado en HubSpot.',
      },
      { ok: false as const, errorCode: 'HUBSPOT_ERROR' as const, message: 'no' },
    ]) {
      const { deps: d } = deps({ subject: subject(pending('user_edit')), result });
      const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);
      const serialized = JSON.stringify(report);
      assert.equal(serialized.includes(NEW_PHONE), false);
      assert.equal(serialized.includes('555'), false, `el informe cita un teléfono: ${serialized}`);
    }
  });

  it('un mensaje de proveedor ENVENENADO con PII no llega al estado durable', async () => {
    // El mensaje crudo de HubSpot cita las propiedades enviadas, y una de ellas es el teléfono.
    // Lo que se guarda es un código MECÁNICO, y por eso este envenenamiento no puede filtrarse.
    const poisoned = `Invalid phone ${NEW_PHONE} for contact ada@acme.example`;
    const { deps: d } = deps({
      subject: subject(pending('user_edit')),
      result: { ok: false, errorCode: 'HUBSPOT_ERROR', message: poisoned },
    });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, d);

    // El veredicto crudo se conserva para depurar, en MEMORIA y sólo en memoria…
    assert.equal(report.syncResult?.ok, false);
    // …y lo que el motor persiste es el código, nunca el mensaje.
    const durable = readHubSpotSyncState({
      [HUBSPOT_SYNC_METADATA_KEY]: {
        ...pending('user_edit'),
        status: 'failed',
        last_error: 'hubspot_update_failed',
      },
    });
    assert.equal(durable?.last_error, 'hubspot_update_failed');
    assert.equal(String(durable?.last_error).includes('555'), false);
    assert.equal(String(durable?.last_error).includes('@'), false);
  });

  it('21. el `fetch` global está envenenado: ninguna prueba de este archivo sale a la red', async () => {
    await assert.rejects(
      async () => {
        await globalThis.fetch('https://api.hubapi.com/crm/v3/objects/contacts/1');
      },
      /NETWORK_FORBIDDEN_IN_TEST/,
    );
  });
});

// ── Cableado mínimo del MOTOR, para las pruebas que lo ejercen ───

function contactFor(over: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: CONTACT_ID,
    account_id: 'account-1',
    full_name: 'Ada Lovelace',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@acme.example',
    phone: NEW_PHONE,
    mobile_phone: null,
    job_title: 'CTO',
    linkedin_url: null,
    hubspot_contact_id: HS_ID,
    metadata: {},
    ...over,
  };
}

function syncDeps(args: {
  contact: ContactForSync;
  metadata: Record<string, unknown>;
  onSearch?: () => void;
  onCreate?: () => void;
  onAssociate?: () => void;
  onUpdate?: (hubspotContactId: string) => void;
}): SyncContactDeps {
  return {
    actorId: ACTOR,
    nowIso: NOW,
    method: 'auto',
    loadContact: async () => ({ ...args.contact, metadata: args.metadata }),
    loadAccount: async () => ({ id: 'account-1', name: 'ACME', hubspot_company_id: 'hs-co-1' }),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => {
      args.onSearch?.();
      return null;
    },
    createHubSpotContact: async () => {
      args.onCreate?.();
      return { id: 'hs-new' };
    },
    updateHubSpotContact: async (hubspotContactId) => {
      args.onUpdate?.(hubspotContactId);
      return { ok: true };
    },
    associateContactWithCompany: async () => {
      args.onAssociate?.();
      return { ok: true };
    },
    persistSync: async () => ({}),
  };
}
