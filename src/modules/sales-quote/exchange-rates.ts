/**
 * Tasas para mostrar la cotización en moneda local.
 *
 * Son de referencia y se escriben a mano (vienen del cotizador original). Todo
 * se calcula en USD; la moneda local solo cambia cómo se muestra.
 */
import { findQuoteCountry, type LocalCurrency } from './markets';

export const EXCHANGE_RATES: { rates: Record<LocalCurrency, number>; asOf: string } = {
  rates: { COP: 3237.83, MXN: 18.7147, PEN: 3.433, CLP: 979.88, BOB: 16.1607 },
  asOf: '2026-11-09',
};

/** Decimales con que se muestra cada moneda. */
export const CURRENCY_DECIMALS: Record<'USD' | LocalCurrency, number> = {
  USD: 2,
  COP: 0,
  CLP: 0,
  PEN: 2,
  BOB: 2,
  MXN: 2,
};

export interface MoneyContext {
  /** `null` = USD. */
  currency: LocalCurrency | null;
  rate: number;
}

export const USD_CONTEXT: MoneyContext = { currency: null, rate: 1 };

/** La moneda en que se muestra: la local del país si se pidió y hay tasa; si no, USD. */
export function moneyContextFor(countryCode: string, useLocalCurrency: boolean): MoneyContext {
  const currency = findQuoteCountry(countryCode)?.currency ?? null;
  const rate = currency ? EXCHANGE_RATES.rates[currency] : undefined;
  return useLocalCurrency && currency && rate ? { currency, rate } : USD_CONTEXT;
}

/** ¿El país tiene moneda local con tasa? */
export function hasLocalCurrency(countryCode: string): boolean {
  const currency = findQuoteCountry(countryCode)?.currency ?? null;
  return !!currency && !!EXCHANGE_RATES.rates[currency];
}
