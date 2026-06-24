/**
 * SUNAT Peru — Local Deeper Scan Tests
 *
 * Tests para el scan local/offline del Padrón Reducido RUC.
 * Mockea fs, fetch, child_process. No descarga real.
 * No referencia Supabase, registry, preflight ni wizard.
 *
 * Los mocks de módulo se configuran UNA VEZ al inicio.
 * Las pruebas usan estado mutable (mockState) para controlar
 * lo que devuelven los mocks. afterEach resetea el estado.
 */

import { describe, it, mock, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import type {
  SunatLocalDeeperScanInput,
  SunatLocalDeeperScanOutput,
} from '../types';

// ─── Mock ZIP Builder ──────────────────────────────────────────────────────────

type MockZipConfig = {
  fileName?: string;
  lines?: string[];
};

function buildMockZipBuffer(config: MockZipConfig = {}): Buffer {
  const fileName = config.fileName ?? 'padron_reducido_ruc.txt';
  const lines = config.lines ?? [];
  const text = lines.join('\n');
  const compressed = deflateRawSync(Buffer.from(text, 'utf-8'));
  const fileNameBytes = Buffer.from(fileName, 'utf-8');
  const nameLen = fileNameBytes.length;
  const lhSize = 30;
  const extraLen = 0;
  const compDataOffset = lhSize + nameLen + extraLen;

  const localHeader = Buffer.alloc(lhSize);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(text.length, 22);
  localHeader.writeUInt16LE(nameLen, 26);
  localHeader.writeUInt16LE(extraLen, 28);

  const cdEntry = Buffer.alloc(46);
  cdEntry.writeUInt32LE(0x02014b50, 0);
  cdEntry.writeUInt16LE(20, 4);
  cdEntry.writeUInt16LE(20, 6);
  cdEntry.writeUInt16LE(0, 8);
  cdEntry.writeUInt16LE(8, 10);
  cdEntry.writeUInt16LE(0, 12);
  cdEntry.writeUInt16LE(0, 14);
  cdEntry.writeUInt32LE(0, 16);
  cdEntry.writeUInt32LE(compressed.length, 20);
  cdEntry.writeUInt32LE(text.length, 24);
  cdEntry.writeUInt16LE(nameLen, 28);
  cdEntry.writeUInt16LE(extraLen, 30);
  cdEntry.writeUInt16LE(0, 32);
  cdEntry.writeUInt16LE(0, 34);
  cdEntry.writeUInt16LE(0, 36);
  cdEntry.writeUInt32LE(0, 38);
  cdEntry.writeUInt32LE(0, 42);

  const cdEntryFull = Buffer.concat([cdEntry, fileNameBytes]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdEntryFull.length, 12);
  eocd.writeUInt32LE(compDataOffset + compressed.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, fileNameBytes, compressed, cdEntryFull, eocd]);
}

// ─── Mutable mock state ─────────────────────────────────────────────────────────

const mockState = {
  zipBuffer: null as Buffer | null,
  gitignoreContent: '.tmp/\n',
  freeGb: 100,
  existsResult: true,
  downloadResponse: null as Response | null,
};
function resetMockState(): void {
  mockState.zipBuffer = buildMockZipBuffer({
    lines: ['RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|DEPARTAMENTO|PROVINCIA|DISTRITO',
            '20100000001|EMPRESA UNO SAC|ACTIVO|HABIDO|150101|LIMA|LIMA|LIMA',
            '20100000002|EMPRESA DOS SAC|ACTIVO|HABIDO|150102|LIMA|LIMA|MIRAFLORES',
            '10100000001|PERSONA NATURAL UNO|ACTIVO|HABIDO|150101|LIMA|LIMA|LIMA',
            '20100000003|EMPRESA TRES SAC|BAJA DEFINITIVA|HABIDO|150103|CALLAO|CALLAO|CALLAO'],
  });
  mockState.gitignoreContent = '.tmp/\n';
  mockState.freeGb = 100;
  mockState.existsResult = true;
  mockState.downloadResponse = null;
}

resetMockState();

// ─── Setup mocks ONCE ───────────────────────────────────────────────────────────

