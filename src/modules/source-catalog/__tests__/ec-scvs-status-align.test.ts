/**
 * Tests: EC-SCVS operational status alignment — SOURCE-CATALOG-STATUS-ALIGN-1
 *
 * La fila `ec_scvs` del catálogo debe reflejar el estado operativo real:
 *   - fuente validada (snapshot productivo cargado)
 *   - backend/adapter conectado
 *   - flujo IA en piloto controlado
 *   - siguiente hito: segundo piloto live controlado (EC-SCVS-13B)
 *
 * Y NO debe volver a mostrar el estado "pendiente / no conectada" que provenía
 * del fallback de clasificación operativa.
 *
 * Este hito es solo de presentación: no toca DB, runner, adapter ni lógica IA.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import { filterTab } from '@/modules/source-catalog/filter-tab';
import {
  SELLUP_USE_LABELS,
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
  OPERATIONAL_STATUS_LABELS,
} from '@/modules/source-catalog/labels';
import { getSourceActionPresentation } from '@/modules/source-catalog/action-presentation';

function ecScvs() {
  const { sources } = getSourceCatalogViewModel();
  const source = sources.find((s) => s.key === 'ec_scvs');
  assert.ok(source, 'ec_scvs debe existir en el catálogo');
  return source;
}

// ── 1. Estado técnico correcto en el read-model ───────────────────────────────

describe('EC-SCVS — clasificación operativa (read-model)', () => {
  it('sellupUse = enrichment (uso post-discovery)', () => {
    assert.equal(ecScvs().sellupUse, 'enrichment');
  });

  it('aiFlowStatus = controlled_pilot (piloto controlado)', () => {
    assert.equal(ecScvs().aiFlowStatus, 'controlled_pilot');
  });

  it('connectionMode = backend_connected (backend/adapter conectado)', () => {
    assert.equal(ecScvs().connectionMode, 'backend_connected');
  });

  it('operationalStatus = validated (fuente validada)', () => {
    assert.equal(ecScvs().operationalStatus, 'validated');
  });

  it('nextAction apunta al segundo piloto live controlado (EC-SCVS-13B)', () => {
    assert.match(ecScvs().nextAction, /Segundo piloto live controlado/);
  });
});

// ── 2. Labels visibles correctos ──────────────────────────────────────────────

describe('EC-SCVS — labels visibles', () => {
  it('muestra "Validada" como estado fuente', () => {
    assert.equal(OPERATIONAL_STATUS_LABELS[ecScvs().operationalStatus], 'Validada');
  });

  it('muestra "Conectada backend" como conexión', () => {
    assert.equal(CONNECTION_MODE_LABELS[ecScvs().connectionMode], 'Conectada backend');
  });

  it('muestra "Piloto controlado" como estado de flujo IA', () => {
    assert.equal(AI_FLOW_STATUS_LABELS[ecScvs().aiFlowStatus], 'Piloto controlado');
  });

  it('muestra "Enrichment" como uso en SellUp', () => {
    assert.equal(SELLUP_USE_LABELS[ecScvs().sellupUse], 'Enrichment');
  });
});

// ── 3. Ya NO muestra estados de pendiente / no conectada ──────────────────────

describe('EC-SCVS — no muestra estados pendientes', () => {
  it('NO usa "pending_classification" en sellupUse ni aiFlowStatus', () => {
    const s = ecScvs();
    assert.notEqual(s.sellupUse, 'pending_classification');
    assert.notEqual(s.aiFlowStatus, 'pending_classification');
  });

  it('NO está "not_connected"', () => {
    assert.notEqual(ecScvs().connectionMode, 'not_connected');
  });

  it('NO está "pending_validation"', () => {
    assert.notEqual(ecScvs().operationalStatus, 'pending_validation');
  });

  it('nextAction NO es el fallback de clasificación pendiente', () => {
    assert.doesNotMatch(ecScvs().nextAction, /Pendiente clasificación/);
  });
});

// ── 4. No implica live / expansión ────────────────────────────────────────────

describe('EC-SCVS — no marca live ni expansión', () => {
  it('operationalStatus NO es operational_verified (no full operativa/live)', () => {
    assert.notEqual(ecScvs().operationalStatus, 'operational_verified');
  });

  it('aiFlowStatus NO es "connected" (no conectada a flujo live)', () => {
    assert.notEqual(ecScvs().aiFlowStatus, 'connected');
  });
});

// ── 5. Visible en el tab "Operativas IA" (tab por defecto) ────────────────────

describe('EC-SCVS — visibilidad en tabs', () => {
  const { sources } = getSourceCatalogViewModel();

  it('aparece en Operativas IA', () => {
    const operativas = filterTab(sources, 'operativas');
    assert.ok(operativas.some((s) => s.key === 'ec_scvs'));
  });

  it('aparece en Todas', () => {
    const todas = filterTab(sources, 'todas');
    assert.ok(todas.some((s) => s.key === 'ec_scvs'));
  });
});

// ── 6. Acción = "Ver estado" (sin disparar conexión) ──────────────────────────

describe('EC-SCVS — presentación de acción', () => {
  it('backend_connected → "Ver estado"', () => {
    const action = getSourceActionPresentation({ connectionMode: ecScvs().connectionMode });
    assert.equal(action.kind, 'view_status');
    assert.equal(action.label, 'Ver estado');
  });

  it('NO muestra "Conectar"', () => {
    const action = getSourceActionPresentation({ connectionMode: ecScvs().connectionMode });
    assert.notEqual(action.label, 'Conectar');
    assert.notEqual(action.kind, 'connect');
  });
});

// ── 7. El mapper de acción preserva los kinds existentes ──────────────────────

describe('getSourceActionPresentation — regresión de estados previos', () => {
  it('not_connected → "Conectar" (primario)', () => {
    const a = getSourceActionPresentation({ connectionMode: 'not_connected' });
    assert.equal(a.kind, 'connect');
    assert.equal(a.label, 'Conectar');
  });

  it('read_only_signal → "Ver señales"', () => {
    const a = getSourceActionPresentation({ connectionMode: 'read_only_signal' });
    assert.equal(a.kind, 'view_signals');
    assert.equal(a.label, 'Ver señales');
  });

  it('automatic_enrichment (default) → "Ver detalle"', () => {
    const a = getSourceActionPresentation({ connectionMode: 'automatic_enrichment' });
    assert.equal(a.kind, 'view_detail');
    assert.equal(a.label, 'Ver detalle');
  });
});
