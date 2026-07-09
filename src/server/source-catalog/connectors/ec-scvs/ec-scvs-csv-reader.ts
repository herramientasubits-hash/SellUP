/**
 * EC SCVS — CSV Reader (local file)
 *
 * Lee bi_compania.csv descargado localmente (~53 MB).
 * No descarga desde internet. Path siempre por CLI — nunca hardcodeado.
 *
 * No usa split(',') ingenuo: implementa un parser de línea consciente de
 * comillas (RFC 4180-like) porque el campo "nombre" puede contener comas.
 * Procesa por streaming (línea a línea) para no cargar el archivo completo
 * como un único array de strings en memoria más de lo necesario.
 *
 * Diseñado para separación reader/normalizer/adapter: este módulo solo lee
 * y valida estructura, no normaliza datos de negocio.
 *
 * Hito: Catálogo.EC.3
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import type { EcScvsRawRow } from './ec-scvs-types';
import { EC_SCVS_EXPECTED_COLUMNS } from './ec-scvs-types';

export interface EcScvsCsvReadResult {
  ok: boolean;
  rows: EcScvsRawRow[];
  missingColumns: string[];
  detectedColumns: string[];
  malformedRowCount: number;
  error: string | null;
}

/**
 * Parsea una línea CSV respetando comillas dobles ("...") y comas embebidas.
 * No soporta campos con salto de línea embebido (el dataset SCVS usa
 * newline Unix por registro, sin multi-line quoted fields observados).
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function toNullableField(v: string | undefined): string | null {
  if (v === undefined) return null;
  return v === '' ? null : v;
}

/**
 * Lee el CSV SCVS desde una ruta local absoluta, línea por línea.
 * Valida las 6 columnas esperadas contra el header antes de aceptar rows.
 */
export async function readEcScvsCsv(absolutePath: string): Promise<EcScvsCsvReadResult> {
  if (!absolutePath || absolutePath.trim() === '') {
    return {
      ok: false,
      rows: [],
      missingColumns: [],
      detectedColumns: [],
      malformedRowCount: 0,
      error: 'file_path_empty',
    };
  }

  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      rows: [],
      missingColumns: [],
      detectedColumns: [],
      malformedRowCount: 0,
      error: 'file_not_found',
    };
  }

  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(absolutePath, { encoding: 'utf-8' });
  } catch (err) {
    return {
      ok: false,
      rows: [],
      missingColumns: [],
      detectedColumns: [],
      malformedRowCount: 0,
      error: `read_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return readEcScvsCsvFromStream(stream);
}

/**
 * Lee el CSV desde cualquier stream/iterable de texto línea a línea.
 * Expuesto por separado para permitir tests con fixtures sintéticos sin tocar disco.
 */
export async function readEcScvsCsvFromStream(
  input: NodeJS.ReadableStream,
): Promise<EcScvsCsvReadResult> {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let headerParsed = false;
  let detectedColumns: string[] = [];
  let missingColumns: string[] = [];
  const rows: EcScvsRawRow[] = [];
  let malformedRowCount = 0;
  let headerError: string | null = null;

  for await (const line of rl) {
    if (line === '') continue;

    if (!headerParsed) {
      headerParsed = true;
      detectedColumns = parseCsvLine(line).map((h) => h.trim());
      missingColumns = EC_SCVS_EXPECTED_COLUMNS.filter((col) => !detectedColumns.includes(col));
      if (missingColumns.length > 0) {
        headerError = `missing_columns: ${missingColumns.join(', ')}`;
        break;
      }
      continue;
    }

    const fields = parseCsvLine(line);
    if (fields.length !== detectedColumns.length) {
      malformedRowCount++;
      continue;
    }

    const record: Record<string, string> = {};
    for (let i = 0; i < detectedColumns.length; i++) {
      record[detectedColumns[i]!] = fields[i] ?? '';
    }

    rows.push({
      expediente: toNullableField(record.expediente),
      ruc: toNullableField(record.ruc),
      nombre: toNullableField(record.nombre),
      tipo: toNullableField(record.tipo),
      pro_codigo: toNullableField(record.pro_codigo),
      provincia: toNullableField(record.provincia),
    });
  }

  if (!headerParsed) {
    return {
      ok: false,
      rows: [],
      missingColumns: [...EC_SCVS_EXPECTED_COLUMNS],
      detectedColumns: [],
      malformedRowCount: 0,
      error: 'empty_file',
    };
  }

  if (headerError) {
    return {
      ok: false,
      rows: [],
      missingColumns,
      detectedColumns,
      malformedRowCount: 0,
      error: headerError,
    };
  }

  return { ok: true, rows, missingColumns: [], detectedColumns, malformedRowCount, error: null };
}
