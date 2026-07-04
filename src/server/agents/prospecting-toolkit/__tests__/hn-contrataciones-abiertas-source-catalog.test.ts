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

  it('operationalStatus = pending_validation (no operacional completa)', () => {
    assert.strictEqual(source?.operationalStatus, 'pending_validation');
    assert.notEqual(source?.operationalStatus, 'operational_verified');
  });

  it('sellupUse = commercial_signal (señal B2G)', () => {
    assert.strictEqual(source?.sellupUse, 'commercial_signal');
  });
});
