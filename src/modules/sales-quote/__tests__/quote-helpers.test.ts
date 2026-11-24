/** Versiones, mercados, moneda, retorno de Selección y texto de aprobación. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApprovalDraft } from '../approval-draft';
import { defaultQuote2027Input, quote2027 } from '../engine-2027';
import { QUOTE_COUNTRIES_2026 } from '../engine-2026';
import { hasLocalCurrency, moneyContextFor, USD_CONTEXT } from '../exchange-rates';
import { countriesForMarkets, isQuoteMarket } from '../markets';
import { DEFAULT_SELECTION_ROI_INPUT, selectionRoi } from '../selection-roi';
import { availablePricingVersions, defaultPricingVersion, isPricing2026Available } from '../version';

describe('versiones de precios', () => {
  it('la 2026 vale hasta el 31 de diciembre en hora de Bogotá', () => {
    assert.equal(isPricing2026Available(new Date('2026-12-31T23:59:59-05:00')), true);
    assert.equal(isPricing2026Available(new Date('2027-01-01T00:00:00-05:00')), false);
    // A las 7 p. m. del 31 en Bogotá ya es 1 de enero en UTC: sigue valiendo.
    assert.equal(isPricing2026Available(new Date('2027-01-01T00:30:00Z')), true);
  });

  it('desde el 1 de enero solo se ofrece la 2027', () => {
    assert.deepEqual(availablePricingVersions(new Date('2026-11-24T12:00:00-05:00')), ['2026', '2027']);
    assert.deepEqual(availablePricingVersions(new Date('2027-01-02T12:00:00-05:00')), ['2027']);
    assert.equal(defaultPricingVersion(new Date('2026-11-24T12:00:00-05:00')), '2026');
    assert.equal(defaultPricingVersion(new Date('2027-01-02T12:00:00-05:00')), '2027');
  });
});

describe('mercados', () => {
  it('Andina trae sus cinco países', () => {
    assert.deepEqual(countriesForMarkets(['Andina']).map((country) => country.code), ['CO', 'EC', 'PE', 'BO', 'VE']);
  });

  it('la 2026 no cotiza Curazao, Estados Unidos ni «Sin dato»', () => {
    const codes = QUOTE_COUNTRIES_2026.map((country) => country.code);
    for (const code of ['CW', 'US', 'XX']) assert.equal(codes.includes(code), false);
    assert.equal(QUOTE_COUNTRIES_2026.find((country) => country.code === 'DO')?.factor, 1.5);
  });

  it('reconoce los mercados válidos', () => {
    assert.equal(isQuoteMarket('Centroamérica'), true);
    assert.equal(isQuoteMarket('Europa'), false);
  });
});

describe('moneda local', () => {
  it('Colombia se puede mostrar en COP; Ecuador solo en USD', () => {
    assert.deepEqual(moneyContextFor('CO', true), { currency: 'COP', rate: 3237.83 });
    assert.deepEqual(moneyContextFor('CO', false), USD_CONTEXT);
    assert.deepEqual(moneyContextFor('EC', true), USD_CONTEXT);
    assert.equal(hasLocalCurrency('MX'), true);
    assert.equal(hasLocalCurrency('PA'), false);
  });
});

describe('retorno del cliente con Selección', () => {
  it('con los valores de arranque', () => {
    const roi = selectionRoi({ ...DEFAULT_SELECTION_ROI_INPUT, annualInvestment: 12_000 });
    assert.equal(roi.hoursFreedPerYear, 3370);
    assert.equal(Math.round(roi.grossSavingsPerYear), 17409);
    assert.equal(Math.round(roi.netSavingsPerYear), 5409);
    assert.equal(roi.returnPerDollar.toFixed(2), '1.45');
    assert.equal(roi.paybackMonths.toFixed(1), '8.3');
    assert.equal(roi.daysToFillWithSelection, 14);
  });

  it('sin inversión no divide por cero', () => {
    const roi = selectionRoi({ ...DEFAULT_SELECTION_ROI_INPUT, annualInvestment: 0 });
    assert.equal(roi.returnPerDollar, 0);
    assert.equal(roi.paybackMonths, 0);
  });
});

describe('texto de la solicitud de aprobación', () => {
  it('lista las líneas bajo el mínimo con su diferencia', () => {
    const input = {
      ...defaultQuote2027Input(),
      employees: 500,
      licenses: 480,
      years: 2,
      manualDiscounts: { creator: 0.2 },
    };
    const result = quote2027(input);
    assert.deepEqual(result.belowMinimum.map((line) => line.id), ['creator']);
    const draft = buildApprovalDraft(input, result, '  Acme  ');
    assert.equal(draft.subject, 'Aprobación de descuento · Acme · Colombia');
    assert.match(draft.body, /^Solicito aprobación de descuento para Acme\./);
    assert.match(draft.body, /País: Colombia\. Plazo: 2 años\. Pagos: 1\./);
    assert.match(draft.body, /- LMS Creator \(480 licencias\): lista USD 19,4/);
    assert.doesNotMatch(draft.body, /Ninguna/);
  });

  it('sin nombre de cliente lo dice', () => {
    const input = defaultQuote2027Input();
    const draft = buildApprovalDraft(input, quote2027(input), '');
    assert.equal(draft.subject, 'Aprobación de descuento · cliente sin nombre · Colombia');
    assert.match(draft.body, /- Ninguna\./);
  });
});
