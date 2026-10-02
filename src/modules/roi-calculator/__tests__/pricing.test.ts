import { describe, it } from 'node:test';
import { expect } from './expect';
import type { CurvaValue, StepsValue } from '../domain/types';
import { resolverPrecio, tramoActivo, valorEnCurva, valorEscalonado } from '../domain/lms/pricing';

const escaleraLMS: StepsValue = {
  tramos: [
    { hasta: 250, valor: 6000 },
    { hasta: 1000, valor: 8000 },
    { hasta: 2500, valor: 10000 },
    { hasta: 10000, valor: 12500 },
    { hasta: null, valor: 15000 },
  ],
};

const precioLider: CurvaValue = {
  anclas: [
    { cantidad: 100, valor: 500 },
    { cantidad: 250, valor: 380 },
    { cantidad: 500, valor: 280 },
    { cantidad: 1000, valor: 180 },
    { cantidad: 2500, valor: 80 },
    { cantidad: 10000, valor: 50 },
    { cantidad: 30000, valor: 35 },
  ],
};

const precioResto: CurvaValue = {
  anclas: [
    { cantidad: 500, valor: 50 },
    { cantidad: 1000, valor: 40 },
    { cantidad: 2500, valor: 27 },
    { cantidad: 5000, valor: 19 },
    { cantidad: 10000, valor: 13 },
    { cantidad: 30000, valor: 8 },
  ],
};

describe('palanca 1 — escalera por poblacion', () => {
  it('no interpola: cada tramo es plano', () => {
    expect(valorEscalonado(escaleraLMS, 1)).toBe(6000);
    expect(valorEscalonado(escaleraLMS, 250)).toBe(6000);
    expect(valorEscalonado(escaleraLMS, 251)).toBe(8000);
    expect(valorEscalonado(escaleraLMS, 300)).toBe(8000);
    expect(valorEscalonado(escaleraLMS, 1000)).toBe(8000);
    expect(valorEscalonado(escaleraLMS, 1001)).toBe(10000);
    expect(valorEscalonado(escaleraLMS, 2500)).toBe(10000);
    expect(valorEscalonado(escaleraLMS, 2501)).toBe(12500);
    expect(valorEscalonado(escaleraLMS, 10000)).toBe(12500);
    expect(valorEscalonado(escaleraLMS, 10001)).toBe(15000);
    expect(valorEscalonado(escaleraLMS, 250000)).toBe(15000);
  });

  it('identifica el tramo activo para la explicacion', () => {
    expect(tramoActivo(escaleraLMS, 300)).toEqual({ desde: 251, hasta: 1000, valor: 8000 });
    expect(tramoActivo(escaleraLMS, 40000)).toEqual({ desde: 10001, hasta: null, valor: 15000 });
  });
});

describe('palancas 2 y 3 — curva de precio por cantidad', () => {
  it('sobre un ancla devuelve su valor exacto', () => {
    expect(valorEnCurva(precioLider, 100)).toBe(500);
    expect(valorEnCurva(precioLider, 2500)).toBe(80);
    expect(valorEnCurva(precioLider, 30000)).toBe(35);
    expect(valorEnCurva(precioResto, 500)).toBe(50);
    expect(valorEnCurva(precioResto, 5000)).toBe(19);
  });

  it('interpola en línea recta entre dos anclas', () => {
    // Mitad exacta entre 500 (US$280) y 1.000 (US$180).
    expect(valorEnCurva(precioLider, 750)).toBe(230);
    // Mitad exacta entre 2.500 (US$27) y 5.000 (US$19).
    expect(valorEnCurva(precioResto, 3750)).toBe(23);
  });

  it('es plana fuera del rango de anclas', () => {
    expect(valorEnCurva(precioLider, 1)).toBe(500);
    expect(valorEnCurva(precioLider, 26)).toBe(500);
    expect(valorEnCurva(precioLider, 250000)).toBe(35);
    expect(valorEnCurva(precioResto, 10)).toBe(50);
    expect(valorEnCurva(precioResto, 250000)).toBe(8);
  });

  it('baja de forma monótona: más cantidad nunca cuesta más por unidad', () => {
    let previo = Infinity;
    for (let n = 1; n <= 40000; n += 137) {
      const precio = valorEnCurva(precioLider, n);
      expect(precio).toBeLessThanOrEqual(previo);
      previo = precio;
    }
  });

  it('no tiene saltos: un asiento más no mueve el precio de golpe', () => {
    // Es la razón de ser de la curva frente a los escalones del LMS.
    for (const n of [499, 999, 2499, 9999]) {
      expect(Math.abs(valorEnCurva(precioLider, n + 1) - valorEnCurva(precioLider, n))).toBeLessThan(1);
    }
  });

  it('ordena las anclas aunque lleguen desordenadas', () => {
    const revuelta: CurvaValue = { anclas: [...precioLider.anclas].reverse() };
    expect(valorEnCurva(revuelta, 750)).toBe(230);
  });

  it('la nota dice si el precio lleva descuento por volumen', () => {
    const lista = resolverPrecio(precioResto, 300);
    expect(lista.precio).toBe(50);
    expect(lista.conDescuento).toBe(false);
    expect(lista.nota).toBe('precio de lista');

    const conDescuento = resolverPrecio(precioLider, 2500);
    expect(conDescuento.precio).toBe(80);
    expect(conDescuento.conDescuento).toBe(true);
    expect(conDescuento.nota).toBe('con descuento por volumen');
  });
});
