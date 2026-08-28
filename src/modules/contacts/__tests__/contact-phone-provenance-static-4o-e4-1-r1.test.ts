/**
 * Agente 2A — guardas ESTÁTICAS de la invalidación de procedencia al editar
 * `contacts.phone` a mano (AGENT2A-PHONE-REVEAL-4O-E4.1-R1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ PROTEGE Y POR QUÉ NO BASTA EL TEST DE COMPORTAMIENTO
 * ═══════════════════════════════════════════════════════════════════
 *
 * R1 es correcto sólo mientras se cumplan hechos del REPOSITORIO que el core no
 * puede observar:
 *
 *   * que `updateContact` —el ÚNICO escritor humano de `contacts.phone`— use el
 *     helper compartido en vez de volver a escribir `phone` a secas. Si alguien
 *     reintroduce `payload.phone = …`, el defecto vuelve y las pruebas de
 *     comportamiento seguirían verdes: prueban el helper, no a quien lo llama;
 *   * que el número y la procedencia se escriban en UN solo `update()`. Dos
 *     escrituras dejarían viva la ventana exacta que borra el dato equivocado;
 *   * que el formulario manual siga SIN selector de tipo de teléfono. Ésa es la
 *     premisa que autoriza `phone_type = NULL`; si aparece un selector, el helper
 *     tiene que aprender a recibir el tipo introducido;
 *   * que las pruebas de privacidad dejen de FABRICAR `phone_source = 'manual'` en
 *     SQL a mano. Ése era el vicio de E4: demostraban una propiedad de un escritor
 *     que no existía;
 *   * que R1 no reabra nada de 4O-E4.1 (`mobile_phone` sin procedencia) ni invente
 *     vocabulario o esquema nuevos.
 *
 * Sin proveedores, sin créditos, sin DB, sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contacts → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(repoRoot, 'supabase', 'migrations');

const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), 'utf8');

/**
 * Quita comentarios. Las guardas de «esto NO aparece en el código» miran CÓDIGO:
 * este módulo documenta largamente el defecto que corrige —incluida la forma
 * incorrecta— y una guarda que leyera el texto crudo se mediría a sí misma.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CONTACT_ACTIONS = ['src', 'modules', 'contacts', 'actions.ts'];
const PROVENANCE = ['src', 'modules', 'contacts', 'contact-phone-provenance.ts'];
const CONTACT_TYPES = ['src', 'modules', 'contacts', 'types.ts'];
const EDIT_DRAWER = ['src', 'components', 'contacts', 'edit-contact-drawer.tsx'];
const SUPPRESSION_CORE = [
  'src',
  'modules',
  'contact-enrichment',
  'phone-cache-suppression-core.ts',
];
const WORKFLOW = ['.github', 'workflows', 'automatic-routing-tests.yml'];
const PACKAGE_JSON = ['package.json'];

/** Cuerpo de `updateContact`, desde su firma hasta la siguiente cabecera de sección. */
function updateContactBody(): string {
  const source = stripComments(read(...CONTACT_ACTIONS));
  const start = source.indexOf('export async function updateContact');
  assert.ok(start > 0, '`updateContact` debe seguir existiendo');
  const rest = source.slice(start);
  const end = rest.indexOf('export async function archiveContact');
  assert.ok(end > 0, 'no se encontró el final de `updateContact`');
  return rest.slice(0, end);
}

function createContactBody(): string {
  const source = stripComments(read(...CONTACT_ACTIONS));
  const start = source.indexOf('export async function createContact');
  assert.ok(start > 0, '`createContact` debe seguir existiendo');
  const rest = source.slice(start);
  const end = rest.indexOf('export async function updateContact');
  assert.ok(end > 0);
  return rest.slice(0, end);
}

// ═══════════════════════════════════════════════════════════════
// 1. El escritor real usa el helper compartido
// ═══════════════════════════════════════════════════════════════

