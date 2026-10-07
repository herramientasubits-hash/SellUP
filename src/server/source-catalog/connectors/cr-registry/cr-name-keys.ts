/**
 * cr-name-keys.ts — núcleo, alias y variantes del nombre de Costa Rica para la
 * cédula jurídica por nombre.
 *
 * SOURCES-CR-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué hace falta (medido el 06-10-2026 sobre 167 empresas y entidades
 *    costarricenses reales y las 18.216 filas de `cr_company_registry`) ────────
 *
 * Con la lista exacta de formas de #546 sólo 15 de 167 encontraban su cédula:
 *
 *   1. La forma societaria se escribe de muchas maneras y la lista no la veía:
 *      «S.R.LTDA», «E.I.R.L.», «SOCIEDAD CIVIL», «R.L.» de las cooperativas,
 *      «SOCIEDAD DE RESPONSABILIDAD LIMITADAILIDAD LIMITADA» (error del MEIC),
 *      «INC SOCIEDAD ANONIMA». Se reconoce por su ESTRUCTURA y sólo al final, como
 *      en México (#597) y Paraguay (#623).
 *   2. Zona Franca y SUGEF escriben el nombre anterior: «ACCENTURE S.R.L. (antes
 *      Avventa Worldwide, S.R.L., …)», «Davibank (Costa Rica) S.A. (antes
 *      Scotiabank de Costa Rica S.A.)». Lo de «antes» sale del núcleo y es ALIAS.
 *   3. Las multinacionales llevan «de Costa Rica», «(Costa Rica)» o «CR» y el
 *      vendedor no: «Medtronic» es MEDTRONIC COSTA RICA S.A. El candidato prueba
 *      también con y sin ese final.
 *   4. Las municipalidades se escriben «MUNICIPALIDAD DEL CANTÓN CENTRAL DE SAN
 *      JOSÉ» en SICOP y «Municipalidad de San José» en la web: la clave pública
 *      las lleva a la misma forma en los DOS lados.
 *
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

/**
 * Formas societarias costarricenses como secuencias de palabras ya normalizadas,
 * más largas primero. Una forma sólo se quita al FINAL y como palabras propias.
 */
const CR_LEGAL_FORM_TAILS: readonly string[] = [
  // Error de origen del MEIC: «… LIMITADAILIDAD LIMITADA».
  'SOCIEDAD DE RESPONSABILIDAD LIMITADAILIDAD LIMITADA',
  'EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD RESPONSABILIDAD LIMITADA',
  'SOCIEDAD EN NOMBRE COLECTIVO',
  'SOCIEDAD EN COMANDITA SIMPLE',
  'SOCIEDAD EN COMANDITA',
  'SOCIEDAD ANONIMA DEPORTIVA',
  'SOCIEDAD ANONIMA LABORAL',
  'SOCIEDAD ANONIMA',
  'SOCIEDAD CIVIL',
  'RESPONSABILIDAD LIMITADA',
  // Sucursal de una sociedad extranjera.
  'SUCURSAL EN COSTA RICA',
  'SUCURSAL COSTA RICA',
  'SUCURSAL',
  // Siglas.
  'S DE R L',
  'S R LTDA',
  'SRLTDA',
  'E I R L',
  'EIRL',
  'S R L',
  'SRL',
  'S A D',
  'S A L',
  'S A',
  'SA',
  // Cooperativas y asociaciones solidarias: «COOCIQUE R.L.».
  'R L',
  'LIMITADA',
  'LIMITED',
  'LTDA',
  'LTD',
  'INC',
  'LLC',
];

