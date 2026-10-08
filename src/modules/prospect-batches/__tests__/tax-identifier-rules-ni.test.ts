/**
 * SOURCES-NI-CLOSE-2 — regla del número fiscal de Nicaragua (RUC). Antes no
 * existía: el RUC no se podía escribir, corregir ni importar a mano. Formatos
 * medidos el 07-10-2026 en la lista de Grandes Contribuyentes de la DGI (505
 * personas jurídicas «J» + 13 dígitos) y en las licencias sanitarias del MINSA
 * (personas naturales con su cédula: 13 dígitos + letra).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getTaxIdentifierRule, validateTaxIdentifier } from '../tax-identifier-rules';

describe('Nicaragua — RUC', () => {
  it('registrada, sólo de forma', () => {
    const rule = getTaxIdentifierRule('ni');
    assert.equal(rule?.label, 'RUC');
    assert.equal(rule?.validationLevel, 'format_only');
    assert.equal(rule?.canonicalExample, 'J0310000003750');
  });

  it('persona jurídica: «J» + 13 dígitos, con o sin espacios ni guiones; se guarda en mayúscula', () => {
    assert.deepEqual(validateTaxIdentifier('J0310000003750', 'NI'), { valid: true, normalized: 'J0310000003750' });
    assert.equal(validateTaxIdentifier('j0310000003750', 'NI').normalized, 'J0310000003750');
    assert.equal(validateTaxIdentifier('J031-0000-003750', 'NI').normalized, 'J0310000003750');
    assert.equal(validateTaxIdentifier('J 0130000004422', 'NI').normalized, 'J0130000004422');
  });

  it('persona natural (cédula: 13 dígitos + letra) y residente («R» + 13 dígitos)', () => {
    assert.equal(validateTaxIdentifier('001-010180-0001A', 'NI').normalized, '0010101800001A');
    assert.equal(validateTaxIdentifier('2811502710018r', 'NI').normalized, '2811502710018R');
    assert.equal(validateTaxIdentifier('R2220000012345', 'NI').valid, true);
  });

  it('rechaza otro largo, otra letra inicial y caracteres extraños', () => {
    assert.equal(validateTaxIdentifier('J031000000375', 'NI').valid, false);
    assert.equal(validateTaxIdentifier('J03100000037500', 'NI').valid, false);
    assert.equal(validateTaxIdentifier('X0310000003750', 'NI').valid, false);
    assert.equal(validateTaxIdentifier('0310000003750', 'NI').valid, false);
    assert.match(validateTaxIdentifier('J031000000375', 'NI').error ?? '', /Nicaragua/);
    assert.match(validateTaxIdentifier('J03100#0003750', 'NI').error ?? '', /caracteres no permitidos/);
  });

  it('no cambia la regla de Honduras ni la de Panamá', () => {
    assert.equal(validateTaxIdentifier('J0310000003750', 'HN').valid, false);
    assert.equal(validateTaxIdentifier('J0310000003750', 'PA').valid, false);
    assert.equal(getTaxIdentifierRule('HN')?.ruleVersion, 'HN-RTN-v1');
    assert.equal(getTaxIdentifierRule('PA')?.ruleVersion, 'PA-RUC-v1');
  });
});
