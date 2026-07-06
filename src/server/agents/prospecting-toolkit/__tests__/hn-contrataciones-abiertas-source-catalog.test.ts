/**
 * Tests: hn_contrataciones_abiertas en Source Catalog
 *
 * Verifica que la fuente existe, está en estado dry-run validado / sin persistencia,
 * y NO tiene flags de conexión operativa.
 *
 * Hito: Centroamérica.8C.2
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import { OPERATIONAL_STATUS_LABELS } from '@/modules/source-catalog/labels';

describe('hn_contrataciones_abiertas — Source Catalog entry', () => {
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

  it('aiFlowStatus = dry_run_validated', () => {
    assert.strictEqual(source?.aiFlowStatus, 'dry_run_validated');
  });

  it('connectionMode = not_persisted', () => {
    assert.strictEqual(source?.connectionMode, 'not_persisted');
  });

  it('NO está conectada a post-approval', () => {
    assert.notEqual(source?.aiFlowStatus, 'connected');
    assert.notEqual(source?.aiFlowStatus, 'connected_post_approval');
  });

  it('connectionMode NO implica escritura operativa', () => {
    assert.notEqual(source?.connectionMode, 'automatic_enrichment');
    assert.notEqual(source?.connectionMode, 'offline_signal');
    assert.notEqual(source?.connectionMode, 'wizard_discovery');
    assert.notEqual(source?.connectionMode, 'credential_configured');
  });

  it('nextAction menciona 99 RTN únicos', () => {
    assert.ok(source?.nextAction?.includes('99 RTN'), 'nextAction debe mencionar 99 RTN');
  });

  it('nextAction NO menciona conexión operativa completa', () => {
    const text = (source?.nextAction ?? '').toLowerCase();
    assert.ok(!text.includes('post-approval activo'), 'no debe mencionar post-approval activo');
    assert.ok(!text.includes('matching automático activo'), 'no debe mencionar matching automático activo');
  });

  it('limitations menciona que NO reemplaza SAR Honduras', () => {
    const lims = source?.limitations ?? [];
    assert.ok(
      lims.some((l) => l.toLowerCase().includes('sar')),
      'Debe mencionar SAR Honduras en limitations'
    );
  });

  it('limitations menciona que NO reemplaza Registro Mercantil', () => {
    const lims = source?.limitations ?? [];
    assert.ok(
      lims.some((l) => l.toLowerCase().includes('registro mercantil')),
      'Debe mencionar Registro Mercantil en limitations'
    );
  });

  it('limitations menciona que NO tiene post-approval automático', () => {
    const lims = source?.limitations ?? [];
    assert.ok(
      lims.some((l) => l.toLowerCase().includes('post-approval')),
      'Debe mencionar ausencia de post-approval en limitations'
    );
  });

  it('limitations menciona que NO tiene matching automático', () => {
    const lims = source?.limitations ?? [];
    assert.ok(
      lims.some((l) => l.toLowerCase().includes('matching automático')),
      'Debe mencionar ausencia de matching automático en limitations'
    );
  });

  it('limitations menciona que NO crea accounts ni prospect_candidates', () => {
    const lims = source?.limitations ?? [];
    assert.ok(
      lims.some((l) => l.toLowerCase().includes('accounts') || l.toLowerCase().includes('prospect_candidates')),
      'Debe mencionar que no crea accounts ni prospect_candidates'
    );
  });

  it('riskNotes menciona riesgo de personas naturales', () => {
    const risks = source?.riskNotes ?? [];
    assert.ok(
      risks.some((r) => r.toLowerCase().includes('personas naturales')),
      'riskNotes debe mencionar riesgo de personas naturales'
    );
  });

  it('operationalStatus = dry_run_validated (dry-run real completado, sin persistencia)', () => {
    assert.strictEqual(source?.operationalStatus, 'dry_run_validated');
    assert.notEqual(source?.operationalStatus, 'pending_validation');
    assert.notEqual(source?.operationalStatus, 'operational_verified');
  });

  it('sellupUse = commercial_signal (señal B2G)', () => {
    assert.strictEqual(source?.sellupUse, 'commercial_signal');
  });

  // ── Visibilidad en tabs de Source Catalog ────────────────────────────────
  // filterTab('operativas') incluye dry_run_validated cuando sellupUse no excluye la fuente.
  // Estos tests verifican que los campos de la fuente cumplen esa condición.

  it('aparece en tab Operativas IA: aiFlowStatus = dry_run_validated cumple la condición', () => {
    assert.strictEqual(source?.aiFlowStatus, 'dry_run_validated');
  });

  it('aparece en tab Operativas IA: sellupUse no es técnico ni manual', () => {
    const excluded = ['technical_container', 'contextual_signal', 'manual_reference', 'not_for_ai_flow'];
    assert.ok(
      !excluded.includes(source?.sellupUse ?? ''),
      `sellupUse="${source?.sellupUse}" no debe ser uno de los excluidos en Operativas IA`,
    );
  });

  it('aparece en tab Todas: fuente existe en el catálogo completo', () => {
    const { sources: allSources } = getSourceCatalogViewModel();
    assert.ok(
      allSources.some((s) => s.key === 'hn_contrataciones_abiertas'),
      'hn_contrataciones_abiertas debe estar en el catálogo completo',
    );
  });

  it('CTA esperado NO es Conectar (connectionMode != not_connected)', () => {
    assert.notEqual(
      source?.connectionMode,
      'not_connected',
      'connectionMode no debe ser not_connected — CTA debe ser Ver detalle, no Conectar',
    );
  });

  // ── 8C.2B: estado, credenciales y validación técnica ────────────────────────

  it('label visible NO es "Pendiente validación"', () => {
    const label = OPERATIONAL_STATUS_LABELS[source?.operationalStatus ?? 'pending_validation'];
    assert.notEqual(label, 'Pendiente validación', 'El label visible no debe ser "Pendiente validación"');
  });

  it('label visible es "Validación técnica completada" (dry_run_validated)', () => {
    const label = OPERATIONAL_STATUS_LABELS[source?.operationalStatus ?? 'pending_validation'];
    assert.strictEqual(label, 'Validación técnica completada');
  });

  it('connectionMode = not_persisted implica que no se requieren credenciales de API', () => {
    assert.strictEqual(source?.connectionMode, 'not_persisted');
    assert.notEqual(source?.connectionMode, 'credential_configured');
  });

  it('nextAction menciona OCP Data Registry o feed público', () => {
    const text = (source?.nextAction ?? '').toLowerCase();
    // nextAction o recommendedUse debe evidenciar que la fuente es pública / OCP
    const recommended = (source?.recommendedUse ?? '').toLowerCase();
    const mentionsOcp = text.includes('ocp') || recommended.includes('ocp data registry');
    assert.ok(mentionsOcp, 'nextAction o recommendedUse debe mencionar OCP Data Registry');
  });

  it('recommendedUse menciona ONCAE Honduras', () => {
    const text = (source?.recommendedUse ?? '').toLowerCase();
    assert.ok(text.includes('oncae'), 'recommendedUse debe mencionar ONCAE');
  });

  it('recommendedUse menciona OCP Data Registry', () => {
    const text = (source?.recommendedUse ?? '').toLowerCase();
    assert.ok(text.includes('ocp data registry'), 'recommendedUse debe mencionar OCP Data Registry');
  });

  it('nextAction menciona 99 RTN únicos válidos (evidencia del dry-run)', () => {
    assert.ok(source?.nextAction?.includes('99 RTN'), 'nextAction debe mencionar 99 RTN');
  });

  it('limitations NO implica persistencia activa (no post-approval, no matching)', () => {
    const lims = (source?.limitations ?? []).join(' ').toLowerCase();
    assert.ok(lims.includes('post-approval'), 'debe mencionar ausencia de post-approval');
    assert.ok(lims.includes('matching automático'), 'debe mencionar ausencia de matching automático');
    assert.ok(!lims.includes('post-approval activo'), 'no debe afirmar que post-approval está activo');
  });

  it('aiFlowStatus = dry_run_validated y no connected (sin post-approval)', () => {
    assert.strictEqual(source?.aiFlowStatus, 'dry_run_validated');
    assert.notEqual(source?.aiFlowStatus, 'connected');
    assert.notEqual(source?.aiFlowStatus, 'connected_post_approval');
  });

  it('connectionMode = not_persisted (sin persistencia activa)', () => {
    assert.strictEqual(source?.connectionMode, 'not_persisted');
    assert.notEqual(source?.connectionMode, 'automatic_enrichment');
    assert.notEqual(source?.connectionMode, 'wizard_discovery');
  });
});
