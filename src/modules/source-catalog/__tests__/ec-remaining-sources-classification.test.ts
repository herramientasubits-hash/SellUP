/**
 * Tests: remaining Ecuador sources classification — EC-SOURCES-21 CLASSIFY
 *
 * Tras el cierre oficial de EC-SCVS (EC-SCVS-20), SCVS/Supercias es la ÚNICA
 * fuente operativa de enrichment de Ecuador (expansión limitada manual). Las
 * fuentes restantes de Ecuador —SERCOP y EKOS— quedaban con la clasificación
 * genérica de fallback ("Pendiente clasificación IA" + CTA "Conectar"), lo que
 * podía dar la impresión falsa de que "Ecuador no cerró" o de que todas las
 * fuentes de Ecuador están en el mismo estado.
 *
 * Este hito clasifica esas fuentes explícitamente y de forma segura:
 *   - SERCOP → señal comercial complementaria de contratación pública, NO
 *     conectada, pendiente de diseño de integración. No es fuente registral base.
 *   - EKOS → fuente privada/editorial/directorio, NO conectada, requiere
 *     validación de uso/cobertura/legalidad antes de cualquier integración.
 *
 * Solo presentación/config del catálogo: no toca DB, runner, adapter, providers,
 * HubSpot ni Slack. Ninguna de las dos promete live/full expansion ni conexión
 * inmediata.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import { filterTab } from '@/modules/source-catalog/filter-tab';
import {
  SELLUP_USE_LABELS,
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
} from '@/modules/source-catalog/labels';
import { getSourceActionPresentation } from '@/modules/source-catalog/action-presentation';

function sourceByKey(key: string) {
  const { sources } = getSourceCatalogViewModel();
  const source = sources.find((s) => s.key === key);
  assert.ok(source, `${key} debe existir en el catálogo`);
  return source;
}

const sercop = () => sourceByKey('ec_sercop');
const ekos = () => sourceByKey('ec_ekos');
const scvs = () => sourceByKey('ec_scvs');

// ── SERCOP — señal complementaria, no conectada, no operativa ─────────────────

describe('SERCOP (ec_sercop) — clasificación', () => {
  it('sellupUse = commercial_signal (señal comercial complementaria)', () => {
    assert.equal(sercop().sellupUse, 'commercial_signal');
  });

  it('aiFlowStatus = pending_integration_design', () => {
    assert.equal(sercop().aiFlowStatus, 'pending_integration_design');
  });

  it('connectionMode = not_connected', () => {
    assert.equal(sercop().connectionMode, 'not_connected');
  });

  it('YA NO usa el fallback "pending_classification"', () => {
    const s = sercop();
    assert.notEqual(s.sellupUse, 'pending_classification');
    assert.notEqual(s.aiFlowStatus, 'pending_classification');
  });

  it('nextAction NO es el fallback de clasificación pendiente', () => {
    assert.doesNotMatch(sercop().nextAction, /Pendiente clasificación operativa/);
  });

  it('NO muestra CTA "Conectar" (no ofrece conexión inmediata)', () => {
    const action = getSourceActionPresentation({
      connectionMode: sercop().connectionMode,
      aiFlowStatus: sercop().aiFlowStatus,
    });
    assert.notEqual(action.label, 'Conectar');
    assert.notEqual(action.kind, 'connect');
  });

  it('no promete live / expansión completa / enrichment operativo', () => {
    const blob = `${sercop().nextAction} ${sercop().recommendedUse}`.toLowerCase();
    assert.doesNotMatch(blob, /live/);
    assert.doesNotMatch(blob, /expansi[oó]n completa/);
    assert.doesNotMatch(blob, /enrichment operativo/);
  });

  it('deja claro que NO es fuente registral base', () => {
    assert.match(`${sercop().nextAction} ${sercop().recommendedUse}`, /no es fuente registral base/i);
  });

  it('NO aparece en el tab "Operativas IA"', () => {
    const { sources } = getSourceCatalogViewModel();
    const operativas = filterTab(sources, 'operativas');
    assert.ok(!operativas.some((s) => s.key === 'ec_sercop'));
  });
});

// ── EKOS — requiere validación, no conectada, no oficial ──────────────────────

describe('EKOS (ec_ekos) — clasificación', () => {
  it('sellupUse = contextual_signal (señal editorial/directorio)', () => {
    assert.equal(ekos().sellupUse, 'contextual_signal');
  });

  it('aiFlowStatus = requires_validation', () => {
    assert.equal(ekos().aiFlowStatus, 'requires_validation');
  });

  it('connectionMode = not_connected', () => {
    assert.equal(ekos().connectionMode, 'not_connected');
  });

  it('operationalStatus NO es "validated" ni "operational_verified"', () => {
    assert.notEqual(ekos().operationalStatus, 'validated');
    assert.notEqual(ekos().operationalStatus, 'operational_verified');
  });

  it('YA NO usa el fallback "pending_classification"', () => {
    const s = ekos();
    assert.notEqual(s.sellupUse, 'pending_classification');
    assert.notEqual(s.aiFlowStatus, 'pending_classification');
  });

  it('NO muestra CTA "Conectar" (no ofrece conexión inmediata)', () => {
    const action = getSourceActionPresentation({
      connectionMode: ekos().connectionMode,
      aiFlowStatus: ekos().aiFlowStatus,
    });
    assert.notEqual(action.label, 'Conectar');
    assert.notEqual(action.kind, 'connect');
  });

  it('nextAction exige validación de uso/cobertura/legalidad antes de integrar', () => {
    assert.match(ekos().nextAction, /validar/i);
    assert.match(ekos().nextAction, /legalidad/i);
  });

  it('no promete live / expansión completa / enrichment operativo', () => {
    const blob = `${ekos().nextAction} ${ekos().recommendedUse}`.toLowerCase();
    assert.doesNotMatch(blob, /live/);
    assert.doesNotMatch(blob, /expansi[oó]n completa/);
    assert.doesNotMatch(blob, /enrichment operativo/);
  });

  it('NO aparece en el tab "Operativas IA"', () => {
    const { sources } = getSourceCatalogViewModel();
    const operativas = filterTab(sources, 'operativas');
    assert.ok(!operativas.some((s) => s.key === 'ec_ekos'));
  });
});

// ── SCVS sigue siendo la única fuente operativa de enrichment de Ecuador ───────

describe('SCVS sigue como única fuente operativa de enrichment de Ecuador', () => {
  it('SCVS conserva expansión limitada manual + backend conectado', () => {
    assert.equal(scvs().aiFlowStatus, 'limited_manual_expansion');
    assert.equal(scvs().connectionMode, 'backend_connected');
  });

  it('SCVS es la única fuente EC en el tab "Operativas IA"', () => {
    const { sources } = getSourceCatalogViewModel();
    const operativasEc = filterTab(sources, 'operativas').filter((s) =>
      s.countryCodes.includes('EC'),
    );
    assert.deepEqual(
      operativasEc.map((s) => s.key),
      ['ec_scvs'],
    );
  });
});

// ── Labels visibles de los nuevos estados ─────────────────────────────────────

describe('labels de los nuevos estados de flujo IA', () => {
  it('SERCOP: "Pendiente diseño de integración" / "No conectada" / "Señal comercial"', () => {
    assert.equal(AI_FLOW_STATUS_LABELS[sercop().aiFlowStatus], 'Pendiente diseño de integración');
    assert.equal(CONNECTION_MODE_LABELS[sercop().connectionMode], 'No conectada');
    assert.equal(SELLUP_USE_LABELS[sercop().sellupUse], 'Señal comercial');
  });

  it('EKOS: "Requiere validación" / "No conectada" / "Señal contextual"', () => {
    assert.equal(AI_FLOW_STATUS_LABELS[ekos().aiFlowStatus], 'Requiere validación');
    assert.equal(CONNECTION_MODE_LABELS[ekos().connectionMode], 'No conectada');
    assert.equal(SELLUP_USE_LABELS[ekos().sellupUse], 'Señal contextual');
  });
});

// ── Regresión del mapper de acción ────────────────────────────────────────────

describe('getSourceActionPresentation — regresión', () => {
  it('not_connected sin aiFlowStatus → "Conectar" (comportamiento previo intacto)', () => {
    const a = getSourceActionPresentation({ connectionMode: 'not_connected' });
    assert.equal(a.kind, 'connect');
    assert.equal(a.label, 'Conectar');
  });

  it('not_connected + eligible_not_connected → "Conectar" (fuente realmente apta)', () => {
    const a = getSourceActionPresentation({
      connectionMode: 'not_connected',
      aiFlowStatus: 'eligible_not_connected',
    });
    assert.equal(a.kind, 'connect');
    assert.equal(a.label, 'Conectar');
  });

  it('not_connected + pending_integration_design → "Ver detalle" (no conecta)', () => {
    const a = getSourceActionPresentation({
      connectionMode: 'not_connected',
      aiFlowStatus: 'pending_integration_design',
    });
    assert.equal(a.kind, 'view_detail');
    assert.equal(a.label, 'Ver detalle');
  });

  it('not_connected + requires_validation → "Ver detalle" (no conecta)', () => {
    const a = getSourceActionPresentation({
      connectionMode: 'not_connected',
      aiFlowStatus: 'requires_validation',
    });
    assert.equal(a.kind, 'view_detail');
    assert.equal(a.label, 'Ver detalle');
  });
});
