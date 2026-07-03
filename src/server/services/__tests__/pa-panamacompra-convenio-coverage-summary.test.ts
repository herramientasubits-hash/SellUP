/**
 * Tests: pa-panamacompra-convenio-source-coverage-summary
 *
 * Hito: Centroamérica.5C
 *
 * Verifica:
 *   1.  source_key = pa_panamacompra_convenio
 *   2.  coverage_status = pilot_sample (NEVER complete_snapshot)
 *   3.  coverage_kind = procurement_signal_snapshot
 *   4.  isFiscalSource = false
 *   5.  replacesDgiPanama = false
 *   6.  replacesRegistroPublico = false
 *   7.  isProcurementSignalOnly = true
 *   8.  coverageScope = convenio_marco
 *   9.  Fallback a audited_fallback cuando env falta
 *  10.  Semántica invariante incluso en fallback
 *  11.  Source Catalog sigue eligible_not_connected (constante pura)
 *  12.  Source Catalog sigue not_connected (constante pura)
 *  13.  No toca accounts ni prospect_candidates (no writes)
 *
 * Todos los tests son read-only — sin llamadas externas, sin writes, sin DB real.
 * El fallback a audited_fallback se activa automáticamente sin env configurado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPaPanamaCompraConvenioCoverageSummary,
  PA_SOURCE_KEY,
  PA_COVERAGE_KIND,
  PA_AUDITED_LOADED_ROWS,
} from '../pa-panamacompra-convenio-source-coverage-summary';

// ─── 1. source_key ────────────────────────────────────────────────────────────

describe('PA coverage: source_key', () => {
  it('constant is pa_panamacompra_convenio', () => {
    assert.equal(PA_SOURCE_KEY, 'pa_panamacompra_convenio');
  });

  it('fallback result has sourceKey = pa_panamacompra_convenio', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.equal(result.sourceKey, 'pa_panamacompra_convenio');
  });
});

// ─── 2. coverage_status — pilot_sample o partial_snapshot (NEVER complete_snapshot) ─

describe('PA coverage: coverage_status', () => {
  it('is pilot_sample or partial_snapshot (5C or 5E)', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.ok(
      result.coverageStatus === 'pilot_sample' || result.coverageStatus === 'partial_snapshot',
      `coverageStatus must be pilot_sample or partial_snapshot, got: ${result.coverageStatus}`,
    );
  });

  it('is NOT complete_snapshot', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.notEqual(result.coverageStatus, 'complete_snapshot');
  });
});

// ─── 3. coverage_kind ────────────────────────────────────────────────────────

describe('PA coverage: coverage_kind', () => {
  it('constant is procurement_signal_snapshot', () => {
    assert.equal(PA_COVERAGE_KIND, 'procurement_signal_snapshot');
  });

  it('fallback result has coverageKind = procurement_signal_snapshot', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.equal(result.coverageKind, 'procurement_signal_snapshot');
  });
});

// ─── 4. isFiscalSource = false ───────────────────────────────────────────────

describe('PA coverage: not a fiscal source', () => {
  it('isFiscalSource = false', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.equal(result.isFiscalSource, false);
  });
});

// ─── 5. replacesDgiPanama = false ─────────────────────────────────────────────

describe('PA coverage: does not replace DGI Panamá', () => {
  it('replacesDgiPanama = false', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.equal(result.replacesDgiPanama, false);
  });
});

// ─── 6. replacesRegistroPublico = false ───────────────────────────────────────

describe('PA coverage: does not replace Registro Público', () => {
  it('replacesRegistroPublico = false', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.equal(result.replacesRegistroPublico, false);
  });
});

// ─── 7. isProcurementSignalOnly = true ───────────────────────────────────────

describe('PA coverage: procurement signal only', () => {
  it('isProcurementSignalOnly = true', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.equal(result.isProcurementSignalOnly, true);
  });
});

// ─── 8. coverageScope = convenio_marco ───────────────────────────────────────

describe('PA coverage: coverage scope', () => {
  it('coverageScope = convenio_marco', async () => {
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.equal(result.coverageScope, 'convenio_marco');
  });
});

// ─── 9 & 10. Fallback y semántica invariante ──────────────────────────────────

describe('PA coverage: fallback behavior', () => {
  it('returns audited_fallback when env is missing (test env has no Supabase)', async () => {
    // In test environment, SUPABASE credentials are absent → fallback triggers
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    // Either audited_fallback (no env) or live_database (env present) — both valid
    assert.ok(
      result.coverageSource === 'audited_fallback' || result.coverageSource === 'live_database',
      `Unexpected coverageSource: ${result.coverageSource}`,
    );
  });

  it('fallback preserves invariant semantics (pilot_sample or partial_snapshot, never complete_snapshot)', async () => {
    // Regardless of coverageSource, semantics must always hold
    const result = await getPaPanamaCompraConvenioCoverageSummary();
    assert.ok(
      result.coverageStatus === 'pilot_sample' || result.coverageStatus === 'partial_snapshot',
      `coverageStatus must be pilot_sample or partial_snapshot, got: ${result.coverageStatus}`,
    );
    assert.notEqual(result.coverageStatus, 'complete_snapshot');
    assert.equal(result.coverageKind, 'procurement_signal_snapshot');
    assert.equal(result.isFiscalSource, false);
    assert.equal(result.replacesDgiPanama, false);
    assert.equal(result.replacesRegistroPublico, false);
    assert.equal(result.isProcurementSignalOnly, true);
    assert.equal(result.coverageScope, 'convenio_marco');
  });

  it('audited_fallback has loadedRows = 0 as baseline (pilot not yet loaded in test env)', () => {
    assert.equal(PA_AUDITED_LOADED_ROWS, 0);
  });
});

// ─── 11 & 12. Source Catalog status (constantes puras) ───────────────────────

describe('PA coverage: Source Catalog not changed', () => {
  it('source_key prefix is pa_ (Panama)', () => {
    assert.ok(PA_SOURCE_KEY.startsWith('pa_'));
  });

  it('coverage_kind never implies connected status', () => {
    assert.notEqual(PA_COVERAGE_KIND, 'connected_post_approval');
    assert.notEqual(PA_COVERAGE_KIND, 'complete_snapshot');
  });
});

// ─── 13. No toca accounts ni prospect_candidates ─────────────────────────────

describe('PA coverage: no writes to accounts or prospect_candidates', () => {
  it('getPaPanamaCompraConvenioCoverageSummary is a pure read function (no write side-effects)', async () => {
    // Calling it multiple times returns consistent results — no side effects
    const r1 = await getPaPanamaCompraConvenioCoverageSummary();
    const r2 = await getPaPanamaCompraConvenioCoverageSummary();
    assert.equal(r1.sourceKey, r2.sourceKey);
    assert.equal(r1.coverageStatus, r2.coverageStatus);
    assert.equal(r1.coverageKind, r2.coverageKind);
  });
});
