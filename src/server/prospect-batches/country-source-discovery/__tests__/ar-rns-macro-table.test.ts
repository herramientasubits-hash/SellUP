/**
 * SOURCES-AR-RNS-1 — tabla aprobada CIIU Rev. 4 (ARCA) → macro (Argentina).
 *
 * 🔴 Trinquete deliberado: la tabla es una decisión de la dueña del producto
 * («tabla AR aprobada», 29-09-2026). Si esta prueba falla porque la tabla
 * cambió, el cambio necesita su visto bueno antes de actualizar la prueba.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import {
  AR_RNS_CLASS_MACRO,
  AR_RNS_DIVISION_MACRO,
  macroHasArCoverage,
  normalizeArActivityCode,
  resolveArActivityMacro,
} from '../ar-rns-macro-table';

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, '0'));

const APPROVED: Record<string, string[]> = {
  retail: ['45', '46', '47'],
  property_construction: ['41', '42', '43', '68'],
  industry_manufacturing_chemicals_automotive: [...range(13, 18), '20', ...range(22, 33)],
  services_company: ['69', '70', '71', '73', '74', ...range(77, 82)],
  technology: ['61', '62', '63'],
  health_pharma: ['21', '86', '87', '88'],
  transport_logistics: range(49, 53),
  consumer_goods: ['10', '11', '12'],
  energy_mining_environment: [...range(5, 9), '19', '35', ...range(36, 39)],
  agroindustry: ['01', '02', '03'],
  insurance_financial_services: ['64', '65', '66'],
  government: ['84'],
};

describe('tabla aprobada división → macro (Argentina)', () => {
  it('coincide exactamente con la tabla aprobada por la dueña', () => {
    const actual: Record<string, string[]> = {};
    for (const [division, macro] of Object.entries(AR_RNS_DIVISION_MACRO)) {
      (actual[macro] ??= []).push(division);
    }
    for (const list of Object.values(actual)) list.sort();
    const expected = Object.fromEntries(Object.entries(APPROVED).map(([k, v]) => [k, [...v].sort()]));
    assert.deepEqual(actual, expected);
    assert.deepEqual({ ...AR_RNS_CLASS_MACRO }, { '4643': 'health_pharma', '4773': 'health_pharma' });
  });

  it('sólo usa macros que existen en el catálogo y cubre las 12', () => {
    const keys = new Set(MACRO_INDUSTRIES.map((d) => d.key));
    for (const macro of Object.values(AR_RNS_DIVISION_MACRO)) assert.ok(keys.has(macro), macro);
    for (const definition of MACRO_INDUSTRIES) assert.equal(macroHasArCoverage(definition.key), true, definition.key);
    assert.equal(macroHasArCoverage('no_existe'), false);
    assert.equal(macroHasArCoverage(null), false);
  });

  it('las divisiones sin macro aprobada no tienen macro', () => {
    const sinMacro = [
      ...range(55, 56), // hoteles y restaurantes
      ...range(58, 60), // editoriales, cine, radio y TV
      '72', // investigación
      '75', // veterinarias
      '85', // educación
      ...range(90, 96), // cultura, asociaciones y otros
    ];
    for (const division of sinMacro) {
      assert.equal(resolveArActivityMacro(`${division}0000`), null, division);
    }
  });

  it('la clase manda sobre la división', () => {
    assert.equal(resolveArActivityMacro('464310'), 'health_pharma'); // mayorista farmacéutico (div. 46 retail)
    assert.equal(resolveArActivityMacro('477310'), 'health_pharma'); // farmacia (div. 47 retail)
    assert.equal(resolveArActivityMacro('464110'), 'retail');
    assert.equal(resolveArActivityMacro('477110'), 'retail');
  });

  it('ARCA guarda el código como número: rellena el cero inicial y tolera espacios', () => {
    assert.equal(normalizeArActivityCode(' 651220'), '651220');
    assert.equal(normalizeArActivityCode('11111'), '011111');
    assert.equal(resolveArActivityMacro('11111'), 'agroindustry'); // 011111 → división 01
    assert.equal(resolveArActivityMacro('62010'), 'energy_mining_environment'); // 062010 → división 06
    assert.equal(normalizeArActivityCode(''), null);
    assert.equal(normalizeArActivityCode('12345678'), null);
    assert.equal(normalizeArActivityCode('abc'), null);
    assert.equal(normalizeArActivityCode(null), null);
    assert.equal(resolveArActivityMacro(undefined), null);
  });

  it('casos reales: informática → tecnología, seguros → financieras, radio → sin macro', () => {
    assert.equal(resolveArActivityMacro('620100'), 'technology');
    assert.equal(resolveArActivityMacro('651220'), 'insurance_financial_services');
    assert.equal(resolveArActivityMacro('601000'), null);
    assert.equal(resolveArActivityMacro('411010'), 'property_construction');
    assert.equal(resolveArActivityMacro('702010'), 'services_company');
  });
});
