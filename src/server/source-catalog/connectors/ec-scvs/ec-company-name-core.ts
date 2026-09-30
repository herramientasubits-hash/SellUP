/**
 * ec-company-name-core.ts — núcleo comparable del nombre de una compañía
 * ecuatoriana (Superintendencia de Compañías, `ec_scvs`).
 *
 * SOURCES-EC-RUC-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * El MISMO cálculo se usa al completar `normalized_legal_name` de `ec_scvs` y al
 * buscar una empresa por nombre dentro de la corrida del Agente 1. La versión SQL
 * de la migración de datos (`EC_COMPANY_NAME_CORE_SQL`) replica esta función; su
 * equivalencia se verifica contra una muestra antes de escribir.
 *
 * Núcleo = mayúsculas, sin tildes, sólo letras/dígitos/&, espacios simples y sin
 * la forma societaria final («S.A.», «S.A.S.», «CIA. LTDA.», «C LTDA»…).
 *
 * 🔴 «EN LIQUIDACIÓN» NO se quita a propósito: una compañía en liquidación
 * conserva ese texto en su núcleo y por eso nunca coincide con el nombre de una
 * empresa activa. Nunca recibe el RUC de otra, ni otra el suyo.
 */

/** Formas societarias ecuatorianas, más largas primero. */
export const EC_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD POR ACCIONES SIMPLIFICADA',
  'COMPANIA DE RESPONSABILIDAD LIMITADA',
  'COMPANIA LIMITADA',
  'SOCIEDAD ANONIMA',
  'CIA LTDA',
  'C LTDA',
  'S A S',
  'S A',
  'C A',
  'LTDA',
  'CIA',
  'SAS',
  'SA',
  'CA',
];

/** Núcleo comparable del nombre, o cadena vacía si no queda nada. */
export function normalizeEcCompanyCore(name: string | null | undefined): string {
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
    for (const form of EC_LEGAL_FORMS) {
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
 * Versión SQL (PostgreSQL) de `normalizeEcCompanyCore` sobre la columna `legal_name`,
 * para completar `normalized_legal_name` en una sola sentencia.
 *
 * Diferencia conocida y SEGURA: SQL sólo quita las tildes del castellano (no todas
 * las marcas combinantes, como hace NFD). Un nombre con otra marca queda con un
 * núcleo distinto al de TypeScript y simplemente no coincide: nunca produce una
 * coincidencia falsa. La forma se quita hasta 3 veces (nunca hay más apiladas).
 */
export const EC_COMPANY_NAME_CORE_SQL = (() => {
  const forms = EC_LEGAL_FORMS.join('|');
  const base =
    "btrim(regexp_replace(regexp_replace(upper(translate(legal_name, " +
    "'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖáéíóúüñàèìòùâêîôûäëïö', " +
    "'AEIOUUNAEIOUAEIOUAEIOaeiouunaeiouaeiouaeio')), '[^A-Z0-9& ]', ' ', 'g'), '\\s+', ' ', 'g'))";
  const strip = (expr: string) => `regexp_replace(${expr}, ' (${forms})$', '')`;
  return `btrim(${strip(strip(strip(base)))})`;
})();
