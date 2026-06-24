/**
 * PRODUCE Peru — MiPyme por Sector Productivo — Source Probe
 *
 * local/offline/development-only
 * No ejecutar en Vercel ni production.
 *
 * Descarga y perfila el "Directorio de Empresas MiPyme por Sector Productivo"
 * de PRODUCE / datosabiertos.gob.pe. Cruza RUCs contra snapshot RUC20 de SUNAT.
 *
 * No crea candidatos. No escribe Supabase. No activa Perú.
 * No registra en SOURCE_DISCOVERY_REGISTRY. No toca preflight ni wizard.
 */

import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import * as XLSX from 'xlsx';

import {
  PRODUCE_MIPYME_SOURCE_KEY,
  PRODUCE_MIPYME_DATASET_PAGE_URL,
  PRODUCE_MIPYME_CKAN_DATASET_ID,
  DATOSABIERTOS_CKAN_API_BASE,
} from './types';
import type {
  ProduceMipymeSourceProbeInput,
  ProduceMipymeSourceProbeOutput,
  ProduceMipymeProbeStatus,
  ProduceMipymeVerdict,
  ProduceMipymeSchemaProfile,
  ProduceMipymeCoverageProfile,
  ProduceMipymeSampleRow,
  ProduceMipymeEnvironment,
  ProduceMipymeDownload,
  ProduceMipymeSourceProfile,
} from './types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const ACK_ENV_VAR = 'SUNAT_PERU_LOCAL_SCAN_ACK';
const ACK_REQUIRED_VALUE = 'YES';
const DEFAULT_TEMP_DIR = '.tmp/sunat-peru';
const DEFAULT_LOCAL_PATH = '.tmp/sunat-peru/produce-mipyme-source';
const DEFAULT_REPORT_PATH = '.tmp/sunat-peru/produce-mipyme-profile-report.json';
const DEFAULT_MAX_ROWS = 100_000;
const DEFAULT_RUC20_SNAPSHOT = '.tmp/sunat-peru/ruc20-filtered-snapshot.txt';
const MAX_RUC20_SAMPLE_LINES = 50_000;
const SAMPLE_ROW_LIMIT = 10;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const CKAN_TIMEOUT_MS = 15_000;
const MAX_PREVIEW_LENGTH = 120;
const RUC20_READ_CHUNK = 1024 * 1024; // 1 MB chunks

const USER_AGENT = 'SellUp/0.1 data-source-audit';

const EXCEL_EXTENSIONS = ['.xlsx', '.xls'];
const CSV_EXTENSIONS = ['.csv'];
const ALL_EXTENSIONS = [...EXCEL_EXTENSIONS, ...CSV_EXTENSIONS];

// Column keyword lists for detection
const RUC_KEYWORDS = ['ruc', 'num_ruc', 'numero_ruc', 'nro_ruc', 'ruc_empresa', 'ruc_contribuyente'];
const CIIU_KEYWORDS = ['ciiu', 'cod_ciiu', 'codigo_ciiu', 'ciiu_rev', 'ciiu4', 'ciiu3', 'act_ciiu'];
const ACTIVITY_KEYWORDS = [
  'actividad', 'desc_ciiu', 'descripcion_ciiu', 'actividad_economica',
  'descripcion_actividad', 'actividad_princ', 'descripcion', 'actividad_principal',
  'nom_ciiu', 'nombre_ciiu', 'act_economica',
];
const SECTOR_KEYWORDS = [
  'sector', 'macrosector', 'rama', 'division', 'tipo_empresa',
  'sector_productivo', 'sector_economico', 'agrupamiento',
];

// ─── Guardrail helpers ─────────────────────────────────────────────────────────

function isVercelEnvironment(): boolean {
  return typeof process !== 'undefined' &&
    (process.env.VERCEL === '1' || process.env.VERCEL === 'true');
}

function isProductionEnvironment(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
}

function isAckProvided(): boolean {
  return typeof process !== 'undefined' && process.env[ACK_ENV_VAR] === ACK_REQUIRED_VALUE;
}

async function isTempDirIgnoredByGit(): Promise<boolean> {
  try {
    const content = await readFile('.gitignore', 'utf-8');
    return content.split('\n').some(l => l.trim() === '.tmp/');
  } catch {
    return false;
  }
}

function isSafeLocalPath(path: string, tempDir: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedTemp = resolve(tempDir);
  return resolvedPath.startsWith(resolvedTemp + '/') || resolvedPath === resolvedTemp;
}

// ─── CKAN URL resolution ────────────────────────────────────────────────────────

