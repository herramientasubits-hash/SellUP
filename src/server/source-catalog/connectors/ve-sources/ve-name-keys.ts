/**
 * ve-name-keys.ts — núcleo, alias y variantes del nombre de Venezuela para el RIF
 * por nombre.
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj. Propio de
 * Venezuela: no toca `company-name-core.ts` ni la limpieza de otros países.
 *
 * ── Lo que hace falta (medido el 13-10-2026 en la Bolsa de Caracas, la SUDEASEG,
 *    la SUNAVAL y GLEIF) ─────────────────────────────────────────────────────
 *
 *   1. La forma va al final y, a menudo, seguida de lo que la empresa ES: «BANCO
 *      NACIONAL DE CREDITO, C.A. BANCO UNIVERSAL», «MARSH VENEZUELA C.A., SOCIEDAD
 *      DE CORRETAJE DE SEGUROS», «MAPFRE LA SEGURIDAD C.A. DE SEGUROS». El núcleo es
 *      lo que va ANTES de la primera forma societaria.
 *   2. La forma también va al principio: «C.A. RON SANTA TERESA», «C.A. DE SEGUROS
 *      LA OCCIDENTAL», «C.N.A. DE SEGUROS LA PREVISORA».
 *   3. Formas propias: C.A., S.A., S.A.C.A., S.A.I.C.A., SACA, S.R.L., S.C.A.,
 *      COMPAÑÍA ANÓNIMA, SOCIEDAD ANÓNIMA (DE CAPITAL AUTORIZADO).
 *   4. La sigla o el nombre anterior va entre paréntesis: «(COBECA)», «(GENICA)»,
 *      «(ANT. VENCEMOS)», «(ANTES PLANSANITAS)». La sigla queda como alias; el nombre
 *      anterior, no (hoy es de nadie o de otra).
 *   5. «Cemex» se busca como CEMEX VENEZUELA y «Banco de Venezuela» no pierde el
 *      país: el candidato prueba con y sin «Venezuela» salvo en nombres públicos.
 *   6. «Alcaldía del Municipio Chacao» = «Alcaldía de Chacao»; «Ministerio del Poder
 *      Popular para la Salud» = «Ministerio de Salud»: la clave pública los une.
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

/** Mayúsculas, sin tildes, sólo letras/dígitos/&, «&» pegado y espacios simples. */
export function plainUpperVenezuela(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/['’´`]/g, '')
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s*&\s*/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formas societarias (ya normalizadas), más largas primero. El núcleo termina en la
 * PRIMERA que aparece después de al menos una palabra.
 */
const VE_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD ANONIMA DE CAPITAL AUTORIZADO',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'COMPANIA ANONIMA',
  'SOCIEDAD ANONIMA',
  'SOCIEDAD EN COMANDITA POR ACCIONES',
  'S A I C A S A C A',
  'S A I C A',
  'S A C A',
  'S A I C',
  'C N A',
  'S R L',
  'S C A',
  'S C',
  'R L',
  'C A',
  'S A',
  'SAICA',
  'SACA',
  'SAIC',
  'SRL',
  'SCA',
  'RL',
  'CA',
  'SA',
  'C POR A',
  'LIMITED',
  'LIMITADA',
  'LTDA',
  'LTD',
  'INCORPORATED',
  'INC',
  'LLC',
  'CORP',
  'GMBH',
  'SUCURSAL VENEZUELA',
  'SUCURSAL EN VENEZUELA',
  'SUCURSAL DE VENEZUELA',
];

/** Forma al principio del nombre («C.A. RON SANTA TERESA», «C.N.A. DE SEGUROS…»). */
const LEADING_FORM = /^(?:COMPANIA ANONIMA|SOCIEDAD ANONIMA|C N A|C A|CA|S A|SA|S C)\s+(?:DE\s+)?/;

/**
 * Lo que la empresa ES, pegado al final sin forma societaria («BANCAMIGA BANCO
 * UNIVERSAL»): sale del núcleo si delante queda al menos una palabra.
 */
const TRAILING_DESCRIPTOR =
  /\s(?:BANCO UNIVERSAL|BANCO MICROFINANCIERO|BANCO COMERCIAL|BANCO DE DESARROLLO|ENTIDAD DE AHORRO Y PRESTAMO|CASA DE BOLSA|SOCIEDAD DE CORRETAJE DE SEGUROS|SOCIEDAD DE CORRETAJE DE REASEGUROS)$/;

/** Estado escrito delante o detrás del nombre («(SUSPENDIDA) INTERFIN…», «… EN LIQUIDACION»). */
const STATUS_WORDS = /^(?:SUSPENDIDA|SUSPENDIDO|INTERVENIDA|EN LIQUIDACION|LIQUIDADA|REVOCADA|COPIA)\s+|\s+(?:EN LIQUIDACION|EN PROCESO DE LIQUIDACION)$/;

/** Paréntesis (cerrado o no) con su contenido, en cualquier parte del nombre. */
const PARENTHESIS = /\(\s*([^()]{1,80}?)\s*(?:\)|$)/g;

/**
 * Paréntesis que no es otro nombre de la empresa: el nombre anterior, su estado o
 * una nota de la fuente («(ANTES ASISTENSI)», «(SUSPENDIDA)», «(copia)», «(PYMES)»).
 */
const NOT_A_NAME_TAG =
  /^(?:ANT|ANTES|ANTERIORMENTE|ANTIGUA|ANTIGUO|EX|SUSPENDID[OA]|INTERVENID[OA]|EN LIQUIDACION|LIQUIDAD[OA]|REVOCAD[OA]|COPIA|PYMES?|SOCIEDAD EN PROMOCION)\b/;

/** «CORPORACION DIGITEL» también se busca como «DIGITEL». */
const LEADING_HOLDING_WORD = /^(?:CORPORACION|CORP)\s+(?=\S)/;

/** Quita los paréntesis y devuelve el texto y lo que había dentro. */
function splitParentheses(name: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const text = name.replace(PARENTHESIS, (_, inner: string) => {
    tags.push(inner);
    return ' ';
  });
  return { text, tags };
}

/** Posición (en palabras) de la primera forma societaria después de la primera palabra, o -1. */
function firstLegalFormIndex(words: readonly string[]): number {
  for (let i = 1; i < words.length; i++) {
    for (const form of VE_LEGAL_FORMS) {
      const formWords = form.split(' ');
      if (formWords.every((word, k) => words[i + k] === word)) return i;
    }
  }
  return -1;
}

function coreFromPlain(upper: string): string {
  let core = upper.replace(STATUS_WORDS, ' ').trim();
  for (let i = 0; i < 2; i++) {
    const lead = LEADING_FORM.exec(core);
    if (lead === null || lead[0].length >= core.length) break;
    core = core.slice(lead[0].length).trim();
  }
  const words = core.split(' ').filter((w) => w.length > 0);
  const cut = firstLegalFormIndex(words);
  core = (cut === -1 ? words : words.slice(0, cut)).join(' ');
  for (let i = 0; i < 2; i++) {
    const tail = TRAILING_DESCRIPTOR.exec(core);
    if (tail === null) break;
    core = core.slice(0, tail.index).trim();
  }
  return VE_LEGAL_FORMS.includes(core) ? '' : core;
}

/**
 * Núcleo del nombre venezolano: el MISMO al cargar las fuentes y al buscar en la
 * corrida. Sin paréntesis, sin estado y sin la forma societaria (ni lo que la sigue).
 */
export function venezuelaNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  return coreFromPlain(plainUpperVenezuela(splitParentheses(name).text));
}

