/**
 * ni-name-keys.ts — núcleo, alias y variantes del nombre de Nicaragua para el RUC
 * por nombre.
 *
 * SOURCES-NI-CLOSE-2. Puro: sin env, sin I/O, sin DB, sin reloj. Propio de
 * Nicaragua: no toca `normalizeCentralAmericaCore` ni `company-name-core.ts`
 * (acuerdo con el chat de El Salvador).
 *
 * ── Lo que hace falta (medido el 07-10-2026) ────────────────────────────────
 *
 *   1. La DGI corta la razón social a 50 caracteres: «CORPORACION ELECTRICA
 *      NICARAGUENSE, SOCIEDAD ANONI», «MANUFACTURERA CENTROAMERICANA DE SACOS,
 *      SOCIEDAD A». La forma cortada también se quita.
 *   2. La forma se escribe de muchas maneras y apilada: «S,A», «S.A.», «SOCIEDAD
 *      ANONIMA.», «Y COMPAÑIA LIMITADA», «Y CIA LTDA», «R.L.» (cooperativas),
 *      «COMPAÑIA COLECTIVA DE RESPONSABILIDAD LIMITADA», «SUCURSAL NICARAGUA».
 *   3. «CEMEX NICARAGUA S.A.» se busca como «Cemex» y «Tropigas de Nic» como
 *      «Tropigas»: el candidato prueba con y sin «Nicaragua» (y con «NIC», la
 *      abreviatura de la DGI).
 *   4. La sigla o la marca va entre paréntesis o tras un guion final («… S.A. -
 *      MUNDOTEX», «HOLCIM (NICARAGUA)»): sale del núcleo y queda como alias.
 *   5. «Alcaldía de Managua» = «Alcaldía Municipal de Managua»: la clave pública
 *      los une.
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

/** Mayúsculas, sin tildes, sólo letras/dígitos/&, «&» pegado y espacios simples. */
export function plainUpperNicaragua(name: string): string {
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

/** Formas societarias como palabras ya normalizadas, más largas primero; sólo al FINAL. */
const NI_LEGAL_FORM_TAILS: readonly string[] = [
  'COMPANIA COLECTIVA DE RESPONSABILIDAD LIMITADA',
  'CIA COLECTIVA DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD COLECTIVA',
  'SOCIEDAD ANONIMA',
  'Y COMPANIA LIMITADA',
  'Y CIA LIMITADA',
  'Y COMPANIA LTDA',
  'Y CIA LTDA',
  'COMPANIA LIMITADA',
  'CIA LTDA',
  'INCORPORATED',
  'CORPORATION',
  'S DE R L',
  'S DE RL',
  'S A DE C V',
  'S A DE CV',
  'DE C V',
  'LIMITADA',
  'LIMITED',
  'LTDA',
  'LTD',
  'CCRL',
  'L L C',
  'LLC',
  'INC',
  'CORP',
  'GMBH',
  'S P A',
  'SPA',
  'S R L',
  'SRL',
  'R L',
  'RL',
  'S A',
  'SA',
  'Y COMPANIA',
  'Y CIA',
  'SUCURSAL EN NICARAGUA',
  'SUCURSAL DE NICARAGUA',
  'SUCURSAL NICARAGUA',
  'SUC NICARAGUA',
  'SUC NIC',
  'SUCURSAL',
];

/** «SOCIEDAD ANÓNIMA» cortada a 50 caracteres o con erratas («SOCIEDAD ANONI», «SOCIEDAD A», «SOC ANONIMA», «ANON1M»). */
const ANONIMA_CUT_TAIL = /\s(?:SOCIEDAD|SOCIEDA|SOC)(?:\s(?:AN[A-Z0-9]{0,6}|A))?$/;

function stripLegalFormTails(upper: string): string {
  let core = upper;
  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    // «KIMBERLY CLARK NICARAGUA & COMPAÑÍA LIMITADA»: el «&» queda pegado.
    const ampersand = /&(?:COMPANIA|CIA)$/.exec(core);
    if (ampersand !== null && ampersand.index > 0) {
      core = core.slice(0, ampersand.index).trim();
      stripped = true;
      continue;
    }
    const cut = ANONIMA_CUT_TAIL.exec(core);
    if (cut !== null && cut.index > 0) {
      core = core.slice(0, cut.index).trim();
      stripped = true;
      continue;
    }
    for (const form of NI_LEGAL_FORM_TAILS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/** Sigla final entre paréntesis (cerrado o no) o tras un guion: «… (ADC)», «… - MUNDOTEX», «… -TANISA». */
const TRAILING_TAG = /^(.*\S)\s*(?:\(\s*([^()]{2,80}?)\s*\)?|\s-\s*([^-()]{2,40})|\s*-\s*([A-Z0-9][A-Z0-9 .&]{1,30}))\s*\.?\s*$/;

function splitTrailingTag(name: string): { head: string; tag: string | null } {
  const match = TRAILING_TAG.exec(name.trim());
  if (match === null) return { head: name, tag: null };
  const head = match[1];
  const tag = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  return plainUpperNicaragua(head).length >= 2 && tag.length > 0 ? { head, tag } : { head: name, tag: null };
}

/** Quita la sigla o el paréntesis final (hasta dos) y la forma suelta que les sigue. */
function withoutTrailingTags(name: string): string {
  let current = name;
  for (let i = 0; i < 2; i++) {
    const trimmed = current.replace(/\)\s*,?\s*(S\.?\s*A\.?|SOCIEDAD AN[ÓO]NIMA)\s*\.?\s*$/i, ')');
    const { head, tag } = splitTrailingTag(trimmed);
    if (tag === null) break;
    current = head;
  }
  return current;
}

/**
 * Núcleo del nombre nicaragüense: el MISMO al cargar las fuentes y al buscar en la
 * corrida. Sin la sigla final y sin la forma societaria final (también cortada).
 */
export function nicaraguaNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  const core = stripLegalFormTails(plainUpperNicaragua(withoutTrailingTags(name)));
  if (NI_LEGAL_FORM_TAILS.includes(core) || stripLegalFormTails(`X ${core}`) === 'X') return '';
  return core;
}

/** ¿Termina el texto en una forma societaria nicaragüense? */
export function endsWithNicaraguaLegalForm(name: string): boolean {
  const upper = plainUpperNicaragua(splitTrailingTag(name).head);
  return stripLegalFormTails(upper) !== upper;
}

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y', 'PARA']);

const PUBLIC_ENTITY_START =
  /^(ALCALDIA|MUNICIPIO|GOBIERNO REGIONAL|CONSEJO REGIONAL|MINISTERIO|INSTITUTO NICARAGUENSE|INSTITUTO NACIONAL|INSTITUTO DE (PROTECCION|LA VIVIENDA)|EMPRESA NICARAGUENSE|EMPRESA NACIONAL|EMPRESA PORTUARIA NACIONAL|BANCO CENTRAL DE NICARAGUA|BANCO DE FOMENTO|SUPERINTENDENCIA|CONTRALORIA|PROCURADURIA|COMISION NACIONAL|CONSEJO SUPREMO ELECTORAL|CONSEJO NICARAGUENSE|ASAMBLEA NACIONAL|PODER JUDICIAL|CORTE SUPREMA|POLICIA NACIONAL|DIRECCION GENERAL|AUTORIDAD NACIONAL|AGENCIA NICARAGUENSE|FONDO DE|UNIDAD DE ANALISIS FINANCIERO|TRIBUNAL|CORREOS DE NICARAGUA|CORPORACION(ES)? (NACIONAL|MUNICIPAL)|SISTEMA NACIONAL|UNIVERSIDAD NACIONAL|TECNOLOGICO NACIONAL)\b/;

/** ¿Es el núcleo el de una entidad del Estado? */
export function isNicaraguaPublicEntityCore(core: string): boolean {
  return PUBLIC_ENTITY_START.test(core);
}

/**
 * Clave pública: sin palabras de enlace y sin «MUNICIPAL»; «MUNICIPIO DE X» =
 * «ALCALDÍA DE X». `null` si no es una entidad pública.
 *
 *   Alcaldía Municipal de Managua / ALCALDIA DE MANAGUA → ALCALDIA MANAGUA
 *   MINISTERIO DE SALUD → MINISTERIO SALUD
 */
export function nicaraguaPublicEntityKey(name: string): string | null {
  const core = nicaraguaNameCore(name);
  if (!PUBLIC_ENTITY_START.test(core)) return null;
  const key = core
    .replace(/^MUNICIPIO( DEL?)? /, 'ALCALDIA DE ')
    .replace(/^ALCALDIA MUNICIPAL /, 'ALCALDIA ')
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .join(' ');
  return key.split(' ').length >= 2 ? key : null;
}

/** Filas cuyos alias nunca se guardan (no son la entidad que nombran). */
const NO_ALIAS_NAME_START = /^(CONSORCIO|ASOCIACION MOMENTANEA|ASOC SOLIDARISTA|ASOCIACION SOLIDARISTA|FIDEICOMISO|SINDICATO)\b/;

/** Lo que nunca es un alias: el país, una forma suelta o una palabra de relleno. */
const NOT_AN_ALIAS = /^(NICARAGUA|NIC|REPUBLICA DE NICARAGUA|S A|SA|CIA LTDA|LTDA|INC|SUCURSAL|SUC NIC)$/;

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 3 || core === exclude || keys.includes(core) || NOT_AN_ALIAS.test(core)) return;
  keys.push(core);
}

