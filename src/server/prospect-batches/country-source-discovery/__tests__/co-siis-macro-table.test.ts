/**
 * SOURCES-CO-CLOSE-1 — tabla de industrias de Colombia (aprobada por la dueña el
 * 06-10-2026): la de Argentina v2 por división, con las clases propias de
 * Colombia. Cambiarla es decisión de producto: esta suite la fija.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CO_SIIS_CLASS_MACRO,
  listCoCiiuCodesForMacro,
  macroHasCoSiisCoverage,
  normalizeCoCiiuCode,
  resolveCoCiiuMacro,
} from '../co-siis-macro-table';
import { AR_RNS_DIVISION_MACRO } from '../ar-rns-macro-table';

test('el código llega como número, texto o sin el cero inicial', () => {
  assert.equal(normalizeCoCiiuCode(2100), '2100');
  assert.equal(normalizeCoCiiuCode(111), '0111');
  assert.equal(normalizeCoCiiuCode(' 6201 '), '6201');
  assert.equal(normalizeCoCiiuCode('62011'), null);
  assert.equal(normalizeCoCiiuCode(21.5), null);
  assert.equal(normalizeCoCiiuCode(null), null);
});

test('la división sigue la tabla aprobada para Argentina', () => {
  for (const [code, macro] of [
    ['6201', 'technology'],
    ['6110', 'technology'],
    ['4711', 'retail'],
    ['1040', 'consumer_goods'],
    ['8610', 'health_pharma'],
    ['2100', 'health_pharma'],
    ['0111', 'agroindustry'],
    ['4923', 'transport_logistics'],
    ['6810', 'property_construction'],
  ] as const) {
    assert.equal(resolveCoCiiuMacro(code), macro, code);
    assert.equal(AR_RNS_DIVISION_MACRO[code.slice(0, 2)] === macro || CO_SIIS_CLASS_MACRO[code] === macro, true, code);
  }
});

test('las clases propias de Colombia mandan sobre la división', () => {
  assert.equal(resolveCoCiiuMacro('4645'), 'health_pharma');
  assert.equal(resolveCoCiiuMacro('4773'), 'health_pharma');
  assert.equal(resolveCoCiiuMacro('4651'), 'technology');
  assert.equal(resolveCoCiiuMacro('4652'), 'technology');
  assert.equal(resolveCoCiiuMacro('4741'), 'technology');
  // El falso positivo del 01-09: comercio por internet es Retail, no Tecnología.
  assert.equal(resolveCoCiiuMacro('4791'), 'retail');
});

test('sin industria: educación, hoteles, medios y la división 84 del SIIS', () => {
  for (const code of ['8511', '5511', '6010', '8413', '9499']) assert.equal(resolveCoCiiuMacro(code), null, code);
});

test('las doce macros del catálogo (menos Gobierno, que va por entidades públicas) tienen códigos', () => {
  for (const macro of [
    'technology', 'retail', 'consumer_goods', 'health_pharma', 'industry_manufacturing_chemicals_automotive',
    'property_construction', 'transport_logistics', 'energy_mining_environment', 'insurance_financial_services',
    'services_company', 'agroindustry',
  ]) {
    assert.ok(macroHasCoSiisCoverage(macro), macro);
  }
  assert.equal(macroHasCoSiisCoverage('government'), false);
  assert.equal(macroHasCoSiisCoverage(null), false);
});

test('la lista de códigos de una macro incluye los que el SIIS publica fuera del catálogo DANE', () => {
  const manufacturing = listCoCiiuCodesForMacro('industry_manufacturing_chemicals_automotive');
  assert.ok(manufacturing.includes('1311'));
  assert.ok(manufacturing.includes('3110'));
  for (const code of listCoCiiuCodesForMacro('technology')) assert.equal(resolveCoCiiuMacro(code), 'technology');
});
