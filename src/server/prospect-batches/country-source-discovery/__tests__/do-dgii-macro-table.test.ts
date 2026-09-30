/**
 * SOURCES-DO-FREE-DISCOVERY-1 — tabla aprobada CIIU.DR → macro (República Dominicana).
 *
 * 🔴 Trinquete deliberado: la tabla es una decisión de la dueña del producto
 * («tabla aprobada», 29-09-2026). Si esta prueba falla porque la tabla cambió, el
 * cambio necesita su visto bueno antes de actualizar la prueba.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import {
  classifyDgiiActivityText,
  DO_DGII_CLASS_MACRO,
  DO_DGII_DIVISION_MACRO,
  macroHasDgiiCoverage,
  resolveCiiuDrMacro,
  resolveDgiiActivityTextsForMacro,
} from '../do-dgii-macro-table';
import { DGII_ACTIVITY_CIIU_DR_CATALOG } from '@/server/source-catalog/connectors/dgii-rd/dgii-activity-ciiu-dr-catalog';

const APPROVED_DIVISIONS: Record<string, string[]> = {
  agroindustry: ['01', '02', '05'],
  energy_mining_environment: ['10', '11', '12', '13', '14', '23', '37', '40', '41', '90'],
  consumer_goods: ['15', '16'],
  industry_manufacturing_chemicals_automotive: [
    '17', '18', '19', '20', '21', '22', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33',
    '34', '35', '36',
  ],
  property_construction: ['45', '70'],
  retail: ['50', '51', '52'],
  transport_logistics: ['60', '61', '62', '63', '64'],
  insurance_financial_services: ['65', '66', '67'],
  technology: ['72'],
  services_company: ['74'],
  government: ['75'],
  health_pharma: ['85'],
};

describe('tabla aprobada división → macro', () => {
  it('coincide exactamente con la tabla aprobada por la dueña', () => {
    const actual: Record<string, string[]> = {};
    for (const [division, macro] of Object.entries(DO_DGII_DIVISION_MACRO)) {
      (actual[macro] ??= []).push(division);
    }
    for (const list of Object.values(actual)) list.sort();
    assert.deepEqual(actual, APPROVED_DIVISIONS);
    assert.deepEqual({ ...DO_DGII_CLASS_MACRO }, {
      '2423': 'health_pharma',
      '3311': 'health_pharma',
      '5133': 'health_pharma',
      '5231': 'health_pharma',
      '642': 'technology',
    });
  });

  it('sólo usa macros que existen en el catálogo', () => {
    const keys = new Set(MACRO_INDUSTRIES.map((d) => d.key));
    for (const macro of [...Object.values(DO_DGII_DIVISION_MACRO), ...Object.values(DO_DGII_CLASS_MACRO)]) {
      assert.ok(keys.has(macro), macro);
    }
  });

  it('la clase manda sobre su división', () => {
    assert.equal(resolveCiiuDrMacro('523110'), 'health_pharma'); // farmacias (div. 52 retail)
    assert.equal(resolveCiiuDrMacro('523956'), 'retail'); // misma división, otra clase
    assert.equal(resolveCiiuDrMacro('642000'), 'technology'); // telecom (div. 64 transporte)
    assert.equal(resolveCiiuDrMacro('641100'), 'transport_logistics');
    assert.equal(resolveCiiuDrMacro('242310'), 'health_pharma'); // medicamentos (div. 24)
    assert.equal(resolveCiiuDrMacro('241100'), 'industry_manufacturing_chemicals_automotive');
  });

  it('divisiones sin macro aprobada no tienen macro', () => {
    for (const code of ['551222', '801002', '803201', '921100', '911205', '710000', '731000']) {
      assert.equal(resolveCiiuDrMacro(code), null, code);
    }
    assert.equal(resolveCiiuDrMacro('12345'), null);
    assert.equal(resolveCiiuDrMacro('abcdef'), null);
  });
});

describe('índice de textos DGII', () => {
  it('corrige los falsos positivos medidos con el evaluador por palabras', () => {
    assert.equal(
      classifyDgiiActivityText('CONSTRUCCIÓN DE BARCOS A MOTOR')?.macroIndustryKey,
      'industry_manufacturing_chemicals_automotive',
    );
    assert.equal(classifyDgiiActivityText('FOTOGRAFÍA DE PUBLICIDAD, EDIT')?.macroIndustryKey, 'services_company');
    assert.equal(classifyDgiiActivityText('CONSTRUCCIÓN DE HOSPITALES, ES')?.macroIndustryKey, 'property_construction');
  });

  it('un texto cuyos códigos apuntan a macros distintas queda fuera', () => {
    // 112000 (petróleo → energía) y 222200 (imprenta → manufactura).
    const entry = DGII_ACTIVITY_CIIU_DR_CATALOG.find((e) => e.text === 'ACTIVIDADES  DE SERVICIOS RELA');
    assert.ok(entry && entry.codes.some((c) => c.startsWith('11')) && entry.codes.some((c) => c.startsWith('22')));
    assert.equal(classifyDgiiActivityText('ACTIVIDADES  DE SERVICIOS RELA'), null);
  });

  it('un texto que no está en el catálogo no tiene macro', () => {
    assert.equal(classifyDgiiActivityText('TEXTO QUE NO EXISTE EN DGII'), null);
    assert.equal(classifyDgiiActivityText(null), null);
  });

  it('cada texto de una macro se clasifica en esa misma macro', () => {
    for (const definition of MACRO_INDUSTRIES) {
      for (const text of resolveDgiiActivityTextsForMacro(definition.key)) {
        assert.equal(classifyDgiiActivityText(text)?.macroIndustryKey, definition.key, text);
      }
    }
  });

  it('las 12 macros tienen cobertura y una macro desconocida no', () => {
    for (const definition of MACRO_INDUSTRIES) {
      assert.ok(macroHasDgiiCoverage(definition.key), definition.key);
    }
    assert.equal(macroHasDgiiCoverage('no_existe'), false);
    assert.equal(macroHasDgiiCoverage(null), false);
    assert.deepEqual(resolveDgiiActivityTextsForMacro(undefined), []);
  });

  it('el catálogo de datos está bien formado', () => {
    assert.ok(DGII_ACTIVITY_CIIU_DR_CATALOG.length > 1000);
    const seen = new Set<string>();
    for (const entry of DGII_ACTIVITY_CIIU_DR_CATALOG) {
      assert.ok(entry.text.length > 0 && entry.text.length <= 30, entry.text);
      assert.ok(!seen.has(entry.text), `duplicado: ${entry.text}`);
      seen.add(entry.text);
      assert.ok(entry.codes.length > 0 && entry.codes.every((c) => /^\d{6}$/.test(c)), entry.text);
      assert.ok(entry.description.length > 0, entry.text);
    }
  });
});
