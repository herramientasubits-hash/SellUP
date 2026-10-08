/**
 * SOURCES-TAX-RULES-GT-HN-PA-1 — reglas del número fiscal de Guatemala (NIT),
 * Honduras (RTN) y Panamá (RUC). Antes no existían: el número de estos países no
 * se podía escribir, corregir ni importar a mano. Formatos tomados de las cargas
 * que ya usa el Agente 1 (RGAE, ONCAE/SEFIN, PanamaCompraEnCifras).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getTaxIdentifierRule, validateTaxIdentifier } from '../tax-identifier-rules';

describe('Guatemala — NIT', () => {
  it('registrada, sólo de forma', () => {
    const rule = getTaxIdentifierRule('gt');
    assert.equal(rule?.label, 'NIT');
    assert.equal(rule?.validationLevel, 'format_only');
  });

  it('dígitos con K final opcional, con o sin guion; se guarda como lo guarda el RGAE', () => {
    assert.deepEqual(validateTaxIdentifier('1234567-K', 'GT'), { valid: true, normalized: '1234567K' });
    assert.equal(validateTaxIdentifier('1234567k', 'GT').normalized, '1234567K');
    assert.equal(validateTaxIdentifier('5432109', 'GT').valid, true);
  });

  it('rechaza letras que no sean la K final y largos imposibles', () => {
    assert.equal(validateTaxIdentifier('12A4567', 'GT').valid, false);
    assert.equal(validateTaxIdentifier('123', 'GT').valid, false);
    assert.match(validateTaxIdentifier('12A4567', 'GT').error ?? '', /Guatemala/);
  });
});

describe('Honduras — RTN', () => {
  it('14 dígitos, con o sin guiones (personas jurídicas y naturales)', () => {
    assert.deepEqual(validateTaxIdentifier('0801-9001-210297', 'HN'), { valid: true, normalized: '08019001210297' });
    assert.equal(validateTaxIdentifier('08011985123456', 'HN').valid, true);
  });

  it('rechaza otro largo', () => {
    assert.equal(validateTaxIdentifier('0801900121029', 'HN').valid, false);
    assert.match(validateTaxIdentifier('0801900121029', 'HN').error ?? '', /Honduras/);
  });
});

describe('Panamá — RUC', () => {
  it('persona jurídica: tomo-folio-asiento; el DV se quita (como en la carga)', () => {
    assert.equal(validateTaxIdentifier('998592-1-535732', 'PA').normalized, '998592-1-535732');
    assert.equal(validateTaxIdentifier('280-319-61818 D.V.53', 'PA').normalized, '280-319-61818');
    assert.equal(validateTaxIdentifier('984825-1-532934 DV 86', 'PA').normalized, '984825-1-532934');
    assert.equal(validateTaxIdentifier('983932-1-532761-43', 'PA').normalized, '983932-1-532761');
  });

  it('persona natural: cédulas de provincia, E-, N-, PE-, AV y PI', () => {
    for (const id of ['8-123-456', 'E-8-96362', 'N-22-1910', 'PE-9-1606', '8AV-12-345', '4PI-1-123']) {
      assert.equal(validateTaxIdentifier(id, 'PA').valid, true, id);
    }
  });

  it('entidad pública: provincia-NT-tomo-asiento; sin DV ni ceros a la izquierda (SOURCES-PA-CLOSE-1)', () => {
    assert.equal(validateTaxIdentifier('8-NT-2-4249-8', 'PA').normalized, '8-NT-2-4249');
    assert.equal(validateTaxIdentifier('8-NT-01-12761', 'PA').normalized, '8-NT-1-12761');
    assert.equal(validateTaxIdentifier('3-NT-2506-10982', 'PA').valid, true);
  });

  it('rechaza formas rotas', () => {
    for (const id of ['8NT2763992', '8-NT-12761', 'X-NT-1-2', '9--95-113', 'ABC-1-2', '263837-1-404979-1-404979']) {
      assert.equal(validateTaxIdentifier(id, 'PA').valid, false, id);
    }
    assert.match(validateTaxIdentifier('ABC-1-2', 'PA').error ?? '', /Panamá/);
  });
});

describe('países sin regla siguen avisando', () => {
  // SOURCES-SV-CLOSE-1: El Salvador ya tiene regla; Venezuela sigue sin ella.
  it('Venezuela no tiene regla', () => {
    assert.equal(getTaxIdentifierRule('VE'), undefined);
    assert.equal(validateTaxIdentifier('J-12345678-9', 'VE').valid, false);
  });
});
