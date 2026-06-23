/**
 * SUNAT Peru Bulk — Controlled Sample TXT Extractor
 *
 * Extrae una muestra controlada del archivo interno del ZIP de SUNAT
 * usando Range requests parciales + inflate Raw streaming.
 *
 * NO descarga ZIP completo.
 * NO extrae TXT completo.
 * NO guarda archivos en disco.
 * NO crea candidatos.
 * NO escribe Supabase.
 * NO activa PE.
 */

import { createInflateRaw } from 'node:zlib';
import { probeSunatZipStructure } from './sunat-zip-probe';
import {
  SUNAT_BULK_SOURCE_KEY,
  SUNAT_BULK_URL,
  SUNAT_BULK_PROBE_TIMEOUT_MS,
} from './types';
import type { SunatZipCentralDirectoryEntry } from './types';
import type {
  SunatBulkSampleExtractionInput,
  SunatBulkSampleExtractionOutput,
  SunatBulkSampleLine,
  SunatBulkDelimiterInference,
} from './types';

const DEFAULT_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const ABSOLUTE_MAX_COMPRESSED_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_DECOMPRESSED_BYTES = 512 * 1024;
const ABSOLUTE_MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_LINES = 50;
const ABSOLUTE_MAX_LINES = 200;
const MAX_PREVIEW_LENGTH = 160;
const HEADERS = { 'User-Agent': 'SellUp/0.1 data-source-audit' };

function buildGuard(
  maxCompressedBytes: number,
  maxDecompressedBytes: number,
  maxLines: number,
) {
  return {
    fullDownloadAllowed: false as const,
    maxCompressedBytesToRead: maxCompressedBytes,
    maxDecompressedBytesToRead: maxDecompressedBytes,
    maxLinesToReturn: maxLines,
    reason:
      'Perú sigue SAFE_CONNECTOR_ONLY. ' +
      'Sample extraction controlada sin descarga completa.',
  };
}

function computeCompressedDataStartOffset(
  entry: SunatZipCentralDirectoryEntry,
): number | undefined {
  if (entry.localHeaderOffset === undefined) return undefined;
  const nameLen = entry.fileNameLength ?? Buffer.byteLength(entry.fileName, 'utf-8');
  const extraLen = entry.extraFieldLength ?? 0;
  return entry.localHeaderOffset + 30 + nameLen + extraLen;
}

function inflateRawWithMax(
  compressed: Uint8Array,
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
    inflater.on('error', () => finish());

    inflater.write(compressed);
    setImmediate(() => {
      finish();
      inflater.destroy();
    });
  });
}

function inferDelimiter(
  lines: string[],
): { delimiter: SunatBulkDelimiterInference; confidence: number } {
  if (lines.length === 0) return { delimiter: 'unknown', confidence: 0 };

  let pipeTotal = 0;
  let tabTotal = 0;
  let commaTotal = 0;
  let nonEmptyCount = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    nonEmptyCount++;
    pipeTotal += (line.match(/\|/g) || []).length;
    tabTotal += (line.match(/\t/g) || []).length;
    commaTotal += (line.match(/,/g) || []).length;
  }

  if (nonEmptyCount === 0) return { delimiter: 'unknown', confidence: 0 };

  const avgPipe = pipeTotal / nonEmptyCount;
  const avgTab = tabTotal / nonEmptyCount;
  const avgComma = commaTotal / nonEmptyCount;

  if (avgPipe > avgTab && avgPipe > avgComma && avgPipe >= 1) {
    return { delimiter: 'pipe', confidence: avgPipe >= 4 ? 1 : 0.5 };
  }
  if (avgTab > avgComma && avgTab >= 1) {
    return { delimiter: 'tab', confidence: avgTab >= 4 ? 1 : 0.5 };
  }
  if (avgComma >= 1) {
    return { delimiter: 'comma', confidence: avgComma >= 4 ? 1 : 0.5 };
  }

  return { delimiter: 'unknown', confidence: 0 };
}

function redactPreview(line: string): string {
  if (line.length <= MAX_PREVIEW_LENGTH) return line;
  return line.slice(0, MAX_PREVIEW_LENGTH - 3) + '...';
}