interface CkanResource {
  url: string;
  format: string;
  mimetype?: string;
  name?: string;
}

interface CkanResponse {
  success: boolean;
  result?: { resources?: CkanResource[] };
  error?: { message?: string };
}

function extractDatasetSlug(datasetPageUrl: string): string | null {
  try {
    const url = new URL(datasetPageUrl);
    const parts = url.pathname.split('/');
    const datasetIdx = parts.indexOf('dataset');
    if (datasetIdx >= 0 && parts[datasetIdx + 1]) {
      return parts[datasetIdx + 1];
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeSlugToAscii(slug: string): string {
  return slug
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

async function resolveCkanDownloadUrl(
  datasetId: string,
): Promise<{ url: string; format: string; contentType?: string } | null> {
  const idsToTry = [datasetId, normalizeSlugToAscii(datasetId)];
  const seen = new Set<string>();

  for (const id of idsToTry) {
    if (seen.has(id)) continue;
    seen.add(id);

    const apiUrl = `${DATOSABIERTOS_CKAN_API_BASE}?id=${encodeURIComponent(id)}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CKAN_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(apiUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) continue;

      const data = (await response.json()) as CkanResponse;
      if (!data.success || !data.result?.resources?.length) continue;

      const resources = data.result.resources;
      // Prefer Excel, then CSV
      const sorted = [...resources].sort((a, b) => {
        const rankA = EXCEL_EXTENSIONS.some(e => a.url.toLowerCase().endsWith(e)) ? 0 : 1;
        const rankB = EXCEL_EXTENSIONS.some(e => b.url.toLowerCase().endsWith(e)) ? 0 : 1;
        return rankA - rankB;
      });

      const resource = sorted[0];
      if (resource?.url) {
        return {
          url: resource.url,
          format: resource.format ?? 'unknown',
          contentType: resource.mimetype,
        };
      }
    } catch {
      // try next ID
    }
  }

  return null;
}

// ─── Column name normalization ─────────────────────────────────────────────────

function normalizeColumnName(col: string): string {
  return col
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function detectColumnCandidates(
  normalizedColumns: string[],
  keywords: string[],
): string[] {
  return normalizedColumns.filter(col => keywords.some(kw => col.includes(kw)));
}

function buildSchemaProfile(
  columns: string[],
  rows: string[][],
  sheetNames?: string[],
  detectedDelimiter?: string,
): ProduceMipymeSchemaProfile {
  const normalizedColumns = columns.map(normalizeColumnName);

  const rucCandidates = detectColumnCandidates(normalizedColumns, RUC_KEYWORDS);
  const ciiuCandidates = detectColumnCandidates(normalizedColumns, CIIU_KEYWORDS);
  const activityCandidates = detectColumnCandidates(normalizedColumns, ACTIVITY_KEYWORDS);
  const sectorCandidates = detectColumnCandidates(normalizedColumns, SECTOR_KEYWORDS);

  const rucIdx = rucCandidates.length > 0 ? normalizedColumns.indexOf(rucCandidates[0]) : -1;
  const ciiuIdx = ciiuCandidates.length > 0 ? normalizedColumns.indexOf(ciiuCandidates[0]) : -1;

  let produceRowsWithRuc = 0;
  let produceRowsWithCiiu = 0;

  for (const row of rows) {
    if (rucIdx >= 0 && row[rucIdx]?.trim()) produceRowsWithRuc++;
    if (ciiuIdx >= 0 && row[ciiuIdx]?.trim()) produceRowsWithCiiu++;
  }

  return {
    detectedDelimiter,
    sheetNames,
    columns,
    normalizedColumns,
    rowCountProfiled: rows.length,
    containsRuc: rucCandidates.length > 0,
    containsCiiu: ciiuCandidates.length > 0,
    containsActivityDescription: activityCandidates.length > 0,
    containsSector: sectorCandidates.length > 0,
    rucColumnCandidates: rucCandidates,
    ciiuColumnCandidates: ciiuCandidates,
    activityDescriptionColumnCandidates: activityCandidates,
    sectorColumnCandidates: sectorCandidates,
  };
}

// ─── File format detection ─────────────────────────────────────────────────────

function detectFormatFromUrl(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  if (lower.endsWith('.csv')) return 'csv';
  return null;
}

function detectFormatFromContentType(contentType: string): string | null {
  if (contentType.includes('spreadsheetml')) return 'xlsx';
  if (contentType.includes('ms-excel')) return 'xls';
  if (contentType.includes('text/csv')) return 'csv';
  return null;
}

function detectFormatFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // XLSX / ZIP magic bytes: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'xlsx';
  }
  // XLS / OLE2 magic bytes: D0 CF 11 E0
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return 'xls';
  }
  return null;
}

// ─── File parsing ──────────────────────────────────────────────────────────────

interface ParsedFileData {
  format: string;
  sheetNames?: string[];
  columns: string[];
  rows: string[][];
  detectedDelimiter?: string;
  error?: string;
}

function hasExcelMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  // ZIP header (XLSX): PK\x03\x04
  const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  // OLE2 header (XLS): D0 CF 11 E0
  const isXls = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  return isXlsx || isXls;
}

function parseExcelBuffer(buffer: Buffer, maxRows: number): ParsedFileData {
  if (!hasExcelMagicBytes(buffer)) {
    return {
      format: 'xlsx',
      columns: [],
      rows: [],
      error: `Archivo no reconocido como Excel: magic bytes inválidos (primeros bytes: ${buffer.slice(0, 4).toString('hex')})`,
    };
  }

  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', sheetStubs: false });
    const sheetNames = workbook.SheetNames;
    if (!sheetNames.length) {
      return { format: 'xlsx', sheetNames: [], columns: [], rows: [], error: 'No sheets found' };
    }

    const sheetName = sheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (!rawRows.length) {
      return { format: 'xlsx', sheetNames, columns: [], rows: [] };
    }

    const headerRow = (rawRows[0] as unknown[]).map(c => String(c ?? ''));
    const dataRows = rawRows
      .slice(1, maxRows + 1)
      .map(row => (row as unknown[]).map(c => String(c ?? '')));

    return { format: 'xlsx', sheetNames, columns: headerRow, rows: dataRows };
  } catch (err: unknown) {
    return {
      format: 'xlsx',
      columns: [],
      rows: [],
      error: err instanceof Error ? err.message.slice(0, 200) : 'Excel parse error',
    };
  }
}

function parseCsvContent(content: string, maxRows: number): ParsedFileData {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) {
    return { format: 'csv', columns: [], rows: [] };
  }

  // Detect delimiter: try comma, semicolon, pipe, tab
  const firstLine = lines[0];
  const candidates: [string, string][] = [',', ';', '|', '\t'].map(d => [d, d]);
  let bestDelimiter = ',';
  let bestCount = 0;
  for (const [d] of candidates) {
    const count = (firstLine.split(d).length - 1);
    if (count > bestCount) { bestCount = count; bestDelimiter = d; }
  }

  const columns = firstLine.split(bestDelimiter).map(c => c.replace(/^["']|["']$/g, '').trim());
  const dataRows = lines.slice(1, maxRows + 1).map(line =>
    line.split(bestDelimiter).map(c => c.replace(/^["']|["']$/g, '').trim()),
  );

  return { format: 'csv', columns, rows: dataRows, detectedDelimiter: bestDelimiter };
}

async function parseLocalFile(
  localPath: string,
  format: string,
  maxRows: number,
): Promise<ParsedFileData> {
  const buffer = await readFile(localPath);

  // Re-detect format if unknown
  let effectiveFormat = format;
  if (effectiveFormat === 'unknown' || !effectiveFormat) {
    effectiveFormat = detectFormatFromBuffer(buffer) ??
      detectFormatFromUrl(localPath) ?? 'csv';
  }

  if (effectiveFormat === 'xlsx' || effectiveFormat === 'xls') {
    return parseExcelBuffer(buffer, maxRows);
  }

  return parseCsvContent(buffer.toString('utf-8'), maxRows);
}

// ─── Sample row extraction ─────────────────────────────────────────────────────

function buildSampleRows(
  columns: string[],
  rows: string[][],
  normalizedColumns: string[],
  rucCandidates: string[],
  ciiuCandidates: string[],
  activityCandidates: string[],
  sectorCandidates: string[],
): ProduceMipymeSampleRow[] {
  const rucIdx = rucCandidates.length > 0 ? normalizedColumns.indexOf(rucCandidates[0]) : -1;
  const ciiuIdx = ciiuCandidates.length > 0 ? normalizedColumns.indexOf(ciiuCandidates[0]) : -1;
  const actIdx = activityCandidates.length > 0 ? normalizedColumns.indexOf(activityCandidates[0]) : -1;
  const secIdx = sectorCandidates.length > 0 ? normalizedColumns.indexOf(sectorCandidates[0]) : -1;

  return rows.slice(0, SAMPLE_ROW_LIMIT).map(row => {
    const redactedPreview = row
      .slice(0, 8)
      .map((v, i) => `${columns[i] ?? i}=${v.slice(0, 20)}`)
      .join(' | ')
      .slice(0, MAX_PREVIEW_LENGTH);

    return {
      ruc: rucIdx >= 0 ? row[rucIdx]?.trim() : undefined,
      ciiu: ciiuIdx >= 0 ? row[ciiuIdx]?.trim() : undefined,
      activityDescription: actIdx >= 0 ? row[actIdx]?.trim().slice(0, 80) : undefined,
      sector: secIdx >= 0 ? row[secIdx]?.trim() : undefined,
      redactedPreview,
    };
  });
}

// ─── RUC20 cross-reference ─────────────────────────────────────────────────────

async function loadRuc20Sample(snapshotPath: string): Promise<Set<string>> {
  const rucSet = new Set<string>();
  if (!existsSync(snapshotPath)) return rucSet;

  const fd = await open(snapshotPath, 'r');
  try {
    const chunk = Buffer.alloc(RUC20_READ_CHUNK);
    let position = 0;
    let remainder = '';
    let lineCount = 0;

    while (lineCount < MAX_RUC20_SAMPLE_LINES) {
      const { bytesRead } = await fd.read(chunk, 0, RUC20_READ_CHUNK, position);
      if (bytesRead === 0) break;

      const text = remainder + chunk.subarray(0, bytesRead).toString('utf-8');
      const lines = text.split('\n');
      remainder = lines.pop() ?? '';
      position += bytesRead;

      for (const line of lines) {
        if (lineCount >= MAX_RUC20_SAMPLE_LINES) break;
        const ruc = line.split('|')[0]?.trim();
        if (ruc && /^\d{11}$/.test(ruc)) {
          rucSet.add(ruc);
          lineCount++;
        }
      }
    }

    if (remainder && lineCount < MAX_RUC20_SAMPLE_LINES) {
      const ruc = remainder.split('|')[0]?.trim();
      if (ruc && /^\d{11}$/.test(ruc)) rucSet.add(ruc);
    }
  } finally {
    await fd.close();
  }

  return rucSet;
}

function buildCoverageProfile(
  rows: string[][],
  normalizedColumns: string[],
  rucCandidates: string[],
  ciiuCandidates: string[],
  ruc20Set: Set<string>,
): ProduceMipymeCoverageProfile {
  const rucIdx = rucCandidates.length > 0 ? normalizedColumns.indexOf(rucCandidates[0]) : -1;
  const ciiuIdx = ciiuCandidates.length > 0 ? normalizedColumns.indexOf(ciiuCandidates[0]) : -1;

  const produceRucs = new Set<string>();
  let produceRowsWithRuc = 0;
  let produceRowsWithCiiu = 0;

  for (const row of rows) {
    const ruc = rucIdx >= 0 ? row[rucIdx]?.trim().replace(/\D/g, '') : '';
    const ciiu = ciiuIdx >= 0 ? row[ciiuIdx]?.trim() : '';

    if (ruc && ruc.length >= 8) {
      produceRowsWithRuc++;
      produceRucs.add(ruc);
    }
    if (ciiu) produceRowsWithCiiu++;
  }

  let matchedRuc20SnapshotProfiled = 0;
  if (ruc20Set.size > 0) {
    for (const ruc of produceRucs) {
      if (ruc20Set.has(ruc)) matchedRuc20SnapshotProfiled++;
    }
  }

  const matchRate =
    produceRucs.size > 0 && ruc20Set.size > 0
      ? matchedRuc20SnapshotProfiled / produceRucs.size
      : undefined;

  return {
    produceRowsWithRuc,
    produceRowsWithCiiu,
    uniqueProduceRucsProfiled: produceRucs.size,
    matchedRuc20SnapshotProfiled,
    matchRateAgainstProfiledRuc20: matchRate,
  };
}

// ─── Verdict determination ─────────────────────────────────────────────────────

function determineVerdict(
  schema: ProduceMipymeSchemaProfile,
  coverage: ProduceMipymeCoverageProfile,
  downloadCompleted: boolean,
): { verdict: ProduceMipymeVerdict; recommendation: string } {
  if (!downloadCompleted) {
    return {
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation:
        'No se pudo descargar el archivo. Verificar manualmente la URL y el acceso al portal datosabiertos.gob.pe.',
    };
  }

  if (!schema.containsRuc) {
    return {
      verdict: 'REJECT',
      recommendation:
        'La fuente no contiene columna RUC identificable. No se puede usar para discovery ni enrichment por RUC.',
    };
  }

  if (!schema.containsCiiu && !schema.containsActivityDescription) {
    return {
      verdict: 'REJECT',
      recommendation:
        'La fuente no contiene columna CIIU ni descripción de actividad. No sirve para enriquecimiento sectorial.',
    };
  }

  const matchRate = coverage.matchRateAgainstProfiledRuc20 ?? 0;

  if (schema.containsRuc && (schema.containsCiiu || schema.containsActivityDescription)) {
    if (matchRate >= 0.3) {
      return {
        verdict: 'CONNECT_NOW',
        recommendation:
          `Fuente validada: contiene RUC + CIIU/actividad con ${Math.round(matchRate * 100)}% de match contra muestra RUC20. ` +
          'Conectar como fuente principal de CIIU para MVP Perú.',
      };
    }

    if (coverage.uniqueProduceRucsProfiled > 0) {
      return {
        verdict: 'SPIKE_LOCAL_FIRST',
        recommendation:
          'Fuente tiene RUC + CIIU pero la cobertura contra snapshot RUC20 es baja en muestra. ' +
          'Ejecutar spike completo con dataset total para confirmar cobertura real antes de conectar.',
      };
    }
  }

  if (schema.containsRuc && (schema.containsCiiu || schema.containsActivityDescription)) {
    return {
      verdict: 'SPIKE_LOCAL_FIRST',
      recommendation:
        'Fuente prometedora pero requiere análisis de mayor volumen para confirmar cobertura y calidad.',
    };
  }

  return {
    verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
    recommendation: 'Revisar manualmente el archivo descargado para determinar su utilidad.',
  };
}

// ─── Blocked output builder ────────────────────────────────────────────────────

function buildBlockedOutput(
  environment: ProduceMipymeEnvironment,
  sourceUrl: string,
  errors: string[],
  warnings: string[],
): ProduceMipymeSourceProbeOutput {
  const emptySchema: ProduceMipymeSchemaProfile = {
    columns: [],
    normalizedColumns: [],
    rowCountProfiled: 0,
    containsRuc: false,
    containsCiiu: false,
    containsActivityDescription: false,
    containsSector: false,
    rucColumnCandidates: [],
    ciiuColumnCandidates: [],
    activityDescriptionColumnCandidates: [],
    sectorColumnCandidates: [],
  };

  return {
    sourceKey: PRODUCE_MIPYME_SOURCE_KEY,
    mode: 'local_source_probe',
    status: 'blocked',
    source: {
      url: sourceUrl,
      owner: 'PRODUCE',
      accessMode: 'unknown',
      requiresCredentials: false,
    },
    environment,
    download: { attempted: false, completed: false, reusedExistingFile: false },
    schemaProfile: emptySchema,
    coverageProfile: {
      produceRowsWithRuc: 0,
      produceRowsWithCiiu: 0,
      uniqueProduceRucsProfiled: 0,
      matchedRuc20SnapshotProfiled: 0,
    },
    sampleRows: [],
    verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
    recommendation: 'Probe bloqueado por guardrails de seguridad operativa.',
    warnings,
    errors,
  };
}

// ─── Main probe ────────────────────────────────────────────────────────────────

/**
 * Spike local controlado de la fuente PRODUCE MiPyme por Sector Productivo.
 *
 * Requiere SUNAT_PERU_LOCAL_SCAN_ACK=YES para ejecutar.
 * Escribe únicamente en .tmp/sunat-peru/. No escribe Supabase.
 * No crea candidatos. No activa PE en preflight/registry/wizard.
 */
export async function runProduceMipymeSourceProbe(
  input?: ProduceMipymeSourceProbeInput,
): Promise<ProduceMipymeSourceProbeOutput> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const sourceUrl = input?.sourceUrl ?? PRODUCE_MIPYME_DATASET_PAGE_URL;
  const tempDir = input?.tempDir ?? DEFAULT_TEMP_DIR;
  const localPathBase = input?.localPath ?? DEFAULT_LOCAL_PATH;
  const reportPath = input?.reportPath ?? DEFAULT_REPORT_PATH;
  const downloadIfMissing = input?.downloadIfMissing ?? true;
  const requireAck = input?.requireAck ?? true;
  const maxRowsToProfile = input?.maxRowsToProfile ?? DEFAULT_MAX_ROWS;
  const ruc20SnapshotPath = input?.ruc20SnapshotPath ?? DEFAULT_RUC20_SNAPSHOT;

  // ── Guardrail: ACK ────────────────────────────────────────────────────────────

  const ackProvided = isAckProvided();
  const vercelDetected = isVercelEnvironment();
  const productionDetected = isProductionEnvironment();
  const tempDirIgnoredByGit = await isTempDirIgnoredByGit();

  const environment: ProduceMipymeEnvironment = {
    localOnly: true,
    vercelDetected,
    productionDetected,
    ackProvided,
    tempDirIgnoredByGit,
  };

  if (!tempDirIgnoredByGit) {
    warnings.push('.gitignore no incluye .tmp/ — el archivo descargado podría commitearse accidentalmente.');
  }

  if (requireAck && !ackProvided) {
    errors.push(`Requiere ${ACK_ENV_VAR}=YES para ejecutar. Este probe descarga y escribe en .tmp/`);
    return buildBlockedOutput(environment, sourceUrl, errors, warnings);
  }

  if (vercelDetected) {
    errors.push('Bloqueado: entorno vercel detectado. Este probe es solo local.');
    return buildBlockedOutput(environment, sourceUrl, errors, warnings);
  }

  if (productionDetected) {
    errors.push('Bloqueado: NODE_ENV=production. Este probe es solo local/development.');
    return buildBlockedOutput(environment, sourceUrl, errors, warnings);
  }

  // ── Guardrail: sourceUrl ──────────────────────────────────────────────────────

  if (!sourceUrl) {
    errors.push('BLOCKED_SOURCE_URL_MISSING: sourceUrl no proporcionado y no hay default configurado.');
    return buildBlockedOutput(environment, '', errors, warnings);
  }

  // ── Guardrail: localPath debe estar dentro de tempDir ─────────────────────────

  if (!isSafeLocalPath(localPathBase, tempDir) && !isSafeLocalPath(localPathBase, DEFAULT_TEMP_DIR)) {
    errors.push(`localPath '${localPathBase}' no está dentro de tempDir '${tempDir}'. Por seguridad, solo se permite escribir en .tmp/sunat-peru/.`);
    const emptySchema: ProduceMipymeSchemaProfile = {
      columns: [], normalizedColumns: [], rowCountProfiled: 0,
      containsRuc: false, containsCiiu: false, containsActivityDescription: false, containsSector: false,
      rucColumnCandidates: [], ciiuColumnCandidates: [], activityDescriptionColumnCandidates: [], sectorColumnCandidates: [],
    };
    return {
      sourceKey: PRODUCE_MIPYME_SOURCE_KEY,
      mode: 'local_source_probe',
      status: 'error',
      source: { url: sourceUrl, owner: 'PRODUCE', accessMode: 'unknown', requiresCredentials: false },
      environment,
      download: { attempted: false, completed: false, reusedExistingFile: false },
      schemaProfile: emptySchema,
      coverageProfile: { produceRowsWithRuc: 0, produceRowsWithCiiu: 0, uniqueProduceRucsProfiled: 0, matchedRuc20SnapshotProfiled: 0 },
      sampleRows: [],
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation: 'localPath inválido.',
      warnings,
      errors,
    };
  }

  // ── Find or download file ─────────────────────────────────────────────────────

  let resolvedLocalPath: string | undefined;
  let fileFormat = 'unknown';
  let downloadAttempted = false;
  let downloadCompleted = false;
  let bytesWritten: number | undefined;
  let reusedExistingFile = false;
  let downloadUrl = '';
  let contentType: string | undefined;
  let contentLengthBytes: number | undefined;

  // If localPathBase already ends with a known extension, check it directly first
  const knownExtDirect = ALL_EXTENSIONS.find(ext => localPathBase.endsWith(ext));
  if (knownExtDirect && existsSync(localPathBase)) {
    resolvedLocalPath = localPathBase;
    fileFormat = knownExtDirect.replace('.', '');
    reusedExistingFile = true;
    downloadCompleted = true;
  }

  // Otherwise check if a cached file exists by appending known extensions
  if (!resolvedLocalPath) {
    for (const ext of ALL_EXTENSIONS) {
      const candidate = localPathBase + ext;
      if (existsSync(candidate)) {
        resolvedLocalPath = candidate;
        fileFormat = ext.replace('.', '');
        reusedExistingFile = true;
        downloadCompleted = true;
        break;
      }
    }
  }

  // Also check without extension (if file was saved without one)
  if (!resolvedLocalPath && existsSync(localPathBase)) {
    resolvedLocalPath = localPathBase;
    reusedExistingFile = true;
    downloadCompleted = true;
  }

  if (!resolvedLocalPath && !downloadIfMissing) {
    warnings.push('Archivo PRODUCE no encontrado localmente y downloadIfMissing=false. Skipping download.');
  }

  if (!resolvedLocalPath && downloadIfMissing) {
    downloadAttempted = true;

    // Resolve actual download URL via CKAN API
    const slug = extractDatasetSlug(sourceUrl) ?? PRODUCE_MIPYME_CKAN_DATASET_ID;
    const resolved = await resolveCkanDownloadUrl(slug);

    if (!resolved) {
      errors.push(
        `BLOCKED_SOURCE_URL_MISSING: No se pudo resolver la URL de descarga desde CKAN API para dataset '${slug}'. ` +
        'Verificar que el dataset esté disponible en datosabiertos.gob.pe.',
      );
      return {
        sourceKey: PRODUCE_MIPYME_SOURCE_KEY,
        mode: 'local_source_probe',
        status: 'blocked',
        source: { url: sourceUrl, owner: 'PRODUCE', accessMode: 'unknown', requiresCredentials: false },
        environment,
        download: { attempted: true, completed: false, reusedExistingFile: false },
        schemaProfile: {
          columns: [], normalizedColumns: [], rowCountProfiled: 0,
          containsRuc: false, containsCiiu: false, containsActivityDescription: false, containsSector: false,
          rucColumnCandidates: [], ciiuColumnCandidates: [], activityDescriptionColumnCandidates: [], sectorColumnCandidates: [],
        },
        coverageProfile: { produceRowsWithRuc: 0, produceRowsWithCiiu: 0, uniqueProduceRucsProfiled: 0, matchedRuc20SnapshotProfiled: 0 },
        sampleRows: [],
        verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
        recommendation: 'No se pudo resolver la URL de descarga. Revisar disponibilidad de datosabiertos.gob.pe.',
        warnings,
        errors,
      };
    }

    downloadUrl = resolved.url;
    fileFormat = resolved.format.toLowerCase();
    contentType = resolved.contentType;

    // Determine file extension
    const fmtExt = detectFormatFromUrl(downloadUrl) ?? (fileFormat === 'csv' ? 'csv' : 'xlsx');
    const destPath = `${localPathBase}.${fmtExt}`;

    // Ensure tempDir exists
    await mkdir(tempDir, { recursive: true });

    // Download
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(downloadUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        errors.push(`Descarga fallida: HTTP ${response.status} desde ${downloadUrl}`);
      } else {
        contentType = response.headers.get('content-type') ?? contentType;
        const clHeader = response.headers.get('content-length');
        if (clHeader) contentLengthBytes = parseInt(clHeader, 10);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await writeFile(destPath, buffer);
        bytesWritten = buffer.length;
        resolvedLocalPath = destPath;
        downloadCompleted = true;

        // Refine format from actual content
        const detected = detectFormatFromBuffer(buffer) ?? detectFormatFromContentType(contentType ?? '');
        if (detected) fileFormat = detected;
      }
    } catch (err: unknown) {
      errors.push(`Error durante la descarga: ${err instanceof Error ? err.message.slice(0, 200) : 'Unknown error'}`);
    }
  }

  const downloadResult: ProduceMipymeDownload = {
    attempted: downloadAttempted,
    completed: downloadCompleted,
    localPath: resolvedLocalPath,
    bytesWritten,
    reusedExistingFile,
  };

  const sourceProfile: ProduceMipymeSourceProfile = {
    url: downloadUrl || sourceUrl,
    owner: 'PRODUCE',
    accessMode: 'public_download',
    requiresCredentials: false,
    fileFormat,
    contentType,
    contentLengthBytes,
  };

  // ── Parse file ────────────────────────────────────────────────────────────────

  const emptySchema: ProduceMipymeSchemaProfile = {
    columns: [], normalizedColumns: [], rowCountProfiled: 0,
    containsRuc: false, containsCiiu: false, containsActivityDescription: false, containsSector: false,
    rucColumnCandidates: [], ciiuColumnCandidates: [], activityDescriptionColumnCandidates: [], sectorColumnCandidates: [],
  };

  if (!resolvedLocalPath || !downloadCompleted) {
    const v = determineVerdict(emptySchema, { produceRowsWithRuc: 0, produceRowsWithCiiu: 0, uniqueProduceRucsProfiled: 0, matchedRuc20SnapshotProfiled: 0 }, false);

    return {
      sourceKey: PRODUCE_MIPYME_SOURCE_KEY,
      mode: 'local_source_probe',
      status: errors.length > 0 ? 'error' : 'blocked',
      source: sourceProfile,
      environment,
      download: downloadResult,
      schemaProfile: emptySchema,
      coverageProfile: { produceRowsWithRuc: 0, produceRowsWithCiiu: 0, uniqueProduceRucsProfiled: 0, matchedRuc20SnapshotProfiled: 0 },
      sampleRows: [],
      verdict: v.verdict,
      recommendation: v.recommendation,
      warnings,
      errors,
    };
  }

  let parsedData: ParsedFileData;
  try {
    parsedData = await parseLocalFile(resolvedLocalPath, fileFormat, maxRowsToProfile);
  } catch (err: unknown) {
    errors.push(`Error al parsear el archivo: ${err instanceof Error ? err.message.slice(0, 200) : 'Unknown error'}`);
    return {
      sourceKey: PRODUCE_MIPYME_SOURCE_KEY,
      mode: 'local_source_probe',
      status: 'error',
      source: sourceProfile,
      environment,
      download: downloadResult,
      schemaProfile: emptySchema,
      coverageProfile: { produceRowsWithRuc: 0, produceRowsWithCiiu: 0, uniqueProduceRucsProfiled: 0, matchedRuc20SnapshotProfiled: 0 },
      sampleRows: [],
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation: 'El archivo no pudo ser parseado. Verificar formato.',
      warnings,
      errors,
    };
  }

  if (parsedData.error) {
    errors.push(`Error en parsing: ${parsedData.error}`);
    return {
      sourceKey: PRODUCE_MIPYME_SOURCE_KEY,
      mode: 'local_source_probe',
      status: 'error',
      source: sourceProfile,
      environment,
      download: downloadResult,
      schemaProfile: emptySchema,
      coverageProfile: { produceRowsWithRuc: 0, produceRowsWithCiiu: 0, uniqueProduceRucsProfiled: 0, matchedRuc20SnapshotProfiled: 0 },
      sampleRows: [],
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation: 'El archivo no pudo ser parseado. Verificar formato.',
      warnings,
      errors,
    };
  }

  // ── Build schema profile ──────────────────────────────────────────────────────

  const schemaProfile = buildSchemaProfile(
    parsedData.columns,
    parsedData.rows,
    parsedData.sheetNames,
    parsedData.detectedDelimiter,
  );

  // ── Load RUC20 snapshot for cross-reference ────────────────────────────────────

  let ruc20Set = new Set<string>();
  try {
    ruc20Set = await loadRuc20Sample(ruc20SnapshotPath);
  } catch {
    warnings.push(`No se pudo cargar el snapshot RUC20 desde '${ruc20SnapshotPath}'. Cross-reference omitido.`);
  }

  if (ruc20Set.size === 0 && existsSync(ruc20SnapshotPath)) {
    warnings.push('Snapshot RUC20 existe pero no se encontraron RUCs válidos. Cross-reference parcial.');
  }

  // ── Build coverage profile ─────────────────────────────────────────────────────

  const coverageProfile = buildCoverageProfile(
    parsedData.rows,
    schemaProfile.normalizedColumns,
    schemaProfile.rucColumnCandidates,
    schemaProfile.ciiuColumnCandidates,
    ruc20Set,
  );

  // ── Build sample rows ──────────────────────────────────────────────────────────

  const sampleRows = buildSampleRows(
    parsedData.columns,
    parsedData.rows,
    schemaProfile.normalizedColumns,
    schemaProfile.rucColumnCandidates,
    schemaProfile.ciiuColumnCandidates,
    schemaProfile.activityDescriptionColumnCandidates,
    schemaProfile.sectorColumnCandidates,
  );

  // ── Determine verdict ──────────────────────────────────────────────────────────

  const { verdict, recommendation } = determineVerdict(schemaProfile, coverageProfile, downloadCompleted);

  // ── Assemble output ────────────────────────────────────────────────────────────

  const output: ProduceMipymeSourceProbeOutput = {
    sourceKey: PRODUCE_MIPYME_SOURCE_KEY,
    mode: 'local_source_probe',
    status: errors.length > 0 ? 'error' : 'completed',
    source: sourceProfile,
    environment,
    download: downloadResult,
    schemaProfile,
    coverageProfile,
    sampleRows,
    verdict,
    recommendation,
    warnings,
    errors,
  };

  // ── Write report ───────────────────────────────────────────────────────────────

  try {
    await writeFile(reportPath, JSON.stringify(output, null, 2), 'utf-8');
  } catch {
    warnings.push(`No se pudo guardar el reporte en '${reportPath}'.`);
  }

  return output;
}