mock.module('node:fs/promises', {
  namedExports: {
    open: async (filePath: string, _flags: string) => {
      if (filePath === '.gitignore' || filePath.endsWith('.gitignore')) {
        return makeFsHandle(Buffer.from(mockState.gitignoreContent, 'utf-8'));
      }
      if (filePath.endsWith('.zip') || filePath.endsWith('padron_reducido_ruc.zip')) {
        const data = mockState.zipBuffer ?? Buffer.alloc(0);
        return makeFsHandleForZip(data);
      }
      if (filePath.endsWith('.tmp/') || filePath.includes('.tmp/')) {
        return makeEmptyFsHandle();
      }
      return makeEmptyFsHandle();
    },
    readFile: async (filePath: string, _encoding?: string): Promise<string | Buffer> => {
      if (filePath === '.gitignore' || filePath.endsWith('.gitignore')) {
        return mockState.gitignoreContent;
      }
      return '';
    },
    writeFile: async (_path: string, _data: string | Buffer): Promise<void> => {},
    mkdir: async (_path: string, _opts?: object): Promise<void> => {},
    stat: async (_path: string): Promise<{ size: number }> => {
      if (_path.endsWith('.zip') && mockState.zipBuffer) {
        return { size: mockState.zipBuffer.length };
      }
      return { size: 0 };
    },
    access: async (_path: string): Promise<void> => {},
  },
});

mock.module('node:fs', {
  namedExports: {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2 },
    existsSync: (_path: string): boolean => mockState.existsResult,
  },
});

mock.module('node:child_process', {
  namedExports: {
    execSync: (_cmd: string, _opts?: object): string => {
      const freeKb = mockState.freeGb * 1024 * 1024;
      return `dev/disk1s1 976000000 500000000 ${freeKb} 50% /tmp/some/mount`;
    },
  },
});

function makeFsHandle(data: Buffer) {
  return {
    readCalls: [] as Array<{ pos: number; size: number }>,
    data,
    statResult: { size: data.length },
    async read(
      buffer: Buffer, offset: number, length: number, position: number,
    ): Promise<{ bytesRead: number; buffer: Buffer }> {
      const end = Math.min(position + length, data.length);
      const bytesToCopy = Math.max(0, end - position);
      if (bytesToCopy > 0) {
        data.copy(buffer, offset, position, position + bytesToCopy);
      }
      return { bytesRead: bytesToCopy, buffer };
    },
    async stat(): Promise<{ size: number }> { return { size: data.length }; },
    async close(): Promise<void> {},
    async write(_buf: Buffer): Promise<void> {},
  };
}

function makeFsHandleForZip(data: Buffer) {
  return {
    readCalls: [] as Array<{ pos: number; size: number }>,
    data,
    statResult: { size: data.length },
    async read(
      buffer: Buffer, offset: number, length: number, position: number,
    ): Promise<{ bytesRead: number; buffer: Buffer }> {
      const end = Math.min(position + length, data.length);
      const bytesToCopy = Math.max(0, end - position);
      if (bytesToCopy > 0) {
        data.copy(buffer, offset, position, position + bytesToCopy);
      }
      return { bytesRead: bytesToCopy, buffer };
    },
    async stat(): Promise<{ size: number }> { return { size: data.length }; },
    async close(): Promise<void> {},
    async write(_buf: Buffer): Promise<void> {},
  };
}

function makeEmptyFsHandle() {
  return {
    async read(): Promise<{ bytesRead: number; buffer: Buffer }> {
      return { bytesRead: 0, buffer: Buffer.alloc(0) };
    },
    async stat(): Promise<{ size: number }> { return { size: 0 }; },
    async close(): Promise<void> {},
    async write(_buf: Buffer): Promise<void> {},
  };
}

// ─── Import module under test ONCE ──────────────────────────────────────────────

let runSunatLocalDeeperScan: typeof import('../sunat-local-deeper-scan')['runSunatLocalDeeperScan'];

before(async () => {
  const mod = await import('../sunat-local-deeper-scan');
  runSunatLocalDeeperScan = mod.runSunatLocalDeeperScan;
});

afterEach(() => {
  resetMockState();
  mock.reset();
});

// ─── Env helper ─────────────────────────────────────────────────────────────────

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> | void {
  const backup: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    backup[k] = process.env[k];
  }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  const result = fn();
  if (result instanceof Promise) {
    return result.finally(() => {
      for (const [k, v] of Object.entries(backup)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    });
  }
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function runScan(
  overrides?: SunatLocalDeeperScanInput,
): Promise<SunatLocalDeeperScanOutput> {
  return runSunatLocalDeeperScan(overrides);
}

// ─── Tests: Guardrails ──────────────────────────────────────────────────────────

describe('sunat-local-deeper-scan — guardrails', () => {
  it('blocks if SUNAT_PERU_LOCAL_SCAN_ACK=YES is missing', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: undefined, VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      const output = await runScan();
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.ackProvided, false);
      assert.ok(output.errors.some((e: string) => e.toLowerCase().includes('ack')));
    });
  });

  it('blocks if Vercel detected', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: '1', NODE_ENV: 'development' }, async () => {
      const output = await runScan();
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.vercelDetected, true);
      assert.ok(output.errors.some((e: string) => e.includes('vercel')));
    });
  });

  it('blocks if production detected', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'production' }, async () => {
      const output = await runScan();
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.productionDetected, true);
      assert.ok(output.errors.some((e: string) => e.includes('production')));
    });
  });

  it('reports environment info correctly', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      const output = await runScan({ downloadIfMissing: false });
      assert.equal(output.environment.localOnly, true);
      assert.equal(output.environment.vercelDetected, false);
      assert.equal(output.environment.productionDetected, false);
      assert.equal(output.environment.ackProvided, true);
    });
  });
});

