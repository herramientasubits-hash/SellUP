/**
 * AGENT1-CUT3B23 § 3 — guarda de contrato: la escritura REAL de candidatos de
 * Lusha es de TODO-O-NADA.
 *
 * Por qué existe este archivo. La reconciliación final de
 * `persistLushaPendingReviewBatch` compara la admisión de identidad contra
 * `insertedCount`, pero la metadata DURABLE del lote se escribe ANTES de que
 * exista una sola fila de candidato —los candidatos necesitan su `batch_id`—, así
 * que esa metadata se compone con `useful.length`. Eso sólo es VERDAD si la
 * escritura real no puede tener éxito PARCIAL: si Producción pudiera devolver
 *
 *     insertedCount > 0  &&  insertedCount < rows.length
 *
 * el lote durable afirmaría más filas de las que existen.
 *
 * Este corte NO añade una segunda superficie de escritura de lote para arreglar
 * un hueco que no es alcanzable. Lo que hace es FIJAR la premisa: mientras la
 * implementación real conserve la forma atómica, `insertedCount == useful.length`
 * es un invariante de Producción y la metadata durable es veraz. Si alguien
 * cambia la forma —trocea el arreglo, mete `upsert`, `onConflict`,
 * `ignoreDuplicates`, o se traga el error— esta guarda FALLA y obliga a
 * reconsiderar la reconciliación post-inserción.
 *
 * `post_admission_persistence_gap` se conserva como invariante DEFENSIVA: no es
 * código muerto, es el estado que cubre el día en que esta guarda deje de valer.
 *
 * Metodología heredada de las guardas de CUT-3B1/3B23: se compara el CUERPO
 * EJECUTABLE (sin comentarios ni literales), porque nombrar algo en prosa no es
 * usarlo en código. La guarda se prueba a sí misma en NEGATIVO al final.
 *
 * Offline y determinista: sin Supabase, sin red, sin credenciales, 0 créditos,
 * 0 migraciones, 0 proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** La ÚNICA implementación de producción de `insertCandidates`. */
const REAL_WIRING = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
/** El núcleo puro que consume esa dependencia. */
const CORE = 'src/server/prospect-batches/lusha-pending-review.ts';
/** Donde vive la unión `LushaRunStopReason`. */
const STOP_REASON_TYPE = 'src/server/prospect-batches/lusha-multibranch-execution.ts';
const MIGRATIONS_DIR = 'supabase/migrations';

/** Elimina comentarios de bloque, de línea y literales de cadena. */
export function stripNonExecutable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""');
}

/**
 * Elimina SÓLO comentarios. Para aserciones sobre valores que SON estructura
 * ejecutable —un miembro de una unión de tipos, una ruta de import—, donde el
 * literal no es prosa.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function read(relativeToRepo: string): string {
  return readFileSync(join(REPO_ROOT, relativeToRepo), 'utf8');
}

function executableBody(relativeToRepo: string): string {
  return stripNonExecutable(read(relativeToRepo));
}

/**
 * Aísla el cuerpo EJECUTABLE de la clausura `insertCandidates`. Se corta contra
 * la dependencia siguiente del objeto (`checkCompanyDuplicate`), que es
 * estructura, no prosa: así la aserción no puede colarse por un comentario.
 */
export function extractInsertCandidatesBody(executable: string): string {
  const start = executable.indexOf('insertCandidates:');
  assert.notEqual(start, -1, 'no se encontró la dependencia `insertCandidates`');
  const end = executable.indexOf('checkCompanyDuplicate:', start);
  assert.notEqual(end, -1, 'no se encontró el corte `checkCompanyDuplicate`');
  return executable.slice(start, end);
}

// ─── § 3.1 — hay UNA sola superficie de escritura de candidatos ───────────────

describe('CUT-3B23 § 3 — `insertCandidates` tiene una sola implementación real', () => {
  it('ningún otro archivo de producción implementa la dependencia', () => {
    const implementations: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(relative);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        // `insertCandidates:` con dos puntos es DEFINICIÓN de la dependencia.
        // Una llamada (`deps.insertCandidates(`) no lo es.
        if (stripNonExecutable(read(relative)).includes('insertCandidates:')) {
          implementations.push(relative);
        }
      }
    };
    walk('src');

    // El núcleo la DECLARA en la interfaz; el wiring la IMPLEMENTA. Nadie más.
    assert.deepEqual(
      implementations.sort(),
      [REAL_WIRING, CORE].sort(),
      `superficies inesperadas de escritura de candidatos: ${implementations.join(', ')}`,
    );
  });

  it('el núcleo la invoca UNA vez y fuera de todo bucle', () => {
    const body = executableBody(CORE);
    const calls = body.match(/deps\.insertCandidates\(/g) ?? [];
    assert.equal(calls.length, 1, 'la escritura de candidatos se invoca más de una vez');
    // Indentación de DOS espacios = cuerpo de la función, no interior de un bucle.
    assert.match(
      read(CORE),
      /\n {2}const \{ insertedCount \} = await deps\.insertCandidates\(/,
      'la llamada dejó de estar en el nivel superior de la función',
    );
  });
});

