/**
 * La versión 2027 da EXACTAMENTE lo mismo que el cotizador original de Ventas.
 *
 * `fixtures/oracle-2027.json` se generó corriendo el código del sitio original
 * (cotizador-ventas-liard.vercel.app, 24-11-2026) sobre 160 combinaciones:
 * todos los países, bordes de licencias (40, 8.200, 10.000…), plazos, pagos,
 * planes de créditos, paquetes fuera de rango y descuentos manuales negativos o
 * mayores a 100 %. Si un precio cambia, este test lo dice.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  defaultQuote2027Input,
  manualDiscountFor,
  normalizeQuote2027Input,
  quote2027,
  type Quote2027Input,
} from '../engine-2027';

interface OracleCase {
  input: Quote2027Input;
  expected: Record<string, unknown> & { warningCodes: string[]; lines: Record<string, unknown>[] };
}

const cases: OracleCase[] = JSON.parse(
  readFileSync(new URL('./fixtures/oracle-2027.json', import.meta.url), 'utf8'),
);

describe('cotizador 2027 · igual al original', () => {
  it('hay casos de referencia', () => {
    assert.ok(cases.length >= 150);
  });

  cases.forEach(({ input, expected }, index) => {
    it(`caso ${index + 1}: ${input.country}, ${input.licenses} licencias, ${input.years} años, ${input.payments} pagos`, () => {
      const result = quote2027(input);
      assert.deepEqual(
        result.lines.map((line) => ({
          id: line.id,
          qty: line.qty,
          listUnit: line.listUnit,
          minUnit: line.minUnit,
          priceUnit: line.priceUnit,
          autoDiscount: line.autoDiscount,
          discount: line.discount,
          manualDiscount: line.manualDiscount,
          maxDiscount: line.maxDiscount,
          belowMinimum: line.belowMinimum,
          totalBefore: line.totalBefore,
          totalAfter: line.totalAfter,
        })),
        expected.lines,
      );
      assert.deepEqual(result.totals, expected.totals);
      assert.deepEqual(result.otherTerms, expected.otherTerms);
      assert.equal(result.multiYear, expected.multiYear);
      assert.equal(result.coverage, expected.coverage);
      assert.equal(result.coverageApplies, expected.coverageApplies);
      assert.equal(result.packageApplies, expected.packageApplies);
      assert.equal(result.paymentsDiscount, expected.paymentsDiscount);
      assert.equal(result.factor, expected.factor);
      assert.equal(result.blockedByOperations, expected.blockedByOperations);
      // «Más licencias que empleados» es un aviso nuevo de SellUp (el original lo mostraba aparte).
      assert.deepEqual(
        result.warnings.map((warning) => warning.code).filter((code) => code !== 'more_licenses_than_employees'),
        expected.warningCodes,
      );
      assert.deepEqual(
        result.belowMinimum.map((line) => line.id),
        result.lines.filter((line) => line.belowMinimum).map((line) => line.id),
      );
    });
  });
});

describe('cotizador 2027 · reglas de la pantalla', () => {
  it('sin Aprendizaje ni Selección, vuelve Aprendizaje', () => {
    const input = normalizeQuote2027Input({ ...defaultQuote2027Input(), includeLearning: false });
    assert.equal(input.includeLearning, true);
  });

  it('Desempeño y Cultura exige Aprendizaje', () => {
    const input = normalizeQuote2027Input({
      ...defaultQuote2027Input(),
      includeLearning: false,
      performanceCulture: true,
      selection: { tier: 'basic', packs: 0 },
    });
    assert.equal(input.includeLearning, false);
    assert.equal(input.performanceCulture, false);
  });

  it('avisa cuando hay más licencias que empleados', () => {
    const result = quote2027({ ...defaultQuote2027Input(), employees: 100, licenses: 120 });
    assert.ok(result.warnings.some((warning) => warning.code === 'more_licenses_than_employees'));
  });

  it('el descuento que escribe el vendedor es el total; se guarda solo la parte manual', () => {
    assert.equal(manualDiscountFor(0.35, 0.25), 0.1);
    assert.equal(manualDiscountFor(1.5, 0.25), 0.75);
    assert.equal(manualDiscountFor(-0.2, 0.25), -0.25);
  });

  it('el caso de ejemplo del sitio: 480 licencias en Colombia a 2 años', () => {
    const result = quote2027({
      ...defaultQuote2027Input(),
      employees: 500,
      licenses: 480,
      years: 2,
      content: true,
      performanceCulture: true,
    });
    assert.deepEqual(result.totals, { beforePerYear: 17496, afterPerYear: 11358, contract: 22716, savings: 12276 });
    assert.equal(result.belowMinimum.length, 0);
  });
});
