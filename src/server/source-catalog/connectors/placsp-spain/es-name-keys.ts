/**
 * es-name-keys.ts — núcleo, alias y variantes del nombre de España para el NIF por
 * nombre.
 *
 * SOURCES-ES-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué hace falta (medido el 13-10-2026 en Prod) ────────────────────────
 *
 * Con la lista exacta de formas (`SPAIN_LEGAL_FORMS`, que sigue intacta porque el
 * guardián de empresas conocidas la usa) los núcleos conservaban la forma cuando
 * venía apilada o era propia del sector público: «AENA S M E», «NAVANTIA S A S M
 * E», «CONSUM S COOP V», «SANITAS S A DE SEGUROS», «MERLIN PROPERTIES SOCIMI».
 * Un nombre de Apollo o Tavily sin forma («Aena») nunca los encontraba.
 *
 *   1. La forma se reconoce por su ESTRUCTURA, sin espacios ni puntos: «S.A.»,
 *      «S. A.», «SA», «S.L.U.», «S.A., S.M.E.», «S.Coop.V.», «Sociedad Mercantil
 *      Estatal», «Sociedad Unipersonal», «SOCIMI», «A.I.E.», «S.A. de Seguros y
 *      Reaseguros»… y apiladas: se quitan todas las del final.
 *   2. La sigla va entre paréntesis al final: «Agencia Estatal de Meteorología
 *      (AEMET)» → núcleo sin ella y la sigla como ALIAS.
 *   3. «Iberia Líneas Aéreas de España, S.A. Operadora»: la razón social es lo que
 *      va antes de la forma; lo de detrás (si es corto) es un ALIAS.
 *   4. «Vodafone» es VODAFONE ESPANA: el candidato prueba con y sin «(de) España»
 *      y con «Spain» / «Española».
 *   5. «Junta de Gobierno del Ayuntamiento de Cuenca» = «Ayuntamiento de Cuenca»
 *      = AYUNTAMIENTO CUENCA (clave pública).
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

/** Mayúsculas, sin tildes, sólo letras/dígitos/&, «&» pegado y espacios simples. */
export function plainUpperSpain(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // «L'ALCORA», «MCDONALD'S»: el apóstrofo no separa palabras.
    .replace(/['’´`]/g, '')
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s*&\s*/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formas societarias SIN espacios (la estructura, no la escritura). Se comparan con
 * las últimas palabras del nombre pegadas: «S A», «SA» y «S.A.» son lo mismo.
 */
const ES_LEGAL_FORMS_COMPACT: ReadonlySet<string> = new Set([
  // Anónima / limitada, con sus variantes.
  'SOCIEDADANONIMAUNIPERSONAL',
  'SOCIEDADANONIMALABORAL',
  'SOCIEDADANONIMADEPORTIVA',
  'SOCIEDADANONIMA',
  'SOCIEDADLIMITADAUNIPERSONAL',
  'SOCIEDADLIMITADALABORAL',
  'SOCIEDADLIMITADAPROFESIONAL',
  'SOCIEDADLIMITADANUEVAEMPRESA',
  'SOCIEDADLIMITADA',
  'SOCIEDADDERESPONSABILIDADLIMITADA',
  'SOCIEDADUNIPERSONAL',
  'SOCIETATANONIMA',
  'SOCIETATLIMITADA',
  'SOCIEDADEANONIMA',
  'SOCIEDADELIMITADA',
  'SAU',
  'SAL',
  'SAD',
  'SA',
  'SLU',
  'SLL',
  'SLP',
  'SLNE',
  'SL',
  'SRL',
  // Sector público empresarial.
  'SOCIEDADMERCANTILESTATAL',
  'SOCIEDADMERCANTILPUBLICA',
  'SME',
  'SMESA',
  'SAUSME',
  'SASME',
  'MP',
  'SAMP',
  // Cooperativas (estatales y autonómicas).
  'SOCIEDADCOOPERATIVAVALENCIANA',
  'SOCIEDADCOOPERATIVAANDALUZA',
  'SOCIEDADCOOPERATIVAGALLEGA',
  'SOCIEDADCOOPERATIVALIMITADA',
  'SOCIEDADCOOPERATIVA',
  'SOCIETATCOOPERATIVACATALANALIMITADA',
  'SOCIETATCOOPERATIVAVALENCIANA',
  'SOCIETATCOOPERATIVA',
  'SCOOPV',
  'SCOOPAND',
  'SCOOPGALEGA',
  'SCOOPMAD',
  'SCOOPCLM',
  'SCOOPLTDA',
  'SCOOP',
  'COOPV',
  'SCCL',
  'SCV',
  'SCA',
  'SCL',
  // Otras formas con estructura propia.
  'SOCIMISA',
  'SOCIMI',
  'AGRUPACIONDEINTERESECONOMICO',
  'AIE',
  'SOCIEDADAGRARIADETRANSFORMACION',
  'SAT',
  'SOCIEDADCOLECTIVA',
  'SOCIEDADCOMANDITARIA',
  'SCOM',
  // Aseguradoras: la forma lleva el ramo.
  'SADESEGUROSYREASEGUROS',
  'SADESEGUROS',
  'SOCIEDADANONIMADESEGUROSYREASEGUROS',
  'SOCIEDADANONIMADESEGUROS',
  'SOCIEDADDESEGUROSAPRIMAFIJA',
  'MUTUAAPRIMAFIJA',
  // Extranjeras habituales y sucursales.
  'SUCURSALENESPANA',
  'SUCURSALESPANA',
  'GMBH',
  'BV',
  'NV',
  'LTD',
  'LIMITED',
  'INC',
  'LLC',
  'PLC',
  'SAS',
  'AG',
  'SE',
]);

/** Cuántas palabras finales mira como mucho una forma (la más larga tiene 7). */
const MAX_FORM_WORDS = 7;

/** Una forma completa que ocupa las últimas `k` palabras, o 0. */
function trailingFormWords(words: readonly string[]): number {
  for (let k = Math.min(MAX_FORM_WORDS, words.length - 1); k >= 1; k--) {
    if (ES_LEGAL_FORMS_COMPACT.has(words.slice(words.length - k).join(''))) return k;
  }
  return 0;
}

/** Quita formas societarias del final (apiladas: «S A S M E», «S A SOCIEDAD UNIPERSONAL»). */
function stripLegalFormTails(upper: string): string {
  let words = upper.split(' ').filter((w) => w.length > 0);
  for (;;) {
    const k = trailingFormWords(words);
    if (k === 0) break;
    words = words.slice(0, words.length - k);
  }
  return words.join(' ');
}

/** Paréntesis final: «… (AEMET)», «… (S.A.)». */
const TRAILING_PAREN = /^(.*\S)\s*\(\s*([^()]{2,80}?)\s*\)?\s*\.?\s*$/;

function splitTrailingParen(name: string): { head: string; tag: string | null } {
  const match = TRAILING_PAREN.exec(name.trim());
  if (match === null) return { head: name, tag: null };
  return plainUpperSpain(match[1]).length >= 2 ? { head: match[1], tag: match[2].trim() || null } : { head: name, tag: null };
}

/**
 * Forma FUERTE en medio del nombre seguida de un nombre comercial corto (hasta 3
 * palabras): «IBERIA LINEAS AEREAS DE ESPANA S A OPERADORA».
 */
const MIDDLE_FORM = /\s(?:SOCIEDAD ANONIMA|SOCIEDAD LIMITADA|S A U|S L U|S A|S L)\s(?=[A-Z0-9&])/;

function splitMiddleForm(upper: string): { before: string; after: string } | null {
  const match = MIDDLE_FORM.exec(upper);
  if (match === null || match.index === 0) return null;
  const rest = upper.slice(match.index + match[0].length).trim();
  if (/^(DE|DEL|EN|Y)\b/.test(rest) || stripLegalFormTails(`X ${rest}`) !== `X ${rest}`) return null;
  const before = stripLegalFormTails(upper.slice(0, match.index).trim());
  const after = stripLegalFormTails(rest);
  if (before.length < 2 || after.length < 2 || after.split(' ').length > 3) return null;
  return { before, after };
}

/**
 * Núcleo del nombre español: el MISMO al cargar las fuentes y al buscar en la
 * corrida. Sin el paréntesis final, sin las formas societarias finales (apiladas)
 * y, si tras una forma viene un nombre corto, sólo la razón social.
 */
export function spainNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  const upper = plainUpperSpain(splitTrailingParen(name).head);
  const core = stripLegalFormTails(upper);
  // Un nombre que es SÓLO la forma («S.A.», «S.L.») no tiene núcleo.
  if (core.length === 0 || ES_LEGAL_FORMS_COMPACT.has(core.replace(/ /g, ''))) return '';
  return splitMiddleForm(core)?.before ?? core;
}

/** ¿Termina el texto en una forma societaria española? */
export function endsWithSpainLegalForm(name: string): boolean {
  const upper = plainUpperSpain(splitTrailingParen(name).head);
  return trailingFormWords(upper.split(' ')) > 0;
}

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y', 'EN', 'D', 'L', 'I']);

/** Entidades territoriales: el municipio, la provincia o la isla las identifica. */
const TERRITORIAL_ENTITY =
  /\b(AYUNTAMIENTO|AJUNTAMENT|CONCELLO|UDALA|DIPUTACION PROVINCIAL|DIPUTACION FORAL|DIPUTACIO|DIPUTACION|CABILDO INSULAR|CONSELL INSULAR|CONSELL COMARCAL|COMARCA)(?: DE| DEL| DE LA| DE LOS| DE LAS| D)? ([A-Z0-9][A-Z0-9 ]*)$/;

/**
 * Clave pública de una entidad territorial: «AYUNTAMIENTO <municipio>»,
 * «DIPUTACION <provincia>», «CABILDO <isla>»… aunque el nombre sea el de un órgano
 * suyo («Junta de Gobierno del Ayuntamiento de Cuenca», «Alcaldía del
 * Ayuntamiento de Getafe»). Sin palabras de enlace. `null` si no lo es.
 */
export function spainPublicEntityKey(name: string): string | null {
  const firstClause = name.split(/[,;]/)[0] ?? name;
  const upper = plainUpperSpain(splitTrailingParen(firstClause).head);
  const match = TERRITORIAL_ENTITY.exec(upper);
  if (match === null) return null;
  const kind = match[1]
    .replace(/^(AJUNTAMENT|CONCELLO|UDALA)$/, 'AYUNTAMIENTO')
    .replace(/^(DIPUTACION PROVINCIAL|DIPUTACION FORAL|DIPUTACIO)$/, 'DIPUTACION')
    .replace(/^(CABILDO INSULAR|CONSELL INSULAR)$/, 'CABILDO');
  const place = match[2]
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .join(' ');
  return place.length >= 2 ? `${kind} ${place}` : null;
}

/** Filas cuyos alias nunca se guardan (no son la entidad que nombran). */
const NO_ALIAS_NAME_START = /^(UTE|UNION TEMPORAL|FONDO DE|COMUNIDAD DE (BIENES|PROPIETARIOS|REGANTES)|SINDICATO|CLUB)\b/;

/** Lo que sigue a la forma y nombra una parte de la sociedad, no a la sociedad. */
const BRANCH_WORD = /^(DIVISION|SUCURSAL|PLANTA|DELEGACION|OFICINA|TIENDA|FILIAL|SOCIEDAD UNIPERSONAL|EN LIQUIDACION)\b/;

/** Palabras que nunca son sigla de UNA empresa. */
const GENERIC_ALIAS: ReadonlySet<string> = new Set([
  'ESPANA', 'SPAIN', 'ES', 'BANCO', 'SEGUROS', 'GRUPO', 'HOLDING', 'SERVICIOS', 'OPERADORA', 'SUCURSAL', 'UTE',
]);

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core) || GENERIC_ALIAS.has(core)) return;
  keys.push(core);
}

