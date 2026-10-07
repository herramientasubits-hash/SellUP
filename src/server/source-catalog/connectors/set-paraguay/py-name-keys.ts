/**
 * py-name-keys.ts — núcleo, alias y variantes del nombre de Paraguay para el RUC
 * por nombre.
 *
 * SOURCES-PY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué hace falta (medido el 06-10-2026 sobre las 97.727 sociedades del
 *    padrón y 128 empresas y entidades paraguayas reales) ────────────────────
 *
 * Con la lista exacta de formas de #509 sólo 59 de 128 encontraban su RUC:
 *
 *   1. La forma societaria se escribe de muchas maneras y la lista no la veía:
 *      «E.A.S.» y «E.A.S. UNIPERSONAL» (25.324 filas, el 26 % del padrón),
 *      «SA EMISORA DE CAPITAL ABIERTO» (Banco Continental), «S.A.E.C.A» sin punto
 *      final, «SOCIEDAD ANONIMA EMISORA», «S.A.C.I.», «SOCIEDAD RESPONSABILIDAD
 *      LIMITADA» sin «DE», «LTDA.» de las cooperativas. Se reconoce por su
 *      ESTRUCTURA y sólo al final, como en México (#597).
 *   2. El padrón guarda la sigla tras la razón social: «… SA (COPACO SA)»,
 *      «ADMINISTRACION NACIONAL DE ELECTRICIDAD - ANDE», «(TELECEL SAE)». El
 *      paréntesis final sale del núcleo; la sigla y cada parte son ALIAS.
 *   3. Las entidades públicas se escriben distinto en cada sitio: «GOBIERNO
 *      DEPARTAMENTAL DE ITAPUA», «GOBERNACION DEPARTAMENTO CENTRAL» y «Gobernación de
 *      Central»; «MUNICIPALIDAD DE LA CIUDAD DE ASUNCION» y «Municipalidad de
 *      Asunción». La clave pública las lleva a la misma forma en los DOS lados.
 *   4. «Unilever Paraguay» es UNILEVER DE PARAGUAY SA: el candidato prueba también
 *      con y sin «de/del Paraguay».
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 *
 * ── Alias que NO se guardan ─────────────────────────────────────────────────
 *
 * Fideicomisos, sindicatos, asociaciones y mutuales de funcionarios, consorcios,
 * comités, clubes y consejos: «FIDEICOMISO DE GARANTIA … - BANCO ATLAS S.A.» haría
 * que «Banco Atlas» apuntara al fideicomiso (hay miles). Y un alias nunca puede ser
 * el nombre propio de otra sociedad (`dropAliasKeysOwnedByOthers`, igual que Perú).
 */

/** Trabajadores mínimos para que un nombre de UNA palabra dé un RUC fuerte. */
export const PY_SINGLE_WORD_MIN_WORKERS = 50;

/**
 * Formas societarias paraguayas como secuencias de palabras ya normalizadas, más
 * largas primero. Una forma sólo se quita al FINAL y como palabras propias.
 */
const PY_LEGAL_FORM_TAILS: readonly string[] = [
  // Sociedad anónima emisora de capital abierto, en todas sus escrituras.
  'SOCIEDAD ANONIMA EMISORA DE CAPITAL ABIERTO',
  'S A EMISORA DE CAPITAL ABIERTO',
  'SA EMISORA DE CAPITAL ABIERTO',
  'EMISORA DE CAPITAL ABIERTO',
  'SOCIEDAD ANONIMA EMISORA',
  'S A EMISORA',
  'SA EMISORA',
  'S A E C A',
  'S A E CA',
  'SA E C A',
  'S AECA',
  'SAECA',
  // Empresa por acciones simplificada (Ley 6480/2020), con o sin «unipersonal».
  'EMPRESA POR ACCIONES SIMPLIFICADA UNIPERSONAL',
  'EMPRESA POR ACCIONES SIMPLIFICADA',
  'E A S UNIPERSONAL',
  'EAS UNIPERSONAL',
  'E A S U',
  'E A S',
  'EAS',
  // Responsabilidad limitada.
  'EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD RESPONSABILIDAD LIMITADA',
  'E I R L',
  'EIRL',
  'S R L',
  'SRL',
  'LIMITADA',
  'LIMITED',
  'LTDA',
  // Anónima comercial e industrial y similares (sólo la sigla, nunca las palabras).
  'S A C I',
  'S A I C',
  'SACI',
  'SAIC',
  'S A C',
  'S A I',
  'S A E',
  'SAE',
  'SOCIEDAD ANONIMA',
  'S A',
  'SA',
  // Sucursal de una sociedad extranjera.
  'SUCURSAL EN PARAGUAY',
  'SUCURSAL DEL PARAGUAY',
  'SUCURSAL PARAGUAY',
  'SUCURSAL',
];

