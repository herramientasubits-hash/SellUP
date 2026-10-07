/**
 * bo-company-name-core.ts — núcleo comparable de un nombre boliviano.
 *
 * SOURCES-BO-CLOSE-1. El mismo núcleo se calcula sobre el nombre de la candidata
 * (Apollo, Tavily, Claude, buscador gratuito) y sobre la razón social del registro
 * (SEPREC, lista de grandes contribuyentes). Dos nombres son la misma empresa sólo
 * si sus núcleos son iguales.
 *
 * Qué se quita (medido con los nombres reales de Prod y del SEPREC, 06-10):
 *
 *   1. La FORMA SOCIETARIA, reconocida por su estructura y no por una lista
 *      exacta: «S.A.», «S. A.», «SA», «S.R.L.», «SRL.», «LTDA.», «Limitada»,
 *      «SOCIEDAD ANÓNIMA (MIXTA)», «S.A.M.», «SAFI» / «S.A.F.I.», «SOCIEDAD
 *      ADMINISTRADORA DE FONDOS DE INVERSIÓN», «SUCURSAL BOLIVIA», «INC.»…
 *      Al final, repetida («… S.A. SUCURSAL BOLIVIA») y también EN MEDIO cuando
 *      detrás sólo viene una descripción o una sigla:
 *        «DAPIBOL S.A. AGENCIA DESPACHANTE DE ADUANA»   → DAPIBOL
 *        «ALMACENES PACIFICO SUR S.A.  ALPASUR»         → ALMACENES PACIFICO SUR
 *        «3M CHILE S.A. SUCURSAL BOLIVIA»               → 3M CHILE
 *   2. La WEB o el PAÍS pegados por el proveedor: «Cognos.com.bo» → COGNOS,
 *      «Get Server Bolivia» → GET SERVER. «BANCO CENTRAL DE BOLIVIA» se queda
 *      igual: «de Bolivia» es parte del nombre.
 *   3. Las comillas y los signos («"SOLUCREDIT S.R.L."» → SOLUCREDIT).
 *
 * Puro: sin env, sin I/O, sin red.
 */

/** Formas societarias (en palabras ya normalizadas), de la más larga a la más corta. */
const LEGAL_FORM_SEQUENCES: readonly (readonly string[])[] = [
  ['SOCIEDAD', 'ADMINISTRADORA', 'DE', 'FONDOS', 'DE', 'INVERSION'],
  ['SOCIEDAD', 'DE', 'RESPONSABILIDAD', 'LIMITADA'],
  ['SOCIEDAD', 'ANONIMA', 'MIXTA'],
  ['SOCIEDAD', 'ANONIMA'],
  ['SOCIEDAD', 'COLECTIVA'],
  ['SOCIEDAD', 'EN', 'COMANDITA', 'POR', 'ACCIONES'],
  ['SOCIEDAD', 'EN', 'COMANDITA', 'SIMPLE'],
  ['SOCIEDAD', 'EN', 'COMANDITA'],
  ['SUCURSAL', 'BOLIVIA'],
  ['SUCURSAL', 'EN', 'BOLIVIA'],
  ['S', 'A', 'F', 'I'],
  ['S', 'R', 'L'],
  ['S', 'A', 'M'],
  ['S', 'A'],
  ['LIMITADA'],
  ['LTDA'],
  ['SAFI'],
  ['SRL'],
  ['SAM'],
  ['SA'],
];

/** Sólo al final: palabras que en medio de un nombre suelen ser parte de él. */
const TRAILING_ONLY_FORMS: readonly (readonly string[])[] = [
  ['SUCURSAL'],
  ['CORPORATION'],
  ['CORP'],
  ['INC'],
  ['LLC'],
];

/** Colas de web pegadas al nombre. */
const WEB_TAILS: readonly (readonly string[])[] = [
  ['COM', 'BO'],
  ['ORG', 'BO'],
  ['NET', 'BO'],
  ['GOB', 'BO'],
  ['EDU', 'BO'],
  ['COM'],
  ['BO'],
];

/** Palabras que, delante de «BOLIVIA», hacen que el país sea parte del nombre. */
const COUNTRY_IS_PART_OF_NAME_AFTER = new Set(['DE', 'DEL', 'PARA', 'EN', 'Y']);