/** ¿Lleva el nombre una forma societaria venezolana (al principio o tras la primera palabra)? */
export function hasVenezuelaLegalForm(name: string): boolean {
  const upper = plainUpperVenezuela(splitParentheses(name).text);
  return LEADING_FORM.test(upper) || firstLegalFormIndex(upper.split(' ')) !== -1;
}

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y', 'PARA', 'EN']);

const PUBLIC_ENTITY_START =
  /^(ALCALDIA|MUNICIPIO|GOBERNACION|CONSEJO LEGISLATIVO|MINISTERIO|VICEPRESIDENCIA|PRESIDENCIA|INSTITUTO NACIONAL|INSTITUTO VENEZOLANO|INSTITUTO AUTONOMO|INSTITUTO DE PREVISION|SUPERINTENDENCIA|CONTRALORIA|PROCURADURIA|FISCALIA|DEFENSORIA|MINISTERIO PUBLICO|ASAMBLEA NACIONAL|TRIBUNAL SUPREMO|CONSEJO NACIONAL ELECTORAL|SERVICIO NACIONAL|SERVICIO AUTONOMO|SERVICIO ADMINISTRATIVO|CORPORACION VENEZOLANA|CORPORACION NACIONAL|CORPORACION ELECTRICA NACIONAL|COMPANIA ANONIMA NACIONAL|PETROLEOS DE VENEZUELA|BANCO CENTRAL DE VENEZUELA|FONDO DE|FUNDACION|UNIVERSIDAD NACIONAL|UNIVERSIDAD BOLIVARIANA|UNIVERSIDAD CENTRAL DE VENEZUELA|UNIVERSIDAD DE LOS ANDES|UNIVERSIDAD DEL ZULIA|UNIVERSIDAD DE CARABOBO|UNIVERSIDAD DE ORIENTE|UNIVERSIDAD SIMON BOLIVAR|UNIVERSIDAD PEDAGOGICA|UNIVERSIDAD POLITECNICA|UNIVERSIDAD EXPERIMENTAL|HOSPITAL|POLICIA|GUARDIA NACIONAL|FUERZA ARMADA|DIRECCION GENERAL|OFICINA NACIONAL|AUTORIDAD UNICA|COMISION NACIONAL|SISTEMA NACIONAL|DISTRITO CAPITAL)\b/;

/** ¿Es el núcleo el de una entidad del Estado? */
export function isVenezuelaPublicEntityCore(core: string): boolean {
  return PUBLIC_ENTITY_START.test(core);
}

