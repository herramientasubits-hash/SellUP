/**
 * Tests: HnContratacionesAbiertasCard — helpers puros y comportamiento de la card
 *
 * Post-8C.4C: la fuente tiene snapshot persistido.
 *   isHnPersisted() ahora retorna true.
 *   La card acepta coverage prop para mostrar datos dinámicos.
 *
 * Hito: Centroamérica.8C.4C
 * Previo: 8C.2 (isHnPersisted = false)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HN_DRY_RUN_METRICS,
  formatHnRtnCoverage,
  isHnPostApprovalConnected,
  isHnAutoMatchingEnabled,
  isHnPersisted,
  isHnFiscalSource,
} from '../hn-contrataciones-abiertas-card';

// ─── Dry-run metrics históricos (dry-run 2025, no son el snapshot) ────────────

describe('HN_DRY_RUN_METRICS — valores del dry-run real 2025', () => {
  it('300 líneas leídas (dry-run, no snapshot)', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.linesRead, 300);
  });

  it('950 parties vistas', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.partiesSeen, 950);
  });

  it('194 suppliers/tenderers', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.supplierOrTendererSeen, 194);
  });

  it('185 con HN-RTN', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.hnRtnSeen, 185);
  });

  it('176 RTN válidos', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.validRtn, 176);
  });

  it('9 RTN inválidos', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.invalidRtn, 9);
  });

  it('9 legacy scheme ignorados', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.legacySchemeIgnored, 9);
  });

  it('99 RTN únicos válidos (dry-run, distinto de los 72 del snapshot)', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.uniqueValidRtn, 99);
  });

  it('66 con señal de persona jurídica', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.likelyLegalEntity, 66);
  });

  it('33 con riesgo persona natural / desconocido', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.naturalPersonRisk, 33);
  });

  it('99 (dry-run) !== 72 (snapshot) — los dos universos son distintos', () => {
    assert.notEqual(HN_DRY_RUN_METRICS.uniqueValidRtn, 72);
  });
});

// ─── formatHnRtnCoverage ──────────────────────────────────────────────────────

describe('formatHnRtnCoverage — helper de cobertura RTN', () => {
  it('calcula porcentaje correctamente (176/185)', () => {
    assert.strictEqual(formatHnRtnCoverage(176, 185), '95%');
  });

  it('retorna 0% si seen es 0', () => {
    assert.strictEqual(formatHnRtnCoverage(0, 0), '0%');
  });

  it('retorna 100% si todos son válidos', () => {
    assert.strictEqual(formatHnRtnCoverage(10, 10), '100%');
  });
});

// ─── Guardrails — flags de conexión operativa ────────────────────────────────

describe('Guardrails — flags de conexión operativa', () => {
  it('post-approval NO está conectado (post_approval_enabled = false)', () => {
    assert.strictEqual(isHnPostApprovalConnected(), false);
  });

  it('matching automático NO está habilitado', () => {
    assert.strictEqual(isHnAutoMatchingEnabled(), false);
  });

  it('8C.4C: fuente SÍ está persistida (snapshot piloto aplicado exitosamente)', () => {
    assert.strictEqual(isHnPersisted(), true);
  });

  it('NO es fuente fiscal', () => {
    assert.strictEqual(isHnFiscalSource(), false);
  });
});

// ─── Distinción dry-run vs snapshot ──────────────────────────────────────────

describe('Distinción semántica: 72 (snapshot) vs 99 (dry-run)', () => {
  it('HN_DRY_RUN_METRICS.uniqueValidRtn es 99, no 72', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.uniqueValidRtn, 99);
    assert.notEqual(HN_DRY_RUN_METRICS.uniqueValidRtn, 72);
  });

  it('HN_DRY_RUN_METRICS.linesRead es 300 (muestra técnica), no el universo del snapshot', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.linesRead, 300);
  });
});
