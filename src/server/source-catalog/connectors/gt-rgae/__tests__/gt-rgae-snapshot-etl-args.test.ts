/**
 * GT RGAE — Snapshot ETL args/guards tests
 *
 * Cubre: Tarea 18 (guards del script ETL)
 * Hito: Centroamérica.7G.3
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  parseGtRgaeEtlArgs,
  validateGtRgaeApplyArgs,
  checkDriftVsBaseline,
} from '../../../../../../scripts/source-catalog/run-gt-rgae-snapshot-etl';
import type { GtRgaeDryRunSummary } from '../gt-rgae-types';

let savedServiceRoleKey: string | undefined;

beforeEach(() => {
  savedServiceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
});

afterEach(() => {
  if (savedServiceRoleKey === undefined) {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
  } else {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = savedServiceRoleKey;
  }
});

function makeSummary(overrides: Partial<GtRgaeDryRunSummary> = {}): GtRgaeDryRunSummary {
  return {
    year: 2025,
    file_name: 'test.xlsx',
    sheet_name: 'Hoja1',
    rows_read: 137753,
    persona_individual_rows: 120209,
    sociedades_rows: 8854,
    comerciante_individual_rows: 8603,
    ong_rows: 58,
    asociacion_rows: 22,
    other_type_rows: 7,
    missing_type_rows: 0,
    sociedades_with_valid_nit: 8757,
    sociedades_invalid_nit: 97,
    sociedades_unique_nit: 6245,
    duplicate_sociedad_rows: 2512,
    dedup_replacements: 2119,
    resolution_date_invalid: 0,
    resolution_number_invalid: 0,
    economic_capacity_not_applicable: 0,
    economic_capacity_direct_purchase: 4397,
    economic_capacity_numeric: 1848,
    economic_capacity_unparsed: 0,
    supplier_name_missing: 0,
    supplier_name_normalization_collisions: 0,
    normalized_candidates: 6245,
    invariant_violations: 0,
    db_writes: 0,
    snapshot_writes: 0,
    coverage_writes: 0,
    ...overrides,
  };
}

// ─── parseGtRgaeEtlArgs ─────────────────────────────────────────────────────────

describe('parseGtRgaeEtlArgs', () => {
  it('local-file requerido → error si falta', () => {
    assert.throws(() => parseGtRgaeEtlArgs(['--year', '2025']), /local_file_required/);
  });

  it('year requerido → error si falta', () => {
    assert.throws(() => parseGtRgaeEtlArgs(['--local-file', '/path/to/file.xlsx']), /year_required/);
  });

  it('year=2025 aceptado', () => {
    const args = parseGtRgaeEtlArgs(['--year', '2025', '--local-file', '/path/file.xlsx']);
    assert.equal(args.year, 2025);
  });

  it('year no soportado rechazado', () => {
    assert.throws(
      () => parseGtRgaeEtlArgs(['--year', '2020', '--local-file', '/path/file.xlsx']),
      /unsupported_year/,
    );
  });

  it('year futura rechazado', () => {
    assert.throws(
      () => parseGtRgaeEtlArgs(['--year', '2026', '--local-file', '/path/file.xlsx']),
      /unsupported_year/,
    );
  });

  it('default dry-run: apply=false, confirm=false', () => {
    const args = parseGtRgaeEtlArgs(['--year', '2025', '--local-file', '/path/file.xlsx']);
    assert.equal(args.apply, false);
    assert.equal(args.confirmGtRgaeSnapshotWrite, false);
  });

  it('--apply activado', () => {
    const args = parseGtRgaeEtlArgs(['--year', '2025', '--local-file', '/f.xlsx', '--apply']);
    assert.equal(args.apply, true);
  });

  it('--confirm-gt-rgae-snapshot-write activado', () => {
    const args = parseGtRgaeEtlArgs([
      '--year', '2025', '--local-file', '/f.xlsx',
      '--apply', '--confirm-gt-rgae-snapshot-write',
    ]);
    assert.equal(args.confirmGtRgaeSnapshotWrite, true);
  });

  it('soporta formato --year=2025', () => {
    const args = parseGtRgaeEtlArgs(['--year=2025', '--local-file=/path/file.xlsx']);
    assert.equal(args.year, 2025);
    assert.equal(args.localFile, '/path/file.xlsx');
  });

  it('URL Cloudflare no soportada (no hay auto-download path en el parser)', () => {
    // El parser acepta cualquier string como local-file; la validación de que
    // es un archivo real ocurre al intentar leerlo con readGtRgaeXlsx (IO local).
    const args = parseGtRgaeEtlArgs(['--year', '2025', '--local-file', 'https://example.com/file.xlsx']);
    assert.equal(args.localFile, 'https://example.com/file.xlsx');
    assert.equal(args.apply, false);
  });
});

// ─── validateGtRgaeApplyArgs ────────────────────────────────────────────────────

describe('validateGtRgaeApplyArgs', () => {
  it('sin --apply: siempre ok', () => {
    const args = parseGtRgaeEtlArgs(['--year', '2025', '--local-file', '/f.xlsx']);
    assert.deepEqual(validateGtRgaeApplyArgs(args), { ok: true });
  });

  it('--apply sin confirmation → confirmation_required', () => {
    const args = parseGtRgaeEtlArgs(['--year', '2025', '--local-file', '/f.xlsx', '--apply']);
    const result = validateGtRgaeApplyArgs(args);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'confirmation_required');
  });

  it('--apply con confirmation sin service role → service_role_required', () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = '';
    const args = parseGtRgaeEtlArgs([
      '--year', '2025', '--local-file', '/f.xlsx',
      '--apply', '--confirm-gt-rgae-snapshot-write',
    ]);
    const result = validateGtRgaeApplyArgs(args);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'service_role_required');
  });

  it('--apply con confirmation y service role → ok', () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-key-xyz';
    const args = parseGtRgaeEtlArgs([
      '--year', '2025', '--local-file', '/f.xlsx',
      '--apply', '--confirm-gt-rgae-snapshot-write',
    ]);
    const result = validateGtRgaeApplyArgs(args);
    assert.equal(result.ok, true);
  });

  it('--confirm-gt-rgae-snapshot-write sin --apply → dry-run (ok)', () => {
    const args = parseGtRgaeEtlArgs([
      '--year', '2025', '--local-file', '/f.xlsx',
      '--confirm-gt-rgae-snapshot-write',
    ]);
    assert.deepEqual(validateGtRgaeApplyArgs(args), { ok: true });
  });
});

// ─── checkDriftVsBaseline ──────────────────────────────────────────────────────

describe('checkDriftVsBaseline', () => {
  it('sin drift: ok', () => {
    assert.deepEqual(checkDriftVsBaseline(makeSummary()), { ok: true });
  });

  it('rows_read > 5% drift → bloqueado', () => {
    const result = checkDriftVsBaseline(makeSummary({ rows_read: 137753 * 2 }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.drifts.some((d: string) => d.includes('rows_read')), true);
  });

  it('sociedades_rows > 5% drift → bloqueado', () => {
    const result = checkDriftVsBaseline(makeSummary({ sociedades_rows: 1 }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.drifts.some((d: string) => d.includes('sociedades_rows')), true);
  });

  it('sociedades_unique_nit > 5% drift → bloqueado', () => {
    const result = checkDriftVsBaseline(makeSummary({ sociedades_unique_nit: 1 }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.drifts.some((d: string) => d.includes('sociedades_unique_nit')), true);
  });

  it('drift <= 5%: ok', () => {
    // 137753 * 1.04 ≈ 143263 (4% drift)
    const result = checkDriftVsBaseline(makeSummary({ rows_read: Math.floor(137753 * 1.04) }));
    assert.equal(result.ok, true);
  });
});