// ─── Tests: Scan logic ──────────────────────────────────────────────────────────

describe('sunat-local-deeper-scan — scan logic', () => {
  it('finds RUC 20 companies with mock ZIP', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer({
        lines: ['RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO',
                '20100000001|EMPRESA UNO SAC|ACTIVO|HABIDO|150101',
                '20100000002|EMPRESA DOS SAC|ACTIVO|HABIDO|150102'],
      });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false,
        targetCompanyCount: 10,
        maxLinesToScan: 100,
      });

      assert.equal(output.status, 'completed');
      assert.ok(output.scan.companiesFound >= 2);
      assert.equal(output.scan.headerRowsSkipped, 1);
      assert.equal(output.header.detected, true);
      assert.ok(output.scan.firstCompanyLineNumber !== undefined);
      assert.equal(output.recommendation, 'ready_for_candidate_preview_design');
    });
  });

  it('returns completed_no_companies if no RUC 20 found', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer({
        lines: ['RUC|NOMBRE O RAZÓN SOCIAL|ESTADO|CONDICIÓN|UBIGEO',
                '10100000001|PERSONA UNO|ACTIVO|HABIDO|150101',
                '10100000002|PERSONA DOS|ACTIVO|HABIDO|150102'],
      });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 10, maxLinesToScan: 100,
      });

      assert.equal(output.status, 'completed_no_companies');
      assert.equal(output.scan.companiesFound, 0);
      assert.equal(output.scan.naturalPersonsSkipped, 2);
      assert.equal(output.recommendation, 'needs_full_local_snapshot_strategy');
    });
  });

  it('respects targetCompanyCount', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      const lines: string[] = ['RUC|NAME|STATUS|DOM|UBIGEO'];
      for (let i = 1; i <= 50; i++) {
        lines.push(`20${String(i).padStart(9, '0')}|EMPRESA ${i} SAC|ACTIVO|HABIDO|1501${i}`);
      }
      mockState.zipBuffer = buildMockZipBuffer({ lines });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 5, maxLinesToScan: 1000,
      });

      assert.equal(output.scan.companiesFound, 5);
      assert.equal(output.scan.stoppedBecause, 'target_company_count_reached');
      assert.equal(output.sampleCompanies.length, 5);
    });
  });

  it('respects maxLinesToScan', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      const lines: string[] = ['RUC|NAME|STATUS|DOM|UBIGEO'];
      for (let i = 1; i <= 200; i++) {
        lines.push(`20${String(i).padStart(9, '0')}|EMPRESA ${i} SAC|ACTIVO|HABIDO|1501${i}`);
      }
      mockState.zipBuffer = buildMockZipBuffer({ lines });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 200, maxLinesToScan: 10,
      });

      assert.equal(output.scan.linesScanned, 10);
      assert.equal(output.scan.stoppedBecause, 'max_lines_reached');
    });
  });

  it('respects maxDecompressedBytes limit', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      const longName = 'X'.repeat(500);
      const lines: string[] = ['RUC|NAME|STATUS|DOM|UBIGEO'];
      for (let i = 1; i <= 5000; i++) {
        lines.push(`20${String(i).padStart(9, '0')}|${longName} ${i}|ACTIVO|HABIDO|1501${i % 1000}`);
      }
      mockState.zipBuffer = buildMockZipBuffer({ lines });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false,
        targetCompanyCount: 5000,
        maxLinesToScan: 1000000,
        maxDecompressedBytes: 100,
      });

      assert.ok(output.scan.decompressedBytesRead <= 200);
      assert.ok(output.scan.companiesFound < 5000);
    });
  });

  it('reports distributions', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer({
        lines: ['RUC|NAME|STATUS|DOM|UBIGEO|DEPTO',
                '20100000001|E1 SAC|ACTIVO|HABIDO|150101|LIMA',
                '20100000002|E2 SAC|ACTIVO|HABIDO|150102|LIMA',
                '20100000003|E3 SAC|BAJA DEFINITIVA|HABIDO|150103|CALLAO'],
      });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 10, maxLinesToScan: 100,
      });

      assert.ok(output.distributions.taxpayerStatusTop !== undefined);
      assert.ok(output.distributions.taxpayerStatusTop!.length >= 1);
      assert.ok(output.distributions.domicileConditionTop !== undefined);
      assert.ok(output.distributions.departmentTop !== undefined);
    });
  });

  it('reports firstCompanyLineNumber', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer({
        lines: ['RUC|NAME|STATUS|DOM|UBIGEO',
                '10100000001|PERSONA UNO|ACTIVO|HABIDO|150101',
                '20100000001|EMPRESA UNO SAC|ACTIVO|HABIDO|150101'],
      });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 10, maxLinesToScan: 100,
      });

      assert.equal(output.scan.firstCompanyLineNumber, 3);
    });
  });
});

