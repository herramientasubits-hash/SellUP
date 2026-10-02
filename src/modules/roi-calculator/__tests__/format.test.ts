import { describe, it } from 'node:test';
import { expect } from './expect';
import {
  GUION,
  fmtDecimal1,
  fmtEntero,
  fmtMultiplo,
  fmtPct0,
  fmtPct2,
  fmtUSD,
  fmtUSD2,
  rangoMeses,
  round2,
  roundUSD,
  slugArchivo,
} from '../lib/format';

describe('formato es-CO', () => {
  it('moneda entera usa punto de miles y no lleva decimales', () => {
    expect(fmtUSD(42138)).toBe('US$42.138');
    expect(fmtUSD(28250)).toBe('US$28.250');
    expect(fmtUSD(0)).toBe('US$0');
    expect(fmtUSD(1234567)).toBe('US$1.234.567');
  });

  it('el precio unitario y el costo por curso llevan coma decimal', () => {
    expect(fmtUSD2(50)).toBe('US$50,00');
    expect(fmtUSD2(2.1201)).toBe('US$2,12');
    expect(fmtUSD2(328.57)).toBe('US$328,57');
  });

  it('porcentajes y multiplos', () => {
    expect(fmtPct0(0.670416)).toBe('67%');
    expect(fmtPct2(0.2487)).toBe('24,87%');
    expect(fmtMultiplo(3.5409)).toBe('3,5x');
    expect(fmtMultiplo(2.3739)).toBe('2,4x');
  });

  it('los valores no calculables se muestran como guion, nunca NaN ni Infinity', () => {
    expect(fmtUSD(null)).toBe(GUION);
    expect(fmtUSD2(Number.POSITIVE_INFINITY)).toBe(GUION);
    expect(fmtPct0(Number.NaN)).toBe(GUION);
    expect(fmtMultiplo(null)).toBe(GUION);
    expect(fmtEntero(null)).toBe(GUION);
  });

  it('enteros y decimales sueltos', () => {
    expect(fmtEntero(274)).toBe('274');
    expect(fmtEntero(5613)).toBe('5.613');
    expect(fmtDecimal1(74.61)).toBe('74,6');
  });

  it('redondeos base', () => {
    expect(round2(2.1201)).toBe(2.12);
    expect(round2(1.005)).toBe(1.01);
    expect(roundUSD(2238.3)).toBe(2238);
    expect(roundUSD(2238.5)).toBe(2239);
  });

  it('rango de meses en palabras', () => {
    expect(rangoMeses(7, 12, 2026)).toBe('julio a diciembre de 2026');
    expect(rangoMeses(3, 3, 2026)).toBe('marzo de 2026');
  });

  it('slug de archivo sin acentos ni espacios', () => {
    expect(slugArchivo('Grupo SIES')).toBe('Grupo_SIES');
    expect(slugArchivo('Construcción & Cía.')).toBe('Construccion_Cia');
  });
});
