/**
 * SOURCES-AR-RNS-1 — lector CSV por partes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CsvRowParser, readCsvFile } from '../streaming-csv';

function parseAll(text: string, chunkSize = text.length || 1): string[][] {
  const parser = new CsvRowParser();
  const rows: string[][] = [];
  for (let i = 0; i < text.length; i += chunkSize) rows.push(...parser.push(text.slice(i, i + chunkSize)));
  rows.push(...parser.end());
  return rows;
}

describe('CsvRowParser', () => {
  it('lee filas simples con LF y con CRLF', () => {
    assert.deepEqual(parseAll('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseAll('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  it('respeta comas, comillas escapadas y saltos de línea dentro de comillas', () => {
    const text = 'k,v\n1,"PERON, JUAN TTE.GRAL."\n2,"dice ""hola"""\n3,"línea 1\nlínea 2"\n';
    assert.deepEqual(parseAll(text), [
      ['k', 'v'],
      ['1', 'PERON, JUAN TTE.GRAL.'],
      ['2', 'dice "hola"'],
      ['3', 'línea 1\nlínea 2'],
    ]);
  });

  it('quita el BOM inicial y conserva campos vacíos', () => {
    assert.deepEqual(parseAll('﻿a,b,c\n1,,3\n'), [['a', 'b', 'c'], ['1', '', '3']]);
  });

  it('devuelve la última fila aunque no termine en salto de línea', () => {
    assert.deepEqual(parseAll('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  it('da el mismo resultado sin importar dónde se corte el archivo en trozos', () => {
    const text = '﻿cuit,nombre,nota\r\n30500000127,"SEGUROS ""X"", S.A.","a\r\nb"\r\n30500000747,BANCO,\r\n';
    const whole = parseAll(text);
    for (const size of [1, 2, 3, 5, 7, 11]) assert.deepEqual(parseAll(text, size), whole, `trozo ${size}`);
  });
});

describe('readCsvFile', () => {
  it('entrega objetos por cabecera y salta filas vacías', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'streaming-csv-'));
    try {
      const path = join(dir, 'x.csv');
      writeFileSync(path, '﻿cuit,razon_social\r\n30500000127,"SEGUROS, S.A."\r\n\r\n30500000747,BANCO\r\n');
      const rows: Record<string, string>[] = [];
      for await (const row of readCsvFile(path)) rows.push(row);
      assert.deepEqual(rows, [
        { cuit: '30500000127', razon_social: 'SEGUROS, S.A.' },
        { cuit: '30500000747', razon_social: 'BANCO' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