/** Palabras sueltas, mayúsculas, sin tildes ni signos. */
export function boliviaNameWords(name: string | null | undefined): string[] {
  if (typeof name !== 'string') return [];
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function endsWith(words: readonly string[], tail: readonly string[]): boolean {
  if (words.length <= tail.length) return false;
  return tail.every((word, i) => words[words.length - tail.length + i] === word);
}

/** Posición de la primera forma societaria a partir de `from`, o -1. */
function firstLegalFormAt(words: readonly string[], from: number): { index: number; length: number } {
  for (let i = from; i < words.length; i += 1) {
    for (const form of LEGAL_FORM_SEQUENCES) {
      if (form.every((word, k) => words[i + k] === word)) return { index: i, length: form.length };
    }
  }
  return { index: -1, length: 0 };
}

/** Quita colas (forma, web, país) del final, repetidas, sin dejar el nombre vacío. */
function stripTails(input: readonly string[]): string[] {
  let words = [...input];
  let changed = true;
  while (changed && words.length > 1) {
    changed = false;
    for (const tail of [...LEGAL_FORM_SEQUENCES, ...TRAILING_ONLY_FORMS, ...WEB_TAILS]) {
      if (endsWith(words, tail)) {
        words = words.slice(0, words.length - tail.length);
        changed = true;
        break;
      }
    }
    if (!changed && words.length > 1 && words[words.length - 1] === 'BOLIVIA') {
      const before = words[words.length - 2];
      if (!COUNTRY_IS_PART_OF_NAME_AFTER.has(before)) {
        words = words.slice(0, -1);
        changed = true;
      }
    }
  }
  return words;
}

/**
 * Núcleo comparable. Una forma societaria EN MEDIO corta el nombre ahí (lo de
 * detrás es una descripción o una sigla), salvo que delante quede una sola letra.
 */
export function normalizeBoliviaCompanyCore(name: string | null | undefined): string {
  // Una sigla entre paréntesis acompaña al nombre, no es parte de él:
  // «TELEFONICA CELULAR DE BOLIVIA (TELECEL) S.A.» → TELEFONICA CELULAR DE BOLIVIA.
  const withoutParenthesis = typeof name === 'string' ? name.replace(/\([^()]*\)/g, ' ') : name;
  let words = boliviaNameWords(withoutParenthesis);
  if (words.length === 0) words = boliviaNameWords(name);
  if (words[0] === 'WWW' && words.length > 1) words = words.slice(1);
  words = stripTails(words);
  const middle = firstLegalFormAt(words, 1);
  if (middle.index > 0 && middle.index + middle.length < words.length) {
    const head = words.slice(0, middle.index);
    if (head.join('').length >= 2) words = stripTails(head);
  }
  return words.join(' ');
}

/**
 * ¿El nombre trae una forma societaria boliviana de verdad (S.A., S.R.L., LTDA.,
 * SAFI…), al final o en medio? La web o el país pegados y las formas extranjeras
 * («Corp», «Inc») no cuentan: «Cognos.com.bo» o «Datec Corp» siguen siendo una
 * marca suelta, que sólo es segura si su web la confirma.
 */
export function boliviaNameCarriesLegalForm(name: string | null | undefined): boolean {
  const words = boliviaNameWords(name);
  return firstLegalFormAt(words, 1).index > 0;
}

/**
 * Lo que una razón social trae DETRÁS de su forma societaria en medio, si es una
 * sola palabra (una sigla o marca: «… S.A. ALPASUR» → ALPASUR), o entre comillas
 * o paréntesis («TELEFONICA CELULAR DE BOLIVIA (TELECEL) S.A.» → TELECEL). Sirve
 * como clave secundaria de la lista de grandes contribuyentes; `[]` si no hay.
 */
export function boliviaLegalNameAliases(legalName: string | null | undefined): string[] {
  if (typeof legalName !== 'string') return [];
  const aliases = new Set<string>();
  for (const match of legalName.matchAll(/[("“]([^()"“”]{3,40})[)"”]/g)) {
    const alias = normalizeBoliviaCompanyCore(match[1]);
    if (alias.replace(/\s/g, '').length >= 4) aliases.add(alias);
  }
  const words = stripTails(boliviaNameWords(legalName));
  const middle = firstLegalFormAt(words, 1);
  if (middle.index > 0) {
    const after = stripTails(words.slice(middle.index + middle.length));
    if (after.length === 1 && after[0].length >= 4 && !/^\d+$/.test(after[0])) aliases.add(after[0]);
  }
  aliases.delete(normalizeBoliviaCompanyCore(legalName));
  return [...aliases];
}

/** Sufijos que una web suele pegar a la marca: «credifondosafi», «getserverbolivia». */
const DOMAIN_LABEL_SUFFIXES = ['', 'sa', 'srl', 'ltda', 'safi', 'bo', 'bolivia', 'bol'];

/** Dominios que nunca son la web propia de una empresa privada. */
const NON_CORPORATE_SUFFIXES = ['.gob.bo', '.edu.bo', '.mil.bo'];
const NON_CORPORATE_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com',
  'gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'wordpress.com', 'blogspot.com', 'wixsite.com',
]);

/** Host de una web o dominio, sin «www.», o `null`. */
export function boliviaWebsiteHost(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\d?\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** Etiqueta propia del dominio: «cognos.com.bo» → cognos, «dapibol.com» → dapibol. */
export function boliviaDomainLabel(host: string): string {
  const parts = host.split('.');
  const secondLevel = new Set(['com', 'org', 'net', 'gob', 'edu', 'mil', 'int', 'tv', 'info']);
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && secondLevel.has(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

/**
 * ¿La web propia de la candidata confirma el núcleo? Sólo si la etiqueta del
 * dominio es exactamente el núcleo sin espacios (más, como mucho, una forma o el
 * país pegados: credifondosafi.com.bo ↔ CREDIFONDO) y el dominio no es
 * institucional ni de una plataforma. Se usa para dos cosas:
 *   - una marca de UNA palabra deja de ser sólo pista (datec.com.bo ↔ DATEC LTDA.);
 *   - una marca dentro de UNA sola razón social deja de ser sólo pista cuando la web
 *     es esa marca (alpasur.com.bo ↔ ALMACENES PACIFICO SUR S.A. ALPASUR). Aprobado
 *     por la dueña el 06-10 («adelante a lo que me recomiendes»).
 */
export function boliviaDomainConfirmsName(domain: string | null, core: string): boolean {
  const host = boliviaWebsiteHost(domain);
  if (host === null || NON_CORPORATE_HOSTS.has(host)) return false;
  if (NON_CORPORATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  const label = boliviaDomainLabel(host).replace(/-/g, '');
  const word = core.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (word.length < 3) return false;
  return DOMAIN_LABEL_SUFFIXES.some((suffix) => label === `${word}${suffix}`);
}
