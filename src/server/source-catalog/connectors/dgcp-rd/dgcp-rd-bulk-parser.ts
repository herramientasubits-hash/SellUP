/**
 * DGCP RD Bulk XLSX Parser — RepúblicaDominicana.2G
 *
 * Parses the DGCP bulk XLSX files:
 *   - GET /tablas/proveedores → Proveedores.xlsx (135k+ rows)
 *   - GET /tablas/contratos  → Contratos.xlsx   (654k+ rows)
 *
 * Converts XLSX rows to the same DgcpProveedor and DgcpContrato types used by
 * the paginado connector, enabling full reuse of the existing normalizer and
 * snapshot builder without code duplication.
 *
 * GUARDRAILS — this module must NEVER:
 * - Write to the database
 * - Call DGCP API endpoints
 * - Call Tavily, LLM, DGII, SUNAT, Migo, SAT
 * - Write to accounts, prospect_candidates, rd_dgii_bulk
 * - Validate fiscal identity — DGCP is procurement signal only
 */

import type { DgcpProveedor, DgcpContrato } from './dgcp-rd-client';

// ─── Column index maps (validated against live XLSX headers 2026-07-01) ─────────

/** Column indices in Proveedores.xlsx */
const P = {
  RPE: 0,
  RAZON_SOCIAL: 1,
  NUMERO_DOCUMENTO: 2,
  TIPO_DOCUMENTO: 3,
  ESTADO_RPE: 4,
  // GENERO: 5
  TIPO_PERSONA: 6,
  FORMA_JURIDICA: 7,
  // FECHA_CREACION_EMPRESA: 8  (Excel serial — not needed)
  FECHA_REGISTRO_RPE: 9,
  // FECHA_ULTIMA_ACTUALIZACION_RPE: 10
  // NUMERO_REGISTRO_MERCANTIL: 11
  // FECHA_REGISTRO_MERCANTIL: 12 (Excel serial — not needed)
  MIPYME: 13,
  // ...
  CLASIFICACION: 16,
  // ...
  PAIS: 27,
  REGION: 28,
  PROVINCIA: 29,
  MUNICIPIO: 30,
} as const;

/** Column indices in Contratos.xlsx */
const C = {
  CODIGO_CONTRATO: 0,
  ESTADO_CONTRATO: 1,
  ESTADO_ADJUDICACION: 2,
  FECHA_ADJUDICACION: 3,
  VALOR_CONTRATADO: 4,
  MONEDA: 5,
  // FECHA_CREACION_CONTRATO: 6
  OBJETO_CONTRATO: 7,
  RPE: 8,
  RAZON_SOCIAL: 9,
  NUMERO_DOCUMENTO: 10,
} as const;

// ─── Value helpers ─────────────────────────────────────────────────────────────

function toStr(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const lower = v.toLowerCase().trim();
    if (lower === 'si' || lower === 'sí' || lower === 'yes') return true;
    if (lower === 'no' || lower === 'false') return false;
  }
  return null;
}

/** Converts RPE (number or string in XLSX) to canonical string key. */
export function rpeToKey(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return String(Math.trunc(v));
  }
  return null;
}

// ─── Row parsers ───────────────────────────────────────────────────────────────

/**
 * Parses a raw XLSX row from Proveedores.xlsx (array of cell values, no header)
 * into a DgcpProveedor. Returns null for invalid/empty rows.
 */
export function parseProveedorXlsxRow(row: unknown[]): DgcpProveedor | null {
  if (!row || row.length < 14) return null;
  const rpe = rpeToKey(row[P.RPE]);
  if (!rpe) return null;

  return {
    rpe,
    razon_social: toStr(row[P.RAZON_SOCIAL]),
    tipo_documento: toStr(row[P.TIPO_DOCUMENTO]),
    numero_documento: toStr(row[P.NUMERO_DOCUMENTO]),
    estado: toStr(row[P.ESTADO_RPE]),
    tipo_persona: toStr(row[P.TIPO_PERSONA]),
    forma_juridica: toStr(row[P.FORMA_JURIDICA]),
    fecha_registro_rpe: toStr(row[P.FECHA_REGISTRO_RPE]),
    es_mipyme: toBool(row[P.MIPYME]),
    clasificacion: toStr(row[P.CLASIFICACION]),
    pais: toStr(row[P.PAIS]),
    region: toStr(row[P.REGION]),
    provincia: toStr(row[P.PROVINCIA]),
    municipio: toStr(row[P.MUNICIPIO]),
  };
}

/**
 * Parses a raw XLSX row from Contratos.xlsx (array of cell values, no header)
 * into a DgcpContrato. Returns null for invalid/empty rows.
 *
 * Note: codigo_proceso, url_contrato, unidad_compra, codigo_unidad_compra are
 * not present in the bulk XLSX (they're null).
 */
