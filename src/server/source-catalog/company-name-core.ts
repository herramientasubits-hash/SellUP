/**
 * company-name-core.ts — núcleo comparable del nombre de una empresa, genérico y
 * configurable por país con su lista de formas societarias.
 *
 * SOURCES-GT-HN-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Núcleo = mayúsculas, sin tildes, sólo letras/dígitos/&, espacios simples y sin
 * la forma societaria FINAL. El mismo cálculo se usa al completar
 * `normalized_legal_name` de una fuente y al buscar una empresa por nombre en la
 * corrida del Agente 1: si los dos lados no normalizan igual, la búsqueda exacta
 * nunca coincide (nunca produce una coincidencia falsa).
 *
 * `buildCompanyNameCoreSql` genera la versión PostgreSQL para completar la
 * columna en una sola sentencia. SQL sólo quita las tildes del castellano; un
 * nombre con otra marca queda con un núcleo distinto y simplemente no coincide.
 */

/** Formas societarias de Centroamérica (Guatemala, Honduras), más largas primero. */
export const CENTRAL_AMERICA_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA DE CAPITAL VARIABLE',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD ANONIMA',
  'SOCIEDAD COLECTIVA',
  'S DE R L DE C V',
  'S A DE C V',
  'S DE R L',
  'S A',
  'LIMITADA',
  'LTDA',
  'SA',
];

/** Núcleo comparable del nombre con las formas dadas, o cadena vacía. */
export function normalizeCompanyNameCore(
  name: string | null | undefined,
  legalForms: readonly string[],
): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';

  let core = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    for (const form of legalForms) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/**
 * Expresión PostgreSQL equivalente sobre la columna `legal_name`. Quita la forma
 * hasta 3 veces (las apiladas no pasan de dos en los datos medidos).
 */
export function buildCompanyNameCoreSql(legalForms: readonly string[]): string {
  const forms = legalForms.join('|');
  const base =
    "btrim(regexp_replace(regexp_replace(upper(translate(legal_name, " +
    "'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖáéíóúüñàèìòùâêîôûäëïö', " +
    "'AEIOUUNAEIOUAEIOUAEIOaeiouunaeiouaeiouaeio')), '[^A-Z0-9& ]', ' ', 'g'), '\\s+', ' ', 'g'))";
  const strip = (expr: string) => `regexp_replace(${expr}, ' (${forms})$', '')`;
  return `btrim(${strip(strip(strip(base)))})`;
}
