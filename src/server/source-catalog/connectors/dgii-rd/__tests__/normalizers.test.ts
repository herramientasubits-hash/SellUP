import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDominicanRnc,
  isDominicanBusinessRnc,
  normalizeDgiiStatus,
  isActiveDgiiTaxpayer,
} from '../normalizers';

describe('normalizeDominicanRnc', () => {
  it('conserva 9 dígitos limpio', () => {
    assert.equal(normalizeDominicanRnc('101123456'), '101123456');
  });

  it('limpia guiones y conserva 9 dígitos', () => {
    assert.equal(normalizeDominicanRnc('1-01-12345-6'), '101123456');
  });

  it('limpia espacios y conserva 9 dígitos', () => {
    assert.equal(normalizeDominicanRnc(' 101 123 456 '), '101123456');
  });

  it('limpia puntos y conserva 9 dígitos', () => {
    assert.equal(normalizeDominicanRnc('101.123.456'), '101123456');
  });

  it('conserva cédula 11 dígitos', () => {
    assert.equal(normalizeDominicanRnc('00112345678'), '00112345678');
  });

  it('retorna null para 8 dígitos (fuera de scope)', () => {
    assert.equal(normalizeDominicanRnc('12345678'), null);
  });

  it('retorna null para letras', () => {
    assert.equal(normalizeDominicanRnc('ABC123'), null);
  });

  it('retorna null para cadena vacía', () => {
    assert.equal(normalizeDominicanRnc(''), null);
  });
});

describe('isDominicanBusinessRnc', () => {
  it('true para RNC jurídico de 9 dígitos', () => {
    assert.equal(isDominicanBusinessRnc('101123456'), true);
  });

  it('false para cédula de 11 dígitos', () => {
    assert.equal(isDominicanBusinessRnc('00112345678'), false);
  });

  it('true para valor con guiones que normaliza a 9 dígitos', () => {
    assert.equal(isDominicanBusinessRnc('1-01-12345-6'), true);
  });

  it('false para cadena no numérica', () => {
    assert.equal(isDominicanBusinessRnc('NOESRNC'), false);
  });

  it('false para 7 dígitos', () => {
    assert.equal(isDominicanBusinessRnc('1234567'), false);
  });
});

describe('normalizeDgiiStatus', () => {
  it('ACTIVO → active', () => {
    assert.equal(normalizeDgiiStatus('ACTIVO'), 'active');
  });

  it('activo (minúsculas) → active', () => {
    assert.equal(normalizeDgiiStatus('activo'), 'active');
  });

  it('SUSPENDIDO → suspended', () => {
    assert.equal(normalizeDgiiStatus('SUSPENDIDO'), 'suspended');
  });

  it('DADO DE BAJA → inactive', () => {
    assert.equal(normalizeDgiiStatus('DADO DE BAJA'), 'inactive');
  });

  it('CESACION TEMPORAL (sin tilde) → temporary_ceased', () => {
    assert.equal(normalizeDgiiStatus('CESACION TEMPORAL'), 'temporary_ceased');
  });

  it('CESACIÓN TEMPORAL (con tilde) → temporary_ceased', () => {
    assert.equal(normalizeDgiiStatus('CESACIÓN TEMPORAL'), 'temporary_ceased');
  });

  it('valor desconocido → unknown', () => {
    assert.equal(normalizeDgiiStatus('OTRO ESTADO'), 'unknown');
  });

  it('cadena vacía → unknown', () => {
    assert.equal(normalizeDgiiStatus(''), 'unknown');
  });
});

describe('isActiveDgiiTaxpayer', () => {
  it('ACTIVO → true', () => {
    assert.equal(isActiveDgiiTaxpayer('ACTIVO'), true);
  });

  it('SUSPENDIDO → false', () => {
    assert.equal(isActiveDgiiTaxpayer('SUSPENDIDO'), false);
  });

  it('DADO DE BAJA → false', () => {
    assert.equal(isActiveDgiiTaxpayer('DADO DE BAJA'), false);
  });

  it('CESACION TEMPORAL → false', () => {
    assert.equal(isActiveDgiiTaxpayer('CESACION TEMPORAL'), false);
  });
});
