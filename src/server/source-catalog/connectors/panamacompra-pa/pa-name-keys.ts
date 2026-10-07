/**
 * pa-name-keys.ts — núcleo, alias y variantes del nombre de Panamá para el RUC por
 * nombre.
 *
 * SOURCES-PA-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué hace falta (medido el 07-10-2026) ────────────────────────────────
 *
 * Con la lista exacta de formas (`normalizePanamaCompanyCore`, que sigue intacta
 * porque comparte `CENTRAL_AMERICA_LEGAL_FORMS` con Guatemala y Honduras), unas
 * 240 de las 6.700 proveedoras cargadas quedaban con «S A» y la sigla pegadas en
 * medio del núcleo y no coincidían nunca:
 *
 *   1. «COMPAÑÍA PANAMEÑA DE AVIACIÓN, S. A.(COPA AIRLINES»: la sigla o el nombre
 *      comercial va entre paréntesis (a veces sin cerrar) tras la razón social. Sale
 *      del núcleo y queda como ALIAS.
 *   2. «SERVICIOS Y SOLUCIONES TECNOLOGICAS, S.A SERVITEC», «… INC PDCI»: el nombre
 *      comercial corto sigue a la forma. Núcleo = la razón social; alias = el nombre.
 *   3. La forma se escribe de muchas maneras («S.-A.», «S..A.», «S. DE R.L.»,
 *      «SOCIEDAD ANONIMA», «SOCIEDA ANONIMA», «INCORPORATED», «CORP.», «LTD») y
 *      apilada («COCHEZ Y CIA, S.A.»). Se reconoce por su ESTRUCTURA y sólo al final,
 *      como en México (#597) y Guatemala (#627).
 *   4. «Sonda Panamá» es SONDA, S.A.; «DIGICEL (PANAMA) S.A.» es Digicel Panamá: el
 *      candidato prueba con y sin «Panamá».
 *   5. «Alcaldía de San Miguelito» es el MUNICIPIO DE SAN MIGUELITO: la clave pública
 *      los une. Un nombre público con dos RUC queda como pista.
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

/** Mayúsculas, sin tildes, sólo letras/dígitos/&, «&» pegado y espacios simples. */
export function plainUpperPanama(name: string): string {
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
 * Formas societarias como secuencias de palabras ya normalizadas, más largas
 * primero. Una forma sólo se quita al FINAL y como palabras propias.
 */
const PA_LEGAL_FORM_TAILS: readonly string[] = [
  'FUNDACION DE INTERES PRIVADO',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD RESPONSABILIDAD LIMITADA',
  'SOCIEDAD EN COMANDITA POR ACCIONES',
  'SOCIEDAD EN COMANDITA SIMPLE',
  'SOCIEDAD EN COMANDITA',
  'SOCIEDAD COLECTIVA',
  'SOCIEDAD EXTRANJERA',
  'SOCIEDAD ANONIMA',
  'INCORPORATED',
  'CORPORATION',
  'S DE R L',
  'S DE RL',
  'S EN C',
  'LIMITADA',
  'LIMITED',
  'LTDA',
  'LTD',
  'L L C',
  'LLC',
  'INC',
  'CORP',
  'GMBH',
  'PLC',
  'S A S',
  'SAS',
  'S R L',
  'SRL',
  'B V',
  'BV',
  'N V',
  'AG',
  'S L',
  'S A',
  'SA',
  'F I P',
  'FIP',
  // «Y COMPAÑÍA»: parte de la razón social, no del nombre por el que se la conoce.
  'Y COMPANIA',
  'Y CIA',
  '&CIA',
  '&COMPANIA',
  // Sucursal de una sociedad extranjera.
  'SUCURSAL EN PANAMA',
  'SUCURSAL DE PANAMA',
  'SUCURSAL PANAMA',
  'SUCURSAL',
];

/** «SOCIEDAD ANÓNIMA» con erratas o con la Ó perdida («SOCIEDA ANOMINA», «AN NIMA»). */
const ANONIMA_TYPO_TAIL = /\s(?:SOCIEDAD|SOCIEDA|SOC)\s(?:AN[A-Z]{1,5}A|AN NIMA)$/;

/** Quita formas societarias del final (apiladas: «Y CÍA, S.A.»). */
function stripLegalFormTails(upper: string): string {
  let core = upper;
  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    const typo = ANONIMA_TYPO_TAIL.exec(core);
    if (typo !== null && typo.index > 0) {
      core = core.slice(0, typo.index).trim();
      stripped = true;
      continue;
    }
    for (const form of PA_LEGAL_FORM_TAILS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/** Sigla final entre guiones o paréntesis (cerrado o no): «… (ADC)», «… -INFOM-», «…(COPA AIRLINES». */
const TRAILING_TAG = /^(.*\S)\s*(?:-\s*([^-()]{2,60}?)\s*-|\(\s*([^()]{2,80}?)\s*\)?)\s*\.?\s*$/;

/** Quita la sigla o el paréntesis FINAL si queda algo delante. */
function splitTrailingTag(name: string): { head: string; tag: string | null } {
  const match = TRAILING_TAG.exec(name.trim());
  if (match === null) return { head: name, tag: null };
  const head = match[1];
  const tag = (match[2] ?? match[3] ?? '').trim();
  return plainUpperPanama(head).length >= 2 ? { head, tag: tag.length > 0 ? tag : null } : { head: name, tag: null };
}

/** Quita la sigla o el paréntesis final (hasta dos: «… S.A. (DAISOL) S.A.»). */
function withoutTrailingTags(name: string): string {
  let current = name;
  for (let i = 0; i < 2; i++) {
    const { head, tag } = splitTrailingTag(stripTrailingFormText(current));
    if (tag === null) break;
    current = head;
  }
  return current;
}

/** «DISTRIBUIDORA ISOL, S.A. (DAISOL) S.A.»: una forma suelta tras el paréntesis final. */
function stripTrailingFormText(name: string): string {
  const match = /^(.*\))\s*,?\s*(.*)$/.exec(name.trim());
  if (match === null) return name;
  const rest = plainUpperPanama(match[2]);
  return rest.length === 0 || PA_LEGAL_FORM_TAILS.includes(rest) ? match[1] : name;
}

/** Separador de una forma societaria FUERTE en medio, seguida de un nombre comercial. */
const MIDDLE_FORM = /\s(?:SOCIEDAD ANONIMA|S DE R L|S A|INC|CORP)\s(?=[A-Z0-9&])/;

/**
 * «SERVICIOS Y SOLUCIONES TECNOLOGICAS, S.A SERVITEC»: la razón social delante de
 * la forma y un nombre comercial corto (hasta 3 palabras) detrás. `null` si lo de
 * detrás es otra forma, un enlace («DE», «EN») o un nombre largo.
 */
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
 * Núcleo del nombre panameño: el MISMO al cargar las fuentes y al buscar en la
 * corrida. Sin la sigla final, sin la forma societaria final y, si tras la forma
 * viene un nombre comercial corto, sólo la razón social.
 */
export function panamaNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  const core = stripLegalFormTails(plainUpperPanama(withoutTrailingTags(name)));
  // Un nombre que es SÓLO la forma («S.A.», «SOCIEDAD ANÓNIMA») no tiene núcleo.
  if (PA_LEGAL_FORM_TAILS.includes(core) || stripLegalFormTails(`X ${core}`) === 'X') return '';
  return splitMiddleForm(core)?.before ?? core;
}

/** ¿Termina el texto en una forma societaria panameña? */
export function endsWithPanamaLegalForm(name: string): boolean {
  const upper = plainUpperPanama(splitTrailingTag(name).head);
  return stripLegalFormTails(upper) !== upper;
}

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y']);

const PUBLIC_ENTITY_START =
  /^(MUNICIPIO|ALCALDIA|CONSEJO MUNICIPAL|CONCEJO MUNICIPAL|JUNTA COMUNAL|MINISTERIO|AUTORIDAD|CAJA DE SEGURO SOCIAL|CAJA DE AHORROS|BANCO NACIONAL DE PANAMA|BANCO DE DESARROLLO AGROPECUARIO|INSTITUTO (NACIONAL|PANAMENO|DE ACUEDUCTOS|DE MERCADEO|DE INVESTIGACION|CONMEMORATIVO|ONCOLOGICO|PARA LA FORMACION|DE SEGURO|DE METEOROLOGIA|TECNICO SUPERIOR)|UNIVERSIDAD (DE PANAMA|TECNOLOGICA DE PANAMA|AUTONOMA DE CHIRIQUI|ESPECIALIZADA DE LAS AMERICAS|MARITIMA INTERNACIONAL DE PANAMA|DE LAS ARTES|AUTONOMA DE LOS PUEBLOS)|HOSPITAL (SANTO TOMAS|DEL NINO|NACIONAL|REGIONAL|GENERAL)|CONTRALORIA|PROCURADURIA|DEFENSORIA|ORGANO (JUDICIAL|EJECUTIVO)|ASAMBLEA NACIONAL|TRIBUNAL|SUPERINTENDENCIA|SECRETARIA|DIRECCION GENERAL|EMPRESA DE TRANSMISION ELECTRICA|EMPRESA NACIONAL|LOTERIA NACIONAL|ZONA LIBRE DE COLON|AEROPUERTO INTERNACIONAL DE TOCUMEN|METRO DE PANAMA|BENEMERITO CUERPO DE BOMBEROS|PRESIDENCIA|VICEPRESIDENCIA|FONDO (DE|NACIONAL))\b/;

/** ¿Es el núcleo el de una entidad del Estado (municipio, ministerio, autoridad…)? */
export function isPanamaPublicEntityCore(core: string): boolean {
  return PUBLIC_ENTITY_START.test(core);
}

/**
 * Clave pública: sin palabras de enlace, y «ALCALDÍA (MUNICIPAL) DE X» = «MUNICIPIO
 * DE X». `null` si no es una entidad pública.
 *
 *   MUNICIPIO DE SAN MIGUELITO / Alcaldía de San Miguelito → MUNICIPIO SAN MIGUELITO
 *   MINISTERIO DE SALUD → MINISTERIO SALUD
 */
export function panamaPublicEntityKey(name: string): string | null {
  const core = panamaNameCore(name);
  if (!PUBLIC_ENTITY_START.test(core)) return null;
  const key = core
    .replace(/^ALCALDIA( MUNICIPAL)?( DEL?)? (DISTRITO( DE)? )?/, 'MUNICIPIO DE ')
    .replace(/^MUNICIPIO( DEL?)? DISTRITO( DE)? /, 'MUNICIPIO DE ')
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .join(' ');
  return key.split(' ').length >= 2 ? key : null;
}

/** Filas cuyos alias nunca se guardan (no son la entidad que nombran). */
const NO_ALIAS_NAME_START =
  /^(FIDEICOMISO|SINDICATO|CONSORCIO|ASOCIACION ACCIDENTAL|COMITE|CLUB|ASOCIACION SOLIDARISTA|COOPERATIVA DE (EMPLEADOS|TRABAJADORES))\b/;

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core)) return;
  keys.push(core);
}

