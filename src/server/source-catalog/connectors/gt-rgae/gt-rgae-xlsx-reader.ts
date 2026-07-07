/**
 * GT RGAE — XLSX Reader (local file)
 *
 * Abre un XLSX oficial RGAE descargado localmente.
 * No descarga desde internet. No resuelve Cloudflare.
 * Path siempre por CLI — nunca hardcodeado.
 *
 * Diseñado para separación reader/normalizer/adapter:
 * este módulo solo lee y valida estructura, no normaliza datos.
 *
 * Hito: Centroamérica.7G.1
 */

import * as fs from 'node:fs';
import * as XLSX from 'xlsx';
import type { GtRgaeRawRow } from './gt-rgae-types';
import { GT_RGAE_EXPECTED_COLUMNS } from './gt-rgae-types';

export interface GtRgaeXlsxReadResult {
  ok: boolean;
  sheetName: string | null;
  rows: GtRgaeRawRow[];
  missingColumns: string[];
  detectedColumns: string[];
  error: string | null;
}

/**
 * Lee el XLSX RGAE desde una ruta local absoluta.
 * Valida las 8 columnas esperadas antes de devolver rows.
 * No imprime contenido sensible — usa masking en logs de caller.
 */
export function readGtRgaeXlsx(absolutePath: string): GtRgaeXlsxReadResult {
  if (!absolutePath || absolutePath.trim() === '') {
    return { ok: false, sheetName: null, rows: [], missingColumns: [], detectedColumns: [], error: 'file_path_empty' };
  }

  if (!fs.existsSync(absolutePath)) {
    return { ok: false, sheetName: null, rows: [], missingColumns: [], detectedColumns: [], error: 'file_not_found' };
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch (err) {
    return { ok: false, sheetName: null, rows: [], missingColumns: [], detectedColumns: [], error: `read_error: ${err instanceof Error ? err.message : String(err)}` };
  }

  return readGtRgaeXlsxFromBuffer(buffer);
}

/**
 * Lee el XLSX desde un Buffer (útil para tests con fixtures sintéticos).
 */
export function readGtRgaeXlsxFromBuffer(buffer: Buffer): GtRgaeXlsxReadResult {
  let wb: XLSX.WorkBook;
  try {
    // cellDates:true para que ExcelJS/SheetJS intente convertir fechas Excel a Date
    // raw:false para que los números sean strings cuando el tipo de celda es texto
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    return { ok: false, sheetName: null, rows: [], missingColumns: [], detectedColumns: [], error: `parse_error: ${err instanceof Error ? err.message : String(err)}` };
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { ok: false, sheetName: null, rows: [], missingColumns: [], detectedColumns: [], error: 'empty_workbook' };
  }

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return { ok: false, sheetName, rows: [], missingColumns: [], detectedColumns: [], error: `sheet_not_found: ${sheetName}` };
  }

  // sheet_to_json con header:1 para obtener la primera fila como headers
  const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

  if (rawMatrix.length === 0) {
    return { ok: false, sheetName, rows: [], missingColumns: [...GT_RGAE_EXPECTED_COLUMNS], detectedColumns: [], error: 'empty_sheet' };
  }

  const headerRow = rawMatrix[0] as (string | null)[];
  const detectedColumns = headerRow.map((h) => (h !== null && h !== undefined ? String(h).trim() : ''));

  // Validar columnas esperadas
  const missingColumns = GT_RGAE_EXPECTED_COLUMNS.filter(
    (col) => !detectedColumns.includes(col),
  );

  if (missingColumns.length > 0) {
    return { ok: false, sheetName, rows: [], missingColumns, detectedColumns, error: `missing_columns: ${missingColumns.join(', ')}` };
  }

  // Parsear rows usando sheet_to_json con defval:null
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });

  const rows: GtRgaeRawRow[] = jsonRows.map((r) => ({
    NIT_PROVEEDOR: toNullableRaw(r['NIT_PROVEEDOR']),
    TIPO_PROVEEDOR: toNullableString(r['TIPO_PROVEEDOR']),
    NOMBRE_PROVEEDOR: toNullableString(r['NOMBRE_PROVEEDOR']),
    TIPO_SOLICITUD: toNullableString(r['TIPO_SOLICITUD']),
    FECHA_RESOLUCION: toNullableRaw(r['FECHA_RESOLUCION']),
    NO_RESOLUCION: toNullableRaw(r['NO_RESOLUCION']),
    NO_CONSTANCIA: toNullableRaw(r['NO_CONSTANCIA']),
    CAPACIDAD_ECONOMICA: toNullableRaw(r['CAPACIDAD_ECONOMICA']),
  }));

  return { ok: true, sheetName, rows, missingColumns: [], detectedColumns, error: null };
}

function toNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toNullableRaw(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0] ?? null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  return s === '' ? null : s;
}
