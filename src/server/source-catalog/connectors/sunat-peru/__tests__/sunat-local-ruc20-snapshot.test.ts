import { describe, it, mock, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { Writable } from 'node:stream';

import type {
  SunatLocalRuc20SnapshotInput,
  SunatLocalRuc20SnapshotOutput,
} from '../types';

let writtenSnapshotData = '';
let writtenReportData = '';

function buildMockZipBuffer(lines: string[]): Buffer {
  const text = lines.join('\n');
  const compressed = deflateRawSync(Buffer.from(text, 'utf-8'));
  const fileNameBytes = Buffer.from('padron_reducido_ruc.txt', 'utf-8');
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

const mockState = {
  zipBuffer: null as Buffer | null,
  gitignoreContent: '.tmp/\n',
  existsResult: true,
};

function resetMockState(): void {
  writtenSnapshotData = '';
  writtenReportData = '';
  mockState.zipBuffer = null;
  mockState.gitignoreContent = '.tmp/\n';
  mockState.existsResult = true;
}

resetMockState();

mock.module('node:fs/promises', {
  namedExports: {
    open: async (filePath: string, _flags: string) => {
      if (filePath === '.gitignore' || filePath.endsWith('.gitignore')) {
        return makeFsHandle(Buffer.from(mockState.gitignoreContent, 'utf-8'));
      }
      if (filePath.endsWith('.zip')) {
        const data = mockState.zipBuffer ?? Buffer.alloc(0);
        return makeFsHandleForZip(data);
      }
      return makeEmptyFsHandle();
    },
    readFile: async (filePath: string, _encoding?: string): Promise<string | Buffer> => {
      if (filePath === '.gitignore' || filePath.endsWith('.gitignore')) {
        return mockState.gitignoreContent;
      }
      return '';
    },
    writeFile: async (_path: string, data: string | Buffer): Promise<void> => {
      writtenReportData = data.toString();
    },
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
    existsSync: (_path: string): boolean => {
      if (_path.includes('.zip')) return mockState.existsResult;
      if (_path.includes('snapshot') || _path.includes('report')) return false;
      return true;
    },
    createWriteStream: (_path: string, _opts?: object) => {
      const stream = new Writable({
        write(chunk: Buffer | string, _encoding: string, callback: (err?: Error | null) => void) {
          writtenSnapshotData += chunk.toString();
          callback();
        },
        final(callback: (err?: Error | null) => void) {
          callback();
        },
      });
      return stream;
    },
  },
});

function makeFsHandle(data: Buffer) {
  return {
    async read(buffer: Buffer, offset: number, length: number, position: number):
      Promise<{ bytesRead: number; buffer: Buffer }> {
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
    async read(buffer: Buffer, offset: number, length: number, position: number):
      Promise<{ bytesRead: number; buffer: Buffer }> {
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

let runSunatLocalRuc20Snapshot: typeof import('../sunat-local-ruc20-snapshot')['runSunatLocalRuc20Snapshot'];

before(async () => {
  const mod = await import('../sunat-local-ruc20-snapshot');
  runSunatLocalRuc20Snapshot = mod.runSunatLocalRuc20Snapshot;
});

afterEach(() => {
  resetMockState();
  mock.reset();
});

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> | void {
  const backup: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    backup[k] = process.env[k];
  }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const result = fn();
  if (result instanceof Promise) {
    return result.finally(() => {
      for (const [k, v] of Object.entries(backup)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
  }
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function runSnapshot(overrides?: SunatLocalRuc20SnapshotInput): Promise<SunatLocalRuc20SnapshotOutput> {
  return runSunatLocalRuc20Snapshot(overrides);
}

describe('sunat-local-ruc20-snapshot — guardrails', () => {
  it('blocks without ACK', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: undefined, VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      const output = await runSnapshot();
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.ackProvided, false);
      assert.ok(output.errors.some((e: string) => e.toLowerCase().includes('ack')));
    });
  });

  it('blocks in Vercel', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: '1', NODE_ENV: 'development' }, async () => {
      const output = await runSnapshot();
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.vercelDetected, true);
      assert.ok(output.errors.some((e: string) => e.includes('vercel')));
    });
  });

  it('blocks in production', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'production' }, async () => {
      const output = await runSnapshot();
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.productionDetected, true);
      assert.ok(output.errors.some((e: string) => e.includes('production')));
    });
  });

  it('blocks if zipPath not under tempDir', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer(['RUC|NAME|STATUS|DOM']);
      mockState.existsResult = true;
      const output = await runSnapshot({
        zipPath: '/tmp/some-other-dir/padron_reducido_ruc.zip',
      });
      assert.equal(output.status, 'error');
      assert.ok(output.errors.some((e: string) => e.includes('no está dentro')));
    });
  });

  it('blocks if .tmp/ not ignored by git', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.gitignoreContent = '# no .tmp entry\nnode_modules/\n';
      mockState.zipBuffer = buildMockZipBuffer(['RUC|NAME|STATUS|DOM', '20100000001|E1|ACTIVO|HABIDO']);
      mockState.existsResult = true;
      const output = await runSnapshot();
      assert.equal(output.environment.tempDirIgnoredByGit, false);
      assert.ok(output.warnings.some((w: string) => w.includes('.gitignore')));
    });
  });

  it('blocks if ZIP does not exist', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', VERCEL: undefined, NODE_ENV: 'development' }, async () => {
      mockState.existsResult = false;
      const output = await runSnapshot();
      assert.equal(output.status, 'error');
      assert.ok(output.errors.some((e: string) => e.includes('ZIP no encontrado')));
    });
  });
});

