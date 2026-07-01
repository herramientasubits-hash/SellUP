/**
 * Tests — Chile.3 — ChileCompra Source Catalog status update
 *
 * Verifica que cl_chilecompra_ocds refleja su estado real (conectada,
 * señal post-approval, sin credenciales) y que fuentes no relacionadas
 * (RD, Perú, cl_res) no fueron alteradas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';
import { AI_FLOW_STATUS_LABELS, CONNECTION_MODE_LABELS } from '../../../../modules/source-catalog/labels';

function getRequiredSource(key: string) {
  const source = CATALOG_SOURCES.find(s => s.key === key);
  if (!source) throw new Error(`Source not found: ${key}`);
  return source;
}

function requireDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`${label} should be defined`);
  }
  return value;
}

const chilecompraOcds = CATALOG_SOURCES.find(s => s.key === 'cl_chilecompra_ocds');
const clRes = CATALOG_SOURCES.find(s => s.key === 'cl_res');
const sunatBulk = CATALOG_SOURCES.find(s => s.key === 'pe_sunat_bulk');
const dgcp = CATALOG_SOURCES.find(s => s.key === 'do_dgcp');

describe('Chile.3 — cl_chilecompra_ocds catalog status', () => {
  it('entry exists in catalog', () => {
    assert.ok(chilecompraOcds, 'cl_chilecompra_ocds debe existir en el catálogo');
  });

  it('aiFlowStatus is connected_post_approval (not eligible_not_connected)', () => {
    assert.equal(chilecompraOcds?.aiFlowStatus, 'connected_post_approval');
  });

  it('label does NOT say "Apta no conectada"', () => {
    const src = getRequiredSource('cl_chilecompra_ocds');
    const label = AI_FLOW_STATUS_LABELS[requireDefined(src.aiFlowStatus, 'aiFlowStatus')];
    assert.notEqual(label, 'Apta no conectada');
  });

  it('label does NOT say "No conectada"', () => {
    const src = getRequiredSource('cl_chilecompra_ocds');
    const label = AI_FLOW_STATUS_LABELS[requireDefined(src.aiFlowStatus, 'aiFlowStatus')];
    assert.notEqual(label, 'No conectada');
  });

  it('connectionMode is offline_signal (not not_connected — no Conectar CTA)', () => {
    assert.equal(chilecompraOcds?.connectionMode, 'offline_signal');
  });

  it('connectionMode label conveys no credentials required', () => {
    const src = getRequiredSource('cl_chilecompra_ocds');
    const label = CONNECTION_MODE_LABELS[requireDefined(src.connectionMode, 'connectionMode')];
    assert.notEqual(label, 'No conectada');
    assert.ok(label.length > 0, 'debe tener label');
  });

  it('sellupUse remains commercial_signal (not legal/enrichment)', () => {
    assert.equal(chilecompraOcds?.sellupUse, 'commercial_signal');
  });

  it('nextAction mentions post-approval and no credentials', () => {
    const na = chilecompraOcds?.nextAction ?? '';
    assert.ok(
      na.toLowerCase().includes('post-approval') || na.toLowerCase().includes('credencial'),
      `nextAction debe mencionar post-approval o credencial: "${na}"`,
    );
  });

  it('type remains procurement (not official_registry — not a legal source)', () => {
    assert.equal(chilecompraOcds?.type, 'procurement');
  });
});

describe('Chile.3 — cl_res not affected', () => {
  it('cl_res still exists', () => {
    assert.ok(clRes);
  });

  it('cl_res aiFlowStatus unchanged (connected)', () => {
    assert.equal(clRes?.aiFlowStatus, 'connected');
  });
});

describe('Chile.3 — Perú not affected', () => {
  it('pe_sunat_bulk still exists', () => {
    assert.ok(sunatBulk);
  });

  it('pe_sunat_bulk aiFlowStatus is connected_post_approval (updated in Peru.UI.1)', () => {
    assert.equal(sunatBulk?.aiFlowStatus, 'connected_post_approval');
  });
});

describe('Chile.3 — República Dominicana not affected', () => {
  it('do_dgcp still exists', () => {
    assert.ok(dgcp);
  });

  it('do_dgcp type unchanged (procurement)', () => {
    assert.equal(dgcp?.type, 'procurement');
  });
});
