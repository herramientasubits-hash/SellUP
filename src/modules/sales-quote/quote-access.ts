/**
 * Qué mercados puede cotizar cada persona.
 *
 * El admin y los líderes (manager y líder comercial) cotizan todos los
 * mercados. Vendedores BD y Growth cotizan la región de su GRUPO de SellUp
 * (Configuración → Usuarios y acceso): se toma el nombre de su grupo o, si no
 * dice región, el del grupo superior más cercano que sí la diga. Un grupo dice
 * región si se llama como un mercado («Andina», «Región Andina») o como un país
 * («Colombia» → Andina). Sin grupo de región no pueden cotizar. Puro: el
 * servidor le pasa quién es la persona y los nombres de sus grupos.
 */
import { TEAM_ROLE_KEYS } from '@/modules/access/commercial-scope-logic';
import { QUOTE_COUNTRIES, QUOTE_MARKETS, countriesForMarkets, type QuoteCountry, type QuoteMarket } from './markets';

export interface QuoteViewer {
  isAdmin: boolean;
  roleKey: string | null;
}

/** ¿Ve todos los mercados por su rol, sin importar su grupo? */
export function seesAllQuoteMarkets(viewer: QuoteViewer): boolean {
  return viewer.isAdmin || (TEAM_ROLE_KEYS as readonly string[]).includes(viewer.roleKey ?? '');
}

export interface QuoteMarketAccess {
  markets: QuoteMarket[];
  /** Los ve todos por su rol (no por su grupo). */
  seesAll: boolean;
  /** El grupo del que salió la región, para decírselo a la persona. */
  fromGroup?: string | null;
}

/** «Región Centro América» → «region centro america». */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const contains = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

/** Formas en que un nombre de grupo dice cada mercado. */
const MARKET_ALIASES: Record<QuoteMarket, string[]> = {
  Andina: ['andina', 'region andina', 'andean'],
  Chile: ['chile'],
  México: ['mexico'],
  Centroamérica: ['centroamerica', 'centro america', 'cam', 'caribe'],
  Otros: ['otros'],
};

/** Los mercados que nombra un grupo: por región o por país. */
export function marketsNamedBy(groupName: string): QuoteMarket[] {
  const name = normalize(groupName);
  if (!name) return [];
  const found = new Set<QuoteMarket>();
  for (const market of QUOTE_MARKETS) {
    if (MARKET_ALIASES[market].some((alias) => contains(name, alias))) found.add(market);
  }
  for (const country of QUOTE_COUNTRIES) {
    if (country.code !== 'XX' && contains(name, normalize(country.name))) found.add(country.market);
  }
  return QUOTE_MARKETS.filter((market) => found.has(market));
}

/**
 * La región de una persona según su grupo. `groupPath` va del grupo de la
 * persona hacia arriba (su grupo, el padre, el abuelo); gana el más cercano
 * que nombre una región.
 */
export function resolveQuoteMarkets(viewer: QuoteViewer, groupPath: readonly string[]): QuoteMarketAccess {
  if (seesAllQuoteMarkets(viewer)) return { markets: [...QUOTE_MARKETS], seesAll: true, fromGroup: null };
  for (const groupName of groupPath) {
    const markets = marketsNamedBy(groupName);
    if (markets.length > 0) return { markets, seesAll: false, fromGroup: groupName };
  }
  return { markets: [], seesAll: false, fromGroup: groupPath[0] ?? null };
}

export interface GroupRow {
  id: string;
  name: string;
  parent_group_id: string | null;
}

/** Los nombres desde el grupo de la persona hasta la raíz (corta ciclos). */
export function groupPathNames(groupId: string | null, groups: readonly GroupRow[]): string[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = groupId ? byId.get(groupId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.push(current.name);
    current = current.parent_group_id ? byId.get(current.parent_group_id) : undefined;
  }
  return names;
}

/** Los países que puede cotizar, de la lista de una versión. */
export function quotableCountries(
  access: Pick<QuoteMarketAccess, 'markets'>,
  countries: readonly QuoteCountry[] = QUOTE_COUNTRIES,
): QuoteCountry[] {
  return countriesForMarkets(access.markets, countries);
}

/** ¿Puede cotizar este país? */
export function canQuoteCountry(
  access: Pick<QuoteMarketAccess, 'markets'>,
  countryCode: string,
  countries: readonly QuoteCountry[] = QUOTE_COUNTRIES,
): boolean {
  return quotableCountries(access, countries).some((country) => country.code === countryCode);
}
