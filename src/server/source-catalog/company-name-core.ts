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

/**
 * Formas societarias de Perú (SUNAT), más largas primero. SOURCES-PE-RUC-BY-NAME-1.
 * Medido sobre las 867.360 sociedades (RUC 20) activas y habidas de septiembre de
 * 2026: con estas formas el 99,1 % tiene un núcleo que no comparte con ninguna otra.
 */
export const PERU_LEGAL_FORMS: readonly string[] = [
  'EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD ANONIMA CERRADA',
  'SOCIEDAD ANONIMA ABIERTA',
  'SOCIEDAD ANONIMA',
  'S C R L',
  'E I R L',
  'S A C',
  'S A A',
  'S R L',
  'S A',
  'SCRL',
  'EIRL',
  'SAC',
  'SAA',
  'SRL',
  'SA',
];

/**
 * Formas societarias de México, más largas primero. SOURCES-MX-DENUE-FREE-DISCOVERY-1:
 * sirve para agrupar las sucursales DENUE de una misma empresa.
 */
export const MEXICO_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD ANONIMA PROMOTORA DE INVERSION DE CAPITAL VARIABLE',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA DE CAPITAL VARIABLE',
  'SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
  'SOCIEDAD CIVIL',
  'SOCIEDAD ANONIMA',
  'S A P I DE C V',
  'S DE R L DE C V',
  'S A B DE C V',
  'S A DE C V',
  'S DE R L',
  'S A P I',
  'S C',
  'S A',
  'SAPI',
  'SA',
];

/**
 * Formas societarias de Colombia (registro de las cámaras de comercio), más largas
 * primero. SOURCES-CO-RUES-LIVE-NIT-1. «BIC» y «E S P» se apilan tras la forma
 * («S.A.S. - BIC.», «S.A.S E.S.P.»), por eso también se quitan. «EN LIQUIDACION»
 * NO se quita: una sociedad en liquidación no es la empresa activa.
 */
export const COLOMBIA_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD POR ACCIONES SIMPLIFICADA',
  'SOCIEDAD ANONIMA',
  'S EN C S',
  'S EN C',
  'LIMITADA',
  'S A S',
  'E S P',
  'S C A',
  'C T A',
  'E U',
  'S A',
  'LTDA',
  'SAS',
  'BIC',
  'ESP',
  'CTA',
  'EU',
  'SA',
];

/**
 * Formas societarias de Paraguay (padrón de RUC de la SET/DNIT), más largas primero.
 * SOURCES-PY-RUC-BY-NAME-1. «S A E C A» = sociedad anónima emisora de capital abierto.
 */
export const PARAGUAY_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD ANONIMA EMISORA DE CAPITAL ABIERTO',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD ANONIMA',
  'S A E C A',
  'E I R L',
  'S R L',
  'S A E',
  'S A',
  'SAECA',
  'EIRL',
  'SRL',
  'SAE',
  'SA',
];

/**
 * Formas societarias de Uruguay (RUPE), más largas primero. SOURCES-UY-RUT-BY-NAME-1.
 * También deciden qué filas del RUPE son EMPRESAS: sólo se carga una razón social
 * que termina en una de estas formas (así no se guardan personas físicas).
 */
export const URUGUAY_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD POR ACCIONES SIMPLIFICADA',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD ANONIMA',
  'LIMITADA',
  'S A S',
  'S R L',
  'S A',
  'LTDA',
  'SAS',
  'SRL',
  'SA',
];

/**
 * Formas societarias de Estados Unidos (SEC EDGAR, IRS), más largas primero.
 * SOURCES-US-EIN-BY-NAME-1. «FOUNDATION», «UNIVERSITY» o «COMPANY» NO se quitan:
 * son parte del nombre, no la forma.
 */
export const US_LEGAL_FORMS: readonly string[] = [
  'INCORPORATED',
  'CORPORATION',
  'LIMITED',
  'L L C',
  'L L P',
  'L P',
  'CORP',
  'LLC',
  'LLP',
  'LTD',
  'INC',
  'PLC',
  'LP',
  'CO',
];

/**
 * Formas societarias de España (adjudicatarias de la Plataforma de Contratación),
 * más largas primero. SOURCES-ES-NIF-BY-NAME-1.
 */
export const SPAIN_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD LIMITADA UNIPERSONAL',
  'SOCIEDAD ANONIMA UNIPERSONAL',
  'SOCIEDAD LIMITADA PROFESIONAL',
  'SOCIEDAD LIMITADA LABORAL',
  'SOCIEDAD COOPERATIVA',
  'SOCIEDAD LIMITADA',
  'SOCIEDAD ANONIMA',
  'S COOP',
  'S L U',
  'S L P',
  'S L L',
  'S A U',
  'S L',
  'S A',
  'SCOOP',
  'SLU',
  'SLP',
  'SLL',
  'SAU',
  'SL',
  'SA',
];

/**
 * Formas societarias de Chile (Registro de Empresas y Sociedades), más largas
 * primero. SOURCES-CL-RUT-BY-NAME-1.
 */
export const CHILE_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD POR ACCIONES',
  'SOCIEDAD ANONIMA',
  'LIMITADA',
  'S P A',
  'E I R L',
  'S R L',
  'S A',
  'LTDA',
  'EIRL',
  'SPA',
  'SRL',
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