function buildEmptyOutput(
  status: 'blocked' | 'error',
  entry: SunatBulkSampleExtractionOutput['entry'],
  maxCompressedBytes: number,
  maxDecompressedBytes: number,
  maxLines: number,
  warnings: SunatBulkSampleExtractionOutput['warnings'],
  errors: string[],
): SunatBulkSampleExtractionOutput {
  return {
    sourceKey: SUNAT_BULK_SOURCE_KEY,
    mode: 'controlled_sample_extraction',
    status,
    entry,
    guard: buildGuard(maxCompressedBytes, maxDecompressedBytes, maxLines),
    sample: { lines: [] },
    stats: {
      compressedBytesRead: 0,
      decompressedBytesRead: 0,
      linesDetected: 0,
      linesReturned: 0,
      truncated: false,
    },
    warnings,
    errors,
  };
}

function countColumns(line: string): number | undefined {
  for (const delim of ['|', '\t', ','] as const) {
    if (line.includes(delim)) {
      return line.split(delim).length;
    }
  }
  return undefined;
}

/**
 * Extrae una muestra controlada del TXT interno del ZIP de SUNAT.
 *
 * Lee solo los primeros bytes comprimidos, descomprime en streaming
 * hasta los límites configurados, y devuelve líneas de muestra.
 *
 * @param input - Opciones de extracción (todas opcionales con defaults seguros)
 * @returns SunatBulkSampleExtractionOutput con muestra, stats y guardrails
 */
