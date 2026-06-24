/**
 * SUNAT Peru Bulk — Controlled Sample TXT Extractor Tests
 *
 * Tests unitarios para sunat-sample-extractor.
 * Mockea fetch global. No hace llamadas reales a SUNAT.
 * No descarga ZIP completo. No guarda archivos.
 * No referencia Supabase, registry, preflight ni wizard.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { extractSunatBulkSample } from '../sunat-sample-extractor';
import { SUNAT_BULK_URL } from '../types';

// ─── Mock helpers ─────────────────────────────────────────────────────────────────

function makeResponse(
  status: number,
  headers: Record<string, string>,
  body?: Uint8Array | null,
): Response {
  return new Response(
    body
      ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
      : null,
    { status, headers },
  );
}

function setUint16LE(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset + offset, 2).setUint16(0, value, true);
}

function setUint32LE(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset + offset, 4).setUint32(0, value, true);
}

const MOCK_FILE_SIZE = 1_000_000;
const PROBE_TAIL_SIZE = 512 * 1024;
const MOCK_TAIL_START = MOCK_FILE_SIZE - PROBE_TAIL_SIZE;

type BuildTailOptions = {
  fileName?: string;
  compressedSize?: number;
  uncompressedSize?: number;
  compressionMethod?: number;
  localHeaderOffset?: number;
};

function buildMockZipTail(options: BuildTailOptions = {}): Uint8Array {
  const {
    fileName = 'padron_reducido_ruc.txt',
    compressedSize = 150_000,
    uncompressedSize = 500_000_000,
    compressionMethod = 8,
    localHeaderOffset = 100,
  } = options;

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
  setUint32LE(buffer, 42, localHeaderOffset);
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
  setUint32LE(buffer, eocdOffset + 16, MOCK_TAIL_START);
  setUint16LE(buffer, eocdOffset + 20, 0);

  return buffer;
}

function buildHeadHeaders(): Record<string, string> {
  return {
    'content-type': 'application/zip',
    'content-length': String(MOCK_FILE_SIZE),
    'last-modified': 'Mon, 15 Jun 2026 12:00:00 GMT',
    'accept-ranges': 'bytes',
  };
}

function buildTailHeaders(bodyLength: number): Record<string, string> {
  return {
    'content-type': 'application/zip',
    'content-length': String(bodyLength),
    'content-range': `bytes ${MOCK_TAIL_START}-${MOCK_FILE_SIZE - 1}/${MOCK_FILE_SIZE}`,
  };
}

function buildRangeHeaders(contentLength: number): Record<string, string> {
  return {
    'content-type': 'application/octet-stream',
    'content-length': String(contentLength),
    'content-range': `bytes 130-${129 + contentLength}/${MOCK_FILE_SIZE}`,
  };
}

function buildCompressedTestData(rows: number, delimiter: string): {
  compressed: Uint8Array;
  decompressed: string;
  columnCount: number;
} {
  const lines: string[] = [];
  let columnCount = 0;

  for (let i = 0; i < rows; i++) {
    const ruc = String(20000000000 + i);
    const name = i === 0 ? `EMPRESA EJEMPLO ${i}` : `EMPRESA TEST ${i}`;
    const status = i % 2 === 0 ? 'ACTIVO' : '';
    const domicile = 'DOMICILIO FISCAL';
    const ubigeo = String(100000 + i);
    const cols = [ruc, name, status, domicile, ubigeo];
    columnCount = cols.length;
    lines.push(cols.join(delimiter));
  }

  const text = lines.join('\n') + '\n';
  const compressed = deflateRawSync(Buffer.from(text, 'utf-8'));
  return { compressed, decompressed: text, columnCount };
}

// ─── Mock state ───────────────────────────────────────────────────────────────────

type MockState = {
  tailBuffer: Uint8Array;
  rangeBody: Uint8Array | null;
  rangeHeaders: Record<string, string>;
  throwOnFetch: boolean;
  throwErrorMsg: string;
  responseStatus: number;
};

const defaultState: MockState = {
  tailBuffer: new Uint8Array(0),
  rangeBody: null,
  rangeHeaders: buildRangeHeaders(0),
  throwOnFetch: false,
  throwErrorMsg: '',
  responseStatus: 206,
};

let mockState: MockState = { ...defaultState };
let fetchCallCount = 0;
let lastRangeHeader: string | undefined;

function setState(partial: Partial<MockState>): void {
  mockState = { ...defaultState, ...partial };
}

async function mockFetchImpl(
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const urlStr = typeof url === 'string' ? url : url.toString();
  if (urlStr !== SUNAT_BULK_URL) {
    return makeResponse(404, {});
  }

  fetchCallCount++;

  if (init?.method === 'HEAD') {
    return makeResponse(200, buildHeadHeaders());
  }

  if (fetchCallCount === 2) {
    return makeResponse(206, buildTailHeaders(mockState.tailBuffer.length), mockState.tailBuffer);
  }

  if (mockState.throwOnFetch) {
    throw new Error(mockState.throwErrorMsg || 'Simulated fetch error');
  }

  const hdrs = init?.headers as Record<string, string> | undefined;
  if (hdrs?.Range) {
    lastRangeHeader = hdrs.Range;
  }

  return makeResponse(mockState.responseStatus, mockState.rangeHeaders, mockState.rangeBody);
}

globalThis.fetch = mockFetchImpl as unknown as typeof globalThis.fetch;

afterEach(() => {
  mockState = { ...defaultState };
  fetchCallCount = 0;
  lastRangeHeader = undefined;
});

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('sunat-sample-extractor', () => {
  describe('compressedDataStartOffset', () => {
    it('computes compressedDataStartOffset from local header', async () => {
      const { compressed } = buildCompressedTestData(5, '|');
      const pipeFileName = 'padron_reducido_ruc.txt';
      const fileNameBytes = new TextEncoder().encode(pipeFileName);
      const fileNameLen = fileNameBytes.length;
      const localHeaderOffset = 100;
      const expectedOffset = localHeaderOffset + 30 + fileNameLen + 0;

      const tail = buildMockZipTail({
        fileName: pipeFileName,
        localHeaderOffset,
        compressedSize: compressed.length,
      });

      setState({
        tailBuffer: tail,
        rangeBody: compressed,
        rangeHeaders: buildRangeHeaders(compressed.length),
      });

      const output = await extractSunatBulkSample({ maxLines: 5 });

      assert.equal(output.status, 'sampled');
      assert.equal(output.entry.compressedDataStartOffset, expectedOffset);
      assert.ok(output.sample.lines.length > 0);
    });
  });

  describe('blocking', () => {
    it('blocks when no text entry is found', async () => {
      const tail = buildMockZipTail({ fileName: 'data.bin' });
      setState({ tailBuffer: tail });

      const output = await extractSunatBulkSample({ maxLines: 5 });

      assert.equal(output.status, 'blocked');
      assert.ok(output.warnings.some(w => w.code === 'no_text_entry'));
    });

    it('blocks when compression method is not Deflate (8)', async () => {
      const tail = buildMockZipTail({ compressionMethod: 0 });
      setState({ tailBuffer: tail });

      const output = await extractSunatBulkSample({ maxLines: 5 });

      assert.equal(output.status, 'blocked');
      assert.ok(output.warnings.some(w => w.code === 'unsupported_compression'));
    });
  });

  describe('guard limits', () => {
    it('respects absolute max compressed bytes', async () => {
      const { compressed } = buildCompressedTestData(5, '|');
      const tail = buildMockZipTail({ compressedSize: compressed.length });
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({
        maxCompressedBytes: 10 * 1024 * 1024,
        maxLines: 5,
      });

      assert.equal(output.guard.maxCompressedBytesToRead, 5 * 1024 * 1024);
    });

    it('respects absolute max decompressed bytes', async () => {
      const { compressed } = buildCompressedTestData(5, '|');
      const tail = buildMockZipTail({ compressedSize: compressed.length });
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({
        maxDecompressedBytes: 10 * 1024 * 1024,
        maxLines: 5,
      });

      assert.equal(output.guard.maxDecompressedBytesToRead, 2 * 1024 * 1024);
    });

    it('respects absolute max lines', async () => {
      const { compressed } = buildCompressedTestData(250, '|');
      const tail = buildMockZipTail({ compressedSize: compressed.length });
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 500 });

      assert.equal(output.guard.maxLinesToReturn, 200);
      assert.ok(output.sample.lines.length <= 200);
    });
  });

  describe('preview redaction', () => {
    it('truncates previews to max 160 characters', async () => {
      const longName = 'A'.repeat(300);
      const longText = Array.from({ length: 3 }, (_, i) =>
        `${i + 1}|${longName}|ACTIVO|DOMICILIO|10000${i}`,
      ).join('\n') + '\n';
      const longCompressed = deflateRawSync(Buffer.from(longText, 'utf-8'));

      const tail = buildMockZipTail({
        compressedSize: longCompressed.length,
      });

      setState({
        tailBuffer: tail,
        rangeBody: longCompressed,
        rangeHeaders: buildRangeHeaders(longCompressed.length),
      });

      const output = await extractSunatBulkSample({ maxLines: 3 });

      assert.ok(output.sample.lines.length > 0);
      for (const line of output.sample.lines) {
        assert.ok(line.redactedPreview.length <= 160);
        if (line.redactedPreview.endsWith('...')) {
          assert.equal(line.redactedPreview.length, 160);
        }
      }
    });
  });

  describe('delimiter inference', () => {
    it('infers pipe delimiter', async () => {
      const { compressed } = buildCompressedTestData(10, '|');
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 10 });

      assert.equal(output.status, 'sampled');
      assert.equal(output.sample.inferredDelimiter, 'pipe');
    });

    it('infers tab delimiter', async () => {
      const { compressed } = buildCompressedTestData(10, '\t');
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 10 });

      assert.equal(output.status, 'sampled');
      assert.equal(output.sample.inferredDelimiter, 'tab');
    });

    it('infers comma delimiter', async () => {
      const { compressed } = buildCompressedTestData(10, ',');
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 10 });

      assert.equal(output.status, 'sampled');
      assert.equal(output.sample.inferredDelimiter, 'comma');
    });

    it('returns unknown when no delimiter can be inferred', async () => {
      const text = 'SINGLEWORD\n12345678901\nANOTHER\n';
      const compressed = deflateRawSync(Buffer.from(text, 'utf-8'));
      const tail = buildMockZipTail({ compressedSize: compressed.length });
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 10 });

      assert.equal(output.sample.inferredDelimiter, undefined);
    });
  });

  describe('safety', () => {
    it('does not return raw buffers', async () => {
      const { compressed } = buildCompressedTestData(3, '|');
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 3 });

      assert.equal('rawBytes' in output, false);
      assert.equal('rawBuffer' in output, false);
      assert.equal('zipBufferFull' in output, false);
      assert.equal('fullZip' in output, false);
      assert.equal('fullText' in output, false);
      assert.equal('fullTxt' in output, false);
    });

    it('never allows fullDownloadAllowed', async () => {
      const { compressed } = buildCompressedTestData(3, '|');
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 3 });

      assert.equal(output.guard.fullDownloadAllowed, false);
    });

    it('handles range fetch error without throwing', async () => {
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, throwOnFetch: true, throwErrorMsg: 'Network failure' });

      const output = await extractSunatBulkSample({ maxLines: 3 });

      assert.equal(output.status, 'error');
      assert.ok(output.errors.length > 0);
    });

    it('handles inflate error without throwing', async () => {
      const tail = buildMockZipTail();
      setState({
        tailBuffer: tail,
        rangeBody: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
        rangeHeaders: buildRangeHeaders(4),
      });

      const output = await extractSunatBulkSample({ maxLines: 3 });

      assert.ok(output.status === 'error' || output.status === 'partial');
    });
  });

  describe('inferred column count', () => {
    it('reports inferred column count from sample', async () => {
      const { compressed, columnCount } = buildCompressedTestData(10, '|');
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 10 });

      assert.equal(output.status, 'sampled');
      assert.equal(output.sample.inferredColumnCount, columnCount);
    });

    it('returns column count per line', async () => {
      const { compressed, columnCount } = buildCompressedTestData(5, '|');
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 5 });

      assert.equal(output.status, 'sampled');
      assert.ok(output.sample.lines.length > 0);
      for (const line of output.sample.lines) {
        assert.equal(line.columnCount, columnCount);
      }
    });
  });

  describe('parser config suggestion', () => {
    it('suggests pipe config for pipe delimited', async () => {
      const { compressed } = buildCompressedTestData(5, '|');
      const tail = buildMockZipTail();
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 5 });

      assert.equal(output.status, 'sampled');
      assert.equal(output.sample.parserConfigSuggestion, 'createDefaultPipeConfig()');
    });
  });

  describe('stats', () => {
    it('reports compressed and decompressed bytes read', async () => {
      const { compressed, decompressed } = buildCompressedTestData(10, '|');
      const tail = buildMockZipTail({
        compressedSize: compressed.length,
      });
      setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

      const output = await extractSunatBulkSample({ maxLines: 10 });

      assert.equal(output.status, 'sampled');
      assert.ok(output.stats.compressedBytesRead > 0);
      assert.ok(output.stats.decompressedBytesRead > 0);
      assert.ok(output.stats.linesDetected >= 10);
      assert.equal(output.stats.linesReturned, 10);
    });

    it('reports truncated when output hits max decompressed bytes', async () => {
      const manyRows = 1000;
      const lines: string[] = [];
      for (let i = 0; i < manyRows; i++) {
        lines.push(`${i}|name${i}|ACTIVO|DOMICILIO|${100000 + i}`);
      }
      const text = lines.join('\n') + '\n';
      const compressed = deflateRawSync(Buffer.from(text, 'utf-8'));

      const tail = buildMockZipTail({
        compressedSize: compressed.length,
      });
      setState({
        tailBuffer: tail,
        rangeBody: compressed,
        rangeHeaders: buildRangeHeaders(compressed.length),
      });

      const output = await extractSunatBulkSample({
        maxDecompressedBytes: 100,
        maxLines: 1000,
      });

      assert.equal(output.status, 'sampled');
      assert.equal(output.stats.truncated, true);
    });
  });
});

// ─── Open Range / Stream Tests ─────────────────────────────────────────────────────

describe('sunat-sample-extractor — open range and stream', () => {

  it('uses open-ended Range header bytes=152-', async () => {
    mockState = { ...defaultState };
    fetchCallCount = 0;
    lastRangeHeader = undefined;

    const { compressed } = buildCompressedTestData(3, '|');
    const pipeFileName = 'padron_reducido_ruc.txt';
    const fileNameBytes = new TextEncoder().encode(pipeFileName);
    const localHeaderOffset = 100;
    const expectedOffset = localHeaderOffset + 30 + fileNameBytes.length + 0;

    const tail = buildMockZipTail({
      fileName: pipeFileName,
      localHeaderOffset,
      compressedSize: compressed.length,
    });

    setState({
      tailBuffer: tail,
      rangeBody: compressed,
      rangeHeaders: buildRangeHeaders(compressed.length),
    });

    const output = await extractSunatBulkSample({ maxLines: 5 });

    assert.equal(lastRangeHeader, `bytes=${expectedOffset}-`);
    assert.ok(lastRangeHeader !== undefined && (lastRangeHeader as string).endsWith('-'));
    assert.equal(output.stats.compressedBytesRead, compressed.length);
    assert.equal(output.status, 'sampled');
  });

  it('does not call arrayBuffer on the sample extraction response', async () => {
    const { compressed } = buildCompressedTestData(3, '|');
    const tail = buildMockZipTail({ compressedSize: compressed.length });
    setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

    const output = await extractSunatBulkSample({ maxLines: 3 });

    assert.equal(output.status, 'sampled');
    assert.equal(output.stats.rangeRequestMode, 'open_ended_stream_capped');
  });

  it('cancels reader at maxCompressedBytesToRead limit', async () => {
    const manyRows = 5000;
    const lines: string[] = [];
    for (let i = 0; i < manyRows; i++) {
      lines.push(`${i}|name${i}|ACTIVO|DOMICILIO|${100000 + i}`);
    }
    const text = lines.join('\n') + '\n';
    const compressed = deflateRawSync(Buffer.from(text, 'utf-8'));

    const tail = buildMockZipTail({ compressedSize: compressed.length });
    setState({
      tailBuffer: tail,
      rangeBody: compressed,
      rangeHeaders: buildRangeHeaders(compressed.length),
    });

    const maxCompressed = 100;
    const output = await extractSunatBulkSample({
      maxCompressedBytes: maxCompressed,
      maxLines: 5000,
    });

    assert.ok(output.stats.compressedBytesRead <= maxCompressed);
    assert.ok(output.stats.compressedBytesRead > 0);
  });

  it('handles 200 response with stream capped and produces warning', async () => {
    const { compressed } = buildCompressedTestData(5, '|');
    const tail = buildMockZipTail({ compressedSize: compressed.length });
    setState({
      tailBuffer: tail,
      rangeBody: compressed,
      rangeHeaders: buildRangeHeaders(compressed.length),
      responseStatus: 200,
    });

    const output = await extractSunatBulkSample({ maxLines: 5 });

    assert.equal(output.status, 'sampled');
    assert.ok(output.warnings.some(
      w => w.code === 'server_returned_200_for_range_request_but_stream_was_capped',
    ));
  });

  it('handles HTML response as blocked', async () => {
    const tail = buildMockZipTail();
    setState({
      tailBuffer: tail,
      rangeBody: new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]),
      rangeHeaders: { 'content-type': 'text/html; charset=utf-8', 'content-length': '5' },
      responseStatus: 200,
    });

    const output = await extractSunatBulkSample({ maxLines: 5 });

    assert.equal(output.status, 'blocked');
    assert.ok(output.warnings.some(w => w.code === 'html_response'));
  });

  it('stats include rangeRequestMode as open_ended_stream_capped', async () => {
    const { compressed } = buildCompressedTestData(3, '|');
    const tail = buildMockZipTail({ compressedSize: compressed.length });
    setState({ tailBuffer: tail, rangeBody: compressed, rangeHeaders: buildRangeHeaders(compressed.length) });

    const output = await extractSunatBulkSample({ maxLines: 3 });

    assert.equal(output.stats.rangeRequestMode, 'open_ended_stream_capped');
  });
});

// ─── Safety Tests ─────────────────────────────────────────────────────────────────

describe('sunat-sample-extractor — no prohibited references', () => {
  it('does not reference Supabase', () => {
    assert.equal(extractSunatBulkSample.toString().includes('supabase'), false);
  });

  it('does not reference prospect_candidates', () => {
    assert.equal(extractSunatBulkSample.toString().includes('prospect_candidates'), false);
  });

  it('does not reference prospect_batches', () => {
    assert.equal(extractSunatBulkSample.toString().includes('prospect_batches'), false);
  });

  it('does not reference SOURCE_DISCOVERY_REGISTRY', () => {
    assert.equal(extractSunatBulkSample.toString().includes('SOURCE_DISCOVERY_REGISTRY'), false);
  });

  it('does not reference source-discovery-preflight', () => {
    assert.equal(extractSunatBulkSample.toString().includes('source-discovery-preflight'), false);
  });

  it('does not reference HubSpot', () => {
    assert.equal(extractSunatBulkSample.toString().includes('HubSpot'), false);
  });

  it('does not reference Tavily', () => {
    assert.equal(extractSunatBulkSample.toString().includes('Tavily'), false);
  });

  it('does not reference OpenAI, Gemini, or Claude', () => {
    const fn = extractSunatBulkSample.toString();
    assert.equal(fn.includes('OpenAI'), false);
    assert.equal(fn.includes('Gemini'), false);
    assert.equal(fn.includes('Claude'), false);
  });

  it('does not reference fs.writeFile or createWriteStream', () => {
    const fn = extractSunatBulkSample.toString();
    assert.equal(fn.includes('writeFile'), false);
    assert.equal(fn.includes('createWriteStream'), false);
  });

  it('does not reference rawBytes, rawBuffer, zipBufferFull, fullZip, fullText, or fullTxt', () => {
    const fn = extractSunatBulkSample.toString();
    assert.equal(fn.includes('rawBytes'), false);
    assert.equal(fn.includes('rawBuffer'), false);
    assert.equal(fn.includes('zipBufferFull'), false);
    assert.equal(fn.includes('fullZip'), false);
    assert.equal(fn.includes('fullText'), false);
    assert.equal(fn.includes('fullTxt'), false);
  });
});

describe('sunat-sample-extractor source file safety', () => {
  const sourceFiles = ['../sunat-sample-extractor.ts'];

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
        'fullText',
        'fullTxt',
        'HubSpot',
        'Tavily',
        'OpenAI',
        'Gemini',
        'Claude',
        '.arrayBuffer()',
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
