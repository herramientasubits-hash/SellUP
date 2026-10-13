/**
 * uy-name-keys.ts — núcleo, alias y variantes del nombre de Uruguay para el RUT
 * por nombre.
 *
 * SOURCES-UY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj. Propio de
 * Uruguay: no toca `company-name-core.ts` ni `URUGUAY_LEGAL_FORMS` (acuerdo con el
 * chat de Brasil, que añade allí sus formas).
 *
 * ── Por qué hace falta (medido el 13-10-2026 sobre el RUPE de setiembre y 106
 *    empresas y entidades uruguayas reales) ─────────────────────────────────
 *
 * Con la lista exacta de formas de #510 sólo 20 de 106 encontraban su RUT:
 *
 *   1. La forma se escribe de muchas maneras: «SOCIEDAD DE RESP.LTDA.»,
 *      «SOCIEDAD RESPONSABILIDAD LIMITADA», «SOCIEDAD AGRARIA DE RESPONSABILIDAD
 *      LIMITADA», «S.A.C.I.», «Y CIA S A», «SOCIEDAD ANONI» (cortada a 50
 *      caracteres). Se reconoce por su ESTRUCTURA y sólo al final.
 *   2. La sigla va entre paréntesis o tras un guion: «… SOCIEDAD ANONIMA (COME
 *      SA)», «COOPERATIVA AGRARIA PUNTAS DE SARANDI - COOPUNSA». Sale del núcleo
 *      y queda como alias, también pegada («S.I.U.R.» → «SIUR»).
 *   3. Mutualistas e instituciones llevan un descriptor tras el nombre: «CASMU
 *      INSTITUCION DE ASISTENCIA MEDICA PRIVADA…», «ASOCIACION ESPAÑOLA PRIMERA DE
 *      SOCORROS MUTUOS»: lo que va antes del descriptor es alias.
 *   4. «Banco Itaú Uruguay» / «Itaú»: se prueba con y sin «Uruguay» (y «del/de
 *      Uruguay», «en el Uruguay»).
 *   5. Los entes del Estado se conocen por su sigla (UTE, OSE, ANCAP, BPS…): una
 *      tabla oficial y cerrada (`UY_PUBLIC_ENTITY_ACRONYMS`) da el alias.
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

/** Trabajadores mínimos para que un nombre de UNA palabra dé un RUT fuerte. */
export const UY_SINGLE_WORD_MIN_WORKERS = 50;

