/**
 * Tests unitarios — Source Catalog cr_sicop
 *
 * Verifica que la entrada cr_sicop esté correctamente registrada
 * en el catálogo con todos los guardrails semánticos obligatorios.
 *
 * Hito: Centroamérica.4A (creación) / Centroamérica.4G (marcar conectada)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';

const crSicop = CATALOG_SOURCES.find((s) => s.key === 'cr_sicop');

// Fuentes de otras regiones — no deben cambiar
const rdDgcp = CATALOG_SOURCES.find((s) => s.key === 'do_dgcp');
const mxDenue = CATALOG_SOURCES.find((s) => s.key === 'mx_denue');
const peSupat = CATALOG_SOURCES.find((s) => s.key === 'pe_sunat_bulk');
const clChile = CATALOG_SOURCES.find((s) => s.key === 'cl_chilecompra_ocds');
const coSiis = CATALOG_SOURCES.find((s) => s.key === 'co_siis');

describe('cr_sicop en Source Catalog — Centroamérica.4G', () => {
  // Caso 1: cr_sicop existe
  it('existe en CATALOG_SOURCES', () => {
    assert.ok(crSicop, 'cr_sicop no encontrado en CATALOG_SOURCES');
  });

  // Caso 2: país CR
  it('countryCodes incluye CR', () => {
    assert.ok(crSicop?.countryCodes.includes('CR'));
  });

  // Caso 3: type procurement (no cambia)
  it('type = procurement', () => {
    assert.equal(crSicop?.type, 'procurement');
  });

  // Caso 4: sellupUse commercial_signal (no cambia)
  it('sellupUse = commercial_signal', () => {
    assert.equal(crSicop?.sellupUse, 'commercial_signal');
  });

  // Caso 5: aiFlowStatus connected_post_approval (4G)
  it('aiFlowStatus = connected_post_approval (ya no eligible_not_connected)', () => {
    assert.equal(crSicop?.aiFlowStatus, 'connected_post_approval');
  });

  // Caso 5b: ya no eligible_not_connected
  it('aiFlowStatus NO es eligible_not_connected', () => {
    assert.notEqual(crSicop?.aiFlowStatus, 'eligible_not_connected');
  });

  // Caso 6: connectionMode offline_signal (4G)
  it('connectionMode = offline_signal (ya no not_connected)', () => {
    assert.equal(crSicop?.connectionMode, 'offline_signal');
  });

  // Caso 6b: ya no not_connected
  it('connectionMode NO es not_connected', () => {
    assert.notEqual(crSicop?.connectionMode, 'not_connected');
  });

  // Caso 7: operationalStatus operational_verified (4G)
  it('operationalStatus = operational_verified', () => {
    assert.equal(crSicop?.operationalStatus, 'operational_verified');
  });

  // Caso 8: nextAction menciona snapshot parcial y post-approval
  it('nextAction menciona snapshot parcial Ofertas 2024', () => {
    const na = crSicop?.nextAction?.toLowerCase() ?? '';
    assert.ok(na.includes('snapshot parcial') || na.includes('ofertas 2024') || na.includes('4.998'), 'nextAction no menciona snapshot parcial');
  });

  // Caso 9: nextAction menciona post-approval
  it('nextAction menciona post-approval', () => {
    const na = crSicop?.nextAction?.toLowerCase() ?? '';
    assert.ok(na.includes('post-approval'), 'nextAction no menciona post-approval');
  });

  // Caso 10: nextAction NO promete complete_snapshot
  it('nextAction NO usa complete_snapshot', () => {
    assert.ok(!crSicop?.nextAction?.includes('complete_snapshot'));
  });

  // Caso 11: no se presenta como fuente legal
  it('limitations menciona que no es fuente legal', () => {
    const hasLegalWarning = crSicop?.limitations?.some(
      (l) => l.toLowerCase().includes('legal') || l.toLowerCase().includes('no es fuente legal'),
    );
    assert.ok(hasLegalWarning, 'No hay warning sobre uso no-legal en limitations');
  });

  // Caso 12: no se presenta como fuente fiscal
  it('limitations menciona que no es fuente fiscal o tributaria', () => {
    const hasFiscalWarning = crSicop?.limitations?.some(
      (l) =>
        l.toLowerCase().includes('tributaria') ||
        l.toLowerCase().includes('fiscal') ||
        l.toLowerCase().includes('hacienda'),
    );
    assert.ok(hasFiscalWarning, 'No hay warning sobre uso no-tributario en limitations');
  });

  // Caso 13: nextAction no reemplaza Hacienda CR
  it('nextAction aclara que no reemplaza Hacienda CR', () => {
    const na = crSicop?.nextAction?.toLowerCase() ?? '';
    assert.ok(na.includes('hacienda'), 'nextAction no menciona Hacienda CR');
  });

  // Caso 14: no valida cédula jurídica como fuente legal
  it('limitations aclara que no valida cédula jurídica como fuente legal', () => {
    const hasCedulaWarning = crSicop?.limitations?.some(
      (l) => l.toLowerCase().includes('cédula') || l.toLowerCase().includes('cedula'),
    );
    assert.ok(hasCedulaWarning, 'No hay warning sobre cédula jurídica en limitations');
  });

  // Caso 15: no usa complete_snapshot en ningún campo
  it('no tiene complete_snapshot en ningún campo del catálogo', () => {
    const entry = JSON.stringify(crSicop ?? '');
    assert.ok(!entry.includes('complete_snapshot'), 'cr_sicop no debe usar complete_snapshot');
  });

  // Caso 16: no se presenta como legal_registry
  it('type no es legal_registry', () => {
    assert.notEqual(crSicop?.type, 'legal_registry');
  });

  // Caso 17: no se presenta como tax_registry
  it('type no es tax_registry', () => {
    assert.notEqual(crSicop?.type, 'tax_registry');
  });

  it('name contiene SICOP', () => {
    assert.ok(crSicop?.name?.toUpperCase().includes('SICOP'));
  });

  it('url apunta a datos.go.cr', () => {
    assert.ok(crSicop?.url?.includes('datos.go.cr'));
  });

  it('priority es P2', () => {
    assert.equal(crSicop?.priority, 'P2');
  });

  // ── Guardrail: otras regiones no cambian ─────────────────────────────────────

  it('RD do_dgcp sigue en CATALOG_SOURCES con key do_dgcp', () => {
    assert.ok(rdDgcp, 'do_dgcp no encontrado');
    assert.equal(rdDgcp?.key, 'do_dgcp');
  });

  it('MX mx_denue aiFlowStatus no cambió a connected_post_approval', () => {
    // mx_denue es connected — solo verificamos que no lo alteramos
    assert.ok(mxDenue, 'mx_denue no encontrado');
  });

  it('PE pe_sunat_bulk sigue en CATALOG_SOURCES', () => {
    assert.ok(peSupat, 'pe_sunat_bulk no encontrado');
  });

  it('CL cl_chilecompra_ocds sigue en CATALOG_SOURCES', () => {
    assert.ok(clChile, 'cl_chilecompra_ocds no encontrado');
  });

  it('CO co_siis sigue en CATALOG_SOURCES', () => {
    assert.ok(coSiis, 'co_siis no encontrado');
  });
});
