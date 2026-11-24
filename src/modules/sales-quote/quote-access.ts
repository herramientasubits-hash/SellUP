/**
 * Qué mercados puede cotizar cada persona.
 *
 * El admin y los líderes (manager y líder comercial) cotizan todos los
 * mercados. Vendedores BD y Growth cotizan solo las regiones que les asignó un
 * admin; sin región asignada no pueden cotizar. Puro: el servidor le pasa quién
 * es la persona y qué regiones tiene guardadas.
 */
import { TEAM_ROLE_KEYS } from '@/modules/access/commercial-scope-logic';
import { QUOTE_COUNTRIES, countriesForMarkets, isQuoteMarket, type QuoteCountry, type QuoteMarket, QUOTE_MARKETS } from './markets';

export interface QuoteViewer {
  isAdmin: boolean;
  roleKey: string | null;
}

/** ¿Ve todos los mercados por su rol, sin región asignada? */
export function seesAllQuoteMarkets(viewer: QuoteViewer): boolean {
  return viewer.isAdmin || (TEAM_ROLE_KEYS as readonly string[]).includes(viewer.roleKey ?? '');
}

export interface QuoteMarketAccess {
  markets: QuoteMarket[];
  /** Los ve todos por su rol (no por asignación). */
  seesAll: boolean;
}

/** Los mercados de quien mira. Lo guardado que no sea un mercado válido se ignora. */
export function resolveQuoteMarkets(viewer: QuoteViewer, assigned: readonly unknown[]): QuoteMarketAccess {
  if (seesAllQuoteMarkets(viewer)) return { markets: [...QUOTE_MARKETS], seesAll: true };
  const valid = new Set(assigned.filter(isQuoteMarket));
  return { markets: QUOTE_MARKETS.filter((market) => valid.has(market)), seesAll: false };
}

/** Los países que puede cotizar, de la lista de una versión. */
export function quotableCountries(
  access: QuoteMarketAccess,
  countries: readonly QuoteCountry[] = QUOTE_COUNTRIES,
): QuoteCountry[] {
  return countriesForMarkets(access.markets, countries);
}

/** ¿Puede cotizar este país? */
export function canQuoteCountry(
  access: QuoteMarketAccess,
  countryCode: string,
  countries: readonly QuoteCountry[] = QUOTE_COUNTRIES,
): boolean {
  return quotableCountries(access, countries).some((country) => country.code === countryCode);
}

/** Cambio masivo de regiones desde Configuración. */
export type MarketAssignmentMode = 'add' | 'remove' | 'replace';

export function applyMarketAssignment(
  current: readonly QuoteMarket[],
  markets: readonly QuoteMarket[],
  mode: MarketAssignmentMode,
): QuoteMarket[] {
  const next = new Set<QuoteMarket>(mode === 'replace' ? [] : current);
  for (const market of markets) {
    if (mode === 'remove') next.delete(market);
    else next.add(market);
  }
  return QUOTE_MARKETS.filter((market) => next.has(market));
}