/** Mayúsculas, sin tildes, sólo letras/dígitos/& y espacios simples. */
export function plainUpperUruguay(name: string): string {
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
 * Responsabilidad limitada en todas sus escrituras: «SOCIEDAD DE RESPONSABILIDAD
 * LIMITADA», «SOCIEDAD RESPONSABILIDAD LTDA», «SOCIEDAD DE RESP LTDA», «SOCIEDAD
 * AGRARIA DE RESPONSABILIDAD LIMITADA», «SOC DE RESP», con la errata
 * «RESPONSABLIDAD» y cortada a 50 caracteres («… DE RESPONSABILIDAD L»).
 */
const LIMITED_LIABILITY_TAIL =
  /\s(?:SOCIEDAD|SOC)(?:\s(?:AGRARIA|COMERCIAL|CIVIL|COLECTIVA))?(?:\sDE)?\s(?:RESPONSABILIDAD|RESPONSABLIDAD|RESPONSABILIAD|RESP)(?:\s(?:LIMITADA|LIMITAD|LIMITA|LIMIT|LIMI|LIM|LI|L|LTDA|LTD))?$/;

/** «SOCIEDAD ANÓNIMA» cortada a 50 caracteres («SOCIEDAD ANONI», «SOCIEDAD A»). */
const ANONIMA_CUT_TAIL = /\s(?:SOCIEDAD|SOCIEDA|SOC)\s(?:A|AN|ANO|ANON|ANONI|ANONIM)$/;

/** Formas como secuencias de palabras ya normalizadas, más largas primero; sólo al FINAL. */
const UY_LEGAL_FORM_TAILS: readonly string[] = [
  'SOCIEDAD POR ACCIONES SIMPLIFICADA',
  'SOCIEDAD EN COMANDITA POR ACCIONES',
  'SOCIEDAD EN COMANDITA SIMPLE',
  'SOCIEDAD EN COMANDITA',
  'SOCIEDAD COLECTIVA',
  'SOCIEDAD ANONIMA',
  'SOC ANONIMA',
  'Y COMPANIA LIMITADA',
  'Y CIA LIMITADA',
  'Y COMPANIA LTDA',
  'Y CIA LTDA',
  'LIMITADA',
  'LIMITED',
  'LTDA',
  'LTD',
  'S A S',
  'SAS',
  'S R L',
  'SRL',
  'S EN C',
  'S A C I',
  'S A I C',
  'SACI',
  'SAIC',
  'S A C',
  'S A I',
  'S A',
  'SA',
  'Y COMPANIA',
  'Y CIA',
  'INCORPORATED',
  'CORPORATION',
  'L L C',
  'LLC',
  'INC',
  'CORP',
  'GMBH',
  'SUCURSAL EN EL URUGUAY',
  'SUCURSAL EN URUGUAY',
  'SUCURSAL DEL URUGUAY',
  'SUCURSAL DE URUGUAY',
  'SUCURSAL URUGUAY',
  'SUCURSAL',
];

function stripLegalFormTails(upper: string): string {
  let core = upper;
  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    // «HENDERSON&CIA»: el «&» queda pegado.
    const ampersand = /&(?:COMPANIA|CIA)$/.exec(core);
    if (ampersand !== null && ampersand.index > 0) {
      core = core.slice(0, ampersand.index).trim();
      stripped = true;
      continue;
    }
    for (const tail of [LIMITED_LIABILITY_TAIL, ANONIMA_CUT_TAIL]) {
      const match = tail.exec(core);
      if (match !== null && match.index > 0) {
        core = core.slice(0, match.index).trim();
        stripped = true;
        break;
      }
    }
    if (stripped) continue;
    for (const form of UY_LEGAL_FORM_TAILS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/** Quita un paréntesis FINAL («… SOCIEDAD ANONIMA (COME SA)») si queda algo delante. */
function withoutTrailingParenthesis(name: string): string {
  const match = /^(.*?\S)\s*\(([^()]*)\)?\s*\.?\s*$/.exec(name.trim());
  if (match === null) return name;
  return plainUpperUruguay(match[1]).length >= 2 ? match[1] : name;
}

/**
 * Núcleo del nombre uruguayo: el MISMO al cargar el registro y al buscar en la
 * corrida. Sin el paréntesis final y sin la forma societaria final.
 */
export function uruguayNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  return stripLegalFormTails(plainUpperUruguay(withoutTrailingParenthesis(name)));
}

/** ¿Termina el texto en una forma societaria uruguaya? */
export function endsWithUruguayLegalForm(name: string): boolean {
  const upper = plainUpperUruguay(withoutTrailingParenthesis(name));
  return stripLegalFormTails(upper) !== upper;
}

/** Partes de un nombre separadas por « - », «|», «/», «: » o «(»: la razón social y su sigla. */
export function splitUruguayNameParts(name: string): string[] {
  return name
    .split(/\s+-\s+|\s*\|\s*|\s+\/\s+|:\s+|\s*\(\s*/)
    .map((part) => part.replace(/\)\s*\.?\s*$/, '').trim())
    .filter((part) => part.length > 0);
}

/** «S I U R» → «SIUR»: una sigla escrita con puntos, pegada. `null` si no lo es. */
export function joinedInitials(core: string): string | null {
  const words = core.split(' ');
  if (words.length < 2 || !words.every((word) => /^[A-Z0-9]$/.test(word))) return null;
  return words.join('');
}

/**
 * Descriptores que siguen al nombre de una mutualista o institución: lo que va
 * ANTES es el nombre por el que se la conoce.
 */
const INSTITUTION_DESCRIPTOR =
  /\s(?:INSTITUCION DE ASISTENCIA MEDICA|CORPORACION DE ASISTENCIA MEDICA|PRIMERA DE SOCORROS MUTUOS|DE SOCORROS MUTUOS|DE OBREROS DEL URUGUAY|MUTUALISTA|SIN FINES DE LUCRO|INSTITUCION DE ASISTENCIA|IAMPP|IAMC)\b/;

/** «LA SOCIEDAD …», «EL …»: el artículo inicial no forma parte del nombre conocido. */
const LEADING_ARTICLE = /^(?:LA SOCIEDAD|LA|EL|LOS|LAS)\s/;

const URUGUAY_SUFFIXES: readonly string[] = [' EN EL URUGUAY', ' DEL URUGUAY', ' DE URUGUAY', ' URUGUAY'];

/** El núcleo sin el «… Uruguay» final, si quedan al menos dos palabras. `null` si no aplica. */
function withoutUruguaySuffix(core: string): string | null {
  const suffix = URUGUAY_SUFFIXES.find((s) => core.endsWith(s));
  if (suffix === undefined) return null;
  const rest = core.slice(0, -suffix.length).trim();
  return rest.length >= 2 ? rest : null;
}

/**
 * Siglas OFICIALES de entes del Estado uruguayo (entes autónomos, servicios
 * descentralizados, personas públicas no estatales y organismos con sigla de uso
 * general), con el núcleo de su razón social TAL COMO la escribe el RUPE (que
 * corta a 50 caracteres). Tabla cerrada: una sigla sólo da alias si el registro
 * trae exactamente ese núcleo.
 */
export const UY_PUBLIC_ENTITY_ACRONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  UTE: ['ADMINISTRACION NACIONAL DE USINAS Y TRASMISIONES E', 'ADMINISTRACION NACIONAL DE USINAS Y TRASMISIONES ELECTRICAS'],
  OSE: ['ADMINISTRACION DE LAS OBRAS SANITARIAS DEL ESTADO'],
  ANCAP: ['ADMINISTRACION NACIONAL DE COMBUSTIBLES ALCOHOL Y PORTLAND'],
  ANTEL: ['ADMINISTRACION NACIONAL DE TELECOMUNICACIONES'],
  BROU: ['BANCO DE LA REPUBLICA ORIENTAL DEL URUGUAY'],
  BSE: ['BANCO DE SEGUROS DEL ESTADO'],
  BPS: ['BANCO DE PREVISION SOCIAL'],
  BHU: ['BANCO HIPOTECARIO DEL URUGUAY'],
  BCU: ['BANCO CENTRAL DEL URUGUAY'],
  ANP: ['ADMINISTRACION NACIONAL DE PUERTOS'],
  AFE: ['ADMINISTRACION DE FERROCARRILES DEL ESTADO'],
  ASSE: ['ADMINISTRACION DE LOS SERVICIOS DE SALUD DEL ESTADO'],
  ANEP: ['ADMINISTRACION NACIONAL DE EDUCACION PUBLICA'],
  UDELAR: ['UNIVERSIDAD DE LA REPUBLICA'],
  UTEC: ['UNIVERSIDAD TECNOLOGICA'],
  INAU: ['INSTITUTO DEL NINO Y ADOLESCENTE DEL URUGUAY'],
  INC: ['INSTITUTO NACIONAL DE COLONIZACION'],
  INIA: ['INSTITUTO NACIONAL DE INVESTIGACION AGROPECUARIA'],
  INAC: ['INSTITUTO NACIONAL DE CARNES'],
  LATU: ['LABORATORIO TECNOLOGICO DEL URUGUAY'],
  ANV: ['AGENCIA NACIONAL DE VIVIENDA'],
  MEVIR: ['MOVIMIENTO DE ERRADICACION DE LA VIVIENDA INSALUBRE RURAL'],
  CORREO: ['ADMINISTRACION NACIONAL DE CORREOS'],
  ALUR: ['ALCOHOLES DEL URUGUAY'],
  CND: ['CORPORACION NACIONAL PARA EL DESARROLLO'],
  URSEC: ['UNIDAD REGULADORA DE SERVICIOS DE COMUNICACIONES'],
  URSEA: ['UNIDAD REGULADORA DE SERVICIOS DE ENERGIA Y AGUA'],
  INEFOP: ['INSTITUTO NACIONAL DE EMPLEO Y FORMACION PROFESIONAL'],
  ANII: ['AGENCIA NACIONAL DE INVESTIGACION E INNOVACION'],
});

