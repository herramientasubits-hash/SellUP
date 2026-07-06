import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, validateApplyArgs } from '../../../../../../scripts/source-catalog/run-hn-contrataciones-snapshot-etl';

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe('parseArgs — CLI flags', () => {
  it('default: apply=false, confirmHnSnapshotWrite=false', () => {
    const args = parseArgs(['--year', '2024']);
    assert.equal(args.apply, false);
    assert.equal(args.confirmHnSnapshotWrite, false);
  });

  it('--apply activa apply=true', () => {
    const args = parseArgs(['--year', '2024', '--apply']);
    assert.equal(args.apply, true);
  });

  it('--confirm-hn-snapshot-write activa confirmHnSnapshotWrite=true', () => {
    const args = parseArgs(['--year', '2024', '--confirm-hn-snapshot-write']);
    assert.equal(args.confirmHnSnapshotWrite, true);
  });

  it('ambos flags juntos', () => {
    const args = parseArgs(['--year', '2024', '--apply', '--confirm-hn-snapshot-write']);
    assert.equal(args.apply, true);
    assert.equal(args.confirmHnSnapshotWrite, true);
  });

  it('--max-lines parseado correctamente', () => {
    const args = parseArgs(['--year', '2024', '--max-lines', '500']);
    assert.equal(args.maxLines, 500);
  });

  it('default maxLines = 1000', () => {
    const args = parseArgs(['--year', '2024']);
    assert.equal(args.maxLines, 1000);
  });

  it('año parseado correctamente', () => {
    const args = parseArgs(['--year', '2024']);
    assert.equal(args.year, 2024);
  });
});

// ─── validateApplyArgs ────────────────────────────────────────────────────────

describe('validateApplyArgs — guardrails', () => {
  it('dry-run (apply=false) siempre ok', () => {
    const result = validateApplyArgs({
      year: 2024, maxLines: 1000, maxBytes: 8 * 1024 * 1024,
      apply: false, confirmHnSnapshotWrite: false,
    });
    assert.equal(result.ok, true);
  });

  it('--apply sin confirmación → bloqueado', () => {
    const result = validateApplyArgs({
      year: 2024, maxLines: 1000, maxBytes: 8 * 1024 * 1024,
      apply: true, confirmHnSnapshotWrite: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes('confirmation_required'));
    }
  });

  it('--apply + confirmación correcta → ok', () => {
    const result = validateApplyArgs({
      year: 2024, maxLines: 1000, maxBytes: 8 * 1024 * 1024,
      apply: true, confirmHnSnapshotWrite: true,
    });
    assert.equal(result.ok, true);
  });

  it('--apply + maxLines > 1000 → bloqueado (pilot scope)', () => {
    const result = validateApplyArgs({
      year: 2024, maxLines: 1001, maxBytes: 8 * 1024 * 1024,
      apply: true, confirmHnSnapshotWrite: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes('pilot_scope_exceeded'));
    }
  });

  it('--apply + maxLines = 1000 exacto → ok', () => {
    const result = validateApplyArgs({
      year: 2024, maxLines: 1000, maxBytes: 8 * 1024 * 1024,
      apply: true, confirmHnSnapshotWrite: true,
    });
    assert.equal(result.ok, true);
  });

  it('--apply + maxLines = 500 (< 1000) → ok', () => {
    const result = validateApplyArgs({
      year: 2024, maxLines: 500, maxBytes: 8 * 1024 * 1024,
      apply: true, confirmHnSnapshotWrite: true,
    });
    assert.equal(result.ok, true);
  });

  it('confirmación sin --apply → dry-run (no bloquea)', () => {
    const result = validateApplyArgs({
      year: 2024, maxLines: 1000, maxBytes: 8 * 1024 * 1024,
      apply: false, confirmHnSnapshotWrite: true,
    });
    assert.equal(result.ok, true);
  });

  it('--apply + maxLines 5000 sin confirmación → bloqueado por falta de confirmación', () => {
    const result = validateApplyArgs({
      year: 2024, maxLines: 5000, maxBytes: 8 * 1024 * 1024,
      apply: true, confirmHnSnapshotWrite: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      // El bloqueo por confirmación tiene prioridad
      assert.ok(result.reason.includes('confirmation_required'));
    }
  });
});
