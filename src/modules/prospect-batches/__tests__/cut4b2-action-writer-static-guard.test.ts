/**
 * Guarda estática — AGENT1-CUT4-B2 § 14 y § 15.
 *
 * Lo que fija: los DOS writers de `actions.ts` — `createProspectCandidate` y
 * `createExternalCandidatesBatch` — delegan la procedencia en la AUTORIDAD
 * CANÓNICA y no en un literal. El atajo peligroso es exactamente
 *
 *     record_origin: 'production'
 *
 * porque convierte una decisión (que un smoke, un QA, un import o una corrida
 * no ejecutada tienen que poder vetar) en una afirmación incondicional.
 *
 * 🔴 Los comentarios se retiran ANTES de buscar. Grepear en crudo confunde
 * «nombrar el atajo para prohibirlo» con «usarlo», y con eso una guarda puede
 * declararse verde citando su propio texto. Cada aserción trae además su control
 * en NEGATIVO: se comprueba que la búsqueda SÍ detecta el atajo cuando está.
 *
 * 🔴 No es un espejo del código: no fija el ORDEN de las líneas ni el texto de
 * los comentarios. Fija la delegación y la ausencia del atajo — dos propiedades
 * que sobreviven a cualquier refactor honesto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const ACTIONS = 'src/modules/prospect-batches/actions.ts';

function code(rel: string): string {
  return stripTsComments(readFileSync(rel, 'utf-8'));
}

/** El atajo, en las dos comillas que TypeScript admite. */
const HARDCODED_PRODUCTION = [
  "record_origin: 'production'",
  'record_origin: "production"',
] as const;

/**
 * Aísla el cuerpo de una función `export async function <nombre>(` hasta el
 * siguiente `export ` de primer nivel. Sirve para afirmar cosas DEL WRITER y no
 * del archivo entero, que tiene 40 exports más.
 */
function writerBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `no se encontró el writer ${name} en ${ACTIONS}`);
  const rest = src.slice(start + 1);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
}

const B2_WRITERS = ['createProspectCandidate', 'createExternalCandidatesBatch'] as const;

test('§ 14 — ningún writer de B2 fija record_origin a un literal de producción', () => {
  const src = code(ACTIONS);
  for (const writer of B2_WRITERS) {
    const body = writerBody(src, writer);
    for (const shortcut of HARDCODED_PRODUCTION) {
      assert.ok(
        !body.includes(shortcut),
        `${writer} no puede afirmar producción con un literal (${shortcut})`,
      );
    }
  }
});

test('§ 14 (control negativo) — la búsqueda SÍ detecta el atajo cuando está presente', () => {
  const src = code(ACTIONS);
  for (const [writer, projection] of [
    ['createProspectCandidate', '...recordOriginColumns'],
    ['createExternalCandidatesBatch', '...toCandidateRecordOriginColumns(recordOriginResolution)'],
  ] as const) {
    const mutated = writerBody(src, writer).replace(projection, "record_origin: 'production'");
    assert.ok(
      HARDCODED_PRODUCTION.some((shortcut) => mutated.includes(shortcut)),
      `una guarda que no detecta la mutación en ${writer} no está guardando nada`,
    );
  }
});

test('§ 3 — los dos writers RESUELVEN con la autoridad canónica', () => {
  const src = code(ACTIONS);
  assert.ok(
    src.includes("from '@/server/agents/prospecting-toolkit/candidate-record-origin'"),
    'actions.ts tiene que IMPORTAR la autoridad canónica, no reimplementarla',
  );
  for (const writer of B2_WRITERS) {
    assert.ok(
      writerBody(src, writer).includes('resolveCandidateRecordOriginForWriter('),
      `${writer} tiene que resolver la procedencia con la autoridad canónica`,
    );
  }
});

