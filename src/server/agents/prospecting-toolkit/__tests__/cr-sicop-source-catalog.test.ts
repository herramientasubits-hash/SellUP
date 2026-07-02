/**
 * Tests unitarios — Source Catalog cr_sicop
 *
 * Verifica que la entrada cr_sicop esté correctamente registrada
 * en el catálogo con todos los guardrails semánticos obligatorios.
 *
 * Hito: Centroamérica.4A
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';

const crSicop = CATALOG_SOURCES.find((s) => s.key === 'cr_sicop');

describe('cr_sicop en Source Catalog', () => {
  // Caso 1: cr_sicop existe
  it('existe en CATALOG_SOURCES', () => {
    assert.ok(crSicop, 'cr_sicop no encontrado en CATALOG_SOURCES');
  });

  // Caso 2: país CR
  it('countryCodes incluye CR', () => {
    assert.ok(crSicop?.countryCodes.includes('CR'));
  });

  // Caso 3: type procurement
  it('type = procurement', () => {
    assert.equal(crSicop?.type, 'procurement');
  });

  // Caso 4: sellupUse commercial_signal
  it('sellupUse = commercial_signal', () => {
    assert.equal(crSicop?.sellupUse, 'commercial_signal');
  });

  // Caso 5: aiFlowStatus eligible_not_connected
  it('aiFlowStatus = eligible_not_connected', () => {
    assert.equal(crSicop?.aiFlowStatus, 'eligible_not_connected');
  });

  // Caso 6: connectionMode not_connected
  it('connectionMode = not_connected', () => {
    assert.equal(crSicop?.connectionMode, 'not_connected');
  });

  // Caso 7: no se presenta como fuente legal
  it('limitations menciona que no es fuente legal', () => {
    const hasLegalWarning = crSicop?.limitations?.some(
      (l) => l.toLowerCase().includes('legal') || l.toLowerCase().includes('no es fuente legal'),
    );
    assert.ok(hasLegalWarning, 'No hay warning sobre uso no-legal en limitations');
  });

  // Caso 8: no se presenta como fuente fiscal
  it('limitations menciona que no es fuente fiscal o tributaria', () => {
    const hasFiscalWarning = crSicop?.limitations?.some(
      (l) =>
        l.toLowerCase().includes('tributaria') ||
        l.toLowerCase().includes('fiscal') ||
        l.toLowerCase().includes('hacienda'),
    );
    assert.ok(hasFiscalWarning, 'No hay warning sobre uso no-tributario en limitations');
  });

  it('name contiene SICOP', () => {
    assert.ok(crSicop?.name?.toUpperCase().includes('SICOP'));
  });

  it('url apunta a datos.go.cr', () => {
    assert.ok(crSicop?.url?.includes('datos.go.cr'));
  });

  it('operationalStatus es pending_validation (no operational_verified todavía)', () => {
    assert.equal(crSicop?.operationalStatus, 'pending_validation');
  });

  it('priority es P2', () => {
    assert.equal(crSicop?.priority, 'P2');
  });
});