/** ¿Es la sigla sólo un país o una lengua («PANAMA», «ESPAÑOL», «INGLES»)? */
const NOT_AN_ALIAS = /^(PANAMA|REPUBLICA DE PANAMA|ESPANOL|INGLES|ENGLISH|SPANISH)$/;

/**
 * Claves EXTRA de una razón social (sin su núcleo de siempre): la sigla o el nombre
 * comercial del paréntesis final («ADC», «COPA AIRLINES»), el nombre comercial que
 * sigue a la forma («… S.A SERVITEC»), cada parte separada por «/» o «|», y la clave
 * pública. Vacío para fideicomisos, consorcios, sindicatos y similares.
 */
export function panamaRegistryAliasKeys(legalName: string): string[] {
  const mainCore = panamaNameCore(legalName);
  const keys: string[] = [];
  if (mainCore.length === 0 || NO_ALIAS_NAME_START.test(plainUpperPanama(legalName))) return keys;

  const { head, tag } = splitTrailingTag(stripTrailingFormText(legalName));
  if (tag !== null) {
    const tagCore = panamaNameCore(tag);
    if (tagCore.length >= 3 && /[A-Z]/.test(tagCore) && panamaNameCore(head) !== '' && !NOT_AN_ALIAS.test(tagCore)) {
      pushKey(keys, tagCore, mainCore);
    }
  }

  const middle = splitMiddleForm(stripLegalFormTails(plainUpperPanama(withoutTrailingTags(legalName))));
  if (middle !== null && !/\b(ESPANOL|INGLES)\b/.test(middle.after)) pushKey(keys, middle.after, mainCore);

  const parts = legalName.split(/\s*\|\s*|\s+\/\s+/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1) for (const part of parts) pushKey(keys, panamaNameCore(part), mainCore);

  const publicKey = panamaPublicEntityKey(legalName);
  if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type PanamaNameVariant = {
  core: string;
  origin: 'name' | 'part' | 'without_panama' | 'with_panama' | 'public';
};

const PANAMA_SUFFIXES: readonly string[] = [' DE PANAMA', ' PANAMA', ' PA'];

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function panamaCandidateNameVariants(name: string | null | undefined): PanamaNameVariant[] {
  const variants: PanamaNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: PanamaNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(panamaNameCore(name), 'name');

  // «Banco General | Panamá», «Más Móvil - Cable & Wireless»: cada parte.
  const parts = name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|:\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length > 1) {
    add(panamaNameCore(parts[0]), 'part');
    for (const part of parts.slice(1)) if (endsWithPanamaLegalForm(part)) add(panamaNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    // «Municipio de Panamá», «Universidad de Panamá»: el país es parte del nombre.
    if (PUBLIC_ENTITY_START.test(variant.core)) continue;
    // Una palabra («Sonda» → SONDA PANAMA) también prueba con el país; el resolvedor
    // la sigue tratando como nombre de UNA palabra (pista salvo que la web la confirme).
    const suffix = variant.core.split(' ').length < 2 ? undefined : PANAMA_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined) {
      add(variant.core.slice(0, -suffix.length), 'without_panama');
      continue;
    }
    add(`${variant.core} PANAMA`, 'with_panama');
    add(`${variant.core} DE PANAMA`, 'with_panama');
  }
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_panama') continue;
    add(`${variant.core} PANAMA`, 'with_panama');
    add(`${variant.core} DE PANAMA`, 'with_panama');
  }

  // La clave pública de cada variante va justo detrás de ella.
  const ordered: PanamaNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = panamaPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
