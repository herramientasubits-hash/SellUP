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
