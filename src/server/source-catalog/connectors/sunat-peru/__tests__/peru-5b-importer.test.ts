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

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  parseSnapshotLine,
  parseCliArgs,
  parseStrictNonNegativeIntegerArg,
  validateConfig,
  assertNotVercel,
  runImporter,
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

  it('offset defaults to 0 when --offset not provided', () => {
    const config = parseCliArgs(['node', 'script.ts', '--limit', '100']);
    assert.equal(config.offset, 0);
  });

  it('parses --offset correctly', () => {
    const config = parseCliArgs(['node', 'script.ts', '--offset', '1000', '--limit', '100']);
    assert.equal(config.offset, 1000);
  });

  it('parses large plain --offset correctly', () => {
    const config = parseCliArgs(['node', 'script.ts', '--offset', '1250000', '--limit', '1000']);
    assert.equal(config.offset, 1250000);
  });

  // Perú.9I.1 — strict rejection of ambiguous offsets in parseCliArgs
  it('throws on scientific-notation --offset (1e+06)', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script.ts', '--offset', '1e+06', '--limit', '1000']),
      /Invalid --offset: expected a plain non-negative integer, received "1e\+06"/,
    );
  });

  it('throws on scientific-notation --offset (1.001e+06)', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script.ts', '--offset', '1.001e+06', '--limit', '1000']),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  it('throws on non-numeric --offset (abc)', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script.ts', '--offset', 'abc', '--limit', '100']),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  it('throws on scientific-notation --limit (1e+06)', () => {
    assert.throws(
      () => parseCliArgs(['node', 'script.ts', '--limit', '1e+06']),
      /Invalid --limit: expected a plain non-negative integer/,
    );
  });
});

// ── Perú.9I.1 strict integer parsing ───────────────────────────

