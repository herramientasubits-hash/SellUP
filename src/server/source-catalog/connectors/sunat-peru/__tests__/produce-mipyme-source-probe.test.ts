/**
 * PRODUCE Peru — MiPyme Source Probe — Tests
 *
 * Mockea fetch y filesystem. No hace llamadas reales. No descarga archivos reales.
 * No escribe Supabase. No crea candidatos.
 */

import { describe, it, mock, afterEach, after, before } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import type {
  ProduceMipymeSourceProbeInput,
  ProduceMipymeSourceProbeOutput,
} from '../types';

// ─── Excel buffer helper ──────────────────────────────────────────────────────

function buildExcelBuffer(headers: string[], rows: string[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function buildCsvBuffer(headers: string[], rows: string[][], delimiter = ','): Buffer {
  const lines = [headers, ...rows].map(row => row.join(delimiter));
  return Buffer.from(lines.join('\n'), 'utf-8');
}

// ─── Mock state ───────────────────────────────────────────────────────────────

const FAKE_DOWNLOAD_URL = 'https://datosabiertos.gob.pe/sites/default/files/mipyme.xlsx';
const FAKE_DATASET_URL = 'https://www.datosabiertos.gob.pe/dataset/directorio-de-empresas-mipyme-por-sector-productivo-ministerio-de-la-producci%C3%B3n-produce';

const VALID_HEADERS = ['NUM_RUC', 'RAZON_SOCIAL', 'CIIU', 'DESC_CIIU', 'SECTOR', 'DEPARTAMENTO'];
const VALID_ROWS = [
  ['20100000001', 'EMPRESA A SAC', '6201', 'Actividades de programacion', 'SERVICIOS', 'LIMA'],
  ['20100000002', 'EMPRESA B SAC', '4711', 'Venta al por menor', 'COMERCIO', 'AREQUIPA'],
  ['20100000003', 'EMPRESA C SAC', '8500', 'Educacion', 'SERVICIOS', 'CUSCO'],
];

const NO_RUC_HEADERS = ['NOMBRE', 'SECTOR', 'ACTIVIDAD'];
const NO_RUC_ROWS = [['EMPRESA X', 'SERVICIOS', 'Tecnologia']];

type MockState = {
  gitignoreContent: string;
  fileExistsResult: boolean;
  fileBuffer: Buffer | null;
  ruc20SnapshotContent: string;
  ckanApiResponse: object | null;
  downloadResponse: { ok: boolean; status: number; buffer: Buffer } | null;
  writtenReportData: string;
  writtenFileData: Buffer | null;
};

const mockState: MockState = {
  gitignoreContent: '.tmp/\n',
  fileExistsResult: false,
  fileBuffer: null,
  ruc20SnapshotContent: '',
  ckanApiResponse: null,
  downloadResponse: null,
  writtenReportData: '',
  writtenFileData: null,
};

function resetMockState(): void {
  mockState.gitignoreContent = '.tmp/\n';
  mockState.fileExistsResult = false;
  mockState.fileBuffer = null;
  mockState.ruc20SnapshotContent = '';
  mockState.ckanApiResponse = null;
  mockState.downloadResponse = null;
  mockState.writtenReportData = '';
  mockState.writtenFileData = null;
}

// ─── Module mocks ──────────────────────────────────────────────────────────────

mock.module('node:fs/promises', {
  namedExports: {
    readFile: async (filePath: string, encoding?: string): Promise<Buffer | string> => {
      if (String(filePath).endsWith('.gitignore') || String(filePath) === '.gitignore') {
        return encoding ? mockState.gitignoreContent : Buffer.from(mockState.gitignoreContent);
      }
      if (mockState.fileBuffer) {
        return encoding ? mockState.fileBuffer.toString(encoding as BufferEncoding) : mockState.fileBuffer;
      }
      throw Object.assign(new Error(`ENOENT: no such file '${filePath}'`), { code: 'ENOENT' });
    },
    writeFile: async (_path: string, data: string | Buffer): Promise<void> => {
      if (String(_path).endsWith('.json')) {
        mockState.writtenReportData = data.toString();
      } else {
        mockState.writtenFileData = typeof data === 'string' ? Buffer.from(data) : data;
      }
    },
    mkdir: async (): Promise<void> => {},
    open: async (_path: string): Promise<{
      read: (buf: Buffer, off: number, len: number, pos: number) => Promise<{ bytesRead: number; buffer: Buffer }>;
      stat: () => Promise<{ size: number }>;
      close: () => Promise<void>;
    }> => {
      const content = Buffer.from(mockState.ruc20SnapshotContent, 'utf-8');
      return {
        async read(buf: Buffer, off: number, len: number, pos: number): Promise<{ bytesRead: number; buffer: Buffer }> {
          const end = Math.min(pos + len, content.length);
          const bytesToCopy = Math.max(0, end - pos);
          if (bytesToCopy > 0) content.copy(buf, off, pos, pos + bytesToCopy);
          return { bytesRead: bytesToCopy, buffer: buf };
        },
        async stat() { return { size: content.length }; },
        async close() {},
      };
    },
  },
});

mock.module('node:fs', {
  namedExports: {
    existsSync: (_path: string): boolean => mockState.fileExistsResult,
  },
});

// ─── Fetch mock ────────────────────────────────────────────────────────────────

const fetchMock = mock.method(globalThis, 'fetch', async (
  url: string | URL | Request,
): Promise<Response> => {
  const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;

  // CKAN API response
  if (urlStr.includes('/api/3/action/package_show')) {
    if (mockState.ckanApiResponse) {
      return new Response(JSON.stringify(mockState.ckanApiResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: false }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // File download response
  if (mockState.downloadResponse) {
    const { ok, status, buffer } = mockState.downloadResponse;
    return new Response(ok ? (buffer as unknown as BodyInit) : null, {
      status,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-length': String(buffer.length),
      },
    });
  }

  return new Response(null, { status: 404 });
});

// ─── Module import ─────────────────────────────────────────────────────────────

let runProduceMipymeSourceProbe: typeof import('../produce-mipyme-source-probe')['runProduceMipymeSourceProbe'];

before(async () => {
  const mod = await import('../produce-mipyme-source-probe');
  runProduceMipymeSourceProbe = mod.runProduceMipymeSourceProbe;
});

// Restore fetch mock only at the end of the suite, not between tests.
// mock.reset() would restore globalThis.fetch before test 6 can use it.
after(() => {
  fetchMock.mock.restore();
});

afterEach(() => {
  resetMockState();
});

// ─── Env helper ───────────────────────────────────────────────────────────────

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const backup: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) backup[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(backup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function baseInput(overrides?: ProduceMipymeSourceProbeInput): ProduceMipymeSourceProbeInput {
  return {
    sourceUrl: FAKE_DATASET_URL,
    tempDir: '.tmp/sunat-peru',
    localPath: '.tmp/sunat-peru/produce-mipyme-source',
    reportPath: '.tmp/sunat-peru/produce-mipyme-profile-report.json',
    downloadIfMissing: false,
    requireAck: true,
    maxRowsToProfile: 1000,
    ruc20SnapshotPath: '.tmp/sunat-peru/ruc20-filtered-snapshot.txt',
    ...overrides,
  };
}

async function runProbe(overrides?: ProduceMipymeSourceProbeInput): Promise<ProduceMipymeSourceProbeOutput> {
  return runProduceMipymeSourceProbe(overrides ?? baseInput());
}

// ─── 1. Guardrail: sin ACK ─────────────────────────────────────────────────────

describe('produce-mipyme-source-probe — guardrails', () => {
  it('1. bloquea sin ACK', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: undefined, VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      const out = await runProbe(baseInput({ requireAck: true }));
      assert.equal(out.status, 'blocked');
      assert.equal(out.environment.ackProvided, false);
      assert.ok(out.errors.some(e => e.includes('ACK') || e.includes('SUNAT_PERU_LOCAL_SCAN_ACK')));
    });
  });

  it('2. bloquea en Vercel', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: '1', NODE_ENV: 'development' }, async () => {
      const out = await runProbe(baseInput({ requireAck: true }));
      assert.equal(out.status, 'blocked');
      assert.equal(out.environment.vercelDetected, true);
      assert.ok(out.errors.some(e => e.toLowerCase().includes('vercel')));
    });
  });

  it('3. bloquea en production', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'production' }, async () => {
      const out = await runProbe(baseInput({ requireAck: true }));
      assert.equal(out.status, 'blocked');
      assert.equal(out.environment.productionDetected, true);
      assert.ok(out.errors.some(e => e.toLowerCase().includes('production')));
    });
  });

  it('4. advierte si .tmp/ no está ignorado por git', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.gitignoreContent = '# no .tmp\nnode_modules/\n';
      const out = await runProbe(baseInput({ requireAck: false, downloadIfMissing: false }));
      assert.equal(out.environment.tempDirIgnoredByGit, false);
      assert.ok(out.warnings.some(w => w.includes('.gitignore') || w.includes('.tmp/')));
    });
  });

  it('5. bloquea si sourceUrl no puede resolverse via CKAN (BLOCKED_SOURCE_URL_MISSING)', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      // CKAN API returns failure, downloadIfMissing=true forces resolution attempt
      mockState.ckanApiResponse = null; // 404 for CKAN
      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: true,
      }));
      assert.ok(out.status === 'blocked' || out.status === 'error');
      assert.ok(out.errors.some(e => e.includes('BLOCKED_SOURCE_URL_MISSING')));
    });
  });

  it('6. guarda descarga solo en .tmp/sunat-peru/', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      const excelBuf = buildExcelBuffer(VALID_HEADERS, VALID_ROWS);
      mockState.ckanApiResponse = {
        success: true,
        result: {
          resources: [{ url: FAKE_DOWNLOAD_URL, format: 'XLSX', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
        },
      };
      mockState.downloadResponse = { ok: true, status: 200, buffer: excelBuf };
      mockState.fileBuffer = excelBuf; // after download, readFile returns it

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: true,
        localPath: '.tmp/sunat-peru/produce-mipyme-source',
      }));

      assert.ok(
        out.download.localPath?.startsWith('.tmp/sunat-peru/') ||
        out.download.localPath?.startsWith(process.cwd() + '/.tmp/sunat-peru/'),
        `Expected localPath in .tmp/sunat-peru/, got: ${out.download.localPath}`,
      );
    });
  });
});

