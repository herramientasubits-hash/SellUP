/**
 * SUNAT Peru Bulk — ZIP Structure Probe
 *
 * Inspecciona la estructura del ZIP de SUNAT usando Range request al final del archivo.
 * NO descarga el ZIP completo. NO guarda bytes en disco. NO extrae contenido.
 * NO crea candidatos. NO escribe Supabase. NO activa PE.
 */

import { checkSunatBulkAvailability } from './sunat-bulk-client';
import {
  SUNAT_BULK_SOURCE_KEY,
  SUNAT_BULK_URL,
  SUNAT_BULK_PROBE_TIMEOUT_MS,
  SUNAT_BULK_MAX_SAMPLE_BYTES,
} from './types';
import type {
  SunatBulkHttpMetadata,
  SunatBulkDownloadGuard,
  SunatZipProbeInput,
  SunatZipProbeOutput,
  SunatZipCentralDirectoryEntry,
  SunatZipProbeStatus,
  SunatZipProbeWarning,
  SunatZipProbeStats,
} from './types';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const MAX_PROBE_BYTES = SUNAT_BULK_MAX_SAMPLE_BYTES;
const DEFAULT_TAIL_BYTES = 128 * 1024;
const MIN_TAIL_BYTES = 22;
const EOCD_FIXED_SIZE = 22;
const LARGE_ENTRY_THRESHOLD = 10 * 1024 * 1024;
const HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
};

function buildGuard(observedContentLengthBytes?: number): SunatBulkDownloadGuard {
  return {
    fullDownloadAllowed: false,
    reason:
      'Perú sigue SAFE_CONNECTOR_ONLY. ' +
      'ZIP structure probe solo inspecciona el final del archivo sin descargarlo completo.',
    maxAllowedBytesForDryRun: MAX_PROBE_BYTES,
    observedContentLengthBytes,
  };
}

function parseUint16LE(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 2).getUint16(0, true);
}

function parseUint32LE(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, true);
}

function findEocdInBuffer(
  buffer: Uint8Array,
): { bufferOffset: number } | null {
  const len = buffer.length;
  if (len < EOCD_FIXED_SIZE) return null;

  for (let i = len - EOCD_FIXED_SIZE; i >= 0; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      return { bufferOffset: i };
    }
  }
  return null;
}

function parseEocd(buffer: Uint8Array, eocdBufferOffset: number): {
  totalEntries: number;
  centralDirSize: number;
  centralDirOffset: number;
  commentLength: number;
} {
  const totalEntries = parseUint16LE(buffer, eocdBufferOffset + 10);
  const centralDirSize = parseUint32LE(buffer, eocdBufferOffset + 12);
  const centralDirOffset = parseUint32LE(buffer, eocdBufferOffset + 16);
  const commentLength = parseUint16LE(buffer, eocdBufferOffset + 20);
  return { totalEntries, centralDirSize, centralDirOffset, commentLength };
}

function parseCentralDirectoryEntries(
  buffer: Uint8Array,
  centralDirOffset: number,
  centralDirSize: number,
  tailStartAbsolute: number,
  contentLength: number,
): { entries: SunatZipCentralDirectoryEntry[]; allParsed: boolean } {
  const entries: SunatZipCentralDirectoryEntry[] = [];

  if (centralDirOffset < tailStartAbsolute) {
    return { entries, allParsed: false };
  }

  const cdStartInBuffer = centralDirOffset - tailStartAbsolute;
  const cdEndInBuffer = cdStartInBuffer + centralDirSize;
  const bufferLen = buffer.length;

  if (cdStartInBuffer >= bufferLen) {
    return { entries, allParsed: false };
  }

  const availableEnd = Math.min(cdEndInBuffer, bufferLen);
  const allParsed = cdEndInBuffer <= bufferLen;

  let offset = cdStartInBuffer;
  const end = availableEnd;

  while (offset + 46 <= end) {
    const sig = parseUint32LE(buffer, offset);
    if (sig !== CENTRAL_DIR_SIGNATURE) break;

    const fileNameLength = parseUint16LE(buffer, offset + 28);
    const extraFieldLength = parseUint16LE(buffer, offset + 30);
    const fileCommentLength = parseUint16LE(buffer, offset + 32);
    const totalEntrySize = 46 + fileNameLength + extraFieldLength + fileCommentLength;

    if (offset + totalEntrySize > end) break;

    const compressionMethod = parseUint16LE(buffer, offset + 10);
    const compressedSize = parseUint32LE(buffer, offset + 20);
    const uncompressedSize = parseUint32LE(buffer, offset + 24);

    const fileNameBytes = buffer.slice(offset + 46, offset + 46 + fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);

    entries.push({
      fileName,
      compressedSizeBytes: compressedSize,
      uncompressedSizeBytes: uncompressedSize,
      compressionMethod,
      likelyTextFile: fileName.endsWith('.txt'),
      likelyCsvFile: fileName.endsWith('.csv'),
      likelyLargeFile: (uncompressedSize ?? 0) > LARGE_ENTRY_THRESHOLD,
    });

    offset += totalEntrySize;
  }

  return { entries, allParsed };
}

