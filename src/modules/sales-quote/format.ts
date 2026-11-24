/**
 * Cómo se leen las cifras del cotizador.
 *
 * Todo se calcula en USD; con moneda local se multiplica por la tasa y se usan
 * los decimales de esa moneda. En USD, los precios unitarios se leen con un
 * decimal («12,6») y los totales sin decimales («22.716»).
 */
import { CURRENCY_DECIMALS, type MoneyContext } from './exchange-rates';

export interface MoneyFormatOptions {
  /** Precio unitario: en USD muestra un decimal aunque sea «,0». */
  unit?: boolean;
  /** Agrega el código de moneda: «22.716 USD». */
  withCode?: boolean;
}

export function formatQuoteMoney(valueUsd: number, money: MoneyContext, options: MoneyFormatOptions = {}): string {
  const code = money.currency ?? 'USD';
  const maxDecimals = money.currency ? (CURRENCY_DECIMALS[money.currency] ?? 2) : 1;
  const value = money.currency ? valueUsd * money.rate : valueUsd;
  const unitDecimal = !money.currency && options.unit && Math.abs(value) < 1000;
  const text = value.toLocaleString('es-CO', {
    minimumFractionDigits: money.currency ? maxDecimals : unitDecimal ? 1 : 0,
    maximumFractionDigits: maxDecimals,
  });
  return options.withCode ? `${text} ${code}` : text;
}

/** 0,35 → «35 %»; 0,137 → «13,7 %». */
export function formatQuotePercent(rate: number): string {
  return `${(Math.round(rate * 1000) / 10).toLocaleString('es-CO')} %`;
}

export function formatQuoteInteger(value: number): string {
  return value.toLocaleString('es-CO');
}

/** El código de la moneda en que se muestra. */
export function currencyCode(money: MoneyContext): string {
  return money.currency ?? 'USD';
}
