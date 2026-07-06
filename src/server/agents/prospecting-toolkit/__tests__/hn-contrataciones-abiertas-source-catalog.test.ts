/**
 * Tests: hn_contrataciones_abiertas en Source Catalog
 *
 * Verifica que la fuente refleja el estado real post-snapshot:
 *   - aiFlowStatus = snapshot_persisted (no dry_run_validated)
 *   - connectionMode = read_only_snapshot (no not_persisted)
 *   - operationalStatus = partial_snapshot (no dry_run_validated)
 *   - nextAction menciona 72 proveedores cargados
 *   - Guardrails de no post-approval, no matching, no SAR, no Registro Mercantil
 *
 * Hito: Centroamérica.8C.4C
 * Previo: 8C.2 (dry_run_validated + not_persisted)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import { OPERATIONAL_STATUS_LABELS, AI_FLOW_STATUS_LABELS, CONNECTION_MODE_LABELS } from '@/modules/source-catalog/labels';

describe('hn_contrataciones_abiertas — Source Catalog entry (post-snapshot 8C.4C)', () => {
  const { sources } = getSourceCatalogViewModel();
  const source = sources.find((s) => s.key === 'hn_contrataciones_abiertas');

  it('existe en el Source Catalog', () => {
    assert.ok(source, 'La fuente hn_contrataciones_abiertas debe existir');
  });

  it('país = Honduras (HN)', () => {
    assert.ok(source?.countryCodes.includes('HN'), 'Debe incluir HN en countryCodes');
  });

  it('tipo = procurement', () => {
    assert.strictEqual(source?.type, 'procurement');
  });

  it('sellupUse = commercial_signal (señal B2G)', () => {
    assert.strictEqual(source?.sellupUse, 'commercial_signal');
  });

  // ── Estado post-snapshot ──────────────────────────────────────────────────

  it('aiFlowStatus = snapshot_persisted (snapshot piloto aplicado en 8C.4B.2B)', () => {
    assert.strictEqual(source?.aiFlowStatus, 'snapshot_persisted');
  });

  it('aiFlowStatus NO es dry_run_validated (estado anterior, ya superado)', () => {
    assert.notEqual(source?.aiFlowStatus, 'dry_run_validated');
  });

  it('connectionMode = read_only_snapshot (snapshot persistido sin post-approval)', () => {
    assert.strictEqual(source?.connectionMode, 'read_only_snapshot');
  });

  it('connectionMode NO es not_persisted (snapshot existe desde 8C.4B.2B)', () => {
    assert.notEqual(source?.connectionMode, 'not_persisted');
  });

  it('operationalStatus = partial_snapshot (72 filas, cobertura piloto)', () => {
    assert.strictEqual(source?.operationalStatus, 'partial_snapshot');
  });

  it('operationalStatus NO es dry_run_validated (estado anterior, ya superado)', () => {
    assert.notEqual(source?.operationalStatus, 'dry_run_validated');
  });

  // ── Labels visibles ──────────────────────────────────────────────────────

  it('label operationalStatus visible = "Snapshot parcial"', () => {
    const label = OPERATIONAL_STATUS_LABELS[source?.operationalStatus ?? 'dry_run_validated'];
    assert.strictEqual(label, 'Snapshot parcial');
  });

  it('label aiFlowStatus visible = "Snapshot persistido"', () => {
    const label = AI_FLOW_STATUS_LABELS[source?.aiFlowStatus ?? 'dry_run_validated'];
    assert.strictEqual(label, 'Snapshot persistido');
  });

  it('label connectionMode visible = "Read-only snapshot"', () => {
    const label = CONNECTION_MODE_LABELS[source?.connectionMode ?? 'not_persisted'];
    assert.strictEqual(label, 'Read-only snapshot');
  });

  // ── nextAction refleja snapshot persistido ────────────────────────────────

  it('nextAction menciona 72 proveedores cargados', () => {
    assert.ok(source?.nextAction?.includes('72'), 'nextAction debe mencionar 72 proveedores');
  });

  it('nextAction NO menciona "Dry-run" como estado actual', () => {
    const text = (source?.nextAction ?? '').toLowerCase();
    assert.ok(!text.includes('siguiente paso: snapshot'), 'no debe sugerir snapshot controlado como paso pendiente');
  });

  it('nextAction menciona revisión humana requerida', () => {
    const text = (source?.nextAction ?? '').toLowerCase();
    assert.ok(text.includes('revisión humana'), 'nextAction debe mencionar revisión humana');
  });

  it('nextAction menciona post-approval no habilitado', () => {
    const text = (source?.nextAction ?? '').toLowerCase();
    assert.ok(text.includes('post-approval'), 'nextAction debe mencionar post-approval');
  });

  // ── Sin post-approval ni matching ─────────────────────────────────────────

  it('NO está conectada a post-approval', () => {
    assert.notEqual(source?.aiFlowStatus, 'connected');
    assert.notEqual(source?.aiFlowStatus, 'connected_post_approval');
  });

  it('connectionMode NO implica escritura operativa automática', () => {
    assert.notEqual(source?.connectionMode, 'automatic_enrichment');
    assert.notEqual(source?.connectionMode, 'wizard_discovery');
    assert.notEqual(source?.connectionMode, 'credential_configured');
  });

  // ── Guardrails en limitations ─────────────────────────────────────────────

  it('limitations menciona que NO reemplaza SAR Honduras', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('sar')), 'Debe mencionar SAR Honduras');
  });

  it('limitations menciona que NO reemplaza Registro Mercantil', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('registro mercantil')), 'Debe mencionar Registro Mercantil');
  });

  it('limitations menciona post_approval_enabled = false', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('post-approval')), 'Debe mencionar ausencia de post-approval');
  });

  it('limitations menciona que NO tiene matching automático', () => {
    const lims = source?.limitations ?? [];
    assert.ok(lims.some((l) => l.toLowerCase().includes('matching automático')), 'Debe mencionar ausencia de matching');
  });

  it('limitations menciona que NO crea accounts ni prospect_candidates', () => {
    const lims = source?.limitations ?? [];
    assert.ok(
      lims.some((l) => l.toLowerCase().includes('accounts') || l.toLowerCase().includes('prospect_candidates')),
      'Debe mencionar que no crea accounts ni prospect_candidates',
    );
  });

  it('riskNotes menciona riesgo de personas naturales', () => {
    const risks = source?.riskNotes ?? [];
    assert.ok(risks.some((r) => r.toLowerCase().includes('personas naturales')), 'Debe mencionar riesgo personas naturales');
  });

  // ── recommendedUse ────────────────────────────────────────────────────────

  it('recommendedUse menciona ONCAE Honduras', () => {
    assert.ok((source?.recommendedUse ?? '').toLowerCase().includes('oncae'), 'Debe mencionar ONCAE');
  });

  it('recommendedUse menciona OCP Data Registry', () => {
    assert.ok((source?.recommendedUse ?? '').toLowerCase().includes('ocp data registry'), 'Debe mencionar OCP Data Registry');
  });

  it('recommendedUse menciona snapshot', () => {
    assert.ok((source?.recommendedUse ?? '').toLowerCase().includes('snapshot'), 'Debe mencionar snapshot');
  });

  // ── Visibilidad en tabs ───────────────────────────────────────────────────

  it('CTA esperado NO es Conectar (connectionMode != not_connected)', () => {
    assert.notEqual(source?.connectionMode, 'not_connected');
  });

  it('aparece en tab Todas: fuente existe en el catálogo completo', () => {
    const { sources: allSources } = getSourceCatalogViewModel();
    assert.ok(allSources.some((s) => s.key === 'hn_contrataciones_abiertas'));
  });

  // ── Regresión: otras fuentes no_persisted conservan su estado ─────────────

  it('regresión: not_persisted aún existe como connectionMode en el catálogo (otras fuentes)', () => {
    const { sources: allSources } = getSourceCatalogViewModel();
    const notPersistedSources = allSources.filter((s) => s.connectionMode === 'not_persisted');
    // Honduras ya no usa not_persisted — pero puede haber otras fuentes que sí
    const hnInNotPersisted = notPersistedSources.some((s) => s.key === 'hn_contrataciones_abiertas');
    assert.ok(!hnInNotPersisted, 'Honduras NO debe usar not_persisted tras el snapshot piloto');
  });

  it('regresión: dry_run_validated aún existe como aiFlowStatus en el catálogo (otras fuentes)', () => {
    const { sources: allSources } = getSourceCatalogViewModel();
    // Verificar que Honduras no regresionó a dry_run_validated
    const hn = allSources.find((s) => s.key === 'hn_contrataciones_abiertas');
    assert.notEqual(hn?.aiFlowStatus, 'dry_run_validated');
  });
});
