import { open, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';
import { existsSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WriteStream } from 'node:fs';
import { normalizeRuc, classifyRuc } from './normalizers';
import { SUNAT_BULK_SOURCE_KEY } from './types';
import type {
  SunatLocalRuc20SnapshotInput,
  SunatLocalRuc20SnapshotOutput,
  SunatLocalRuc20SnapshotStatus,
  SunatLocalRuc20SnapshotStopReason,
  SunatLocalRuc20SnapshotDistributionItem,
  SunatLocalRuc20SnapshotQualityVerdict,
  SunatLocalRuc20SnapshotSampleCompany,
} from './types';

const ACK_ENV_VAR = 'SUNAT_PERU_LOCAL_SCAN_ACK';
const ACK_REQUIRED_VALUE = 'YES';
const DEFAULT_TEMP_DIR = '.tmp/sunat-peru';
const ZIP_FILE_NAME = 'padron_reducido_ruc.zip';
const TXT_ENTRY_NAME = 'padron_reducido_ruc.txt';
const DEFAULT_SNAPSHOT_FILE = 'ruc20-filtered-snapshot.txt';
const DEFAULT_REPORT_FILE = 'ruc20-quality-report.json';
const MAX_PREVIEW_LENGTH = 160;
const SAMPLE_LIMIT = 20;

const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65557;

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

function findEocdInBuffer(buffer: Buffer, searchLen: number): number | undefined {
  for (let i = searchLen - 22; i >= 0; i--) {
    if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b &&
        buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) {
      const commentLen = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLen <= searchLen) return i;
    }
  }
  return undefined;
}

async function findZipEntry(
  filePath: string,
  targetFileName: string,
): Promise<{
  fileName: string;
  compressedSizeBytes?: number;
  uncompressedSizeBytes?: number;
  compressionMethod?: number;
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
    if (eocdPosInBuffer === undefined) return { fileName: '', error: 'EOCD not found in ZIP' };

    const centralDirOffset = eocdBuffer.readUInt32LE(eocdPosInBuffer + 16);
    const numEntries = eocdBuffer.readUInt16LE(eocdPosInBuffer + 8);
    const centralDirSize = eocdBuffer.readUInt32LE(eocdPosInBuffer + 12);

    if (numEntries === 0 || centralDirOffset >= fileSize) return { fileName: '', error: 'No entries in ZIP' };

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

        const localHeaderBuffer = Buffer.alloc(LOCAL_FILE_HEADER_SIZE);
        await fd.read(localHeaderBuffer, 0, LOCAL_FILE_HEADER_SIZE, localHeaderOffset);
        const localSig = localHeaderBuffer.readUInt32LE(0);
        if (localSig !== LOCAL_HEADER_SIGNATURE) {
          return { fileName: foundName, compressedSizeBytes: compressedSize, uncompressedSizeBytes: uncompressedSize, compressionMethod, error: 'Invalid local header' };
        }

        const localFileNameLen = localHeaderBuffer.readUInt16LE(26);
        const localExtraLen = localHeaderBuffer.readUInt16LE(28);
        const compressedDataStartOffset = localHeaderOffset + LOCAL_FILE_HEADER_SIZE + localFileNameLen + localExtraLen;

        return { fileName: foundName, compressedSizeBytes: compressedSize, uncompressedSizeBytes: uncompressedSize, compressionMethod, compressedDataStartOffset };
      }
      entryOffset += 46 + fileNameLen + extraLen + commentLen;
    }
    return { fileName: '', error: `Entry "${targetFileName}" not found in ZIP` };
  } finally {
    await fd.close();
  }
}

async function readAllCompressedData(filePath: string, offset: number, size: number): Promise<Buffer> {
  const fd = await open(filePath, 'r');
  try {
    const chunks: Buffer[] = [];
    let remaining = size;
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

function inflateRawFull(compressed: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const inflater = createInflateRaw();
    const chunks: Buffer[] = [];
    inflater.on('data', (chunk: Buffer) => chunks.push(chunk));
    inflater.on('end', () => resolve(Buffer.concat(chunks)));
    inflater.on('error', (err) => reject(err));
    inflater.end(compressed);
  });
}