export async function extractSunatBulkSample(
  input?: SunatBulkSampleExtractionInput,
): Promise<SunatBulkSampleExtractionOutput> {
  const maxCompressedBytes = Math.min(
    input?.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED_BYTES,
    ABSOLUTE_MAX_COMPRESSED_BYTES,
  );
  const maxDecompressedBytes = Math.min(
    input?.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES,
    ABSOLUTE_MAX_DECOMPRESSED_BYTES,
  );
  const maxLines = Math.min(
    input?.maxLines ?? DEFAULT_MAX_LINES,
    ABSOLUTE_MAX_LINES,
  );

  const probeOutput = await probeSunatZipStructure({ maxTailBytes: 512 * 1024 });

  if (probeOutput.status === 'blocked' || probeOutput.status === 'error') {
    return buildEmptyOutput(
      'blocked',
      { fileName: '' },
      maxCompressedBytes,
      maxDecompressedBytes,
      maxLines,
      [{ code: 'probe_blocked', message: `ZIP probe returned status: ${probeOutput.status}` }],
      probeOutput.errors,
    );
  }

  const textEntry = probeOutput.probe.entries.find(e => e.likelyTextFile);
  if (!textEntry) {
    return buildEmptyOutput(
      'blocked',
      { fileName: '' },
      maxCompressedBytes,
      maxDecompressedBytes,
      maxLines,
      [{ code: 'no_text_entry', message: 'No text file entry found in ZIP' }],
      [],
    );
  }

  if (textEntry.compressionMethod !== 8) {
    return buildEmptyOutput(
      'blocked',
      {
        fileName: textEntry.fileName,
        compressedSizeBytes: textEntry.compressedSizeBytes,
        uncompressedSizeBytes: textEntry.uncompressedSizeBytes,
        compressionMethod: textEntry.compressionMethod,
      },
      maxCompressedBytes,
      maxDecompressedBytes,
      maxLines,
      [{
        code: 'unsupported_compression',
        message: `Compression method ${textEntry.compressionMethod} is not Deflate (8)`,
      }],
      [],
    );
  }

  const compressedDataStartOffset = computeCompressedDataStartOffset(textEntry);
  if (compressedDataStartOffset === undefined) {
    return buildEmptyOutput(
      'blocked',
      {
        fileName: textEntry.fileName,
        compressedSizeBytes: textEntry.compressedSizeBytes,
        uncompressedSizeBytes: textEntry.uncompressedSizeBytes,
        compressionMethod: textEntry.compressionMethod,
      },
      maxCompressedBytes,
      maxDecompressedBytes,
      maxLines,
      [{ code: 'no_local_header_offset', message: 'Cannot compute compressed data start offset' }],
      [],
    );
  }

  const contentLength = probeOutput.metadata.contentLengthBytes ?? 0;
  const compressedEnd = Math.min(
    compressedDataStartOffset + maxCompressedBytes - 1,
    compressedDataStartOffset + (textEntry.compressedSizeBytes ?? maxCompressedBytes) - 1,
    Math.max(0, contentLength - 1),
  );

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUNAT_BULK_PROBE_TIMEOUT_MS);
    try {
      response = await fetch(SUNAT_BULK_URL, {
        method: 'GET',
        headers: {
          ...HEADERS,
          Range: `bytes=${compressedDataStartOffset}-${compressedEnd}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message.slice(0, 200) : 'Unknown fetch error';
    return buildEmptyOutput(
      'error',
      {
        fileName: textEntry.fileName,
        compressedSizeBytes: textEntry.compressedSizeBytes,
        uncompressedSizeBytes: textEntry.uncompressedSizeBytes,
        compressionMethod: textEntry.compressionMethod,
        compressedDataStartOffset,
      },
      maxCompressedBytes,
      maxDecompressedBytes,
      maxLines,
      [],
      [errorMsg],
    );
  }

  if (response.status !== 206) {
    await response.body?.cancel();
    return buildEmptyOutput(
      'error',
      {
        fileName: textEntry.fileName,
        compressedSizeBytes: textEntry.compressedSizeBytes,
        uncompressedSizeBytes: textEntry.uncompressedSizeBytes,
        compressionMethod: textEntry.compressionMethod,
        compressedDataStartOffset,
      },
      maxCompressedBytes,
      maxDecompressedBytes,
      maxLines,
      [],
      [`Server returned ${response.status} instead of 206 Partial Content`],
    );
  }

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await response.arrayBuffer();
  } catch {
    return buildEmptyOutput(
      'error',
      {
        fileName: textEntry.fileName,
        compressedSizeBytes: textEntry.compressedSizeBytes,
        uncompressedSizeBytes: textEntry.uncompressedSizeBytes,
        compressionMethod: textEntry.compressionMethod,
        compressedDataStartOffset,
      },
      maxCompressedBytes,
      maxDecompressedBytes,
      maxLines,
      [],
      ['Failed to read response data'],
    );
  }

  const compressedBytes = new Uint8Array(arrayBuffer);
  const compressedBytesRead = compressedBytes.length;

  let decompressedBuffer: Buffer;
  try {
    decompressedBuffer = await inflateRawWithMax(compressedBytes, maxDecompressedBytes);
  } catch {
    return buildEmptyOutput(
      'error',
      {
        fileName: textEntry.fileName,
        compressedSizeBytes: textEntry.compressedSizeBytes,
        uncompressedSizeBytes: textEntry.uncompressedSizeBytes,
        compressionMethod: textEntry.compressionMethod,
        compressedDataStartOffset,
      },
      maxCompressedBytes,
      maxDecompressedBytes,
      maxLines,
      [{ code: 'inflate_error', message: 'Decompression failed' }],
      [],
    );
  }

  const decompressedBytesRead = decompressedBuffer.length;
  const truncated = decompressedBytesRead >= maxDecompressedBytes;

  const text = decompressedBuffer.toString('utf-8');
  const allLines = text.split('\n').map(l => l.replace(/\r$/, ''));
  const linesDetected = allLines.length;

  const lines: SunatBulkSampleLine[] = allLines
    .slice(0, maxLines)
    .map((line, i) => ({
      lineNumber: i + 1,
      columnCount: countColumns(line),
      redactedPreview: redactPreview(line),
    }));

  const sampleTexts = lines.map(l => l.redactedPreview);
  const delimiterInference = inferDelimiter(sampleTexts);

  const inferredColumnCount = lines
    .map(l => l.columnCount)
    .filter((c): c is number => c !== undefined)
    .reduce((max, c) => Math.max(max, c), 0) || undefined;

  const parserConfigSuggestion =
    delimiterInference.delimiter === 'pipe'
      ? 'createDefaultPipeConfig()'
      : delimiterInference.delimiter === 'tab'
        ? 'createTabConfig({ ruc:0, legalName:1 })'
        : delimiterInference.delimiter === 'comma'
          ? 'SunatBulkParserConfig with comma delimiter'
          : undefined;

  return {
    sourceKey: SUNAT_BULK_SOURCE_KEY,
    mode: 'controlled_sample_extraction',
    status: decompressedBytesRead === 0 ? 'partial' : 'sampled',
    entry: {
      fileName: textEntry.fileName,
      compressedSizeBytes: textEntry.compressedSizeBytes,
      uncompressedSizeBytes: textEntry.uncompressedSizeBytes,
      compressionMethod: textEntry.compressionMethod,
      compressedDataStartOffset,
    },
    guard: buildGuard(maxCompressedBytes, maxDecompressedBytes, maxLines),
    sample: {
      lines,
      inferredDelimiter:
        delimiterInference.delimiter === 'unknown'
          ? undefined
          : delimiterInference.delimiter,
      inferredColumnCount,
      parserConfigSuggestion,
    },
    stats: {
      compressedBytesRead,
      decompressedBytesRead,
      linesDetected,
      linesReturned: lines.length,
      truncated,
    },
    warnings: [],
    errors: [],
  };
}
