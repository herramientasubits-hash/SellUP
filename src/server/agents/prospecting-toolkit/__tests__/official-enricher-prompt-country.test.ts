/**
 * Tests — v1.16K-M Official enricher prompt country-aware
 *
 * Verifies getCountryEnricherContext returns the correct country-specific
 * labels for the evaluation prompt. Ensures no non-CO candidate receives
 * the Colombia/NIT/RUES defaults.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCountryEnricherContext } from '../official-candidate-enricher';

describe('OEPC1 — getCountryEnricherContext correct labels per country', () => {
  it('CO → Colombia / NIT / RUES', () => {
    const ctx = getCountryEnricherContext('CO');
    assert.equal(ctx.countryTerm, 'Colombia');
    assert.equal(ctx.taxIdLabel, 'NIT');
    assert.equal(ctx.registryLabel, 'RUES');
  });

  it('MX → México / RFC / DENUE/SAT', () => {
    const ctx = getCountryEnricherContext('MX');
    assert.equal(ctx.countryTerm, 'México');
    assert.equal(ctx.taxIdLabel, 'RFC');
    assert.ok(ctx.registryLabel.includes('SAT') || ctx.registryLabel.includes('DENUE'));
  });

  it('CL → Chile / RUT / SII or RES Chile', () => {
    const ctx = getCountryEnricherContext('CL');
    assert.equal(ctx.countryTerm, 'Chile');
    assert.equal(ctx.taxIdLabel, 'RUT');
    assert.ok(ctx.registryLabel.includes('Chile') || ctx.registryLabel.includes('SII'));
  });

  it('PE → Perú / RUC / SUNAT', () => {
    const ctx = getCountryEnricherContext('PE');
    assert.equal(ctx.countryTerm, 'Perú');
    assert.equal(ctx.taxIdLabel, 'RUC');
    assert.ok(ctx.registryLabel.includes('SUNAT'));
  });

  it('EC → Ecuador / RUC / SRI', () => {
    const ctx = getCountryEnricherContext('EC');
    assert.equal(ctx.countryTerm, 'Ecuador');
    assert.equal(ctx.taxIdLabel, 'RUC');
    assert.ok(ctx.registryLabel.includes('SRI'));
  });
});

describe('OEPC2 — getCountryEnricherContext fallback behavior', () => {
  it('null → defaults to Colombia', () => {
    const ctx = getCountryEnricherContext(null);
    assert.equal(ctx.countryTerm, 'Colombia');
    assert.equal(ctx.taxIdLabel, 'NIT');
    assert.equal(ctx.registryLabel, 'RUES');
  });

  it('undefined → defaults to Colombia', () => {
    const ctx = getCountryEnricherContext(undefined);
    assert.equal(ctx.countryTerm, 'Colombia');
  });

  it('unknown code → defaults to Colombia', () => {
    const ctx = getCountryEnricherContext('AR');
    assert.equal(ctx.countryTerm, 'Colombia');
  });

  it('PE and EC both return RUC as taxIdLabel', () => {
    const pe = getCountryEnricherContext('PE');
    const ec = getCountryEnricherContext('EC');
    assert.equal(pe.taxIdLabel, 'RUC');
    assert.equal(ec.taxIdLabel, 'RUC');
  });

  it('MX, CL, PE, EC do NOT return NIT as taxIdLabel', () => {
    for (const cc of ['MX', 'CL', 'PE', 'EC']) {
      const ctx = getCountryEnricherContext(cc);
      assert.notEqual(ctx.taxIdLabel, 'NIT', `${cc} should not use NIT`);
    }
  });

  it('MX, CL, PE, EC do NOT return RUES as registryLabel', () => {
    for (const cc of ['MX', 'CL', 'PE', 'EC']) {
      const ctx = getCountryEnricherContext(cc);
      assert.notEqual(ctx.registryLabel, 'RUES', `${cc} should not use RUES`);
    }
  });
});
