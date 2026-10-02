import { describe, it } from 'node:test';
import { expect } from './expect';
import type { VentanaValue } from '../domain/types';
import { mesesAplicables, resolverPeriodo } from '../domain/lms/calendario';

/** Modo Estudio existe desde julio de 2026. */
const ventanaModoEstudio: VentanaValue = { desde: { anio: 2026, mes: 7 } };

const aplicables = (anio: number, mesInicio: number, mesFin: number) =>
  mesesAplicables(resolverPeriodo(anio, mesInicio, mesFin), ventanaModoEstudio);

describe('periodo de contrato', () => {
  it('deriva los meses y el factor anual', () => {
    expect(resolverPeriodo(2026, 1, 12)).toMatchObject({ mesesContrato: 12, factorAnual: 1 });
    expect(resolverPeriodo(2026, 7, 12)).toMatchObject({ mesesContrato: 6, factorAnual: 0.5 });
    expect(resolverPeriodo(2026, 4, 4)).toMatchObject({ mesesContrato: 1 });
  });

  it('acota los meses fuera de rango en vez de romper', () => {
    expect(resolverPeriodo(2026, 0, 14).mesInicio).toBe(1);
    expect(resolverPeriodo(2026, 0, 14).mesFin).toBe(12);
    expect(resolverPeriodo(2026, 9, 3).mesesContrato).toBe(0);
  });
});

describe('meses aplicables de Modo Estudio', () => {
  it('2026 con contrato completo: solo julio a diciembre', () => {
    expect(aplicables(2026, 1, 12)).toMatchObject({ meses: 6, desde: 7, hasta: 12 });
  });

  it('2026 con contrato de julio a diciembre: mantiene los 6 meses', () => {
    expect(aplicables(2026, 7, 12)).toMatchObject({ meses: 6, desde: 7, hasta: 12 });
  });

  it('2026 con contrato de enero a junio: 0 meses, no 6', () => {
    // Este es el caso que un min(mesesContrato, ventana) resolveria mal.
    expect(aplicables(2026, 1, 6)).toMatchObject({ meses: 0, fueraDeVentana: true });
  });

  it('2026 a caballo de la ventana: solo la parte posterior', () => {
    expect(aplicables(2026, 5, 9)).toMatchObject({ meses: 3, desde: 7, hasta: 9 });
  });

  it('antes de 2026 el producto no existe', () => {
    expect(aplicables(2025, 1, 12)).toMatchObject({ meses: 0, fueraDeVentana: true });
    expect(aplicables(2024, 1, 12).meses).toBe(0);
  });

  it('desde 2027 aplica el contrato completo', () => {
    expect(aplicables(2027, 1, 12)).toMatchObject({ meses: 12, desde: 1, hasta: 12 });
    expect(aplicables(2027, 4, 9)).toMatchObject({ meses: 6, desde: 4, hasta: 9 });
    expect(aplicables(2030, 1, 12).meses).toBe(12);
  });
});
