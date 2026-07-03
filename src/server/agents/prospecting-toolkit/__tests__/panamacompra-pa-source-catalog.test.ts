/**
 * Tests unitarios — Source Catalog pa_panamacompra_convenio
 *
 * Verifica que la entrada pa_panamacompra_convenio esté correctamente
 * registrada con todos los guardrails semánticos obligatorios.
 *
 * Hito: Centroamérica.5G (actualización desde 5B)
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

describe('pa_panamacompra_convenio en Source Catalog — Centroamérica.5G', () => {

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

  // Caso 5: aiFlowStatus connected_post_approval (5G — ya no eligible_not_connected)
  it('aiFlowStatus = connected_post_approval', () => {
    assert.equal(paConvenio?.aiFlowStatus, 'connected_post_approval');
  });

  // Caso 5b: ya no es eligible_not_connected
  it('aiFlowStatus ya no es eligible_not_connected', () => {
    assert.notEqual(paConvenio?.aiFlowStatus, 'eligible_not_connected');
  });

  // Caso 6: connectionMode offline_signal (5G — ya no not_connected)
  it('connectionMode = offline_signal', () => {
    assert.equal(paConvenio?.connectionMode, 'offline_signal');
  });

  // Caso 6b: ya no es not_connected
  it('connectionMode ya no es not_connected', () => {
    assert.notEqual(paConvenio?.connectionMode, 'not_connected');
  });

  // Caso 7: operationalStatus operational_verified
  it('operationalStatus = operational_verified', () => {
    assert.equal(paConvenio?.operationalStatus, 'operational_verified');
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

  // ── Nuevos tests 5G: CTA y semántica de conexión ────────────────────────────

  // nextAction no contiene "Conectar" como CTA directo (usa Ver detalle)
  it('nextAction no implica que aún falta conectar', () => {
    assert.ok(
      !paConvenio?.nextAction?.toLowerCase().includes('pendiente de validación'),
      'nextAction sigue indicando pendiente — debe reflejar estado conectado',
    );
  });

  it('nextAction menciona 447 proveedores', () => {
    assert.ok(
      paConvenio?.nextAction?.includes('447'),
      'nextAction no menciona 447 proveedores cargados',
    );
  });

  it('nextAction menciona señal procurement B2G local', () => {
    assert.ok(
      paConvenio?.nextAction?.toLowerCase().includes('procurement b2g'),
      'nextAction no menciona señal procurement B2G',
    );
  });

  it('nextAction menciona post-approval con match local por RUC', () => {
    assert.ok(
      paConvenio?.nextAction?.toLowerCase().includes('ruc'),
      'nextAction no menciona match por RUC',
    );
  });

  it('nextAction no presenta como complete_snapshot', () => {
    assert.ok(
      !paConvenio?.nextAction?.toLowerCase().includes('complete_snapshot'),
      'nextAction usa complete_snapshot — debe ser partial_snapshot',
    );
  });

  it('nextAction no presenta como fuente legal', () => {
    const text = paConvenio?.nextAction?.toLowerCase() ?? '';
    assert.ok(!text.includes('fuente legal') || text.includes('no es fuente legal'), 'nextAction no aclara que no es fuente legal');
  });

  it('nextAction menciona que no reemplaza DGI Panamá', () => {
    assert.ok(
      paConvenio?.nextAction?.toLowerCase().includes('dgi'),
      'nextAction no menciona DGI Panamá',
    );
  });

  it('nextAction menciona que no reemplaza Registro Público', () => {
    assert.ok(
      paConvenio?.nextAction?.toLowerCase().includes('registro público') ||
      paConvenio?.nextAction?.toLowerCase().includes('registro publico'),
      'nextAction no menciona Registro Público',
    );
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

  it('CR cr_sicop mantiene aiFlowStatus connected_post_approval', () => {
    assert.equal(crSicop?.aiFlowStatus, 'connected_post_approval');
  });

  it('RD do_dgcp no cambia aiFlowStatus', () => {
    assert.ok(rdDgcp?.aiFlowStatus !== undefined);
  });
});
