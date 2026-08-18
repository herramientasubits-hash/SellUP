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
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const last = files[files.length - 1];
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
      '120_provider_native_phone_suppression.sql',
      'R1 es sin migración: el techo lo movieron 4O-H2, 4O-H3 y el catálogo macro, no este hito',
    );
    assert.equal(
      files.some((f) => /^1(2[1-9]|[3-9]\d)/.test(f)),
      false,
      // La 120 es de la Fase 1 de AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 y es AUTORIZADA;
      // lo que esta guarda sigue impidiendo es que alguien cuele una POR ENCIMA del último
      // hito conocido sin declararla.
      'ninguna migración 121 o superior',
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