/** Las siglas oficiales cuyo nombre largo es `core` (exacto). */
export function uruguayPublicEntityAcronymsFor(core: string): string[] {
  return Object.entries(UY_PUBLIC_ENTITY_ACRONYMS)
    .filter(([, names]) => names.includes(core))
    .map(([acronym]) => acronym);
}

/** Filas del registro cuyos alias nunca se guardan (no son la entidad que nombran). */
const NO_ALIAS_NAME_START =
  /^(FIDEICOMISO|SINDICATO|CONSORCIO|CLUB|COMISION|COMITE|CENTRO DE ESTUDIANTES|CAJA DE AUXILIO|COOPERATIVA DE (FUNCIONARIOS|EMPLEADOS|TRABAJADORES)|ASOCIACION DE (FUNCIONARIOS|EMPLEADOS|TRABAJADORES|OBREROS|JUBILADOS|PENSIONISTAS|EX)|UNION DE (TRABAJADORES|FUNCIONARIOS|EMPLEADOS)|AGRUPACION)\b/;

/** Un alias que sólo dice el país o la capital («(URUGUAY)») no nombra a nadie. */
const PLACE_ONLY_ALIAS = /^(URUGUAY|URUGUAYA|ORIENTAL|DEL URUGUAY|DE URUGUAY|MONTEVIDEO|SUCURSAL|SUCURSAL URUGUAY)$/;

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core) || PLACE_ONLY_ALIAS.test(core)) return;
  keys.push(core);
}