/**
 * Claves EXTRA de una razón social (sin su núcleo de siempre): la sigla o marca del
 * paréntesis o del guion final, y la clave pública. Vacío para consorcios,
 * asociaciones momentáneas y similares.
 */
export function nicaraguaRegistryAliasKeys(legalName: string): string[] {
  const mainCore = nicaraguaNameCore(legalName);
  const keys: string[] = [];
  if (mainCore.length === 0 || NO_ALIAS_NAME_START.test(plainUpperNicaragua(legalName))) return keys;
  const { tag } = splitTrailingTag(legalName.replace(/\)\s*,?\s*(S\.?\s*A\.?|SOCIEDAD AN[ÓO]NIMA)\s*\.?\s*$/i, ')'));
  if (tag !== null) {
    const tagCore = nicaraguaNameCore(tag);
    if (/[A-Z]/.test(tagCore)) pushKey(keys, tagCore, mainCore);
  }
  const publicKey = nicaraguaPublicEntityKey(legalName);
  if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  return keys;
}

/** ¿Es este nombre de una entidad que no admite alias (consorcio, asociación momentánea…)? */
export function isNicaraguaNoAliasName(name: string): boolean {
  return NO_ALIAS_NAME_START.test(plainUpperNicaragua(name));
}

/** Una variante del nombre del candidato y de dónde sale. */
export type NicaraguaNameVariant = {
  core: string;
  origin: 'name' | 'part' | 'without_nicaragua' | 'with_nicaragua' | 'public';
};

