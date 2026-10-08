/**
 * sv-name-keys.ts — núcleo, alias y variantes del nombre de El Salvador para el NIT
 * por nombre.
 *
 * SOURCES-SV-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Mismo enfoque que Honduras (`hn-name-keys.ts`); `normalizeCentralAmericaCore` y
 * `company-name-core.ts` NO se tocan (Guatemala, Panamá y Honduras fijan su
 * resultado):
 *
 *   1. La forma societaria se reconoce por su ESTRUCTURA, sin espacios ni puntos:
 *      «S.A. DE C.V.», «S. A. DE. C. V.», «SA DE CV», «LTDA. DE C.V.», «DE R.L.»,
 *      «S. EN C. DE C.V.», «S.E.M. DE C.V.», «SOCIEDAD ANONIMA DE CAPITAL VARIABLE»,
 *      «SUCURSAL EL SALVADOR», «LLC», «LIMITED»… apiladas al final («Y CIA., S. EN C.
 *      DE C.V.», «…, S.A. DE C.V., CASA DE CORREDORES DE BOLSA»).
 *   2. La sigla entre paréntesis sale del núcleo y es un ALIAS: «Administración
 *      Nacional de Acueductos y Alcantarillados (ANDA)».
 *   3. «3M El Salvador» = 3M EL SALVADOR; el candidato «3M» prueba con y sin
 *      «(de) El Salvador».
 *   4. «Alcaldía Municipal de Santa Tecla» = «Municipalidad de Santa Tecla» =
 *      ALCALDIA SANTA TECLA; «Ministerio de Salud Pública y Asistencia Social» =
 *      MINISTERIO SALUD PUBLICA ASISTENCIA SOCIAL.
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

/** Mayúsculas, sin tildes, sólo letras/dígitos/&, «&» pegado y espacios simples. */
export function plainUpperSalvador(name: string): string {
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
 * Formas societarias SIN espacios (la estructura, no la escritura). Se comparan con
 * las últimas palabras del nombre pegadas: «S A DE C V», «SA DE CV» y «SADECV» son
 * lo mismo.
 */
const SV_LEGAL_FORMS_COMPACT: ReadonlySet<string> = new Set([
  'SOCIEDADANONIMADECAPITALVARIABLE',
  'SOCIEDADANONIMADECV',
  'SOCIEDADANONIMA',
  'SOCIEDADDERESPONSABILIDADLIMITADADECAPITALVARIABLE',
  'SOCIEDADDERESPONSABILIDADLIMITADA',
  'SOCIEDADENCOMANDITASIMPLEDECAPITALVARIABLE',
  'SOCIEDADENCOMANDITASIMPLE',
  'SOCIEDADENCOMANDITA',
  'SOCIEDADDEECONOMIAMIXTADECAPITALVARIABLE',
  'SOCIEDADDEECONOMIAMIXTA',
  'SOCIEDADCOLECTIVA',
  'DECAPITALVARIABLE',
  'SADECV',
  'SACV',
  'SA',
  'SAS',
  'SAU',
  'LTDADECV',
  'LTDA',
  'LIMITADA',
  'SENCDECV',
  'SENCDE',
  'SENC',
  'SEMDECV',
  'SEM',
  'SDERLDECV',
  'SDERL',
  'SRLDECV',
  'SRL',
  'DERLDECV',
  'DERL',
  'NCDERL',
  'DECV',
  'INC',
  'INCORPORATED',
  'LLC',
  'LTD',
  'LIMITED',
  'CORP',
  'PLC',
  'GMBH',
  'BV',
  'NV',
  'AG',
  'SLU',
  'SL',
  'YCIA',
  'YCOMPANIA',
  '&CIA',
  '&COMPANIA',
  'SUCURSALELSALVADOR',
  'SUCURSALENELSALVADOR',
  'SUCURSALDEELSALVADOR',
  'SUCELSALVADOR',
  'SUCURSAL',
  'CASADECORREDORESDEBOLSA',
  'PUESTODEBOLSADEPRODUCTOSYSERVICIOS',
  'PUESTODEBOLSA',
  'GESTORADEFONDOSDEINVERSION',
]);

/**
 * Restos de una forma CORTADA al final del texto (COMPRASAL corta los nombres
 * largos): sólo valen si el corte deja claro que era una forma.
 */
const SV_TRUNCATED_FORMS_COMPACT: ReadonlySet<string> = new Set([
  'SADEC',
  'SADE',
  'LTDADEC',
  'LTDADE',
  'SOCIEDADANONIMADECAPITAL',
  'SOCIEDADANONIMADE',
]);

/** Cuántas palabras finales mira como mucho una forma (la más larga tiene 7). */
const MAX_FORM_WORDS = 8;

/** Una forma completa o cortada que ocupa las últimas `k` palabras, o 0. */
function trailingFormWords(words: readonly string[], allowTruncated: boolean): number {
  for (let k = Math.min(MAX_FORM_WORDS, words.length - 1); k >= 1; k--) {
    const compact = words.slice(words.length - k).join('');
    if (SV_LEGAL_FORMS_COMPACT.has(compact)) return k;
    if (allowTruncated && SV_TRUNCATED_FORMS_COMPACT.has(compact)) return k;
  }
  return 0;
}

/** Quita formas societarias del final (apiladas: «Y CIA S EN C DE C V»). */
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

/** Paréntesis final: «… (ANDA)», «… ( CAMUDASAL)», «… (CTI, S.A. DE C.V.)». */
const TRAILING_PAREN = /^(.*\S)\s*\(\s*([^()]{2,80}?)\s*\)?\s*[.,]?\s*$/;

function splitTrailingParen(name: string): { head: string; tag: string | null } {
  const match = TRAILING_PAREN.exec(name.trim());
  if (match === null) return { head: name, tag: null };
  return plainUpperSalvador(match[1]).length >= 2 ? { head: match[1], tag: match[2].trim() || null } : { head: name, tag: null };
}

/**
 * Forma FUERTE en medio del nombre seguida de un nombre comercial corto (hasta 3
 * palabras): «… S.A. DE C.V. FARMACIAS UNO».
 */
const MIDDLE_FORM = /\s(?:SOCIEDAD ANONIMA(?: DE CAPITAL VARIABLE)?|S A DE C V|SA DE CV|LTDA DE C V|S A)\s(?=[A-Z0-9&])/;

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

/** Comillas y espacios sobrantes de los listados de Hacienda («" CSH COMERCIAL, … , "»). */
function cleanListName(name: string): string {
  return name.replace(/["“”«»]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[\s,.;]+$/, '');
}

/**
 * Núcleo del nombre salvadoreño: el MISMO al cargar las fuentes y al buscar en la
 * corrida. Sin comillas, sin el paréntesis final, sin la forma societaria final
 * (completa o cortada) y, si tras una forma viene un nombre corto, sólo la razón
 * social.
 */
export function salvadorNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  const cleaned = cleanListName(name);
  const upper = plainUpperSalvador(splitTrailingParen(cleaned).head);
  const core = stripLegalFormTails(upper);
  // Un nombre que es SÓLO la forma («S.A. DE C.V.») no tiene núcleo.
  if (core.length === 0 || SV_LEGAL_FORMS_COMPACT.has(core.replace(/ /g, ''))) return '';
  // «… DE C.A.» es «… DE CENTROAMÉRICA» abreviado (Hacienda escribe las dos).
  return (splitMiddleForm(core)?.before ?? core).replace(/ DE C A$/, ' DE CENTROAMERICA');
}

/** ¿Termina el texto en una forma societaria (completa) salvadoreña? */
export function endsWithSalvadorLegalForm(name: string): boolean {
  const upper = plainUpperSalvador(splitTrailingParen(cleanListName(name)).head);
  return trailingFormWords(upper.split(' '), false) > 0;
}

// ─── Persona natural o entidad ─────────────────────────────────────────────

/** Sucesiones, uniones temporales, consorcios y partidos: nunca una empresa a prospectar. */
const EXCLUDED_NAME = /^(SUCESION|SUC)\b|\b(UDP|CONSORCIO|PARTIDO|UNION DE PERSONAS)\b/;

/**
 * Palabras que sólo lleva una entidad (nunca un nombre de persona): sin apellidos
 * que también son palabras («CRUZ», «PAZ», «ROSA»).
 */
const ENTITY_WORD =
  /\b(ASOC|ASOCIACION|FUNDACION|COOPERATIVA|COOP|UNIVERSIDAD|INSTITUTO|BANCO|ADMINISTRACION|ADMINISTRADORA|CORPORACION|COMISION|ALCALDIA|MUNICIPALIDAD|FONDO|FEDERACION|CENTRO|COLEGIO|ESCUELA|SINDICATO|CLUB|CAMARA|IGLESIA|HOSPITAL|CONSEJO|MINISTERIO|EMPRESA|EMPRESAS|FIDEICOMISO|TRIBUNAL|CORTE|ASAMBLEA|FISCALIA|PROCURADURIA|SECRETARIA|DIRECCION|SUPERINTENDENCIA|AUTORIDAD|ACADEMIA|CAJA|DEFENSORIA|LOTERIA|OFICINA|ORGANISMO|REGISTRO|PRESIDENCIA|POLICIA|COMITE|PATRONATO|CONGREGACION|MISION|SEMINARIO|PARROQUIA|ARZOBISPADO|DIOCESIS|HOGAR|ORGANIZACION|PROGRAMA|PROYECTO|SOCIEDAD|AGENCIA|CONFERENCIA|CIRCULO|INTERNATIONAL|INTERNACIONAL|SERVICES|SERVICIOS|ABOGADOS|ASOCIADOS|HERMANOS|GRUPO|INDUSTRIAS|INDUSTRIA|DISTRIBUIDORA|LABORATORIO|LABORATORIOS|FARMACIA|ALMACENES|TRANSPORTES|CONSTRUCTORA|INVERSIONES|COMERCIAL|IMPORTADORA|AGROPECUARIA|COMPANY|COMPANIA|CIA|CORPORATION|HOLDING|HOLDINGS|TEXTILES|SUCURSAL|BANK|PAGADURIA|UNIDAD|SOLUCIONES|SOLUTIONS|MULTISERVICIOS|SERVICIO|CONSTRUCCION|CONSTRUCCIONES|CONSTRUCTORES|INGENIERIA|INGENIEROS|ARQUITECTOS|ARQUITECTURA|CONSULTING|CONSULTORES|CONSULTORIA|LATAM|NEGOCIOS|SEGURIDAD|ELECTRONICA|TECNOLOGIA|TECNOLOGIAS|TECHNOLOGIES|TECHNOLOGY|SISTEMAS|SYSTEMS|GROUP|MEDICAL|PHARMA|FARMACEUTICA|DROGUERIA|MOTORS|IMPORTACIONES|EXPORTADORA|PRODUCTOS|ALIMENTOS|DISTRIBUCIONES|SUMINISTROS|PROVEEDORA|AGENCIAS|EDITORIAL|TELECOM|COMUNICACIONES|ENERGIA|PETROLEOS|COMBUSTIBLES|GASOLINERA|HOTEL|RESTAURANTE|CLINICA|TRADING|CENTER|MARKET|EXPRESS|INTERNACIONALES|CORPORATIVO|CORPORATIVA)\b/;

/** Qué es el titular de un NIT según su nombre. */
export type SvNameKind = 'entity' | 'natural_person' | 'excluded';

/**
 * Persona natural, entidad o excluido. Los listados de Hacienda mezclan sociedades
 * con personas naturales (≈ 83 de 1.069 en los Grandes Contribuyentes de 2019):
 * su nombre es un dato personal y NUNCA se guarda. Ante la duda, persona natural.
 */
export function classifySalvadorTaxpayerName(name: string | null | undefined): SvNameKind {
  if (typeof name !== 'string') return 'natural_person';
  const upper = plainUpperSalvador(cleanListName(name));
  if (upper.length === 0) return 'natural_person';
  if (EXCLUDED_NAME.test(upper)) return 'excluded';
  if (endsWithSalvadorLegalForm(name) || MIDDLE_FORM.test(` ${upper} `) || ENTITY_WORD.test(upper)) return 'entity';
  const words = upper.split(' ');
  // Una sola palabra («AGEPYM», «COFARSAL»), iniciales sueltas («C I D E P»), cifras
  // («3M») o «&»: una sigla o una marca, no una persona.
  if (words.length === 1 && upper.length >= 3) return 'entity';
  if (words.length >= 3 && words.every((w) => w.length === 1)) return 'entity';
  if (/\d|&/.test(upper)) return 'entity';
  return 'natural_person';
}

// ─── Entidades públicas ────────────────────────────────────────────────────

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A', 'AL']);

const PUBLIC_ENTITY_START =
  /^(ALCALDIA|MUNICIPALIDAD|MINISTERIO|VICEMINISTERIO|SECRETARIA|PRESIDENCIA DE LA REPUBLICA|ASAMBLEA LEGISLATIVA|CORTE (SUPREMA|DE CUENTAS)|FISCALIA GENERAL|PROCURADURIA|TRIBUNAL|CONSEJO (NACIONAL|SUPERIOR|SALVADORENO|DE VIGILANCIA)|INSTITUTO (SALVADORENO|NACIONAL|DE ACCESO|DE GARANTIA|DE PREVISION|DE LEGALIZACION|LEGALIZACION|DE SALVADORENO|CRECER)|INSTITUTUTO NACIONAL|HOSPITAL NACIONAL|SUPERINTENDENCIA|COMISION (EJECUTIVA|NACIONAL)|FONDO (SOCIAL PARA|SOLIDARIO|NACIONAL|DE CONSERVACION|DE INVERSION|DE PROTECCION|DE DESARROLLO|DEL MILENIO|DE EMERGENCIA|PARA LA ATENCION|SALVADORENO|AMBIENTAL)|ADMINISTRACION NACIONAL|BANCO (CENTRAL DE RESERVA|DE FOMENTO AGROPECUARIO|DE DESARROLLO DE EL SALVADOR)|CENTRO NACIONAL|CENTRO INTERNACIONAL DE FERIAS|CENTRO FARMACEUTICO|AUTORIDAD|ACADEMIA NACIONAL|DEFENSORIA|DIRECCION (GENERAL|NACIONAL|REGIONAL)|GOBERNACION|LOTERIA NACIONAL|REGISTRO NACIONAL|UNIVERSIDAD DE EL SALVADOR|ESCUELA NACIONAL|CORPORACION SALVADORENA|ORGANISMO PROMOTOR|OFICINA DE PLANIFICACION|POLICIA NACIONAL|UNIDAD TECNICA|CAJA MUTUAL|AGENCIA (ADMINISTRADORA|DE|NACIONAL))\b/;

/** ¿Es el núcleo el de una entidad del Estado (alcaldía, ministerio, CEL…)? */
export function isSalvadorPublicEntityCore(core: string): boolean {
  return PUBLIC_ENTITY_START.test(core);
}

/**
 * Clave pública: alcaldía/municipalidad → «ALCALDIA <municipio>»; ministerio y demás
 * sin palabras de enlace, sin «(de) El Salvador» final y sin «ESPECIALIZADO». La
 * ubicación se CONSERVA («Hospital Nacional San Juan de Dios - Santa Ana» y «…, San
 * Miguel» son dos hospitales con dos NIT). `null` si no es una entidad pública.
 *
 *   Alcaldía Municipal de Santa Tecla / Municipalidad de Santa Tecla → ALCALDIA SANTA TECLA
 *   Ministerio de Salud Pública y Asistencia Social → MINISTERIO SALUD PUBLICA ASISTENCIA SOCIAL
 */
export function salvadorPublicEntityKey(name: string): string | null {
  let core = salvadorNameCore(name);
  if (!PUBLIC_ENTITY_START.test(core)) return null;
  core = core
    .replace(/^(?:ALCALDIA(?: MUNICIPAL)?|MUNICIPALIDAD)(?: DEL? MUNICIPIO)?\b/, 'ALCALDIA')
    .replace(/^INSTITUTUTO\b/, 'INSTITUTO')
    .replace(/ (?:DE )?EL SALVADOR$/, '')
    .replace(/\bESPECIALIZADO\b/, ' ');
  const key = core
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .join(' ');
  return key.split(' ').length >= 2 ? key : null;
}

// ─── Alias ─────────────────────────────────────────────────────────────────

/** Filas cuyos alias nunca se guardan (no son la entidad que nombran). */
const NO_ALIAS_NAME_START = /^(FIDEICOMISO|SINDICATO|CONSORCIO|COMITE|CLUB|FONDO DE ACTIVIDADES)\b/;

/** Lo que sigue a la forma y nombra una parte de la sociedad, no a la sociedad. */
const BRANCH_WORD = /^(DIVISION|SUCURSAL|PLANTA|AGENCIA|TIENDA|OFICINA|REGIONAL|FILIAL)\b/;

/** Palabras que nunca son sigla de UNA empresa. */
const GENERIC_ALIAS: ReadonlySet<string> = new Set([
  'EL SALVADOR', 'SALVADOR', 'SV', 'BANCO', 'SEGUROS', 'GRUPO', 'INVERSIONES', 'SUCURSAL', 'CENTROAMERICA',
]);

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core) || GENERIC_ALIAS.has(core)) return;
  keys.push(core);
}