/** Mayúsculas, sin tildes, sólo letras/dígitos/& y espacios simples. */
export function plainUpperParaguay(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita formas societarias del final (apiladas: «S.A. EMISORA S.A.E.»). */
function stripLegalFormTails(upper: string): string {
  let core = upper;
  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    for (const form of PY_LEGAL_FORM_TAILS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/** Quita un paréntesis FINAL («… SA (COPACO SA)») si queda algo delante. */
function withoutTrailingParenthesis(name: string): string {
  const match = /^(.*\S)\s*\(([^()]*)\)?\s*\.?\s*$/.exec(name.trim());
  if (match === null) return name;
  return plainUpperParaguay(match[1]).length >= 2 ? match[1] : name;
}

/**
 * Núcleo del nombre paraguayo: el MISMO al cargar el padrón y al buscar en la
 * corrida. Sin el paréntesis final y sin la forma societaria final.
 */
export function paraguayNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  return stripLegalFormTails(plainUpperParaguay(withoutTrailingParenthesis(name)));
}

/** ¿Termina el texto en una forma societaria paraguaya? */
export function endsWithParaguayLegalForm(name: string): boolean {
  const upper = plainUpperParaguay(withoutTrailingParenthesis(name));
  return stripLegalFormTails(upper) !== upper;
}

/**
 * Partes de un nombre separadas por « - », «|», «/», «>», «: » o «(»: la razón
 * social y su sigla, o el nombre y un resto de la web.
 */
export function splitParaguayNameParts(name: string): string[] {
  return name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|\s*>\s*|:\s+|\s*\(\s*/)
    .map((part) => part.replace(/\)\s*\.?\s*$/, '').trim())
    .filter((part) => part.length > 0);
}

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y']);

/**
 * Títulos abreviados en los nombres de distritos («GRAL.», «MCAL.», «TTE.»,
 * «PDTE.», «DR.», «FDO.»): en la clave pública se escriben siempre completos.
 */
const TITLE_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  GRAL: 'GENERAL',
  MCAL: 'MARISCAL',
  TTE: 'TENIENTE',
  PDTE: 'PRESIDENTE',
  PTE: 'PRESIDENTE',
  DR: 'DOCTOR',
  CNEL: 'CORONEL',
  CAP: 'CAPITAN',
  FDO: 'FERNANDO',
  STA: 'SANTA',
  STO: 'SANTO',
});

const PUBLIC_ENTITY_START =
  /^(MUNICIPALIDAD|GOBERNACION|GOBIERNO DEPARTAMENTAL|MINISTERIO|UNIVERSIDAD NACIONAL|HOSPITAL|INSTITUTO NACIONAL|INSTITUTO DE PREVISION|DIRECCION NACIONAL|DIRECCION GENERAL|SECRETARIA NACIONAL|SECRETARIA DE|SERVICIO NACIONAL|CONSEJO NACIONAL|COMISION NACIONAL|AGENCIA NACIONAL|CORTE SUPREMA|JUSTICIA ELECTORAL|CONTRALORIA|PROCURADURIA|ADMINISTRACION NACIONAL|ENTE REGULADOR|BANCO CENTRAL)\b/;

/** ¿Es el núcleo el de una entidad del Estado (municipalidad, ministerio, ANDE…)? */
export function isParaguayPublicEntityCore(core: string): boolean {
  return PUBLIC_ENTITY_START.test(core);
}

/**
 * Clave pública: para un núcleo que empieza como una entidad del Estado, una forma
 * común en los dos lados. `null` si el núcleo no es de una entidad pública.
 *
 *   GOBIERNO DEPARTAMENTAL DE ITAPUA / GOBERNACION DEL DEPARTAMENTO DE ITAPUA /
 *   Gobernación de Itapúa                      → GOBERNACION ITAPUA
 *   MUNICIPALIDAD DE LA CIUDAD DE ASUNCION / Municipalidad de Asunción
 *                                              → MUNICIPALIDAD ASUNCION
 *   MUNICIPALIDAD DE CIUDAD PDTE. FRANCO / Municipalidad de Presidente Franco
 *                                              → MUNICIPALIDAD PRESIDENTE FRANCO
 *   MINISTERIO DE SALUD PUBLICA Y BIENESTAR SOCIAL → MINISTERIO SALUD PUBLICA BIENESTAR SOCIAL
 */
export function paraguayPublicEntityKey(core: string): string | null {
  if (!PUBLIC_ENTITY_START.test(core)) return null;
  const unified = core
    .replace(/^GOBIERNO DEPARTAMENTAL\b/, 'GOBERNACION')
    .replace(/^GOBERNACION( DEL?)? DEPARTAMENTO\b/, 'GOBERNACION')
    // «Ciudad del Este» es el nombre de la ciudad: ese «CIUDAD» se queda.
    .replace(/^MUNICIPALIDAD(( DE)?( LA| EL| DEL)? (CIUDAD(?! DEL ESTE\b)|DISTRITO))+\b/, 'MUNICIPALIDAD');
  const key = unified
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .map((word) => TITLE_ABBREVIATIONS[word] ?? word)
    .join(' ');
  return key.split(' ').length >= 2 && key !== core ? key : null;
}

