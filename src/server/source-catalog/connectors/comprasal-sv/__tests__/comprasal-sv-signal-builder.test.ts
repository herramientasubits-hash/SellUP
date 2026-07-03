/**
 * Tests — comprasal-sv-signal-builder
 * Hito: Centroamérica.7C
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProcurementSignals, buildDryRunSummary } from '../comprasal-sv-signal-builder';
import type { NormalizedAdjudicacion } from '../comprasal-sv-normalizer';

const makeNorm = (
  overrides: Partial<NormalizedAdjudicacion> = {},
): NormalizedAdjudicacion => ({
  award_id: '455089',
  monto: 10960,
  supplier_name: 'Ingeniería Eléctrica y Civil, Sociedad Anónima de Capital Variable',
  supplier_commercial_name: 'INELCI S.A. DE C.V.',
  supplier_platform_id: '186',
  normalized_supplier_name: 'ingenieria electrica y civil sociedad anonima de capital variable',
  process_code: '2400-2026-P0327',
  process_name: 'Adquisición de materiales eléctricos',
  award_date: '2026-07-02',
  institution_name: 'Ministerio de Obras Públicas',
  institution_code: '2400',
  contract_form: null,
  tax_id: null,
  normalized_tax_id: null,
  matching_mode: 'name_only_review_required',
  ...overrides,
});

describe('comprasal-sv-signal-builder', () => {
  it('agrupa por nombre normalizado', () => {
    const adjs = [
      makeNorm({ award_id: '1', normalized_supplier_name: 'empresa a' }),
      makeNorm({ award_id: '2', normalized_supplier_name: 'empresa a' }),
      makeNorm({ award_id: '3', normalized_supplier_name: 'empresa b' }),
    ];
    const signals = buildProcurementSignals(adjs);
    assert.equal(signals.length, 2);
  });

  it('calcula awards_count correctamente', () => {
    const adjs = [
      makeNorm({ award_id: '1', normalized_supplier_name: 'empresa a' }),
      makeNorm({ award_id: '2', normalized_supplier_name: 'empresa a' }),
    ];
    const signals = buildProcurementSignals(adjs);
    assert.equal(signals[0].awards_count, 2);
  });

  it('calcula total_awarded_amount correctamente', () => {
    const adjs = [
      makeNorm({ award_id: '1', monto: 5000, normalized_supplier_name: 'empresa a' }),
      makeNorm({ award_id: '2', monto: 3000, normalized_supplier_name: 'empresa a' }),
    ];
    const signals = buildProcurementSignals(adjs);
    assert.equal(signals[0].total_awarded_amount, 8000);
  });

  it('signal_strength = weak_name_only', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    assert.equal(signals[0].signal_strength, 'weak_name_only');
  });

  it('matching_mode = name_only_review_required', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    assert.equal(signals[0].matching_mode, 'name_only_review_required');
  });

  it('tax_id = null siempre', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    assert.equal(signals[0].tax_id, null);
  });

  it('normalized_tax_id = null siempre', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    assert.equal(signals[0].normalized_tax_id, null);
  });

  it('no escribe DB (db_writes = 0 en dry-run summary)', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    const summary = buildDryRunSummary(signals, 1, 1, []);
    assert.equal(summary.db_writes, 0);
  });

  it('source_key = sv_comprasal', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    assert.equal(signals[0].source_key, 'sv_comprasal');
  });

  it('country_code = SV', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    assert.equal(signals[0].country_code, 'SV');
  });

  it('limitations menciona NIT/NRC', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    const hasNitNrc = signals[0].limitations.some(
      (l) => l.toLowerCase().includes('nit') || l.toLowerCase().includes('nrc'),
    );
    assert.ok(hasNitNrc);
  });

  it('limitations menciona name-only', () => {
    const signals = buildProcurementSignals([makeNorm()]);
    const hasNameOnly = signals[0].limitations.some(
      (l) => l.toLowerCase().includes('name-only') || l.toLowerCase().includes('name only'),
    );
    assert.ok(hasNameOnly);
  });
});
