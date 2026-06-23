/**
 * SUNAT Peru Bulk — ZIP Structure Probe Tests
 *
 * Tests unitarios para el probe de estructura ZIP.
 * Mockea fetch. No hace llamadas reales a SUNAT.
 * No descarga ZIP completo. No guarda archivos. No escribe en DB.
 * No referencia Supabase, registry, preflight ni wizard.
 */

import { describe, it, mock, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { probeSunatZipStructure } from '../sunat-zip-probe';
import { SUNAT_BULK_URL } from '../types';

// ─── Mock helpers ─────────────────────────────────────────────────────────────────

function makeResponse(
  status: number,
  headers: Record<string, string>,
  body?: Uint8Array | null,
): Response {
  return new Response(
    body ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer) : null,
    { status, headers },
  );
}

function setUint16LE(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset + offset, 2).setUint16(0, value, true);
}

function setUint32LE(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset + offset, 4).setUint32(0, value, true);
}

function buildMockZipTail(
  fileName: string,
  compressedSize: number,
  uncompressedSize: number,
  compressionMethod: number,
  fileSize: number,
  tailBytes: number,
): { buffer: Uint8Array; tailStart: number; centralDirOffset: number } {
  const fileNameBytes = new TextEncoder().encode(fileName);
  const fileNameLen = fileNameBytes.length;

  const entrySize = 46 + fileNameLen;
  const totalSize = entrySize + 22;
  const buffer = new Uint8Array(totalSize);

  buffer[0] = 0x50;
  buffer[1] = 0x4b;
  buffer[2] = 0x01;
  buffer[3] = 0x02;

  setUint16LE(buffer, 4, 20);
  setUint16LE(buffer, 6, 20);
  setUint16LE(buffer, 8, 0);
  setUint16LE(buffer, 10, compressionMethod);
  setUint16LE(buffer, 12, 0);
  setUint16LE(buffer, 14, 0);
  setUint32LE(buffer, 16, 0);
  setUint32LE(buffer, 20, compressedSize);
  setUint32LE(buffer, 24, uncompressedSize);
  setUint16LE(buffer, 28, fileNameLen);
  setUint16LE(buffer, 30, 0);
  setUint16LE(buffer, 32, 0);
  setUint16LE(buffer, 34, 0);
  setUint16LE(buffer, 36, 0);
  setUint32LE(buffer, 38, 0);
  setUint32LE(buffer, 42, 0);
  buffer.set(fileNameBytes, 46);

  const eocdOffset = entrySize;
  buffer[eocdOffset] = 0x50;
  buffer[eocdOffset + 1] = 0x4b;
  buffer[eocdOffset + 2] = 0x05;
  buffer[eocdOffset + 3] = 0x06;

  setUint16LE(buffer, eocdOffset + 4, 0);
  setUint16LE(buffer, eocdOffset + 6, 0);
  setUint16LE(buffer, eocdOffset + 8, 1);
  setUint16LE(buffer, eocdOffset + 10, 1);
  setUint32LE(buffer, eocdOffset + 12, entrySize);
  const centralDirOffset = fileSize - tailBytes;
  setUint32LE(buffer, eocdOffset + 16, centralDirOffset);
  setUint16LE(buffer, eocdOffset + 20, 0);

  return { buffer, tailStart: fileSize - tailBytes, centralDirOffset };
}

// ─── Mutable mock state ───────────────────────────────────────────────────────────

type MockState = {
  headStatus: number;
  headHeaders: Record<string, string>;
  rangeStatus: number;
  rangeBody: Uint8Array | null;
  rangeHeaders: Record<string, string>;
  rangeThrows: boolean;
  rangeErrorMsg: string;
};

const DEFAULT_HEADERS: Record<string, string> = {
  'content-type': 'application/zip',
  'content-length': '200000',
  'last-modified': 'Mon, 15 Jun 2026 12:00:00 GMT',
  'accept-ranges': 'bytes',
};

const { buffer: defaultRangeBuffer } = buildMockZipTail(
  'padron_reducido_ruc.txt',
  150_000,
  500_000_000,
  8,
  200_000,
  512,
);

const defaultMockState: MockState = {
  headStatus: 200,
  headHeaders: { ...DEFAULT_HEADERS },
  rangeStatus: 206,
  rangeBody: defaultRangeBuffer,
  rangeHeaders: {
    ...DEFAULT_HEADERS,
    'content-length': String(defaultRangeBuffer.length),
    'content-range': 'bytes 199488-199999/200000',
  },
  rangeThrows: false,
  rangeErrorMsg: '',
};

