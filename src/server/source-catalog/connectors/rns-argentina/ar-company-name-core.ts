/**
 * ar-company-name-core.ts — núcleo comparable del nombre de una sociedad
 * argentina: el mismo cálculo al CARGAR el Registro Nacional de Sociedades
 * (`ar_rns_registry.normalized_legal_name`) y al BUSCAR una empresa por nombre
 * dentro de la corrida del Agente 1. Si los dos lados no normalizan igual, la
 * búsqueda exacta nunca coincide: por eso vive en un solo sitio.
 *
 * SOURCES-AR-CUIT-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Núcleo = mayúsculas, sin tildes, sólo letras/dígitos/&, espacios simples y sin
 * la forma societaria final («SOCIEDAD ANONIMA», «S.A.», «S.R.L.», «S.A.S.»…).
 * «TELECOM ARGENTINA SOCIEDAD ANONIMA» y «Telecom Argentina S.A.» → «TELECOM
 * ARGENTINA». Medido sobre las 1.195.004 sociedades activas (junio 2026): el
 * 84,6 % tiene un núcleo que no comparte con ninguna otra.
 */

/** Formas societarias, más largas primero para que «S A U» gane a «S A». */
const AR_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD POR ACCIONES SIMPLIFICADA',
  'SOCIEDAD EN COMANDITA POR ACCIONES',
  'SOCIEDAD ANONIMA UNIPERSONAL',
  'SOCIEDAD COLECTIVA',
  'SOCIEDAD ANONIMA',
  'S DE H',
  'S A U',
  'S A S',
  'S R L',
  'S C A',
  'S A',
  'LIMITADA',
  'LTDA',
  'SAU',
  'SAS',
  'SRL',
  'SCA',
  'SA',
];

/** Núcleo comparable del nombre, o cadena vacía si no queda nada. */
export function normalizeArCompanyCore(name: string | null | undefined): string {
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
    for (const form of AR_LEGAL_FORMS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}
