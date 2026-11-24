/**
 * Mercados y países que se cotizan.
 *
 * Cada vendedor cotiza los países de sus mercados (la región que le asigna un
 * admin). El factor de mercado ajusta el precio de lista por país; la versión
 * 2026 usa su propia tabla de factores (`engine-2026.ts`).
 */

export const QUOTE_MARKETS = ['Andina', 'Chile', 'México', 'Centroamérica', 'Otros'] as const;
export type QuoteMarket = (typeof QUOTE_MARKETS)[number];

export type LocalCurrency = 'COP' | 'PEN' | 'BOB' | 'CLP' | 'MXN';

export interface QuoteCountry {
  code: string;
  name: string;
  market: QuoteMarket;
  /** Factor de mercado de la versión 2027. */
  factor: number;
  /** Moneda local en la que se puede mostrar la cotización; `null` = solo USD. */
  currency: LocalCurrency | null;
}

export const QUOTE_COUNTRIES: readonly QuoteCountry[] = [
  { code: 'CO', name: 'Colombia', market: 'Andina', factor: 1, currency: 'COP' },
  { code: 'EC', name: 'Ecuador', market: 'Andina', factor: 0.7, currency: null },
  { code: 'PE', name: 'Perú', market: 'Andina', factor: 0.65, currency: 'PEN' },
  { code: 'BO', name: 'Bolivia', market: 'Andina', factor: 0.9, currency: 'BOB' },
  { code: 'VE', name: 'Venezuela', market: 'Andina', factor: 1, currency: null },
  { code: 'CL', name: 'Chile', market: 'Chile', factor: 1.1, currency: 'CLP' },
  { code: 'AR', name: 'Argentina', market: 'Chile', factor: 1, currency: null },
  { code: 'MX', name: 'México', market: 'México', factor: 1.15, currency: 'MXN' },
  { code: 'CR', name: 'Costa Rica', market: 'Centroamérica', factor: 1.2, currency: null },
  { code: 'PA', name: 'Panamá', market: 'Centroamérica', factor: 1.2, currency: null },
  { code: 'DO', name: 'República Dominicana', market: 'Centroamérica', factor: 1.6, currency: null },
  { code: 'HN', name: 'Honduras', market: 'Centroamérica', factor: 1.1, currency: null },
  { code: 'SV', name: 'El Salvador', market: 'Centroamérica', factor: 1.1, currency: null },
  { code: 'GT', name: 'Guatemala', market: 'Centroamérica', factor: 1.1, currency: null },
  { code: 'NI', name: 'Nicaragua', market: 'Centroamérica', factor: 1.1, currency: null },
  { code: 'BZ', name: 'Belice', market: 'Centroamérica', factor: 1.1, currency: null },
  { code: 'PR', name: 'Puerto Rico', market: 'Centroamérica', factor: 1.1, currency: null },
  { code: 'BR', name: 'Brasil', market: 'Otros', factor: 1, currency: null },
  { code: 'PY', name: 'Paraguay', market: 'Otros', factor: 1, currency: null },
  { code: 'UY', name: 'Uruguay', market: 'Otros', factor: 1, currency: null },
  { code: 'CW', name: 'Curazao', market: 'Otros', factor: 1, currency: null },
  { code: 'US', name: 'Estados Unidos', market: 'Otros', factor: 1, currency: null },
  { code: 'XX', name: 'Sin dato', market: 'Otros', factor: 1, currency: null },
];

export function findQuoteCountry(code: string): QuoteCountry | undefined {
  return QUOTE_COUNTRIES.find((country) => country.code === code);
}

/** Los países de unos mercados, en el orden de la lista. */
export function countriesForMarkets(
  markets: readonly QuoteMarket[],
  countries: readonly QuoteCountry[] = QUOTE_COUNTRIES,
): QuoteCountry[] {
  return countries.filter((country) => markets.includes(country.market));
}

export function isQuoteMarket(value: unknown): value is QuoteMarket {
  return typeof value === 'string' && (QUOTE_MARKETS as readonly string[]).includes(value);
}
