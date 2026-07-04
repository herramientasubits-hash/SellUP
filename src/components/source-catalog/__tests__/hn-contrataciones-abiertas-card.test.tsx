/**
 * Tests: HnContratacionesAbiertasCard — helpers puros de la card Honduras dry-run
 *
 * Verifica que las constantes del dry-run real 2025 son correctas y
 * que los guardrails de conexión operativa retornan false.
 *
 * Hito: Centroamérica.8C.2
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

describe('HN_DRY_RUN_METRICS — valores del dry-run real 2025', () => {
  it('300 líneas leídas', () => {
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

  it('99 RTN únicos válidos', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.uniqueValidRtn, 99);
  });

  it('66 con señal de persona jurídica', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.likelyLegalEntity, 66);
  });

  it('33 con riesgo persona natural / desconocido', () => {
    assert.strictEqual(HN_DRY_RUN_METRICS.naturalPersonRisk, 33);
  });
});

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

describe('Guardrails — flags de conexión operativa', () => {
  it('post-approval NO está conectado', () => {
    assert.strictEqual(isHnPostApprovalConnected(), false);
  });

  it('matching automático NO está habilitado', () => {
    assert.strictEqual(isHnAutoMatchingEnabled(), false);
  });

  it('fuente NO está persistida', () => {
    assert.strictEqual(isHnPersisted(), false);
  });

  it('NO es fuente fiscal', () => {
    assert.strictEqual(isHnFiscalSource(), false);
  });
});
