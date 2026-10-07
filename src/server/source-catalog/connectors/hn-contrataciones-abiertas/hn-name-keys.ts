/**
 * hn-name-keys.ts — núcleo, alias y variantes del nombre de Honduras para el RTN por
 * nombre.
 *
 * SOURCES-HN-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué hace falta (medido el 07-10-2026 en Prod) ────────────────────────
 *
 * Con la lista exacta de formas centroamericanas (`normalizeHondurasCompanyCore`,
 * que sigue intacta porque Guatemala y Panamá fijan su resultado) 1.418 de los
 * 6.195 núcleos de `hn_ocds_rtn_registry` (23 %) conservaban la forma societaria:
 * «PUBLICITY S DE RL», «INVERSIONES PM S DE RL DE CV», «SUPLIDORA DEL NORTE SA DE
 * CV». Un nombre de Apollo o Tavily sin forma («Publicity») nunca los encontraba.
 *
 *   1. La forma se reconoce por su ESTRUCTURA, sin espacios ni puntos: «S. de R.L.»,
 *      «S DE RL», «S.DE R.L», «SRL», «S.A. de C.V.», «SA DE CV», «S.U. DE R.L.»,
 *      «SOCIEDAD ANÓNIMA DE CAPITAL VARIABLE», «Y CÍA.», «COMERCIANTE INDIVIDUAL»…
 *      y también cortada al final («… S DE RL DE C», «… S.A. D»): HonduCompras y
 *      SIAFI cortan los nombres largos.
 *   2. «… DE HOND» es «… DE HONDURAS» cortado.
 *   3. La sigla va entre paréntesis o tras la forma: «… (HONDUTEL)», «ENERGIA
 *      RENOVABLE S A DE C V (ENERSA)», «BANCO DE AMERICA CENTRAL HONDURAS S A BAC
 *      BAMER»: sale del núcleo y es un ALIAS.
 *   4. «Lácteos de Honduras S.A. División Sula Centro»: la razón social es lo que
 *      va antes de la forma.
 *   5. «Nestlé Honduras» es NESTLE HONDUREÑA: el candidato prueba con y sin «(de)
 *      Honduras» y con «Hondureña».
 *   6. «Alcaldía Municipal de San Pedro Sula» = «Municipalidad de San Pedro Sula»
 *      = ALCALDIA SAN PEDRO SULA; «Secretaría de Estado en el Despacho de Salud» =
 *      SECRETARIA SALUD.
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

import { cleanHondurasSupplierName } from './hn-ocds-rtn-registry-rows';

/** Mayúsculas, sin tildes, sólo letras/dígitos/&, «&» pegado y espacios simples. */
export function plainUpperHonduras(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // «TRUJILLO'S» → TRUJILLOS: el apóstrofo no separa palabras.
    .replace(/['’´`]/g, '')
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s*&\s*/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\bCENTRO AMERICA/g, 'CENTROAMERICA')
    .trim();
}

/**
 * Formas societarias SIN espacios (la estructura, no la escritura). Se comparan con
 * las últimas palabras del nombre pegadas: «S DE R L», «S DE RL» y «SDERL» son lo
 * mismo.
 */
const HN_LEGAL_FORMS_COMPACT: ReadonlySet<string> = new Set([
  'SOCIEDADANONIMADECAPITALVARIABLE',
  'SOCIEDADDERESPONSABILIDADLIMITADADECAPITALVARIABLE',
  'SOCIEDADDERESPONSABILIDADLIMITADA',
  'SOCIEDADANONIMADECV',
  'SOCIEDADANONIMA',
  'SOCIEDADCOLECTIVA',
  'SOCIEDADENCOMANDITASIMPLE',
  'SOCIEDADENCOMANDITAPORACCIONES',
  'SOCIEDADENCOMANDITA',
  'SOCIEDADUNIPERSONALDERESPONSABILIDADLIMITADA',
  'DERESPONSABILIDADLIMITADA',
  'DECAPITALVARIABLE',
  'COMERCIANTEINDIVIDUAL',
  'SDERLDECV',
  'SRLDECV',
  'SUDERLDECV',
  'SUDERL',
  'SADECV',
  'SDERL',
  'DECV',
  'SRL',
  'SAS',
  'SA',
  'LIMITADA',
  'LTDA',
  'INC',
  'LLC',
  'LTD',
  'CORP',
  'SAU',
  'SL',
  'YCIA',
  'YCOMPANIA',
  '&CIA',
  '&COMPANIA',
  'SUCURSALHONDURAS',
  'SUCURSALENHONDURAS',
  'SUCURSALDEHONDURAS',
]);

/**
 * Restos de una forma CORTADA al final del texto (SIAFI y HonduCompras cortan los
 * nombres largos): sólo valen si el corte deja claro que era una forma.
 */
const HN_TRUNCATED_FORMS_COMPACT: ReadonlySet<string> = new Set([
  'SDERLDEC',
  'SDERLDE',
  'SDERLD',
  'SDER',
  'SADEC',
  'SADE',
  'SAD',
  'SOCIEDADANONIMADECAPITAL',
  'SOCIEDADANONIMADE',
  'SOCIEDADDERESPONSABILIDAD',
]);

/** Cuántas palabras finales mira como mucho una forma (la más larga tiene 8). */
const MAX_FORM_WORDS = 8;

/** Una forma completa o cortada que ocupa las últimas `k` palabras, o 0. */
function trailingFormWords(words: readonly string[], allowTruncated: boolean): number {
  for (let k = Math.min(MAX_FORM_WORDS, words.length - 1); k >= 1; k--) {
    const compact = words.slice(words.length - k).join('');
    if (HN_LEGAL_FORMS_COMPACT.has(compact)) return k;
    if (allowTruncated && HN_TRUNCATED_FORMS_COMPACT.has(compact)) return k;
  }
  return 0;
}

/** Quita formas societarias del final (apiladas: «Y CIA S DE RL DE CV»). */
function stripLegalFormTails(upper: string): string {
  let words = upper.split(' ').filter((w) => w.length > 0);
  let first = true;
  for (;;) {
    // Sólo la PRIMERA forma (la última del texto) puede venir cortada.
    const k = trailingFormWords(words, first);
    if (k === 0) break;
    words = words.slice(0, words.length - k);
    first = false;
  }
  return words.join(' ');
}

/** «… DE HOND», «… DE HONDU»: «HONDURAS» cortado. */
function expandTruncatedHonduras(core: string): string {
  const match = /^(.+ DE) (HON[A-Z]{1,4})$/.exec(core);
  if (match === null || match[2] === 'HONDURAS' || !'HONDURAS'.startsWith(match[2]) || match[2].length < 4) return core;
  return `${match[1]} HONDURAS`;
}

/** Paréntesis final: «… (HONDUTEL)», «… (I.P.M.)», «… (DICOMA S. DE R.L.)». */
const TRAILING_PAREN = /^(.*\S)\s*\(\s*([^()]{2,80}?)\s*\)?\s*\.?\s*$/;

function splitTrailingParen(name: string): { head: string; tag: string | null } {
  const match = TRAILING_PAREN.exec(name.trim());
  if (match === null) return { head: name, tag: null };
  return plainUpperHonduras(match[1]).length >= 2 ? { head: match[1], tag: match[2].trim() || null } : { head: name, tag: null };
}

/**
 * Forma FUERTE en medio del nombre seguida de un nombre comercial o una división
 * corta (hasta 3 palabras): «LACTEOS DE HONDURAS S A DIVISION SULA CENTRO»,
 * «BANCO DE AMERICA CENTRAL HONDURAS S A BAC BAMER».
 */
const MIDDLE_FORM = /\s(?:SOCIEDAD ANONIMA(?: DE CAPITAL VARIABLE)?|S A DE C V|SA DE CV|S DE R ?L(?: DE C ?V)?|S A)\s(?=[A-Z0-9&])/;

function splitMiddleForm(upper: string): { before: string; after: string } | null {
  const match = MIDDLE_FORM.exec(upper);
  if (match === null || match.index === 0) return null;
  const rest = upper.slice(match.index + match[0].length).trim();
  if (/^(DE|DEL|EN)\b/.test(rest) || stripLegalFormTails(`X ${rest}`) !== `X ${rest}`) return null;
  const before = stripLegalFormTails(upper.slice(0, match.index).trim());
  const after = stripLegalFormTails(rest);
  if (before.length < 2 || after.length < 2 || after.split(' ').length > 3) return null;
  return { before, after };
}

/**
 * Núcleo del nombre hondureño: el MISMO al cargar las fuentes y al buscar en la
 * corrida. Sin las colas de HonduCompras («*MIPYME*», «* Compra Menor»), sin el
 * paréntesis final, sin la forma societaria final (completa o cortada), con
 * «DE HOND» completado y, si tras una forma viene un nombre corto, sólo la razón
 * social.
 */
export function hondurasNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  const cleaned = cleanHondurasSupplierName(name);
  const upper = plainUpperHonduras(splitTrailingParen(cleaned).head);
  const core = stripLegalFormTails(upper);
  // Un nombre que es SÓLO la forma («S.A.», «S. DE R.L.») no tiene núcleo.
  if (core.length === 0 || HN_LEGAL_FORMS_COMPACT.has(core.replace(/ /g, ''))) return '';
  return expandTruncatedHonduras(splitMiddleForm(core)?.before ?? core);
}

