/**
 * SUNAT Peru — Local Deeper Scan
 *
 * local/offline/development-only
 * No ejecutar en Vercel ni production.
 *
 * Descarga el ZIP del Padrón Reducido RUC de SUNAT a .tmp/sunat-peru/,
 * hace stream parsing del TXT interno desde el ZIP local,
 * encuentra empresas RUC 20 y reporta estadísticas.
 *
 * No crea candidatos. No escribe Supabase. No activa Perú.
 */

import { open, readFile, mkdir } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { normalizeRuc, classifyRuc } from './normalizers';
import {
  SUNAT_BULK_SOURCE_KEY,
  SUNAT_BULK_URL,
} from './types';
import type {
  SunatLocalDeeperScanInput,
  SunatLocalDeeperScanOutput,
  SunatLocalDeeperScanStatus,
  SunatLocalDeeperScanSampleCompany,
  SunatLocalDeeperScanDistributionItem,
  SunatLocalDeeperScanRecommendation,
  SunatLocalDeeperScanStopReason,
} from './types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const ACK_ENV_VAR = 'SUNAT_PERU_LOCAL_SCAN_ACK';
const ACK_REQUIRED_VALUE = 'YES';
const DEFAULT_TEMP_DIR = '.tmp/sunat-peru';
const ZIP_FILE_NAME = 'padron_reducido_ruc.zip';
const TXT_ENTRY_NAME = 'padron_reducido_ruc.txt';
const MIN_FREE_GB = 5;
const EXPECTED_MIN_CONTENT_LENGTH = 300 * 1024 * 1024;

const DEFAULT_TARGET_COMPANY_COUNT = 100;
const DEFAULT_MAX_LINES_TO_SCAN = 3_000_000;
const DEFAULT_MAX_DECOMPRESSED_BYTES = 600 * 1024 * 1024;
const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;

const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65557;
const MAX_PREVIEW_LENGTH = 160;

const ACCEPTED_ZIP_TYPES = ['application/zip', 'application/octet-stream', 'application/x-zip-compressed'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findEocdInBuffer(buffer: Buffer, searchLen: number): number | undefined {
  for (let i = searchLen - 22; i >= 0; i--) {
    if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b &&
        buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) {
      const commentLen = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLen <= searchLen) {
        return i;
      }
    }
  }
  return undefined;
}


function truncateLine(line: string, max = MAX_PREVIEW_LENGTH): string {
  if (line.length <= max) return line;
  return line.slice(0, max) + '...';
}

function topDistributions(
  map: Map<string, number>,
  maxItems = 10,
): SunatLocalDeeperScanDistributionItem[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([value, count]) => ({ value, count }));
}

function detectCiiuColumns(columns: string[]): boolean {
  const keywords = ['CIIU', 'ACTIVIDAD ECONÓMICA', 'SECTOR', 'GIRO', 'RAMA', 'ACTIVITY'];
  for (const col of columns) {
    const upper = col.toUpperCase().trim();
    if (keywords.some(k => upper.includes(k))) return true;
  }
  return false;
}

// ─── Guard checks ─────────────────────────────────────────────────────────────

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

async function checkFreeSpace(dir: string, minGb: number): Promise<{ ok: boolean; freeGb: number; warning?: string }> {
  try {
    const result = execSync(`df -k "${dir}" 2>/dev/null | tail -1`, { encoding: 'utf-8', timeout: 5000 });
    const parts = result.trim().split(/\s+/);
    if (parts.length >= 4) {
      const freeKb = parseInt(parts[3], 10);
      if (!isNaN(freeKb)) {
        const freeGb = freeKb / (1024 * 1024);
        return { ok: freeGb >= minGb, freeGb: Math.round(freeGb * 10) / 10 };
      }
    }
    return { ok: true, freeGb: 0, warning: 'No se pudo determinar espacio libre exacto' };
  } catch {
    return { ok: true, freeGb: 0, warning: 'No se pudo verificar espacio libre' };
  }
}

// ─── ZIP local entry finder ───────────────────────────────────────────────────

