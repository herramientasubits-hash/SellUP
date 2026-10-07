/**
 * gt-name-keys.ts — núcleo, alias y variantes del nombre de Guatemala para el NIT
 * por nombre.
 *
 * SOURCES-GT-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué hace falta (medido el 06-10-2026) ────────────────────────────────
 *
 * Con la lista exacta de formas centroamericanas (`normalizeCentralAmericaCore`,
 * que sigue intacta para Honduras y Panamá) sólo 10 de 60 nombres reales de
 * empresas y entidades guatemaltecas, escritos como los escriben Apollo, Tavily o
 * Claude, encontraban su NIT. Además del problema de cobertura (que resuelven las
 * fuentes nuevas), fallaba la redacción:
 *
 *   1. La forma societaria se escribe de muchas maneras: «SOCIEDA ANÓNIMA»,
 *      «SOCIEDAD ANOMINA», «ANOMIMA», «AN NIMA» (la Ó perdida), «DE
 *      CAPITALVARIABLE», «SOCIEDAD EN COMANDITA POR ACCIONES», «COPROPIEDAD»,
 *      «SOCIEDAD EXTRANJERA», «SUCURSAL (DE) GUATEMALA», «GMBH», «LLC». Se
 *      reconoce por su ESTRUCTURA y sólo al final, como en México (#597).
 *   2. «Y COMPAÑÍA»: «COFIÑO STAHL Y COMPAÑÍA, S.A.» es Cofiño Stahl.
 *   3. «CENTRO AMÉRICA» / «CENTROAMÉRICA» y «G & T» / «G&T» se escriben de las dos
 *      maneras: se unifican en los DOS lados.
 *   4. La sigla va entre guiones o paréntesis tras la razón social («INSTITUTO DE
 *      FOMENTO MUNICIPAL -INFOM-», «… (ADESCA)»): sale del núcleo y es un ALIAS.
 *   5. «Banco Promerica Guatemala» es BANCO PROMERICA, S.A.; «Bimbo de
 *      Centroamérica» es BIMBO DE CENTRO AMERICA, S.A.: el candidato prueba con y
 *      sin «de Guatemala».
 *   6. Las municipalidades llevan el departamento detrás («MUNICIPALIDAD DE COBÁN,
 *      ALTA VERAPAZ»); la clave pública las deja como «MUNICIPALIDAD COBAN». Un
 *      municipio con el mismo nombre en dos departamentos queda como pista (dos NIT).
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

/** Mayúsculas, sin tildes, sólo letras/dígitos/&, «&» pegado y espacios simples. */
export function plainUpperGuatemala(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // «KERN'S» → KERNS: el apóstrofo no separa palabras.
    .replace(/['’´`]/g, '')
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s*&\s*/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\bCENTRO AMERICA/g, 'CENTROAMERICA')
    .trim();
}

/**
 * Formas societarias como secuencias de palabras ya normalizadas, más largas
 * primero. Una forma sólo se quita al FINAL y como palabras propias.
 */
const GT_LEGAL_FORM_TAILS: readonly string[] = [
  'SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
  'SOCIEDAD ANONIMA DE CAPITALVARIABLE',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA DE CAPITAL VARIABLE',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD RESPONSABILIDAD LIMITADA',
  'SOCIEDAD EN COMANDITA POR ACCIONES',
  'SOCIEDAD EN COMANDITA SIMPLE',
  'SOCIEDAD EN COMANDITA',
  'SOCIEDAD COLECTIVA',
  'SOCIEDAD EXTRANJERA',
  'LIMITADA DE CAPITAL VARIABLE',
  'ANONIMA DE CAPITAL VARIABLE',
  'S DE R L DE C V',
  'S A DE C V',
  'S DE R L',
  'S EN C POR A',
  'S EN C',
  'S C P A',
  'COPROPIEDAD',
  'LIMITADA',
  'LIMITED',
  'LTDA',
  'LTD',
  'L L C',
  'LLC',
  'INC',
  'GMBH',
  'S L P',
  'S L',
  'S R L',
  'SRL',
  'S A S',
  'SAS',
  'AG',
  'S A',
  'SA',
  // «Y COMPAÑÍA»: parte de la razón social, no del nombre por el que se la conoce.
  'Y COMPANIA',
  'Y CIA',
  '&CIA',
  '&COMPANIA',
  // Sucursal de una sociedad extranjera.
  'SUCURSAL EN GUATEMALA',
  'SUCURSAL DE GUATEMALA',
  'SUCURSAL DA GUATEMALA',
  'SUCURSAL GUATEMALA',
  'SUCURSAL',
];

/**
 * «SOCIEDAD ANÓNIMA» con erratas o con la Ó perdida: «SOCIEDA» o «SOCIEDAD» (o
 * «SOC»), seguida de una palabra que empieza por AN y termina en A, de 4 a 8
 * letras («ANONIMA», «ANOMINA», «ANOMIMA», «ANONINA»), o de «AN NIMA».
 */
const ANONIMA_TYPO_TAIL = /\s(?:SOCIEDAD|SOCIEDA|SOC)\s(?:AN[A-Z]{1,5}A|AN NIMA)$/;

/** Quita formas societarias del final (apiladas: «Y COMPAÑÍA, SOCIEDAD ANÓNIMA»). */
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
    for (const form of GT_LEGAL_FORM_TAILS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/** Sigla final entre guiones o paréntesis: «… -INFOM-», «… (ADESCA)», «… (SUCURSAL GUATEMALA)». */
const TRAILING_TAG = /^(.*\S)\s*(?:-\s*([^-()]{2,60}?)\s*-|\(\s*([^()]{2,80}?)\s*\)?)\s*\.?\s*$/;

/** Quita la sigla o el paréntesis FINAL si queda algo delante. */
function splitTrailingTag(name: string): { head: string; tag: string | null } {
  const match = TRAILING_TAG.exec(name.trim());
  if (match === null) return { head: name, tag: null };
  const head = match[1];
  const tag = (match[2] ?? match[3] ?? '').trim();
  return plainUpperGuatemala(head).length >= 2 ? { head, tag: tag.length > 0 ? tag : null } : { head: name, tag: null };
}

/** Separador de una forma societaria FUERTE en medio, seguida de un nombre comercial. */
const MIDDLE_FORM = /\s(?:SOCIEDAD ANONIMA|SOCIEDAD DE RESPONSABILIDAD LIMITADA|S A|LIMITADA)\s(?=[A-Z0-9&])/;

/**
 * «AEROVIAS DEL CONTINENTE AMERICANO, SOCIEDAD ANONIMA, AVIANCA»: la razón social
 * delante de la forma y un nombre comercial corto (hasta 3 palabras) detrás.
 * `null` si lo de detrás es otra forma («DE CAPITAL VARIABLE», «SUCURSAL
 * GUATEMALA») o un nombre largo.
 */
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

/** Quita la sigla o el paréntesis final (hasta dos: «… S.A. (SUCURSAL GUATEMALA)»). */
function withoutTrailingTags(name: string): string {
  let current = name;
  for (let i = 0; i < 2; i++) {
    const { head, tag } = splitTrailingTag(current);
    if (tag === null) break;
    current = head;
  }
  return current;
}

/**
 * Núcleo del nombre guatemalteco: el MISMO al cargar las fuentes y al buscar en la
 * corrida. Sin la sigla final, sin la forma societaria final y, si tras la forma
 * viene un nombre comercial corto, sólo la razón social.
 */
export function guatemalaNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  const core = stripLegalFormTails(plainUpperGuatemala(withoutTrailingTags(name)));
  // Un nombre que es SÓLO la forma («S.A.», «SOCIEDAD ANÓNIMA») no tiene núcleo.
  if (GT_LEGAL_FORM_TAILS.includes(core) || stripLegalFormTails(`X ${core}`) === 'X') return '';
  return splitMiddleForm(core)?.before ?? core;
}

/** ¿Termina el texto en una forma societaria guatemalteca? */
export function endsWithGuatemalaLegalForm(name: string): boolean {
  const upper = plainUpperGuatemala(splitTrailingTag(name).head);
  return stripLegalFormTails(upper) !== upper;
}

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y']);

const PUBLIC_ENTITY_START =
  /^(MUNICIPALIDAD|MINISTERIO|SECRETARIA|UNIVERSIDAD DE SAN CARLOS|HOSPITAL (GENERAL|NACIONAL|REGIONAL|ROOSEVELT|DE )|INSTITUTO (NACIONAL|GUATEMALTECO|DE FOMENTO|DE LA DEFENSA|DE PREVISION|TECNICO DE CAPACITACION)|SUPERINTENDENCIA|CONTRALORIA|PROCURADURIA|ORGANISMO JUDICIAL|CONGRESO DE LA REPUBLICA|TRIBUNAL SUPREMO|MINISTERIO PUBLICO|CONSEJO NACIONAL|COMISION NACIONAL|FONDO (DE|SOCIAL|NACIONAL)|EMPRESA PORTUARIA|EMPRESA MUNICIPAL|EMPRESA ELECTRICA MUNICIPAL|BANCO DE GUATEMALA|CREDITO HIPOTECARIO NACIONAL|REGISTRO (GENERAL|NACIONAL|DE LA PROPIEDAD)|DIRECCION GENERAL|AUTORIDAD (PARA|DEL)|GOBERNACION DEPARTAMENTAL|CORTE (SUPREMA|DE CONSTITUCIONALIDAD)|ZONA LIBRE)\b/;

/** ¿Es el núcleo el de una entidad del Estado (municipalidad, ministerio, INDE…)? */
export function isGuatemalaPublicEntityCore(core: string): boolean {
  return PUBLIC_ENTITY_START.test(core);
}

/**
 * Clave pública: para una MUNICIPALIDAD, sin palabras de enlace y sin el
 * departamento que Guatecompras escribe tras la coma; para el resto de entidades
 * públicas, sin palabras de enlace. `null` si no es una entidad pública.
 *
 *   MUNICIPALIDAD DE COBÁN, ALTA VERAPAZ / Municipalidad de Cobán → MUNICIPALIDAD COBAN
 *   MINISTERIO DE SALUD PÚBLICA Y ASISTENCIA SOCIAL → MINISTERIO SALUD PUBLICA ASISTENCIA SOCIAL
 */
export function guatemalaPublicEntityKey(name: string): string | null {
  const firstClause = name.split(',')[0] ?? name;
  const isMunicipality = /^\s*MUNICIPALIDAD\b/i.test(plainUpperGuatemala(name));
  const core = guatemalaNameCore(isMunicipality ? firstClause : name);
  if (!PUBLIC_ENTITY_START.test(core)) return null;
  const key = core
    .replace(/^MUNICIPALIDAD( DEL?)? MUNICIPIO\b/, 'MUNICIPALIDAD')
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .join(' ');
  return key.split(' ').length >= 2 ? key : null;
}

/** Filas cuyos alias nunca se guardan (no son la entidad que nombran). */
const NO_ALIAS_NAME_START =
  /^(FIDEICOMISO|SINDICATO|CONSORCIO|COMITE|CLUB|ASOCIACION SOLIDARISTA|COOPERATIVA DE (EMPLEADOS|TRABAJADORES))\b/;

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core)) return;
  keys.push(core);
}

