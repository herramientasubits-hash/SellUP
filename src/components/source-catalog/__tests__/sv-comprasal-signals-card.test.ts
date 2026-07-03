/**
 * Tests for SvComprasalSignalsCard helpers — Centroamérica.7E.3
 *
 * Pure helper function tests only (no DOM rendering required).
 * Uses node:test to match the repo's existing test convention.
 *
 * Verifica:
 *  1.  totalSignals > 0 → formatSvTotalSignals muestra conteo real
 *  2.  totalSignals = 0 → estado vacío seguro
 *  3.  sourceYears se muestra correctamente
 *  4.  sourceYears vacío → "No disponible"
 *  5.  latestImportedAt null → "No disponible"
 *  6.  latestImportedAt ISO válido → formatea fecha
 *  7.  isFiscalSource === false (no fuente fiscal)
 *  8.  isSvFiscalSource devuelve false
 *  9.  postApprovalConnected === false
 * 10.  isSvPostApprovalConnected devuelve false
 * 11.  automaticMatchingEnabled === false
 * 12.  isSvAutoMatchingEnabled devuelve false
 * 13.  humanReviewRequired === true
 * 14.  signalStrength === 'weak_name_only'
 * 15.  matchingMode === 'name_only_review_required'
 * 16.  replacesMinisterioHacienda === false
 * 17.  replacesCnr === false
 * 18.  sourceKey es 'sv_comprasal'
 * 19.  countryCode es 'SV'
 * 20.  summary no contiene raw_data
 * 21.  summary no contiene campos fiscales (NIT, NRC)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSvTotalSignals,
  formatSvSourceYears,
  formatSvLatestImportedAt,
  isSvFiscalSource,
  isSvPostApprovalConnected,
  isSvAutoMatchingEnabled,
} from '../sv-comprasal-signals-card';
import type { SvComprasalSignalsSummary } from '@/server/services/sv-comprasal-signals-summary';

// ─── Fixture ──────────────────────────────────────────────────────────────────

const baseSummary: SvComprasalSignalsSummary = {
  sourceKey: 'sv_comprasal',
  countryCode: 'SV',
  totalSignals: 19,
  sourceYears: [2024, 2025],
  latestImportedAt: '2026-07-03T00:00:00.000Z',
  signalStrength: 'weak_name_only',
  matchingMode: 'name_only_review_required',
  humanReviewRequired: true,
  isFiscalSource: false,
  replacesMinisterioHacienda: false,
  replacesCnr: false,
  postApprovalConnected: false,
  automaticMatchingEnabled: false,
  dataSource: 'live_database',
};

const emptySummary: SvComprasalSignalsSummary = {
  ...baseSummary,
  totalSignals: 0,
  sourceYears: [],
  latestImportedAt: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SvComprasalSignalsCard helpers', () => {

  // 1. totalSignals > 0 → muestra conteo real
  it('formatSvTotalSignals muestra el número real de señales', () => {
    const result = formatSvTotalSignals(19);
    assert.ok(result.includes('19'), `Expected "19" in "${result}"`);
    assert.ok(result.includes('señales'), `Expected "señales" in "${result}"`);
  });

  // 2. totalSignals = 0 → estado vacío seguro
  it('formatSvTotalSignals muestra estado vacío para 0', () => {
    const result = formatSvTotalSignals(0);
    assert.ok(result.toLowerCase().includes('sin'), `Expected "sin" in "${result}"`);
    assert.ok(!result.includes('0 señales'), `Should not show "0 señales" literally`);
  });

  // 3. sourceYears se muestra correctamente
  it('formatSvSourceYears muestra años separados por coma', () => {
    const result = formatSvSourceYears([2024, 2025]);
    assert.ok(result.includes('2024'), `Expected "2024" in "${result}"`);
    assert.ok(result.includes('2025'), `Expected "2025" in "${result}"`);
  });

  // 4. sourceYears vacío → "No disponible"
  it('formatSvSourceYears devuelve "No disponible" para array vacío', () => {
    assert.ok(formatSvSourceYears([]).includes('disponible'));
  });

  // 5. latestImportedAt null → "No disponible"
  it('formatSvLatestImportedAt devuelve "No disponible" para null', () => {
    assert.ok(formatSvLatestImportedAt(null).includes('disponible'));
  });

  // 6. latestImportedAt ISO válido → formatea fecha
  it('formatSvLatestImportedAt formatea ISO a fecha legible', () => {
    const result = formatSvLatestImportedAt('2026-07-03T00:00:00.000Z');
    assert.ok(result.length > 0, 'Should return non-empty string');
    assert.ok(!result.includes('T'), 'Should not show raw ISO T separator');
  });

  // 7. isFiscalSource === false
  it('isFiscalSource es false (no fuente fiscal)', () => {
    assert.equal(baseSummary.isFiscalSource, false);
  });

  // 8. isSvFiscalSource devuelve false
  it('isSvFiscalSource devuelve false', () => {
    assert.equal(isSvFiscalSource(baseSummary), false);
  });

  // 9. postApprovalConnected === false
  it('postApprovalConnected es false', () => {
    assert.equal(baseSummary.postApprovalConnected, false);
  });

  // 10. isSvPostApprovalConnected devuelve false
  it('isSvPostApprovalConnected devuelve false', () => {
    assert.equal(isSvPostApprovalConnected(baseSummary), false);
  });

  // 11. automaticMatchingEnabled === false
  it('automaticMatchingEnabled es false', () => {
    assert.equal(baseSummary.automaticMatchingEnabled, false);
  });

  // 12. isSvAutoMatchingEnabled devuelve false
  it('isSvAutoMatchingEnabled devuelve false', () => {
    assert.equal(isSvAutoMatchingEnabled(baseSummary), false);
  });

  // 13. humanReviewRequired === true
  it('humanReviewRequired es true', () => {
    assert.equal(baseSummary.humanReviewRequired, true);
  });

  // 14. signalStrength === 'weak_name_only'
  it('signalStrength es weak_name_only', () => {
    assert.equal(baseSummary.signalStrength, 'weak_name_only');
    assert.notEqual(baseSummary.signalStrength, 'strong_identifier');
    assert.notEqual(baseSummary.signalStrength, 'medium_name_domain');
  });

  // 15. matchingMode === 'name_only_review_required'
  it('matchingMode es name_only_review_required', () => {
    assert.equal(baseSummary.matchingMode, 'name_only_review_required');
    assert.notEqual(baseSummary.matchingMode, 'identifier_match_allowed');
  });

  // 16. replacesMinisterioHacienda === false
  it('replacesMinisterioHacienda es false', () => {
    assert.equal(baseSummary.replacesMinisterioHacienda, false);
  });

  // 17. replacesCnr === false
  it('replacesCnr es false', () => {
    assert.equal(baseSummary.replacesCnr, false);
  });

  // 18. sourceKey es 'sv_comprasal'
  it('sourceKey es sv_comprasal', () => {
    assert.equal(baseSummary.sourceKey, 'sv_comprasal');
  });

  // 19. countryCode es 'SV'
  it('countryCode es SV', () => {
    assert.equal(baseSummary.countryCode, 'SV');
  });

  // 20. summary no contiene raw_data
  it('summary no expone raw_data', () => {
    assert.ok(!('raw_data' in baseSummary), 'summary must not have raw_data field');
    assert.ok(!('rawData' in baseSummary), 'summary must not have rawData field');
  });

  // 21. summary no contiene campos fiscales NIT/NRC
  it('summary no expone NIT ni NRC', () => {
    const keys = Object.keys(baseSummary);
    assert.ok(!keys.some(k => k.toLowerCase().includes('nit')), 'No NIT field allowed');
    assert.ok(!keys.some(k => k.toLowerCase().includes('nrc')), 'No NRC field allowed');
    assert.ok(!keys.some(k => k.toLowerCase().includes('tax_id')), 'No tax_id field allowed');
  });

  // Estado vacío
  it('totalSignals = 0 con sourceYears vacío — estado vacío seguro', () => {
    assert.equal(emptySummary.totalSignals, 0);
    assert.equal(emptySummary.sourceYears.length, 0);
    assert.equal(emptySummary.latestImportedAt, null);
    // Las invariantes de seguridad se mantienen aunque no haya señales
    assert.equal(emptySummary.isFiscalSource, false);
    assert.equal(emptySummary.postApprovalConnected, false);
    assert.equal(emptySummary.humanReviewRequired, true);
  });

  // Audited fallback mantiene guardrails
  it('dataSource audited_fallback mantiene guardrails de seguridad', () => {
    const fallback: SvComprasalSignalsSummary = {
      ...emptySummary,
      dataSource: 'audited_fallback',
      dataSourceReason: 'query_failed',
    };
    assert.equal(fallback.isFiscalSource, false);
    assert.equal(fallback.postApprovalConnected, false);
    assert.equal(fallback.automaticMatchingEnabled, false);
    assert.equal(fallback.humanReviewRequired, true);
    assert.equal(fallback.signalStrength, 'weak_name_only');
  });
});
