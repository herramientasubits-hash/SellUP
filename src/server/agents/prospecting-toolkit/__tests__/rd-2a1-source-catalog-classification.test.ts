/**
 * Tests — RepúblicaDominicana.2A.1 / 2H — Clasificación visual de fuentes RD
 *
 * Verifica que do_camaratic, do_camara_sto_domingo y do_dgcp tienen
 * los campos operativos correctos y no caen en fallback pending_classification.
 * RD.2H: do_dgcp queda como connected_post_approval (offline_signal) — señal
 * procurement B2G local, partial_snapshot 2020–2026, no fuente legal/fiscal.
 * Verifica que rd_dgii_bulk, México, Perú y Chile no fueron alterados.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';
import { resolveOperationalClassification } from '../../../../modules/source-catalog/operational-classification';

function getSource(key: string) {
  const source = CATALOG_SOURCES.find(s => s.key === key);
  if (!source) throw new Error(`Source not found: ${key}`);
  return source;
}

describe('RD.2A.1 — do_camaratic', () => {
  it('existe en el catálogo', () => {
    assert.ok(CATALOG_SOURCES.find(s => s.key === 'do_camaratic'));
  });

  it('no cae en pending_classification (tiene los 3 campos)', () => {
    const s = getSource('do_camaratic');
    const c = resolveOperationalClassification(s);
    assert.notEqual(c.sellupUse, 'pending_classification', 'sellupUse no debe ser fallback');
    assert.notEqual(c.aiFlowStatus, 'pending_classification', 'aiFlowStatus no debe ser fallback');
  });

  it('sellupUse es manual_reference', () => {
    assert.equal(getSource('do_camaratic').sellupUse, 'manual_reference');
  });

  it('aiFlowStatus es manual_only', () => {
    assert.equal(getSource('do_camaratic').aiFlowStatus, 'manual_only');
  });

  it('connectionMode no es not_connected — no debe producir CTA Conectar', () => {
    assert.notEqual(getSource('do_camaratic').connectionMode, 'not_connected');
  });

  it('connectionMode es not_applicable (fuente manual, sin credencial)', () => {
    assert.equal(getSource('do_camaratic').connectionMode, 'not_applicable');
  });

  it('tipo es industry_association', () => {
    assert.equal(getSource('do_camaratic').type, 'industry_association');
  });

  it('nextAction no está vacío', () => {
    const na = getSource('do_camaratic').nextAction ?? '';
    assert.ok(na.length > 0, 'nextAction debe tener contenido');
  });
});

describe('RD.2A.1 — do_camara_sto_domingo', () => {
  it('existe en el catálogo', () => {
    assert.ok(CATALOG_SOURCES.find(s => s.key === 'do_camara_sto_domingo'));
  });

  it('no cae en pending_classification', () => {
    const s = getSource('do_camara_sto_domingo');
    const c = resolveOperationalClassification(s);
    assert.notEqual(c.sellupUse, 'pending_classification');
    assert.notEqual(c.aiFlowStatus, 'pending_classification');
  });

  it('sellupUse es manual_reference', () => {
    assert.equal(getSource('do_camara_sto_domingo').sellupUse, 'manual_reference');
  });

  it('aiFlowStatus es manual_only', () => {
    assert.equal(getSource('do_camara_sto_domingo').aiFlowStatus, 'manual_only');
  });

  it('connectionMode no es not_connected — no debe producir CTA Conectar', () => {
    assert.notEqual(getSource('do_camara_sto_domingo').connectionMode, 'not_connected');
  });

  it('connectionMode es not_applicable (fuente manual, sin credencial)', () => {
    assert.equal(getSource('do_camara_sto_domingo').connectionMode, 'not_applicable');
  });

  it('tipo es industry_association', () => {
    assert.equal(getSource('do_camara_sto_domingo').type, 'industry_association');
  });
});

describe('RD.2H — do_dgcp connected_post_approval', () => {
  it('existe en el catálogo', () => {
    assert.ok(CATALOG_SOURCES.find(s => s.key === 'do_dgcp'));
  });

  it('no cae en pending_classification', () => {
    const s = getSource('do_dgcp');
    const c = resolveOperationalClassification(s);
    assert.notEqual(c.sellupUse, 'pending_classification');
    assert.notEqual(c.aiFlowStatus, 'pending_classification');
  });

  it('aiFlowStatus es connected_post_approval (RD.2H)', () => {
    assert.equal(getSource('do_dgcp').aiFlowStatus, 'connected_post_approval');
  });

  it('ya NO es eligible_not_connected', () => {
    assert.notEqual(getSource('do_dgcp').aiFlowStatus, 'eligible_not_connected');
  });

  it('connectionMode es offline_signal (snapshot local, sin credenciales)', () => {
    assert.equal(getSource('do_dgcp').connectionMode, 'offline_signal');
  });

  it('connectionMode NO es not_connected — no debe mostrar CTA Conectar', () => {
    assert.notEqual(getSource('do_dgcp').connectionMode, 'not_connected');
  });

  it('tipo es procurement (señal B2G, no legal/tributario)', () => {
    assert.equal(getSource('do_dgcp').type, 'procurement');
  });

  it('sellupUse es commercial_signal', () => {
    assert.equal(getSource('do_dgcp').sellupUse, 'commercial_signal');
  });

  it('nextAction menciona partial_snapshot y no reemplaza DGII', () => {
    const na = getSource('do_dgcp').nextAction ?? '';
    assert.ok(na.includes('53.974'), 'nextAction debe mencionar 53.974 proveedores');
    assert.ok(na.includes('DGII'), 'nextAction debe mencionar DGII');
    assert.ok(na.length > 0, 'nextAction no debe estar vacío');
  });

  it('no se presenta como legal_registry', () => {
    assert.notEqual(getSource('do_dgcp').type, 'legal_registry');
  });

  it('no se presenta como tax_registry', () => {
    assert.notEqual(getSource('do_dgcp').type, 'tax_registry');
  });
});

describe('RD.2A.1 — rd_dgii_bulk no cambia', () => {
  it('rd_dgii_bulk existe', () => {
    assert.ok(CATALOG_SOURCES.find(s => s.key === 'rd_dgii_bulk'));
  });

  it('rd_dgii_bulk no fue alterado (sellupUse definido)', () => {
    const s = CATALOG_SOURCES.find(s => s.key === 'rd_dgii_bulk');
    assert.ok(s?.sellupUse, 'rd_dgii_bulk debe tener sellupUse definido');
  });
});

describe('RD.2A.1 — fuentes de otros países no afectadas', () => {
  it('pe_sunat_bulk existe', () => {
    assert.ok(CATALOG_SOURCES.find(s => s.key === 'pe_sunat_bulk'));
  });

  it('pe_sunat_bulk aiFlowStatus sigue siendo connected_post_approval', () => {
    assert.equal(getSource('pe_sunat_bulk').aiFlowStatus, 'connected_post_approval');
  });

  it('cl_chilecompra_ocds existe', () => {
    assert.ok(CATALOG_SOURCES.find(s => s.key === 'cl_chilecompra_ocds'));
  });

  it('cl_chilecompra_ocds aiFlowStatus sigue siendo connected_post_approval', () => {
    assert.equal(getSource('cl_chilecompra_ocds').aiFlowStatus, 'connected_post_approval');
  });

  it('mx_denue existe', () => {
    const mx = CATALOG_SOURCES.find(s => s.key === 'mx_denue');
    assert.ok(mx, 'mx_denue debe existir');
  });
});
