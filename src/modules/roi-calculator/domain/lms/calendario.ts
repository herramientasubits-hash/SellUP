/**
 * Periodo de contrato y ventana de existencia del producto.
 *
 * Los meses aplicables salen de una INTERSECCION de conjuntos de meses, no de
 * un min(). Con min(mesesContrato, mesesDeVentana) un contrato de enero a
 * junio de 2026 daria 6 meses de Modo Estudio, cuando el producto no existia
 * en ninguno de esos meses: la respuesta correcta es 0.
 */

import type { PeriodoResuelto, VentanaValue } from '../types';

const clampMes = (mes: number): number => Math.min(12, Math.max(1, Math.round(mes)));

export function resolverPeriodo(
  anio: number,
  mesInicio: number,
  mesFin: number,
): PeriodoResuelto {
  const inicio = clampMes(mesInicio);
  const fin = clampMes(mesFin);
  const mesesContrato = Math.max(0, fin - inicio + 1);

  return {
    anio,
    mesInicio: inicio,
    mesFin: fin,
    mesesContrato,
    factorAnual: mesesContrato / 12,
  };
}

/** Primer mes del año en que el producto ya existe. 13 = no existe ese año. */
function primerMesDisponible(anio: number, ventana: VentanaValue): number {
  if (anio < ventana.desde.anio) return 13;
  if (anio > ventana.desde.anio) return 1;
  return clampMes(ventana.desde.mes);
}

export interface MesesAplicables {
  meses: number;
  /** Rango efectivo, o null si la interseccion es vacia. */
  desde: number | null;
  hasta: number | null;
  /** true cuando el producto no existia en ningun mes del contrato. */
  fueraDeVentana: boolean;
}

/** Interseccion entre los meses de contrato del año y la ventana del producto. */
export function mesesAplicables(
  periodo: PeriodoResuelto,
  ventana: VentanaValue,
): MesesAplicables {
  const inicioVentana = primerMesDisponible(periodo.anio, ventana);
  const desde = Math.max(periodo.mesInicio, inicioVentana);
  const hasta = Math.min(periodo.mesFin, 12);
  const meses = Math.max(0, hasta - desde + 1);

  return meses === 0
    ? { meses: 0, desde: null, hasta: null, fueraDeVentana: true }
    : { meses, desde, hasta, fueraDeVentana: false };
}
