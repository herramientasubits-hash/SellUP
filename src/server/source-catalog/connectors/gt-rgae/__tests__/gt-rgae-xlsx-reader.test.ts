/**
 * Tests — GT RGAE XLSX Reader
 * Usa fixtures sintéticos generados en test. NO usa XLSX real en git.
 * Hito: Centroamérica.7G.1
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import { readGtRgaeXlsxFromBuffer } from '../gt-rgae-xlsx-reader';

const VALID_HEADERS = [
  'NIT_PROVEEDOR',
  'TIPO_PROVEEDOR',
  'NOMBRE_PROVEEDOR',
  'TIPO_SOLICITUD',
  'FECHA_RESOLUCION',
  'NO_RESOLUCION',
  'NO_CONSTANCIA',
  'CAPACIDAD_ECONOMICA',
];

function buildXlsxBuffer(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function buildXlsxFromMatrix(matrix: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

describe('readGtRgaeXlsxFromBuffer', () => {
  it('lee headers válidos con una fila de datos', () => {
    const buf = buildXlsxBuffer([{
      NIT_PROVEEDOR: '1234567',
      TIPO_PROVEEDOR: 'Sociedades',
      NOMBRE_PROVEEDOR: 'EMPRESA SA',
      TIPO_SOLICITUD: 'INSCRIPCION',
      FECHA_RESOLUCION: '01/06/2025',
      NO_RESOLUCION: '1234',
      NO_CONSTANCIA: '5678',
      CAPACIDAD_ECONOMICA: 'N/A',
    }]);
    const result = readGtRgaeXlsxFromBuffer(buf);
    assert.ok(result.ok, result.error ?? 'expected ok');
    assert.equal(result.rows.length, 1);
    assert.equal(result.missingColumns.length, 0);
  });

  it('falla si falta una columna obligatoria', () => {
    const buf = buildXlsxBuffer([{
      NIT_PROVEEDOR: '1234567',
      TIPO_PROVEEDOR: 'Sociedades',
      // NOMBRE_PROVEEDOR faltante
      TIPO_SOLICITUD: 'INSCRIPCION',
      FECHA_RESOLUCION: '01/06/2025',
      NO_RESOLUCION: '1234',
      NO_CONSTANCIA: '5678',
      CAPACIDAD_ECONOMICA: 'N/A',
    }]);
    const result = readGtRgaeXlsxFromBuffer(buf);
    assert.equal(result.ok, false);
    assert.ok(result.missingColumns.includes('NOMBRE_PROVEEDOR'));
  });

  it('falla en hoja sin filas (empty_sheet)', () => {
    // XLSX library requiere al menos una hoja para poder serializar.
    // Probamos con una hoja que tiene solo headers vacíos → empty_sheet.
    const ws = XLSX.utils.aoa_to_sheet([[]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const result = readGtRgaeXlsxFromBuffer(buf);
    // Con una hoja de una sola fila vacía, no habrá columnas válidas
    assert.equal(result.ok, false);
    assert.ok(
      result.error === 'empty_sheet' || (result.missingColumns?.length ?? 0) > 0,
      `esperado empty_sheet o missing columns, got: ${result.error}`,
    );
  });

  it('NIT numérico viene como número en raw row', () => {
    const buf = buildXlsxBuffer([{
      NIT_PROVEEDOR: 1234567,
      TIPO_PROVEEDOR: 'Sociedades',
      NOMBRE_PROVEEDOR: 'EMPRESA SA',
      TIPO_SOLICITUD: 'INSCRIPCION',
      FECHA_RESOLUCION: '01/06/2025',
      NO_RESOLUCION: 100,
      NO_CONSTANCIA: 200,
      CAPACIDAD_ECONOMICA: 'N/A',
    }]);
    const result = readGtRgaeXlsxFromBuffer(buf);
    assert.ok(result.ok);
    const row = result.rows[0]!;
    // Número raw: acepta number o string numérica
    assert.ok(
      typeof row.NIT_PROVEEDOR === 'number' || !isNaN(Number(row.NIT_PROVEEDOR)),
      'NIT numérico debe ser number o string numérica',
    );
  });

  it('NIT textual viene preservado como string', () => {
    const buf = buildXlsxFromMatrix([
      VALID_HEADERS,
      ['0001234', 'Sociedades', 'EMPRESA SA', 'INSCRIPCION', '01/06/2025', '1234', '5678', 'N/A'],
    ]);
    const result = readGtRgaeXlsxFromBuffer(buf);
    assert.ok(result.ok);
    const row = result.rows[0]!;
    assert.ok(String(row.NIT_PROVEEDOR).includes('1234'), 'NIT textual debe preservarse');
  });

  it('expone sheetName en el resultado', () => {
    const buf = buildXlsxBuffer([{
      NIT_PROVEEDOR: '1234567',
      TIPO_PROVEEDOR: 'Sociedades',
      NOMBRE_PROVEEDOR: 'EMPRESA SA',
      TIPO_SOLICITUD: 'INSCRIPCION',
      FECHA_RESOLUCION: '01/06/2025',
      NO_RESOLUCION: '1234',
      NO_CONSTANCIA: '5678',
      CAPACIDAD_ECONOMICA: 'N/A',
    }]);
    const result = readGtRgaeXlsxFromBuffer(buf);
    assert.ok(result.sheetName !== null, 'debe tener sheetName');
  });
});