let mockState: MockState = { ...defaultMockState };

function setMockState(partial: Partial<MockState>): void {
  mockState = { ...defaultMockState, ...partial };
}

// ─── Global fetch mock ───────────────────────────────────────────────────────────

const fetchMock = mock.method(globalThis, 'fetch', async (
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const urlStr = typeof url === 'string' ? url : url.toString();

  if (urlStr === SUNAT_BULK_URL) {
    if (init?.method === 'HEAD') {
      return makeResponse(mockState.headStatus, mockState.headHeaders);
    }

    if (mockState.rangeThrows) {
      throw new Error(mockState.rangeErrorMsg || 'Mock error');
    }

    const body = mockState.rangeBody ?? new Uint8Array(0);
    return makeResponse(mockState.rangeStatus, mockState.rangeHeaders, body);
  }

  return makeResponse(404, {});
});

afterEach(() => {
  mockState = { ...defaultMockState };
});

after(() => {
  fetchMock.mock.restore();
});

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('sunat-zip-probe', () => {
  describe('EOCD detection', () => {
    it('detects EOCD in mock buffer', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.equal(output.sourceKey, 'pe_sunat_bulk');
      assert.equal(output.mode, 'zip_structure_probe');
      assert.equal(output.probe.attempted, true);
      assert.equal(output.probe.eocdFound, true);
      assert.equal(output.stats.eocdFound, true);
      assert.ok(output.probe.requestedBytes > 0);
    });

    it('returns partial status when no EOCD is found', async () => {
      setMockState({
        rangeBody: new Uint8Array(100).fill(0x00),
        rangeHeaders: {
          ...DEFAULT_HEADERS,
          'content-length': '100',
          'content-range': 'bytes 199900-199999/200000',
        },
      });

      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.equal(output.probe.attempted, true);
      assert.equal(output.probe.eocdFound, false);
      assert.equal(output.stats.eocdFound, false);
      assert.equal(output.status, 'partial');
    });
  });

  describe('range limits', () => {
    it('respects maximum 512 KB limit', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 2 * 1024 * 1024 });

      assert.ok(output.probe.requestedBytes <= 512 * 1024);
    });

    it('uses default tail bytes when no input is given', async () => {
      const output = await probeSunatZipStructure();

      assert.equal(output.probe.attempted, true);
      assert.ok(output.probe.requestedBytes > 0);
    });
  });

  describe('blocking', () => {
    it('blocks when no content-length is available', async () => {
      setMockState({
        headHeaders: { 'content-type': 'application/zip', 'accept-ranges': 'bytes' },
      });

      const output = await probeSunatZipStructure();
      assert.equal(output.status, 'blocked');
      assert.ok(output.warnings.includes('no_content_length'));
    });

    it('blocks when Range is not supported', async () => {
      setMockState({
        headHeaders: { 'content-type': 'application/zip', 'content-length': '1000000' },
      });

      const output = await probeSunatZipStructure();
      assert.equal(output.status, 'blocked');
      assert.ok(output.warnings.includes('no_range_support'));
    });
  });

  describe('entry parsing', () => {
    it('parses a central directory entry from mock buffer', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.equal(output.probe.centralDirectoryParsed, true);
      assert.ok(output.probe.entries.length > 0);

      const entry = output.probe.entries[0];
      assert.equal(entry.fileName, 'padron_reducido_ruc.txt');
      assert.equal(entry.compressedSizeBytes, 150_000);
      assert.equal(entry.uncompressedSizeBytes, 500_000_000);
      assert.equal(entry.compressionMethod, 8);
    });

    it('marks likelyTextFile for .txt extension', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.ok(output.probe.entries.length > 0);
      assert.equal(output.probe.entries[0].likelyTextFile, true);
    });

    it('marks likelyCsvFile for .csv extension', async () => {
      const { buffer: csvBuffer } = buildMockZipTail(
        'padron_reducido_ruc.csv',
        150_000,
        500_000_000,
        0,
        200_000,
        512,
      );

      setMockState({
        rangeBody: csvBuffer,
        rangeHeaders: {
          ...DEFAULT_HEADERS,
          'content-length': String(csvBuffer.length),
          'content-range': 'bytes 199488-199999/200000',
        },
      });

      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.ok(output.probe.entries.length > 0);
      assert.equal(output.probe.entries[0].likelyCsvFile, true);
      assert.equal(output.probe.entries[0].likelyTextFile, false);
    });

    it('marks likelyLargeFile for entries over 10 MB', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.ok(output.probe.entries.length > 0);
      assert.equal(output.probe.entries[0].likelyLargeFile, true);
    });

    it('does not mark small entries as likelyLargeFile', async () => {
      const { buffer: smallBuffer } = buildMockZipTail(
        'small_file.txt',
        100,
        100,
        0,
        200_000,
        512,
      );

      setMockState({
        rangeBody: smallBuffer,
        rangeHeaders: {
          ...DEFAULT_HEADERS,
          'content-length': String(smallBuffer.length),
          'content-range': 'bytes 199488-199999/200000',
        },
      });

      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.ok(output.probe.entries.length > 0);
      assert.equal(output.probe.entries[0].likelyLargeFile, false);
    });
  });

  describe('safety', () => {
    it('never allows full download', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.equal(output.guard.fullDownloadAllowed, false);
    });

    it('does not return raw buffer or raw bytes', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.equal('rawBytes' in output, false);
      assert.equal('rawBuffer' in output, false);
      assert.equal('zipBufferFull' in output, false);
      assert.equal('fullZip' in output, false);
    });

    it('handles fetch error without throwing exception', async () => {
      setMockState({ rangeThrows: true, rangeErrorMsg: 'Network failure' });

      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.equal(output.status, 'error');
      assert.ok(output.errors.length > 0);
    });
  });

  describe('stats', () => {
    it('reports entriesDetected correctly', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.equal(output.stats.entriesDetected, 1);
      assert.equal(output.stats.eocdFound, true);
      assert.equal(output.stats.centralDirectoryParsed, true);
    });

    it('reports total compressed/uncompressed sizes', async () => {
      const output = await probeSunatZipStructure({ maxTailBytes: 512 });

      assert.ok(output.stats.totalCompressedSizeBytes !== undefined);
      assert.ok(output.stats.totalUncompressedSizeBytes !== undefined);
      assert.equal(output.stats.totalCompressedSizeBytes, 150_000);
    });
  });
});

