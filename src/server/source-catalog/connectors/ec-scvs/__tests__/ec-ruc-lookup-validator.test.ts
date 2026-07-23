/**
 * Tests — ec-ruc-lookup-validator.ts — EC-SCVS-12FIX
 *
 * Verifies the lookup-specific semantic validator that gates ec_scvs snapshot
 * lookups. This layers province + all-zeros checks on top of the conservative
 * ingest normalizer WITHOUT modifying it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEcuadorRucForScvsLookup } from '../ec-ruc-lookup-validator';

describe('validateEcuadorRucForScvsLookup — shape (delegates to normalizer)', () => {
  it('rejects null/undefined/empty as invalid (missing)', () => {
    for (const raw of [null, undefined, '', '   '] as const) {
      const result = validateEcuadorRucForScvsLookup(raw);
      assert.equal(result.valid, false, `raw=${JSON.stringify(raw)}`);
      assert.ok(result.normalizedTaxId === undefined);
      assert.ok(result.reason && result.reason.length > 0);
    }
  });

  it('rejects non-numeric contamination', () => {
    const result = validateEcuadorRucForScvsLookup('17900137310AB');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'alphabetic_contamination');
  });

  it('rejects wrong length (too short)', () => {
    const result = validateEcuadorRucForScvsLookup('17900137310');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_length');
  });

  it('rejects wrong length (too long)', () => {
    const result = validateEcuadorRucForScvsLookup('17900137310019999');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_length');
  });
});

describe('validateEcuadorRucForScvsLookup — semantic (all-zeros)', () => {
  it('rejects all-zero RUC (the EC-SCVS-11B deviation)', () => {
    const result = validateEcuadorRucForScvsLookup('0000000000000');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'all_zero_ruc');
    assert.equal(result.normalizedTaxId, undefined);
  });
});

describe('validateEcuadorRucForScvsLookup — province code', () => {
  it('rejects province 00', () => {
    const result = validateEcuadorRucForScvsLookup('0090013731001');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_province_code');
  });

  it('rejects province 25 (above the 24 provinces)', () => {
    const result = validateEcuadorRucForScvsLookup('2590013731001');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_province_code');
  });

  it('rejects province 29 (gap between 24 and exterior 30)', () => {
    const result = validateEcuadorRucForScvsLookup('2990013731001');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_province_code');
  });

  it('rejects province 31 (above exterior 30)', () => {
    const result = validateEcuadorRucForScvsLookup('3190013731001');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_province_code');
  });

  it('accepts province 01 (lower bound)', () => {
    const result = validateEcuadorRucForScvsLookup('0190013731001');
    assert.equal(result.valid, true);
    assert.equal(result.normalizedTaxId, '0190013731001');
  });

  it('accepts province 24 (upper provincial bound)', () => {
    const result = validateEcuadorRucForScvsLookup('2490013731001');
    assert.equal(result.valid, true);
    assert.equal(result.normalizedTaxId, '2490013731001');
  });

  it('accepts province 30 (exterior)', () => {
    const result = validateEcuadorRucForScvsLookup('3090013731001');
    assert.equal(result.valid, true);
    assert.equal(result.normalizedTaxId, '3090013731001');
  });

  it('accepts a typical Pichincha (17) RUC', () => {
    const result = validateEcuadorRucForScvsLookup('1790013731001');
    assert.equal(result.valid, true);
    assert.equal(result.normalizedTaxId, '1790013731001');
  });
});

describe('validateEcuadorRucForScvsLookup — suffix policy (permissive)', () => {
  it('does NOT reject a valid RUC just because the suffix is not 001', () => {
    const result = validateEcuadorRucForScvsLookup('1790013731099');
    assert.equal(result.valid, true, 'suffix 099 must be accepted');
    assert.equal(result.normalizedTaxId, '1790013731099');
  });

  it('accepts a suffix of 000 when province is valid (no suffix rule)', () => {
    const result = validateEcuadorRucForScvsLookup('1790013731000');
    assert.equal(result.valid, true);
    assert.equal(result.normalizedTaxId, '1790013731000');
  });

  it('strips grouping punctuation before validating', () => {
    const result = validateEcuadorRucForScvsLookup(' 1790-0137-31001 ');
    assert.equal(result.valid, true);
    assert.equal(result.normalizedTaxId, '1790013731001');
  });
});
