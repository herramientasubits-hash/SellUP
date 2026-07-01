/**
 * DGII República Dominicana — Snapshot Importer
 *
 * Descarga el padrón completo de RNC de la DGII y persiste únicamente RNC
 * jurídicos de 9 dígitos en source_company_snapshots.
 *
 * Por defecto: dry-run (no escribe). Usar --apply para persistir.
 * Requiere --limit con --apply como guardrail.
 *
 * Privacidad: Las primeras ~497 líneas son personas físicas (cédulas 11 dígitos).
 * Este importer NUNCA persiste identificadores de 11 dígitos, nombres personales
 * ni ningún dato de personas físicas.
 *
 * No usa WebForms POST. No usa Dominican Technology API. No usa SOAP.
 * No escribe en cuentas, candidatos ni otras tablas.
 * No llama Tavily, LLM ni Migo.
 * No toca Perú, Colombia, Chile ni Agente 1/2.
 *
 * Centroamérica.1A.2
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 has no global WebSocket, which the Supabase client needs.
// Same pattern as SUNAT importer (Perú.9B). Must be called before createClient().
import { ensureNode20WebSocketShim } from '../../../../../scripts/peru/ensure-node20-websocket-shim';
import { headDgiiRncZip } from './dgii-bulk-client';
import { parseDgiiLines } from './dgii-bulk-parser';
import {
  RD_DGII_BULK_SOURCE_KEY,
  RD_DGII_BULK_COUNTRY_CODE,
  RD_DGII_RNC_TXT_ZIP_URL,
} from './types';
import { normalizeDominicanRnc } from './normalizers';

const inflateRawAsync = promisify(inflateRaw);

// ── Constants ──────────────────────────────────────────────────────────────────

const SNAPSHOT_TABLE = 'source_company_snapshots';
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_DOWNLOAD_PATH = '.tmp/dgii-rd/DGII_RNC.zip';
const IMPORTER_VERSION = '1A.2';
const DGII_REFERER = 'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx';

// ── CLI types ──────────────────────────────────────────────────────────────────

export type ImportConfig = {
  dryRun: boolean;
  apply: boolean;
  limit: number | null;
  offset: number;
  chunkSize: number;
  downloadTo: string;
  reuseLocal: boolean;
};

export type ImportReport = {
  sourceKey: string;
  countryCode: string;
  sourceYear: number;
  dryRun: boolean;
  applied: boolean;
  linesRead: number;
  linesInWindow: number;
  businessRncRows: number;
  outOfScopePersonRows: number;
  invalidRows: number;
  parseErrors: number;
  rowsPrepared: number;
  rowsUpserted: number;
  chunksProcessed: number;
  errors: string[];
  warnings: string[];
  durationMs: number;
};

// ── Strict integer parsing (Perú.9I.1 pattern) ────────────────────────────────

/**
 * Rejects 1e+06, 1000.5, -1, abc, "".
 * Only accepts plain decimal non-negative integers.
 */
