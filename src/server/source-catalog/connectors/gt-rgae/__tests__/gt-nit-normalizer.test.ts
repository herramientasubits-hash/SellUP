/**
 * Tests — GT NIT Normalizer
 * Hito: Centroamérica.7G.1
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeGuatemalaNit, maskGuatemalaNit } from '../gt-nit-normalizer';

describe('normalizeGuatemalaNit', () => {
  it('acepta string de 5 dígitos (límite inferior)', () => {
    const r = normalizeGuatemalaNit('12345');
    assert.ok(r.isValid);
    assert.equal(r.normalized, '12345');
    assert.equal(r.observedLength, 5);
    assert.equal(r.reason, null);
  });

  it('acepta string de 10 dígitos (límite superior)', () => {
    const r = normalizeGuatemalaNit('1234567890');
    assert.ok(r.isValid);
    assert.equal(r.normalized, '1234567890');
    assert.equal(r.observedLength, 10);
  });

  it('remueve guiones', () => {
    const r = normalizeGuatemalaNit('123-456-7');
    assert.ok(r.isValid);
    assert.equal(r.normalized, '1234567');
  });

  it('remueve espacios', () => {
    const r = normalizeGuatemalaNit('  123456  ');
    assert.ok(r.isValid);
    assert.equal(r.normalized, '123456');
  });

  it('acepta number (de ExcelJS/SheetJS)', () => {
    const r = normalizeGuatemalaNit(1234567);
    assert.ok(r.isValid);
    assert.equal(r.normalized, '1234567');
  });

  it('rechaza null → missing', () => {
    const r = normalizeGuatemalaNit(null);
    assert.equal(r.isValid, false);
    assert.equal(r.reason, 'missing');
    assert.equal(r.normalized, null);
  });

  it('rechaza undefined → missing', () => {
    const r = normalizeGuatemalaNit(undefined);
    assert.equal(r.isValid, false);
    assert.equal(r.reason, 'missing');
  });

  it('rechaza string vacío → missing', () => {
    const r = normalizeGuatemalaNit('');
    assert.equal(r.isValid, false);
    assert.equal(r.reason, 'missing');
  });

  it('rechaza letras → non_numeric', () => {
    const r = normalizeGuatemalaNit('ABC123');
    assert.equal(r.isValid, false);
    assert.equal(r.reason, 'non_numeric');
  });

  it('rechaza 4 dígitos → too_short', () => {
    const r = normalizeGuatemalaNit('1234');
    assert.equal(r.isValid, false);
    assert.equal(r.reason, 'too_short');
    assert.equal(r.observedLength, 4);
  });

  it('rechaza 11 dígitos → too_long', () => {
    const r = normalizeGuatemalaNit('12345678901');
    assert.equal(r.isValid, false);
    assert.equal(r.reason, 'too_long');
    assert.equal(r.observedLength, 11);
  });

  it('preserva ceros iniciales en string', () => {
    const r = normalizeGuatemalaNit('00123456');
    assert.ok(r.isValid);
    assert.equal(r.normalized, '00123456');
  });
});

describe('maskGuatemalaNit', () => {
  it('enmascara NIT preservando últimos 4', () => {
    const masked = maskGuatemalaNit('1234567');
    assert.equal(masked, 'NIT-***4567');
    assert.ok(!masked.includes('123'), 'no debe contener los primeros dígitos');
  });

  it('NIT de 4 o menos → completamente enmascarado', () => {
    const masked = maskGuatemalaNit('1234');
    assert.ok(!masked.includes('1234'), 'NIT corto no debe aparecer');
  });

  it('NIT vacío → NIT-[vacío]', () => {
    const masked = maskGuatemalaNit('');
    assert.equal(masked, 'NIT-[vacío]');
  });

  it('el helper formateado nunca contiene NIT completo (10 dígitos)', () => {
    const nit = '1234567890';
    const masked = maskGuatemalaNit(nit);
    assert.ok(!masked.includes(nit), 'no debe contener NIT completo');
    assert.ok(masked.includes('7890'), 'debe preservar últimos 4');
  });
});