// ─── Column detection ─────────────────────────────────────────────────────────

describe('produce-mipyme-source-probe — column detection', () => {
  async function runWithHeaders(headers: string[], rows: string[][]): Promise<ProduceMipymeSourceProbeOutput> {
    let result!: ProduceMipymeSourceProbeOutput;
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(headers, rows);
      result = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      }));
    });
    return result;
  }

  it('7. detecta columnas RUC', async () => {
    const out = await runWithHeaders(
      ['NUM_RUC', 'RAZON_SOCIAL', 'ACTIVIDAD'],
      [['20100000001', 'EMP A SAC', 'Tecnologia']],
    );
    assert.equal(out.schemaProfile.containsRuc, true);
    assert.ok(out.schemaProfile.rucColumnCandidates.length > 0);
  });

  it('8. detecta columnas CIIU', async () => {
    const out = await runWithHeaders(
      ['RUC', 'EMPRESA', 'CIIU', 'DESCRIPCION'],
      [['20100000001', 'EMP A SAC', '6201', 'Programacion']],
    );
    assert.equal(out.schemaProfile.containsCiiu, true);
    assert.ok(out.schemaProfile.ciiuColumnCandidates.length > 0);
  });

  it('9. detecta descripción de actividad', async () => {
    const out = await runWithHeaders(
      ['RUC', 'EMPRESA', 'COD_CIIU', 'DESC_CIIU'],
      [['20100000001', 'EMP A SAC', '6201', 'Actividades de programacion']],
    );
    assert.equal(out.schemaProfile.containsActivityDescription, true);
    assert.ok(out.schemaProfile.activityDescriptionColumnCandidates.length > 0);
  });

  it('10. detecta columna sector si existe', async () => {
    const out = await runWithHeaders(VALID_HEADERS, VALID_ROWS);
    assert.equal(out.schemaProfile.containsSector, true);
    assert.ok(out.schemaProfile.sectorColumnCandidates.length > 0);
  });
});

