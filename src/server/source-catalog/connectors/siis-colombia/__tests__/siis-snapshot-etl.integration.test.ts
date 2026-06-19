/**
 * Integration tests — SIIS Snapshot ETL dry-run vs commit flow.
 *
 * Uses mock.module (Node experimental) to intercept @supabase/supabase-js
 * and siis-client BEFORE the ETL module is dynamically imported.
 *
 * IMPORTANT: require --experimental-test-module-mocks flag at runtime.
 */
import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExcelBuffer(
  headers: string[],
  rows: unknown[][],
): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SIIS');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const fakeHeaders = ['NIT', 'RAZÓN SOCIAL', 'INGRESOS OPERACIONALES 2024'];
const fakeRows: unknown[][] = [
  ['900.123.456-1', 'Tecnología Avanzada SAS', '1.234.567.000'],
  ['800.987.654-5', 'Construcciones del Sur SAS', '5.000.000.000'],
  ['700.111.222-3', 'Comercio Nacional LTDA', '200.000.000'],
];
const fakeBuffer = makeExcelBuffer(fakeHeaders, fakeRows);

const emptyBuffer = makeExcelBuffer(['NIT', 'RAZÓN SOCIAL'], []);

// ─── Module-scoped mock buffer (mutated before each test) ──────────────────────

let mockBuffer = fakeBuffer;

before(() => {
  mock.module('@supabase/supabase-js', {
    namedExports: {
      createClient: () => {
        const fakeSb = {
          from: () => ({
            insert: () => ({
              select: () => ({
                single: () => ({ data: { id: 'mock-run-id' }, error: null }),
              }),
            }),
            upsert: () => ({ error: null }),
            update: () => ({ eq: () => Promise.resolve() }),
          }),
        };
        return fakeSb;
      },
    },
  });

  mock.module('../siis-client', {
    namedExports: {
      downloadSiisExcel: async () => ({
        ok: true,
        buffer: mockBuffer,
      }),
      SIIS_CONFIRMED_YEARS: [2024, 2023, 2022],
    },
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runSiisSnapshotEtl (dry-run flow)', () => {

  it('does not call createClient / getAdminSupabase', async () => {
    mockBuffer = fakeBuffer;
    const { runSiisSnapshotEtl } = await import('../siis-snapshot-etl');
    const result = await runSiisSnapshotEtl(2024, 1000, { dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.recordsFound, 3);
    assert.equal(result.recordsUpserted, 0);
    assert.equal(result.runId, undefined);
  });

  it('does not require SUPABASE_SERVICE_ROLE_KEY', async () => {
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    mockBuffer = fakeBuffer;
    const { runSiisSnapshotEtl } = await import('../siis-snapshot-etl');
    const result = await runSiisSnapshotEtl(2024, 1000, { dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.recordsFound, 3);
    assert.equal(result.recordsUpserted, 0);
    assert.equal(result.errors.length, 0);

    if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
  });

  it('returns parser counts', async () => {
    mockBuffer = fakeBuffer;
    const { runSiisSnapshotEtl } = await import('../siis-snapshot-etl');
    const result = await runSiisSnapshotEtl(2024, 1000, { dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.recordsFound, 3);
    assert.equal(result.recordsUpserted, 0);
  });

  it('with empty rows returns zero records', async () => {
    mockBuffer = emptyBuffer;
    const { runSiisSnapshotEtl } = await import('../siis-snapshot-etl');
    const result = await runSiisSnapshotEtl(2024, 1000, { dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.recordsFound, 0);
  });
});

describe('runSiisSnapshotEtl (commit flow)', () => {

  it('throws with clear message if SUPABASE_SERVICE_ROLE_KEY missing', async () => {
    mockBuffer = fakeBuffer;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { runSiisSnapshotEtl } = await import('../siis-snapshot-etl');
    try {
      await runSiisSnapshotEtl(2024, 1000, { dryRun: false });
      assert.fail('Expected getAdminSupabase to throw');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      assert.ok(
        msg.includes('SUPABASE_SERVICE_ROLE_KEY'),
        `Expected error about missing SUPABASE_SERVICE_ROLE_KEY, got: ${msg}`,
      );
    }

    if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
  });

  it('does not throw when SUPABASE_SERVICE_ROLE_KEY is set', async () => {
    mockBuffer = fakeBuffer;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-for-test';

    const { runSiisSnapshotEtl } = await import('../siis-snapshot-etl');
    const result = await runSiisSnapshotEtl(2024, 1000, { dryRun: false });

    assert.equal(result.ok, true);
    assert.equal(result.recordsFound, 3);

    if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
});