const NICARAGUA_SUFFIXES: readonly string[] = [' DE NICARAGUA', ' NICARAGUA', ' DE NIC', ' NIC'];

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function nicaraguaCandidateNameVariants(name: string | null | undefined): NicaraguaNameVariant[] {
  const variants: NicaraguaNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: NicaraguaNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(nicaraguaNameCore(name), 'name');

  // «Banpro | Grupo Promerica», «Claro - Nicaragua»: la primera parte y las que
  // terminan en forma societaria.
  const parts = name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|:\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length > 1) {
    add(nicaraguaNameCore(parts[0]), 'part');
    for (const part of parts.slice(1)) if (endsWithNicaraguaLegalForm(part)) add(nicaraguaNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    // «Universidad Nacional de Nicaragua», «Banco Central de Nicaragua»: el país es parte del nombre.
    if (PUBLIC_ENTITY_START.test(variant.core)) continue;
    const suffix =
      variant.core.split(' ').length < 2 ? undefined : NICARAGUA_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined) {
      add(variant.core.slice(0, -suffix.length), 'without_nicaragua');
      continue;
    }
    // Una palabra («Cemex» → CEMEX NICARAGUA) también prueba con el país; el
    // resolvedor la sigue tratando como nombre de UNA palabra.
    add(`${variant.core} NICARAGUA`, 'with_nicaragua');
    add(`${variant.core} DE NICARAGUA`, 'with_nicaragua');
  }
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_nicaragua') continue;
    add(`${variant.core} NICARAGUA`, 'with_nicaragua');
    add(`${variant.core} DE NICARAGUA`, 'with_nicaragua');
  }

  // La clave pública de cada variante va justo detrás de ella.
  const ordered: NicaraguaNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = nicaraguaPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