/** Una sigla o nombre comercial utilizable como alias (3+ letras, no sólo una forma). */
function aliasCore(text: string): string | null {
  const core = spainNameCore(text);
  if (core.length < 3 || !/[A-Z]/.test(core)) return null;
  return core;
}

/**
 * Claves EXTRA de una razón social (sin su núcleo de siempre): la sigla entre
 * paréntesis («AEMET»), lo que sigue a una forma en medio, las partes separadas
 * por « / » o «|», y la clave pública. Vacío para UTE, fondos y similares.
 */
export function spainRegistryAliasKeys(legalName: string): string[] {
  const mainCore = spainNameCore(legalName);
  const keys: string[] = [];
  if (NO_ALIAS_NAME_START.test(plainUpperSpain(legalName))) return keys;

  const { head, tag } = splitTrailingParen(legalName);
  if (tag !== null && spainNameCore(head) !== '') {
    const tagCore = aliasCore(tag);
    if (tagCore !== null) pushKey(keys, tagCore, mainCore);
  }

  const middle = splitMiddleForm(stripLegalFormTails(plainUpperSpain(head)));
  if (middle !== null && !BRANCH_WORD.test(middle.after)) pushKey(keys, middle.after, mainCore);

  const parts = legalName.split(/\s*\|\s*|\s+\/\s+/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1) {
    for (const part of parts) {
      const core = aliasCore(part);
      if (core !== null) pushKey(keys, core, mainCore);
    }
  }

  const publicKey = spainPublicEntityKey(legalName);
  if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type SpainNameVariant = {
  core: string;
  origin: 'name' | 'part' | 'without_spain' | 'with_spain' | 'public';
};

const SPAIN_SUFFIXES: readonly string[] = [' DE ESPANA', ' ESPANA', ' SPAIN', ' ESPANOLA', ' IBERICA', ' IBERIA'];
const WITH_SPAIN: readonly string[] = [' ESPANA', ' DE ESPANA', ' SPAIN'];

/** Núcleos que empiezan como entidad pública: no se les añade «España». */
const PUBLIC_START = /^(AYUNTAMIENTO|DIPUTACION|CABILDO|CONSEJERIA|MINISTERIO|UNIVERSIDAD|UNIVERSITAT|HOSPITAL|SERVICIO|AGENCIA|INSTITUTO|CONSORCIO|JUNTA|GOBIERNO|GENERALITAT|XUNTA|COMUNIDAD)\b/;

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function spainCandidateNameVariants(name: string | null | undefined): SpainNameVariant[] {
  const variants: SpainNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: SpainNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(spainNameCore(name), 'name');

  // «Vodafone | España», «Prosegur - Seguridad»: cada parte (la primera siempre).
  const parts = name
    .split(/\s+-\s+|\s*\|\s*|\s+\/\s+|:\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length > 1) {
    add(spainNameCore(parts[0]), 'part');
    for (const part of parts.slice(1)) if (endsWithSpainLegalForm(part)) add(spainNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    // Una palabra («Vodafone») también prueba con el país; el resolvedor la trata
    // como nombre de UNA palabra: sólo es fuerte si la web lo confirma.
    const suffix = variant.core.split(' ').length < 2 ? undefined : SPAIN_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined) {
      add(variant.core.slice(0, -suffix.length), 'without_spain');
      continue;
    }
    if (PUBLIC_START.test(variant.core)) continue;
    for (const s of WITH_SPAIN) add(`${variant.core}${s}`, 'with_spain');
  }
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_spain') continue;
    for (const s of WITH_SPAIN) add(`${variant.core}${s}`, 'with_spain');
  }

  const ordered: SpainNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = spainPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
