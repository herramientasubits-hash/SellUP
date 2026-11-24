/** Quién cotiza qué regiones, y cómo se leen las cifras. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QUOTE_COUNTRIES_2026 } from '../engine-2026';
import { USD_CONTEXT } from '../exchange-rates';
import { formatQuoteMoney, formatQuotePercent } from '../format';
import { QUOTE_MARKETS } from '../markets';
import { applyMarketAssignment, canQuoteCountry, quotableCountries, resolveQuoteMarkets, seesAllQuoteMarkets } from '../quote-access';

describe('regiones del cotizador', () => {
  it('admin, manager y líder comercial cotizan todas por su rol', () => {
    for (const viewer of [
      { isAdmin: true, roleKey: 'admin' },
      { isAdmin: false, roleKey: 'commercial_manager' },
      { isAdmin: false, roleKey: 'commercial_lead' },
    ]) {
      assert.equal(seesAllQuoteMarkets(viewer), true);
      assert.deepEqual(resolveQuoteMarkets(viewer, []), { markets: [...QUOTE_MARKETS], seesAll: true });
    }
  });

  it('BD y Growth cotizan solo lo asignado; lo que no es una región se ignora', () => {
    for (const roleKey of ['seller_bd', 'growth']) {
      const access = resolveQuoteMarkets({ isAdmin: false, roleKey }, ['Chile', 'Andina', 'Europa', 7]);
      assert.deepEqual(access, { markets: ['Andina', 'Chile'], seesAll: false });
    }
  });

  it('🔴 sin región asignada no cotiza ningún país', () => {
    const access = resolveQuoteMarkets({ isAdmin: false, roleKey: 'seller_bd' }, []);
    assert.deepEqual(quotableCountries(access), []);
    assert.equal(canQuoteCountry(access, 'CO'), false);
  });

  it('🔴 sin rol conocido tampoco ve todo', () => {
    assert.equal(seesAllQuoteMarkets({ isAdmin: false, roleKey: null }), false);
  });

  it('un BD de Andina ve solo sus países, en cada versión', () => {
    const access = resolveQuoteMarkets({ isAdmin: false, roleKey: 'seller_bd' }, ['Andina']);
    assert.deepEqual(quotableCountries(access).map((country) => country.code), ['CO', 'EC', 'PE', 'BO', 'VE']);
    assert.equal(canQuoteCountry(access, 'MX'), false);
    assert.equal(canQuoteCountry(access, 'PE', QUOTE_COUNTRIES_2026), true);
    // Factor 2026 de Perú, no el de 2027.
    assert.equal(quotableCountries(access, QUOTE_COUNTRIES_2026).find((country) => country.code === 'PE')?.factor, 0.75);
  });
});

describe('cambio masivo de regiones', () => {
  it('agregar suma sin repetir y en el orden de la lista', () => {
    assert.deepEqual(applyMarketAssignment(['Chile'], ['Andina', 'Chile'], 'add'), ['Andina', 'Chile']);
  });

  it('quitar saca solo las elegidas', () => {
    assert.deepEqual(applyMarketAssignment(['Andina', 'Chile', 'Otros'], ['Chile'], 'remove'), ['Andina', 'Otros']);
  });

  it('reemplazar deja solo las elegidas (vacío = sin región)', () => {
    assert.deepEqual(applyMarketAssignment(['Andina'], ['México'], 'replace'), ['México']);
    assert.deepEqual(applyMarketAssignment(['Andina'], [], 'replace'), []);
  });
});

describe('cifras del cotizador', () => {
  it('USD: unitarios con un decimal, totales sin decimales', () => {
    assert.equal(formatQuoteMoney(12.6, USD_CONTEXT, { unit: true }), '12,6');
    assert.equal(formatQuoteMoney(7, USD_CONTEXT, { unit: true }), '7,0');
    assert.equal(formatQuoteMoney(1950, USD_CONTEXT, { unit: true }), '1.950');
    assert.equal(formatQuoteMoney(22716, USD_CONTEXT, { withCode: true }), '22.716 USD');
  });

  it('moneda local: se multiplica por la tasa y usa sus decimales', () => {
    assert.equal(formatQuoteMoney(10, { currency: 'COP', rate: 3237.83 }), '32.378');
    assert.equal(formatQuoteMoney(10, { currency: 'MXN', rate: 18.7147 }, { withCode: true }), '187,15 MXN');
  });

  it('porcentajes con un decimal', () => {
    assert.equal(formatQuotePercent(0.35), '35 %');
    assert.equal(formatQuotePercent(0.137), '13,7 %');
  });
});
