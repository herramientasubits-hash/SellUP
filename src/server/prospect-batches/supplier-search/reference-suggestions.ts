/**
 * AGENT1-SUPPLIER-REFERENCE-SUGGEST-1 — entidades públicas sugeridas mientras se escribe
 * la empresa de referencia de «Proveedores de una empresa» (auditoría 21-10).
 *
 * El paso de compras públicas reconoce la entidad por su nombre exacto (o el comienzo):
 * quien escribe «Seguro Social» no encontraba al «Instituto Mexicano del Seguro Social»
 * y la corrida pasaba a Claude, que con entidades públicas no trae nada. Aquí se buscan
 * las entidades cuyo nombre CONTIENE lo escrito, con su país y cuántos proveedores
 * tienen; al elegir una, el nombre y el país coinciden con lo que el paso busca.
 *
 * Fuentes: los países cargados (`public_procurement_supplier_links`, función 154) y
 * Colombia (entidades públicas del registro; sus proveedores se leen en vivo de SECOP II,
 * así que no hay conteo). Puro: dependencias inyectadas.
 */

import { PUBLIC_BUYER_SUPPLIER_COUNTRIES, normalizePublicEntityName } from './public-buyer-suppliers';

/** Con menos de esto no se busca (la función 154 tampoco). */
export const SUPPLIER_REFERENCE_SUGGEST_MIN_CHARS = 3;
/** Sugerencias como mucho. */
export const SUPPLIER_REFERENCE_SUGGEST_LIMIT = 8;
/** Lo escrito que se usa para buscar, como mucho. */
const QUERY_MAX_CHARS = 80;

export type SupplierReferenceSuggestion = {
  /** Nombre para mostrar y para la corrida (el paso lo normaliza igual que al cargar). */
  name: string;
  countryCode: string;
  /** Proveedores de la entidad en la ventana cargada; `null` = se leen en vivo (Colombia). */
  supplierCount: number | null;
};

export type LoadedBuyerMatch = {
  countryCode: string;
  buyerName: string;
  buyerNameNormalized: string;
  supplierCount: number;
};

export type CoEntityMatch = { legalName: string; normalizedLegalName: string };

export type SupplierReferenceSuggestDeps = {
  searchLoadedBuyers: (normalizedQuery: string, limit: number) => Promise<LoadedBuyerMatch[]>;
  /** Ausente ⇒ Colombia no aporta sugerencias. */
  searchCoEntities?: (normalizedQuery: string, limit: number) => Promise<CoEntityMatch[]>;
};

/** «seguro  social» → «SEGURO SOCIAL» (como `buyer_name_normalized`). `null` si es corto. */
export function normalizeSuggestionQuery(raw: string): string | null {
  const normalized = normalizePublicEntityName(raw.slice(0, QUERY_MAX_CHARS));
  return normalized.length >= SUPPLIER_REFERENCE_SUGGEST_MIN_CHARS ? normalized : null;
}

/** Los nombres cargados traen espacios dobles y mayúsculas raras («SEGURO SOCIAL DE  SALUD»). */
export function displayBuyerName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Primero las que EMPIEZAN por lo escrito; luego las de más proveedores (las de
 * Colombia, sin conteo, después de las que tienen); sin repetir país + nombre.
 */
export function rankSupplierReferenceSuggestions(
  normalizedQuery: string,
  items: ReadonlyArray<SupplierReferenceSuggestion & { normalized: string }>,
  limit: number = SUPPLIER_REFERENCE_SUGGEST_LIMIT,
): SupplierReferenceSuggestion[] {
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = `${item.countryCode}:${item.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const startsWith = (item: { normalized: string }) => (item.normalized.startsWith(normalizedQuery) ? 0 : 1);
  return [...unique]
    .sort(
      (a, b) =>
        startsWith(a) - startsWith(b) ||
        (b.supplierCount ?? -1) - (a.supplierCount ?? -1) ||
        a.normalized.localeCompare(b.normalized),
    )
    .slice(0, limit)
    .map(({ name, countryCode, supplierCount }) => ({ name, countryCode, supplierCount }));
}

export async function suggestSupplierReferences(
  rawQuery: string,
  deps: SupplierReferenceSuggestDeps,
): Promise<SupplierReferenceSuggestion[]> {
  const query = normalizeSuggestionQuery(rawQuery);
  if (!query) return [];
  const [loaded, colombia] = await Promise.all([
    deps.searchLoadedBuyers(query, SUPPLIER_REFERENCE_SUGGEST_LIMIT),
    deps.searchCoEntities ? deps.searchCoEntities(query, SUPPLIER_REFERENCE_SUGGEST_LIMIT) : Promise.resolve([]),
  ]);
  const items = [
    ...loaded
      // Sólo países que «Proveedores» sabe recorrer: elegir otra cosa no serviría.
      .filter((row) => PUBLIC_BUYER_SUPPLIER_COUNTRIES.includes(row.countryCode))
      .map((row) => ({
        name: displayBuyerName(row.buyerName),
        countryCode: row.countryCode,
        supplierCount: row.supplierCount,
        normalized: row.buyerNameNormalized,
      })),
    ...colombia.map((row) => ({
      name: displayBuyerName(row.legalName),
      countryCode: 'CO',
      supplierCount: null,
      normalized: row.normalizedLegalName,
    })),
  ];
  return rankSupplierReferenceSuggestions(query, items);
}
