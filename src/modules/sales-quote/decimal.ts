/**
 * Aritmética exacta del cotizador.
 *
 * El cotizador original calcula con decimal.js a 40 dígitos y redondeo «mitad
 * hacia arriba». Se usa un clon con esa misma configuración (no la global) para
 * que cada precio dé al centavo lo mismo que en el sitio de Ventas.
 */
import Decimal from 'decimal.js';

export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

export const dec = (value: Decimal.Value): Dec => new Dec(value);

/** Un precio unitario en USD: un decimal, mitad hacia arriba. */
export const roundUnit = (value: Dec): Dec => value.toDecimalPlaces(1, Dec.ROUND_HALF_UP);
