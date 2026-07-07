/**
 * Tests — GT RGAE Dry-run CLI Args
 * Hito: Centroamérica.7G.1
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGtRgaeArgs, type GtRgaeDryRunArgs } from '../gt-rgae-dry-run-args';

describe('parseGtRgaeArgs', () => {
  it('parsea year y local-file válidos', () => {
    const args = parseGtRgaeArgs(['--year=2025', '--local-file=/tmp/test.xlsx']);
    assert.equal(args.year, 2025);
    assert.equal(args.localFile, '/tmp/test.xlsx');
    assert.equal(args.applyRejected, false);
  });

  it('falla si falta --year', () => {
    assert.throws(
      () => parseGtRgaeArgs(['--local-file=/tmp/test.xlsx']),
      /year_required/,
    );
  });

  it('falla si falta --local-file', () => {
    assert.throws(
      () => parseGtRgaeArgs(['--year=2025']),
      /local_file_required/,
    );
  });

  it('detecta --apply y marca applyRejected=true', () => {
    const args = parseGtRgaeArgs(['--year=2025', '--local-file=/tmp/test.xlsx', '--apply']);
    assert.equal(args.applyRejected, true);
  });

  it('año no soportado lanza error', () => {
    assert.throws(
      () => parseGtRgaeArgs(['--year=2020', '--local-file=/tmp/test.xlsx']),
      /unsupported_year/,
    );
  });

  it('archivo vacío en --local-file lanza error', () => {
    assert.throws(
      () => parseGtRgaeArgs(['--year=2025', '--local-file=']),
      /local_file_required/,
    );
  });
});