async function findZipEntryLocal(
  filePath: string,
  targetFileName: string,
): Promise<{
  fileName: string;
  compressedSizeBytes?: number;
  uncompressedSizeBytes?: number;
  compressionMethod?: number;
  localHeaderOffset?: number;
  compressedDataStartOffset?: number;
  error?: string;
}> {
  const fd = await open(filePath, 'r');
  try {
    const stats = await fd.stat();
    const fileSize = stats.size;

    const eocdSearchSize = Math.min(MAX_EOCD_SEARCH, fileSize);
    const eocdBuffer = Buffer.alloc(eocdSearchSize);
    await fd.read(eocdBuffer, 0, eocdSearchSize, fileSize - eocdSearchSize);

    const eocdPosInBuffer = findEocdInBuffer(eocdBuffer, eocdSearchSize);
    if (eocdPosInBuffer === undefined) {
      return { fileName: '', error: 'EOCD not found in ZIP' };
    }

    const centralDirOffset = eocdBuffer.readUInt32LE(eocdPosInBuffer + 16);
    const numEntries = eocdBuffer.readUInt16LE(eocdPosInBuffer + 8);
    const centralDirSize = eocdBuffer.readUInt32LE(eocdPosInBuffer + 12);

    if (numEntries === 0 || centralDirOffset >= fileSize) {
      return { fileName: '', error: 'No entries in ZIP central directory' };
    }

    const readSize = Math.min(centralDirSize, fileSize - centralDirOffset);
    const centralDirBuffer = Buffer.alloc(readSize);
    await fd.read(centralDirBuffer, 0, readSize, centralDirOffset);

    let entryOffset = 0;
    for (let i = 0; i < numEntries; i++) {
      if (entryOffset + 46 > centralDirBuffer.length) break;

      const sig = centralDirBuffer.readUInt32LE(entryOffset);
      if (sig !== CENTRAL_DIR_SIGNATURE) break;

      const fileNameLen = centralDirBuffer.readUInt16LE(entryOffset + 28);
      const extraLen = centralDirBuffer.readUInt16LE(entryOffset + 30);
      const commentLen = centralDirBuffer.readUInt16LE(entryOffset + 32);

      if (entryOffset + 46 + fileNameLen > centralDirBuffer.length) break;

      const nameBytes = centralDirBuffer.subarray(entryOffset + 46, entryOffset + 46 + fileNameLen);
      const foundName = nameBytes.toString('utf-8');

      if (foundName === targetFileName || foundName.endsWith('/' + targetFileName)) {
        const compressedSize = centralDirBuffer.readUInt32LE(entryOffset + 20);
        const uncompressedSize = centralDirBuffer.readUInt32LE(entryOffset + 24);
        const compressionMethod = centralDirBuffer.readUInt16LE(entryOffset + 10);
        const localHeaderOffset = centralDirBuffer.readUInt32LE(entryOffset + 42);

        // Read local file header to compute compressed data start offset
        const localHeaderBuffer = Buffer.alloc(LOCAL_FILE_HEADER_SIZE);
        await fd.read(localHeaderBuffer, 0, LOCAL_FILE_HEADER_SIZE, localHeaderOffset);

        const localSig = localHeaderBuffer.readUInt32LE(0);
        if (localSig !== LOCAL_HEADER_SIGNATURE) {
          return { fileName: foundName, compressedSizeBytes: compressedSize, uncompressedSizeBytes: uncompressedSize, compressionMethod, localHeaderOffset,
            error: 'Invalid local file header signature' };
        }

        const localFileNameLen = localHeaderBuffer.readUInt16LE(26);
        const localExtraLen = localHeaderBuffer.readUInt16LE(28);
        const compressedDataStartOffset = localHeaderOffset + LOCAL_FILE_HEADER_SIZE + localFileNameLen + localExtraLen;

        return {
          fileName: foundName,
          compressedSizeBytes: compressedSize,
          uncompressedSizeBytes: uncompressedSize,
          compressionMethod,
          localHeaderOffset,
          compressedDataStartOffset,
        };
      }

      entryOffset += 46 + fileNameLen + extraLen + commentLen;
    }

    return { fileName: '', error: `Entry "${targetFileName}" not found in ZIP` };
  } finally {
    await fd.close();
  }
}

