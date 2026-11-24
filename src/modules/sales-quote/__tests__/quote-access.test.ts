/** Quién cotiza qué regiones (por su grupo de SellUp), y cómo se leen las cifras. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QUOTE_COUNTRIES_2026 } from '../engine-2026';
import { USD_CONTEXT } from '../exchange-rates';
import { formatQuoteMoney, formatQuotePercent } from '../format';
import { QUOTE_MARKETS } from '../markets';
import {
  canQuoteCountry,
  groupPathNames,
  marketsNamedBy,
  quotableCountries,
  resolveQuoteMarkets,
  seesAllQuoteMarkets,
} from '../quote-access';

const SELLER = { isAdmin: false, roleKey: 'seller_bd' };

describe('región por rol', () => {
  it('admin, manager y líder comercial cotizan todas, sin importar su grupo', () => {
    for (const viewer of [
      { isAdmin: true, roleKey: 'admin' },
      { isAdmin: false, roleKey: 'commercial_manager' },
      { isAdmin: false, roleKey: 'commercial_lead' },
    ]) {
      assert.equal(seesAllQuoteMarkets(viewer), true);
      assert.deepEqual(resolveQuoteMarkets(viewer, ['Andina']).markets, [...QUOTE_MARKETS]);
    }
  });

  it('🔴 sin rol conocido no ve todo', () => {
    assert.equal(seesAllQuoteMarkets({ isAdmin: false, roleKey: null }), false);
  });
});

describe('región por grupo', () => {
  it('el grupo se llama como la región, con o sin «Región» y sin importar tildes', () => {
    assert.deepEqual(marketsNamedBy('Andina'), ['Andina']);
    assert.deepEqual(marketsNamedBy('Región Andina'), ['Andina']);
    assert.deepEqual(marketsNamedBy('MEXICO'), ['México']);
    assert.deepEqual(marketsNamedBy('Centro América'), ['Centroamérica']);
    assert.deepEqual(marketsNamedBy('Centroamérica y Caribe'), ['Centroamérica']);
  });

  it('o se llama como un país, que trae su región', () => {
    assert.deepEqual(marketsNamedBy('Colombia'), ['Andina']);
    assert.deepEqual(marketsNamedBy('Perú (QA)'), ['Andina']);
    assert.deepEqual(marketsNamedBy('Panamá'), ['Centroamérica']);
    assert.deepEqual(marketsNamedBy('Brasil'), ['Otros']);
  });

  it('un grupo que no nombra región no da ninguna (sin falsos parecidos)', () => {
    assert.deepEqual(marketsNamedBy('Mid Market'), []);
    assert.deepEqual(marketsNamedBy('Enterprise'), []);
    assert.deepEqual(marketsNamedBy('Campañas'), []);
    assert.deepEqual(marketsNamedBy(''), []);
  });

  it('BD y Growth: gana el grupo más cercano que nombre región', () => {
    for (const roleKey of ['seller_bd', 'growth']) {
      const access = resolveQuoteMarkets({ isAdmin: false, roleKey }, ['Equipo 3', 'Región Andina', 'Mid Market']);
      assert.deepEqual(access, { markets: ['Andina'], seesAll: false, fromGroup: 'Región Andina' });
    }
  });

  it('🔴 sin grupo, o con un grupo sin región, no cotiza ningún país', () => {
    const noGroup = resolveQuoteMarkets(SELLER, []);
    assert.deepEqual(noGroup, { markets: [], seesAll: false, fromGroup: null });
    const noRegion = resolveQuoteMarkets(SELLER, ['Mid Market']);
    assert.deepEqual(noRegion, { markets: [], seesAll: false, fromGroup: 'Mid Market' });
    assert.deepEqual(quotableCountries(noRegion), []);
    assert.equal(canQuoteCountry(noRegion, 'CO'), false);
  });

  it('un BD de Andina ve solo sus países, en cada versión', () => {
    const access = resolveQuoteMarkets(SELLER, ['Andina']);
    assert.deepEqual(quotableCountries(access).map((country) => country.code), ['CO', 'EC', 'PE', 'BO', 'VE']);
    assert.equal(canQuoteCountry(access, 'MX'), false);
    assert.equal(canQuoteCountry(access, 'PE', QUOTE_COUNTRIES_2026), true);
    // Factor 2026 de Perú, no el de 2027.
    assert.equal(quotableCountries(access, QUOTE_COUNTRIES_2026).find((country) => country.code === 'PE')?.factor, 0.75);
  });
});

describe('camino de grupos', () => {
  const groups = [
    { id: 'root', name: 'Mid Market', parent_group_id: null },
    { id: 'andina', name: 'Región Andina', parent_group_id: 'root' },
    { id: 'team', name: 'Equipo 3', parent_group_id: 'andina' },
  ];

  it('va del grupo de la persona hasta la raíz', () => {
    assert.deepEqual(groupPathNames('team', groups), ['Equipo 3', 'Región Andina', 'Mid Market']);
    assert.deepEqual(groupPathNames(null, groups), []);
    assert.deepEqual(groupPathNames('no-existe', groups), []);
  });

  it('no se queda dando vueltas si los datos traen un ciclo', () => {
    const loop = [
      { id: 'a', name: 'A', parent_group_id: 'b' },
      { id: 'b', name: 'B', parent_group_id: 'a' },
    ];
    assert.deepEqual(groupPathNames('a', loop), ['A', 'B']);
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
