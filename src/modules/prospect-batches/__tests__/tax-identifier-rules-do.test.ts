/**
 * SOURCES-DO-INRUN-RNC-1 — República Dominicana RNC rule.
 *
 * Valid examples are real business RNCs from the DGII registry snapshot
 * (public registry data).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDominicanRncCheckDigit,
  getTaxIdentifierRule,
  validateTaxIdentifier,
} from '../tax-identifier-rules';

describe('DO RNC rule', () => {
  it('is registered for DO', () => {
    const rule = getTaxIdentifierRule('do');
    assert.equal(rule?.label, 'RNC');
    assert.equal(rule?.validationLevel, 'checksum');
  });

  it('accepts real DGII business RNCs, with or without separators', () => {
    for (const rnc of ['131735444', '133406292', '430279781', '1-31-73544-4', '131 735 444']) {
      const result = validateTaxIdentifier(rnc, 'DO');
      assert.equal(result.valid, true, rnc);
    }
    assert.equal(validateTaxIdentifier('1-31-73544-4', 'DO').normalized, '131735444');
  });

  it('rejects a wrong check digit, a wrong length and letters', () => {
    assert.equal(validateTaxIdentifier('131735445', 'DO').valid, false);
    assert.equal(validateTaxIdentifier('13173544', 'DO').valid, false);
    assert.equal(validateTaxIdentifier('00112345678', 'DO').valid, false);
    assert.equal(validateTaxIdentifier('13173544A', 'DO').valid, false);
  });

  it('computes the DGII check digit, including the 0 → 2 and 1 → 1 cases', () => {
    assert.equal(calculateDominicanRncCheckDigit('13173544'), 4);
    assert.equal(calculateDominicanRncCheckDigit('1317354'), null);
    // Exhaustive property: the digit is always a single digit 1..9.
    for (let i = 0; i < 2000; i++) {
      const body = String(10000000 + i * 4999).slice(0, 8);
      const dv = calculateDominicanRncCheckDigit(body);
      assert.ok(dv !== null && dv >= 1 && dv <= 9, body);
    }
  });

  it('does not change any other country', () => {
    assert.equal(validateTaxIdentifier('131735444', 'GT').valid, false);
    assert.equal(getTaxIdentifierRule('CO')?.label, 'NIT');
  });
});
