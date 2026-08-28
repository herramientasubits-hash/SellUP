/**
 * AGENT2-CONTACT-HUBSPOT-AUTO-PHONE-UPDATE-CUT3C — el CABLEADO de los caminos disparadores.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTA SUITE EXISTE, Y POR QUÉ ES ESTÁTICA
 * ═══════════════════════════════════════════════════════════════════
 *
 * La suite hermana prueba el PORTERO: dado un estado durable, qué deja pasar. Eso es la mitad.
 * La otra mitad es una propiedad del CALL GRAPH y no del portero:
 *
 *   * que el PATCH automático se dispare DESPUÉS de que la escritura local haya confirmado, y
 *     nunca antes — un disparo anterior podría hacer que un fallo de HubSpot arrastrase consigo
 *     la edición o el merge;
 *   * que los caminos de PRIVACIDAD no lo llamen EN ABSOLUTO. La procedencia durable ya lo
 *     impediría, pero una defensa que dependa de un solo mecanismo es una defensa que se cae
 *     cuando ese mecanismo tenga un bug. Aquí la erasure ni siquiera conoce el entrypoint;
 *   * que exista UN solo entrypoint, y que ya no dependa de ninguna bandera (E3:
 *     AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC lo dejó siempre activo, igual que el autosync).
 *
 * Ninguna de esas tres cosas se puede afirmar ejecutando el portero: hay que mirar quién llama a
 * quién y en qué orden. Se lee el fichero, con los comentarios QUITADOS, para que nombrar algo
 * no se confunda con hacerlo.
 *
 * Sin red, sin DB: sólo lectura de ficheros.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** Quita comentarios para que NOMBRAR algo no se confunda con HACERLO. */
const stripTs = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const CONTACTS_ACTIONS = 'src/modules/contacts/actions.ts';
const ENRICHMENT_ACTIONS = 'src/modules/contact-enrichment/actions.ts';
const RUNNER = 'src/modules/contacts/contact-hubspot-sync-runner.ts';
const ENTRYPOINT = 'runContactHubSpotAutoPhoneUpdateWired';

/** El cuerpo de una función exportada, desde su `export async function` hasta el siguiente. */
function bodyOf(src: string, name: string): string {
  const at = src.indexOf(`export async function ${name}`);
  assert.ok(at > 0, `falta ${name}`);
  const next = src.indexOf('\nexport ', at + 10);
  return src.slice(at, next === -1 ? src.length : next);
}

// ════════════════════════════════════════════════════════════════
// UN SOLO ENTRYPOINT, Y UNA SOLA PUERTA A LA BANDERA
// ════════════════════════════════════════════════════════════════

