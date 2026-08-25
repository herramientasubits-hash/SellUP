/**
 * Guarda estática — AGENT1-CUT4-B1 § 14 (bloque STATIC) y § 15.
 *
 * Lo que fija: los dos writers de este corte delegan la procedencia en la
 * AUTORIDAD CANÓNICA y no en un literal. El atajo peligroso es exactamente
 *
 *     record_origin: 'production'
 *
 * porque convierte una decisión (que un smoke o un import tienen que poder vetar)
 * en una afirmación incondicional.
 *
 * 🔴 Los comentarios se retiran ANTES de buscar. Grepear en crudo confunde
 * «nombrar el atajo para prohibirlo» con «usarlo», y con eso una guarda puede
 * declararse verde citando su propio texto. Cada aserción trae además su control
 * en NEGATIVO: se comprueba que la búsqueda SÍ detecta el atajo cuando está.
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

const STRUCTURED_WRITER =
  'src/server/agents/prospecting-toolkit/structured-source-candidate-writer.ts';
const IMPORT_ROUTE = 'src/app/api/prospect-batches/create-import-batch/route.ts';
const CUT4_B2_FILE = 'src/modules/prospect-batches/actions.ts';

const B1_WRITERS = [STRUCTURED_WRITER, IMPORT_ROUTE] as const;

function code(rel: string): string {
  return stripTsComments(readFileSync(rel, 'utf-8'));
}

/** El atajo, en las dos comillas que TypeScript admite. */
const HARDCODED_PRODUCTION = [
  "record_origin: 'production'",
  'record_origin: "production"',
] as const;

test('§ 21 — ningún writer de B1 fija record_origin a un literal de producción', () => {
  for (const rel of B1_WRITERS) {
    const src = code(rel);
    for (const shortcut of HARDCODED_PRODUCTION) {
      assert.ok(
        !src.includes(shortcut),
        `${rel} no puede afirmar producción con un literal (${shortcut})`,
      );
    }
  }
});

test('§ 21 (control negativo) — la búsqueda SÍ detecta el atajo cuando está presente', () => {
  const mutated = code(STRUCTURED_WRITER).replace(
    '...toCandidateRecordOriginColumns(recordOriginResolution)',
    "record_origin: 'production'",
  );
  assert.ok(
    HARDCODED_PRODUCTION.some((shortcut) => mutated.includes(shortcut)),
    'una guarda que no detecta la mutación no está guardando nada',
  );
});

test('§ 22 — los dos writers usan el RESOLVEDOR canónico', () => {
  for (const rel of B1_WRITERS) {
    const src = code(rel);
    assert.ok(
      src.includes('resolveCandidateRecordOriginForWriter('),
      `${rel} tiene que resolver la procedencia con la autoridad canónica`,
    );
    assert.ok(
      src.includes('candidate-record-origin'),
      `${rel} tiene que IMPORTAR la autoridad canónica, no reimplementarla`,
    );
  }
});

test('§ 23 — los dos writers usan el PROYECTOR canónico de columnas', () => {
  for (const rel of B1_WRITERS) {
    assert.ok(
      code(rel).includes('toCandidateRecordOriginColumns(recordOriginResolution)'),
      `${rel} tiene que proyectar las columnas con el helper canónico`,
    );
  }
});

test('§ 10/§ 23 — los dos writers publican la metadata canónica bajo su clave canónica', () => {
  for (const rel of B1_WRITERS) {
    const src = code(rel);
    assert.ok(
      src.includes('CANDIDATE_RECORD_ORIGIN_METADATA_KEY'),
      `${rel} tiene que usar la clave canónica de metadata`,
    );
    assert.ok(
      src.includes('toCandidateRecordOriginMetadata(recordOriginResolution)'),
      `${rel} tiene que publicar la derivación con el helper canónico`,
    );
  }
});

test('§ 24 — ningún writer de B1 define su propio vocabulario de procedencia', () => {
  // El vocabulario vive en `RecordOrigin` (classification.ts) y sólo ahí. Un writer
  // que nombrara por su cuenta los otros valores estaría abriendo una segunda
  // taxonomía.
  const foreignVocabulary = [
    "'smoke_test'",
    "'historical_cleanup'",
    "'synthetic'",
    "'qa'",
    // `RecordOrigin` a secas quedaría fuera: es subcadena de los nombres
    // canónicos (`resolveCandidateRecordOriginForWriter`) que estos writers SÍ
    // deben usar. Lo que se prohíbe es el clasificador crudo y los valores.
    'deriveRecordOriginClassification',
    "from '@/modules/agent1-effectiveness/classification'",
  ];
  for (const rel of B1_WRITERS) {
    const src = code(rel);
    for (const needle of foreignVocabulary) {
      assert.ok(
        !src.includes(needle),
        `${rel} no debe nombrar el vocabulario de origen (${needle}); lo decide el clasificador`,
      );
    }
  }
});

test('§ 11 — B1 no toca los gates de la cola de revisión limpia', () => {
  const gateSymbols = [
    'PENDING_REVIEW_RECORD_ORIGIN',
    'CANONICAL_PRODUCTION_RECORD_ORIGIN',
  ];
  for (const rel of B1_WRITERS) {
    const src = code(rel);
    for (const needle of gateSymbols) {
      assert.ok(
        !src.includes(needle),
        `${rel} no debe leer ni redefinir la política de la cola limpia (${needle})`,
      );
    }
  }
});

test('§ 3/§ 25 — CUT4-B2 sigue siendo territorio ajeno: actions.ts no proyecta procedencia', () => {
  // Fija el LÍMITE del corte, no un logro: `createProspectCandidate` y
  // `createExternalCandidatesBatch` pertenecen a B2 y este PR no los toca. Si algún
  // día lo hacen, este test se actualiza junto a ese corte — no antes.
  const src = code(CUT4_B2_FILE);
  assert.ok(
    !src.includes('resolveCandidateRecordOriginForWriter('),
    'actions.ts es de CUT4-B2; B1 no debe haberlo modificado',
  );
});