test('§ 3 — los dos writers PROYECTAN con el helper canónico de columnas', () => {
  const src = code(ACTIONS);
  for (const writer of B2_WRITERS) {
    assert.ok(
      writerBody(src, writer).includes('toCandidateRecordOriginColumns('),
      `${writer} tiene que proyectar las columnas con el helper canónico`,
    );
  }
});

test('§ 8 — los dos writers publican la metadata canónica bajo su clave canónica', () => {
  const src = code(ACTIONS);
  for (const writer of B2_WRITERS) {
    const body = writerBody(src, writer);
    assert.ok(
      body.includes('CANDIDATE_RECORD_ORIGIN_METADATA_KEY'),
      `${writer} tiene que usar la clave canónica de metadata`,
    );
    assert.ok(
      body.includes('toCandidateRecordOriginMetadata(recordOriginResolution)'),
      `${writer} tiene que publicar la derivación con el helper canónico`,
    );
  }
});

test('§ 3 — actions.ts no abre un SEGUNDO clasificador', () => {
  // El vocabulario y las reglas viven en `classification.ts` y sólo ahí. Un
  // writer que importara el clasificador crudo, o que nombrara los valores por su
  // cuenta, estaría abriendo una segunda taxonomía.
  const src = code(ACTIONS);
  const foreignVocabulary = [
    'deriveRecordOriginClassification',
    "from '@/modules/agent1-effectiveness/classification'",
    "record_origin: 'smoke_test'",
    "record_origin: 'historical_cleanup'",
    "record_origin: 'synthetic'",
    "record_origin: 'qa'",
    "record_origin: 'import'",
    "record_origin: 'unknown'",
  ];
  for (const needle of foreignVocabulary) {
    assert.ok(
      !src.includes(needle),
      `actions.ts no debe nombrar el vocabulario de origen (${needle}); lo decide el clasificador`,
    );
  }
});

test('§ 12 — B2 no toca la política de la cola de revisión limpia', () => {
  const src = code(ACTIONS);
  assert.ok(
    !src.includes('PENDING_REVIEW_RECORD_ORIGIN'),
    'actions.ts no debe leer ni redefinir la política de la cola limpia',
  );
});

test('§ 7 — la procedencia viaja en el INSERT, nunca en un UPDATE posterior', () => {
  // Una sola puerta de persistencia: si `record_origin` apareciera dentro de un
  // `.update(`, la fila se estaría parcheando después de nacer.
  const src = code(ACTIONS);
  for (const writer of B2_WRITERS) {
    const body = writerBody(src, writer);
    assert.ok(!body.includes('.update('), `${writer} no puede parchear la fila tras insertarla`);
  }
});

// ─── AGENT1-CUT4-B2-CORRECTION-1 ────────────────────────────────────────────
//
// Lo que añaden estas guardas: que la corrección no se pueda deshacer en
// silencio. El primer B2 dejaba vivo un write exitoso con `record_origin` sin
// resolver cuando no lograba el contexto del lote; el arreglo es (a) que la
// adopción EXISTENTE transporte ese contexto y (b) que la proyección canónica
// sea incondicional. Ambas son propiedades estructurales, así que se fijan aquí
// además de en el arnés de runtime.

/** El vocabulario de la supresión que la corrección elimina. */
const SUPPRESSION_VOCABULARY = [
  'assertsProductionWithoutBatchContext',
  'production_assertion_suppressed',
  'batch_context_available',
  'CANONICAL_PRODUCTION_RECORD_ORIGIN',
] as const;

test('§ 2 — la adopción del lote técnico devuelve su CONTEXTO, no sólo el id', () => {
  const src = code(ACTIONS);
  const body = writerBody(src, 'getOrCreateTechnicalManualBatch');

  assert.ok(
    body.includes("'id, source, name, metadata'"),
    'la selección existente tiene que traer la procedencia del lote que adopta',
  );
  assert.ok(
    src.includes('Promise<AdoptedBatchProvenance>'),
    'y devolverla, para que el writer no necesite una segunda lectura',
  );
  assert.ok(
    !body.includes("return existingBatch.id;") && !body.includes('return newBatch.id;'),
    'devolver sólo el id obligaría a releer el lote ya resuelto',
  );
});