export function parseContratoXlsxRow(row: unknown[]): DgcpContrato | null {
  if (!row || row.length < 9) return null;
  const rpe = rpeToKey(row[C.RPE]);
  if (!rpe) return null;

  const descripcionRaw = row[C.OBJETO_CONTRATO];
  const descripcion =
    typeof descripcionRaw === 'string' ? descripcionRaw.slice(0, 280) : null;

  return {
    codigo_contrato: toStr(row[C.CODIGO_CONTRATO]),
    codigo_proceso: null,
    estado_contrato: toStr(row[C.ESTADO_CONTRATO]),
    estado_adjudicacion: toStr(row[C.ESTADO_ADJUDICACION]),
    fecha_adjudicacion: toStr(row[C.FECHA_ADJUDICACION]),
    divisa: toStr(row[C.MONEDA]),
    valor_contratado: toNum(row[C.VALOR_CONTRATADO]),
    descripcion,
    url_contrato: null,
    unidad_compra: null,
    codigo_unidad_compra: null,
    rpe,
    razon_social: toStr(row[C.RAZON_SOCIAL]),
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

export type BulkParseStats = {
  totalRowsRead: number;
  validRows: number;
  skippedRows: number;
};

export type ParseProveedoresResult = {
  map: Map<string, DgcpProveedor>;
  stats: BulkParseStats;
};

export type ParseContratosResult = {
  contratos: DgcpContrato[];
  stats: BulkParseStats;
};

/**
 * Parses Proveedores.xlsx into a Map keyed by RPE string.
 * All providers are included (juridical/physical filter happens in the normalizer).
 *
 * Requires `xlsx` to be installed (in package.json as dependency).
 */
export function parseDgcpProveedoresXlsx(filePath: string): ParseProveedoresResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const xl = require('xlsx') as typeof import('xlsx');

  const wb = xl.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];

  if (!ws) {
    return { map: new Map(), stats: { totalRowsRead: 0, validRows: 0, skippedRows: 0 } };
  }

  const rows = xl.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  const map = new Map<string, DgcpProveedor>();
  let validRows = 0;
  let skippedRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const proveedor = parseProveedorXlsxRow(row);
    if (!proveedor?.rpe) {
      skippedRows++;
      continue;
    }
    map.set(proveedor.rpe, proveedor);
    validRows++;
  }

  return {
    map,
    stats: { totalRowsRead: rows.length - 1, validRows, skippedRows },
  };
}

/**
 * Parses Contratos.xlsx into a DgcpContrato array.
 * Optionally filters by year range derived from FECHA_ADJUDICACION.
 *
 * Requires `xlsx` to be installed.
 */
export function parseDgcpContratosXlsx(
  filePath: string,
  yearFilter?: { from?: number; to?: number },
): ParseContratosResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const xl = require('xlsx') as typeof import('xlsx');

  const wb = xl.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];

  if (!ws) {
    return { contratos: [], stats: { totalRowsRead: 0, validRows: 0, skippedRows: 0 } };
  }

  const rows = xl.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  const contratos: DgcpContrato[] = [];
  let validRows = 0;
  let skippedRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];

    if (yearFilter && (yearFilter.from != null || yearFilter.to != null)) {
      const fechaStr = toStr(row[C.FECHA_ADJUDICACION]);
      if (fechaStr) {
        const m = fechaStr.match(/^(\d{4})-/);
        if (m) {
          const year = parseInt(m[1], 10);
          if (yearFilter.from != null && year < yearFilter.from) {
            skippedRows++;
            continue;
          }
          if (yearFilter.to != null && year > yearFilter.to) {
            skippedRows++;
            continue;
          }
        }
      }
    }

    const contrato = parseContratoXlsxRow(row);
    if (!contrato) {
      skippedRows++;
      continue;
    }
    contratos.push(contrato);
    validRows++;
  }

  return {
    contratos,
    stats: { totalRowsRead: rows.length - 1, validRows, skippedRows },
  };
}

/**
 * Downloads a DGCP XLSX bulk file to a local path.
 * Uses streaming via fetch to avoid buffering the entire response in memory before disk write.
 */
export async function downloadDgcpXlsx(
  url: string,
  destPath: string,
  timeoutMs = 60_000,
): Promise<{ ok: true; byteSize: number } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SellUp/0.1 data-source-audit', Accept: '*/*' },
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} from ${url}` };
    }

    if (!response.body) {
      return { ok: false, error: 'No response body' };
    }

    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { Readable } = await import('node:stream');

    const fileStream = createWriteStream(destPath);
    const nodeStream = Readable.fromWeb(
      response.body as import('stream/web').ReadableStream<Uint8Array>,
    );
    await pipeline(nodeStream, fileStream);

    const { statSync } = await import('node:fs');
    const byteSize = statSync(destPath).size;
    return { ok: true, byteSize };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}