describe('R1 estático — `updateContact` delega la procedencia en el helper', () => {
  it('importa `resolveManualContactPhoneEdit` desde el módulo puro', () => {
    const source = stripComments(read(...CONTACT_ACTIONS));
    assert.match(
      source,
      /import\s*\{[^}]*\bresolveManualContactPhoneEdit\b[^}]*\}\s*from\s*'\.\/contact-phone-provenance'/,
      'la semántica de procedencia no puede duplicarse dentro de la acción',
    );
  });

  it('lo invoca con el teléfono ACTUAL y el del input', () => {
    const body = updateContactBody();
    assert.match(body, /resolveManualContactPhoneEdit\(\{/);
    assert.match(body, /currentPhone:\s*current\.phone/);
    assert.match(body, /inputPhone:\s*input\.phone/);
  });

  it('NO vuelve a escribir `payload.phone` por su cuenta', () => {
    const body = updateContactBody();
    assert.equal(
      /payload\.phone\s*=/.test(body),
      false,
      'reintroducir la asignación directa resucita el defecto de R1',
    );
    assert.equal(
      /payload\.phone_source\s*=/.test(body),
      false,
      'la procedencia sólo puede venir del patch del helper',
    );
  });

  it('sólo aplica el patch en `replaced` / `cleared`', () => {
    const body = updateContactBody();
    assert.match(body, /phoneEdit\.kind === 'replaced'/);
    assert.match(body, /phoneEdit\.kind === 'cleared'/);
  });

  it('escribe número y procedencia en UN solo `update()` de contacts', () => {
    const body = updateContactBody();
    // El único `.update(` con el payload completo. La otra escritura de la acción
    // (degradar `is_primary` de la fila hermana) no toca teléfono.
    const updates = body.match(/\.update\(/g) ?? [];
    assert.equal(updates.length, 2, 'aparecieron escrituras nuevas a revisar');
    assert.match(body, /\.update\(payload\)\.eq\('id', id\)/);
    assert.match(
      body,
      /Object\.assign\(payload, phoneEdit\.patch\)/,
      'el patch tiene que fusionarse en el payload, no escribirse aparte',
    );
    // La degradación de is_primary no puede haber ganado columnas de teléfono.
    const primaryUpdate = body.slice(
      body.indexOf(".update({ is_primary: false })"),
    );
    assert.ok(primaryUpdate.startsWith(".update({ is_primary: false })"));
  });

  it('`mobile_phone` sigue escribiéndose fuera del patch de procedencia', () => {
    const body = updateContactBody();
    assert.match(body, /payload\.mobile_phone = input\.mobile_phone\?\.trim\(\) \|\| null/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. El helper puro no se sale de su alcance
// ═══════════════════════════════════════════════════════════════

describe('R1 estático — el helper de procedencia', () => {
  it('NO menciona `mobile_phone` en código (4O-E4.1 intacto)', () => {
    assert.equal(
      /mobile_phone/.test(stripComments(read(...PROVENANCE))),
      false,
      'inferir el origen de `mobile_phone` desde `phone_source` fue el error que E4.1 retiró',
    );
  });

  it('sólo emite `manual` o NULL como procedencia', () => {
    const code = stripComments(read(...PROVENANCE));
    const sources = code.match(/phone_source:\s*[^,\n]+/g) ?? [];
    assert.ok(sources.length > 0);
    for (const line of sources) {
      assert.ok(
        /'manual'/.test(line) || /null/.test(line) || /ContactPhoneSource/.test(line),
        `procedencia inesperada emitida por el helper: ${line}`,
      );
    }
    for (const forbidden of ['apollo_reveal', 'apollo_cache', 'lusha_reveal']) {
      assert.equal(
        code.includes(forbidden),
        false,
        'el helper nunca puede ESCRIBIR una procedencia de proveedor',
      );
    }
  });

  it('no hereda el tipo del proveedor: `phone_type` siempre NULL', () => {
    const code = stripComments(read(...PROVENANCE));
    assert.match(code, /phone_type:\s*null/);
    assert.equal(
      /phone_type:\s*(current|previous|row|args)/.test(code),
      false,
      'conservar el tipo describiría un número que ya no está guardado',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Premisa CONGELADA: el formulario no declara tipo de teléfono
// ═══════════════════════════════════════════════════════════════

describe('R1 estático — premisa del tipo manual', () => {
  it('`UpdateContactInput` no acepta `phone_type` ni `phone_source`', () => {
    const types = read(...CONTACT_TYPES);
    const iface = types.match(/interface UpdateContactInput \{([\s\S]*?)\n\}/);
    assert.ok(iface, '`UpdateContactInput` debe seguir existiendo');
    assert.equal(
      /phone_type|phone_source/.test(iface[1]),
      false,
      'si el input acepta tipo o procedencia, R1 debe dejar de forzar NULL/manual y usarlos',
    );
  });

  it('el formulario de edición no tiene selector de tipo ni de procedencia', () => {
    const drawer = stripComments(read(...EDIT_DRAWER));
    assert.equal(
      /phone_type|phone_source/.test(drawer),
      false,
      'un selector de tipo obliga a que el helper reciba el valor introducido',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Vocabulario y esquema: R1 no inventa nada
// ═══════════════════════════════════════════════════════════════

describe('R1 estático — sin vocabulario ni esquema nuevos', () => {
  it("'manual' ya es válido en el CHECK real de `contacts.phone_source`", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '094_contact_phone_metadata.sql'), 'utf8');
    const check = sql.match(/contacts_phone_source_check[\s\S]*?\)\s*NOT VALID/);
    assert.ok(check, 'el CHECK de 094 debe seguir presente');
    assert.match(check[0], /'manual'/);
  });

  it('R1 no añade migraciones (el techo es el del último hito conocido)', () => {
      // AGENT2A-PHONE-REVEAL-4O-H1 movió el techo a la 114 (el esquema OFICIAL de
      // múltiples teléfonos, creado INERTE, con su propia guarda estática en
      // official-contact-phone-schema-static-4o-h1.test.ts) y AGENT2A-PHONE-REVEAL-4O-H2
      // a la 115 (la PRIVACIDAD de ese esquema: contadores de auditoría y
      // `suppress_official_contact_phone_sources`, con su propia guarda). Lo que ESTA
      // guarda protege no es el número más alto —sube cada vez que un bloque autorizado
      // añade el suyo— sino que este hito no aportó ninguna migración y que nadie coló
      // una por encima del último hito conocido.
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // ── AGENT2-FINAL-INTEGRATION: ya NO hay ficheros sin numerar ────────
    //
    // OLD_INVARIANT: «todo fichero sin numerar está DECLARADO aquí por nombre». Existía porque
    // los cuatro archivos de Agente 2 nacieron con prefijo `LOCAL_` a propósito, y sin esa
    // declaración «llámalo LOCAL_ y desaparece del radar» habría sido una vía de escape.
    //
    // NEW_INVARIANT, ESTRICTAMENTE MÁS FUERTE: el directorio no contiene NINGÚN fichero fuera
    // de la secuencia desplegable. AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 canonicalizó los
    // cuatro a 129/130/131/132, así que ya no hay nada que declarar por separado: todos pasan
    // por la MISMA barrida de techo que las 128 anteriores, y la lista de excepciones —que era
    // el único punto blando— desaparece en vez de crecer.
    const numbered = all.filter((f) => /^\d{3}_/.test(f));
    assert.deepEqual(
      all.filter((f) => !/^\d{3}_/.test(f)),
      [],
      'ningún fichero de migración puede quedar fuera de la secuencia numerada',
    );
    assert.equal(numbered.length, all.length, 'techo y directorio son el mismo conjunto');

    // Control NEGATIVO del filtro, sobre nombres SINTÉTICOS: si `\d{3}_` aceptara un prefijo no
    // numérico, la afirmación de arriba se quedaría vacía y no probaría nada.
    assert.equal(/^\d{3}_/.test('LOCAL_example_unnumbered.sql'), false);
    assert.equal(/^\d{3}_/.test('132_agent2_hubspot_legacy_sync_state_backfill.sql'), true);

    const last = numbered[numbered.length - 1];
    assert.equal(
      last,
      // 4O-H3 movió el techo a la 116 (la APROBACIÓN atómica: una sola función
      // transaccional, sin DDL). R1 sigue sin aportar ninguna.
      // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 mueve el techo a la 119: catálogo de
      // Macro Industrias, sin relación con teléfono. R1 sigue sin aportar ninguna.
      // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) mueve el techo a la 120:
      // `provider_suppressions` + `provider_suppression_audit` — supresión de teléfono por
      // identidad NATIVA del proveedor y SIN cuenta, backfill idempotente del tombstone
      // legado y `CREATE OR REPLACE` del helper transaccional. Es ADITIVA: no borra
      // columna, no suelta constraint y no reescribe ninguna migración anterior.
      // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 mueve el techo a la 121: la liquidación
      // TRUTHFUL del sobrepaso de presupuesto (Agente 1, contabilidad). No es de teléfono
      // y R1 sigue sin aportar ninguna.
      // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números»
      // (Agente 2A). Es de teléfono, pero no de este hito: añade la modalidad `search_more`
      // y una función que AÑADE teléfonos al CANDIDATO, y no toca lo que esta guarda vigila.
      // AGENT1-PROVIDER-SEEN-MEMORY-2 mueve el techo a la 123: la memoria de qué empresa ya
      // nos mostró un proveedor de PAGO (Agente 1, economía de descubrimiento). NO es de
      // teléfono en absoluto: crea `provider_seen_entities`, que sólo guarda identidad de
      // EMPRESA —id nativo del proveedor y dominio normalizado— y no nombra ninguna tabla,
      // columna ni función de teléfono. Se declara NO aplicada en Producción.
      // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: identidad provider-native
      // (`contact_provider_identities`), grano de reserva por OPERACIÓN y claim propio de
      // la búsqueda de identidad. Trae su propia guarda estática y NO edita ninguna
      // migración anterior — que es lo que esta lista exacta vigila. NO aplicada en Prod.
      // BR-SOURCE-FUNCTIONAL-CUT-A movió el techo a la 125 originalmente: la identidad MENSUAL
      // del snapshot de Receita (`source_period` + unicidad period-aware en
      // `source_company_snapshots`, estado de publicación en `source_snapshot_runs`). NO es de
      // teléfono y NO edita ninguna migración anterior.
      //
      // BR-SOURCE CUT A.1 RENUMERÓ esa migración DOS VECES: 125→126→127. El primer salto —su
      // cuerpo SQL no cambió en nada que afecte a esta cadena— añadió una migración 125 genérica
      // y nueva (unicidad de `record_identity_key` sobre `source_company_snapshots` para fuentes
      // NO brasileñas). El segundo lo forzó AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY, que reclamó
      // el 126 de forma independiente: el vallado optimista de la admisión por identidad de LOTE
      // (Agente 1), que añade `prospect_batches.identity_epoch` y dos funciones sobre
      // `prospect_batches` y `prospect_candidates`. Ninguna de las tres es de teléfono ni edita
      // una migración anterior — que es lo que esta aserción vigila. Las tres AUTORADAS y NO
      // APLICADAS.
      // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 movió el techo a la 128: la
      // proyección candidato→contacto tras la aprobación. NO toca `mobile_phone` (sólo la nombra
      // en prosa para declarar que MOBILE_PHONE_PROVENANCE_PENDING sigue en pie) y no introduce
      // vocabulario nuevo de procedencia. AUTORADA y NO APLICADA.
      //
      // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 lo mueve a la 132 al canonicalizar el tramo
      // de Agente 2 (129 completitud del `stale`, 130 su PROCEDENCIA, 131 la re-emisión de la 128
      // que produce el pendiente con procedencia `reveal`, 132 la línea base de los contactos ya
      // vinculados). Las cuatro son de HubSpot y de teléfono, así que el barrido de esta suite
      // SÍ les aplica y por eso importan aquí: ninguna escribe `mobile_phone` ni inventa
      // vocabulario de procedencia del escalar móvil, lo que las dos aserciones de abajo
      // comprueban sobre su SQL en vez de creerle a este comentario. Las cuatro AUTORADAS y NO
      // APLICADAS en remoto.
      '132_agent2_hubspot_legacy_sync_state_backfill.sql',
      'R1 es sin migración: el techo lo movieron 4O-H2, 4O-H3, el catálogo macro, la supresión nativa, la contabilidad de presupuesto y el tramo 129–132 de Agente 2, no este hito',
    );
    for (const agent2 of [
      '129_agent2_contact_hubspot_stale_completeness.sql',
      '130_agent2_contact_hubspot_stale_source.sql',
      '131_agent2_post_approval_reveal_stale_producer.sql',
      '132_agent2_hubspot_legacy_sync_state_backfill.sql',
    ]) {
      assert.ok(numbered.includes(agent2), `falta ${agent2}`);
      const sql = readFileSync(join(MIGRATIONS_DIR, agent2), 'utf8');
      // R1 vigila el escalar móvil: ninguna de las cuatro lo ASIGNA. La 131 lo LEE bajo el lock
      // —el saliente que HubSpot conoce es `mobile_phone ?? phone`— y leer no es escribir. Que
      // `mobile_phone_source` no exista en NINGUNA migración lo barre la prueba hermana de abajo
      // sobre el directorio completo, así que no se repite aquí.
      assert.equal(
        /mobile_phone\s*=/.test(sql),
        false,
        `${agent2} escribe mobile_phone: 4O-E4.1 reserva ese escalar y R1 lo deja intacto`,
      );
    }
    assert.ok(numbered.includes('125_reconcile_source_snapshot_record_identity.sql'));
    assert.ok(numbered.includes('126_agent1_batch_identity_atomicity.sql'));
    assert.equal(
      // La ventana sube con el techo DECLARADO arriba: la 125 (reconciliación genérica), la 126
      // (AGENT1-CUT3B4, independiente), la 127 (BR, renumerada dos veces), la 128
      // (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1) y el tramo 129–132 de
      // AGENT2-FINAL-INTEGRATION están autorizadas y nombradas una por una, así que lo que queda
      // prohibido es la 133 y superiores.
      numbered.some((f) => /^1(3[3-9]|[4-9]\d)/.test(f)),
      false,
      // La 120 (Fase 1), la 121 (contabilidad) y la 122 («Buscar más números»)
      // (AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1) son AUTORIZADAS y están declaradas arriba;
      // lo que esta guarda sigue impidiendo es que alguien cuele una POR ENCIMA del último
      // hito conocido sin declararla.
      'ninguna migración 133 o superior',
    );
  });

  it('sólo 4O-H1 crea `contact_phones`, y `mobile_phone_source` no existe en ninguna', () => {
    // `mobile_phone_source` sigue sin existir en NINGUNA migración: la procedencia del
    // escalar móvil es deuda declarada (MOBILE_PHONE_PROVENANCE_PENDING) y pertenece a H5.
    // `contact_phones` sí existe ya, y sólo en la 114.
    const creators: string[] = [];
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith('.sql')) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      assert.equal(/mobile_phone_source/.test(sql), false, `${file} declara mobile_phone_source`);
      if (/CREATE TABLE[^;]*\bcontact_phones\b/i.test(sql)) creators.push(file);
    }
    assert.deepEqual(creators, ['114_official_contact_phones.sql']);
  });

  it('`createContact` declara la procedencia con el MISMO helper (4O-H0.5)', () => {
    // R1 dejó abierto `MANUAL_CREATE_PHONE_PROVENANCE_NORMALIZATION_PENDING`: el INSERT
    // manual escribía `phone` y dejaba `phone_source` en NULL. H0.5 lo cierra sin
    // vocabulario ni esquema nuevos —`'manual'` ya está en el CHECK de 094—, así que
    // esta sección sigue siendo la que demuestra que no se inventó nada. El contrato
    // positivo vive en la suite de H0.5.
    const body = createContactBody();
    assert.match(
      body,
      /buildManualContactPhoneEditPatch\(input\.phone\?\.trim\(\) \|\| null\)/,
      'la procedencia del INSERT manual no puede volver a construirse a mano',
    );
    assert.equal(
      /phone_source:/.test(body),
      false,
      'la procedencia sólo puede venir del patch compartido, nunca de un literal local',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 4b. AUDITORÍA DE ESCRITORES de `contacts.phone` (premisa congelada)
// ═══════════════════════════════════════════════════════════════

/**
 * R1 sólo cierra el defecto si el inventario de escritores de `contacts.phone` está
 * COMPLETO. Hoy son cuatro, y cada uno deja el par (número, procedencia) coherente:
 *
 *   1. `createContact`            — INSERT manual: desde 4O-H0.5 escribe `phone` y su
 *                                   procedencia con el MISMO helper que `updateContact`
 *                                   ⇒ `'manual'`, que no está en la allowlist y por
 *                                   tanto tampoco produce borrado destructivo;
 *   2. `updateContact`            — R1: número y procedencia en el MISMO patch;
 *   3. `insertContact` (aprobación de candidato, `ContactInsertPayload`) — escribe
 *                                   `phone` junto a su `phone_source` de proveedor;
 *   4. la supresión de privacidad — nula la tupla entera (4O-E4).
 *
 * Un quinto escritor que tocara `phone` sin su procedencia reabriría exactamente el
 * defecto de R1, y las pruebas de comportamiento no lo verían: prueban el helper y a
 * quien lo llama, no a un módulo nuevo. Por eso el inventario se congela aquí.
 */
describe('R1 estático — auditoría de escritores de `contacts.phone`', () => {
  const SRC_DIR = join(repoRoot, 'src');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  const ALLOWED_WRITERS = [
    join('src', 'modules', 'contacts', 'actions.ts'),
    join('src', 'modules', 'contact-enrichment', 'actions.ts'),
    join('src', 'modules', 'contact-enrichment', 'phone-cache-suppression-actions.ts'),
    // CUT-3B — el cableado del motor de sincronización sale de `contacts/actions.ts` hacia un
    // runner compartido, para que el botón manual y el autosync de la aprobación no puedan
    // acabar con dos cableados distintos. No es un escritor NUEVO de teléfono: es el mismo
    // `persistSync` de siempre, mudado de fichero, más el escritor del anexo operativo.
    //
    // Entra en la lista DEMOSTRANDO lo que esta auditoría exige, en la prueba de abajo: ninguno
    // de sus dos UPDATE nombra `phone` ni `phone_source`, así que no existe ningún camino por el
    // que puedan dejar el par incoherente.
    join('src', 'modules', 'contacts', 'contact-hubspot-sync-runner.ts'),
    // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC — `triggerContactHubSpotSync` (Task E1), el
    // entrypoint único que resuelve la empresa de HubSpot de la cuenta ANTES de delegar el
    // contacto al motor de arriba. Sus dos UPDATE propios (el anexo de bloqueo de workspace y la
    // bandera `hubspot_company_review_pending`) escriben SÓLO `metadata`, nunca `phone` ni
    // `phone_source` — demostrado en la prueba de abajo, igual que el runner.
    join('src', 'modules', 'contact-enrichment', 'hubspot-contact-approval-sync.ts'),
  ];

  it('sólo los módulos conocidos ESCRIBEN en la tabla `contacts`', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // `.from('contacts')` seguido de una mutación, tolerando el encadenado
      // multilínea de PostgREST.
      if (!/\.from\(\s*'contacts'\s*\)[\s\S]{0,200}?\.(update|insert|upsert|delete)\(/.test(code)) {
        continue;
      }
      const rel = file.slice(repoRoot.length + 1);
      if (!ALLOWED_WRITERS.includes(rel)) offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [],
      'un escritor nuevo de `contacts` debe demostrar que deja (phone, phone_source) coherentes ' +
        'antes de entrar en esta lista',
    );
  });

  it('el runner de sincronización no puede tocar el par (phone, phone_source)', () => {
    // La condición de admisión, comprobada y no prometida. Si algún día ese módulo aprendiera a
    // escribir un teléfono, esta prueba lo obligaría a demostrar antes su procedencia.
    const runner = stripComments(
      readFileSync(join(SRC_DIR, 'modules', 'contacts', 'contact-hubspot-sync-runner.ts'), 'utf8'),
    );
    for (const forbidden of ['phone_source', 'mobile_phone_source', 'phone:', 'mobile_phone:']) {
      assert.equal(
        runner.includes(forbidden),
        false,
        `${forbidden} convertiría al runner en un escritor de teléfono sin procedencia`,
      );
    }
    // Lo que SÍ escribe, y nada más: el vínculo HubSpot, la metadata y el autor.
    const updates = runner.match(/\.update\(\{[\s\S]*?\}\)/g) ?? [];
    assert.ok(updates.length >= 1, 'el runner debe seguir siendo quien persiste el estado');
    for (const patch of updates) {
      for (const key of Object.keys({ hubspot_contact_id: 1, metadata: 1, updated_by: 1 })) {
        void key;
      }
      assert.equal(
        /\b(phone|mobile_phone|phone_source|email|full_name)\s*:/.test(patch),
        false,
        'el runner sólo persiste vínculo y metadata',
      );
    }
  });

  it('triggerContactHubSpotSync no puede tocar el par (phone, phone_source)', () => {
    // La misma condición de admisión que el runner, aplicada al entrypoint de Task E1: si algún
    // día aprendiera a escribir un teléfono, esta prueba lo obligaría a demostrar antes su
    // procedencia.
    const wiring = stripComments(
      readFileSync(
        join(SRC_DIR, 'modules', 'contact-enrichment', 'hubspot-contact-approval-sync.ts'),
        'utf8',
      ),
    );
    for (const forbidden of ['phone_source', 'mobile_phone_source', 'phone:', 'mobile_phone:']) {
      assert.equal(
        wiring.includes(forbidden),
        false,
        `${forbidden} convertiría a triggerContactHubSpotSync en un escritor de teléfono sin procedencia`,
      );
    }
    // Lo que SÍ escribe, y nada más: el anexo del motor y la bandera de revisión de empresa.
    const updates = wiring.match(/\.update\(\{[\s\S]*?\}\)/g) ?? [];
    assert.ok(updates.length >= 1, 'triggerContactHubSpotSync debe seguir escribiendo su anexo');
    for (const patch of updates) {
      assert.equal(
        /\b(phone|mobile_phone|phone_source|email|full_name)\s*:/.test(patch),
        false,
        'triggerContactHubSpotSync sólo persiste metadata',
      );
    }
  });

  it('`createContact` escribe `phone` y su procedencia en el MISMO patch (4O-H0.5)', () => {
    const body = createContactBody();
    assert.match(body, /\.\.\.buildManualContactPhoneEditPatch\(input\.phone\?\.trim\(\) \|\| null\)/);
    assert.equal(
      /phone:\s*input\.phone/.test(body),
      false,
      'reintroducir el escalar suelto deja otra vez el número sin procedencia',
    );
  });

  it('la aprobación de candidato escribe `phone` junto a su `phone_source`', () => {
    const core = read('src', 'modules', 'contact-enrichment', 'candidate-review-core.ts');
    const iface = core.match(/interface ContactInsertPayload \{([\s\S]*?)\n\}/);
    assert.ok(iface, '`ContactInsertPayload` debe seguir existiendo');
    assert.match(iface[1], /phone: string \| null;/);
    assert.match(
      iface[1],
      /phone_source: PhoneSource \| null;/,
      'si el payload perdiera la procedencia, un contacto aprobado quedaría con número sin origen',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. 4O-E4 / E4.1 intactos
// ═══════════════════════════════════════════════════════════════

describe('R1 estático — E4 y E4.1 no se degradan', () => {
  it('la allowlist de procedencias borrables sigue siendo exactamente la de E4', () => {
    const core = stripComments(read(...SUPPRESSION_CORE));
    const list = core.match(/SUPPRESSIBLE_CONTACT_PHONE_SOURCES[^=]*=\s*\[([\s\S]*?)\]/);
    assert.ok(list, 'la allowlist debe seguir existiendo');
    for (const value of ['apollo_reveal', 'apollo_cache', 'lusha_reveal']) {
      assert.ok(list[1].includes(value), `falta ${value} en la allowlist`);
    }
    assert.equal(/'manual'/.test(list[1]), false, '`manual` nunca puede ser borrable');
  });

  it('`MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES` sigue sin existir', () => {
    const core = stripComments(read(...SUPPRESSION_CORE));
    assert.equal(/MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES/.test(core), false);
    assert.equal(/clearsMobilePhoneForSource/.test(core), false);
  });

  it('el UPDATE de privacidad sigue siendo condicional por procedencia observada', () => {
    const actions = stripComments(
      read('src', 'modules', 'contact-enrichment', 'phone-cache-suppression-actions.ts'),
    );
    assert.match(actions, /\.eq\('phone_source', observedPhoneSource\)/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. §15 — ninguna prueba de privacidad fabrica el escritor manual
// ═══════════════════════════════════════════════════════════════

describe('R1 estático — las pruebas de privacidad usan el escritor REAL', () => {
  const PRIVACY_SUITES = [
    ['src', 'modules', 'contact-enrichment', '__tests__', 'phone-contacts-privacy-erasure-postgres-4o-e4.test.ts'],
    ['src', 'modules', 'contact-enrichment', '__tests__', 'phone-contacts-privacy-erasure-4o-e4.test.ts'],
    ['src', 'modules', 'contacts', '__tests__', 'contact-phone-provenance-4o-e4-1-r1.test.ts'],
  ];

  /**
   * El bloque de MUTANTES de R1 fabrica el estado manual a propósito: reproduce la
   * regla ingenua para demostrar que la suite la distingue del comportamiento real.
   * Es el único sitio donde la fabricación es legítima, así que la guarda mira todo
   * lo que hay ANTES de él —donde viven las afirmaciones de privacidad— y exige que
   * el bloque siga estando etiquetado como tal.
   */
  const MUTANTS_MARKER = "describe('R1 — mutantes que la suite debe detectar'";

  function assertionRegion(parts: string[]): string {
    const source = stripComments(read(...parts));
    const cut = source.indexOf(MUTANTS_MARKER);
    return cut === -1 ? source : source.slice(0, cut);
  }

  for (const parts of PRIVACY_SUITES) {
    it(`${parts[parts.length - 1]} no escribe \`phone_source = 'manual'\` a mano`, () => {
      const region = assertionRegion(parts);
      assert.equal(
        /SET[^;]*phone_source\s*=\s*'manual'/i.test(region),
        false,
        'fabricar el estado manual demuestra una propiedad de un escritor que no existe: ' +
          'debe derivarse de `resolveManualContactPhoneEdit`',
      );
      assert.equal(
        /phone_source:\s*'manual'/.test(region),
        false,
        'lo mismo para los fixtures deterministas',
      );
    });
  }

  it('la fabricación sólo se permite dentro del bloque de mutantes de R1', () => {
    const source = read(...PRIVACY_SUITES[2]);
    assert.ok(
      source.includes(MUTANTS_MARKER),
      'si el bloque de mutantes se renombra, la guarda de arriba dejaría de acotar nada',
    );
    const mutants = source.slice(source.indexOf(MUTANTS_MARKER));
    assert.match(
      mutants,
      /mutantPresenceMeansManual/,
      'el mutante que fabrica `manual` debe seguir siendo explícito',
    );
  });

  it('la suite de PostgreSQL deriva el patch manual del helper compartido', () => {
    const source = read(...PRIVACY_SUITES[0]);
    assert.match(
      source,
      /import \{ resolveManualContactPhoneEdit \} from '@\/modules\/contacts\/contact-phone-provenance'/,
    );
    assert.match(source, /async function applyManualPhoneEdit/);
    assert.match(
      source,
      /Object\.keys\(edit\.patch\)/,
      'el SQL debe derivarse del patch, no escribirse a mano',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Cableado al check obligatorio
// ═══════════════════════════════════════════════════════════════

describe('R1 estático — la suite corre en el check obligatorio', () => {
  it('package.json expone el script de R1 con sus dos archivos', () => {
    const pkg = JSON.parse(read(...PACKAGE_JSON)) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts['test:agent2a:contact-phone-provenance'];
    assert.ok(script, 'falta el script de R1');
    assert.match(script, /contact-phone-provenance-4o-e4-1-r1\.test\.ts/);
    assert.match(script, /contact-phone-provenance-static-4o-e4-1-r1\.test\.ts/);
  });

  it('el workflow ejecuta el script de R1', () => {
    const workflow = read(...WORKFLOW);
    assert.match(workflow, /npm run test:agent2a:contact-phone-provenance$/m);
  });

  it('los steps de E1–E4.1 siguen en el workflow', () => {
    const workflow = read(...WORKFLOW);
    for (const script of [
      'test:agent2a:phone-suppression-terminal',
      'test:agent2a:contacts-phone-privacy-erasure',
      'test:agent2a:mobile-phone-provenance-erasure',
      'test:agent2a:phone-privacy-race-gates',
    ]) {
      assert.ok(workflow.includes(`npm run ${script}`), `el workflow perdió ${script}`);
    }
  });
});
