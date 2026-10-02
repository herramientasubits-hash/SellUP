/**
 * Precio por cantidad.
 *
 * Dos formas distintas y faciles de confundir:
 *  - La palanca 1 (LMS incluido) es una funcion ESCALONADA sobre la poblacion
 *    total: no interpola, porque es un paquete y no un precio por asiento.
 *  - Las palancas 2 y 3 son CURVAS de precio unitario sobre la cantidad que se
 *    compra —numero de lideres, numero de usuarios del resto—, con varias
 *    anclas e interpolacion lineal entre ellas.
 *
 * Las dos cosas que cambiaron, y por que:
 *
 * 1. **De dos anclas a varias.** La rampa iba en linea recta de US$500 (2.000
 *    usuarios) a US$100 (30.000), asi que un cliente de 7.235 personas seguia
 *    pagando US$425, el 85% del precio de uno de 2.000. El descuento por
 *    volumen real no es una recta: cae rapido al principio y se aplana.
 * 2. **De la poblacion total a la cantidad comprada.** El descuento se
 *    calculaba sobre el tamano de la empresa, no sobre cuantos asientos lleva
 *    de ese catalogo. Un cliente con 2.500 lideres entraba en el tramo de su
 *    poblacion (7.235) y pagaba precio de cliente mediano por 2.500 asientos:
 *    US$1,06 MM de capacidad instalada contra un contrato de US$94 mil.
 */

import { round2 } from '../../lib/format';
import type { CurvaValue, StepsValue } from '../types';

/** Primer tramo cuyo `hasta` cubre el valor; `hasta: null` es el tramo abierto. */
export function valorEscalonado(steps: StepsValue, x: number): number {
  for (const tramo of steps.tramos) {
    if (tramo.hasta === null || x <= tramo.hasta) return tramo.valor;
  }
  const ultimo = steps.tramos[steps.tramos.length - 1];
  return ultimo ? ultimo.valor : 0;
}

/** Etiqueta del tramo activo: "251 - 1.000 usuarios". */
export function tramoActivo(
  steps: StepsValue,
  x: number,
): { desde: number; hasta: number | null; valor: number } {
  let desde = 0;
  for (const tramo of steps.tramos) {
    if (tramo.hasta === null || x <= tramo.hasta) {
      return { desde: desde + (desde === 0 ? 0 : 1), hasta: tramo.hasta, valor: tramo.valor };
    }
    desde = tramo.hasta;
  }
  return { desde, hasta: null, valor: 0 };
}

/**
 * El precio unitario de la curva para esa cantidad. Plano antes de la primera
 * ancla y despues de la ultima; interpolado en linea recta entre cada par.
 *
 * Interpolar y no escalonar es deliberado: con escalones, un lider mas cruza un
 * tramo y la capacidad instalada de dos clientes casi iguales se diferencia en
 * decenas de miles de dolares. El cliente que compara dos reportes lo nota.
 */
export function valorEnCurva(curva: CurvaValue, cantidad: number): number {
  const anclas = [...curva.anclas].sort((a, b) => a.cantidad - b.cantidad);
  const primera = anclas[0];
  const ultima = anclas[anclas.length - 1];
  if (!primera || !ultima) return 0;

  if (cantidad <= primera.cantidad) return round2(primera.valor);
  if (cantidad >= ultima.cantidad) return round2(ultima.valor);

  for (let i = 1; i < anclas.length; i++) {
    const a = anclas[i - 1]!;
    const b = anclas[i]!;
    if (cantidad <= b.cantidad) {
      const rango = b.cantidad - a.cantidad;
      if (rango <= 0) return round2(b.valor);
      const avance = (cantidad - a.cantidad) / rango;
      return round2(a.valor + (b.valor - a.valor) * avance);
    }
  }
  return round2(ultima.valor);
}

export interface PrecioResuelto {
  precio: number;
  /** true cuando la cantidad ya entro en la curva y hay descuento aplicado. */
  conDescuento: boolean;
  /** "precio de lista" o "con descuento por volumen". */
  nota: string;
}

/**
 * El precio mas la explicacion de por que es ese precio. La UI no vuelve a
 * decidir si el numero lleva descuento.
 *
 * La nota NO repite la cantidad: quien la lee ya la tiene delante en la propia
 * cuenta ("2.500 líderes × US$80,00 — ..."), y repetirla sonaba a error.
 */
export function resolverPrecio(curva: CurvaValue, cantidad: number): PrecioResuelto {
  const anclas = [...curva.anclas].sort((a, b) => a.cantidad - b.cantidad);
  const primera = anclas[0];
  const conDescuento = primera !== undefined && cantidad > primera.cantidad;

  return {
    precio: valorEnCurva(curva, cantidad),
    conDescuento,
    nota: conDescuento ? 'con descuento por volumen' : 'precio de lista',
  };
}