// ─── Schema and coverage profiles ────────────────────────────────────────────

describe('produce-mipyme-source-probe — schema and coverage profiles', () => {
  it('11. genera schemaProfile con todas las propiedades requeridas', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(VALID_HEADERS, VALID_ROWS);

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      }));

      const schema = out.schemaProfile;
      assert.ok(Array.isArray(schema.columns));
      assert.ok(Array.isArray(schema.normalizedColumns));
      assert.ok(typeof schema.rowCountProfiled === 'number');
      assert.ok(typeof schema.containsRuc === 'boolean');
      assert.ok(typeof schema.containsCiiu === 'boolean');
      assert.ok(typeof schema.containsActivityDescription === 'boolean');
      assert.ok(typeof schema.containsSector === 'boolean');
      assert.ok(Array.isArray(schema.rucColumnCandidates));
      assert.ok(Array.isArray(schema.ciiuColumnCandidates));
      assert.ok(Array.isArray(schema.activityDescriptionColumnCandidates));
      assert.ok(Array.isArray(schema.sectorColumnCandidates));
      assert.ok(schema.sheetNames !== undefined);
    });
  });

  it('12. genera coverageProfile con todas las propiedades requeridas', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(VALID_HEADERS, VALID_ROWS);
      // Provide a RUC20 snapshot with one matching entry
      mockState.ruc20SnapshotContent =
        '20100000001|EMPRESA A SAC|ACTIVO|HABIDO|150101\n' +
        '20100000099|EMPRESA Z SAC|ACTIVO|HABIDO|150102\n';

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      }));

      const cov = out.coverageProfile;
      assert.ok(typeof cov.produceRowsWithRuc === 'number');
      assert.ok(typeof cov.produceRowsWithCiiu === 'number');
      assert.ok(typeof cov.uniqueProduceRucsProfiled === 'number');
      assert.ok(typeof cov.matchedRuc20SnapshotProfiled === 'number');
      // matchRateAgainstProfiledRuc20 is optional but should be a number if RUC20 loaded
      if (cov.matchRateAgainstProfiledRuc20 !== undefined) {
        assert.ok(typeof cov.matchRateAgainstProfiledRuc20 === 'number');
      }
    });
  });

  it('12b. cross-reference detecta matches correctamente', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(VALID_HEADERS, VALID_ROWS);
      // RUC20 snapshot contains exactly one of the three PRODUCE RUCs
      mockState.ruc20SnapshotContent = '20100000001|EMPRESA A SAC|ACTIVO|HABIDO|150101\n';

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      }));

      assert.equal(out.coverageProfile.matchedRuc20SnapshotProfiled, 1);
    });
  });
});