/**
 * Claves EXTRA de una razón social del registro (sin su núcleo de siempre): la
 * sigla o cada parte, el nombre antes del descriptor de mutualista, sin artículo
 * inicial, sin «Uruguay» final y la sigla oficial de un ente del Estado. Vacío
 * para sindicatos, clubes, asociaciones de funcionarios y similares.
 */
export function uruguayRegistryAliasKeys(legalName: string): string[] {
  const mainCore = uruguayNameCore(legalName);
  const keys: string[] = [];
  if (NO_ALIAS_NAME_START.test(plainUpperUruguay(legalName))) return keys;

  const cores = [mainCore];
  const parts = splitUruguayNameParts(legalName);
  if (parts.length > 1) for (const part of parts) cores.push(uruguayNameCore(part));

  const expanded: string[] = [];
  for (const core of cores) {
    expanded.push(core);
    const descriptor = INSTITUTION_DESCRIPTOR.exec(core);
    if (descriptor !== null && descriptor.index > 0) expanded.push(core.slice(0, descriptor.index).trim());
  }
  for (const core of [...expanded]) {
    const article = LEADING_ARTICLE.exec(core);
    if (article !== null && core.length > article[0].length + 1) expanded.push(core.slice(article[0].length).trim());
  }
  for (const core of [...expanded]) {
    const without = withoutUruguaySuffix(core);
    if (without !== null) expanded.push(without);
  }

  for (const core of expanded) {
    pushKey(keys, core, mainCore);
    const joined = joinedInitials(core);
    if (joined !== null) pushKey(keys, joined, mainCore);
  }
  for (const acronym of uruguayPublicEntityAcronymsFor(mainCore)) pushKey(keys, acronym, mainCore);
  return keys;
}

/** Los nombres PROPIOS de una sociedad del registro: su núcleo. */
export function uruguayOwnNameKeys(mainCore: string): string[] {
  return mainCore.length >= 2 ? [mainCore] : [];
}

/** Una variante del nombre del candidato y de dónde sale. */
export type UruguayNameVariant = {
  core: string;
  origin: 'name' | 'web' | 'part' | 'initials' | 'without_uruguay' | 'with_uruguay';
};

/** Restos de un dominio al final de un nombre armado desde la web. */
const WEB_TAIL = /(?:\s+(?:COM|EDU|ORG|GUB|NET|MIL|COOP))?\s+UY$|\s+COM$/;

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function uruguayCandidateNameVariants(name: string | null | undefined): UruguayNameVariant[] {
  const variants: UruguayNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: UruguayNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(uruguayNameCore(name), 'name');

  if (name.includes('.') && !/\s/.test(name.trim())) {
    add(stripLegalFormTails(plainUpperUruguay(name).replace(WEB_TAIL, '')), 'web');
  }

  const parts = splitUruguayNameParts(name);
  if (parts.length > 1) {
    add(uruguayNameCore(parts[0]), 'part');
    // Una parte posterior sólo si es una razón social completa, nunca un descriptor.
    for (const part of parts.slice(1)) if (endsWithUruguayLegalForm(part)) add(uruguayNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    const joined = joinedInitials(variant.core);
    if (joined !== null) add(joined, 'initials');
  }

  for (const variant of [...variants]) {
    if (variant.core.split(' ').length < 2 || WEB_TAIL.test(variant.core)) continue;
    const without = withoutUruguaySuffix(variant.core);
    if (without !== null) {
      add(without, 'without_uruguay');
      continue;
    }
    for (const s of URUGUAY_SUFFIXES) add(`${variant.core}${s}`, 'with_uruguay');
  }
  // «Itaú Uruguay» → ITAU (sin) e ITAU DEL URUGUAY (con otro enlace).
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_uruguay') continue;
    for (const s of URUGUAY_SUFFIXES) add(`${variant.core}${s}`, 'with_uruguay');
  }
  return variants;
}