/**
 * Inspecciona la estructura del ZIP de SUNAT usando Range request al final del archivo.
 *
 * Lee el final del ZIP (EOCD + Central Directory) para identificar archivos internos
 * sin descargar el ZIP completo.
 *
 * @param input - Opciones del probe (maxTailBytes opcional)
 * @returns SunatZipProbeOutput con estructura del ZIP
 */
export async function probeSunatZipStructure(
  input?: SunatZipProbeInput,
): Promise<SunatZipProbeOutput> {
  const warnings: SunatZipProbeWarning[] = [];
  const errors: string[] = [];

  const { metadata } = await checkSunatBulkAvailability();

  if (!metadata.contentLengthBytes) {
    warnings.push('no_content_length');
    return {
      sourceKey: SUNAT_BULK_SOURCE_KEY,
      mode: 'zip_structure_probe',
      status: 'blocked',
      metadata,
      probe: {
        attempted: false,
        method: 'range_tail',
        requestedBytes: 0,
        eocdFound: false,
        centralDirectoryParsed: false,
        entries: [],
      },
      stats: {
        entriesDetected: 0,
        eocdFound: false,
        centralDirectoryParsed: false,
      },
      guard: buildGuard(),
      warnings,
      errors,
    };
  }

  if (!metadata.supportsRangeRequests) {
    warnings.push('no_range_support');
    return {
      sourceKey: SUNAT_BULK_SOURCE_KEY,
      mode: 'zip_structure_probe',
      status: 'blocked',
      metadata,
      probe: {
        attempted: false,
        method: 'range_tail',
        requestedBytes: 0,
        eocdFound: false,
        centralDirectoryParsed: false,
        entries: [],
      },
      stats: {
        entriesDetected: 0,
        eocdFound: false,
        centralDirectoryParsed: false,
      },
      guard: buildGuard(metadata.contentLengthBytes),
      warnings,
      errors,
    };
  }

  const requestedBytes = Math.min(
    input?.maxTailBytes ?? DEFAULT_TAIL_BYTES,
    MAX_PROBE_BYTES,
  );

  if (requestedBytes < MIN_TAIL_BYTES) {
    warnings.push('range_exceeds_maximum');
  }

  const contentLength = metadata.contentLengthBytes;
  const tailStart = Math.max(0, contentLength - requestedBytes);
  const rangeEnd = contentLength - 1;
  const rangeHeader = `bytes=${tailStart}-${rangeEnd}`;

  fetchAttempt: try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUNAT_BULK_PROBE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(SUNAT_BULK_URL, {
        method: 'GET',
        headers: { ...HEADERS, Range: rangeHeader },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status !== 206) {
      await response.body?.cancel();
      warnings.push('fetch_error');
      return {
        sourceKey: SUNAT_BULK_SOURCE_KEY,
        mode: 'zip_structure_probe',
        status: 'error',
        metadata,
        probe: {
          attempted: true,
          method: 'range_tail',
          requestedBytes,
          eocdFound: false,
          centralDirectoryParsed: false,
          entries: [],
        },
        stats: {
          entriesDetected: 0,
          eocdFound: false,
          centralDirectoryParsed: false,
        },
        guard: buildGuard(contentLength),
        warnings,
        errors: [`Server returned ${response.status} instead of 206 Partial Content`],
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    if (buffer.length === 0) {
      warnings.push('empty_response');
      return {
        sourceKey: SUNAT_BULK_SOURCE_KEY,
        mode: 'zip_structure_probe',
        status: 'partial',
        metadata,
        probe: {
          attempted: true,
          method: 'range_tail',
          requestedBytes,
          eocdFound: false,
          centralDirectoryParsed: false,
          entries: [],
        },
        stats: {
          entriesDetected: 0,
          eocdFound: false,
          centralDirectoryParsed: false,
        },
        guard: buildGuard(contentLength),
        warnings,
        errors,
      };
    }

    const eocdResult = findEocdInBuffer(buffer);

    if (!eocdResult) {
      warnings.push('eocd_not_found');
      return {
        sourceKey: SUNAT_BULK_SOURCE_KEY,
        mode: 'zip_structure_probe',
        status: 'partial',
        metadata,
        probe: {
          attempted: true,
          method: 'range_tail',
          requestedBytes,
          eocdFound: false,
          centralDirectoryParsed: false,
          entries: [],
        },
        stats: {
          entriesDetected: 0,
          eocdFound: false,
          centralDirectoryParsed: false,
        },
        guard: buildGuard(contentLength),
        warnings,
        errors,
      };
    }

    const eocd = parseEocd(buffer, eocdResult.bufferOffset);
    const tailStartAbsolute = tailStart;

    const { entries, allParsed } = parseCentralDirectoryEntries(
      buffer,
      eocd.centralDirOffset,
      eocd.centralDirSize,
      tailStartAbsolute,
      contentLength,
    );

    if (!allParsed) {
      warnings.push('central_directory_truncated');
    }

    const totalCompressed = entries.reduce(
      (sum, e) => sum + (e.compressedSizeBytes ?? 0),
      0,
    );
    const totalUncompressed = entries.reduce(
      (sum, e) => sum + (e.uncompressedSizeBytes ?? 0),
      0,
    );

    const stats: SunatZipProbeStats = {
      entriesDetected: entries.length,
      totalCompressedSizeBytes: totalCompressed > 0 ? totalCompressed : undefined,
      totalUncompressedSizeBytes: totalUncompressed > 0 ? totalUncompressed : undefined,
      eocdFound: true,
      centralDirectoryParsed: allParsed,
    };

    let status: SunatZipProbeStatus;
    if (allParsed && entries.length > 0) {
      status = 'probed';
    } else if (entries.length > 0 && !allParsed) {
      status = 'partial';
    } else if (entries.length === 0 && allParsed) {
      status = 'partial';
    } else {
      status = 'partial';
    }

    return {
      sourceKey: SUNAT_BULK_SOURCE_KEY,
      mode: 'zip_structure_probe',
      status,
      metadata,
      probe: {
        attempted: true,
        method: 'range_tail',
        requestedBytes,
        eocdFound: true,
        centralDirectoryParsed: allParsed,
        entries,
      },
      stats,
      guard: buildGuard(contentLength),
      warnings,
      errors,
    };
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error
        ? `Error en probe: ${error.message.slice(0, 200)}`
        : 'Error desconocido en probe ZIP';
    errors.push(errorMsg);
    warnings.push('fetch_error');

    return {
      sourceKey: SUNAT_BULK_SOURCE_KEY,
      mode: 'zip_structure_probe',
      status: 'error',
      metadata,
      probe: {
        attempted: true,
        method: 'range_tail',
        requestedBytes,
        eocdFound: false,
        centralDirectoryParsed: false,
        entries: [],
      },
      stats: {
        entriesDetected: 0,
        eocdFound: false,
        centralDirectoryParsed: false,
      },
      guard: buildGuard(contentLength),
      warnings,
      errors,
    };
  }
}
