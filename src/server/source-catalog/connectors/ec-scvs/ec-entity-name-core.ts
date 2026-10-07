/**
 * ec-entity-name-core.ts — núcleo comparable del nombre de CUALQUIER contribuyente
 * ecuatoriano con RUC de sociedad: compañías y entidades públicas.
 *
 * SOURCES-EC-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Las compañías usan `normalizeEcCompanyCore` (quita la forma societaria). Las
 * entidades públicas del catastro del SRI se registran con su nombre legal largo
 * y Apollo, Tavily o Claude las nombran de otra manera:
 *
 *   SRI:    «GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON CELICA»
 *   Apollo: «Municipio de Celica», «GAD Celica», «Alcaldía de Celica»
 *
 *   SRI:    «GOBIERNO AUTONOMO DESCENTRALIZADO DE LA PROVINCIA DEL CARCHI»
 *   Apollo: «Prefectura del Carchi», «Gobierno Provincial del Carchi»
 *
 * Aquí las dos formas llegan al MISMO núcleo canónico: «GAD MUNICIPAL CELICA»,
 * «GAD PROVINCIAL CARCHI», «GAD PARROQUIAL TAMBILLO». Lo demás (ministerios,
 * hospitales, universidades, empresas públicas) se compara por su nombre limpio.
 * Un nombre genérico que se repite (p. ej. «GAD PARROQUIAL SAN JOSE» en varias
 * provincias) da varios RUC y el resolvedor lo deja como pista, nunca seguro.
 */

import { normalizeEcCompanyCore } from './ec-company-name-core';

const GAD = '(?:GOBIERNO AUTONOMO DESCENTRALIZADO|GOBIERNO AUTONOMO DESCENTRALIZADA|GAD)';
const OF = '(?:DE LA |DEL |DE LOS |DE )?';

/** Orden: lo más específico primero. El grupo 1 es el lugar. */
const PUBLIC_ENTITY_PATTERNS: ReadonlyArray<{ re: RegExp; kind: string }> = [
  // Parroquias (antes que municipal: «GAD PARROQUIAL RURAL DE X»).
  { re: new RegExp(`^${GAD} ${OF}PARROQUIA(?:L)?(?: RURAL)? ${OF}(.+)$`), kind: 'PARROQUIAL' },
  { re: new RegExp(`^${GAD} PARROQUIAL(?: RURAL)? ${OF}(.+)$`), kind: 'PARROQUIAL' },
  // Provincias.
  { re: new RegExp(`^${GAD} ${OF}PROVINCIA(?:L)? ${OF}(.+)$`), kind: 'PROVINCIAL' },
  { re: new RegExp(`^(?:GOBIERNO|CONSEJO) PROVINCIAL ${OF}(.+)$`), kind: 'PROVINCIAL' },
  { re: new RegExp(`^PREFECTURA ${OF}(?:PROVINCIA ${OF})?(.+)$`), kind: 'PROVINCIAL' },
  // Cantones y distritos metropolitanos.
  { re: new RegExp(`^${GAD} (?:MUNICIPAL )?${OF}(?:DISTRITO METROPOLITANO|CANTON) ${OF}(.+)$`), kind: 'MUNICIPAL' },
  { re: new RegExp(`^${GAD} MUNICIPAL ${OF}(?:CANTON ${OF})?(.+)$`), kind: 'MUNICIPAL' },
  {
    re: new RegExp(
      `^(?:M I |MUY ILUSTRE |ILUSTRE |I )?(?:MUNICIPIO|MUNICIPALIDAD|ALCALDIA|CONCEJO MUNICIPAL) ${OF}(?:DISTRITO METROPOLITANO ${OF}|CANTON ${OF})?(.+)$`,
    ),
    kind: 'MUNICIPAL',
  },
];

/** «GAD MUNICIPAL CELICA», «GAD PROVINCIAL CARCHI»… o `null` si no es un gobierno local. */
export function canonicalEcLocalGovernment(core: string): string | null {
  for (const { re, kind } of PUBLIC_ENTITY_PATTERNS) {
    const match = re.exec(core);
    if (match === null) continue;
    const place = match[1].replace(/^(?:CANTON|DISTRITO METROPOLITANO) (?:DE |DEL )?/, '').trim();
    if (place.length < 2) return null;
    return `GAD ${kind} ${place}`;
  }
  return null;
}

/**
 * SOURCES-EC-NAME-MATCH-GAPS-1 — los hospitales públicos están en el SRI con su
 * tipo («HOSPITAL PROVINCIAL GENERAL DOCENTE VICENTE CORRAL MOSCOSO») y Apollo los
 * nombra sin él («Hospital Vicente Corral Moscoso»). Las dos formas llegan a
 * «HOSPITAL VICENTE CORRAL MOSCOSO». Sólo se quita el TIPO; lo que distingue a
 * una institución («IESS», «MILITAR», «DEL NIÑO») se queda. Dos hospitales que
 * terminan con el mismo núcleo dan varios RUC: pista, nunca seguro.
 */
const HOSPITAL_TYPE_WORDS = /^(?:PROVINCIAL|GENERAL|DOCENTE|BASICO|REGIONAL|ESPECIALIZADO|DE ESPECIALIDADES)\s+/;

export function canonicalEcHospital(core: string): string | null {
  if (!core.startsWith('HOSPITAL ')) return null;
  let rest = core.slice('HOSPITAL '.length);
  let previous = '';
  while (rest !== previous) {
    previous = rest;
    rest = rest.replace(HOSPITAL_TYPE_WORDS, '');
  }
  rest = rest.replace(/^(?:DE |DEL )/, '').trim();
  if (rest.length < 3 || rest === core.slice('HOSPITAL '.length)) return null;
  return `HOSPITAL ${rest}`;
}

/**
 * Núcleo para el catastro del SRI y para buscar en él: el de compañía y, si es
 * un gobierno local o un hospital, su forma canónica.
 */
export function normalizeEcEntityCore(name: string | null | undefined): string {
  const core = normalizeEcCompanyCore(name);
  if (core.length === 0) return core;
  return canonicalEcLocalGovernment(core) ?? canonicalEcHospital(core) ?? core;
}