describe('el entrypoint es único y ya no depende de ninguna bandera', () => {
  const runner = stripTs(read(RUNNER));

  it('el runner define el entrypoint y ya NO lee ninguna bandera: siempre activo', () => {
    assert.match(runner, new RegExp(`export async function ${ENTRYPOINT}`));
    assert.equal(
      runner.includes('isHubSpotContactAutoPhoneUpdateEnabled'),
      false,
      'el auto-update de teléfono no puede depender del flag: la decisión es "siempre activo", igual que el autosync de contactos (Task E2)',
    );
  });

  it('ningún llamador conoce la bandera: no puede olvidarse de comprobarla', () => {
    // El punto no es la disciplina, es la IMPOSIBILIDAD: un camino nuevo que llame al
    // entrypoint hereda la comprobación porque no tiene forma de saltársela.
    for (const file of [CONTACTS_ACTIONS, ENRICHMENT_ACTIONS]) {
      const src = stripTs(read(file));
      assert.equal(
        /isHubSpotContactAutoPhoneUpdateEnabled|HUBSPOT_CONTACT_AUTO_PHONE_UPDATE/.test(src),
        false,
        `${file} no puede resolver la bandera por su cuenta`,
      );
    }
  });

  it('el cliente se construye perezosamente, dentro del lector', () => {
    // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC quitó la bandera: el entrypoint corre siempre.
    // Esta prueba ya no depende de un estado "apagado" que no existe — sigue viva porque la
    // pereza en sí es una propiedad deseable: un `createClient()` en el cuerpo del entrypoint se
    // ejecutaría en cada guardado de contacto aunque `loadSubject` nunca llegara a usarlo.
    const entry = runner.slice(
      runner.indexOf(`export async function ${ENTRYPOINT}`),
      runner.indexOf('loadSubject:'),
    );
    assert.equal(/createClient\(\)/.test(entry), false, 'el cliente se construye perezosamente');
    // Y sí se construye donde toca: dentro del lector.
    const lazy = runner.slice(runner.indexOf('loadSubject:'));
    assert.match(lazy, /const supabase = await createClient\(\);/);
  });

  it('el core sigue recibiendo el booleano ya resuelto y NO lee el entorno', () => {
    const core = stripTs(read('src/modules/contacts/contact-hubspot-auto-phone-update-core.ts'));
    assert.equal(/process\.env/.test(core), false);
    assert.match(core, /enabled: boolean/);
  });

  it('el motor se reutiliza: no hay un segundo constructor de dependencias', () => {
    // Una segunda implementación «para el automático» tendría su propia idea de qué significa un
    // saliente `null`, y el día que divergieran una de las dos BORRARÍA en el CRM del cliente un
    // número que SellUp sí tiene.
    assert.match(runner, /runSyncContactToHubSpot\(/);
    assert.match(runner, /buildContactHubSpotSyncDeps\(\{/);
    assert.match(runner, /method: 'auto'/);
    // Y el `updateHubSpotContact` sigue viniendo del adaptador único, no de una copia.
    assert.match(runner, /from '@\/server\/integrations\/hubspot-contact-sync'/);
  });
});

// ════════════════════════════════════════════════════════════════
// 7 · LA EDICIÓN MANUAL — la fase 2 va DESPUÉS del commit
// ════════════════════════════════════════════════════════════════

describe('7. updateContact dispara el PATCH después de guardar, nunca antes', () => {
  const src = stripTs(read(CONTACTS_ACTIONS));
  const fn = bodyOf(src, 'updateContact');

  it('el orden es: update() → comprobar error → entrypoint', () => {
    const write = fn.indexOf(".from('contacts').update(payload)");
    const guard = fn.indexOf('if (error) return { success: false');
    const trigger = fn.indexOf(ENTRYPOINT);

    assert.ok(write > 0 && guard > write && trigger > guard, 'el orden importa y es éste');
  });

  it('el resultado de la edición NO depende del PATCH', () => {
    // Ni un `if` sobre el informe que pudiera convertir un HubSpot caído en un guardado
    // fallido. El informe se ADJUNTA; nunca sustituye al veredicto local.
    assert.match(fn, /const hubspotAutoPhoneUpdate = await runContactHubSpotAutoPhoneUpdateWired/);
    assert.match(fn, /return \{ success: true, hubspotAutoPhoneUpdate \};/);
    assert.equal(
      /hubspotAutoPhoneUpdate[\s\S]{0,200}?success: false/.test(fn),
      false,
      'ningún camino convierte un fallo de HubSpot en una edición fallida',
    );
    // Y hay exactamente UN retorno de éxito: no existe una rama que devuelva `success: true`
    // sin haber pasado por la fase 2 ni una que la duplique.
    assert.equal((fn.match(/return \{ success: true/g) ?? []).length, 1);
  });

  it('la marca de `stale` sigue viajando DENTRO del mismo update()', () => {
    // El trinquete de CUT-2, intacto. Una segunda escritura dejaría la ventana con el teléfono
    // nuevo guardado y el estado diciendo `synced` — y ahora sería peor, porque el PATCH
    // automático leería ese `synced` y no enviaría nada.
    const mark = fn.indexOf('markContactHubSpotSyncStaleForPhoneChange');
    const write = fn.indexOf(".from('contacts').update(payload)");
    assert.ok(mark > 0 && mark < write, 'la decisión precede a la ÚNICA escritura');
    assert.match(fn, /if \(staleDecision\.marked\) payload\.metadata = staleDecision\.metadata;/);
    // Lo que se prohíbe es una escritura de contacto DESPUÉS de la del payload. Antes hay una
    // legítima —la degradación del `is_primary` anterior— que no toca teléfono ni estado.
    const afterWrite = fn.slice(write + 1);
    assert.equal(
      /\.from\('contacts'\)[\s\S]{0,200}?\.update\(/.test(afterWrite),
      false,
      'sin una segunda escritura de contacto tras la del payload',
    );
    // En negativo, para que la guarda no sea decorativa.
    assert.equal(
      /\.from\('contacts'\)[\s\S]{0,200}?\.update\(/.test(
        "await supabase.from('contacts').update({ metadata: m })",
      ),
      true,
    );
  });

  it('declara `user_edit` explícitamente, sin heredar un defecto', () => {
    assert.match(fn, /source: HUBSPOT_SYNC_STALE_SOURCES\.userEdit/);
  });
});

// ════════════════════════════════════════════════════════════════
// 6 · 23 · EL MERGE — la RPC sigue siendo UNA transacción
// ════════════════════════════════════════════════════════════════

describe('6 · 23. el merge dispara el PATCH tras la RPC, y la RPC sigue intacta', () => {
  const src = stripTs(read(ENRICHMENT_ACTIONS));
  const fn = bodyOf(src, 'mergeContactCandidateIntoExistingContactAction');

  it('la fase 2 es posterior a la RPC y sólo corre si el merge fue bien', () => {
    const rpc = fn.indexOf('runMergeCandidateIntoExistingContact(');
    const guard = fn.indexOf('if (!result.ok || !result.contactId) return result;');
    const trigger = fn.indexOf(ENTRYPOINT);
    assert.ok(rpc > 0 && guard > rpc && trigger > guard);
  });

  it('el éxito del merge no depende del PATCH', () => {
    assert.match(fn, /return \{ \.\.\.result, hubspotAutoPhoneUpdate \};/);

    // Entre el disparo y el retorno no hay NADA que pueda degradar el veredicto local: ni un
    // `if` sobre el informe, ni un `ok: false`. El único `ok: false` del cuerpo es el del
    // `catch` exterior, que existe desde 4O-H3-B y describe un merge que de verdad no ocurrió.
    const trigger = fn.indexOf(ENTRYPOINT);
    const ret = fn.indexOf('return { ...result, hubspotAutoPhoneUpdate };');
    assert.ok(trigger > 0 && ret > trigger);
    const between = fn.slice(trigger, ret);
    assert.equal(/ok: false/.test(between), false, 'nada degrada el veredicto del merge');
    assert.equal(/if \(/.test(between), false, 'ni una rama sobre el informe');
  });

  it('23. la RPC 117 sigue siendo UNA sola transacción local', () => {
    // El trinquete de 4O-H3-B, y lo que CUT-3C añade NO lo viola: el PATCH es una llamada de
    // RED que ocurre cuando la ventana ya está cerrada por la propia transacción.
    const persistence = stripTs(read('src/modules/contact-enrichment/existing-contact-merge-persistence.ts'));
    assert.equal((persistence.match(/\.rpc\(/g) ?? []).length, 1);
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      assert.equal(persistence.includes(forbidden), false, `${forbidden} no puede existir aquí`);
    }
    // Y la acción no adquiere una segunda escritura de contacto.
    assert.equal(/\.from\('contacts'\)[\s\S]{0,200}?\.update\(/.test(fn), false);
  });

  it('la acción del merge no marca `stale` ella misma: eso vive en SQL', () => {
    for (const forbidden of [
      /markContactHubSpotSyncStaleForPhoneChange/,
      /stale_reason/,
      /stale_source/,
      /writeHubSpotSyncState/,
    ]) {
      assert.equal(forbidden.test(fn), false, `la acción no puede usar ${forbidden}`);
    }
  });

  it('15. los trinquetes de gasto y proveedor del merge siguen vivos', () => {
    for (const forbidden of [/apollo/i, /lusha/i, /reserv/i, /usage_log/i, /credit/i]) {
      assert.equal(forbidden.test(fn), false, `la acción no puede mencionar ${forbidden}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 5 · 22 · PRIVACIDAD — doble defensa, y la segunda es estructural
// ════════════════════════════════════════════════════════════════

describe('5 · 22. los caminos de privacidad no conocen el entrypoint', () => {
  const privacyFiles = [
    'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
    'src/modules/contact-enrichment/phone-cache-suppression-core.ts',
    'src/modules/contact-enrichment/official-contact-phone-suppression-persistence.ts',
    'src/modules/contact-enrichment/official-contact-phone-suppression-core.ts',
  ];

  it('ninguno de ellos puede disparar un PATCH: no lo importan ni lo nombran', () => {
    // La procedencia durable YA lo impediría. Esto es la segunda cerradura, y es la que sigue
    // cerrada si la primera tiene un bug: desde la erasure el entrypoint no es alcanzable.
    for (const file of privacyFiles) {
      const src = stripTs(read(file));
      assert.equal(
        /runContactHubSpotAutoPhoneUpdate/.test(src),
        false,
        `${file} no puede exportar una erasure`,
      );
    }
  });

  it('la supresión escribe `privacy`, y es el ÚNICO sitio de TypeScript que lo hace', () => {
    const core = stripTs(read('src/modules/contact-enrichment/phone-cache-suppression-core.ts'));
    assert.match(core, /source: HUBSPOT_SYNC_STALE_SOURCES\.privacy/);

    // Y nadie más lo escribe. Un segundo escritor de `privacy` sería un sitio donde alguien
    // podría marcar como privacidad algo que no lo es —o, peor, dejar de marcarlo.
    const others = [CONTACTS_ACTIONS, ENRICHMENT_ACTIONS, RUNNER];
    for (const file of others) {
      const src = stripTs(read(file));
      assert.equal(
        /STALE_SOURCES\.privacy|'privacy'/.test(src),
        false,
        `${file} no puede declarar procedencia de privacidad`,
      );
    }
  });

  it('22. los trinquetes de privacidad siguen prohibiendo la exportación desde la erasure', () => {
    const core = stripTs(read('src/modules/contact-enrichment/phone-cache-suppression-core.ts'));
    for (const forbidden of [/api\.hubapi\.com/i, /fetch\(/, /updateHubSpotContact/]) {
      assert.equal(forbidden.test(core), false, `la erasure no puede ${forbidden}`);
    }
  });

  it('la 115 escribe `privacy` en SQL, dentro de la transacción de la erasure', () => {
    const sql = read('supabase/migrations/130_agent2_contact_hubspot_stale_source.sql');
    const at = sql.indexOf('CREATE OR REPLACE FUNCTION public.suppress_official_contact_phone_sources');
    assert.ok(at > 0, 'falta la 115 re-emitida');
    const fn115 = sql.slice(at);
    assert.match(fn115, /mark_contact_hubspot_sync_stale_for_phone\(\s*\n?\s*p_contact_id, v_hs_prev_out, p_suppressed_at, 'privacy'/);
    // Y la 117 escribe `merge`, no `privacy`: cada escritor declara lo que es.
    const fn117 = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.merge_contact_candidate_into_existing_contact'),
      at,
    );
    assert.match(fn117, /p_contact_id, v_hs_prev_out, p_now, 'merge'/);
    assert.equal(/'privacy'/.test(fn117), false, 'el merge no puede declararse privacidad');
  });
});

// ════════════════════════════════════════════════════════════════
// 16 · EL AUTOSYNC DEL ALTA no cambia
// ════════════════════════════════════════════════════════════════

describe('16. la aprobación ya NO repite el autosync del ALTA inline: delega en triggerContactHubSpotSync', () => {
  const src = stripTs(read(ENRICHMENT_ACTIONS));
  const fn = bodyOf(src, 'approveContactCandidate');

  // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC reemplazó el hook de CUT-3B: la SEGUNDA fase de la
  // aprobación ya no invoca `runContactHubSpotAutoSync` inline ni lee su propia bandera —delega
  // en `triggerContactHubSpotSync` (que primero resuelve la empresa y siempre está activo).
  it('ya no invoca el motor de autosync inline ni lee su propia bandera: delega en el hook de HubSpot', () => {
    assert.equal(
      /runContactHubSpotAutoSync\(/.test(fn),
      false,
      'el autosync inline se reemplazó por triggerContactHubSpotSync',
    );
    assert.equal(
      /isHubSpotContactAutoSyncEnabled\(\)/.test(fn),
      false,
      'el hook de aprobación ya no lee esa bandera: siempre activo',
    );
    assert.match(fn, /triggerContactHubSpotSync\(/);
  });

  it('la aprobación NO adquiere el PATCH automático', () => {
    // Son dos políticas distintas. Un contacto recién aprobado no tiene nada pendiente —lo
    // que hay en HubSpot es lo que se acaba de enviar—, así que llamar aquí al PATCH sería, en
    // el mejor caso, una lectura inútil y, en el peor, una escritura que nadie pidió.
    assert.equal(
      /runContactHubSpotAutoPhoneUpdate/.test(fn),
      false,
      'la aprobación no dispara el PATCH automático',
    );
  });

  it('el resultado de la aprobación ya no lleva un informe de HubSpot: se devuelve tal cual', () => {
    assert.equal(/return \{ \.\.\.result, hubspotAutoSync \};/.test(fn), false);
    assert.match(fn, /return result;/);
  });
});

// ════════════════════════════════════════════════════════════════
// 17 · 18 · 19 · La superficie del camino automático
// ════════════════════════════════════════════════════════════════

describe('17 · 18 · 19. el cableado automático no crea, no asocia y no llama a proveedores', () => {
  const runner = stripTs(read(RUNNER));
  const entry = runner.slice(runner.indexOf(`export async function ${ENTRYPOINT}`));

  it('17. el entrypoint no puede buscar por email ni crear: sólo releer y delegar', () => {
    assert.equal(/findHubSpotContactByEmail\(/.test(entry), false);
    assert.equal(/createHubSpotContact\(/.test(entry), false);
    // Lo que SÍ hace: releer tres columnas y pasar el motor.
    assert.match(entry, /\.select\('id, hubspot_contact_id, metadata'\)/);
  });

  it('18. no reintenta la asociación con la empresa', () => {
    assert.equal(/associateContactWithCompany|associateHubSpotContactWithCompany/.test(entry), false);
  });

  it('19. no nombra ningún proveedor ni contabilidad', () => {
    for (const forbidden of [/apollo/i, /lusha/i, /credit/i, /reserv/i, /usage_log/i]) {
      assert.equal(forbidden.test(entry), false, `el entrypoint no puede nombrar ${forbidden}`);
    }
  });

  it('el anexo se persiste con el escritor que SÓLO puede escribir metadata', () => {
    assert.match(entry, /persistAnnex: async \(id, metadata\) => persistContactMetadata\(/);
    const persist = runner.slice(runner.indexOf('export async function persistContactMetadata'));
    // Ni teléfono, ni vínculo, ni estado: un escritor capaz de tocarlos podría degradar un
    // `stale` a `failed` por una conexión caída, o perder el pendiente entero.
    for (const forbidden of [/phone/, /hubspot_contact_id/, /status/]) {
      assert.equal(forbidden.test(persist.slice(0, 600)), false, `el anexo no puede escribir ${forbidden}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// UI · nada de badges nuevos
// ════════════════════════════════════════════════════════════════

describe('la UI cuenta el estado sin inventar un badge', () => {
  const sheet = read('src/components/contacts/contact-detail-sheet.tsx');

  it('el vocabulario de badges no crece', () => {
    // Los estados siguen siendo los seis de CUT-1: `stale` ya dice «Pendiente de actualizar» y
    // un `failed` con pendiente ya dice «Error al actualizar». CUT-3C no añade ninguno.
    //
    // BACKFILL LEGACY movió la DECISIÓN del copy fuera del componente: ahora la toma
    // `resolveHubSpotSyncPresentation`, junto al vocabulario, para que el drawer y la tarjeta de
    // trazabilidad no puedan volver a discrepar. Lo que se afirma aquí sigue siendo lo mismo —el
    // vocabulario no crece— sólo que se afirma donde ahora vive.
    const labels = read('src/modules/contacts/contact-hubspot-sync-state.ts');
    assert.match(labels, /Error al actualizar/);
    assert.match(labels, /HUBSPOT_SYNC_STATUS_LABELS\[state\.status\]/);
    // AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — el badge del drawer se mudó a
    // `contact-hubspot-sync-badge.tsx` (sin `'use client'`, para que la página de detalle
    // legada pueda renderizarlo). Se sigue exigiendo que el copy lo pida la autoridad; se
    // exige en el módulo donde ahora vive, y que el drawer lo consuma.
    assert.match(
      read('src/components/contacts/contact-hubspot-sync-badge.tsx'),
      /resolveHubSpotSyncPresentation\(/,
    );
    assert.match(sheet, /ContactHubSpotSyncBadge/);
    const block = labels.slice(
      labels.indexOf('HUBSPOT_SYNC_STATUS_LABELS'),
      labels.indexOf('HUBSPOT_SYNC_STATUS_LABELS') + 600,
    );
    assert.match(block, /stale: 'Pendiente de actualizar'/);
    assert.equal(/auto_update:/.test(block), false, 'el anexo no es un status');
  });

  it('el anexo del PATCH se muestra sólo mientras siga habiendo algo pendiente', () => {
    const at = sheet.indexOf('readContactAutoPhoneUpdateAnnex(');
    assert.ok(at > 0, 'la UI debe leer el anexo del PATCH');
    const before = sheet.slice(Math.max(0, at - 400), at);
    assert.match(before, /hasPendingHubSpotPhoneChange\(state\)/);
    assert.match(sheet, /No se pudo actualizar automáticamente porque/);
  });

  it('la retención por privacidad se explica sin afirmar un fallo', () => {
    assert.match(sheet, /state\?\.stale_source !== 'privacy'/);
    assert.match(sheet, /no se envía\s*\n?\s*automáticamente/);
    // Y el copy general deja de prometer que NADA es automático, que dejó de ser cierto.
    assert.equal(
      /se envía con el\s*\n?\s*botón, nunca de forma automática/.test(sheet),
      false,
      'el copy no puede seguir prometiendo que nunca hay envío automático',
    );
  });
});