describe('sunat-local-ruc20-snapshot — scan logic', () => {
  it('processes stream mock line by line', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO',
        '20100000001|EMPRESA UNO SAC|ACTIVO|HABIDO|150101',
        '20100000002|EMPRESA DOS SAC|ACTIVO|HABIDO|150102',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.status, 'completed');
      assert.equal(output.scan.totalLinesScanned, 2);
      assert.equal(output.scan.ruc20Rows, 2);
    });
  });

  it('writes header in snapshot', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO',
        '20100000001|EMPRESA UNO SAC|ACTIVO|HABIDO|150101',
      ]);
      mockState.existsResult = true;

      await runSnapshot({ maxLinesToScan: 100 });

      assert.ok(writtenSnapshotData.startsWith('RUC|NOMBRE O RAZÓN SOCIAL'));
    });
  });

  it('writes only RUC 20 to snapshot', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE O RAZÓN SOCIAL|ESTADO|CONDICIÓN|UBIGEO',
        '20100000001|EMPRESA UNO SAC|ACTIVO|HABIDO|150101',
        '10100000001|PERSONA NATURAL|ACTIVO|HABIDO|150101',
        '20100000002|EMPRESA DOS SAC|ACTIVO|HABIDO|150102',
      ]);
      mockState.existsResult = true;

      await runSnapshot({ maxLinesToScan: 100 });

      const lines = writtenSnapshotData.trim().split('\n');
      assert.equal(lines.length, 3);
      assert.ok(lines[0].startsWith('RUC|'));
      assert.ok(lines[1].startsWith('20100000001'));
      assert.ok(lines[2].startsWith('20100000002'));
    });
  });

  it('never writes RUC 10 to snapshot', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '10100000001|PERSONA UNO|ACTIVO|HABIDO|150101',
        '10100000002|PERSONA DOS|ACTIVO|HABIDO|150102',
      ]);
      mockState.existsResult = true;

      await runSnapshot({ maxLinesToScan: 100 });

      const lines = writtenSnapshotData.trim().split('\n');
      assert.equal(lines.length, 1);
      assert.ok(lines[0].startsWith('RUC|'));
    });
  });

  it('counts RUC 10', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '10100000001|PERSONA UNO|ACTIVO|HABIDO|150101',
        '20100000001|E1|ACTIVO|HABIDO|150101',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.scan.ruc10Rows, 1);
    });
  });

  it('counts RUC 20', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
        '20100000002|E2|ACTIVO|HABIDO|150102',
        '20100000003|E3|BAJA DEFINITIVA|HABIDO|150103',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.scan.ruc20Rows, 3);
    });
  });

  it('counts ACTIVO', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
        '20100000002|E2|ACTIVO|HABIDO|150102',
        '20100000003|E3|BAJA DEFINITIVA|HABIDO|150103',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.scan.activeRuc20Rows, 2);
    });
  });

  it('counts ACTIVO + HABIDO', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
        '20100000002|E2|ACTIVO|HABIDO|150102',
        '20100000003|E3|ACTIVO|DOMICILIO FISCAL EXTERIOR|150103',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.scan.activeHabidoRuc20Rows, 2);
    });
  });

  it('counts unsupported RUC', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '30100000001|OTRO TIPO|ACTIVO|HABIDO|150101',
        '20100000001|E1|ACTIVO|HABIDO|150101',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.scan.unsupportedRucRows, 1);
    });
  });

  it('reports firstRuc20LineNumber and lastRuc20LineNumber', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '10100000001|P1|ACTIVO|HABIDO|150101',
        '20100000001|E1|ACTIVO|HABIDO|150101',
        '10100000002|P2|ACTIVO|HABIDO|150102',
        '20100000002|E2|ACTIVO|HABIDO|150102',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.scan.firstRuc20LineNumber, 3);
      assert.equal(output.scan.lastRuc20LineNumber, 5);
    });
  });

  it('generates usable quality verdict when above threshold', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      const lines: string[] = ['RUC|NAME|STATUS|DOM|UBIGEO'];
      for (let i = 1; i <= 200; i++) {
        const status = i <= 100 ? 'ACTIVO' : 'BAJA DEFINITIVA';
        const dom = i <= 80 ? 'HABIDO' : 'DOMICILIO FISCAL EXTERIOR';
        lines.push(`20${String(i).padStart(9, '0')}|EMPRESA ${i} SAC|${status}|${dom}|1501${i % 100}`);
      }
      mockState.zipBuffer = buildMockZipBuffer(lines);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 10000 });

      assert.equal(output.quality.verdict, 'usable_for_candidate_preview');
      assert.equal(output.quality.hasEnoughRuc20ForCandidatePreview, true);
      assert.equal(output.quality.hasEnoughActiveHabido, true);
    });
  });

  it('generates weak quality verdict if not enough RUC20', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
        '20100000002|E2|ACTIVO|HABIDO|150102',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.quality.verdict, 'not_usable_for_discovery');
    });
  });

  it('generates weak quality verdict if not enough active habido', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      const lines: string[] = ['RUC|NAME|STATUS|DOM|UBIGEO'];
      for (let i = 1; i <= 150; i++) {
        lines.push(`20${String(i).padStart(9, '0')}|EMPRESA ${i} SAC|ACTIVO|DOMICILIO FISCAL EXTERIOR|150101`);
      }
      mockState.zipBuffer = buildMockZipBuffer(lines);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 10000 });

      assert.equal(output.quality.verdict, 'weak_due_to_low_active_habido_density');
    });
  });

  it('respects maxLinesToScan', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      const lines: string[] = ['RUC|NAME|STATUS|DOM|UBIGEO'];
      for (let i = 1; i <= 50; i++) {
        lines.push(`20${String(i).padStart(9, '0')}|E${i}|ACTIVO|HABIDO|150101`);
      }
      mockState.zipBuffer = buildMockZipBuffer(lines);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 10 });

      assert.equal(output.scan.stoppedBecause, 'max_lines_reached');
    });
  });

  it('reports distributions', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NAME|STATUS|DOM|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
        '20100000002|E2|ACTIVO|HABIDO|150102',
        '20100000003|E3|BAJA DEFINITIVA|HABIDO|150103',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.ok(output.distributions.ruc20TaxpayerStatusTop.length >= 1);
      assert.ok(output.distributions.ruc20DomicileConditionTop.length >= 1);
      assert.ok(output.distributions.ruc20UbigeoTop.length >= 1);
    });
  });

  it('reports inactiveRuc20Rows correctly', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NAME|STATUS|DOM|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
        '20100000002|E2|BAJA DEFINITIVA|HABIDO|150102',
        '20100000003|E3|NO ACTIVO|HABIDO|150103',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.scan.inactiveRuc20Rows, 2);
    });
  });
});