/**
 * Claves EXTRA de una razón social (sin su núcleo de siempre): la sigla final
 * («INFOM», «ADESCA»), el nombre comercial que sigue a la forma («… SOCIEDAD
 * ANÓNIMA, AVIANCA»), la razón social sin ese nombre, y la clave pública. Vacío
 * para fideicomisos, sindicatos, consorcios y similares.
 */
export function guatemalaRegistryAliasKeys(legalName: string): string[] {
  const mainCore = guatemalaNameCore(legalName);
  const keys: string[] = [];
  if (NO_ALIAS_NAME_START.test(plainUpperGuatemala(legalName))) return keys;

  const { head, tag } = splitTrailingTag(legalName);
  // Una sigla de una palabra con letras (no «SUCURSAL GUATEMALA», que es una forma).
  if (tag !== null) {
    const tagCore = guatemalaNameCore(tag);
    if (tagCore.length >= 3 && /[A-Z]/.test(tagCore) && guatemalaNameCore(head) !== '' && stripLegalFormTails(`X ${tagCore}`) === `X ${tagCore}`) {
      pushKey(keys, tagCore, mainCore);
    }
  }

  const middle = splitMiddleForm(stripLegalFormTails(plainUpperGuatemala(withoutTrailingTags(legalName))));
  if (middle !== null) pushKey(keys, middle.after, mainCore);

  // «MAPFRE | SEGUROS GUATEMALA, S.A.»: cada parte separada por «|» o « / » es un
  // nombre con el que se conoce a la misma sociedad.
  const parts = legalName.split(/\s*\|\s*|\s+\/\s+/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1) for (const part of parts) pushKey(keys, guatemalaNameCore(part), mainCore);

  const publicKey = guatemalaPublicEntityKey(legalName);
  if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type GuatemalaNameVariant = {
  core: string;
  origin: 'name' | 'part' | 'without_guatemala' | 'with_guatemala' | 'public';
};

const GUATEMALA_SUFFIXES: readonly string[] = [' DE GUATEMALA', ' GUATEMALA', ' GT'];

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function guatemalaCandidateNameVariants(name: string | null | undefined): GuatemalaNameVariant[] {
  const variants: GuatemalaNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: GuatemalaNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(guatemalaNameCore(name), 'name');

  // «Banco Industrial | Guatemala», «Tigo - Comunicaciones Celulares»: cada parte.
  const parts = name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|:\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length > 1) {
    add(guatemalaNameCore(parts[0]), 'part');
    for (const part of parts.slice(1)) if (endsWithGuatemalaLegalForm(part)) add(guatemalaNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    // Una palabra («Disagro» → DISAGRO DE GUATEMALA) también prueba con el país; el
    // resolvedor la trata como nombre de UNA palabra: sólo es fuerte si la web lo confirma.
    const suffix = variant.core.split(' ').length < 2 ? undefined : GUATEMALA_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined) {
      add(variant.core.slice(0, -suffix.length), 'without_guatemala');
      continue;
    }
    if (PUBLIC_ENTITY_START.test(variant.core)) continue;
    add(`${variant.core} DE GUATEMALA`, 'with_guatemala');
    add(`${variant.core} GUATEMALA`, 'with_guatemala');
  }
  // «Promerica Guatemala» → PROMERICA (sin) y PROMERICA DE GUATEMALA (con el otro enlace).
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_guatemala') continue;
    add(`${variant.core} DE GUATEMALA`, 'with_guatemala');
    add(`${variant.core} GUATEMALA`, 'with_guatemala');
  }

  // La clave pública de cada variante va justo detrás de ella.
  const ordered: GuatemalaNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = guatemalaPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