/** ¿Termina el texto en una forma societaria (completa) hondureña? */
export function endsWithHondurasLegalForm(name: string): boolean {
  const upper = plainUpperHonduras(splitTrailingParen(cleanHondurasSupplierName(name)).head);
  return trailingFormWords(upper.split(' '), false) > 0;
}

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y', 'EN']);

const PUBLIC_ENTITY_START =
  /^(ALCALDIA|MUNICIPALIDAD|CORPORACION MUNICIPAL|SECRETARIA|UNIVERSIDAD NACIONAL|UNIVERSIDAD PEDAGOGICA|UNIVERSIDAD NACIONAL DE AGRICULTURA|UNIVERSIDAD DE DEFENSA|HOSPITAL (ESCUELA|GENERAL|NACIONAL|REGIONAL|DE AREA|MATERNO|PSIQUIATRICO|SAN FELIPE|MARIO|ATLANTIDA|DEL SUR|SANTA TERESA|LEONARDO MARTINEZ|ROBERTO SUAZO)|INSTITUTO (HONDURENO|NACIONAL|DE LA PROPIEDAD|DE PREVISION|DE CONSERVACION|DE FORMACION PROFESIONAL|DE ACCESO)|EMPRESA NACIONAL|EMPRESA HONDURENA DE TELECOMUNICACIONES|BANCO CENTRAL DE HONDURAS|BANCO NACIONAL DE DESARROLLO|BANCO HONDURENO PARA LA PRODUCCION|COMISION NACIONAL|COMISION PERMANENTE|SERVICIO AUTONOMO|SUPERINTENDENCIA|TRIBUNAL|CORTE SUPREMA|CONGRESO NACIONAL|PODER JUDICIAL|MINISTERIO PUBLICO|PROCURADURIA|REGISTRO NACIONAL|DIRECCION (EJECUTIVA|GENERAL|NACIONAL|DE CIENCIA)|AGENCIA (HONDURENA|DE REGULACION|DE REGULACION SANITARIA)|FONDO (HONDURENO|VIAL|SOCIAL)|CUERPO DE BOMBEROS|HEROICO Y BENEMERITO CUERPO|PATRONATO NACIONAL|PRESIDENCIA DE LA REPUBLICA|CONSEJO NACIONAL|ADMINISTRACION ADUANERA|SERVICIO DE ADMINISTRACION DE RENTAS|INSTITUTO DE PREVISION MILITAR)\b/;

