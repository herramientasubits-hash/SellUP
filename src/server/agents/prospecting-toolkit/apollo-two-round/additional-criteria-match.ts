/**
 * additional-criteria-match.ts — el criterio libre del vendedor, aplicado a lo que
 * Apollo ya devolvió gratis (AGENT1-CRITERIA-QUICK-WINS-2 § 1).
 *
 * ── El defecto ───────────────────────────────────────────────────────────────
 *
 * En la vía de dos rondas, `additionalCriteria` sólo viajaba como eco en la
 * salida: las consultas se redactan con etiquetas del catálogo y el criterio
 * («usan SAP», «hospitales privados») no influía en nada. Meterlo en
 * `q_organization_keyword_tags` tampoco sirve: ese filtro es un O lógico, así
 * que AMPLÍA la búsqueda en vez de acotarla, y además entra último y el tope de
 * 25 valores lo recorta.
 *
 * ── El arreglo ───────────────────────────────────────────────────────────────
 *
 * El criterio se usa donde sí decide sin costar nada: sobre el texto gratuito de
 * cada organización (nombre, industria, palabras clave, descripción). Una empresa
 * que lo menciona sube en la prioridad del enriquecimiento pagado y, cuando hay
 * tope de entrega, se entrega antes. No descarta a nadie: el criterio es libre y
 * una ausencia de mención no prueba que no lo cumpla.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Tokens cortos («ti», «erp») exigen palabra completa: «ti» no es «tienda». */
const WHOLE_WORD_MAX_LENGTH = 3;

/**
 * Los tokens del criterio que aparecen en alguno de los textos. Sin repetidos y
 * en el orden del criterio. Un token largo coincide como prefijo de palabra
 * («hospital» ⇒ «hospitales»); uno corto, sólo como palabra completa.
 */
export function matchAdditionalCriteria(
  tokens: readonly string[],
  texts: readonly (string | null | undefined)[],
): string[] {
  if (tokens.length === 0) return [];
  const haystack = normalize(texts.filter((t): t is string => typeof t === 'string' && t.trim() !== '').join(' \n '));
  if (!haystack) return [];
  const matched: string[] = [];
  for (const raw of tokens) {
    const token = normalize(raw.trim());
    if (!token || matched.includes(token)) continue;
    const pattern =
      token.length <= WHOLE_WORD_MAX_LENGTH
        ? new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}($|[^a-z0-9])`)
        : new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}`);
    if (pattern.test(haystack)) matched.push(token);
  }
  return matched;
}

/**
 * Orden ESTABLE por número de coincidencias, de más a menos. Sin tokens devuelve
 * la misma lista: una corrida sin criterio queda exactamente como antes.
 */
export function orderByAdditionalCriteriaMatch<T>(
  items: readonly T[],
  tokens: readonly string[],
  textsOf: (item: T) => readonly (string | null | undefined)[],
): T[] {
  if (tokens.length === 0) return [...items];
  return items
    .map((item, index) => ({ item, index, matches: matchAdditionalCriteria(tokens, textsOf(item)).length }))
    .sort((a, b) => b.matches - a.matches || a.index - b.index)
    .map((entry) => entry.item);
}
