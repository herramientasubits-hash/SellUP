/**
 * Tests unitarios — Source Catalog sv_comprasal
 *
 * Verifica que la entrada sv_comprasal esté correctamente registrada
 * con todos los guardrails semánticos obligatorios.
 *
 * Hito: Centroamérica.7C
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';

const svComprasal = CATALOG_SOURCES.find((s) => s.key === 'sv_comprasal');

// Guardrail: fuentes de otras regiones no deben cambiar
const crSicop = CATALOG_SOURCES.find((s) => s.key === 'cr_sicop');
const paConvenio = CATALOG_SOURCES.find((s) => s.key === 'pa_panamacompra_convenio');
const mxDenue = CATALOG_SOURCES.find((s) => s.key === 'mx_denue');
const rdDgcp = CATALOG_SOURCES.find((s) => s.key === 'do_dgcp');
const peSupat = CATALOG_SOURCES.find((s) => s.key === 'pe_sunat_bulk');

describe('sv_comprasal en Source Catalog — Centroamérica.7C', () => {

  it('existe en CATALOG_SOURCES', () => {
    assert.ok(svComprasal, 'sv_comprasal no encontrado en CATALOG_SOURCES');
  });

  it('countryCodes incluye SV', () => {
    assert.ok(svComprasal?.countryCodes.includes('SV'));
  });

  it('type = procurement', () => {
    assert.equal(svComprasal?.type, 'procurement');
  });

  it('sellupUse = commercial_signal', () => {
    assert.equal(svComprasal?.sellupUse, 'commercial_signal');
  });

  it('aiFlowStatus = signal_connected_read_only (señal B2G persistida, sin post-approval)', () => {
    assert.equal(svComprasal?.aiFlowStatus, 'signal_connected_read_only');
  });

  it('connectionMode = read_only_signal (no flujo automático)', () => {
    assert.equal(svComprasal?.connectionMode, 'read_only_signal');
  });

  it('operationalStatus = manual_signal_only (señales persistidas, revisión humana)', () => {
    assert.equal(svComprasal?.operationalStatus, 'manual_signal_only');
  });

  it('type no es legal_registry', () => {
    assert.notEqual(svComprasal?.type, 'legal_registry');
  });

  it('type no es tax_registry ni official_registry', () => {
    assert.notEqual(svComprasal?.type, 'official_registry');
    assert.notEqual(svComprasal?.type, 'tax_registry');
  });

  it('limitations menciona NIT', () => {
    const hasNit = svComprasal?.limitations?.some((l) => l.toLowerCase().includes('nit'));
    assert.ok(hasNit, 'limitations no menciona NIT');
  });

  it('limitations menciona NRC', () => {
    const hasNrc = svComprasal?.limitations?.some((l) => l.toLowerCase().includes('nrc'));
    assert.ok(hasNrc, 'limitations no menciona NRC');
  });

  it('limitations menciona Ministerio de Hacienda', () => {
    const hasHacienda = svComprasal?.limitations?.some(
      (l) => l.toLowerCase().includes('hacienda'),
    );
    assert.ok(hasHacienda, 'limitations no menciona Ministerio de Hacienda');
  });

  it('limitations menciona CNR', () => {
    const hasCnr = svComprasal?.limitations?.some((l) => l.toLowerCase().includes('cnr'));
    assert.ok(hasCnr, 'limitations no menciona CNR');
  });

  it('limitations menciona name-only / revisión humana', () => {
    const hasNameOnly = svComprasal?.limitations?.some(
      (l) =>
        l.toLowerCase().includes('name-only') ||
        l.toLowerCase().includes('name only') ||
        l.toLowerCase().includes('nombre') ||
        l.toLowerCase().includes('revisión') ||
        l.toLowerCase().includes('human'),
    );
    assert.ok(hasNameOnly, 'limitations no menciona name-only o revisión humana');
  });

  it('no se presenta como aiFlowStatus connected_post_approval', () => {
    assert.notEqual(svComprasal?.aiFlowStatus, 'connected_post_approval');
  });

  it('no se presenta como complete_snapshot', () => {
    assert.notEqual(svComprasal?.operationalStatus, 'complete_snapshot');
  });

  it('url apunta a comprasal.gob.sv', () => {
    assert.ok(svComprasal?.url?.includes('comprasal.gob.sv'));
  });

  it('priority es P2', () => {
    assert.equal(svComprasal?.priority, 'P2');
  });

  it('automationLevel = medium', () => {
    assert.equal(svComprasal?.automationLevel, 'medium');
  });

  it('name incluye COMPRASAL', () => {
    assert.ok(svComprasal?.name?.includes('COMPRASAL'));
  });

  // ── Guardrail: otras regiones no cambian ─────────────────────────────────────

  it('CR cr_sicop sigue en CATALOG_SOURCES', () => {
    assert.ok(crSicop, 'cr_sicop no encontrado — no debe modificarse');
  });

  it('PA pa_panamacompra_convenio sigue en CATALOG_SOURCES', () => {
    assert.ok(paConvenio, 'pa_panamacompra_convenio no encontrado');
  });

  it('MX mx_denue sigue en CATALOG_SOURCES', () => {
    assert.ok(mxDenue, 'mx_denue no encontrado');
  });

  it('RD do_dgcp sigue en CATALOG_SOURCES', () => {
    assert.ok(rdDgcp, 'do_dgcp no encontrado');
  });

  it('PE pe_sunat_bulk sigue en CATALOG_SOURCES', () => {
    assert.ok(peSupat, 'pe_sunat_bulk no encontrado');
  });

  it('CR cr_sicop mantiene aiFlowStatus connected_post_approval', () => {
    assert.equal(crSicop?.aiFlowStatus, 'connected_post_approval');
  });
});