/** ¿Es el núcleo el de una entidad del Estado (alcaldía, secretaría, ENEE…)? */
export function isHondurasPublicEntityCore(core: string): boolean {
  return PUBLIC_ENTITY_START.test(core);
}

/**
 * Clave pública: alcaldía/municipalidad/corporación municipal → «ALCALDIA <municipio>»
 * (sin el departamento tras la coma); secretaría → sin «de Estado en el(los)
 * Despacho(s) de»; todas sin palabras de enlace ni «de Honduras» final. `null` si
 * no es una entidad pública.
 *
 *   Alcaldía Municipal de San Pedro Sula / Municipalidad de San Pedro Sula → ALCALDIA SAN PEDRO SULA
 *   Secretaría de Estado en el Despacho de Salud / Secretaría de Salud → SECRETARIA SALUD
 */
export function hondurasPublicEntityKey(name: string): string | null {
  const firstClause = name.split(',')[0] ?? name;
  let core = hondurasNameCore(firstClause);
  if (!PUBLIC_ENTITY_START.test(core)) return null;
  core = core
    .replace(/^(?:ALCALDIA(?: MUNICIPAL)?|MUNICIPALIDAD|CORPORACION MUNICIPAL)(?: DEL? MUNICIPIO)?\b/, 'ALCALDIA')
    .replace(/^SECRETARIA DE ESTADO(?: EN (?:EL|LOS) DESPACHOS?)?(?: DE(?:L| LA| LAS| LOS)?)?\b/, 'SECRETARIA')
    .replace(/ DE HONDURAS$/, '')
    .replace(/ HONDURAS$/, '');
  const key = core
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .join(' ');
  return key.split(' ').length >= 2 ? key : null;
}

/** Filas cuyos alias nunca se guardan (no son la entidad que nombran). */
const NO_ALIAS_NAME_START = /^(FIDEICOMISO|SINDICATO|CONSORCIO|COMITE|CLUB|PATRONATO PRO|ASOCIACION DE VECINOS|FONDO DE PRESTACIONES)\b/;