// ─── Compressed data reader ──────────────────────────────────────────────────

async function readCompressedData(
  filePath: string,
  offset: number,
  maxBytes: number,
): Promise<Buffer> {
  const fd = await open(filePath, 'r');
  try {
    const chunks: Buffer[] = [];
    let remaining = maxBytes;
    let pos = offset;

    while (remaining > 0) {
      const chunkSize = Math.min(65536, remaining);
      const chunk = Buffer.alloc(chunkSize);
      const { bytesRead } = await fd.read(chunk, 0, chunkSize, pos);
      if (bytesRead === 0) break;
      chunks.push(bytesRead < chunkSize ? chunk.subarray(0, bytesRead) : chunk);
      remaining -= bytesRead;
      pos += bytesRead;
    }

    return Buffer.concat(chunks);
  } finally {
    await fd.close();
  }
}

// ─── Inflate with max ────────────────────────────────────────────────────────

function inflateRawWithMax(
  compressed: Buffer,
  maxOutput: number,
): Promise<Buffer> {
  return new Promise((resolve) => {
    const inflater = createInflateRaw();
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    };

    inflater.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxOutput) {
        const available = maxOutput - (totalSize - chunk.length);
        if (available > 0) {
          chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, available));
        }
        finish();
        inflater.destroy();
        return;
      }
      chunks.push(chunk);
    });

    inflater.on('end', finish);
    inflater.on('close', finish);
    inflater.on('error', () => finish());

    inflater.end(compressed);
  });
}

// ─── Main scan function ──────────────────────────────────────────────────────

