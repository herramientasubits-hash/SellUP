/**
 * Tests — BR Receita CNPJ helpers (normalization, DV, masking, hashing).
 * No network, no DB, no filesystem, no providers. Hito: BR-SOURCE-2.
 *
 * DV ground truth: the algorithm is anchored to two PUBLIC, independently
 * documented CNPJs (assembled from parts so no 14-digit literal appears):
 *   - legacy all-numeric  11.222.333/0001-81  (canonical valid test CNPJ)
 *   - alphanumeric        12.ABC.345/01DE-35  (Serpro official alphanumeric example)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeBrazilCnpj,
  validateBrazilCnpj,
  computeBrazilCnpjCheckDigits,
  buildBrazilCnpjRecordIdentityKey,
  maskBrazilCnpjForReport,
  buildBrazilCnpjHash12,
} from '../br-cnpj';

// Assemble from parts — never a literal 14-digit sequence.
const LEGACY_IDENTITY = '11222333' + '0001'; // 12 chars, raiz + ordem
const LEGACY_DV = '81';
const LEGACY_FULL = LEGACY_IDENTITY + LEGACY_DV;

const ALPHA_IDENTITY = '12ABC345' + '01DE'; // 12 chars, alphanumeric raiz + ordem
const ALPHA_DV = '35';
const ALPHA_FULL = ALPHA_IDENTITY + ALPHA_DV;

describe('computeBrazilCnpjCheckDigits', () => {
  it('matches the public legacy all-numeric anchor DV', () => {
    assert.equal(computeBrazilCnpjCheckDigits(LEGACY_IDENTITY), LEGACY_DV);
  });

  it('matches the official Serpro alphanumeric anchor DV (ASCII − 48)', () => {
    assert.equal(computeBrazilCnpjCheckDigits(ALPHA_IDENTITY), ALPHA_DV);
  });

  it('throws on identity that is not exactly 12 chars in [A-Z0-9]', () => {
    assert.throws(() => computeBrazilCnpjCheckDigits('12ABC'));
    assert.throws(() => computeBrazilCnpjCheckDigits('12ABC34501D*'));
  });
});

describe('validateBrazilCnpj', () => {
  it('accepts the legacy all-numeric anchor', () => {
    assert.equal(validateBrazilCnpj(LEGACY_FULL), true);
  });

  it('accepts the alphanumeric anchor', () => {
    assert.equal(validateBrazilCnpj(ALPHA_FULL), true);
  });

  it('rejects a CNPJ whose DV is wrong', () => {
    const wrongDv = LEGACY_IDENTITY + '82';
    assert.equal(validateBrazilCnpj(wrongDv), false);
  });
});

describe('normalizeBrazilCnpj', () => {
  it('preserves letters and does not lowercase/strip them (alphanumeric-safe)', () => {
    const result = normalizeBrazilCnpj('12.ABC.345/01DE-35');
    assert.equal(result.status, 'valid');
    assert.equal(result.normalized, ALPHA_FULL);
    assert.ok(result.normalized!.includes('ABC'));
    assert.ok(result.normalized!.includes('DE'));
  });

  it('uppercases lower-case letters and strips . / - and spaces', () => {
    const result = normalizeBrazilCnpj('  12.abc.345/01de-35  ');
    assert.equal(result.status, 'valid');
    assert.equal(result.normalized, ALPHA_FULL);
  });

  it('rejects invalid length', () => {
    const result = normalizeBrazilCnpj('12345');
    assert.equal(result.status, 'invalid_format');
    assert.equal(result.reason, 'invalid_length');
    assert.equal(result.normalized, null);
  });

  it('rejects invalid charset (symbol inside identity)', () => {
    const result = normalizeBrazilCnpj('12ABC34501D*35');
    assert.equal(result.status, 'invalid_format');
    assert.equal(result.reason, 'invalid_charset');
    assert.equal(result.normalized, null);
  });

  it('rejects a non-numeric DV', () => {
    const result = normalizeBrazilCnpj(ALPHA_IDENTITY + 'A1');
    assert.equal(result.status, 'invalid_format');
    assert.equal(result.reason, 'invalid_charset');
  });

  it('rejects a DV-invalid CNPJ (fail-closed, validator not relaxed)', () => {
    const result = normalizeBrazilCnpj(LEGACY_IDENTITY + '00');
    assert.equal(result.status, 'invalid_dv');
    assert.equal(result.reason, 'invalid_dv');
    assert.equal(result.normalized, null);
  });

  it('returns missing for null / non-string / empty', () => {
    assert.equal(normalizeBrazilCnpj(null).status, 'missing');
    assert.equal(normalizeBrazilCnpj(undefined).status, 'missing');
    assert.equal(normalizeBrazilCnpj(12345 as unknown).status, 'missing');
    assert.equal(normalizeBrazilCnpj('   ').status, 'missing');
  });
});

describe('buildBrazilCnpjRecordIdentityKey', () => {
  it('produces tax:<normalized_14>', () => {
    assert.equal(buildBrazilCnpjRecordIdentityKey(ALPHA_FULL), `tax:${ALPHA_FULL}`);
    assert.equal(buildBrazilCnpjRecordIdentityKey(LEGACY_FULL), `tax:${LEGACY_FULL}`);
  });
});

describe('maskBrazilCnpjForReport', () => {
  it('never returns the full CNPJ', () => {
    const masked = maskBrazilCnpjForReport(ALPHA_FULL);
    assert.notEqual(masked, ALPHA_FULL);
    assert.ok(!masked.includes(ALPHA_FULL));
    assert.ok(masked.includes('*'));
  });

  it('handles formatted input without leaking the full identifier', () => {
    const masked = maskBrazilCnpjForReport('12.ABC.345/01DE-35');
    assert.ok(!masked.includes(ALPHA_FULL));
  });
});

describe('buildBrazilCnpjHash12', () => {
  it('is a stable 12-char hex hash that does not expose the CNPJ', () => {
    const h1 = buildBrazilCnpjHash12(ALPHA_FULL);
    const h2 = buildBrazilCnpjHash12('12.ABC.345/01DE-35'); // same after normalization
    assert.match(h1, /^[0-9a-f]{12}$/);
    assert.equal(h1, h2);
    assert.ok(!h1.includes(ALPHA_FULL));
  });

  it('differs for different CNPJs', () => {
    assert.notEqual(buildBrazilCnpjHash12(ALPHA_FULL), buildBrazilCnpjHash12(LEGACY_FULL));
  });
});