/** Lo que sigue a la forma y nombra una parte de la sociedad, no a la sociedad. */
const BRANCH_WORD = /^(DIVISION|SUCURSAL|PLANTA|AGENCIA|TIENDA|OFICINA|REGIONAL|FILIAL)\b/;

/** Palabras que nunca son sigla de UNA empresa. */
const GENERIC_ALIAS: ReadonlySet<string> = new Set([
  'HONDURAS', 'HN', 'BANCO', 'SEGUROS', 'GRUPO', 'INVERSIONES', 'COMPRA MENOR', 'MIPYME', 'SUCURSAL',
]);

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core) || GENERIC_ALIAS.has(core)) return;
  keys.push(core);
}

/** Una sigla o nombre comercial utilizable como alias (3+ letras, no sólo una forma). */
function aliasCore(text: string): string | null {
  const core = hondurasNameCore(text);
  if (core.length < 3 || !/[A-Z]/.test(core)) return null;
  return core;
}

/**
 * Claves EXTRA de una razón social (sin su núcleo de siempre): la sigla entre
 * paréntesis («HONDUTEL», «ENERSA»), lo que sigue a una forma en medio («BAC
 * BAMER»), las partes separadas por « / » o «|», y la clave pública. Vacío para
 * fideicomisos, sindicatos, consorcios y similares.
 */
export function hondurasRegistryAliasKeys(legalName: string): string[] {
  const cleaned = cleanHondurasSupplierName(legalName);
  const mainCore = hondurasNameCore(cleaned);
  const keys: string[] = [];
  if (NO_ALIAS_NAME_START.test(plainUpperHonduras(cleaned))) return keys;

  const { head, tag } = splitTrailingParen(cleaned);
  if (tag !== null && hondurasNameCore(head) !== '') {
    const tagCore = aliasCore(tag);
    if (tagCore !== null) pushKey(keys, tagCore, mainCore);
  }

  // Una división, planta o sucursal tras la forma no es otro nombre de la sociedad.
  const middle = splitMiddleForm(stripLegalFormTails(plainUpperHonduras(head)));
  if (middle !== null && !BRANCH_WORD.test(middle.after)) pushKey(keys, middle.after, mainCore);

  // «EMPRESA NACIONAL DE TRANSPORTES UNIDOS … / ENTRAUNO S. DE R.L. DE C.V.»,
  // «Banco Financiera Comercial Hondureña S.A./Banco Ficohsa» (sin espacios).
  const parts = cleaned.split(/\s*\|\s*|\s*\/\s*/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1) {
    for (const part of parts) {
      const core = aliasCore(part);
      if (core !== null) pushKey(keys, core, mainCore);
    }
  }

  const publicKey = hondurasPublicEntityKey(cleaned);
  if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type HondurasNameVariant = {
  core: string;
  origin: 'name' | 'part' | 'without_honduras' | 'with_honduras' | 'public';
};

const HONDURAS_SUFFIXES: readonly string[] = [' DE HONDURAS', ' HONDURAS', ' HONDURENA', ' HONDURENO', ' HN'];
const WITH_HONDURAS: readonly string[] = [' DE HONDURAS', ' HONDURAS', ' HONDURENA'];

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function hondurasCandidateNameVariants(name: string | null | undefined): HondurasNameVariant[] {
  const variants: HondurasNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: HondurasNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(hondurasNameCore(name), 'name');

  // «Banco Atlántida | Honduras», «Tigo - Telefónica Celular»: cada parte.
  const parts = name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|:\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length > 1) {
    add(hondurasNameCore(parts[0]), 'part');
    for (const part of parts.slice(1)) if (endsWithHondurasLegalForm(part)) add(hondurasNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    // Una palabra («Lacthosa») también prueba con el país; el resolvedor la trata
    // como nombre de UNA palabra: sólo es fuerte si la web lo confirma.
    const suffix = variant.core.split(' ').length < 2 ? undefined : HONDURAS_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined) {
      add(variant.core.slice(0, -suffix.length), 'without_honduras');
      continue;
    }
    if (PUBLIC_ENTITY_START.test(variant.core)) continue;
    for (const s of WITH_HONDURAS) add(`${variant.core}${s}`, 'with_honduras');
  }
  // «Nestlé Honduras» → NESTLE (sin) y NESTLE HONDURENA / NESTLE DE HONDURAS (con el otro enlace).
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_honduras') continue;
    for (const s of WITH_HONDURAS) add(`${variant.core}${s}`, 'with_honduras');
  }

  // La clave pública de cada variante va justo detrás de ella.
  const ordered: HondurasNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = hondurasPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