/** Una sigla o nombre comercial utilizable como alias (3+ letras, no sólo una forma). */
function aliasCore(text: string): string | null {
  const core = salvadorNameCore(text);
  if (core.length < 3 || !/[A-Z]/.test(core)) return null;
  return core;
}

/**
 * Claves EXTRA de una razón social (sin su núcleo de siempre): la sigla entre
 * paréntesis («ANDA», «CTI»), lo que sigue a una forma en medio, las partes
 * separadas por « / » o «|», y la clave pública. Vacío para fideicomisos,
 * sindicatos, consorcios y similares.
 */
export function salvadorRegistryAliasKeys(legalName: string): string[] {
  const cleaned = cleanListName(legalName);
  const mainCore = salvadorNameCore(cleaned);
  const keys: string[] = [];
  if (NO_ALIAS_NAME_START.test(plainUpperSalvador(cleaned))) return keys;

  const { head, tag } = splitTrailingParen(cleaned);
  if (tag !== null && salvadorNameCore(head) !== '') {
    const tagCore = aliasCore(tag);
    if (tagCore !== null) pushKey(keys, tagCore, mainCore);
  }

  const middle = splitMiddleForm(stripLegalFormTails(plainUpperSalvador(head)));
  if (middle !== null && !BRANCH_WORD.test(middle.after)) pushKey(keys, middle.after, mainCore);

  const parts = cleaned.split(/\s*\|\s*|\s*\/\s*/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > 1) {
    for (const part of parts) {
      const core = aliasCore(part);
      if (core !== null) pushKey(keys, core, mainCore);
    }
  }

  const publicKey = salvadorPublicEntityKey(cleaned);
  if (publicKey !== null) pushKey(keys, publicKey, mainCore);

  // «ADMINISTRADORA DE FONDOS DE PENSIONES CONFIA» = «AFP CONFIA» (así se presentan).
  const afp = /^ADMINISTRADORA DE FONDOS DE PENSIONES (.+)$/.exec(mainCore);
  if (afp !== null) pushKey(keys, `AFP ${afp[1]}`, mainCore);
  // «Ministerio de Salud Pública y Asistencia Social» = «Ministerio de Salud»: el
  // ministerio por su primera palabra. Si dos NIT la comparten, el ETL la descarta.
  const ministry = publicKey !== null ? /^MINISTERIO (\S+) \S+/.exec(publicKey) : null;
  if (ministry !== null) pushKey(keys, `MINISTERIO ${ministry[1]}`, mainCore);
  return keys;
}

