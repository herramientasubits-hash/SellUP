/**
 * Tests unitarios — Source Catalog hn_ccic / hn_ccit
 *
 * Verifica que las cámaras hondureñas se representen como señal manual pura:
 *   - no pending_classification
 *   - connectionMode = not_applicable → CTA "Ver detalle", no "Conectar"
 *   - shouldSkipGenericConnectionPanels = true (no TestConnectionPanel)
 *
 * Hito: Centroamérica.8C.6
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_SOURCES } from '../source-catalog';
import { resolveOperationalClassification } from '../../../../modules/source-catalog/operational-classification';

// ── Helpers ───────────────────────────────────────────────────────────────────

import {
  isManualSignalOnly,
  shouldSkipGenericConnectionPanels,
} from '../../../../modules/source-catalog/connection-panel-guards';

/**
 * Replica la lógica del CTA del listado.
 * Fuente de verdad: source-catalog-client.tsx
 */
function ctaLabel(source: { connectionMode?: string }): 'Ver señales' | 'Conectar' | 'Ver detalle' {
  if (source.connectionMode === 'read_only_signal') return 'Ver señales';
  if (source.connectionMode === 'not_connected') return 'Conectar';
  return 'Ver detalle';
}

// ── hn_ccic ───────────────────────────────────────────────────────────────────

const hnCcic = CATALOG_SOURCES.find((s) => s.key === 'hn_ccic');
const hnCcit = CATALOG_SOURCES.find((s) => s.key === 'hn_ccit');

describe('hn_ccic — señal manual pura (8C.6)', () => {
  it('existe en el catálogo', () => {
    assert.ok(hnCcic, 'hn_ccic no encontrado en CATALOG_SOURCES');
  });

  it('operationalStatus = manual_signal_only', () => {
    assert.equal(hnCcic?.operationalStatus, 'manual_signal_only');
  });

  it('sellupUse = manual_reference (no pending_classification)', () => {
    assert.equal(hnCcic?.sellupUse, 'manual_reference');
    assert.notEqual(hnCcic?.sellupUse, 'pending_classification');
  });

  it('aiFlowStatus = manual_only (no pending_classification)', () => {
    assert.equal(hnCcic?.aiFlowStatus, 'manual_only');
    assert.notEqual(hnCcic?.aiFlowStatus, 'pending_classification');
  });

  it('connectionMode = not_applicable (no not_connected)', () => {
    assert.equal(hnCcic?.connectionMode, 'not_applicable');
    assert.notEqual(hnCcic?.connectionMode, 'not_connected');
  });

  it('resolveOperationalClassification no cae en fallback pending_classification', () => {
    if (!hnCcic) return;
    const c = resolveOperationalClassification(hnCcic);
    assert.notEqual(c.sellupUse, 'pending_classification');
    assert.notEqual(c.aiFlowStatus, 'pending_classification');
  });

  it('CTA = Ver detalle (no Conectar)', () => {
    if (!hnCcic) return;
    assert.equal(ctaLabel(hnCcic), 'Ver detalle');
  });

  it('shouldSkipGenericConnectionPanels = true (no TestConnectionPanel ni historial)', () => {
    if (!hnCcic) return;
    assert.ok(shouldSkipGenericConnectionPanels(hnCcic));
  });

  it('countryCodes incluye HN', () => {
    assert.ok(hnCcic?.countryCodes.includes('HN'));
  });

  it('type = industry_association', () => {
    assert.equal(hnCcic?.type, 'industry_association');
  });
});

// ── hn_ccit ───────────────────────────────────────────────────────────────────

describe('hn_ccit — señal manual pura (8C.6)', () => {
  it('existe en el catálogo', () => {
    assert.ok(hnCcit, 'hn_ccit no encontrado en CATALOG_SOURCES');
  });

  it('operationalStatus = manual_signal_only', () => {
    assert.equal(hnCcit?.operationalStatus, 'manual_signal_only');
  });

  it('sellupUse = manual_reference (no pending_classification)', () => {
    assert.equal(hnCcit?.sellupUse, 'manual_reference');
    assert.notEqual(hnCcit?.sellupUse, 'pending_classification');
  });

  it('aiFlowStatus = manual_only (no pending_classification)', () => {
    assert.equal(hnCcit?.aiFlowStatus, 'manual_only');
    assert.notEqual(hnCcit?.aiFlowStatus, 'pending_classification');
  });

  it('connectionMode = not_applicable (no not_connected)', () => {
    assert.equal(hnCcit?.connectionMode, 'not_applicable');
    assert.notEqual(hnCcit?.connectionMode, 'not_connected');
  });

  it('resolveOperationalClassification no cae en fallback pending_classification', () => {
    if (!hnCcit) return;
    const c = resolveOperationalClassification(hnCcit);
    assert.notEqual(c.sellupUse, 'pending_classification');
    assert.notEqual(c.aiFlowStatus, 'pending_classification');
  });

  it('CTA = Ver detalle (no Conectar)', () => {
    if (!hnCcit) return;
    assert.equal(ctaLabel(hnCcit), 'Ver detalle');
  });

  it('shouldSkipGenericConnectionPanels = true (no TestConnectionPanel ni historial)', () => {
    if (!hnCcit) return;
    assert.ok(shouldSkipGenericConnectionPanels(hnCcit));
  });

  it('countryCodes incluye HN', () => {
    assert.ok(hnCcit?.countryCodes.includes('HN'));
  });

  it('type = industry_association', () => {
    assert.equal(hnCcit?.type, 'industry_association');
  });
});

