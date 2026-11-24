/**
 * La versión 2026 da EXACTAMENTE lo mismo que el cotizador original de Ventas.
 *
 * `fixtures/oracle-2026.json` se generó corriendo el código del sitio original
 * (24-11-2026) sobre 140 combinaciones: todos los países, cada borde de tramo de
 * licencias, Executive/Standard, módulos, precio pedido fuera de rango, plazos
 * de 1 a 5 años, pagos y planes de créditos.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { defaultQuote2026Input, quote2026, type Quote2026Input, type Quote2026Term } from '../engine-2026';

interface OracleCase {
  input: Quote2026Input;
  expected: Record<string, unknown> & { main: Record<string, unknown>; terms: Record<string, unknown>[] };
}

const cases: OracleCase[] = JSON.parse(
  readFileSync(new URL('./fixtures/oracle-2026.json', import.meta.url), 'utf8'),
);

const termTotals = (term: Quote2026Term) => ({
  years: term.years,
  multiYear: term.multiYear,
  subscriptionPerYear: term.subscriptionPerYear,
  servicesPerYear: term.servicesPerYear,
  totalPerYear: term.totalPerYear,
  listPerYear: term.listPerYear,
  contract: term.contract,
});

describe('cotizador 2026 · igual al original', () => {
  it('hay casos de referencia', () => {
    assert.ok(cases.length >= 130);
  });

  cases.forEach(({ input, expected }, index) => {
    it(`caso ${index + 1}: ${input.country}, ${input.licenses} licencias, ${input.years} años, ${input.payments} pagos`, () => {
      const result = quote2026(input);
      assert.deepEqual(
        {
          ...termTotals(result.main),
          lines: result.main.lines.map((line) => ({
            id: line.id,
            kind: line.kind,
            qty: line.qty,
            listUnit: line.listUnit,
            minUnit: line.minUnit,
            startUnit: line.startUnit,
            priceUnit: line.priceUnit,
            discount: line.discount,
            floored: line.floored,
            listTotal: line.listTotal,
            minTotal: line.minTotal,
            total: line.total,
          })),
        },
        expected.main,
      );
      assert.equal(result.oneYear.totalPerYear, expected.oneYearTotalPerYear);
      assert.deepEqual(result.terms.map(termTotals), expected.terms);
      assert.equal(result.factor, expected.factor);
      assert.equal(result.productCount, expected.productCount);
      assert.equal(result.packageApplies, expected.packageApplies);
      assert.equal(result.paymentsDiscount, expected.paymentsDiscount);
      assert.deepEqual(result.priceRange, expected.priceRange);
      assert.equal(result.blocked, expected.blocked);
      assert.deepEqual(
        result.warnings.map((warning) => warning.code),
        expected.warningCodes,
      );
    });
  });
});

describe('cotizador 2026 · reglas', () => {
  it('ningún precio baja del mínimo', () => {
    const result = quote2026({ ...defaultQuote2026Input(), licenses: 300, years: 5, payments: 1, modules: { assessments: true, desempeno: true, planes: true, encuestas: true } });
    for (const line of result.main.lines) assert.ok(line.priceUnit >= line.minUnit, line.id);
    assert.ok(result.main.lines.some((line) => line.floored));
  });

  it('sin licencias no hay líneas de Aprendizaje y lo pide', () => {
    const result = quote2026(defaultQuote2026Input());
    assert.equal(result.main.lines.length, 0);
    assert.deepEqual(result.warnings.map((warning) => warning.code), ['no_licenses']);
  });
});