test('§ 2 (control negativo) — la guarda detecta una adopción que vuelve a traer sólo el id', () => {
  const src = code(ACTIONS);
  // `split/join` a propósito: la selección ampliada aparece en las DOS ramas de
  // la adopción (búsqueda y creación), y una guarda que sólo mutara la primera
  // se declararía verde citando la segunda.
  const mutated = writerBody(src, 'getOrCreateTechnicalManualBatch')
    .split("'id, source, name, metadata'")
    .join("'id'");
  assert.ok(
    !mutated.includes("'id, source, name, metadata'"),
    'una guarda que no detecta el retroceso no está guardando nada',
  );
});

test('§ 2 — createProspectCandidate no abre una SEGUNDA lectura de lote', () => {
  // El contexto viaja con la adopción. La única lectura que queda es la de la
  // rama en la que el llamador impone el lote y no hubo adopción alguna.
  const src = code(ACTIONS);
  const body = writerBody(src, 'createProspectCandidate');
  const reads = body.split("from('prospect_batches')").length - 1;
  assert.ok(
    reads <= 1,
    `createProspectCandidate no puede leer el lote más de una vez (encontradas ${reads})`,
  );
});

test('§ 2 (control negativo) — la guarda detecta una segunda lectura de lote', () => {
  const src = code(ACTIONS);
  const body = writerBody(src, 'createProspectCandidate');
  const mutated = `${body}\n  await supabase.from('prospect_batches').select('source');`;
  const reads = mutated.split("from('prospect_batches')").length - 1;
  assert.ok(reads > 1, 'la guarda tiene que ver la lectura añadida');
});

test('§ 3 — la proyección canónica es INCONDICIONAL: nada vacía las columnas', () => {
  const src = code(ACTIONS);
  const body = writerBody(src, 'createProspectCandidate');

  assert.ok(
    body.includes('const recordOriginColumns = toCandidateRecordOriginColumns(recordOriginResolution);'),
    'la proyección tiene que ser directa: una rama que la vacíe reproduce el defecto',
  );
  for (const needle of SUPPRESSION_VOCABULARY) {
    assert.ok(
      !body.includes(needle),
      `la supresión de la afirmación de producción ya no existe (${needle})`,
    );
  }
});

test('§ 3 (control negativo) — la guarda detecta el retorno de la supresión', () => {
  const src = code(ACTIONS);
  const mutated = writerBody(src, 'createProspectCandidate').replace(
    'const recordOriginColumns = toCandidateRecordOriginColumns(recordOriginResolution);',
    'const recordOriginColumns = assertsProductionWithoutBatchContext ? {} : resolvedOriginColumns;',
  );
  assert.ok(
    SUPPRESSION_VOCABULARY.some((needle) => mutated.includes(needle)),
    'una guarda que no detecta la vuelta de la supresión no está guardando nada',
  );
});

test('§ 3 — el fail-closed corta ANTES de la puerta de persistencia', () => {
  // El orden importa: los `throw` del contexto de lote tienen que estar por
  // encima del INSERT de candidato. Si aparecieran después, la fila ya existiría.
  const src = code(ACTIONS);
  const body = writerBody(src, 'createProspectCandidate');

  const insertDoor = body.indexOf(".from('prospect_candidates')");
  assert.notEqual(insertDoor, -1, 'no se encontró la puerta de persistencia');

  const failClosedThrows = [
    'no se pudo resolver la procedencia del lote indicado',
    'el lote indicado no existe o no es accesible',
  ];
  for (const message of failClosedThrows) {
    const at = body.indexOf(message);
    assert.notEqual(at, -1, `falta el fail-closed «${message}»`);
    assert.ok(
      at < insertDoor,
      `el fail-closed «${message}» tiene que cortar antes de insertar la fila`,
    );
  }
});