export function parseStrictNonNegativeIntegerArg(value: string, argName: string): number {
  const isPlainNonNegativeInteger = /^\d+$/.test(value);
  const parsed = Number(value);

  if (!isPlainNonNegativeInteger || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${argName}: expected a plain non-negative integer, received ${JSON.stringify(value)}`,
    );
  }

  return parsed;
}

export function parseCliArgs(argv: string[]): ImportConfig {
  const args = argv.slice(2);
  const dryRun = !args.includes('--apply');
  const apply = args.includes('--apply');
  const reuseLocal = args.includes('--reuse-local');

  const limitIdx = args.indexOf('--limit');
  const limitRaw = limitIdx !== -1 ? args[limitIdx + 1] : undefined;
  const limit =
    limitRaw !== undefined ? parseStrictNonNegativeIntegerArg(limitRaw, '--limit') : null;

  const offsetIdx = args.indexOf('--offset');
  const offsetRaw = offsetIdx !== -1 ? args[offsetIdx + 1] : undefined;
  const offset =
    offsetRaw !== undefined ? parseStrictNonNegativeIntegerArg(offsetRaw, '--offset') : 0;

  const chunkIdx = args.indexOf('--chunk-size');
  const chunkRaw = chunkIdx !== -1 ? args[chunkIdx + 1] : undefined;
  const chunkSize =
    chunkRaw !== undefined
      ? parseStrictNonNegativeIntegerArg(chunkRaw, '--chunk-size')
      : DEFAULT_CHUNK_SIZE;

  const downloadIdx = args.indexOf('--download-to');
  const downloadTo = downloadIdx !== -1 ? (args[downloadIdx + 1] ?? DEFAULT_DOWNLOAD_PATH) : DEFAULT_DOWNLOAD_PATH;

  return { dryRun, apply, limit, offset, chunkSize, downloadTo, reuseLocal };
}

export function validateConfig(config: ImportConfig): void {
  if (config.apply && config.limit === null) {
    throw new Error(
      'config_invalid: --apply requires --limit. Example: --apply --limit 1000',
    );
  }

  if (config.limit !== null && config.limit <= 0) {
    throw new Error('config_invalid: --limit must be a positive integer.');
  }

  if (config.chunkSize <= 0) {
    throw new Error('config_invalid: --chunk-size must be a positive integer.');
  }

  if (config.offset < 0) {
    throw new Error('config_invalid: --offset must be a non-negative integer.');
  }
}

// ── ZIP extraction (shared with dry-run) ──────────────────────────────────────

function readUint16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

type ZipLocalEntry = {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  dataOffset: number;
};

function findFirstLocalEntry(buf: Uint8Array): ZipLocalEntry | null {
  if (buf.length < 30) return null;
  const sig = readUint32LE(buf, 0);
  if (sig !== 0x04034b50) return null;

  const compressionMethod = readUint16LE(buf, 8);
  const compressedSize = readUint32LE(buf, 18);
  const fileNameLength = readUint16LE(buf, 26);
  const extraLength = readUint16LE(buf, 28);

  const decoder = new TextDecoder('latin1');
  const filename = decoder.decode(buf.slice(30, 30 + fileNameLength));
  const dataOffset = 30 + fileNameLength + extraLength;

  return { filename, compressionMethod, compressedSize, dataOffset };
}

export async function extractAllLinesFromZip(zipBytes: Uint8Array): Promise<{
  filename: string;
  lines: string[];
} | null> {
  const entry = findFirstLocalEntry(zipBytes);
  if (!entry) return null;

  const { filename, compressionMethod, compressedSize, dataOffset } = entry;
  const end = compressedSize > 0 ? dataOffset + compressedSize : zipBytes.length;
  const compressedData = zipBytes.slice(dataOffset, end);

  let textBytes: Buffer;
  if (compressionMethod === 0) {
    textBytes = Buffer.from(compressedData);
  } else if (compressionMethod === 8) {
    textBytes = await inflateRawAsync(compressedData);
  } else {
    return null;
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8').decode(textBytes);
    if (text.includes('�')) throw new Error('UTF-8 decode had replacement chars');
  } catch {
    text = new TextDecoder('latin1').decode(textBytes);
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return { filename, lines };
}

// ── Download / reuse ───────────────────────────────────────────────────────────

async function downloadZip(downloadTo: string): Promise<{
  zipBytes: Uint8Array;
  sourceLastModified: string | undefined;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000); // 5 min

  try {
    const response = await fetch(RD_DGII_RNC_TXT_ZIP_URL, {
      headers: {
        Referer: DGII_REFERER,
        'User-Agent': 'SellUp/1.0 legal-enrichment-snapshot-importer',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        zipBytes: new Uint8Array(0),
        sourceLastModified: undefined,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const sourceLastModified = response.headers.get('last-modified') ?? undefined;
    const arrayBuffer = await response.arrayBuffer();
    const zipBytes = new Uint8Array(arrayBuffer);

    // Persist to disk for --reuse-local
    const dir = dirname(downloadTo);
    mkdirSync(dir, { recursive: true });
    await writeFile(downloadTo, Buffer.from(zipBytes));
    console.log(`  ZIP guardado en: ${downloadTo}`);

    return { zipBytes, sourceLastModified };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { zipBytes: new Uint8Array(0), sourceLastModified: undefined, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadZip(config: ImportConfig): Promise<{
  zipBytes: Uint8Array;
  sourceLastModified: string | undefined;
  fromLocal: boolean;
  error?: string;
}> {
  if (config.reuseLocal && existsSync(config.downloadTo)) {
    console.log(`  Reutilizando ZIP local: ${config.downloadTo}`);
    const buf = await readFile(config.downloadTo);
    const zipBytes = new Uint8Array(buf);
    return { zipBytes, sourceLastModified: undefined, fromLocal: true };
  }

  console.log(`  Descargando ZIP desde DGII (~22 MB)...`);
  const result = await downloadZip(config.downloadTo);
  return { ...result, fromLocal: false };
}

// ── Source year ────────────────────────────────────────────────────────────────

export function parseSourceYear(lastModified: string | undefined): number {
  if (!lastModified) return new Date().getFullYear();
  const match = lastModified.match(/\b(20\d{2})\b/);
  if (match) return parseInt(match[1], 10);
  return new Date().getFullYear();
}

// ── Row builder ────────────────────────────────────────────────────────────────

type SnapshotRow = {
  source_key: string;
  country_code: string;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: null;
  department: null;
  region: null;
  priority_score: number;
  signals: object;
  financials: object;
  raw_data: object;
  imported_at: string;
};

export function buildSnapshotRow(opts: {
  rnc: string;
  legalName: string;
  tradeName: string | undefined;
  taxpayerStatus: string;
  normalizedStatus: string;
  isActive: boolean;
  economicActivity: string | undefined;
  registrationDate: string | undefined;
  localAdministration: string | undefined;
  paymentRegime: string | undefined;
  category: string | undefined;
  sourceYear: number;
  sourceLastModified: string | undefined;
  importedAt: string;
}): SnapshotRow {
  const {
    rnc,
    legalName,
    tradeName,
    taxpayerStatus,
    normalizedStatus,
    isActive,
    economicActivity,
    registrationDate,
    localAdministration,
    paymentRegime,
    category,
    sourceYear,
    sourceLastModified,
    importedAt,
  } = opts;

  const normalizedRnc = normalizeDominicanRnc(rnc) ?? rnc;

  return {
    source_key: RD_DGII_BULK_SOURCE_KEY,
    country_code: RD_DGII_BULK_COUNTRY_CODE,
    source_year: sourceYear,
    tax_id: normalizedRnc,
    normalized_tax_id: normalizedRnc,
    legal_name: legalName,
    normalized_legal_name: legalName.toUpperCase().trim(),
    sector: economicActivity ?? null,
    city: null,
    department: null,
    region: null,
    priority_score: 0,
    signals: {},
    financials: {},
    raw_data: {
      source_key: RD_DGII_BULK_SOURCE_KEY,
      country_code: RD_DGII_BULK_COUNTRY_CODE,
      tax_identifier_type: 'RNC',
      legal_name: legalName,
      trade_name: tradeName ?? null,
      taxpayer_status: taxpayerStatus,
      normalized_status: normalizedStatus,
      is_active_taxpayer: isActive,
      economic_activity_text: economicActivity ?? null,
      payment_regime: paymentRegime ?? null,
      category: category ?? null,
      registration_date: registrationDate ?? null,
      local_administration: localAdministration ?? null,
      source_last_modified: sourceLastModified ?? null,
      source_url: RD_DGII_RNC_TXT_ZIP_URL,
      official_ciiu_available: false,
      ciiu_status: 'unavailable_for_mvp',
      sector_source: 'dgii_activity_text_not_normalized',
      human_review_required: true,
      importer_version: IMPORTER_VERSION,
    },
    imported_at: importedAt,
  };
}

// ── Supabase client ────────────────────────────────────────────────────────────

export function getServiceRoleClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      'supabase_service_role_not_configured: Set SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }

  return createClient(url, key);
}

// ── Upsert chunk ───────────────────────────────────────────────────────────────

export async function upsertChunk(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: SnapshotRow[],
): Promise<{ upserted: number; error: string | null }> {
  const { error } = await supabase.from(SNAPSHOT_TABLE).upsert(rows as unknown[], {
    onConflict: 'source_key,country_code,source_year,normalized_tax_id',
    ignoreDuplicates: false,
  });

  if (error) {
    return { upserted: 0, error: error.message };
  }

  return { upserted: rows.length, error: null };
}

// ── Core importer ──────────────────────────────────────────────────────────────

export async function runImporter(
  config: ImportConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseFactory?: () => any,
): Promise<ImportReport> {
  const startMs = Date.now();
  const importedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log(`\n── Paso 1: HEAD del ZIP DGII ─────────────────────────────────────`);
  const headResult = await headDgiiRncZip();
  const headMeta = headResult.metadata;
  let sourceLastModified = headMeta.lastModified;

  if (headMeta.ok) {
    console.log(`  HTTP: ${headMeta.httpStatus} | Last-Modified: ${sourceLastModified ?? 'N/A'}`);
    console.log(`  Tamaño: ${headMeta.contentLengthBytes ? (headMeta.contentLengthBytes / (1024 * 1024)).toFixed(2) + ' MB' : 'N/A'}`);
  } else {
    warnings.push(`HEAD request failed (HTTP ${headMeta.httpStatus}). Proceeding with download.`);
    console.warn(`  ⚠ HEAD falló (${headMeta.httpStatus}). Se intentará descarga directa.`);
  }

  const sourceYear = parseSourceYear(sourceLastModified);
  console.log(`  source_year: ${sourceYear}`);

  console.log(`\n── Paso 2: Cargar ZIP ────────────────────────────────────────────`);
  const { zipBytes, sourceLastModified: lmFromLoad, fromLocal, error: downloadError } =
    await loadZip(config);

  if (downloadError) {
    errors.push(`download_error: ${downloadError}`);
    return buildReport(config, {
      sourceYear,
      linesRead: 0,
      linesInWindow: 0,
      businessRncRows: 0,
      outOfScopePersonRows: 0,
      invalidRows: 0,
      parseErrors: 0,
      rowsPrepared: 0,
      rowsUpserted: 0,
      chunksProcessed: 0,
      errors,
      warnings,
      startMs,
    });
  }

  if (fromLocal && lmFromLoad) sourceLastModified = lmFromLoad;
  console.log(`  ZIP bytes: ${zipBytes.length.toLocaleString()} (${(zipBytes.length / (1024 * 1024)).toFixed(2)} MB)`);

  console.log(`\n── Paso 3: Extraer TXT del ZIP ───────────────────────────────────`);
  const extracted = await extractAllLinesFromZip(zipBytes);

  if (!extracted) {
    errors.push('zip_extraction_failed: could not parse ZIP structure');
    return buildReport(config, {
      sourceYear,
      linesRead: 0,
      linesInWindow: 0,
      businessRncRows: 0,
      outOfScopePersonRows: 0,
      invalidRows: 0,
      parseErrors: 0,
      rowsPrepared: 0,
      rowsUpserted: 0,
      chunksProcessed: 0,
      errors,
      warnings,
      startMs,
    });
  }

  console.log(`  Archivo interno: ${extracted.filename}`);
  console.log(`  Líneas totales:  ${extracted.lines.length.toLocaleString()}`);

  const linesRead = extracted.lines.length;

  // Apply offset/limit to raw lines (consistent with SUNAT importer pattern)
  const windowStart = config.offset;
  const windowEnd = config.limit !== null ? windowStart + config.limit : linesRead;
  const windowLines = extracted.lines.slice(windowStart, windowEnd);
  const linesInWindow = windowLines.length;

  console.log(`  Ventana: offset=${windowStart}, limit=${config.limit ?? 'all'} → ${linesInWindow} líneas`);

  console.log(`\n── Paso 4: Parseo y clasificación ────────────────────────────────`);
  const parseResult = parseDgiiLines({
    lines: windowLines,
    maxRecords: linesInWindow,
  });

  const { normalizedCompanies, stats, mappingSource } = parseResult;

  console.log(`  Mapping columnas:           ${mappingSource}`);
  console.log(`  Líneas procesadas:          ${stats.totalLines.toLocaleString()}`);
  console.log(`  RNC jurídicos (9 dígitos):  ${stats.businessRnc9.toLocaleString()}`);
  console.log(`  Cédulas persona (11 díg.):  ${stats.cedula11.toLocaleString()} ← descartadas, no se persisten`);
  console.log(`  Inválidos/desconocidos:     ${stats.unknown.toLocaleString()}`);

  const businessRncRows = normalizedCompanies.length;
  const outOfScopePersonRows = stats.cedula11;
  const invalidRows = stats.unknown;
  const parseErrors = 0;

  console.log(`\n── Paso 5: Construcción de rows ──────────────────────────────────`);

  const rows: SnapshotRow[] = [];

  for (const company of normalizedCompanies) {
    const row = buildSnapshotRow({
      rnc: company.rnc,
      legalName: company.legalName,
      tradeName: company.tradeName,
      taxpayerStatus: company.rawStatus,
      normalizedStatus: company.taxpayerStatus,
      isActive: company.isActive,
      economicActivity: company.economicActivity,
      registrationDate: company.registrationDate,
      localAdministration: company.localAdministration,
      paymentRegime: undefined,
      category: undefined,
      sourceYear,
      sourceLastModified,
      importedAt,
    });
    rows.push(row);
  }

  const rowsPrepared = rows.length;
  console.log(`  Rows preparados: ${rowsPrepared}`);

  if (config.dryRun) {
    console.log(`\n── DRY-RUN: No se escriben datos ─────────────────────────────────`);
    console.log(`  rowsUpserted = 0 (dry-run)`);
    return buildReport(config, {
      sourceYear,
      linesRead,
      linesInWindow,
      businessRncRows,
      outOfScopePersonRows,
      invalidRows,
      parseErrors,
      rowsPrepared,
      rowsUpserted: 0,
      chunksProcessed: 0,
      errors,
      warnings,
      startMs,
    });
  }

  console.log(`\n── Paso 6: Persistencia en ${SNAPSHOT_TABLE} ────`);
  const supabase = supabaseFactory ? supabaseFactory() : getServiceRoleClient();

  let rowsUpserted = 0;
  let chunksProcessed = 0;

  for (let i = 0; i < rows.length; i += config.chunkSize) {
    const chunk = rows.slice(i, i + config.chunkSize);
    const chunkNum = Math.floor(i / config.chunkSize) + 1;
    const totalChunks = Math.ceil(rows.length / config.chunkSize);

    const { upserted, error: upsertErr } = await upsertChunk(supabase, chunk);

    if (upsertErr) {
      errors.push(`chunk_${chunkNum}_upsert_error: ${upsertErr}`);
      console.error(`  ✗ Chunk ${chunkNum}/${totalChunks}: error — ${upsertErr}`);
    } else {
      rowsUpserted += upserted;
      chunksProcessed++;
      process.stdout.write(`  ✓ Chunk ${chunkNum}/${totalChunks}: ${upserted} rows\r`);
    }
  }

  console.log(`\n  Total upserted: ${rowsUpserted.toLocaleString()}`);

  return buildReport(config, {
    sourceYear,
    linesRead,
    linesInWindow,
    businessRncRows,
    outOfScopePersonRows,
    invalidRows,
    parseErrors,
    rowsPrepared,
    rowsUpserted,
    chunksProcessed,
    errors,
    warnings,
    startMs,
  });
}

function buildReport(
  config: ImportConfig,
  data: {
    sourceYear: number;
    linesRead: number;
    linesInWindow: number;
    businessRncRows: number;
    outOfScopePersonRows: number;
    invalidRows: number;
    parseErrors: number;
    rowsPrepared: number;
    rowsUpserted: number;
    chunksProcessed: number;
    errors: string[];
    warnings: string[];
    startMs: number;
  },
): ImportReport {
  return {
    sourceKey: RD_DGII_BULK_SOURCE_KEY,
    countryCode: RD_DGII_BULK_COUNTRY_CODE,
    sourceYear: data.sourceYear,
    dryRun: config.dryRun,
    applied: !config.dryRun,
    linesRead: data.linesRead,
    linesInWindow: data.linesInWindow,
    businessRncRows: data.businessRncRows,
    outOfScopePersonRows: data.outOfScopePersonRows,
    invalidRows: data.invalidRows,
    parseErrors: data.parseErrors,
    rowsPrepared: data.rowsPrepared,
    rowsUpserted: data.rowsUpserted,
    chunksProcessed: data.chunksProcessed,
    errors: data.errors,
    warnings: data.warnings,
    durationMs: Date.now() - data.startMs,
  };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

function printReport(report: ImportReport) {
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  REPORTE FINAL — DGII República Dominicana Snapshot Importer');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  sourceKey:              ${report.sourceKey}`);
  console.log(`  countryCode:            ${report.countryCode}`);
  console.log(`  sourceYear:             ${report.sourceYear}`);
  console.log(`  dryRun:                 ${report.dryRun}`);
  console.log(`  applied:                ${report.applied}`);
  console.log(`  linesRead:              ${report.linesRead.toLocaleString()}`);
  console.log(`  linesInWindow:          ${report.linesInWindow.toLocaleString()}`);
  console.log(`  businessRncRows:        ${report.businessRncRows.toLocaleString()}`);
  console.log(`  outOfScopePersonRows:   ${report.outOfScopePersonRows.toLocaleString()} (cédulas 11 díg. — no persistidas)`);
  console.log(`  invalidRows:            ${report.invalidRows.toLocaleString()}`);
  console.log(`  parseErrors:            ${report.parseErrors.toLocaleString()}`);
  console.log(`  rowsPrepared:           ${report.rowsPrepared.toLocaleString()}`);
  console.log(`  rowsUpserted:           ${report.rowsUpserted.toLocaleString()}`);
  console.log(`  chunksProcessed:        ${report.chunksProcessed}`);
  console.log(`  durationMs:             ${report.durationMs}`);

  if (report.warnings.length > 0) {
    console.log(`\n  Warnings:`);
    for (const w of report.warnings) console.log(`    ⚠ ${w}`);
  }

  if (report.errors.length > 0) {
    console.log(`\n  Errors:`);
    for (const e of report.errors) console.log(`    ✗ ${e}`);
  }

  if (report.dryRun) {
    console.log('\n  ⚠  DRY-RUN: Nada fue escrito. Usar --apply para persistir.');
  } else {
    console.log(`\n  ✅ APPLY completado. ${report.rowsUpserted.toLocaleString()} RNC jurídicos persistidos.`);
    console.log(`     Cédulas descartadas: ${report.outOfScopePersonRows.toLocaleString()} (no guardadas)`);
  }

  // source_coverage_summaries: Opción B
  console.log('\n  source_coverage_summaries: pendiente Centroamérica.1A.3');
  console.log('    (tabla actual tiene columnas Perú-específicas habido/no-habido)');
  console.log('    (no se escribió fila RD para evitar abuso semántico)');

  console.log('══════════════════════════════════════════════════════════════════\n');
}

