/**
 * Tests — EC SCVS CSV Reader
 * Usa fixtures sintéticos en memoria (Readable.from). NO usa CSV real en git.
 * Hito: Catálogo.EC.3
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Readable } from 'node:stream';
import { parseCsvLine, readEcScvsCsvFromStream } from '../ec-scvs-csv-reader';

function streamFromLines(lines: string[]): NodeJS.ReadableStream {
  return Readable.from([lines.join('\n')]);
}

describe('parseCsvLine', () => {
  it('parsea campos simples separados por coma', () => {
    assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  });

  it('respeta comas dentro de campos entre comillas', () => {
    assert.deepEqual(parseCsvLine('1,"ACME, INC.",EC'), ['1', 'ACME, INC.', 'EC']);
  });

  it('des-escapa comillas dobles duplicadas dentro de un campo quoted', () => {
    assert.deepEqual(parseCsvLine('1,"SAY ""HI""",EC'), ['1', 'SAY "HI"', 'EC']);
  });

  it('preserva campos vacíos', () => {
    assert.deepEqual(parseCsvLine('1,,3'), ['1', '', '3']);
  });
});

describe('readEcScvsCsvFromStream', () => {
  const HEADER = 'expediente,ruc,nombre,tipo,pro_codigo,provincia';

  it('lee headers requeridos y una fila de datos válida', async () => {
    const stream = streamFromLines([
      HEADER,
      '1,1790013731001,ACME SA,ANONIMA,17,PICHINCHA',
    ]);
    const result = await readEcScvsCsvFromStream(stream);
    assert.equal(result.ok, true);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.ruc, '1790013731001');
    assert.equal(result.rows[0]?.nombre, 'ACME SA');
  });

  it('falla si faltan columnas requeridas', async () => {
    const stream = streamFromLines(['expediente,ruc,nombre', '1,1790013731001,ACME SA']);
    const result = await readEcScvsCsvFromStream(stream);
    assert.equal(result.ok, false);
    assert.ok(result.error?.startsWith('missing_columns'));
    assert.ok(result.missingColumns.includes('tipo'));
  });

  it('maneja comas embebidas en nombre con comillas', async () => {
    const stream = streamFromLines([
      HEADER,
      '1,1790013731001,"ACME, INC.",ANONIMA,17,PICHINCHA',
    ]);
    const result = await readEcScvsCsvFromStream(stream);
    assert.equal(result.ok, true);
    assert.equal(result.rows[0]?.nombre, 'ACME, INC.');
  });

  it('trata RUC vacío como null, no como string vacío perdido', async () => {
    const stream = streamFromLines([HEADER, '1,,ACME SA,ANONIMA,17,PICHINCHA']);
    const result = await readEcScvsCsvFromStream(stream);
    assert.equal(result.ok, true);
    assert.equal(result.rows[0]?.ruc, null);
  });

  it('maneja texto UTF-8 (acentos/ñ) sin corromper', async () => {
    const stream = streamFromLines([HEADER, '1,1790013731001,COMPAÑÍA ANÓNIMA,ANÓNIMA,17,PICHINCHA']);
    const result = await readEcScvsCsvFromStream(stream);
    assert.equal(result.ok, true);
    assert.equal(result.rows[0]?.nombre, 'COMPAÑÍA ANÓNIMA');
  });

  it('cuenta filas malformadas (column count mismatch) sin lanzar', async () => {
    const stream = streamFromLines([
      HEADER,
      '1,1790013731001,ACME SA,ANONIMA,17,PICHINCHA',
      '2,1790013731002,SOLO_TRES_CAMPOS,ANONIMA',
    ]);
    const result = await readEcScvsCsvFromStream(stream);
    assert.equal(result.ok, true);
    assert.equal(result.rows.length, 1);
    assert.equal(result.malformedRowCount, 1);
  });

  it('devuelve error para archivo/stream vacío', async () => {
    const stream = streamFromLines([]);
    const result = await readEcScvsCsvFromStream(stream);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'empty_file');
  });

  it('devuelve file_not_found para path local inexistente', async () => {
    const { readEcScvsCsv } = await import('../ec-scvs-csv-reader');
    const result = await readEcScvsCsv('/tmp/does-not-exist-ec-scvs-12345.csv');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'file_not_found');
  });
});
