/**
 * Perú.5B-0 — SUNAT Snapshot Importer Tests
 *
 * Tests for import-peru-sunat-snapshot.ts
 * Pure unit tests — no Supabase connection, no filesystem reads.
 *
 * GUARDRAILS VERIFIED:
 * - No padron_reducido_ruc.zip reference
 * - No fetch to SUNAT
 * - No unzip / inflate
 * - No MIGO_API_KEY
 * - No Tavily
 * - No prospect_candidates.insert
 * - No prospect_batches.insert
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseSnapshotLine,
  parseCliArgs,
  validateConfig,
  assertNotVercel,
  type ParsedSnapshotRow,
} from '../import-peru-sunat-snapshot';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

const IMPORTER_FILE = join(__dir, '..', 'import-peru-sunat-snapshot.ts');

// ── Fixture ────────────────────────────────────────────────────

const LOADED_AT = '2026-06-25T00:00:00.000Z';
const SNAPSHOT_PERIOD = '2026-06-23';

function validRow(overrides: Partial<Record<string, string>> = {}): string {
  const cols = {
    ruc: '20186226292',
    legalName: 'CEIP CAPERUCITA ROJA',
    taxpayerStatus: 'ACTIVO',
    domicileCondition: 'HABIDO',
    ubigeo: '150101',
    tipoVia: 'AV',
    nombreVia: 'JAVIER PRADO',
    codZona: '-',
    tipoZona: '-',
    numero: '1234',
    interior: '-',
    lote: '-',
    departamento: '-',
    manzana: '-',
    kilometro: '-',
    ...overrides,
  };
  return [
    cols.ruc,
    cols.legalName,
    cols.taxpayerStatus,
    cols.domicileCondition,
    cols.ubigeo,
    cols.tipoVia,
    cols.nombreVia,
    cols.codZona,
    cols.tipoZona,
    cols.numero,
    cols.interior,
    cols.lote,
    cols.departamento,
    cols.manzana,
    cols.kilometro,
  ].join('|');
}

// ── Parser tests ───────────────────────────────────────────────

describe('parseSnapshotLine', () => {
  it('accepts a valid row', () => {
    const line = validRow();
    const { row, error } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(error, null);
    assert.ok(row);
    assert.equal(row.ruc, '20186226292');
    assert.equal(row.legal_name, 'CEIP CAPERUCITA ROJA');
    assert.equal(row.source_key, 'pe_sunat_bulk');
    assert.equal(row.snapshot_period, SNAPSHOT_PERIOD);
    assert.equal(row.snapshot_loaded_at, LOADED_AT);
  });

  it('rejects invalid RUC — too short', () => {
    const line = validRow({ ruc: '2018622' });
    const { row, error } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row, null);
    assert.ok(error?.startsWith('invalid_ruc:'));
  });

  it('rejects invalid RUC — letters present', () => {
    const line = validRow({ ruc: '2018ABCD292' });
    const { row, error } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row, null);
    assert.ok(error?.startsWith('invalid_ruc:'));
  });

  it('rejects empty legal_name', () => {
    const line = validRow({ legalName: '' });
    const { row, error } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row, null);
    assert.ok(error?.startsWith('empty_legal_name:'));
  });

  it('rejects dash-only legal_name', () => {
    const line = validRow({ legalName: '-' });
    const { row, error } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row, null);
    assert.ok(error?.startsWith('empty_legal_name:'));
  });

  it('is_active is true when estado is ACTIVO', () => {
    const line = validRow({ taxpayerStatus: 'ACTIVO' });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.is_active, true);
  });

  it('is_active is false when estado is BAJA DE OFICIO', () => {
    const line = validRow({ taxpayerStatus: 'BAJA DE OFICIO' });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.is_active, false);
  });

  it('is_active is false when estado is BAJA DEFINITIVA', () => {
    const line = validRow({ taxpayerStatus: 'BAJA DEFINITIVA' });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.is_active, false);
  });

  it('is_active is false when estado is SUSPENSION TEMPORAL', () => {
    const line = validRow({ taxpayerStatus: 'SUSPENSION TEMPORAL' });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.is_active, false);
  });

  it('is_habido is true when condicion is HABIDO', () => {
    const line = validRow({ domicileCondition: 'HABIDO' });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.is_habido, true);
  });

  it('is_habido is false when condicion is NO HABIDO', () => {
    const line = validRow({ domicileCondition: 'NO HABIDO' });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.is_habido, false);
  });

  it('is_habido is false when condicion is NO HALLADO DESTINATA', () => {
    const line = validRow({ domicileCondition: 'NO HALLADO DESTINATA' });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.is_habido, false);
  });

  it('raw_line_hash is stable for same input', () => {
    const line = validRow();
    const { row: row1 } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    const { row: row2 } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row1?.raw_line_hash, row2?.raw_line_hash);
  });

  it('raw_line_hash differs for different inputs', () => {
    const line1 = validRow({ ruc: '20186226292' });
    const line2 = validRow({ ruc: '20148029246' });
    const { row: row1 } = parseSnapshotLine(line1, SNAPSHOT_PERIOD, LOADED_AT);
    const { row: row2 } = parseSnapshotLine(line2, SNAPSHOT_PERIOD, LOADED_AT);
    assert.notEqual(row1?.raw_line_hash, row2?.raw_line_hash);
  });

  it('department and province and district are null (not in this snapshot)', () => {
    const line = validRow();
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.department, null);
    assert.equal(row?.province, null);
    assert.equal(row?.district, null);
  });

  it('address is built from non-dash address columns', () => {
    const line = validRow({ tipoVia: 'AV', nombreVia: 'JAVIER PRADO', numero: '1234' });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.ok(row?.address?.includes('AV'));
    assert.ok(row?.address?.includes('JAVIER PRADO'));
  });

  it('address is null when all address columns are dashes', () => {
    const line = validRow({
      tipoVia: '-', nombreVia: '-', codZona: '-', tipoZona: '-',
      numero: '-', interior: '-', lote: '-', departamento: '-',
      manzana: '-', kilometro: '-',
    });
    const { row } = parseSnapshotLine(line, SNAPSHOT_PERIOD, LOADED_AT);
    assert.equal(row?.address, null);
  });
});

// ── CLI config tests ───────────────────────────────────────────

describe('parseCliArgs', () => {
  it('defaults to dry-run when no --apply provided', () => {
    const config = parseCliArgs(['node', 'script.ts', '--limit', '100']);
    assert.equal(config.dryRun, true);
    assert.equal(config.apply, false);
  });

  it('sets apply=true when --apply is provided', () => {
    const config = parseCliArgs(['node', 'script.ts', '--apply', '--limit', '50']);
    assert.equal(config.apply, true);
    assert.equal(config.dryRun, false);
  });

  it('parses --limit correctly', () => {
    const config = parseCliArgs(['node', 'script.ts', '--apply', '--limit', '200']);
    assert.equal(config.limit, 200);
  });

  it('limit is null when not provided', () => {
    const config = parseCliArgs(['node', 'script.ts', '--dry-run']);
    assert.equal(config.limit, null);
  });
});

describe('validateConfig', () => {
  it('dry-run without limit is valid', () => {
    assert.doesNotThrow(() =>
      validateConfig({ snapshotPath: 'x.txt', dryRun: true, apply: false, limit: null }),
    );
  });

  it('dry-run with limit is valid', () => {
    assert.doesNotThrow(() =>
      validateConfig({ snapshotPath: 'x.txt', dryRun: true, apply: false, limit: 100 }),
    );
  });

  it('--apply without --limit throws', () => {
    assert.throws(
      () =>
        validateConfig({ snapshotPath: 'x.txt', dryRun: false, apply: true, limit: null }),
      /config_invalid.*--apply requires --limit/,
    );
  });

  it('--limit > 1000 throws', () => {
    assert.throws(
      () =>
        validateConfig({ snapshotPath: 'x.txt', dryRun: false, apply: true, limit: 1001 }),
      /config_invalid.*exceeds maximum/,
    );
  });

  it('--limit = 1000 is valid', () => {
    assert.doesNotThrow(() =>
      validateConfig({ snapshotPath: 'x.txt', dryRun: false, apply: true, limit: 1000 }),
    );
  });

  it('--limit = 0 throws', () => {
    assert.throws(
      () =>
        validateConfig({ snapshotPath: 'x.txt', dryRun: false, apply: true, limit: 0 }),
      /config_invalid.*positive integer/,
    );
  });
});

// ── Vercel guard tests ─────────────────────────────────────────

describe('assertNotVercel', () => {
  it('passes in normal environment', () => {
    delete process.env.VERCEL;
    delete process.env.NEXT_RUNTIME;
    assert.doesNotThrow(() => assertNotVercel());
  });

  it('throws when VERCEL env var is set', () => {
    process.env.VERCEL = '1';
    try {
      assert.throws(
        () => assertNotVercel(),
        /importer_vercel_blocked/,
      );
    } finally {
      delete process.env.VERCEL;
    }
  });

  it('throws when NEXT_RUNTIME env var is set', () => {
    process.env.NEXT_RUNTIME = 'edge';
    try {
      assert.throws(
        () => assertNotVercel(),
        /importer_vercel_blocked/,
      );
    } finally {
      delete process.env.NEXT_RUNTIME;
    }
  });
});

// ── Source guardrail tests (static analysis via file content) ──

describe('Guardrail: forbidden references in importer source', () => {
  let source: string;

  before(() => {
    source = readFileSync(IMPORTER_FILE, 'utf-8');
  });

  it('does not reference padron_reducido_ruc.zip', () => {
    assert.ok(
      !source.includes('padron_reducido_ruc.zip'),
      'Must not reference the SUNAT zip filename',
    );
  });

  it('does not contain fetch calls to SUNAT endpoints', () => {
    assert.ok(
      !source.includes('sunat.gob.pe'),
      'Must not fetch from SUNAT',
    );
  });

  it('does not reference unzip or inflate', () => {
    assert.ok(!source.includes('unzip'), 'Must not unzip');
    assert.ok(!source.includes('inflate'), 'Must not inflate');
    assert.ok(!source.includes('createUnzip'), 'Must not use createUnzip');
  });

  it('does not reference MIGO_API_KEY', () => {
    assert.ok(!source.includes('MIGO_API_KEY'), 'Must not use Migo');
  });

  it('does not reference Tavily', () => {
    assert.ok(
      !source.includes('tavily') && !source.includes('TAVILY'),
      'Must not use Tavily',
    );
  });

  it('does not insert into prospect_candidates', () => {
    // Checks for .from('prospect_candidates') functional usage, not comment mentions
    assert.ok(
      !source.includes('.from(\'prospect_candidates\')'),
      'Must not write to prospect_candidates table',
    );
  });

  it('does not insert into prospect_batches', () => {
    // Checks for .from('prospect_batches') functional usage, not comment mentions
    assert.ok(
      !source.includes('.from(\'prospect_batches\')'),
      'Must not write to prospect_batches table',
    );
  });
});

// ── package.json script exists ─────────────────────────────────

describe('package.json script', () => {
  it('sunat:peru:import-snapshot script exists', () => {
    const pkgPath = join(__dir, '..', '..', '..', '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts: Record<string, string> };
    assert.ok(
      'sunat:peru:import-snapshot' in pkg.scripts,
      'sunat:peru:import-snapshot script must exist in package.json',
    );
    assert.ok(
      pkg.scripts['sunat:peru:import-snapshot'].includes('import-peru-sunat-snapshot'),
      'script must reference import-peru-sunat-snapshot',
    );
  });

  it('test:sunat-peru-5b script exists', () => {
    const pkgPath = join(__dir, '..', '..', '..', '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts: Record<string, string> };
    assert.ok(
      'test:sunat-peru-5b' in pkg.scripts,
      'test:sunat-peru-5b script must exist in package.json',
    );
  });
});