// ─── Output structure constraints ─────────────────────────────────────────────

describe('produce-mipyme-source-probe — output structure constraints', () => {
  it('13. no devuelve rawRows, allRows ni fullRows en el output', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(VALID_HEADERS, VALID_ROWS);

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      })) as unknown as Record<string, unknown>;

      assert.ok(!('rawRows' in out), 'Output should not contain rawRows');
      assert.ok(!('allRows' in out), 'Output should not contain allRows');
      assert.ok(!('fullRows' in out), 'Output should not contain fullRows');
    });
  });

  it('14. el output no contiene propiedades de Supabase', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(VALID_HEADERS, VALID_ROWS);

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      })) as unknown as Record<string, unknown>;

      const json = JSON.stringify(out);
      assert.ok(!json.includes('supabase'), 'Output should not reference supabase');
      assert.ok(!json.includes('prospect_candidates'), 'Output should not reference prospect_candidates');
      assert.ok(!json.includes('prospect_batches'), 'Output should not reference prospect_batches');
    });
  });

  it('15. el output no contiene referencias a registry, preflight ni wizard', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(VALID_HEADERS, VALID_ROWS);

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      }));

      const json = JSON.stringify(out);
      assert.ok(!json.includes('SOURCE_DISCOVERY_REGISTRY'), 'No registry references');
      assert.ok(!json.includes('preflight'), 'No preflight references');
      assert.ok(!json.includes('wizard'), 'No wizard references');
    });
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('produce-mipyme-source-probe — error handling and verdicts', () => {
  it('16. maneja archivo no parseable con status error', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      // Return garbage bytes that are not valid Excel/CSV
      mockState.fileExistsResult = true;
      mockState.fileBuffer = Buffer.from('NOT_VALID_EXCEL_\x00\x01\x02\x03', 'binary');

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      }));

      assert.equal(out.status, 'error');
      assert.ok(out.errors.length > 0, 'Should have errors for unparseable file');
    });
  });

  it('17. fuente sin columna RUC resulta en REJECT', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(NO_RUC_HEADERS, NO_RUC_ROWS);

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      }));

      assert.equal(out.verdict, 'REJECT');
      assert.equal(out.schemaProfile.containsRuc, false);
    });
  });

  it('18. fuente con RUC + CIIU resulta en SPIKE_LOCAL_FIRST o CONNECT_NOW', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildExcelBuffer(VALID_HEADERS, VALID_ROWS);
      // Provide matching RUC20 snapshot
      mockState.ruc20SnapshotContent =
        VALID_ROWS.map(r => `${r[0]}|${r[1]}|ACTIVO|HABIDO|150101`).join('\n');

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        localPath: '.tmp/sunat-peru/produce-mipyme-source.xlsx',
      }));

      assert.equal(out.schemaProfile.containsRuc, true);
      assert.ok(out.schemaProfile.containsCiiu || out.schemaProfile.containsActivityDescription);
      assert.ok(
        out.verdict === 'SPIKE_LOCAL_FIRST' || out.verdict === 'CONNECT_NOW',
        `Expected SPIKE_LOCAL_FIRST or CONNECT_NOW, got: ${out.verdict}`,
      );
    });
  });
});