export async function runSunatLocalDeeperScan(
  input?: SunatLocalDeeperScanInput,
): Promise<SunatLocalDeeperScanOutput> {
  const startTime = Date.now();

  const tempDir = input?.tempDir || DEFAULT_TEMP_DIR;
  const targetCompanyCount = input?.targetCompanyCount ?? DEFAULT_TARGET_COMPANY_COUNT;
  const maxLinesToScan = input?.maxLinesToScan ?? DEFAULT_MAX_LINES_TO_SCAN;
  const maxDecompressedBytes = input?.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES;
  const maxDurationMs = input?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const downloadIfMissing = input?.downloadIfMissing ?? true;
  const requireAck = input?.requireAck ?? true;

  const warnings: string[] = [];
  const errors: string[] = [];
  let status: SunatLocalDeeperScanStatus = 'completed';

  // ── Environment guard ───────────────────────────────────────────────────────

  const vercelDetected = isVercelEnvironment();
  const productionDetected = isProductionEnvironment();
  const ackProvided = isAckProvided();
  const tmpDirIgnoredByGit = await isTempDirIgnoredByGit();

  if (vercelDetected) {
    return {
      sourceKey: SUNAT_BULK_SOURCE_KEY,
      mode: 'local_deeper_scan',
      status: 'blocked',
      environment: {
        localOnly: true, vercelDetected, productionDetected,
        ackProvided, tempDirIgnoredByGit: tmpDirIgnoredByGit,
      },
      download: { attempted: false, reusedExistingFile: false, completed: false },
      zipEntry: { fileName: '' },
      scan: {
        linesScanned: 0, decompressedBytesRead: 0, headerRowsSkipped: 0,
        naturalPersonsSkipped: 0, unsupportedRucSkipped: 0, invalidLines: 0,
        companiesFound: 0, stoppedBecause: 'error',
      },
      sampleCompanies: [],
      distributions: {},
      header: { detected: false, columns: [], columnCount: 0 },
      ciiuAvailability: 'CIIU/sector no disponible en esta fuente.',
      recommendation: 'blocked',
      warnings: ['Vercel detected — local/offline scan no disponible en Vercel'],
      errors: ['blocked_by_vercel'],
    };
  }

  if (productionDetected) {
    return {
      sourceKey: SUNAT_BULK_SOURCE_KEY,
      mode: 'local_deeper_scan',
      status: 'blocked',
      environment: {
        localOnly: true, vercelDetected, productionDetected,
        ackProvided, tempDirIgnoredByGit: tmpDirIgnoredByGit,
      },
      download: { attempted: false, reusedExistingFile: false, completed: false },
      zipEntry: { fileName: '' },
      scan: {
        linesScanned: 0, decompressedBytesRead: 0, headerRowsSkipped: 0,
        naturalPersonsSkipped: 0, unsupportedRucSkipped: 0, invalidLines: 0,
        companiesFound: 0, stoppedBecause: 'error',
      },
      sampleCompanies: [],
      distributions: {},
      header: { detected: false, columns: [], columnCount: 0 },
      ciiuAvailability: 'CIIU/sector no disponible en esta fuente.',
      recommendation: 'blocked',
      warnings: ['NODE_ENV=production detected — local/offline scan no disponible en production'],
      errors: ['blocked_by_production'],
    };
  }

  if (requireAck && !ackProvided) {
    return {
      sourceKey: SUNAT_BULK_SOURCE_KEY,
      mode: 'local_deeper_scan',
      status: 'blocked',
      environment: {
        localOnly: true, vercelDetected, productionDetected,
        ackProvided, tempDirIgnoredByGit: tmpDirIgnoredByGit,
      },
      download: { attempted: false, reusedExistingFile: false, completed: false },
      zipEntry: { fileName: '' },
      scan: {
        linesScanned: 0, decompressedBytesRead: 0, headerRowsSkipped: 0,
        naturalPersonsSkipped: 0, unsupportedRucSkipped: 0, invalidLines: 0,
        companiesFound: 0, stoppedBecause: 'error',
      },
      sampleCompanies: [],
      distributions: {},
      header: { detected: false, columns: [], columnCount: 0 },
      ciiuAvailability: 'CIIU/sector no disponible en esta fuente.',
      recommendation: 'blocked',
      warnings: [`${ACK_ENV_VAR}=YES requerida para ejecutar scan local`],
      errors: ['blocked_by_missing_ack'],
    };
  }

  if (!tmpDirIgnoredByGit) {
    warnings.push('.tmp/ no está en .gitignore — los archivos temporales podrían comittearse');
  }

  // Verify tempDir contains .tmp/
  if (!tempDir.includes('.tmp')) {
    warnings.push(`tempDir "${tempDir}" no contiene ".tmp/" — se recomienda usar .tmp/`);
  }

  // ── Download phase ──────────────────────────────────────────────────────────

  const zipPath = join(tempDir, ZIP_FILE_NAME);
  let downloadAttempted = false;
  let downloadReused = false;
  let downloadBytesWritten: number | undefined;
  let downloadContentLength: number | undefined;
  let downloadCompleted = false;

  const zipExists = existsSync(zipPath);

  if (zipExists && !downloadIfMissing) {
    downloadReused = true;
    downloadCompleted = true;
  } else if (!zipExists && !downloadIfMissing) {
    errors.push('ZIP no existe y downloadIfMissing es false');
    status = 'error';
    return buildBlockedOutput(
      status, tempDir, tmpDirIgnoredByGit,
      vercelDetected, productionDetected, ackProvided,
      warnings, errors,
    );
  } else {
    downloadAttempted = true;

    const diskCheck = await checkFreeSpace(tempDir, MIN_FREE_GB);
    if (!diskCheck.ok) {
      errors.push(`Espacio libre insuficiente: ~${diskCheck.freeGb} GB (requerido: ${MIN_FREE_GB} GB)`);
      status = 'error';
      return buildBlockedOutput(
        'error', tempDir, tmpDirIgnoredByGit,
        vercelDetected, productionDetected, ackProvided,
        warnings, errors,
      );
    }
    if (diskCheck.warning) warnings.push(diskCheck.warning);

    try {
      await mkdir(tempDir, { recursive: true });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);

      let response: Response;
      try {
        response = await fetch(SUNAT_BULK_URL, {
          signal: controller.signal,
          headers: { 'User-Agent': 'SellUp/0.1 data-source-audit' },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        errors.push(`SUNAT respondió ${response.status} — no se pudo descargar ZIP`);
        status = 'error';
        return buildBlockedOutput(
          'error', tempDir, tmpDirIgnoredByGit,
          vercelDetected, productionDetected, ackProvided,
          warnings, errors,
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      const isZip = ACCEPTED_ZIP_TYPES.some(t => contentType.includes(t));
      if (!isZip) {
        warnings.push(`Content-Type inesperado: "${contentType}" — se esperaba application/zip`);
      }

      const contentLengthStr = response.headers.get('content-length');
      if (contentLengthStr) {
        downloadContentLength = parseInt(contentLengthStr, 10);
        if (isNaN(downloadContentLength)) downloadContentLength = undefined;
        else if (downloadContentLength < EXPECTED_MIN_CONTENT_LENGTH) {
          warnings.push(`Content-Length (${downloadContentLength}) es menor a lo esperado (${EXPECTED_MIN_CONTENT_LENGTH})`);
        }
      }

      // Stream download to file
      const reader = response.body?.getReader();
      if (!reader) {
        errors.push('Response body stream no disponible');
        status = 'error';
        return buildBlockedOutput(
          'error', tempDir, tmpDirIgnoredByGit,
          vercelDetected, productionDetected, ackProvided,
          warnings, errors,
        );
      }

      const fileHandle = await open(zipPath, 'w');
      let totalWritten = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await fileHandle.write(value);
          totalWritten += value.length;
        }
      } finally {
        await fileHandle.close();
        reader.cancel();
      }

      downloadBytesWritten = totalWritten;
      downloadCompleted = true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message.slice(0, 300) : 'Download error desconocido';
      errors.push(`Error descargando ZIP: ${msg}`);
      status = 'error';
      return buildBlockedOutput(
        'error', tempDir, tmpDirIgnoredByGit,
        vercelDetected, productionDetected, ackProvided,
        warnings, errors,
      );
    }
  }

  // ── ZIP entry find ──────────────────────────────────────────────────────────

  let entry: Awaited<ReturnType<typeof findZipEntryLocal>>;
  try {
    entry = await findZipEntryLocal(zipPath, TXT_ENTRY_NAME);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message.slice(0, 300) : 'ZIP read error';
    errors.push(`Error leyendo ZIP: ${msg}`);
    return buildBlockedOutput(
      'error', tempDir, tmpDirIgnoredByGit,
      vercelDetected, productionDetected, ackProvided,
      warnings, errors,
    );
  }

  if (entry.error) {
    errors.push(`ZIP entry error: ${entry.error}`);
    return buildBlockedOutput(
      'error', tempDir, tmpDirIgnoredByGit,
      vercelDetected, productionDetected, ackProvided,
      warnings, errors,
      {
        fileName: entry.fileName,
        compressedSizeBytes: entry.compressedSizeBytes,
        uncompressedSizeBytes: entry.uncompressedSizeBytes,
        compressionMethod: entry.compressionMethod,
      },
    );
  }

  if (entry.compressionMethod !== undefined && entry.compressionMethod !== 8) {
    errors.push(`Compression method ${entry.compressionMethod} no es Deflate (8)`);
    return buildBlockedOutput(
      'error', tempDir, tmpDirIgnoredByGit,
      vercelDetected, productionDetected, ackProvided,
      warnings, errors,
      {
        fileName: entry.fileName,
        compressedSizeBytes: entry.compressedSizeBytes,
        uncompressedSizeBytes: entry.uncompressedSizeBytes,
        compressionMethod: entry.compressionMethod,
        compressedDataStartOffset: entry.compressedDataStartOffset,
      },
    );
  }

  if (entry.compressedDataStartOffset === undefined) {
    errors.push('No se pudo determinar offset de datos comprimidos');
    return buildBlockedOutput(
      'error', tempDir, tmpDirIgnoredByGit,
      vercelDetected, productionDetected, ackProvided,
      warnings, errors,
      {
        fileName: entry.fileName,
        compressedSizeBytes: entry.compressedSizeBytes,
        uncompressedSizeBytes: entry.uncompressedSizeBytes,
        compressionMethod: entry.compressionMethod,
      },
    );
  }

  const maxCompressedToRead = Math.min(
    entry.compressedSizeBytes ?? maxDecompressedBytes,
    maxDecompressedBytes,
  );

  // ── Read compressed data from ZIP ──────────────────────────────────────────

  let compressedData: Buffer;
  try {
    compressedData = await readCompressedData(
      zipPath,
      entry.compressedDataStartOffset,
      maxCompressedToRead,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message.slice(0, 300) : 'Read error';
    errors.push(`Error leyendo datos comprimidos del ZIP: ${msg}`);
    return buildBlockedOutput(
      'error', tempDir, tmpDirIgnoredByGit,
      vercelDetected, productionDetected, ackProvided,
      warnings, errors,
      {
        fileName: entry.fileName,
        compressedSizeBytes: entry.compressedSizeBytes,
        uncompressedSizeBytes: entry.uncompressedSizeBytes,
        compressionMethod: entry.compressionMethod,
        compressedDataStartOffset: entry.compressedDataStartOffset,
      },
    );
  }

  if (compressedData.length === 0) {
    errors.push('No se leyeron datos comprimidos del ZIP');
    return buildBlockedOutput(
      'error', tempDir, tmpDirIgnoredByGit,
      vercelDetected, productionDetected, ackProvided,
      warnings, errors,
      {
        fileName: entry.fileName,
        compressedSizeBytes: entry.compressedSizeBytes,
        uncompressedSizeBytes: entry.uncompressedSizeBytes,
        compressionMethod: entry.compressionMethod,
        compressedDataStartOffset: entry.compressedDataStartOffset,
      },
    );
  }

  // ── Inflate decompress ─────────────────────────────────────────────────────

  let decompressed: Buffer;
  try {
    decompressed = await inflateRawWithMax(compressedData, maxDecompressedBytes);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message.slice(0, 300) : 'Inflate error';
    errors.push(`Error de descompresión: ${msg}`);
    return buildBlockedOutput(
      'error', tempDir, tmpDirIgnoredByGit,
      vercelDetected, productionDetected, ackProvided,
      warnings, errors,
      {
        fileName: entry.fileName,
        compressedSizeBytes: entry.compressedSizeBytes,
        uncompressedSizeBytes: entry.uncompressedSizeBytes,
        compressionMethod: entry.compressionMethod,
        compressedDataStartOffset: entry.compressedDataStartOffset,
      },
    );
  }

  const decompressedBytesRead = decompressed.length;

  // ── Chunk-based line scanner ───────────────────────────────────────────────
  // Procesa el buffer descomprimido en chunks sin crear string gigante.
  // Esto evita el límite de V8 de ~536M chars en Buffer.toString().

  const NEWLINE = 0x0a;
  const CARRIAGE_RETURN = 0x0d;

  let headerRowsSkipped = 0;
  let naturalPersonsSkipped = 0;
  let unsupportedRucSkipped = 0;
  let invalidLines = 0;
  let companiesFound = 0;
  let firstCompanyLineNumber: number | undefined;
  let linesScanned = 0;
  let stoppedBecause: SunatLocalDeeperScanStopReason = 'end_of_file';

  const sampleCompanies: SunatLocalDeeperScanSampleCompany[] = [];
  const taxpayerStatusMap = new Map<string, number>();
  const domicileConditionMap = new Map<string, number>();
  const ubigeoMap = new Map<string, number>();
  const departmentMap = new Map<string, number>();

  let headerDetected = false;
  let headerColumns: string[] = [];
  let headerColumnCount = 0;

  let lineStart = 0;
  let lineIndex = 0;

  for (let i = 0; i <= decompressed.length; i++) {
    // Check limits
    if (Date.now() - startTime >= maxDurationMs) {
      stoppedBecause = 'max_duration_reached';
      break;
    }
    if (linesScanned >= maxLinesToScan) {
      stoppedBecause = 'max_lines_reached';
      break;
    }

    const isEnd = i === decompressed.length;
    const isNewline = !isEnd && decompressed[i] === NEWLINE;

    if (!isEnd && !isNewline) continue;

    // Extract line bytes, strip trailing \r
    let lineEnd = i;
    if (lineEnd > lineStart && decompressed[lineEnd - 1] === CARRIAGE_RETURN) {
      lineEnd--;
    }
    const lineBytes = decompressed.subarray(lineStart, lineEnd);
    lineStart = i + 1;
    lineIndex++;

    if (lineBytes.length === 0) continue;
    linesScanned++;

    // Convert to string only for this line
    const line = lineBytes.toString('utf-8');
    const lineNumber = lineIndex;

    const parts = line.split('|');

    // Detect header
    if (!headerDetected && parts.length > 0 && parts[0].trim().toUpperCase() === 'RUC') {
      headerDetected = true;
      headerColumns = parts.map(p => p.trim());
      headerColumnCount = parts.length;
      headerRowsSkipped++;
      continue;
    }

    if (parts.length < 1) {
      invalidLines++;
      continue;
    }

    const rawRuc = parts[0].trim();
    const cleanedRuc = normalizeRuc(rawRuc);

    if (!cleanedRuc || cleanedRuc.length < 8) {
      invalidLines++;
      continue;
    }

    const rucCategory = classifyRuc(cleanedRuc);

    if (rucCategory === 'natural_person') {
      naturalPersonsSkipped++;
      continue;
    }

    if (rucCategory !== 'company') {
      unsupportedRucSkipped++;
      continue;
    }

    // RUC 20 company found
    companiesFound++;
    if (firstCompanyLineNumber === undefined) {
      firstCompanyLineNumber = lineNumber;
    }

    const legalName = parts.length > 1 ? parts[1].trim() : '';
    const taxpayerStatus = parts.length > 2 ? parts[2].trim() : undefined;
    const domicileCondition = parts.length > 3 ? parts[3].trim() : undefined;
    const ubigeo = parts.length > 4 ? parts[4].trim() : undefined;
    const department = parts.length > 5 ? parts[5].trim() : undefined;

    // Track distributions
    if (taxpayerStatus) {
      taxpayerStatusMap.set(taxpayerStatus, (taxpayerStatusMap.get(taxpayerStatus) || 0) + 1);
    }
    if (domicileCondition) {
      domicileConditionMap.set(domicileCondition, (domicileConditionMap.get(domicileCondition) || 0) + 1);
    }
    if (ubigeo) {
      ubigeoMap.set(ubigeo, (ubigeoMap.get(ubigeo) || 0) + 1);
    }
    if (department) {
      departmentMap.set(department, (departmentMap.get(department) || 0) + 1);
    }

    // Collect sample companies (redacted)
    if (sampleCompanies.length < targetCompanyCount) {
      const isActiveTaxpayer = taxpayerStatus
        ? taxpayerStatus.toUpperCase().includes('ACTIVO') && !taxpayerStatus.toUpperCase().includes('NO ACTIVO')
        : undefined;

      sampleCompanies.push({
        taxIdentifier: cleanedRuc,
        legalName: truncateLine(legalName, 80),
        taxpayerStatus,
        domicileCondition,
        ubigeo,
        isActiveTaxpayer,
        redactedPreview: truncateLine(line),
      });
    }

    if (companiesFound >= targetCompanyCount) {
      stoppedBecause = 'target_company_count_reached';
      break;
    }

    // Check decompressed bytes limit
    if (decompressedBytesRead >= maxDecompressedBytes * 0.95) {
      stoppedBecause = 'max_decompressed_bytes_reached';
      break;
    }
  }

  // `stoppedBecause` is initialized to 'end_of_file';
  // it only changes when a break occurs inside the loop.

  const ciiuAvailable = headerDetected ? detectCiiuColumns(headerColumns) : false;

  const recommendation: SunatLocalDeeperScanRecommendation =
    companiesFound > 0
      ? 'ready_for_candidate_preview_design'
      : 'needs_full_local_snapshot_strategy';

  if (errors.length > 0) {
    status = 'error';
  } else if (companiesFound === 0) {
    status = 'completed_no_companies';
  } else {
    status = 'completed';
  }

  return {
    sourceKey: SUNAT_BULK_SOURCE_KEY,
    mode: 'local_deeper_scan',
    status,
    environment: {
      localOnly: true,
      vercelDetected,
      productionDetected,
      ackProvided,
      tempDirIgnoredByGit: tmpDirIgnoredByGit,
    },
    download: {
      attempted: downloadAttempted,
      reusedExistingFile: downloadReused,
      zipPath,
      contentLengthBytes: downloadContentLength,
      bytesWritten: downloadBytesWritten,
      completed: downloadCompleted,
    },
    zipEntry: {
      fileName: entry.fileName,
      compressedSizeBytes: entry.compressedSizeBytes,
      uncompressedSizeBytes: entry.uncompressedSizeBytes,
      compressionMethod: entry.compressionMethod,
      compressedDataStartOffset: entry.compressedDataStartOffset,
    },
    scan: {
      linesScanned,
      decompressedBytesRead,
      headerRowsSkipped,
      naturalPersonsSkipped,
      unsupportedRucSkipped,
      invalidLines,
      companiesFound,
      firstCompanyLineNumber,
      stoppedBecause,
    },
    sampleCompanies,
    distributions: {
      taxpayerStatusTop: taxpayerStatusMap.size > 0 ? topDistributions(taxpayerStatusMap) : undefined,
      domicileConditionTop: domicileConditionMap.size > 0 ? topDistributions(domicileConditionMap) : undefined,
      ubigeoTop: ubigeoMap.size > 0 ? topDistributions(ubigeoMap) : undefined,
      departmentTop: departmentMap.size > 0 ? topDistributions(departmentMap) : undefined,
    },
    header: {
      detected: headerDetected,
      columns: headerColumns,
      columnCount: headerColumnCount,
    },
    ciiuAvailability: ciiuAvailable
      ? 'CIIU/actividad económica detectada en el header del padrón.'
      : 'CIIU/sector no disponible en esta fuente.',
    recommendation,
    warnings,
    errors,
  };
}

function buildBlockedOutput(
  status: SunatLocalDeeperScanStatus,
  tempDir: string,
  tmpDirIgnoredByGit: boolean,
  vercelDetected: boolean,
  productionDetected: boolean,
  ackProvided: boolean,
  warnings: string[],
  errors: string[],
  zipEntryOverrides?: {
    fileName?: string;
    compressedSizeBytes?: number;
    uncompressedSizeBytes?: number;
    compressionMethod?: number;
    compressedDataStartOffset?: number;
  },
): SunatLocalDeeperScanOutput {
  return {
    sourceKey: SUNAT_BULK_SOURCE_KEY,
    mode: 'local_deeper_scan',
    status,
    environment: {
      localOnly: true,
      vercelDetected,
      productionDetected,
      ackProvided,
      tempDirIgnoredByGit: tmpDirIgnoredByGit,
    },
    download: {
      attempted: false,
      reusedExistingFile: false,
      completed: false,
    },
    zipEntry: {
      fileName: zipEntryOverrides?.fileName ?? '',
      compressedSizeBytes: zipEntryOverrides?.compressedSizeBytes,
      uncompressedSizeBytes: zipEntryOverrides?.uncompressedSizeBytes,
      compressionMethod: zipEntryOverrides?.compressionMethod,
      compressedDataStartOffset: zipEntryOverrides?.compressedDataStartOffset,
    },
    scan: {
      linesScanned: 0,
      decompressedBytesRead: 0,
      headerRowsSkipped: 0,
      naturalPersonsSkipped: 0,
      unsupportedRucSkipped: 0,
      invalidLines: 0,
      companiesFound: 0,
      stoppedBecause: 'error',
    },
    sampleCompanies: [],
    distributions: {},
    header: { detected: false, columns: [], columnCount: 0 },
    ciiuAvailability: 'CIIU/sector no disponible en esta fuente.',
    recommendation: status === 'error' ? 'error' : 'blocked',
    warnings,
    errors,
  };
}