/**
 * Clave pública: sin palabras de enlace, sin «PODER POPULAR», «BOLIVARIANO/A»,
 * «MUNICIPAL» ni «ESTADO»/«MUNICIPIO» tras la alcaldía o la gobernación. `null` si
 * no es una entidad pública.
 *
 *   Alcaldía del Municipio Chacao / ALCALDIA DE CHACAO → ALCALDIA CHACAO
 *   Gobernación Bolivariana del Estado Miranda → GOBERNACION MIRANDA
 *   Ministerio del Poder Popular para la Salud → MINISTERIO SALUD
 */
export function venezuelaPublicEntityKey(name: string): string | null {
  const core = venezuelaNameCore(name);
  if (!PUBLIC_ENTITY_START.test(core)) return null;
  const key = core
    .replace(/^MUNICIPIO( DEL?)? /, 'ALCALDIA DE ')
    .replace(/\bPODER POPULAR\b/g, ' ')
    .replace(/\bBOLIVARIAN[OA]\b/g, ' ')
    .replace(/^(ALCALDIA|GOBERNACION)( MUNICIPAL)?( DEL?)?( (MUNICIPIO|ESTADO))? /, '$1 ')
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .join(' ');
  return key.split(' ').length >= 2 ? key : null;
}

/** Lo que nunca es un alias: el país, una forma suelta, un estado o un nombre anterior. */
const NOT_AN_ALIAS = /^(VENEZUELA|VZLA|REPUBLICA BOLIVARIANA DE VENEZUELA|C A|S A|SACA|S A C A|SRL|INC|SUCURSAL|BANCO|SEGUROS|BANCO UNIVERSAL|EN LIQUIDACION)$/;

/** Nombres cuyos alias no se guardan (no son la entidad que nombran). */
const NO_ALIAS_NAME_START = /^(CONSORCIO|FIDEICOMISO|SINDICATO|ASOCIACION CIVIL DE TRABAJADORES)\b/;

/** ¿Es este nombre de una entidad que no admite alias? */
export function isVenezuelaNoAliasName(name: string): boolean {
  return NO_ALIAS_NAME_START.test(plainUpperVenezuela(name));
}

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 3 || core === exclude || keys.includes(core) || NOT_AN_ALIAS.test(core)) return;
  keys.push(core);
}

/**
 * Claves EXTRA de una razón social (sin su núcleo de siempre): la sigla del
 * paréntesis (nunca un nombre anterior), la versión sin «VENEZUELA» final y la clave
 * pública. Vacío para consorcios y similares.
 */
export function venezuelaRegistryAliasKeys(legalName: string): string[] {
  const mainCore = venezuelaNameCore(legalName);
  const keys: string[] = [];
  if (mainCore.length === 0 || isVenezuelaNoAliasName(legalName)) return keys;
  for (const tag of splitParentheses(legalName).tags) {
    const plainTag = plainUpperVenezuela(tag);
    if (NOT_A_NAME_TAG.test(plainTag)) continue;
    const tagCore = coreFromPlain(plainTag);
    if (/[A-Z]/.test(tagCore)) pushKey(keys, tagCore, mainCore);
  }
  const withoutHolding = mainCore.replace(LEADING_HOLDING_WORD, '');
  if (withoutHolding !== mainCore && !isVenezuelaPublicEntityCore(mainCore)) pushKey(keys, withoutHolding, mainCore);
  const publicKey = venezuelaPublicEntityKey(legalName);
  if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type VenezuelaNameVariant = {
  core: string;
  origin: 'name' | 'part' | 'without_venezuela' | 'with_venezuela' | 'public';
};

const VENEZUELA_SUFFIXES: readonly string[] = [' DE VENEZUELA', ' VENEZUELA', ' DE VZLA', ' VZLA'];

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function venezuelaCandidateNameVariants(name: string | null | undefined): VenezuelaNameVariant[] {
  const variants: VenezuelaNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: VenezuelaNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(venezuelaNameCore(name), 'name');

  // «Banesco | Banco Universal», «Digitel - Venezuela»: la primera parte y las que
  // llevan forma societaria.
  const parts = name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|:\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length > 1) {
    add(venezuelaNameCore(parts[0]), 'part');
    for (const part of parts.slice(1)) if (hasVenezuelaLegalForm(part)) add(venezuelaNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    // «Banco de Venezuela», «Universidad Central de Venezuela»: el país es parte del nombre.
    if (PUBLIC_ENTITY_START.test(variant.core) || variant.core.startsWith('BANCO ')) continue;
    const suffix =
      variant.core.split(' ').length < 2 ? undefined : VENEZUELA_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined) {
      add(variant.core.slice(0, -suffix.length), 'without_venezuela');
      continue;
    }
    // Una o varias palabras («Cemex» → CEMEX VENEZUELA) también prueban con el país.
    add(`${variant.core} VENEZUELA`, 'with_venezuela');
    add(`${variant.core} DE VENEZUELA`, 'with_venezuela');
  }

  // La clave pública de cada variante va justo detrás de ella.
  const ordered: VenezuelaNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = venezuelaPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