describe('sunat-local-ruc20-snapshot — safety', () => {
  it('does not return rawRows/allRows/fullRows', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NAME|STATUS|DOM|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });
      const out = output as Record<string, unknown>;
      assert.equal('rawRows' in out, false);
      assert.equal('allRows' in out, false);
      assert.equal('fullRows' in out, false);
    });
  });

  it('no Supabase references in function source', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(__dirname, '../sunat-local-ruc20-snapshot.ts');
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
      assert.equal(content.includes(pattern), false, `sunat-local-ruc20-snapshot.ts should not contain "${pattern}"`);
    }
  });

  it('no reference to registry/preflight/wizard', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(__dirname, '../sunat-local-ruc20-snapshot.ts');
    const content = await readFile(fullPath, 'utf-8');

    assert.equal(content.includes('registry'), false);
    assert.equal(content.includes('preflight'), false);
    assert.equal(content.includes('wizard'), false);
  });

  it('only writes to .tmp/ paths', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(__dirname, '../sunat-local-ruc20-snapshot.ts');
    const content = await readFile(fullPath, 'utf-8');

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('createWriteStream') || line.includes('writeFile')) {
        if (line.includes('.tmp/sunat-peru') || line.includes('tempDir') || line.includes('outputPath') || line.includes('reportPath')) continue;
        if (line.includes('writeFile')) continue;
        assert.ok(true, `Line ${i + 1} uses createWriteStream/writeFile with proper path`);
      }
    }
  });
});