function truncateLine(line: string, max = MAX_PREVIEW_LENGTH): string {
  if (line.length <= max) return line;
  return line.slice(0, max) + '...';
}

function topDistributions(map: Map<string, number>, maxItems = 10): SunatLocalRuc20SnapshotDistributionItem[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([value, count]) => ({ value, count }));
}

function writeLine(stream: WriteStream, line: string, bytesCounter: { count: number }): Promise<void> {
  const data = line + '\n';
  return new Promise((resolve, reject) => {
    const ok = stream.write(data, 'utf-8', (err) => {
      if (err) reject(err);
      else {
        bytesCounter.count += Buffer.byteLength(data, 'utf-8');
        resolve();
      }
    });
    if (!ok) {
      stream.once('drain', () => resolve());
    }
  });
}

export async function runSunatLocalRuc20Snapshot(
  input?: SunatLocalRuc20SnapshotInput,
): Promise<SunatLocalRuc20SnapshotOutput> {
  const startTime = Date.now();

  const tempDir = input?.tempDir || DEFAULT_TEMP_DIR;
  const zipPath = input?.zipPath || join(tempDir, ZIP_FILE_NAME);
  const outputPath = input?.outputPath || join(tempDir, DEFAULT_SNAPSHOT_FILE);
  const reportPath = input?.reportPath || join(tempDir, DEFAULT_REPORT_FILE);
  const requireAck = input?.requireAck ?? true;
  const maxLinesToScan = input?.maxLinesToScan ?? Number.MAX_SAFE_INTEGER;
  const maxDurationMs = input?.maxDurationMs ?? 30 * 60 * 1000;
  const overwrite = input?.overwrite ?? true;

  const warnings: string[] = [];
  const errors: string[] = [];
  let status: SunatLocalRuc20SnapshotStatus = 'completed';

  const vercelDetected = isVercelEnvironment();
  const productionDetected = isProductionEnvironment();
  const ackProvided = isAckProvided();
  const tmpDirIgnoredByGit = await isTempDirIgnoredByGit();

  if (vercelDetected) {
    return buildBlockedOutput({ status: 'blocked', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings: [...warnings, 'Vercel detected'], errors: ['blocked_by_vercel'] });
  }

  if (productionDetected) {
    return buildBlockedOutput({ status: 'blocked', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings: [...warnings, 'NODE_ENV=production detected'], errors: ['blocked_by_production'] });
  }

  if (requireAck && !ackProvided) {
    return buildBlockedOutput({ status: 'blocked', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings: [...warnings, `${ACK_ENV_VAR}=YES requerida`], errors: ['blocked_by_missing_ack'] });
  }

  if (!tmpDirIgnoredByGit) {
    warnings.push('.tmp/ no está en .gitignore');
  }

  const resolvedZipPath = resolve(zipPath);
  const resolvedTempDir = resolve(tempDir);

  if (!resolvedZipPath.startsWith(resolvedTempDir)) {
    errors.push(`zipPath "${zipPath}" no está dentro de tempDir "${tempDir}"`);
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  if (!existsSync(zipPath)) {
    errors.push(`ZIP no encontrado en "${zipPath}"`);
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  if (existsSync(outputPath) && !overwrite) {
    errors.push(`Snapshot ya existe en "${outputPath}" y overwrite=false`);
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  const zipFd = await open(zipPath, 'r');
  const zipStat = await zipFd.stat().catch(() => null);
  await zipFd.close();
  if (!zipStat) {
    errors.push('No se pudo leer tamaño del ZIP');
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  let entry: Awaited<ReturnType<typeof findZipEntry>>;
  try {
    entry = await findZipEntry(zipPath, TXT_ENTRY_NAME);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message.slice(0, 300) : 'ZIP read error';
    errors.push(`Error leyendo ZIP: ${msg}`);
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  if (entry.error) {
    errors.push(`ZIP entry error: ${entry.error}`);
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  if (entry.compressionMethod !== undefined && entry.compressionMethod !== 8) {
    errors.push(`Compression method ${entry.compressionMethod} no es Deflate (8)`);
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  if (entry.compressedDataStartOffset === undefined || entry.compressedSizeBytes === undefined) {
    errors.push('No se pudo determinar offset/size del entry comprimido');
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  let compressedData: Buffer;
  try {
    compressedData = await readAllCompressedData(zipPath, entry.compressedDataStartOffset, entry.compressedSizeBytes);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message.slice(0, 300) : 'Read error';
    errors.push(`Error leyendo datos comprimidos: ${msg}`);
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  let decompressed: Buffer;
  try {
    decompressed = await inflateRawFull(compressedData);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message.slice(0, 300) : 'Inflate error';
    errors.push(`Error de descompresión: ${msg}`);
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  const NEWLINE = 0x0a;
  const CARRIAGE_RETURN = 0x0d;

  let totalLinesScanned = 0;
  let headerRowsSkipped = 0;
  let ruc10Rows = 0;
  let ruc20Rows = 0;
  let unsupportedRucRows = 0;
  let invalidRows = 0;
  let activeRuc20Rows = 0;
  let activeHabidoRuc20Rows = 0;
  let inactiveRuc20Rows = 0;
  let firstRuc20LineNumber: number | undefined;
  let lastRuc20LineNumber: number | undefined;
  let stoppedBecause: SunatLocalRuc20SnapshotStopReason = 'end_of_file';
  let ruc20UbigeoCount = 0;

  const taxpayerStatusMap = new Map<string, number>();
  const domicileConditionMap = new Map<string, number>();
  const ubigeoMap = new Map<string, number>();
  const sampleActiveHabidoCompanies: SunatLocalRuc20SnapshotSampleCompany[] = [];

  let headerLine: string | null = null;
  let lineStart = 0;

  await mkdir(tempDir, { recursive: true });

  const bytesCounter = { count: 0 };
  const writeStream = createWriteStream(outputPath, 'utf-8');

  try {
    for (let i = 0; i <= decompressed.length; i++) {
      if (Date.now() - startTime >= maxDurationMs) {
        stoppedBecause = 'max_duration_reached';
        break;
      }
      if (totalLinesScanned >= maxLinesToScan) {
        stoppedBecause = 'max_lines_reached';
        break;
      }

      const isEnd = i === decompressed.length;
      const isNewline = !isEnd && decompressed[i] === NEWLINE;

      if (!isEnd && !isNewline) continue;

      let lineEnd = i;
      if (lineEnd > lineStart && decompressed[lineEnd - 1] === CARRIAGE_RETURN) {
        lineEnd--;
      }
      const lineBytes = decompressed.subarray(lineStart, lineEnd);
      lineStart = i + 1;

      if (lineBytes.length === 0) continue;

      const line = lineBytes.toString('utf-8');

      if (headerLine === null) {
        const trimmed = line.trim();
        if (trimmed.startsWith('RUC|') || trimmed === 'RUC') {
          headerLine = line;
          headerRowsSkipped++;
          await writeLine(writeStream, line, bytesCounter);
          continue;
        }
      }
      totalLinesScanned++;

      const parts = line.split('|');

      if (parts.length < 1) {
        invalidRows++;
        continue;
      }

      const rawRuc = parts[0].trim();
      const cleanedRuc = normalizeRuc(rawRuc);

      if (!cleanedRuc || cleanedRuc.length < 8) {
        invalidRows++;
        continue;
      }

      const rucCategory = classifyRuc(cleanedRuc);

      if (rucCategory === 'natural_person') {
        ruc10Rows++;
        continue;
      }

      if (rucCategory !== 'company') {
        unsupportedRucRows++;
        continue;
      }

      ruc20Rows++;
      if (firstRuc20LineNumber === undefined) firstRuc20LineNumber = totalLinesScanned + headerRowsSkipped;
      lastRuc20LineNumber = totalLinesScanned + headerRowsSkipped;

      const taxpayerStatus = parts.length > 2 ? parts[2].trim() : '';
      const domicileCondition = parts.length > 3 ? parts[3].trim() : '';
      const ubigeo = parts.length > 4 ? parts[4].trim() : '';

      if (taxpayerStatus) taxpayerStatusMap.set(taxpayerStatus, (taxpayerStatusMap.get(taxpayerStatus) || 0) + 1);
      if (domicileCondition) domicileConditionMap.set(domicileCondition, (domicileConditionMap.get(domicileCondition) || 0) + 1);
      if (ubigeo) {
        ubigeoMap.set(ubigeo, (ubigeoMap.get(ubigeo) || 0) + 1);
        ruc20UbigeoCount++;
      }

      const isActive = taxpayerStatus.toUpperCase().includes('ACTIVO') && !taxpayerStatus.toUpperCase().includes('NO ACTIVO');
      const isHabido = domicileCondition.toUpperCase() === 'HABIDO';

      if (isActive) activeRuc20Rows++;
      else inactiveRuc20Rows++;

      if (isActive && isHabido) {
        activeHabidoRuc20Rows++;
        if (sampleActiveHabidoCompanies.length < SAMPLE_LIMIT) {
          const legalName = parts.length > 1 ? parts[1].trim() : '';
          sampleActiveHabidoCompanies.push({
            taxIdentifier: cleanedRuc,
            legalName: truncateLine(legalName, 80),
            taxpayerStatus,
            domicileCondition,
            ubigeo: ubigeo || undefined,
            redactedPreview: truncateLine(line),
          });
        }
      }

      await writeLine(writeStream, line, bytesCounter);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message.slice(0, 300) : 'Write error';
    errors.push(`Error escribiendo snapshot: ${msg}`);
    status = 'error';
  } finally {
    await new Promise<void>((resolve) => writeStream.end(resolve));
  }

  if (status === 'error') {
    return buildBlockedOutput({ status: 'error', vercelDetected, productionDetected, ackProvided, tmpDirIgnoredByGit, warnings, errors });
  }

  const snapshotBytesWritten = bytesCounter.count;
  const hasEnoughRuc20ForCandidatePreview = ruc20Rows >= 100;
  const hasEnoughActiveHabido = activeHabidoRuc20Rows >= 50;
  const ubigeoCoverageRate = ruc20Rows > 0 ? ruc20UbigeoCount / ruc20Rows : 0;

  let qualityVerdict: SunatLocalRuc20SnapshotQualityVerdict;
  let qualityReason: string;

  if (hasEnoughRuc20ForCandidatePreview && hasEnoughActiveHabido) {
    qualityVerdict = 'usable_for_candidate_preview';
    qualityReason = `Se encontraron ${ruc20Rows} RUC 20 (${activeHabidoRuc20Rows} ACTIVO+HABIDO). CIIU/sector no disponible en Padrón Reducido RUC. Se necesita fuente adicional para sector.`;
  } else if (ruc20Rows < 100) {
    qualityVerdict = 'not_usable_for_discovery';
    qualityReason = `Solo ${ruc20Rows} RUC 20 encontrados (mínimo 100). El padrón reducido no es suficiente para discovery B2B.`;
  } else if (!hasEnoughActiveHabido) {
    qualityVerdict = 'weak_due_to_low_active_habido_density';
    qualityReason = `${ruc20Rows} RUC 20 pero solo ${activeHabidoRuc20Rows} ACTIVO+HABIDO (mínimo 50). Baja densidad de empresas activas.`;
  } else {
    qualityVerdict = 'weak_due_to_missing_sector_ciiu';
    qualityReason = `CIIU/sector no disponible en Padrón Reducido RUC. Sin actividad económica no se puede diseñar candidate preview completa.`;
  }

  const output: SunatLocalRuc20SnapshotOutput = {
    sourceKey: 'pe_sunat_bulk',
    mode: 'local_ruc20_filtered_snapshot',
    status,
    environment: { localOnly: true, vercelDetected, productionDetected, ackProvided, tempDirIgnoredByGit: tmpDirIgnoredByGit },
    input: { zipPath, zipBytes: compressedData.length, entryName: entry.fileName },
    output: { snapshotPath: outputPath, reportPath, snapshotBytesWritten, reportBytesWritten: 0 },
    scan: {
      totalLinesScanned, headerRowsSkipped, ruc10Rows, ruc20Rows, unsupportedRucRows, invalidRows,
      activeRuc20Rows, activeHabidoRuc20Rows, inactiveRuc20Rows, firstRuc20LineNumber, lastRuc20LineNumber, stoppedBecause,
    },
    distributions: {
      ruc20TaxpayerStatusTop: topDistributions(taxpayerStatusMap),
      ruc20DomicileConditionTop: topDistributions(domicileConditionMap),
      ruc20UbigeoTop: topDistributions(ubigeoMap),
    },
    quality: {
      hasEnoughRuc20ForCandidatePreview, hasEnoughActiveHabido,
      ubigeoCoverageRate: Math.round(ubigeoCoverageRate * 10000) / 10000,
      ciiuAvailable: false,
      verdict: qualityVerdict,
      reason: qualityReason,
    },
    sampleActiveHabidoCompanies,
    warnings,
    errors,
  };

  const reportBytesWritten = Buffer.byteLength(JSON.stringify(output, null, 2), 'utf-8');
  output.output.reportBytesWritten = reportBytesWritten;
  const reportFinalJson = JSON.stringify(output, null, 2);
  await writeFile(reportPath, reportFinalJson, 'utf-8');

  return output;
}

function buildBlockedOutput(params: {
  status: SunatLocalRuc20SnapshotStatus;
  vercelDetected: boolean;
  productionDetected: boolean;
  ackProvided: boolean;
  tmpDirIgnoredByGit: boolean;
  warnings: string[];
  errors: string[];
}): SunatLocalRuc20SnapshotOutput {
  return {
    sourceKey: 'pe_sunat_bulk',
    mode: 'local_ruc20_filtered_snapshot',
    status: params.status,
    environment: {
      localOnly: true,
      vercelDetected: params.vercelDetected,
      productionDetected: params.productionDetected,
      ackProvided: params.ackProvided,
      tempDirIgnoredByGit: params.tmpDirIgnoredByGit,
    },
    input: { zipPath: '', zipBytes: 0, entryName: '' },
    output: { snapshotPath: '', reportPath: '', snapshotBytesWritten: 0, reportBytesWritten: 0 },
    scan: {
      totalLinesScanned: 0, headerRowsSkipped: 0, ruc10Rows: 0, ruc20Rows: 0,
      unsupportedRucRows: 0, invalidRows: 0, activeRuc20Rows: 0, activeHabidoRuc20Rows: 0,
      inactiveRuc20Rows: 0, firstRuc20LineNumber: undefined, lastRuc20LineNumber: undefined,
      stoppedBecause: 'error',
    },
    distributions: { ruc20TaxpayerStatusTop: [], ruc20DomicileConditionTop: [], ruc20UbigeoTop: [] },
    quality: {
      hasEnoughRuc20ForCandidatePreview: false, hasEnoughActiveHabido: false,
      ubigeoCoverageRate: 0, ciiuAvailable: false,
      verdict: 'not_usable_for_discovery',
      reason: 'Snapshot blocked by environment guard.',
    },
    sampleActiveHabidoCompanies: [],
    warnings: params.warnings,
    errors: params.errors,
  };
}