// ─── CSV support ─────────────────────────────────────────────────────────────

describe('produce-mipyme-source-probe — CSV support', () => {
  it('detecta y parsea CSV correctamente', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.fileExistsResult = true;
      mockState.fileBuffer = buildCsvBuffer(VALID_HEADERS, VALID_ROWS);

      const out = await runProbe(baseInput({
        requireAck: false,
        downloadIfMissing: false,
        // .csv extension so format is detected
        localPath: '.tmp/sunat-peru/produce-mipyme-source.csv',
      }));

      assert.ok(out.schemaProfile.columns.length > 0, 'Should detect columns from CSV');
      assert.equal(out.schemaProfile.containsRuc, true);
    });
  });
});

// ─── Source key and mode ──────────────────────────────────────────────────────

describe('produce-mipyme-source-probe — source key and mode', () => {
  it('siempre retorna sourceKey pe_produce_mipyme_sector y mode local_source_probe', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      const out = await runProbe(baseInput({ requireAck: false, downloadIfMissing: false }));
      assert.equal(out.sourceKey, 'pe_produce_mipyme_sector');
      assert.equal(out.mode, 'local_source_probe');
    });
  });

  it('environment.localOnly siempre es true', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      const out = await runProbe(baseInput({ requireAck: false, downloadIfMissing: false }));
      assert.equal(out.environment.localOnly, true);
    });
  });
});