// ─── § 3.2 — la forma es un ÚNICO insert multi-fila ───────────────────────────

describe('CUT-3B23 § 3 — la escritura real es TODO-O-NADA', () => {
  const insertBody = () => extractInsertCandidatesBody(executableBody(REAL_WIRING));

  it('es un solo `.insert(rows)` sobre `prospect_candidates`', () => {
    const body = insertBody();
    assert.ok(body.includes(".from('')"), 'la escritura dejó de nombrar una tabla');
    assert.match(
      read(REAL_WIRING),
      /\.from\('prospect_candidates'\)\s*\n\s*\.insert\(rows\)/,
      'la escritura dejó de ser un `.insert(rows)` sobre `prospect_candidates`',
    );
    const inserts = body.match(/\.insert\(/g) ?? [];
    assert.equal(inserts.length, 1, 'hay más de una llamada de inserción');
  });

  it('el arreglo COMPLETO viaja en la única llamada: no se trocea', () => {
    const body = insertBody();
    // Un troceo produciría éxito parcial REAL: cada trozo es su propia sentencia.
    for (const chunking of ['.slice(', 'chunk', 'for (', 'while (', '.reduce(', 'Promise.all']) {
      assert.equal(
        body.includes(chunking),
        false,
        `la escritura de candidatos introdujo troceo/iteración (\`${chunking}\`)`,
      );
    }
    assert.ok(body.includes('.insert(rows)'), 'la inserción dejó de recibir `rows` entero');
  });

  it('no hay `upsert`, `onConflict` ni `ignoreDuplicates`', () => {
    const body = insertBody();
    // Cualquiera de los tres puede DESCARTAR filas en silencio dentro de una
    // sentencia que devuelve éxito: es exactamente el éxito parcial.
    for (const forbidden of ['upsert', 'onConflict', 'ignoreDuplicates', 'defaultToNull']) {
      assert.equal(
        body.includes(forbidden),
        false,
        `la escritura de candidatos admite descarte silencioso (\`${forbidden}\`)`,
      );
    }
  });

  it('un error del proveedor de datos LANZA: no se traga ni se degrada', () => {
    const body = insertBody();
    assert.ok(body.includes('if (error)'), 'dejó de comprobar el error');
    assert.ok(body.includes('throw new Error('), 'dejó de lanzar ante un error');
    // Fail-closed: no puede devolver un conteo cuando la sentencia falló.
    assert.equal(
      /if \(error\)\s*\{\s*return/.test(body),
      false,
      'la escritura devuelve un conteo en la rama de error',
    );
  });

  it('el conteo se deriva de las filas REALMENTE devueltas', () => {
    const body = insertBody();
    assert.ok(
      body.includes('insertedCount: data?.length ?? 0'),
      'el conteo dejó de derivarse de la representación devuelta',
    );
    // No puede afirmarse desde la ENTRADA: eso volvería el conteo una tautología.
    assert.equal(
      body.includes('rows.length'),
      false,
      'el conteo se deriva de la entrada y no de lo persistido',
    );
  });
});

// ─── § 3.3 — la base no puede ocultar filas por FILA ─────────────────────────

describe('CUT-3B23 § 3 — nada en el esquema puede descartar filas una a una', () => {
  const migrationSources = () =>
    readdirSync(join(REPO_ROOT, MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => ({ name, sql: read(`${MIGRATIONS_DIR}/${name}`) }));

  it('no existe NINGÚN trigger de INSERT sobre `prospect_candidates`', () => {
    // Un `BEFORE INSERT ... RETURN NULL` descarta la fila en silencio y la
    // sentencia devuelve éxito con menos filas: éxito parcial real.
    for (const { name, sql } of migrationSources()) {
      const triggers = sql.match(/CREATE\s+TRIGGER[\s\S]*?ON\s+prospect_candidates/gi) ?? [];
      for (const trigger of triggers) {
        assert.equal(
          /INSERT/i.test(trigger),
          false,
          `${name} crea un trigger de INSERT sobre prospect_candidates`,
        );
      }
    }
  });

  it('las políticas RLS de escritura y lectura son INDEPENDIENTES de la fila', () => {
    // Si el predicado no mira ninguna columna del candidato, no puede ser cierto
    // para unas filas y falso para otras dentro de la misma sentencia: el
    // resultado es todo-o-nada, y el `RETURNING` no puede quedar truncado.
    const foundation = migrationSources().find(({ sql }) =>
      sql.includes('active_users_can_insert_prospect_candidates'),
    );
    assert.ok(foundation, 'no se encontró la migración que define las políticas');

    for (const policy of ['insert', 'read']) {
      const policyMatch: RegExpMatchArray | null = foundation.sql.match(
        new RegExp(
          `active_users_can_${policy}_prospect_candidates[\\s\\S]*?;`,
          'i',
        ),
      );
      assert.ok(policyMatch, `no se encontró la política de ${policy}`);
      const policySql: string = policyMatch[0];
      assert.ok(
        policySql.includes('has_active_access(auth.uid())'),
        `la política de ${policy} dejó de usar el predicado independiente de fila`,
      );
      // `NEW.` o cualquier columna del candidato la volvería dependiente de fila.
      assert.equal(
        /\bNEW\./i.test(policySql),
        false,
        `la política de ${policy} pasó a depender de la fila`,
      );
    }
  });
});

// ─── § 3.4 — el estado defensivo se conserva ──────────────────────────────────

describe('CUT-3B23 § 4 — los DOS motivos de parada siguen separados', () => {
  it('`post_admission_identity_gap` y `post_admission_persistence_gap` coexisten', () => {
    // Los dos motivos SON literales de un tipo: aquí el literal es estructura
    // ejecutable, así que se borran los comentarios pero NO las cadenas.
    const body = stripComments(read(CORE)) + stripComments(read(STOP_REASON_TYPE));
    assert.ok(
      body.includes('post_admission_identity_gap'),
      'desapareció el motivo de hueco por IDENTIDAD',
    );
    assert.ok(
      body.includes('post_admission_persistence_gap'),
      'desapareció el motivo de hueco por PERSISTENCIA',
    );
  });

  it('el hueco por persistencia se decide con `insertedCount`, no con `useful.length`', () => {
    const source = read(CORE);
    assert.match(
      source,
      /const persistedForTarget = Math\.min\(insertedCount, useful\.length\)/,
      'la reconciliación dejó de acotarse contra las filas reales',
    );
    assert.match(
      source,
      /remainingGapPersisted > 0\s*\n?\s*\?\s*'post_admission_persistence_gap'/,
      'el motivo de parada dejó de derivarse del hueco reconciliado',
    );
  });
});

// ─── La guarda, en NEGATIVO ───────────────────────────────────────────────────

describe('la guarda no puede pasar por vacía', () => {
  it('los archivos que inspecciona existen de verdad', () => {
    for (const target of [REAL_WIRING, CORE, STOP_REASON_TYPE]) {
      assert.ok(existsSync(join(REPO_ROOT, target)), `no existe ${target}`);
      assert.ok(read(target).length > 500, `${target} está sospechosamente vacío`);
    }
    assert.ok(
      readdirSync(join(REPO_ROOT, MIGRATIONS_DIR)).filter((n) => n.endsWith('.sql')).length > 50,
      'no se están leyendo las migraciones',
    );
  });

  it('`stripNonExecutable` borra prosa y literales, y conserva el código', () => {
    const stripped = stripNonExecutable(`
      // upsert en un comentario
      /* onConflict en un bloque */
      const label = 'ignoreDuplicates en un literal';
      supabase.from('t').insert(rows);
    `);
    assert.equal(stripped.includes('upsert'), false);
    assert.equal(stripped.includes('onConflict'), false);
    assert.equal(stripped.includes('ignoreDuplicates'), false);
    assert.ok(stripped.includes('.insert(rows)'));
  });

  it('`stripComments` conserva los literales de tipo y borra la prosa', () => {
    const stripped = stripComments(`
      // post_admission_identity_gap sólo mencionado en prosa
      type T = 'post_admission_persistence_gap';
    `);
    assert.equal(stripped.includes('sólo mencionado'), false);
    assert.ok(stripped.includes("'post_admission_persistence_gap'"));
  });

  it('el extractor aísla la clausura y NO arrastra las dependencias vecinas', () => {
    const body = extractInsertCandidatesBody(executableBody(REAL_WIRING));
    assert.ok(body.includes('.insert(rows)'), 'el extractor perdió el cuerpo');
    assert.equal(
      body.includes('checkCompanyDuplicate'),
      false,
      'el extractor arrastró la dependencia siguiente',
    );
    assert.equal(
      body.includes('insertBatch'),
      false,
      'el extractor arrastró la escritura de lote',
    );
  });

  it('la aserción de troceo FALLA sobre una clausura que SÍ trocea', () => {
    // Sin esta prueba, la aserción de § 3.2 podría ser vacua.
    const fake = stripNonExecutable(`
      insertCandidates: async (rows) => {
        for (const chunk of rows.slice(0, 10)) { await supabase.insert(chunk); }
        return { insertedCount: rows.length };
      },
      checkCompanyDuplicate: () => null,
    `);
    const body = extractInsertCandidatesBody(fake);
    assert.ok(body.includes('.slice('), 'la aserción de troceo no detectaría un troceo real');
    assert.ok(body.includes('for ('), 'la aserción de iteración no detectaría un bucle real');
    assert.ok(
      body.includes('rows.length'),
      'la aserción de conteo no detectaría un conteo tautológico',
    );
  });

  it('la aserción de trigger FALLA sobre un trigger de INSERT real', () => {
    const fake = 'CREATE TRIGGER x BEFORE INSERT ON prospect_candidates';
    const triggers = fake.match(/CREATE\s+TRIGGER[\s\S]*?ON\s+prospect_candidates/gi) ?? [];
    assert.equal(triggers.length, 1, 'el detector de triggers no encuentra nada');
    assert.ok(/INSERT/i.test(triggers[0]), 'el detector no distingue un trigger de INSERT');
  });
});