// ─── Tests: Safety ──────────────────────────────────────────────────────────────

describe('sunat-local-deeper-scan — safety', () => {
  it('does not return rawRows/allRows/fullRows', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.existsResult = true;
      mockState.zipBuffer = buildMockZipBuffer({
        lines: ['RUC|NAME|STATUS|DOM|UBIGEO',
                '20100000001|EMPRESA UNO|ACTIVO|HABIDO|150101'],
      });

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 5,
      });
      const out = output as Record<string, unknown>;
      assert.equal('rawRows' in out, false);
      assert.equal('allRows' in out, false);
      assert.equal('fullRows' in out, false);
    });
  });

  it('no Supabase references in function source', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(__dirname, '../sunat-local-deeper-scan.ts');
    const content = await readFile(fullPath, 'utf-8');

    const prohibited = [
      'supabase',
      'prospect_candidates',
      'prospect_batches',
      'SOURCE_DISCOVERY_REGISTRY',
      'source-discovery-preflight',
      'rawRows',
      'allRows',
      'fullRows',
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
        `sunat-local-deeper-scan.ts should not contain "${pattern}"`,
      );
    }
  });

  it('no full TXT file written', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(__dirname, '../sunat-local-deeper-scan.ts');
    const content = await readFile(fullPath, 'utf-8');

    // No debe escribir el TXT completo (writeFile a padron_reducido_ruc.txt)
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('writeFile')) {
        assert.equal(
          line.includes('padron_reducido_ruc.txt'),
          false,
          `Line ${i + 1}: writeFile should not write full TXT file`,
        );
      }
    }
  });

  it('uses .tmp/ for temp files, fs.createWriteStream is not used', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(__dirname, '../sunat-local-deeper-scan.ts');
    const content = await readFile(fullPath, 'utf-8');

    assert.equal(content.includes('createWriteStream'), false);
  });

  it('no reference to registry/preflight/wizard', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(__dirname, '../sunat-local-deeper-scan.ts');
    const content = await readFile(fullPath, 'utf-8');

    assert.equal(content.includes('registry'), false);
    assert.equal(content.includes('preflight'), false);
    assert.equal(content.includes('wizard'), false);
  });
});

// ─── Tests: ZIP download ────────────────────────────────────────────────────────

describe('sunat-local-deeper-scan — zip download', () => {
  it('reuses existing ZIP when downloadIfMissing is false', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.existsResult = true;
      mockState.zipBuffer = buildMockZipBuffer({
        lines: ['RUC|NAME|STATUS|DOM|UBIGEO',
                '20100000001|E1|ACTIVO|HABIDO|150101'],
      });

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 5,
      });

      assert.equal(output.download.attempted, false);
      assert.equal(output.download.reusedExistingFile, true);
      assert.equal(output.download.completed, true);
    });
  });

  it('errors when ZIP missing and downloadIfMissing is false', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.existsResult = false;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 5,
      });

      assert.equal(output.status, 'error');
      assert.ok(output.errors.some((e: string) => e.includes('downloadIfMissing')));
    });
  });
});

// ─── Tests: Header and CIIU ─────────────────────────────────────────────────────

describe('sunat-local-deeper-scan — header and CIIU', () => {
  it('detects header columns', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer({
        lines: ['RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO',
                '20100000001|EMPRESA UNO SAC|ACTIVO|HABIDO|150101'],
      });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 5, maxLinesToScan: 100,
      });

      assert.equal(output.header.detected, true);
      assert.ok(output.header.columns.length > 0);
      assert.equal(output.header.columnCount, 5);
    });
  });

  it('reports CIIU availability based on header', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer({
        lines: ['RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
                '20100000001|EMPRESA UNO SAC|ACTIVO|HABIDO|150101'],
      });
      mockState.existsResult = true;

      const output = await runSunatLocalDeeperScan({
        downloadIfMissing: false, targetCompanyCount: 5, maxLinesToScan: 100,
      });

      assert.equal(output.ciiuAvailability, 'CIIU/sector no disponible en esta fuente.');
    });
  });
});