/** Mayúsculas, sin tildes, sólo letras/dígitos/& y espacios simples. */
export function plainUpperCostaRica(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita formas societarias del final (apiladas: «INC SOCIEDAD ANONIMA»). */
function stripLegalFormTails(upper: string): string {
  let core = upper;
  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    for (const form of CR_LEGAL_FORM_TAILS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/**
 * Lo que sigue al nombre actual en las listas oficiales: «(antes X…)», «, antes
 * X», «(fusionada con Y…)», «(antiguo …)» y el código de una planta satélite de
 * Zona Franca («ZF981647 - Planta satélite: …»).
 */
const AFTER_CURRENT_NAME = /[\s,;(]+\(?\s*(?:antes|fusionad[ao]s?|se fusion[oó]|antiguo|anteriormente)\b|\s*\(\s*planta\b|\s+ZF\d{5,}\b/i;

/**
 * El nombre ACTUAL: primera línea (Zona Franca escribe las plantas satélite en
 * las líneas siguientes de la misma celda) y sin lo que viene desde «(antes …»,
 * «(fusionada con …» o el código de otra planta.
 */
export function currentCostaRicaName(name: string): string {
  const firstLine = name.split(/\r?\n/)[0] ?? name;
  const match = AFTER_CURRENT_NAME.exec(firstLine);
  return (match === null ? firstLine : firstLine.slice(0, match.index)).trim();
}

/**
 * Nombres ANTERIORES escritos por la fuente: «(antes Avventa Worldwide, S.R.L.,
 * fusionada con …)» → «Avventa Worldwide, S.R.L.». Sólo el primero (lo demás
 * suelen ser sociedades absorbidas, que no son la empresa).
 */
export function formerCostaRicaNames(name: string): string[] {
  const firstLine = name.split(/\r?\n/)[0] ?? name;
  const match = /\(?\s*antes\s+(?:denominada\s+|llamada\s+)?([^)]*)/i.exec(firstLine);
  if (match === null) return [];
  const former = match[1].split(/\s*(?:,\s*)?(?:se fusion|fusionad|y absorb|absorbi)/i)[0]?.trim() ?? '';
  return former.length > 0 ? [former] : [];
}

/**
 * Núcleo del nombre costarricense: el MISMO al cargar el registro y al buscar en
 * la corrida. Sin lo que viene desde «(antes …», sin los paréntesis (su texto se
 * queda: «Holcim (Costa Rica) S.A.» → HOLCIM COSTA RICA) y sin la forma final.
 */
export function costaRicaNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  return stripLegalFormTails(plainUpperCostaRica(currentCostaRicaName(name)));
}

/** ¿Termina el texto en una forma societaria costarricense? */
export function endsWithCostaRicaLegalForm(name: string): boolean {
  const upper = plainUpperCostaRica(currentCostaRicaName(name));
  return stripLegalFormTails(upper) !== upper;
}

const PUBLIC_ENTITY_START =
  /^(MUNICIPALIDAD|CONCEJO MUNICIPAL|CONSEJO MUNICIPAL|MINISTERIO|INSTITUTO COSTARRICENSE|INSTITUTO NACIONAL|INSTITUTO MIXTO|INSTITUTO TECNOLOGICO DE COSTA RICA|INSTITUTO DE DESARROLLO|UNIVERSIDAD DE COSTA RICA|UNIVERSIDAD NACIONAL|UNIVERSIDAD ESTATAL|UNIVERSIDAD TECNICA NACIONAL|CAJA COSTARRICENSE|BANCO CENTRAL|BANCO NACIONAL DE COSTA RICA|BANCO DE COSTA RICA|BANCO POPULAR|BANCO HIPOTECARIO|CONSEJO NACIONAL|CONSEJO DE|COMISION NACIONAL|DIRECCION GENERAL|DIRECCION NACIONAL|JUNTA|TRIBUNAL|PODER JUDICIAL|ASAMBLEA LEGISLATIVA|CONTRALORIA|PROCURADURIA|DEFENSORIA|AUTORIDAD REGULADORA|SUPERINTENDENCIA|SERVICIO NACIONAL|SISTEMA NACIONAL|PATRONATO|REFINADORA COSTARRICENSE|PROMOTORA DEL COMERCIO|AGENCIA DE PROTECCION|PRESIDENCIA DE LA REPUBLICA)\b/;

/** ¿Es el núcleo el de una entidad del Estado (municipalidad, ministerio, ICE…)? */
export function isCostaRicaPublicEntityCore(core: string): boolean {
  return PUBLIC_ENTITY_START.test(core);
}

/**
 * Clave pública de municipalidades y concejos municipales de distrito: una forma
 * común en los dos lados. `null` si el núcleo no es uno de ellos.
 *
 *   MUNICIPALIDAD DEL CANTON CENTRAL DE SAN JOSE / Municipalidad de San José
 *                                               → MUNICIPALIDAD SAN JOSE
 *   MUNICIPALIDAD DE LA UNION                   → MUNICIPALIDAD LA UNION
 *   CONSEJO MUNICIPAL DE DISTRITO DE LEPANTO    → CONCEJO MUNICIPAL LEPANTO
 */
export function costaRicaPublicEntityKey(core: string): string | null {
  const municipal = /^MUNICIPALIDAD(?: DEL CANTON CENTRAL| DEL CANTON| DE CANTON)?(?: DE| DEL)? (.+)$/.exec(core);
  if (municipal !== null) {
    const key = `MUNICIPALIDAD ${municipal[1]}`;
    return key !== core ? key : null;
  }
  const district = /^CON[CS]EJO MUNICIPAL(?: DE DISTRITO| DEL DISTRITO)?(?: DE| DEL)? (.+)$/.exec(core);
  if (district !== null) {
    const key = `CONCEJO MUNICIPAL ${district[1]}`;
    return key !== core ? key : null;
  }
  return null;
}

/** Los nombres PROPIOS de una cédula del registro: su núcleo y su clave pública. */
export function costaRicaOwnNameKeys(mainCore: string): string[] {
  const keys = mainCore.length >= 2 ? [mainCore] : [];
  const publicKey = costaRicaPublicEntityKey(mainCore);
  if (publicKey !== null) keys.push(publicKey);
  return keys;
}

/** Filas cuyos alias nunca se guardan (no son la empresa que nombran). */
const NO_ALIAS_NAME_START = /^(FIDEICOMISO|CONSORCIO|ASOCIACION SOLIDARISTA|SINDICATO)\b/;

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core)) return;
  keys.push(core);
}

/**
 * Claves EXTRA de una razón social del registro (sin su núcleo de siempre): el
 * nombre anterior escrito por la fuente, otros nombres de la misma cédula en
 * otras fuentes, la sigla oficial y la clave pública. Vacío para fideicomisos,
 * consorcios, sindicatos y asociaciones solidaristas.
 */
export function costaRicaRegistryAliasKeys(params: {
  legalName: string;
  otherNames?: readonly string[];
  acronyms?: readonly string[];
}): string[] {
  const mainCore = costaRicaNameCore(params.legalName);
  const keys: string[] = [];
  if (NO_ALIAS_NAME_START.test(plainUpperCostaRica(params.legalName))) return keys;

  const names = [params.legalName, ...(params.otherNames ?? [])];
  const cores: string[] = [];
  for (const name of names) {
    cores.push(costaRicaNameCore(name));
    for (const former of formerCostaRicaNames(name)) cores.push(costaRicaNameCore(former));
  }
  for (const acronym of params.acronyms ?? []) cores.push(plainUpperCostaRica(acronym));
  for (const core of cores) {
    pushKey(keys, core, mainCore);
    const publicKey = costaRicaPublicEntityKey(core);
    if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  }
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type CostaRicaNameVariant = {
  core: string;
  origin: 'name' | 'web' | 'part' | 'without_costa_rica' | 'with_costa_rica' | 'public';
};

/** Restos de un dominio al final de un nombre armado desde la web («elangel.co.cr»). */
const WEB_TAIL = /(?:\s+(?:CO|COM|GO|FI|AC|SA|ED|OR|NET|ORG|GOB))?\s+CR$|\s+COM$/;

const COSTA_RICA_SUFFIXES: readonly string[] = [' DE COSTA RICA', ' COSTA RICA', ' CR'];

/**
 * Partes de un nombre separadas por « - », «|», «/», «: » o «(»: la razón social
 * y su sigla, o el nombre y un resto de la web.
 */
export function splitCostaRicaNameParts(name: string): string[] {
  return name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|:\s+|\s*\(\s*/)
    .map((part) => part.replace(/\)\s*\.?\s*$/, '').trim())
    .filter((part) => part.length > 0);
}

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function costaRicaCandidateNameVariants(name: string | null | undefined): CostaRicaNameVariant[] {
  const variants: CostaRicaNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: CostaRicaNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(costaRicaNameCore(name), 'name');

  if (name.includes('.')) {
    add(stripLegalFormTails(plainUpperCostaRica(name).replace(WEB_TAIL, '')), 'web');
  }

  const parts = splitCostaRicaNameParts(name);
  if (parts.length > 1) {
    add(costaRicaNameCore(parts[0]), 'part');
    // Una parte posterior sólo si es una razón social completa, nunca un descriptor.
    for (const part of parts.slice(1)) if (endsWithCostaRicaLegalForm(part)) add(costaRicaNameCore(part), 'part');
  }

  for (const variant of [...variants]) {
    if (variant.core.split(' ').length < 2 && !COSTA_RICA_SUFFIXES.some((s) => variant.core.endsWith(s))) {
      // Una palabra sola: también «<palabra> de Costa Rica» (MEDTRONIC → MEDTRONIC COSTA RICA).
      if (!isCostaRicaPublicEntityCore(variant.core) && variant.origin !== 'web') {
        for (const s of COSTA_RICA_SUFFIXES) add(`${variant.core}${s}`, 'with_costa_rica');
      }
      continue;
    }
    const suffix = COSTA_RICA_SUFFIXES.find((s) => variant.core.endsWith(s) && variant.core !== s.trim());
    if (suffix !== undefined) {
      const bare = variant.core.slice(0, -suffix.length).trim();
      // «BANCO DE COSTA RICA» sin «de Costa Rica» sería «BANCO»: no.
      if (bare.split(' ').length >= 1 && !/\b(DE|DEL)$/.test(bare) && bare !== 'BANCO') {
        add(bare, 'without_costa_rica');
      }
      continue;
    }
    if (isCostaRicaPublicEntityCore(variant.core)) continue;
    for (const s of COSTA_RICA_SUFFIXES) add(`${variant.core}${s}`, 'with_costa_rica');
  }
  // «Holcim Costa Rica» → HOLCIM (sin) y HOLCIM DE COSTA RICA (con otro enlace).
  for (const variant of [...variants]) {
    if (variant.origin !== 'without_costa_rica') continue;
    for (const s of COSTA_RICA_SUFFIXES) add(`${variant.core}${s}`, 'with_costa_rica');
  }

  // La clave pública de cada variante va justo detrás de ella.
  const ordered: CostaRicaNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = costaRicaPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}