/** Filas del padrón cuyos alias nunca se guardan (no son la empresa que nombran). */
const NO_ALIAS_NAME_START =
  /^(FIDEICOMISO|FIDECOMISO|SINDICATO|SIND|CONSORCIO|MUTUAL|COMITE|CLUB|CONSEJO|SUB CONSEJO|ACE|CENTRO DE ESTUDIANTES|COOPERATIVA DE (FUNCIONARIOS|EMPLEADOS|TRABAJADORES|SERVIDORES)|ASOC|ASOCIACION( MUTUAL)? DE (FUNCIONARIOS|EMPLEADOS|TRABAJADORES|JUBILADOS|PENSIONADOS|EX|DOCENTES|PROFESIONALES|COOPERACION))\b/;

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core)) return;
  keys.push(core);
}

/**
 * Claves EXTRA de una razón social del padrón (sin su núcleo de siempre): la
 * sigla o el nombre de cada parte y la clave pública. Vacío para fideicomisos,
 * sindicatos, consorcios y similares.
 */
export function paraguayRegistryAliasKeys(legalName: string): string[] {
  const mainCore = paraguayNameCore(legalName);
  const keys: string[] = [];
  if (NO_ALIAS_NAME_START.test(plainUpperParaguay(legalName))) return keys;

  const cores = [mainCore];
  const parts = splitParaguayNameParts(legalName);
  if (parts.length > 1) {
    // La primera parte cuenta si es una razón social completa o una entidad pública;
    // las siguientes (siglas o nombre conocido) siempre: el padrón las puso ahí.
    const first = paraguayNameCore(parts[0]);
    if (endsWithParaguayLegalForm(parts[0]) || PUBLIC_ENTITY_START.test(first)) cores.push(first);
    for (const part of parts.slice(1)) cores.push(paraguayNameCore(part));
  }
  for (const core of cores) {
    pushKey(keys, core, mainCore);
    const publicKey = paraguayPublicEntityKey(core);
    if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  }
  return keys;
}

/** Los nombres PROPIOS de una sociedad del padrón: su núcleo y su clave pública. */
export function paraguayOwnNameKeys(mainCore: string): string[] {
  const keys = mainCore.length >= 2 ? [mainCore] : [];
  const publicKey = paraguayPublicEntityKey(mainCore);
  if (publicKey !== null) keys.push(publicKey);
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type ParaguayNameVariant = {
  core: string;
  origin: 'name' | 'web' | 'part' | 'without_paraguay' | 'with_paraguay' | 'public';
};

/** Restos de un dominio al final de un nombre armado desde la web. */
const WEB_TAIL = /(?:\s+(?:COM|EDU|ORG|GOV|GOB|NET|MIL|COOP))?\s+PY$|\s+COM$/;

const PARAGUAY_SUFFIXES: readonly string[] = [' DEL PARAGUAY', ' DE PARAGUAY', ' PARAGUAY'];

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function paraguayCandidateNameVariants(name: string | null | undefined): ParaguayNameVariant[] {
  const variants: ParaguayNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: ParaguayNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(paraguayNameCore(name), 'name');

  const beforeArrow = name.split(/\s*>\s*/)[0] ?? name;
  if (beforeArrow.includes('.')) {
    add(stripLegalFormTails(plainUpperParaguay(beforeArrow).replace(WEB_TAIL, '')), 'web');
  }

  const parts = splitParaguayNameParts(name);
  if (parts.length > 1) {
    add(paraguayNameCore(parts[0]), 'part');
    // Una parte posterior sólo si es una razón social completa, nunca un descriptor.
    for (const part of parts.slice(1)) if (endsWithParaguayLegalForm(part)) add(paraguayNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    if (variant.core.split(' ').length < 2 || WEB_TAIL.test(variant.core)) continue;
    const suffix = PARAGUAY_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined) {
      add(variant.core.slice(0, -suffix.length), 'without_paraguay');
      continue;
    }
    if (PUBLIC_ENTITY_START.test(variant.core)) continue;
    for (const s of PARAGUAY_SUFFIXES) add(`${variant.core}${s}`, 'with_paraguay');
  }
  // «Unilever Paraguay» → UNILEVER (sin) y UNILEVER DE PARAGUAY (con otro enlace).
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_paraguay') continue;
    for (const s of PARAGUAY_SUFFIXES) add(`${variant.core}${s}`, 'with_paraguay');
  }

  // La clave pública de cada variante va justo detrás de ella.
  const ordered: ParaguayNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = paraguayPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
