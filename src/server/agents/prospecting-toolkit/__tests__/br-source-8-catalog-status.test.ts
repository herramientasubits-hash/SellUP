/**
 * Tests — BR-SOURCE-8-UI — Brazil Receita CNPJ source catalog status.
 *
 * Verifica que br_receita_dados_abertos refleja su estado técnico real
 * (preparación técnica / dry-run local listo, import/runtime/HubSpot/live
 * bloqueados) y que la ficha de detalle NO muestra paneles de conexión.
 *
 * Aislamiento: otras fuentes BR y de otros países no fueron alteradas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';
import {
  OPERATIONAL_STATUS_LABELS,
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
} from '../../../../modules/source-catalog/labels';
import { shouldSkipGenericConnectionPanels } from '../../../../modules/source-catalog/connection-panel-guards';

const receita = CATALOG_SOURCES.find((s) => s.key === 'br_receita_dados_abertos');
const receitaInstitucional = CATALOG_SOURCES.find((s) => s.key === 'br_receita_cnpj');
const cnpjWs = CATALOG_SOURCES.find((s) => s.key === 'br_cnpj_ws');
const ecScvs = CATALOG_SOURCES.find((s) => s.key === 'ec_scvs');
const sunatBulk = CATALOG_SOURCES.find((s) => s.key === 'pe_sunat_bulk');

describe('BR-SOURCE-8-UI — br_receita_dados_abertos catalog status', () => {
  it('entry exists and is Brazil', () => {
    assert.ok(receita, 'br_receita_dados_abertos debe existir en el catálogo');
    assert.deepEqual(receita?.countryCodes, ['BR']);
  });

  it('operationalStatus is dry_run_validated (NOT operational_verified)', () => {
    assert.equal(receita?.operationalStatus, 'dry_run_validated');
    assert.notEqual(receita?.operationalStatus, 'operational_verified');
  });

  it('operationalStatus label reads "Validación técnica completada" (not "Verificada")', () => {
    const label = OPERATIONAL_STATUS_LABELS[receita!.operationalStatus];
    assert.equal(label, 'Validación técnica completada');
    assert.notEqual(label, 'Verificada');
  });

  it('aiFlowStatus is dry_run_validated (not live/connected)', () => {
    assert.equal(receita?.aiFlowStatus, 'dry_run_validated');
    assert.notEqual(receita?.aiFlowStatus, 'connected');
    assert.notEqual(receita?.aiFlowStatus, 'connected_post_approval');
    const label = AI_FLOW_STATUS_LABELS[receita!.aiFlowStatus!];
    assert.equal(label, 'Dry-run validado');
  });

  it('connectionMode is not_persisted (no persistence, no live connection)', () => {
    assert.equal(receita?.connectionMode, 'not_persisted');
    assert.notEqual(receita?.connectionMode, 'backend_connected');
    assert.notEqual(receita?.connectionMode, 'automatic_enrichment');
    const label = CONNECTION_MODE_LABELS[receita!.connectionMode!];
    assert.equal(label, 'Sin persistencia');
  });

  it('detail page SKIPS generic connection panels (no connect/test CTA)', () => {
    assert.equal(shouldSkipGenericConnectionPanels(receita!), true);
  });

  it('nextAction states import/runtime/HubSpot/live are blocked', () => {
    const na = (receita?.nextAction ?? '').toLowerCase();
    assert.ok(na.includes('bloquead'), `nextAction debe indicar bloqueo: "${receita?.nextAction}"`);
    assert.ok(na.includes('import'), 'nextAction debe mencionar import');
    assert.ok(na.includes('runtime'), 'nextAction debe mencionar runtime');
    assert.ok(na.includes('hubspot'), 'nextAction debe mencionar HubSpot');
    assert.ok(na.includes('live'), 'nextAction debe mencionar generación live');
  });

  it('riskNotes flag that import/runtime/HubSpot/Agent 1 live are blocked', () => {
    const notes = (receita?.riskNotes ?? []).join(' ').toLowerCase();
    assert.ok(notes.includes('bloquead'), 'riskNotes debe marcar bloqueo');
    assert.ok(notes.includes('hubspot'), 'riskNotes debe mencionar HubSpot');
    assert.ok(notes.includes('agent 1'), 'riskNotes debe mencionar Agent 1');
  });

  it('remains P0 official_registry (metadata preserved)', () => {
    assert.equal(receita?.priority, 'P0');
    assert.equal(receita?.type, 'official_registry');
    assert.equal(receita?.url, 'https://dadosabertos.rfb.gov.br/CNPJ/');
  });
});

describe('BR-SOURCE-8-UI-FIX1 — Brazil source_key reconciliation', () => {
  it('registry/UI source key is preserved (br_receita_dados_abertos)', () => {
    assert.equal(receita?.key, 'br_receita_dados_abertos');
  });

  it('exposes the canonical technical source key (br_receita_cnpj_dados_abertos)', () => {
    assert.equal(
      receita?.canonicalTechnicalSourceKey,
      'br_receita_cnpj_dados_abertos',
    );
  });

  it('documents the reconciliation between registry and canonical keys', () => {
    const rec = receita?.sourceKeyReconciliation;
    assert.ok(rec, 'sourceKeyReconciliation debe existir');
    assert.equal(rec?.registrySourceKey, 'br_receita_dados_abertos');
    assert.equal(
      rec?.canonicalTechnicalSourceKey,
      'br_receita_cnpj_dados_abertos',
    );
    assert.ok(
      /canónica|canonica/i.test(rec?.reason ?? ''),
      'reason debe explicar la clave canónica',
    );
  });

  it('does NOT duplicate Brazil as a second canonical-keyed source', () => {
    const canonicalKeyed = CATALOG_SOURCES.filter(
      (s) => s.key === 'br_receita_cnpj_dados_abertos',
    );
    assert.equal(
      canonicalKeyed.length,
      0,
      'la clave canónica no debe existir como entrada de catálogo separada',
    );
    const bulkBrazil = CATALOG_SOURCES.filter(
      (s) => s.key === 'br_receita_dados_abertos',
    );
    assert.equal(bulkBrazil.length, 1, 'la fuente bulk de Brasil debe ser única');
  });

  it('reconciliation does not flip status to active/live', () => {
    assert.equal(receita?.operationalStatus, 'dry_run_validated');
    assert.equal(receita?.aiFlowStatus, 'dry_run_validated');
    assert.equal(receita?.connectionMode, 'not_persisted');
  });
});

describe('BR-SOURCE-8-UI — isolation of unrelated sources', () => {
  it('br_receita_cnpj (institucional) unchanged: validation_only', () => {
    assert.ok(receitaInstitucional);
    assert.equal(receitaInstitucional?.operationalStatus, 'validation_only');
  });

  it('br_cnpj_ws unchanged: connection_required', () => {
    assert.ok(cnpjWs);
    assert.equal(cnpjWs?.operationalStatus, 'connection_required');
  });

  it('ec_scvs unchanged: validated', () => {
    assert.equal(ecScvs?.operationalStatus, 'validated');
  });

  it('pe_sunat_bulk unchanged: connected_post_approval', () => {
    assert.equal(sunatBulk?.aiFlowStatus, 'connected_post_approval');
  });
});
