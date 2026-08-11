/**
 * Agente 2A — GARANTÍAS ESTÁTICAS de 4O-E3 (AGENT2A-PHONE-REVEAL-4O-E3).
 *
 * Lo que se fija aquí es lo que ninguna prueba de comportamiento puede fijar:
 *
 *   * que la migración 113 sea EXACTAMENTE la 110 y la 111 con tres ediciones
 *     acotadas — la restatement completa de ~1.800 líneas es el riesgo real del hito,
 *     y este archivo la vuelve a derivar y compara byte a byte;
 *   * que las migraciones 110, 111 y 112 no se hayan tocado retroactivamente;
 *   * que el SQL nuevo cumpla el sobre de seguridad del subsistema (SECURITY INVOKER,
 *     `search_path` fijado, 0 SQL dinámico, 0 DELETE, EXECUTE solo para service_role);
 *   * que las dos rutas de Lusha compartan UNA sola puerta de privacidad, en vez de
 *     dos copias que puedan divergir;
 *   * que el disparo manual la tenga REALMENTE cableada — un gate que existe pero no
 *     se inyecta no protege nada;
 *   * que la suite entre en el workflow obligatorio.
 *
 * Sin red, sin base de datos, sin proveedor.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildPhonePersonSuppressionRecheckMigration,
  extractFunctionBody,
  FUNCTION_EDITS,
  MIGRATION_113_FILENAME,
} from './support/phone-person-suppression-recheck-migration';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');
const moduleDir = join(here, '..');

const read = (path: string) => readFileSync(path, 'utf8');
const readMigration = (file: string) => read(join(migrationsDir, file));
const readModule = (file: string) => read(join(moduleDir, file));

const MIGRATION_110 = '110_persist_candidate_apollo_phone_reveal_result.sql';
const MIGRATION_111 = '111_persist_candidate_lusha_phone_reveal_result.sql';
const MIGRATION_112 = '112_suppress_candidate_phone_collection.sql';

// ═══════════════════════════════════════════════════════════════
// 1. La 113 es una DERIVACIÓN, no una transcripción
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — la migración 113 no puede divergir de la 110/111', () => {
  test('el archivo en disco es exactamente el que se deriva del SQL vigente', () => {
    assert.equal(
      readMigration(MIGRATION_113_FILENAME),
      buildPhonePersonSuppressionRecheckMigration(repoRoot),
      'la 113 se DERIVA de la 110 y la 111: si divergen, la función desplegada dejaría ' +
        'de ser la que está probada. Regenerar en vez de editar a mano.',
    );
  });

  test('cada función restatement conserva el cuerpo original salvo las tres ediciones', () => {
    for (const edit of FUNCTION_EDITS) {
      const original = extractFunctionBody(
        readMigration(edit.sourceFile),
        edit.functionName,
      );
      const restated = extractFunctionBody(
        readMigration(MIGRATION_113_FILENAME),
        edit.functionName,
      );

      // Quitar del restatement lo que las tres ediciones añaden tiene que devolver,
      // literalmente, el cuerpo original.
      const stripped = restated
        .replace(edit.declareAdd, '')
        .replace(edit.selectReplacement, edit.selectAnchor);
      const step2bStart = stripped.indexOf('  -- Step 2b — PERSON-level suppression');
      assert.notEqual(step2bStart, -1, `${edit.functionName}: falta el bloque nuevo`);
      const blockStart = stripped.lastIndexOf(
        '  -- ═══════════════════════════════════════════════════════════════\n',
        step2bStart,
      );
      const step3Start = stripped.indexOf(
        '  -- Step 3 — tombstones, re-checked UNDER the lock.',
        step2bStart,
      );
      const blockEnd = stripped.lastIndexOf(
        '  -- ═══════════════════════════════════════════════════════════════\n',
        step3Start,
      );
      const withoutBlock = stripped.slice(0, blockStart) + stripped.slice(blockEnd);

      assert.equal(
        withoutBlock,
        original,
        `${edit.functionName}: el restatement cambia algo más que las tres ediciones`,
      );
    }
  });

  test('las migraciones 110, 111 y 112 NO se editan retroactivamente', () => {
    for (const file of [MIGRATION_110, MIGRATION_111, MIGRATION_112]) {
      const sql = readMigration(file);
      assert.ok(
        !sql.includes('4O-E3'),
        `${file} no puede llevar cambios de 4O-E3: ya está aplicada en Producción`,
      );
      assert.ok(
        !sql.includes('phone_reveal_person_suppression_exists'),
        `${file} no puede llamar a un helper que no existía cuando se aplicó`,
      );
    }
  });

  test('la 113 declara que NO está aplicada en Producción', () => {
    const sql = readMigration(MIGRATION_113_FILENAME);
    assert.ok(
      sql.includes('APPLIED IN PRODUCTION: NO'),
      'la cabecera tiene que decir la verdad sobre el estado de despliegue',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Sobre de seguridad del SQL nuevo
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — seguridad del SQL', () => {
  const sql = readMigration(MIGRATION_113_FILENAME);

  /** Cada `CREATE OR REPLACE FUNCTION` con su cabecera, hasta el cuerpo. */
  const functionHeaders = sql
    .split('CREATE OR REPLACE FUNCTION public.')
    .slice(1)
    .map((chunk) => ({
      name: chunk.slice(0, chunk.indexOf('(')),
      header: chunk.slice(0, chunk.indexOf('AS $')),
    }));

  test('la migración declara exactamente las cuatro funciones esperadas', () => {
    assert.deepEqual(
      functionHeaders.map((f) => f.name),
      [
        'phone_reveal_normalized_apollo_person_id',
        'phone_reveal_person_suppression_exists',
        'persist_candidate_apollo_phone_reveal_result',
        'persist_candidate_lusha_phone_reveal_result',
      ],
    );
  });

  test('cada función es SECURITY INVOKER y ninguna es DEFINER', () => {
    assert.ok(!sql.includes('SECURITY DEFINER'), 'ninguna función puede ser DEFINER');
    for (const fn of functionHeaders) {
      assert.ok(
        fn.header.includes('SECURITY INVOKER'),
        `${fn.name} tiene que ser SECURITY INVOKER`,
      );
    }
  });

  test('cada función fija search_path', () => {
    for (const fn of functionHeaders) {
      assert.ok(
        fn.header.includes('SET search_path = pg_catalog, pg_temp'),
        `${fn.name}: un search_path sin fijar es un vector de secuestro`,
      );
    }
  });

  test('no hay SQL dinámico', () => {
    for (const forbidden of ['EXECUTE format(', 'EXECUTE \'', 'quote_ident', 'quote_literal']) {
      assert.ok(!sql.includes(forbidden), `SQL dinámico prohibido: ${forbidden}`);
    }
  });

  test('no hay ningún DELETE: el techo de privilegios de la 109 sigue aplicando', () => {
    assert.ok(!/\bDELETE\s+FROM\b/i.test(sql));
  });

  test('los helpers nuevos revocan a PUBLIC/anon/authenticated y solo conceden a service_role', () => {
    for (const fn of [
      'phone_reveal_normalized_apollo_person_id(text)',
      'phone_reveal_person_suppression_exists(text, uuid)',
    ]) {
      for (const role of ['PUBLIC', 'anon', 'authenticated']) {
        assert.ok(
          sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM ${role};`),
          `falta REVOKE de ${fn} para ${role}`,
        );
      }
      assert.ok(
        sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO postgres, service_role;`),
        `falta GRANT de ${fn} a service_role`,
      );
    }
  });

  test('el helper de lectura solo consulta la caché: no escribe ni crea supresión', () => {
    const start = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.phone_reveal_person_suppression_exists(',
    );
    const end = sql.indexOf('$fn$;', start);
    const body = sql.slice(start, end);
    for (const forbidden of ['INSERT', 'UPDATE', 'DELETE']) {
      assert.ok(!body.includes(forbidden), `el lector no puede ${forbidden}`);
    }
    assert.ok(body.includes('public.phone_reveal_cache'));
    assert.ok(
      body.includes('suppressed_at IS NOT NULL'),
      'suprimido es el tombstone, no «hay fila en la caché»',
    );
  });

  test('la 113 no hace backfill ni inserta ninguna fila', () => {
    assert.ok(!/\bINSERT\s+INTO\b/i.test(sql.slice(0, sql.indexOf('CREATE OR REPLACE FUNCTION public.persist_candidate_apollo'))));
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Una sola puerta, cableada de verdad
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — la puerta de privacidad es UNA y está cableada', () => {
  test('el módulo compartido existe y expone la puerta y su lector', () => {
    const gate = readModule('phone-reveal-privacy-gate.ts');
    assert.ok(gate.includes('export async function checkPhoneRevealPrivacyGate'));
    assert.ok(gate.includes('export async function isPhoneRevealCandidateDoNotContact'));
    assert.ok(gate.includes('readPhoneCacheSuppression'));
  });

  test('el waterfall delega en la puerta compartida y no conserva una copia', () => {
    const deps = readModule('phone-reveal-waterfall-deps.ts');
    assert.ok(
      deps.includes('return checkPhoneRevealPrivacyGate(candidateId);'),
      'el waterfall tiene que delegar, no reimplementar',
    );
    assert.ok(
      !deps.includes("contact_status', 'do_not_contact'"),
      'la lectura de do_not_contact ya no puede vivir duplicada aquí',
    );
  });

  test('el disparo manual inyecta la puerta y la escritura condicional', () => {
    const actions = readModule('lusha-phone-fallback-actions.ts');
    assert.ok(
      actions.includes('checkPrivacyGate: checkPhoneRevealPrivacyGate'),
      'sin inyectar la dep, el gate del core no se ejecuta y no protege nada',
    );
    assert.ok(
      actions.includes('persistTerminalSuppression: persistTerminalPhoneSuppression'),
      'el cierre por supresión tiene que ser el condicional, no un UPDATE suelto',
    );
  });

  test('el core manual consulta la puerta ANTES de llamar al proveedor', () => {
    const core = readModule('lusha-phone-fallback-core.ts');
    const gateAt = core.indexOf('if (deps.checkPrivacyGate) {');
    const callAt = core.indexOf('const result = await deps.callLusha({ contactId });');
    assert.notEqual(gateAt, -1);
    assert.notEqual(callAt, -1);
    assert.ok(gateAt < callAt, 'la puerta previa tiene que preceder a la llamada pagada');
  });

  test('el core manual vuelve a consultarla antes de escribir un número revelado', () => {
    const core = readModule('lusha-phone-fallback-core.ts');
    const secondGate = core.indexOf('const gateAfter = await deps.checkPrivacyGate(candidateId);');
    const persistPhone = core.indexOf('await deps.persist(candidateId, {\n    phone: phoneNumber,');
    assert.notEqual(secondGate, -1, 'falta la re-comprobación posterior a la respuesta');
    assert.notEqual(persistPhone, -1);
    assert.ok(secondGate < persistPhone, 'la re-comprobación va antes de escribir');
  });

  // AGENT2A-PHONE-REVEAL-4O-F invirtió este guarda. En 4O-E3 afirmaba que el disparo
  // manual seguía guardando UN teléfono; ahora afirma lo que ese cambio NO puede
  // romper: que al cablear la colección la puerta de privacidad posterior siga
  // cubriendo el camino manual. Es el punto exacto donde la protección se habría
  // perdido en silencio, porque la transacción re-comprueba tombstones y supresión
  // por persona bajo el lock pero NO lee `do_not_contact`.
  test('la re-comprobación posterior precede a AMBAS escrituras, no solo a la escalar', () => {
    const core = readModule('lusha-phone-fallback-core.ts');
    const secondGate = core.indexOf('const gateAfter = await deps.checkPrivacyGate(candidateId);');
    const collectionBranch = core.indexOf('if (deps.persistPhoneCollection) {');
    assert.notEqual(secondGate, -1, 'falta la re-comprobación posterior a la respuesta');
    assert.notEqual(collectionBranch, -1);
    assert.ok(
      secondGate < collectionBranch,
      'la puerta tiene que evaluarse ANTES de bifurcar: dentro de la rama escalar dejaría ' +
        'el camino transaccional sin protección de do_not_contact en vuelo',
    );
    // Y se evalúa UNA sola vez tras la respuesta: dos copias divergirían.
    assert.equal(
      (core.match(/const gateAfter = await deps\.checkPrivacyGate\(candidateId\);/g) ?? []).length,
      1,
    );
  });

  test('el disparo manual cablea la colección transaccional (4O-F)', () => {
    const actions = readModule('lusha-phone-fallback-actions.ts');
    assert.ok(
      actions.includes('persistPhoneCollection: persistCandidateLushaPhoneCollection'),
      'MANUAL_LUSHA_MULTI_PHONE_PENDING queda cerrado: misma transacción que el waterfall',
    );
    // La rama sigue siendo condicional en el core: el contrato de la dep no se
    // convierte en obligatorio, que es lo que mantiene el core probable sin base.
    const core = readModule('lusha-phone-fallback-core.ts');
    assert.ok(core.includes('if (deps.persistPhoneCollection) {'));
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. El cierre por tombstone dejó de ser incondicional
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — webhook y recuperación cierran por supresión de forma condicional', () => {
  for (const file of ['phone-reveal-webhook-core.ts', 'phone-reveal-recovery-core.ts']) {
    test(`${file}: el camino blocked_suppressed usa la escritura condicional`, () => {
      const source = readModule(file);
      const branch = source.indexOf("if (suppression.kind === 'blocked_suppressed') {");
      assert.notEqual(branch, -1);
      const conditional = source.indexOf('applyTerminalPhoneSuppression({', branch);
      const fallback = source.indexOf('deps.persist(candidate.id, {', branch);
      assert.notEqual(conditional, -1, 'falta la escritura condicional');
      assert.ok(
        conditional < fallback,
        'el UPDATE incondicional solo puede ser el respaldo de «dep no cableada»',
      );
      assert.ok(
        source.slice(branch, fallback).includes("terminalized.reason === 'not_wired'"),
        'el respaldo tiene que estar guardado por `not_wired`, no correr siempre',
      );
      assert.ok(
        source
          .slice(branch, conditional + 600)
          .includes('IN_FLIGHT_TERMINAL_SUPPRESSION_EXPECTED_STATUSES'),
        'la condición son los dos estados en vuelo',
      );
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 5. Privacidad de los registros
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — nada de lo nuevo imprime PII', () => {
  test('la puerta compartida no loguea', () => {
    const gate = readModule('phone-reveal-privacy-gate.ts');
    assert.ok(!gate.includes('console.'), 'la puerta no imprime nada');
  });

  test('el bloqueo manual registra códigos mecánicos, nunca el número', () => {
    const core = readModule('lusha-phone-fallback-core.ts');
    const start = core.indexOf('if (deps.checkPrivacyGate) {');
    const end = core.indexOf('const result = await deps.callLusha({ contactId });');
    const block = core.slice(start, end);
    for (const forbidden of ['phoneNumber', 'normalized_phone', 'display_phone', 'email']) {
      assert.ok(!block.includes(forbidden), `el bloqueo no puede tocar ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. La suite entra en el check obligatorio
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — la suite está cableada al workflow obligatorio', () => {
  const workflow = read(join(repoRoot, '.github/workflows/automatic-routing-tests.yml'));
  const pkg = JSON.parse(read(join(repoRoot, 'package.json'))) as {
    scripts: Record<string, string>;
  };

  test('los dos scripts npm existen', () => {
    assert.ok(pkg.scripts['test:agent2a:phone-privacy-race-gates']);
    assert.ok(pkg.scripts['test:agent2a:phone-privacy-race-postgres']);
  });

  test('el script del check cubre las dos suites que corren sin PostgreSQL', () => {
    const script = pkg.scripts['test:agent2a:phone-privacy-race-gates'];
    assert.ok(script.includes('phone-privacy-race-gates-core-4o-e3.test.ts'));
    assert.ok(script.includes('phone-privacy-race-gates-static-4o-e3.test.ts'));
  });

  test('el workflow ejecuta la suite', () => {
    assert.ok(
      workflow.includes('npm run test:agent2a:phone-privacy-race-gates'),
      'una suite fuera del check obligatorio no protege nada en una rama ajena',
    );
  });

  test('la suite de PostgreSQL queda FUERA del check, y se dice por qué', () => {
    assert.ok(
      !workflow.includes('run: npm run test:agent2a:phone-privacy-race-postgres'),
      'descargaría un binario de PostgreSQL en cada corrida del check obligatorio',
    );
    assert.ok(
      workflow.includes('phone-privacy-race-postgres'),
      'su ausencia tiene que estar documentada en el propio workflow',
    );
  });
});
