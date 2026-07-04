import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHondurasRtn, maskRtn } from '../hn-rtn-normalizer';

describe('normalizeHondurasRtn', () => {
  // ─── Casos válidos ────────────────────────────────────────────────────────

  it('acepta RTN con prefijo HN-RTN-', () => {
    const result = normalizeHondurasRtn('HN-RTN-08011977037644');
    assert.equal(result.isValid, true);
    if (!result.isValid) return;
    assert.equal(result.normalized, '08011977037644');
    assert.equal(result.raw, 'HN-RTN-08011977037644');
  });

  it('acepta 14 dígitos sin prefijo', () => {
    const result = normalizeHondurasRtn('08011977037644');
    assert.equal(result.isValid, true);
    if (!result.isValid) return;
    assert.equal(result.normalized, '08011977037644');
  });

  it('acepta RTN con guiones internos', () => {
    const result = normalizeHondurasRtn('0801-1977-037644');
    assert.equal(result.isValid, true);
    if (!result.isValid) return;
    assert.equal(result.normalized, '08011977037644');
  });

  it('acepta RTN con espacios', () => {
    const result = normalizeHondurasRtn('  08011977037644  ');
    assert.equal(result.isValid, true);
    if (!result.isValid) return;
    assert.equal(result.normalized, '08011977037644');
  });

  it('acepta prefijo minúsculas hn-rtn-', () => {
    const result = normalizeHondurasRtn('hn-rtn-08011977037644');
    assert.equal(result.isValid, true);
    if (!result.isValid) return;
    assert.equal(result.normalized, '08011977037644');
  });

  // ─── Casos inválidos ──────────────────────────────────────────────────────

  it('rechaza null', () => {
    const result = normalizeHondurasRtn(null);
    assert.equal(result.isValid, false);
    if (result.isValid) return;
    assert.equal(result.reason, 'missing');
    assert.equal(result.raw, null);
  });

  it('rechaza undefined', () => {
    const result = normalizeHondurasRtn(undefined);
    assert.equal(result.isValid, false);
    if (result.isValid) return;
    assert.equal(result.reason, 'missing');
  });

  it('rechaza string vacío', () => {
    const result = normalizeHondurasRtn('');
    assert.equal(result.isValid, false);
    if (result.isValid) return;
    assert.equal(result.reason, 'missing');
  });

  it('rechaza 13 dígitos (longitud inválida)', () => {
    const result = normalizeHondurasRtn('0801197703764');
    assert.equal(result.isValid, false);
    if (result.isValid) return;
    assert.equal(result.reason, 'invalid_length');
  });

  it('rechaza 15 dígitos (longitud inválida)', () => {
    const result = normalizeHondurasRtn('080119770376441');
    assert.equal(result.isValid, false);
    if (result.isValid) return;
    assert.equal(result.reason, 'invalid_length');
  });

  it('rechaza RTN con letras', () => {
    const result = normalizeHondurasRtn('0801197703764X');
    assert.equal(result.isValid, false);
    if (result.isValid) return;
    assert.equal(result.reason, 'non_numeric');
  });

  it('rechaza X-ONCAE-SUPPLIERS-HC1 — no normalizar como RTN', () => {
    const result = normalizeHondurasRtn('X-ONCAE-SUPPLIERS-HC1');
    assert.equal(result.isValid, false);
    if (result.isValid) return;
    assert.equal(result.reason, 'missing');
  });
});

describe('maskRtn', () => {
  it('enmascara dígitos del medio', () => {
    const masked = maskRtn('08011977037644');
    assert.equal(masked, '08011977****44');
    assert.equal(masked.length, 14);
  });

  it('retorna **masked** si longitud incorrecta', () => {
    assert.equal(maskRtn('123'), '**masked**');
  });
});