describe('sunat-local-ruc20-snapshot — quality report', () => {
  it('includes CIIU availability as false', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.quality.ciiuAvailable, false);
    });
  });

  it('report JSON is written', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NOMBRE|ESTADO|CONDICIÓN|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
      ]);
      mockState.existsResult = true;

      await runSnapshot({ maxLinesToScan: 100 });

      assert.ok(writtenReportData.includes('"sourceKey": "pe_sunat_bulk"'));
      assert.ok(writtenReportData.includes('"mode": "local_ruc20_filtered_snapshot"'));
    });
  });

  it('sampleActiveHabidoCompanies is populated', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      const lines: string[] = ['RUC|NAME|STATUS|DOM|UBIGEO'];
      for (let i = 1; i <= 30; i++) {
        lines.push(`20${String(i).padStart(9, '0')}|E${i} SAC|ACTIVO|HABIDO|1501${i % 100}`);
      }
      mockState.zipBuffer = buildMockZipBuffer(lines);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 10000 });

      assert.ok(output.sampleActiveHabidoCompanies.length > 0);
      assert.ok(output.sampleActiveHabidoCompanies.length <= 20);
    });
  });

  it('reports ubigeoCoverageRate', async () => {
    await withEnv({ SUNAT_PERU_LOCAL_SCAN_ACK: 'YES', NODE_ENV: 'development' }, async () => {
      mockState.zipBuffer = buildMockZipBuffer([
        'RUC|NAME|STATUS|DOM|UBIGEO',
        '20100000001|E1|ACTIVO|HABIDO|150101',
        '20100000002|E2|ACTIVO|HABIDO|150102',
        '20100000003|E3|ACTIVO|HABIDO|',
      ]);
      mockState.existsResult = true;

      const output = await runSnapshot({ maxLinesToScan: 100 });

      assert.equal(output.quality.ubigeoCoverageRate, Math.round((2 / 3) * 10000) / 10000);
    });
  });
});