describe('parseStrictNonNegativeIntegerArg', () => {
  // Accepted values
  it('accepts "0"', () => {
    assert.equal(parseStrictNonNegativeIntegerArg('0', '--offset'), 0);
  });

  it('accepts "1000"', () => {
    assert.equal(parseStrictNonNegativeIntegerArg('1000', '--offset'), 1000);
  });

  it('accepts "1250000"', () => {
    assert.equal(parseStrictNonNegativeIntegerArg('1250000', '--offset'), 1250000);
  });

  // Rejected values — the exact incident inputs
  it('rejects "1e+06" (scientific notation)', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg('1e+06', '--offset'),
      /Invalid --offset: expected a plain non-negative integer, received "1e\+06"/,
    );
  });

  it('rejects "1.001e+06" (scientific notation)', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg('1.001e+06', '--offset'),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  it('rejects "1000.5" (decimal)', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg('1000.5', '--offset'),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  it('rejects "-1" (negative)', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg('-1', '--offset'),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  it('rejects "abc" (non-numeric)', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg('abc', '--offset'),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  it('rejects "" (empty string)', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg('', '--offset'),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  it('rejects whitespace-padded " 1000 "', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg(' 1000 ', '--offset'),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  it('rejects unsafe integers beyond MAX_SAFE_INTEGER', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg('99999999999999999999', '--offset'),
      /Invalid --offset: expected a plain non-negative integer/,
    );
  });

  // Same rules apply to --limit
  it('applies the same rules to --limit (accepts "1000")', () => {
    assert.equal(parseStrictNonNegativeIntegerArg('1000', '--limit'), 1000);
  });

  it('applies the same rules to --limit (rejects "1e+06")', () => {
    assert.throws(
      () => parseStrictNonNegativeIntegerArg('1e+06', '--limit'),
      /Invalid --limit: expected a plain non-negative integer/,
    );
  });
});

describe('validateConfig', () => {
  it('dry-run without limit is valid', () => {
    assert.doesNotThrow(() =>
      validateConfig({ snapshotPath: 'x.txt', dryRun: true, apply: false, limit: null, offset: 0 }),
    );
  });

  it('dry-run with limit is valid', () => {
    assert.doesNotThrow(() =>
      validateConfig({ snapshotPath: 'x.txt', dryRun: true, apply: false, limit: 100, offset: 0 }),
    );
  });

  it('--apply without --limit throws', () => {
    assert.throws(
      () =>
        validateConfig({ snapshotPath: 'x.txt', dryRun: false, apply: true, limit: null, offset: 0 }),
      /config_invalid.*--apply requires --limit/,
    );
  });

  it('--limit > 1000 throws', () => {
    assert.throws(
      () =>
        validateConfig({ snapshotPath: 'x.txt', dryRun: false, apply: true, limit: 1001, offset: 0 }),
      /config_invalid.*exceeds maximum/,
    );
  });

  it('--limit = 1000 is valid', () => {
    assert.doesNotThrow(() =>
      validateConfig({ snapshotPath: 'x.txt', dryRun: false, apply: true, limit: 1000, offset: 0 }),
    );
  });

  it('--limit = 0 throws', () => {
    assert.throws(
      () =>
        validateConfig({ snapshotPath: 'x.txt', dryRun: false, apply: true, limit: 0, offset: 0 }),
      /config_invalid.*positive integer/,
    );
  });

  it('--offset = 0 is valid', () => {
    assert.doesNotThrow(() =>
      validateConfig({ snapshotPath: 'x.txt', dryRun: true, apply: false, limit: null, offset: 0 }),
    );
  });

  it('--offset positive integer is valid', () => {
    assert.doesNotThrow(() =>
      validateConfig({ snapshotPath: 'x.txt', dryRun: true, apply: false, limit: null, offset: 1000 }),
    );
  });

  it('--offset negative throws', () => {
    assert.throws(
      () =>
        validateConfig({ snapshotPath: 'x.txt', dryRun: true, apply: false, limit: null, offset: -1 }),
      /config_invalid.*non-negative integer/,
    );
  });

  it('--offset NaN throws', () => {
    assert.throws(
      () =>
        validateConfig({ snapshotPath: 'x.txt', dryRun: true, apply: false, limit: null, offset: NaN }),
      /config_invalid.*non-negative integer/,
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

  // Perú.9I.1 — explicit guardrails for the hardening hito.
  // NOTE: Migo/SUNAT/Tavily/LLM appear in this test file only as negation
  // strings; they must NOT appear as live calls in the importer source.
  it('does not call Migo web (api.migo.pe)', () => {
    assert.ok(!source.includes('api.migo.pe'), 'Must not call Migo web');
  });

  it('does not call SUNAT web (www2.sunat)', () => {
    assert.ok(!source.includes('www2.sunat'), 'Must not call SUNAT web');
  });

  it('does not call an LLM provider', () => {
    assert.ok(!source.includes('openai'), 'Must not call OpenAI');
    assert.ok(!source.includes('anthropic'), 'Must not call Anthropic');
    assert.ok(!source.includes('Authorization: Bearer'), 'Must not send bearer auth');
  });

  it('does not create accounts / candidates / batches', () => {
    assert.ok(!source.includes('.from(\'accounts\')'), 'Must not write accounts');
    assert.ok(
      !source.includes('.from(\'contact_enrichment_candidates\')'),
      'Must not write contact_enrichment_candidates',
    );
    assert.ok(
      !source.includes('raw_payload') && !source.includes('rawPayload'),
      'Must not persist raw Migo/SUNAT payloads',
    );
  });

  it('only upserts into the SUNAT snapshot table', () => {
    // The single write target in the importer is peru_sunat_ruc_snapshot.
    assert.ok(
      source.includes('.from(SNAPSHOT_TABLE)'),
      'Must upsert into the snapshot table',
    );
  });

  it('does not apply lenient parseInt to offset/limit (Perú.9I.1)', () => {
    // parseInt is named only in the explanatory JSDoc, never applied to the
    // numeric CLI args — those now go through parseStrictNonNegativeIntegerArg.
    assert.ok(
      !/parseInt\s*\([^)]*(offset|limit)/i.test(source),
      'Must not parseInt(offset/limit) — use parseStrictNonNegativeIntegerArg',
    );
    assert.ok(
      source.includes('parseStrictNonNegativeIntegerArg'),
      'Must use the strict integer parser for CLI numeric args',
    );
  });
});

// ── runImporter offset tests ───────────────────────────────────

function buildSnapshotFile(rowCount: number): string {
  const dir = mkdtempSync(`${tmpdir()}/sunat-test-`);
  const filePath = `${dir}/snapshot.txt`;
  const lines: string[] = ['RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|TIPO DE VÍA|NOMBRE DE VÍA|CÓDIGO DE ZONA|TIPO DE ZONA|NÚMERO|INTERIOR|LOTE|DEPARTAMENTO|MANZANA|KILÓMETRO'];
  for (let i = 0; i < rowCount; i++) {
    // Generate unique 11-digit RUCs starting at 20100000001
    const ruc = String(20100000001 + i);
    lines.push(`${ruc}|EMPRESA ${i + 1}|ACTIVO|HABIDO|150101|AV|LIMA|-|-|${i + 1}|-|-|-|-|-`);
  }
  writeFileSync(filePath, lines.join('\n'), { encoding: 'latin1' });
  return filePath;
}

describe('runImporter — offset behavior', () => {
  let snapshotPath: string;
  let snapshotDir: string;

  before(() => {
    snapshotPath = buildSnapshotFile(2000);
    snapshotDir = snapshotPath.replace('/snapshot.txt', '');
  });

  after(() => {
    rmSync(snapshotDir, { recursive: true, force: true });
  });

  it('offset defaults to 0: rowsSkippedByOffset = 0 when offset not set', async () => {
    const report = await runImporter({
      snapshotPath,
      dryRun: true,
      apply: false,
      limit: 10,
      offset: 0,
    });
    assert.equal(report.offset, 0);
    assert.equal(report.rowsSkippedByOffset, 0);
    assert.equal(report.rowsParsed, 10);
  });

  it('offset 1000: rowsSkippedByOffset = 1000, rowsParsed = 1000', async () => {
    const report = await runImporter({
      snapshotPath,
      dryRun: true,
      apply: false,
      limit: 1000,
      offset: 1000,
    });
    assert.equal(report.offset, 1000);
    assert.equal(report.rowsSkippedByOffset, 1000);
    assert.equal(report.rowsParsed, 1000);
    assert.equal(report.rowsSeen, 2000);
  });

  it('rowsSeen = rowsSkippedByOffset + rowsParsed', async () => {
    const report = await runImporter({
      snapshotPath,
      dryRun: true,
      apply: false,
      limit: 500,
      offset: 300,
    });
    assert.equal(report.rowsSeen, report.rowsSkippedByOffset + report.rowsParsed);
    assert.equal(report.rowsSkippedByOffset, 300);
    assert.equal(report.rowsParsed, 500);
  });

  it('dry-run with offset: rowsUpserted = 0 (no writes)', async () => {
    const report = await runImporter({
      snapshotPath,
      dryRun: true,
      apply: false,
      limit: 100,
      offset: 100,
    });
    assert.equal(report.rowsUpserted, 0);
    assert.equal(report.dryRun, true);
    assert.equal(report.applied, false);
  });

  it('offset larger than total valid rows: rowsParsed = 0', async () => {
    const smallPath = buildSnapshotFile(5);
    try {
      const report = await runImporter({
        snapshotPath: smallPath,
        dryRun: true,
        apply: false,
        limit: 100,
        offset: 100,
      });
      assert.equal(report.rowsParsed, 0);
      assert.equal(report.rowsSkippedByOffset, 5);
    } finally {
      rmSync(smallPath.replace('/snapshot.txt', ''), { recursive: true, force: true });
    }
  });

  it('does not load entire file into memory (uses streaming readline)', () => {
    // Verify no Array.from(lines) or readFileSync in importer source — streaming confirmed by source analysis
    const source = readFileSync(IMPORTER_FILE, 'utf-8');
    assert.ok(!source.includes('readFileSync(resolvedPath'), 'Must not read entire file with readFileSync');
    assert.ok(source.includes('createReadStream'), 'Must use streaming createReadStream');
    assert.ok(source.includes('createInterface'), 'Must use readline interface');
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
