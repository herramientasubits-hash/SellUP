/**
 * Tests — EC RUC Normalizer
 * Sin red, sin DB. Hito: Catálogo.EC.3
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeEcuadorRuc, maskEcuadorRuc } from '../ec-ruc-normalizer';

describe('normalizeEcuadorRuc', () => {
  it('acepta 13 dígitos numéricos válidos', () => {
    const result = normalizeEcuadorRuc('1790013731001');
    assert.equal(result.status, 'valid');
    assert.equal(result.normalized, '1790013731001');
    assert.equal(result.observedLength, 13);
  });

  it('hace trim de espacios circundantes', () => {
    const result = normalizeEcuadorRuc('  1790013731001  ');
    assert.equal(result.status, 'valid');
    assert.equal(result.normalized, '1790013731001');
  });

  it('elimina espacios internos y guiones de agrupación', () => {
    const result = normalizeEcuadorRuc('1790-0137 31001');
    assert.equal(result.status, 'valid');
    assert.equal(result.normalized, '1790013731001');
  });

  it('clasifica RUC ausente (null) como missing', () => {
    const result = normalizeEcuadorRuc(null);
    assert.equal(result.status, 'missing');
    assert.equal(result.reason, 'missing');
    assert.equal(result.normalized, null);
  });

  it('clasifica RUC ausente (undefined) como missing', () => {
    const result = normalizeEcuadorRuc(undefined);
    assert.equal(result.status, 'missing');
  });

  it('clasifica string vacío como missing', () => {
    const result = normalizeEcuadorRuc('   ');
    assert.equal(result.status, 'missing');
  });

  it('rechaza contenido con letras como invalid_format/alphabetic_contamination', () => {
    const result = normalizeEcuadorRuc('179001373100A');
    assert.equal(result.status, 'invalid_format');
    assert.equal(result.reason, 'alphabetic_contamination');
    assert.equal(result.normalized, null);
  });

  it('rechaza longitud corta como invalid_format/invalid_length', () => {
    const result = normalizeEcuadorRuc('17900137310');
    assert.equal(result.status, 'invalid_format');
    assert.equal(result.reason, 'invalid_length');
    assert.equal(result.observedLength, 11);
  });

  it('rechaza longitud larga como invalid_format/invalid_length', () => {
    const result = normalizeEcuadorRuc('17900137310019999');
    assert.equal(result.status, 'invalid_format');
    assert.equal(result.reason, 'invalid_length');
  });

  it('NO implementa semántica de checksum (dígito verificador incorrecto sigue siendo valid si tiene 13 dígitos)', () => {
    const result = normalizeEcuadorRuc('0000000000000');
    assert.equal(result.status, 'valid');
  });

  it('NO exige sufijo de establecimiento 001 (acepta otros sufijos de 13 dígitos)', () => {
    const result = normalizeEcuadorRuc('1790013731099');
    assert.equal(result.status, 'valid');
    assert.equal(result.normalized, '1790013731099');
  });

  it('acepta number como input y lo convierte sin notación científica para longitudes normales', () => {
    const result = normalizeEcuadorRuc(1790013731001);
    assert.equal(result.status, 'valid');
    assert.equal(result.normalized, '1790013731001');
  });
});

describe('maskEcuadorRuc', () => {
  it('enmascara dejando visibles solo los últimos 4 dígitos', () => {
    assert.equal(maskEcuadorRuc('1790013731001'), 'RUC-*********1001');
  });

  it('maneja strings cortos sin lanzar', () => {
    assert.equal(maskEcuadorRuc('12'), 'RUC-**');
  });

  it('maneja string vacío sin lanzar', () => {
    assert.equal(maskEcuadorRuc(''), 'RUC-[vacío]');
  });
});