async function main() {
  // Node < 22 has no global WebSocket; install shim before Supabase client construction.
  ensureNode20WebSocketShim();

  console.log('=== DGII República Dominicana — Snapshot Importer ===');
  console.log(`Hito: Centroamérica.1A.2`);
  console.log(`Tabla destino: ${SNAPSHOT_TABLE}`);
  console.log(`source_key: ${RD_DGII_BULK_SOURCE_KEY}`);
  console.log('');

  let config: ImportConfig;

  try {
    config = parseCliArgs(process.argv);
    validateConfig(config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ ${msg}`);
    console.error('\nUso:');
    console.error('  npm run rd:dgii:import-snapshot -- [opciones]');
    console.error('\nOpciones:');
    console.error('  --apply                 Persistir datos (por defecto: dry-run)');
    console.error('  --limit <n>             Máximo de líneas del archivo a procesar (requerido con --apply)');
    console.error('  --offset <n>            Línea de inicio en el archivo (default: 0)');
    console.error('  --chunk-size <n>        Filas por batch de upsert (default: 500)');
    console.error('  --download-to <path>    Destino del ZIP (default: .tmp/dgii-rd/DGII_RNC.zip)');
    console.error('  --reuse-local           Reutilizar ZIP ya descargado');
    console.error('\nEjemplos:');
    console.error('  npm run rd:dgii:import-snapshot -- --limit 1000');
    console.error('  npm run rd:dgii:import-snapshot -- --limit 1000 --apply');
    process.exit(1);
  }

  console.log(`Modo: ${config.dryRun ? 'DRY-RUN (sin writes)' : 'APPLY'}`);
  if (config.limit !== null) console.log(`Límite: ${config.limit} líneas`);
  if (config.offset > 0) console.log(`Offset: ${config.offset}`);
  console.log('');

  const report = await runImporter(config);

  printReport(report);

  if (report.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ Unexpected error: ${msg}`);
  process.exit(1);
});
