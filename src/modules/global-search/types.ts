/**
 * Búsqueda general en TODO SellUp (dueña 17-11: «que ese buscador busque también en todo
 * SellUp: por revisar, búsquedas, descartadas, de empresas y contactos, todo»).
 *
 * Las empresas y los contactos aprobados ya se cargan al abrir el buscador; esto es lo
 * demás, que se busca en el servidor por lo escrito (con el alcance de cada lista).
 */

/** Qué es lo encontrado y, así, a dónde lleva. */
export type SellUpRecordKind = 'prospect' | 'discarded_company' | 'search' | 'contact_candidate';

/** Estado del candidato de contacto: su cola en Contactos. */
export type ContactCandidateQueue = 'pending_review' | 'duplicate' | 'discarded';

export interface SellUpRecordHit {
  kind: SellUpRecordKind;
  id: string;
  title: string;
  meta: string[];
  keywords: string[];
  /** Sólo candidatos de contacto: en qué cola está. */
  queue?: ContactCandidateQueue;
}

export interface SellUpRecordsResult {
  hits: SellUpRecordHit[];
  /** Listas que no se pudieron leer (el resto se muestra igual). */
  failed: SellUpRecordKind[];
}

/** Lo mínimo que se escribe para buscar (igual que en HubSpot). */
export const SELLUP_RECORDS_MIN_QUERY = 3;
/** Cuántos de cada lista. */
export const SELLUP_RECORDS_PER_KIND = 8;

/**
 * Lo escrito, listo para un `ilike`: sin comodines ni caracteres que rompan un filtro de
 * PostgREST, espacios colapsados, largo acotado. `null` si no alcanza.
 */
export function normalizeRecordsQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const query = raw
    .replace(/[%_\\,()*"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return query.length >= SELLUP_RECORDS_MIN_QUERY ? query : null;
}

/** Coincide sin distinguir tildes ni mayúsculas. */
export function foldedIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return fold(haystack).includes(fold(needle));
}