// ─── Variantes del candidato ───────────────────────────────────────────────

/** Una variante del nombre del candidato y de dónde sale. */
export type SalvadorNameVariant = {
  core: string;
  origin: 'name' | 'part' | 'without_el_salvador' | 'with_el_salvador' | 'public';
};

const EL_SALVADOR_SUFFIXES: readonly string[] = [' DE EL SALVADOR', ' EL SALVADOR', ' SALVADORENA', ' SALVADORENO', ' SV'];
const WITH_EL_SALVADOR: readonly string[] = [' EL SALVADOR', ' DE EL SALVADOR'];

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function salvadorCandidateNameVariants(name: string | null | undefined): SalvadorNameVariant[] {
  const variants: SalvadorNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: SalvadorNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(salvadorNameCore(name), 'name');

  // «Banco Agrícola | El Salvador», «Tigo - Telemóvil», «Ministerio de Educación,
  // Ciencia y Tecnología»: cada parte.
  const parts = name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|:\s+|,\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length > 1) {
    add(salvadorNameCore(parts[0]), 'part');
    for (const part of parts.slice(1)) if (endsWithSalvadorLegalForm(part)) add(salvadorNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    const suffix = variant.core.split(' ').length < 2 ? undefined : EL_SALVADOR_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined) {
      const without = variant.core.slice(0, -suffix.length);
      // «Banco Cuscatlán de El Salvador» → BANCO CUSCATLAN, no «BANCO CUSCATLAN DE».
      add(without.replace(/ DE$/, ''), 'without_el_salvador');
      continue;
    }
    if (PUBLIC_ENTITY_START.test(variant.core)) continue;
    for (const s of WITH_EL_SALVADOR) add(`${variant.core}${s}`, 'with_el_salvador');
  }
  // «Holcim El Salvador» → HOLCIM (sin) y HOLCIM DE EL SALVADOR (con el otro enlace).
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_el_salvador') continue;
    for (const s of WITH_EL_SALVADOR) add(`${variant.core}${s}`, 'with_el_salvador');
  }

  // La clave pública de cada variante va justo detrás de ella.
  const ordered: SalvadorNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = salvadorPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