// ── Patrón genérico manual_signal_only ────────────────────────────────────────

describe('shouldSkipGenericConnectionPanels — fuente not_applicable genérica (8C.6)', () => {
  it('cualquier fuente con connectionMode=not_applicable omite paneles de conexión', () => {
    const manualSource = { aiFlowStatus: 'manual_only', connectionMode: 'not_applicable' };
    assert.ok(shouldSkipGenericConnectionPanels(manualSource));
  });

  it('no depende del source_key Honduras para omitir paneles', () => {
    const otherCountryManual = { aiFlowStatus: 'manual_only', connectionMode: 'not_applicable' };
    assert.ok(shouldSkipGenericConnectionPanels(otherCountryManual));
  });
});

// ── Regresiones ───────────────────────────────────────────────────────────────

describe('regresión — fuentes existentes no afectadas (8C.6)', () => {
  it('hn_contrataciones_abiertas sigue siendo snapshot_persisted + read_only_snapshot', () => {
    const hn = CATALOG_SOURCES.find((s) => s.key === 'hn_contrataciones_abiertas');
    assert.ok(hn, 'hn_contrataciones_abiertas no encontrado');
    assert.equal(hn?.aiFlowStatus, 'snapshot_persisted');
    assert.equal(hn?.connectionMode, 'read_only_snapshot');
    assert.equal(hn?.operationalStatus, 'partial_snapshot');
  });

  it('hn_contrataciones_abiertas sigue omitiendo paneles de conexión (via snapshot_persisted)', () => {
    const hn = CATALOG_SOURCES.find((s) => s.key === 'hn_contrataciones_abiertas');
    if (!hn) return;
    assert.ok(shouldSkipGenericConnectionPanels(hn));
  });

  it('sv_comprasal sigue siendo manual_signal_only con connectionMode read_only_signal', () => {
    const sv = CATALOG_SOURCES.find((s) => s.key === 'sv_comprasal');
    assert.ok(sv, 'sv_comprasal no encontrado');
    assert.equal(sv?.operationalStatus, 'manual_signal_only');
    assert.equal(sv?.connectionMode, 'read_only_signal');
    assert.notEqual(sv?.connectionMode, 'not_applicable');
  });

  it('sv_comprasal SÍ omite paneles genéricos de conexión (read_only_signal)', () => {
    const sv = CATALOG_SOURCES.find((s) => s.key === 'sv_comprasal');
    if (!sv) return;
    assert.ok(shouldSkipGenericConnectionPanels(sv));
  });

  it('sv_comprasal isManualSignalOnly = false (no not_applicable, tiene read_only_signal)', () => {
    const sv = CATALOG_SOURCES.find((s) => s.key === 'sv_comprasal');
    if (!sv) return;
    assert.equal(isManualSignalOnly(sv), false);
  });

  it('hn_ccic isManualSignalOnly = true (manual_signal_only + not_applicable)', () => {
    if (!hnCcic) return;
    assert.ok(isManualSignalOnly(hnCcic));
  });

  it('hn_ccit isManualSignalOnly = true (manual_signal_only + not_applicable)', () => {
    if (!hnCcit) return;
    assert.ok(isManualSignalOnly(hnCcit));
  });

  it('hn_contrataciones_abiertas isManualSignalOnly = false (read_only_snapshot)', () => {
    const hn = CATALOG_SOURCES.find((s) => s.key === 'hn_contrataciones_abiertas');
    if (!hn) return;
    assert.equal(isManualSignalOnly(hn), false);
  });

  it('fuente conectable sigue mostrando CTA Conectar', () => {
    const connectable = { connectionMode: 'not_connected' };
    assert.equal(ctaLabel(connectable), 'Conectar');
  });

  it('fuente not_connected NO omite paneles de conexión', () => {
    const connectable = { aiFlowStatus: 'eligible_not_connected', connectionMode: 'not_connected' };
    assert.equal(shouldSkipGenericConnectionPanels(connectable), false);
  });

  it('connectionMode=not_applicable sin operationalStatus manual_signal_only NO es isManualSignalOnly', () => {
    // un source con not_applicable pero status diferente no debe ser manual signal only
    const ambiguous = { operationalStatus: 'eligible_not_connected', connectionMode: 'not_applicable' };
    assert.equal(isManualSignalOnly(ambiguous), false);
  });
});
