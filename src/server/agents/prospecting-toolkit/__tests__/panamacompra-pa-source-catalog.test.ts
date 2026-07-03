/**
 * Tests unitarios — Source Catalog pa_panamacompra_convenio
 *
 * Verifica que la entrada pa_panamacompra_convenio esté correctamente
 * registrada con todos los guardrails semánticos obligatorios.
 *
 * Hito: Centroamérica.5B
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';

const paConvenio = CATALOG_SOURCES.find((s) => s.key === 'pa_panamacompra_convenio');

// Fuentes de otras regiones — no deben cambiar
const crSicop = CATALOG_SOURCES.find((s) => s.key === 'cr_sicop');
const rdDgcp = CATALOG_SOURCES.find((s) => s.key === 'do_dgcp');
const mxDenue = CATALOG_SOURCES.find((s) => s.key === 'mx_denue');
const peSupat = CATALOG_SOURCES.find((s) => s.key === 'pe_sunat_bulk');
const clChile = CATALOG_SOURCES.find((s) => s.key === 'cl_chilecompra_ocds');
const coSiis = CATALOG_SOURCES.find((s) => s.key === 'co_siis');

describe('pa_panamacompra_convenio en Source Catalog — Centroamérica.5B', () => {

  // Caso 1: existe
  it('existe en CATALOG_SOURCES', () => {
    assert.ok(paConvenio, 'pa_panamacompra_convenio no encontrado en CATALOG_SOURCES');
  });

  // Caso 2: país PA
  it('countryCodes incluye PA', () => {
    assert.ok(paConvenio?.countryCodes.includes('PA'));
  });

  // Caso 3: type procurement
  it('type = procurement', () => {
    assert.equal(paConvenio?.type, 'procurement');
  });

  // Caso 4: sellupUse commercial_signal
  it('sellupUse = commercial_signal', () => {
    assert.equal(paConvenio?.sellupUse, 'commercial_signal');
  });

  // Caso 5: aiFlowStatus eligible_not_connected
  it('aiFlowStatus = eligible_not_connected', () => {
    assert.equal(paConvenio?.aiFlowStatus, 'eligible_not_connected');
  });

  // Caso 6: connectionMode not_connected
  it('connectionMode = not_connected', () => {
    assert.equal(paConvenio?.connectionMode, 'not_connected');
  });

  // Caso 7: operationalStatus pending_validation
  it('operationalStatus = pending_validation', () => {
    assert.equal(paConvenio?.operationalStatus, 'pending_validation');
  });

  // Caso 7b: no se presenta como fuente legal_registry
  it('type no es legal_registry', () => {
    assert.notEqual(paConvenio?.type, 'legal_registry');
  });

  // Caso 8: no se presenta como tax_registry
  it('type no es tax_registry o official_registry', () => {
    assert.notEqual(paConvenio?.type, 'official_registry');
  });

  // Caso 9: limitations menciona DGI
  it('limitations menciona DGI Panamá', () => {
    const hasGDI = paConvenio?.limitations?.some(
      (l) => l.toLowerCase().includes('dgi'),
    );
    assert.ok(hasGDI, 'limitations no menciona DGI Panamá');
  });

  // Caso 10: limitations menciona Registro Público
  it('limitations menciona Registro Público', () => {
    const hasRP = paConvenio?.limitations?.some(
      (l) => l.toLowerCase().includes('registro público') || l.toLowerCase().includes('registro publico'),
    );
    assert.ok(hasRP, 'limitations no menciona Registro Público de Panamá');
  });

  it('limitations menciona que no es fuente legal', () => {
    const hasLegal = paConvenio?.limitations?.some(
      (l) => l.toLowerCase().includes('legal'),
    );
    assert.ok(hasLegal, 'limitations no tiene guardrail de fuente legal');
  });

  it('limitations menciona que no es fuente tributaria', () => {
    const hasTax = paConvenio?.limitations?.some(
      (l) =>
        l.toLowerCase().includes('tributari') ||
        l.toLowerCase().includes('fiscal'),
    );
    assert.ok(hasTax, 'limitations no tiene guardrail tributario/fiscal');
  });

  it('limitations menciona cobertura limitada a Convenio Marco', () => {
    const hasCoverage = paConvenio?.limitations?.some(
      (l) => l.toLowerCase().includes('convenio marco'),
    );
    assert.ok(hasCoverage, 'limitations no aclara cobertura Convenio Marco');
  });

  it('url apunta a panamacompra.gob.pa', () => {
    assert.ok(paConvenio?.url?.includes('panamacompra.gob.pa'));
  });

  it('priority es P2', () => {
    assert.equal(paConvenio?.priority, 'P2');
  });

  it('automationLevel = medium', () => {
    assert.equal(paConvenio?.automationLevel, 'medium');
  });

  it('name incluye PanamaCompra', () => {
    assert.ok(paConvenio?.name?.includes('PanamaCompra'));
  });

  it('riskNotes menciona que no es fuente de validación de identidad', () => {
    const hasGuard = paConvenio?.riskNotes?.some(
      (r) => r.toLowerCase().includes('legal') || r.toLowerCase().includes('fiscal'),
    );
    assert.ok(hasGuard, 'riskNotes no tiene guardrail de uso');
  });

  it('riskNotes menciona que no usar searchOrderList ni ListarActosParametros', () => {
    const hasSentinel = paConvenio?.riskNotes?.some(
      (r) =>
        r.toLowerCase().includes('searchorderlist') ||
        r.toLowerCase().includes('listaractosparametros') ||
        r.toLowerCase().includes('listararctosparametros'),
    );
    assert.ok(hasSentinel, 'riskNotes no tiene guardrail de endpoints restringidos');
  });

  // ── Guardrail: otras regiones no cambian ─────────────────────────────────────

  it('CR cr_sicop sigue en CATALOG_SOURCES', () => {
    assert.ok(crSicop, 'cr_sicop no encontrado — no debe modificarse');
  });

  it('RD do_dgcp sigue en CATALOG_SOURCES', () => {
    assert.ok(rdDgcp, 'do_dgcp no encontrado');
  });

  it('MX mx_denue sigue en CATALOG_SOURCES', () => {
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
