/**
 * AGENT1-FISCAL-CHECK-DIGIT-VARIANTS-1 — las variantes de DV de CO/CL/PY llegan a
 * la MISMA forma canónica, y ninguna entrada que ya canonicalizaba cambia.
 *
 * 🔴 La estabilidad es la parte que importa: los reclamos globales guardados en
 * Producción usan la forma canónica de ANTES. `legacyCanonicalize` es una copia
 * literal del algoritmo anterior a este corte; para todo lo que no es una de las
 * tres variantes divergentes, la salida nueva tiene que ser idéntica.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFiscalLookupNeedles,
  canonicalizeFiscalIdentifier,
  computeChileRutCheckDigit,
  computeColombiaNitCheckDigit,
  computeParaguayRucCheckDigit,
} from '../fiscal-identity';
import { calculateColombianCheckDigit } from '@/server/prospect-batches/tax-identifier-providers/colombia';

/** Copia literal de `canonicalizeFiscalIdentifier` ANTES de este corte. */
function legacyCanonicalize(value: string | null | undefined, countryCode?: string | null): string | null {
  if (value == null) return null;
  let v = value.trim();
  if (!v) return null;
  v = v.replace(/^(NIT|RFC|RUC|RUT|CUIT|CNPJ|RNC|RTN)(?:[\s.:#-]+|(?=\d))/i, '').trim();
  if (!v) return null;
  if ((countryCode ?? '').trim().toUpperCase() === 'CO') {
    v = v.replace(/[\s.]/g, '').replace(/[–—]/g, '-').replace(/-\d{1,2}$/, '');
  }
  v = v.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return v.length < 5 ? null : v;
}

/** Generador determinístico (LCG) para que la prueba exhaustiva sea reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const digits = (next: () => number, n: number) =>
  Array.from({ length: n }, () => String(Math.floor(next() * 10))).join('');

describe('dígitos de verificación — valores publicados', () => {
  it('Colombia (DIAN): Bancolombia 890.903.938-8, Banco de Bogotá 860.002.964-4', () => {
    assert.equal(computeColombiaNitCheckDigit('890903938'), 8);
    assert.equal(computeColombiaNitCheckDigit('860002964'), 4);
  });

  it('Colombia: igual que `calculateColombianCheckDigit` del repositorio', () => {
    const next = rng(7);
    for (let i = 0; i < 2000; i++) {
      const base = `${8 + Math.floor(next() * 2)}${digits(next, 8)}`;
      assert.equal(computeColombiaNitCheckDigit(base), calculateColombianCheckDigit(base), base);
    }
  });

  it('Chile (SII): 60.803.000-K y Banco de Chile 97.004.000-5', () => {
    assert.equal(computeChileRutCheckDigit('60803000'), 'k');
    assert.equal(computeChileRutCheckDigit('97004000'), '5');
  });

  it('Paraguay (SET): el DV de base 11 nunca es 10 ni 11', () => {
    const next = rng(11);
    for (let i = 0; i < 2000; i++) {
      const dv = computeParaguayRucCheckDigit(`80${digits(next, 6)}`);
      assert.ok(dv >= 0 && dv <= 9);
    }
  });
});

describe('🔴 variantes divergentes ⇒ la forma canónica EXISTENTE', () => {
  it('CO: NIT con DV pegado = NIT con guion = NIT sin DV', () => {
    assert.equal(canonicalizeFiscalIdentifier('8909039388', 'CO'), '890903938');
    assert.equal(canonicalizeFiscalIdentifier('890.903.938-8', 'CO'), '890903938');
    assert.equal(canonicalizeFiscalIdentifier('890903938', 'CO'), '890903938');
  });

  it('CO exhaustivo: 3.000 NIT empresariales, las tres formas coinciden con la de antes', () => {
    const next = rng(42);
    for (let i = 0; i < 3000; i++) {
      const base = `${8 + Math.floor(next() * 2)}${digits(next, 8)}`;
      const dv = computeColombiaNitCheckDigit(base);
      const existing = legacyCanonicalize(`${base}-${dv}`, 'CO');
      assert.equal(canonicalizeFiscalIdentifier(`${base}${dv}`, 'CO'), existing, `${base}${dv}`);
      assert.equal(canonicalizeFiscalIdentifier(`${base}-${dv}`, 'CO'), existing);
      assert.equal(canonicalizeFiscalIdentifier(base, 'CO'), existing);
    }
  });

  it('CL: RUT empresarial sin DV = con DV y guion', () => {
    assert.equal(canonicalizeFiscalIdentifier('97004000', 'CL'), '970040005');
    assert.equal(canonicalizeFiscalIdentifier('97.004.000-5', 'CL'), '970040005');
    assert.equal(canonicalizeFiscalIdentifier('970040005', 'CL'), '970040005');
  });

  it('CL exhaustivo: cuerpos ≥ 50.000.000 sin DV llegan a la forma con DV (salvo lectura «7+DV» válida)', () => {
    const next = rng(5);
    let aligned = 0;
    for (let i = 0; i < 3000; i++) {
      const body = `${5 + Math.floor(next() * 5)}${digits(next, 7)}`;
      const dv = computeChileRutCheckDigit(body);
      const existing = legacyCanonicalize(`${body}-${dv}`, 'CL');
      const readsAsBodyAndDv = computeChileRutCheckDigit(body.slice(0, 7)) === body.charAt(7);
      const result = canonicalizeFiscalIdentifier(body, 'CL');
      if (readsAsBodyAndDv) {
        assert.equal(result, legacyCanonicalize(body, 'CL'), 'la lectura ambigua no se adivina');
      } else {
        assert.equal(result, existing, body);
        aligned += 1;
      }
    }
    assert.ok(aligned > 2500);
  });

  it('PY: RUC empresarial sin DV = con DV y guion', () => {
    const dv = computeParaguayRucCheckDigit('80009735');
    assert.equal(canonicalizeFiscalIdentifier('80009735', 'PY'), `80009735${dv}`);
    assert.equal(canonicalizeFiscalIdentifier(`80009735-${dv}`, 'PY'), `80009735${dv}`);
  });

  it('PY exhaustivo', () => {
    const next = rng(9);
    for (let i = 0; i < 3000; i++) {
      const body = `80${digits(next, 6)}`;
      const dv = computeParaguayRucCheckDigit(body);
      assert.equal(canonicalizeFiscalIdentifier(body, 'PY'), legacyCanonicalize(`${body}-${dv}`, 'PY'));
    }
  });
});

describe('🔴 estabilidad — nada que ya canonicalizaba cambia', () => {
  const corpus: Array<[string, string]> = [
    ['900.123.456', 'CO'],
    ['NIT 900.123.456', 'CO'],
    ['900123456-7', 'CO'],
    ['900123456', 'CO'],
    ['NIT: 860.002.964-4', 'CO'],
    ['1012345678', 'CO'], // cédula de 10 dígitos: no se adivina DV
    ['79123456', 'CO'],
    ['ABC-123456-AB1', 'MX'],
    ['RFC ABC123456AB1', 'MX'],
    ['30-71234567-9', 'AR'],
    ['20123456789', 'PE'],
    ['1790012345001', 'EC'],
    ['97.004.000-5', 'CL'],
    ['970040005', 'CL'],
    ['76.123.456-K', 'CL'],
    ['76123456k', 'CL'],
    ['12.345.678-5', 'CL'], // persona: < 50 millones
    ['12345678', 'CL'],
    ['80009735-1', 'PY'],
    ['800097351', 'PY'],
    ['1234567', 'PY'], // cédula de persona
    ['12-3456789', 'US'],
    ['B12345678', 'ES'],
    ['J-12345678-9', 'VE'],
    ['12345678000195', 'BR'],
  ];

  for (const [value, country] of corpus) {
    it(`${country} «${value}»`, () => {
      assert.equal(canonicalizeFiscalIdentifier(value, country), legacyCanonicalize(value, country));
    });
  }

  it('CO exhaustivo: un NIT de 10 dígitos con DV pegado INCORRECTO no se toca', () => {
    const next = rng(77);
    for (let i = 0; i < 2000; i++) {
      const base = `${8 + Math.floor(next() * 2)}${digits(next, 8)}`;
      const wrong = (computeColombiaNitCheckDigit(base) + 1 + Math.floor(next() * 9)) % 10;
      const value = `${base}${wrong}`;
      assert.equal(canonicalizeFiscalIdentifier(value, 'CO'), legacyCanonicalize(value, 'CO'), value);
    }
  });

  it('CO exhaustivo: cédulas de 10 dígitos que empiezan por 1 nunca cambian', () => {
    const next = rng(3);
    for (let i = 0; i < 2000; i++) {
      const value = `1${digits(next, 9)}`;
      assert.equal(canonicalizeFiscalIdentifier(value, 'CO'), legacyCanonicalize(value, 'CO'));
    }
  });

  it('sin país la regla por país no se aplica', () => {
    assert.equal(canonicalizeFiscalIdentifier('8909039388', null), '8909039388');
    assert.equal(canonicalizeFiscalIdentifier('97004000', undefined), '97004000');
  });

  it('es idempotente: canonicalizar el canónico no lo cambia', () => {
    for (const [value, country] of [
      ['8909039388', 'CO'],
      ['97004000', 'CL'],
      ['80009735', 'PY'],
    ] as const) {
      const once = canonicalizeFiscalIdentifier(value, country);
      assert.equal(canonicalizeFiscalIdentifier(once, country), once);
    }
  });
});

describe('agujas de búsqueda', () => {
  it('CO: alcanzan la fila guardada con DV pegado', () => {
    const needles = buildFiscalLookupNeedles(['890.903.938'], 'CO');
    assert.ok(needles.lookupValues.includes('8909039388'));
    assert.ok(needles.lookupValues.includes('890903938-8'));
  });

  it('CL / PY: alcanzan la fila guardada con guion', () => {
    assert.ok(buildFiscalLookupNeedles(['97004000'], 'CL').lookupValues.includes('97004000-5'));
    const dv = computeParaguayRucCheckDigit('80009735');
    assert.ok(buildFiscalLookupNeedles(['80009735'], 'PY').lookupValues.includes(`80009735-${dv}`));
  });
});
