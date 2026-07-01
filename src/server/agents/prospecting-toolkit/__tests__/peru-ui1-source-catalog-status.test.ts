/**
 * Tests — Perú.UI.1 — SUNAT Bulk Source Catalog status correction
 *
 * Verifica que pe_sunat_bulk refleja su estado real (snapshot completo,
 * post-approval activo, sin credenciales requeridas) y que fuentes no
 * relacionadas (México, RD, Chile) no fueron alteradas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';
import {
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
} from '../../../../modules/source-catalog/labels';

const sunatBulk = CATALOG_SOURCES.find(s => s.key === 'pe_sunat_bulk');
const migoApi = CATALOG_SOURCES.find(s => s.key === 'pe_migo_api');
const denuemexico = CATALOG_SOURCES.find(s => s.key === 'mx_denue');
const dgcp = CATALOG_SOURCES.find(s => s.key === 'do_dgcp');
const chilecompraOcds = CATALOG_SOURCES.find(s => s.key === 'cl_chilecompra_ocds');

// ── pe_sunat_bulk ─────────────────────────────────────────────────────────────

describe('Perú.UI.1 — pe_sunat_bulk catalog status', () => {
  it('entry exists in catalog', () => {
    assert.ok(sunatBulk, 'pe_sunat_bulk debe existir en el catálogo');
  });

  it('aiFlowStatus is connected_post_approval (not eligible_not_connected)', () => {
    assert.equal(sunatBulk?.aiFlowStatus, 'connected_post_approval');
  });

  it('label does NOT say "Apta no conectada"', () => {
    const label = AI_FLOW_STATUS_LABELS[sunatBulk!.aiFlowStatus!];
    assert.notEqual(label, 'Apta no conectada');
  });

  it('connectionMode is offline_signal (not not_connected — no Conectar CTA)', () => {
    assert.equal(sunatBulk?.connectionMode, 'offline_signal');
  });

  it('connectionMode label is NOT "No conectada"', () => {
    const label = CONNECTION_MODE_LABELS[sunatBulk!.connectionMode!];
    assert.notEqual(label, 'No conectada');
  });

  it('nextAction mentions snapshot loaded and post-approval', () => {
    const na = sunatBulk?.nextAction ?? '';
    assert.ok(
      na.toLowerCase().includes('snapshot') || na.toLowerCase().includes('post-approval'),
      `nextAction debe mencionar snapshot o post-approval: "${na}"`,
    );
  });

  it('nextAction does NOT say "Requiere conector" (stale)', () => {
    const na = sunatBulk?.nextAction ?? '';
    assert.ok(
      !na.toLowerCase().includes('requiere conector'),
      `nextAction no debe decir "Requiere conector": "${na}"`,
    );
  });

  it('sellupUse remains enrichment', () => {
    assert.equal(sunatBulk?.sellupUse, 'enrichment');
  });

  it('type remains official_registry (legal source)', () => {
    assert.equal(sunatBulk?.type, 'official_registry');
  });

  it('priority remains P0', () => {
    assert.equal(sunatBulk?.priority, 'P0');
  });
});

// ── pe_migo_api ───────────────────────────────────────────────────────────────

describe('Perú.UI.1 — pe_migo_api catalog status', () => {
  it('entry exists in catalog', () => {
    assert.ok(migoApi, 'pe_migo_api debe existir en el catálogo');
  });

  it('aiFlowStatus is eligible_not_connected (requires API key)', () => {
    assert.equal(migoApi?.aiFlowStatus, 'eligible_not_connected');
  });

  it('connectionMode is not_connected (requires API key in panel)', () => {
    assert.equal(migoApi?.connectionMode, 'not_connected');
  });

  it('sellupUse is validation_only (not discovery)', () => {
    assert.equal(migoApi?.sellupUse, 'validation_only');
  });

  it('type is commercial_provider (not official)', () => {
    assert.equal(migoApi?.type, 'commercial_provider');
  });

  it('priority is P2 (fallback/complementary)', () => {
    assert.equal(migoApi?.priority, 'P2');
  });
});

// ── Fuentes no tocadas ────────────────────────────────────────────────────────

describe('Perú.UI.1 — México not affected', () => {
  it('denue_mexico still exists', () => {
    assert.ok(denuemexico, 'denue_mexico debe existir');
  });

  it('denue_mexico aiFlowStatus unchanged (connected)', () => {
    assert.equal(denuemexico?.aiFlowStatus, 'connected');
  });
});

describe('Perú.UI.1 — República Dominicana not affected', () => {
  it('do_dgcp still exists', () => {
    assert.ok(dgcp);
  });

  it('do_dgcp type unchanged (procurement)', () => {
    assert.equal(dgcp?.type, 'procurement');
  });
});

describe('Perú.UI.1 — Chile not affected', () => {
  it('cl_chilecompra_ocds still exists', () => {
    assert.ok(chilecompraOcds);
  });

  it('cl_chilecompra_ocds aiFlowStatus unchanged (connected_post_approval)', () => {
    assert.equal(chilecompraOcds?.aiFlowStatus, 'connected_post_approval');
  });
});
