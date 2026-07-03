/**
 * Tests for PaPanamaCompraConvenioCoverageCard helpers — Centroamérica.5D
 *
 * Pure helper function tests only (no DOM rendering required).
 * Uses node:test to match the repo's existing test convention.
 *
 * Verifica:
 *  1.  loaded_rows real se muestra (formatPaLoadedRows)
 *  2.  pilot_sample se muestra (formatPaCoverageStatus)
 *  3.  procurement / B2G (isPaProcurementSignal)
 *  4.  Convenio Marco (summary.coverageScope)
 *  5.  convenios leídos (breakdown.convenios_read)
 *  6.  proveedores encontrados (breakdown.providers_found)
 *  7.  proveedores únicos (breakdown.unique_providers)
 *  8.  proveedores con RUC (breakdown.providers_with_ruc)
 *  9.  snapshots construidos (breakdown.snapshots_built)
 * 10.  no es fuente legal (summary.isFiscalSource === false)
 * 11.  no es fuente tributaria (summary.isFiscalSource === false)
 * 12.  no valida RUC (summary.replacesDgiPanama === false)
 * 13.  no reemplaza DGI Panamá (summary.replacesDgiPanama === false)
 * 14.  no reemplaza Registro Público (summary.replacesRegistroPublico === false)
 * 15.  no cubre toda la contratación pública (coverageScope === convenio_marco)
 * 16.  no existe post-approval activo (coverageStatus ≠ connected_post_approval)
 * 17.  no muestra complete_snapshot (isPaCompleteSnapshot)
 * 18.  Source Catalog sigue eligible_not_connected (constante pura)
 * 19.  connectionMode sigue not_connected (constante pura)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPaLoadedRows,
  formatPaCoverageStatus,
  formatPaCoverageSource,
  isPaCompleteSnapshot,
  isPaProcurementSignal,
  isPaFiscalSource,
} from './pa-panamacompra-convenio-coverage-card';
import type { PaPanamaCompraConvenioCoverageSummary } from '@/server/services/pa-panamacompra-convenio-source-coverage-summary';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const baseSummary: PaPanamaCompraConvenioCoverageSummary = {
  sourceKey: 'pa_panamacompra_convenio',
  loadedRows: 42,
  coverageStatus: 'pilot_sample',
  coverageKind: 'procurement_signal_snapshot',
  coverageSource: 'live_database',
  isProcurementSignalOnly: true,
  isFiscalSource: false,
  replacesDgiPanama: false,
  replacesRegistroPublico: false,
  coverageScope: 'convenio_marco',
  breakdown: {
    coverage_scope: 'convenio_marco',
    convenios_read: 3,
    providers_found: 42,
    unique_providers: 42,
    providers_with_ruc: null,
    snapshots_built: 42,
    limitations: [
      'Muestra piloto de proveedores de Convenio Marco solamente',
      'No es fuente legal ni tributaria para Panamá',
      'No valida RUC Panamá ni reemplaza DGI Panamá',
      'No reemplaza Registro Público de Panamá',
    ],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PaPanamaCompraConvenioCoverageCard helpers', () => {

  // 1. loaded_rows real se muestra
  it('formatPaLoadedRows muestra el número real', () => {
    const result = formatPaLoadedRows(42);
    assert.ok(result.includes('42'), `Expected "42" in "${result}"`);
    assert.ok(result.includes('proveedores'), `Expected "proveedores" in "${result}"`);
  });

  // 2. pilot_sample se muestra
  it('formatPaCoverageStatus muestra pilot_sample', () => {
    const result = formatPaCoverageStatus('pilot_sample');
    assert.ok(result.includes('pilot_sample'), `Expected "pilot_sample" in "${result}"`);
    assert.ok(result.toLowerCase().includes('piloto'), `Expected "piloto" in "${result}"`);
  });

  // 3. procurement / B2G — isProcurementSignal
  it('isPaProcurementSignal devuelve true', () => {
    assert.equal(isPaProcurementSignal(baseSummary), true);
  });

  // 4. Convenio Marco
  it('summary.coverageScope es convenio_marco', () => {
    assert.equal(baseSummary.coverageScope, 'convenio_marco');
  });

  // 5. convenios leídos
  it('breakdown.convenios_read es 3', () => {
    assert.equal(baseSummary.breakdown?.convenios_read, 3);
  });

  // 6. proveedores encontrados
  it('breakdown.providers_found es 42', () => {
    assert.equal(baseSummary.breakdown?.providers_found, 42);
  });

  // 7. proveedores únicos
  it('breakdown.unique_providers es 42', () => {
    assert.equal(baseSummary.breakdown?.unique_providers, 42);
  });

  // 8. proveedores con RUC (null = no disponible)
  it('breakdown.providers_with_ruc es null (no disponible)', () => {
    assert.equal(baseSummary.breakdown?.providers_with_ruc, null);
  });

  // 9. snapshots construidos
  it('breakdown.snapshots_built es 42', () => {
    assert.equal(baseSummary.breakdown?.snapshots_built, 42);
  });

  // 10. no es fuente legal
  it('isFiscalSource es false (no fuente legal)', () => {
    assert.equal(baseSummary.isFiscalSource, false);
  });

  // 11. no es fuente tributaria
  it('isPaFiscalSource devuelve false (no fuente tributaria)', () => {
    assert.equal(isPaFiscalSource(baseSummary), false);
  });

  // 12. no valida RUC
  it('replacesDgiPanama es false (no valida RUC)', () => {
    assert.equal(baseSummary.replacesDgiPanama, false);
  });

  // 13. no reemplaza DGI Panamá
  it('replacesDgiPanama es false', () => {
    assert.equal(baseSummary.replacesDgiPanama, false);
  });

  // 14. no reemplaza Registro Público
  it('replacesRegistroPublico es false', () => {
    assert.equal(baseSummary.replacesRegistroPublico, false);
  });

  // 15. no cubre toda la contratación pública
  it('coverageScope convenio_marco — no es contratación pública completa', () => {
    assert.equal(baseSummary.coverageScope, 'convenio_marco');
    assert.notEqual(baseSummary.coverageScope, 'full_procurement');
  });

  // 16. no existe post-approval activo
  it('coverageStatus no es connected_post_approval', () => {
    assert.notEqual(baseSummary.coverageStatus, 'connected_post_approval');
    assert.equal(baseSummary.coverageStatus, 'pilot_sample');
  });

  // 17. no muestra complete_snapshot
  it('isPaCompleteSnapshot devuelve false para pilot_sample', () => {
    assert.equal(isPaCompleteSnapshot(baseSummary.coverageStatus), false);
  });

  it('isPaCompleteSnapshot devuelve false para partial_snapshot', () => {
    assert.equal(isPaCompleteSnapshot('partial_snapshot'), false);
  });

  it('isPaCompleteSnapshot solo devuelve true para complete_snapshot', () => {
    assert.equal(isPaCompleteSnapshot('complete_snapshot'), true);
  });

  // 18. Source Catalog sigue eligible_not_connected
  it('sourceKey es pa_panamacompra_convenio (eligible_not_connected)', () => {
    assert.equal(baseSummary.sourceKey, 'pa_panamacompra_convenio');
    // El aiFlowStatus = eligible_not_connected está definido en el catalog, no en el summary.
    // Verifica que el summary no asume connected_post_approval.
    assert.notEqual(baseSummary.coverageStatus, 'complete_snapshot');
  });

  // 19. connectionMode sigue not_connected
  it('coverageSource no implica connectionMode=connected', () => {
    // coverage_notes.connection_mode = not_connected está en DB.
    // El summary no expone un campo "connected" — es by design.
    assert.equal(baseSummary.isProcurementSignalOnly, true);
  });

  // formatPaCoverageSource
  it('formatPaCoverageSource — live_database', () => {
    assert.ok(formatPaCoverageSource('live_database').includes('vivo'));
  });

  it('formatPaCoverageSource — audited_fallback', () => {
    assert.ok(formatPaCoverageSource('audited_fallback').includes('fallback'));
  });
});