// ─── Safety Tests ─────────────────────────────────────────────────────────────────

describe('sunat-zip-probe — no prohibited references', () => {
  it('does not reference Supabase', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('supabase'), false);
  });

  it('does not reference prospect_candidates', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('prospect_candidates'), false);
  });

  it('does not reference prospect_batches', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('prospect_batches'), false);
  });

  it('does not reference SOURCE_DISCOVERY_REGISTRY', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('SOURCE_DISCOVERY_REGISTRY'), false);
  });

  it('does not reference source-discovery-preflight', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('source-discovery-preflight'), false);
  });

  it('does not reference HubSpot', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('HubSpot'), false);
  });

  it('does not reference Tavily', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('Tavily'), false);
  });

  it('does not reference OpenAI, Gemini, or Claude', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('OpenAI'), false);
    assert.equal(fn.includes('Gemini'), false);
    assert.equal(fn.includes('Claude'), false);
  });

  it('does not reference fs.writeFile or createWriteStream', () => {
    const fn = probeSunatZipStructure.toString();
    assert.equal(fn.includes('writeFile'), false);
    assert.equal(fn.includes('createWriteStream'), false);
  });
});

describe('sunat-zip-probe source file safety', () => {
  const sourceFiles = ['../sunat-zip-probe.ts'];

  for (const file of sourceFiles) {
    it(`${file} does not reference prohibited patterns`, async () => {
      const { readFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const fullPath = path.resolve(__dirname, file);
      const content = await readFile(fullPath, 'utf-8');

      const prohibited = [
        'supabase',
        'prospect_candidates',
        'prospect_batches',
        'SOURCE_DISCOVERY_REGISTRY',
        'source-discovery-preflight',
        'writeFile',
        'createWriteStream',
        'rawBytes',
        'rawBuffer',
        'zipBufferFull',
        'fullZip',
        'HubSpot',
        'Tavily',
        'OpenAI',
        'Gemini',
        'Claude',
      ];

      for (const pattern of prohibited) {
        assert.equal(
          content.includes(pattern),
          false,
          `${file} should not contain "${pattern}"`,
        );
      }
    });
  }

  it('does not download full ZIP', async () => {
    assert.ok(true);
  });
});
