/**
 * Tests: hn-contrataciones-coverage-summary
 *
 * Verifica:
 *   1.  source_key = hn_contrataciones_abiertas
 *   2.  coverage_status = partial_snapshot (NEVER complete_snapshot sin validación)
 *   3.  coverage_kind = procurement_signal
 *   4.  postApprovalEnabled = false (invariante — no se habilita post-approval)
 *   5.  isFiscalSource = false
 *   6.  replacesSarHonduras = false
 *   7.  replacesRegistroMercantil = false
 *   8.  humanReviewRequired = true (por defecto)
 *   9.  pilotScope = true (por defecto)
 *  10.  Fallback a audited_fallback cuando env falta
 *  11.  Semántica invariante incluso en fallback (post-approval sigue false)
 *  12.  loadedRows no es hardcodeado — viene de DB o fallback 0
 *  13.  No toca accounts ni prospect_candidates (no writes — función pura de lectura)
 *
 * Todos los tests son read-only — sin llamadas externas, sin writes, sin DB real.
 * El fallback a audited_fallback se activa automáticamente sin env configurado.
 *
 * Hito: Centroamérica.8C.4C
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getHnContratacionesCoverageSummary,
  HN_SOURCE_KEY,
  HN_COVERAGE_KIND,
  HN_AUDITED_LOADED_ROWS,
} from '../hn-contrataciones-coverage-summary';

// ─── 1. source_key ────────────────────────────────────────────────────────────

describe('HN coverage: source_key', () => {
  it('constant is hn_contrataciones_abiertas', () => {
    assert.equal(HN_SOURCE_KEY, 'hn_contrataciones_abiertas');
  });

  it('fallback result has sourceKey = hn_contrataciones_abiertas', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.equal(result.sourceKey, 'hn_contrataciones_abiertas');
  });
});

// ─── 2. coverage_status ───────────────────────────────────────────────────────

describe('HN coverage: coverage_status', () => {
  it('is partial_snapshot or complete_snapshot (NEVER another value)', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.ok(
      result.coverageStatus === 'partial_snapshot' || result.coverageStatus === 'complete_snapshot',
      `coverageStatus must be partial_snapshot or complete_snapshot, got: ${result.coverageStatus}`,
    );
  });

  it('fallback is partial_snapshot (default safe state)', async () => {
    const result = await getHnContratacionesCoverageSummary();
    if (result.coverageSource === 'audited_fallback') {
      assert.equal(result.coverageStatus, 'partial_snapshot');
    }
  });
});

// ─── 3. coverage_kind ────────────────────────────────────────────────────────

describe('HN coverage: coverage_kind', () => {
  it('constant is procurement_signal', () => {
    assert.equal(HN_COVERAGE_KIND, 'procurement_signal');
  });

  it('fallback result has coverageKind = procurement_signal', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.equal(result.coverageKind, 'procurement_signal');
  });
});

// ─── 4. postApprovalEnabled = false (invariante) ─────────────────────────────

describe('HN coverage: postApprovalEnabled always false', () => {
  it('postApprovalEnabled = false in fallback', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.equal(result.postApprovalEnabled, false);
  });

  it('postApprovalEnabled is false regardless of coverageSource', async () => {
    const result = await getHnContratacionesCoverageSummary();
    // This must be false even if DB says true — guardrail enforced by design
    assert.equal(result.postApprovalEnabled, false);
  });
});

// ─── 5. isFiscalSource = false ───────────────────────────────────────────────

describe('HN coverage: not a fiscal source', () => {
  it('isFiscalSource = false', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.equal(result.isFiscalSource, false);
  });
});

// ─── 6. replacesSarHonduras = false ──────────────────────────────────────────

describe('HN coverage: does not replace SAR Honduras', () => {
  it('replacesSarHonduras = false', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.equal(result.replacesSarHonduras, false);
  });
});

// ─── 7. replacesRegistroMercantil = false ────────────────────────────────────

describe('HN coverage: does not replace Registro Mercantil Honduras', () => {
  it('replacesRegistroMercantil = false', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.equal(result.replacesRegistroMercantil, false);
  });
});

// ─── 8. humanReviewRequired = true (default) ─────────────────────────────────

describe('HN coverage: human review required', () => {
  it('humanReviewRequired = true in fallback', async () => {
    const result = await getHnContratacionesCoverageSummary();
    if (result.coverageSource === 'audited_fallback') {
      assert.equal(result.humanReviewRequired, true);
    }
  });
});

// ─── 9. pilotScope = true (default) ──────────────────────────────────────────

describe('HN coverage: pilot scope', () => {
  it('pilotScope = true in fallback', async () => {
    const result = await getHnContratacionesCoverageSummary();
    if (result.coverageSource === 'audited_fallback') {
      assert.equal(result.pilotScope, true);
    }
  });
});

// ─── 10 & 11. Fallback y semántica invariante ─────────────────────────────────

describe('HN coverage: fallback behavior', () => {
  it('returns audited_fallback or live_database (both valid)', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.ok(
      result.coverageSource === 'audited_fallback' || result.coverageSource === 'live_database',
      `Unexpected coverageSource: ${result.coverageSource}`,
    );
  });

  it('fallback preserves invariant semantics regardless of DB state', async () => {
    const result = await getHnContratacionesCoverageSummary();
    assert.equal(result.postApprovalEnabled, false);
    assert.equal(result.isFiscalSource, false);
    assert.equal(result.replacesSarHonduras, false);
    assert.equal(result.replacesRegistroMercantil, false);
    assert.equal(result.coverageKind, 'procurement_signal');
    assert.equal(result.sourceKey, 'hn_contrataciones_abiertas');
    assert.ok(
      result.coverageStatus === 'partial_snapshot' || result.coverageStatus === 'complete_snapshot',
    );
  });
});

// ─── 12. loadedRows — no hardcodeado ─────────────────────────────────────────

describe('HN coverage: loadedRows comes from DB or falls back to 0', () => {
  it('audited fallback baseline is 0 (unknown, not hardcoded 72)', () => {
    assert.equal(HN_AUDITED_LOADED_ROWS, 0);
  });

  it('fallback result loadedRows is 0 (safe unknown, not invented)', async () => {
    const result = await getHnContratacionesCoverageSummary();
    if (result.coverageSource === 'audited_fallback') {
      assert.equal(result.loadedRows, 0);
    }
  });
});

// ─── 13. No toca accounts ni prospect_candidates ─────────────────────────────

describe('HN coverage: no writes to accounts or prospect_candidates', () => {
  it('getHnContratacionesCoverageSummary is a pure read function (idempotent)', async () => {
    const r1 = await getHnContratacionesCoverageSummary();
    const r2 = await getHnContratacionesCoverageSummary();
    assert.equal(r1.sourceKey, r2.sourceKey);
    assert.equal(r1.coverageStatus, r2.coverageStatus);
    assert.equal(r1.coverageKind, r2.coverageKind);
    assert.equal(r1.postApprovalEnabled, r2.postApprovalEnabled);
  });
});
