import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFedesoftCompanyName, normalizeFedesoftNit } from '../normalizers';

describe('normalizeFedesoftNit', () => {
  it('normaliza NIT con puntos: 900.423.421', () => {
    assert.equal(normalizeFedesoftNit('900.423.421'), '900423421');
  });

  it('normaliza NIT con guion y dígito: 900423421-7', () => {
    assert.equal(normalizeFedesoftNit('900423421-7'), '9004234217');
    assert.equal(normalizeFedesoftNit('900.423.421-7'), '9004234217');
  });

  it('retorna el mismo número puro', () => {
    assert.equal(normalizeFedesoftNit('900423421'), '900423421');
  });

  it('retorna null para vacío', () => {
    assert.equal(normalizeFedesoftNit(''), null);
  });

  it('retorna null para null', () => {
    assert.equal(normalizeFedesoftNit(null), null);
  });

  it('retorna null para undefined', () => {
    assert.equal(normalizeFedesoftNit(undefined), null);
  });

  it('retorna null para string inválida', () => {
    assert.equal(normalizeFedesoftNit('N/A'), null);
  });

  it('retorna null para string con solo letras', () => {
    assert.equal(normalizeFedesoftNit('ABCD'), null);
  });

  it('maneja espacios alrededor del número', () => {
    assert.equal(normalizeFedesoftNit('  900.423.421  '), '900423421');
  });

  it('maneja guiones simples', () => {
    assert.equal(normalizeFedesoftNit('900423421-7'), '9004234217');
  });

  it('quita el guion pero mantiene el dígito de verificación', () => {
    const result = normalizeFedesoftNit('900423421-7');
    assert.equal(result, '9004234217');
    assert.ok(result!.endsWith('7'));
  });
});

describe('normalizeFedesoftCompanyName', () => {
  it('remueve S.A.S.', () => {
    const result = normalizeFedesoftCompanyName('Tecnología Digital S.A.S.');
    assert.equal(result, 'tecnologia digital');
  });

  it('remueve SAS sin puntos', () => {
    const result = normalizeFedesoftCompanyName('Soluciones Informáticas SAS');
    assert.equal(result, 'soluciones informaticas');
  });

  it('remueve S.A.', () => {
    const result = normalizeFedesoftCompanyName('Empresa Nacional S.A.');
    assert.equal(result, 'empresa nacional');
  });

  it('remueve LTDA', () => {
    const result = normalizeFedesoftCompanyName('Comercial Ltda');
    assert.equal(result, 'comercial');
  });

  it('remueve LIMITADA', () => {
    const result = normalizeFedesoftCompanyName('Distribuciones Limitada');
    assert.equal(result, 'distribuciones');
  });

  it('quita acentos', () => {
    const result = normalizeFedesoftCompanyName('Tecnología Digital');
    assert.equal(result, 'tecnologia digital');
  });

  it('normaliza espacios múltiples', () => {
    const result = normalizeFedesoftCompanyName('Empresa   Nacional   SAS');
    assert.equal(result, 'empresa nacional');
  });

  it('pasa a lowercase', () => {
    const result = normalizeFedesoftCompanyName('EMPRESA NACIONAL');
    assert.equal(result, 'empresa nacional');
  });

  it('quita puntuación', () => {
    const result = normalizeFedesoftCompanyName('Empresa Nacional, S.A.S.');
    assert.equal(result, 'empresa nacional');
  });

  it('no borra palabras del nombre real', () => {
    const result = normalizeFedesoftCompanyName('SAS Solutions S.A.S.');
    assert.equal(result, 'sas solutions');
  });

  it('remueve CORP', () => {
    const result = normalizeFedesoftCompanyName('Tech Corp');
    assert.equal(result, 'tech');
  });

  it('remueve INC', () => {
    const result = normalizeFedesoftCompanyName('Software Inc');
    assert.equal(result, 'software');
  });

  it('remueve S EN C', () => {
    const result = normalizeFedesoftCompanyName('Comercial S en C');
    assert.equal(result, 'comercial');
  });

  it('remueve SCA', () => {
    const result = normalizeFedesoftCompanyName('Agropecuaria SCA');
    assert.equal(result, 'agropecuaria');
  });

  it('remueve E.U.', () => {
    const result = normalizeFedesoftCompanyName('Consultora E.U.');
    assert.equal(result, 'consultora');
  });

  it('remueve E.I.C.E.', () => {
    const result = normalizeFedesoftCompanyName('Industrial E.I.C.E.');
    assert.equal(result, 'industrial');
  });

  it('maneja string vacío', () => {
    const result = normalizeFedesoftCompanyName('');
    assert.equal(result, '');
  });

  it('maneja solo sufijo', () => {
    const result = normalizeFedesoftCompanyName('SAS');
    assert.equal(result, '');
  });
});
