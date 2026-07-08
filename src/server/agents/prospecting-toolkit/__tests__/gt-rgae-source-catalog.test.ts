/**
 * Tests: gt_rgae_proveedores en Source Catalog
 *
 * Verifica que la fuente RGAE Guatemala se registra correctamente y refleja
 * el estado real post-snapshot (GT.1/GT.2A):
 *   - existe en CATALOG_SOURCES con countryCodes GT
 *   - aiFlowStatus = snapshot_persisted, connectionMode = read_only_snapshot
 *   - operationalStatus = partial_snapshot (literal permitido más cercano a "complete_snapshot")
 *   - NO afirma runtime enrichment conectado ni post-approval
 *   - gt_camara_comercio permanece manual (fix de fallback pending_classification)
 *
 * Hito: Catálogo.GT.2B
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_SOURCES } from '../source-catalog';
import { resolveOperationalClassification } from '../../../../modules/source-catalog/operational-classification';
import { isManualSignalOnly, shouldSkipGenericConnectionPanels } from '../../../../modules/source-catalog/connection-panel-guards';
import { OPERATIONAL_STATUS_LABELS, AI_FLOW_STATUS_LABELS, CONNECTION_MODE_LABELS } from '../../../../modules/source-catalog/labels';

const gtRgae = CATALOG_SOURCES.find((s) => s.key === 'gt_rgae_proveedores');
const gtCamara = CATALOG_SOURCES.find((s) => s.key === 'gt_camara_comercio');

describe('gt_rgae_proveedores — Source Catalog entry (GT.2B)', () => {
  it('existe en el Source Catalog', () => {
    assert.ok(gtRgae, 'La fuente gt_rgae_proveedores debe existir');
  });

  it('país = Guatemala (GT)', () => {
    assert.ok(gtRgae?.countryCodes.includes('GT'), 'Debe incluir GT en countryCodes');
  });

  it('nombre menciona RGAE y Guatemala', () => {
    assert.ok(gtRgae?.name.includes('RGAE'), 'name debe mencionar RGAE');
    assert.ok(gtRgae?.name.toLowerCase().includes('guatemala'), 'name debe mencionar Guatemala');
  });

  it('tipo = procurement (literal permitido más cercano a government_supplier_registry)', () => {
    assert.strictEqual(gtRgae?.type, 'procurement');
  });

  it('sellupUse = commercial_signal (señal oficial de proveedor estatal)', () => {
    assert.strictEqual(gtRgae?.sellupUse, 'commercial_signal');
  });

  // ── Estado post-snapshot ──────────────────────────────────────────────────

  it('aiFlowStatus = snapshot_persisted (snapshot 2025 aplicado)', () => {
    assert.strictEqual(gtRgae?.aiFlowStatus, 'snapshot_persisted');
  });

  it('connectionMode = read_only_snapshot (snapshot persistido sin post-approval)', () => {
    assert.strictEqual(gtRgae?.connectionMode, 'read_only_snapshot');
  });

  it('operationalStatus = partial_snapshot (literal permitido; no existe complete_snapshot en el contrato)', () => {
    assert.strictEqual(gtRgae?.operationalStatus, 'partial_snapshot');
  });

  // ── Labels visibles ──────────────────────────────────────────────────────

  it('label operationalStatus visible = "Snapshot parcial"', () => {
    const label = OPERATIONAL_STATUS_LABELS[gtRgae?.operationalStatus ?? 'dry_run_validated'];
    assert.strictEqual(label, 'Snapshot parcial');
  });

  it('label aiFlowStatus visible = "Snapshot persistido"', () => {
    const label = AI_FLOW_STATUS_LABELS[gtRgae?.aiFlowStatus ?? 'dry_run_validated'];
    assert.strictEqual(label, 'Snapshot persistido');
  });

  it('label connectionMode visible = "Read-only snapshot"', () => {
    const label = CONNECTION_MODE_LABELS[gtRgae?.connectionMode ?? 'not_persisted'];
    assert.strictEqual(label, 'Read-only snapshot');
  });

  // ── nextAction refleja snapshot persistido ────────────────────────────────

  it('nextAction menciona 6.245 Sociedades cargadas', () => {
    assert.ok(gtRgae?.nextAction?.includes('6.245'), 'nextAction debe mencionar 6.245');
  });

  it('nextAction menciona revisión humana requerida', () => {
    const text = (gtRgae?.nextAction ?? '').toLowerCase();
    assert.ok(text.includes('revisión humana'), 'nextAction debe mencionar revisión humana');
  });

  it('nextAction menciona post-approval no habilitado', () => {
    const text = (gtRgae?.nextAction ?? '').toLowerCase();
    assert.ok(text.includes('post-approval'), 'nextAction debe mencionar post-approval');
  });

  // ── Sin post-approval, matching, ni runtime enrichment ────────────────────

  it('NO está conectada a post-approval', () => {
    assert.notEqual(gtRgae?.aiFlowStatus, 'connected');
    assert.notEqual(gtRgae?.aiFlowStatus, 'connected_post_approval');
  });

  it('connectionMode NO implica escritura operativa automática', () => {
    assert.notEqual(gtRgae?.connectionMode, 'automatic_enrichment');
    assert.notEqual(gtRgae?.connectionMode, 'wizard_discovery');
    assert.notEqual(gtRgae?.connectionMode, 'credential_configured');
  });

  it('resolveOperationalClassification no cae en fallback pending_classification', () => {
    if (!gtRgae) return;
    const c = resolveOperationalClassification(gtRgae);
    assert.notEqual(c.sellupUse, 'pending_classification');
    assert.notEqual(c.aiFlowStatus, 'pending_classification');
  });

  it('shouldSkipGenericConnectionPanels = true (via snapshot_persisted, como hn_contrataciones_abiertas)', () => {
    if (!gtRgae) return;
    assert.ok(shouldSkipGenericConnectionPanels(gtRgae));
  });

  // ── Guardrails en limitations ─────────────────────────────────────────────

  it('limitations menciona que NO reemplaza SAT', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('sat')), 'Debe mencionar SAT');
  });

  it('limitations menciona que NO reemplaza Registro Mercantil', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('registro mercantil')), 'Debe mencionar Registro Mercantil');
  });

  it('limitations menciona post_approval_enabled = false', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('post-approval')), 'Debe mencionar ausencia de post-approval');
  });

  it('limitations menciona que NO tiene matching automático', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('matching automático')), 'Debe mencionar ausencia de matching');
  });

  it('limitations menciona que NO crea accounts ni prospect_candidates', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(
      lims.some((l) => l.toLowerCase().includes('accounts') || l.toLowerCase().includes('prospect_candidates')),
      'Debe mencionar que no crea accounts ni prospect_candidates',
    );
  });

  it('limitations menciona ingesta manual desde XLSX (sin API)', () => {
    const lims = gtRgae?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('xlsx')), 'Debe mencionar ingesta manual XLSX');
  });

  // ── recommendedUse ────────────────────────────────────────────────────────

  it('recommendedUse menciona RGAE y MINFIN', () => {
    const text = (gtRgae?.recommendedUse ?? '').toLowerCase();
    assert.ok(text.includes('rgae'), 'Debe mencionar RGAE');
    assert.ok(text.includes('minfin'), 'Debe mencionar MINFIN');
  });

  it('recommendedUse menciona snapshot 2025', () => {
    assert.ok((gtRgae?.recommendedUse ?? '').includes('2025'), 'Debe mencionar 2025');
  });
});

// ── gt_camara_comercio — fix de clasificación (no debe quedar como operativa) ──

describe('gt_camara_comercio — permanece manual tras GT.2B', () => {
  it('existe en el catálogo', () => {
    assert.ok(gtCamara, 'gt_camara_comercio no encontrado en CATALOG_SOURCES');
  });

  it('operationalStatus = manual_signal_only (sin cambios)', () => {
    assert.equal(gtCamara?.operationalStatus, 'manual_signal_only');
  });

  it('sellupUse = manual_reference (no pending_classification)', () => {
    assert.equal(gtCamara?.sellupUse, 'manual_reference');
    assert.notEqual(gtCamara?.sellupUse, 'pending_classification');
  });

  it('aiFlowStatus = manual_only (no pending_classification)', () => {
    assert.equal(gtCamara?.aiFlowStatus, 'manual_only');
    assert.notEqual(gtCamara?.aiFlowStatus, 'pending_classification');
  });

  it('connectionMode = not_applicable (no not_connected)', () => {
    assert.equal(gtCamara?.connectionMode, 'not_applicable');
    assert.notEqual(gtCamara?.connectionMode, 'not_connected');
  });

  it('resolveOperationalClassification no cae en fallback pending_classification', () => {
    if (!gtCamara) return;
    const c = resolveOperationalClassification(gtCamara);
    assert.notEqual(c.sellupUse, 'pending_classification');
    assert.notEqual(c.aiFlowStatus, 'pending_classification');
  });

  it('isManualSignalOnly = true (manual_signal_only + not_applicable)', () => {
    if (!gtCamara) return;
    assert.ok(isManualSignalOnly(gtCamara));
  });

  it('shouldSkipGenericConnectionPanels = true (no TestConnectionPanel ni historial)', () => {
    if (!gtCamara) return;
    assert.ok(shouldSkipGenericConnectionPanels(gtCamara));
  });

  it('name/url/recommendedUse/limitations/priority no cambiaron', () => {
    assert.equal(gtCamara?.name, 'Cámara de Comercio de Guatemala');
    assert.equal(gtCamara?.url, 'https://www.camaracomercio.com.gt/');
    assert.equal(
      gtCamara?.recommendedUse,
      'Directorio de empresas afiliadas a la Cámara. Identificar empresas activas en Guatemala.',
    );
    assert.deepEqual(gtCamara?.limitations, ['Solo empresas afiliadas', 'Sin API — consulta manual o directorio web']);
    assert.equal(gtCamara?.priority, 'P1');
  });
});
