/**
 * pe-name-keys.ts — claves de nombre de Perú para el RUC por nombre: alias del
 * padrón, nombres de entidades públicas y variantes del nombre del candidato.
 *
 * SOURCES-PE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué hace falta (medido el 06-10-2026 con 182 empresas peruanas reales) ──
 *
 * Con el núcleo exacto de siempre (`normalizePeruCompanyCore`) sólo 57 de 182
 * encontraban su RUC. Las que fallaban caían en tres formas que el núcleo no ve:
 *
 *   1. SUNAT guarda razón social y nombre conocido juntos, separados por « - »:
 *      «LECHE GLORIA SOCIEDAD ANONIMA - GLORIA S.A.», «DIRECCIÓN REGIONAL DE SALUD
 *      DEL CALLAO - DIRESA CALLAO» (45.513 filas). Cada parte es un ALIAS.
 *   2. Las entidades públicas se escriben con o sin «de/del» y SUNAT las abrevia
 *      («MUNICIPALIDAD DISTRITAL  USQUIL», «HOSPITAL REGIONAL CUSCO»): para ellas
 *      la clave pública quita esas palabras de enlace en los DOS lados.
 *   3. El candidato llega con restos de la web («Volcan.com.pe», «Petroperú >
 *      Contáctanos»), con la provincia tras un guion («Municipalidad Provincial de
 *      Espinar - Cusco») o sin el «del Perú» de su razón social («Laboratorios
 *      Bagó» → LABORATORIOS BAGO DEL PERU S.A.).
 *
 * El núcleo guardado en `pe_sunat_registry` NO cambia: estas claves viven en una
 * fuente aparte (`pe_sunat_name_alias`) y el candidato prueba primero su núcleo de
 * siempre. Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 *
 * ── Alias que NO se guardan ─────────────────────────────────────────────────
 *
 *   - Sindicatos, consorcios, juntas, CAFAE, asociaciones de cesantes o
 *     trabajadores: «SINDICATO … DE ESSALUD - ESSALUD» haría que «EsSalud»
 *     apuntara al sindicato.
 *   - La PRIMERA parte sólo cuenta si es una razón social completa (termina en una
 *     forma societaria), si la entidad es pública o si tiene 50+ trabajadores:
 *     «CLINICA DE ESPECIALIDADES MEDICAS - QUIRURGICAS SAN ANTONIO…» no puede
 *     quedarse con el nombre genérico «Clínica de Especialidades Médicas».
 */

import { normalizeCompanyNameCore, PERU_LEGAL_FORMS } from '../../company-name-core';

/** Trabajadores mínimos para que un nombre de UNA palabra dé un RUC fuerte. */
export const PE_SINGLE_WORD_MIN_WORKERS = 50;

/** Tipos de contribuyente de SUNAT cuyos alias nunca se guardan. */
export const PE_NO_ALIAS_TAXPAYER_TYPES: ReadonlySet<string> = new Set([
  'SINDICATOS Y FEDERACIONES',
  'CONTRATOS COLABORACION EMPRESARIAL',
  'JUNTA DE PROPIETARIOS',
  'NUCLEOS EJECUTORES',
  'INSTITUCIONES RELIGIOSAS',
]);

/** Tipos de contribuyente de SUNAT que son Estado (su primera parte siempre cuenta). */
export const PE_PUBLIC_TAXPAYER_TYPES: ReadonlySet<string> = new Set([
  'INSTITUCIONES PUBLICAS',
  'GOBIERNO REGIONAL LOCAL',
  'GOBIERNO CENTRAL',
  'EMPRESA ESTATAL DE DERECHO PRIVADO',
  'UNIVERSIDADES CENTROS EDUCATIVOS Y CULTURALES',
]);

const NO_ALIAS_NAME_START =
  /^(SINDICATO|CONSORCIO|CAFAE|COMITE|CLUB|ASOCIACION DE (CESANTES|JUBILADOS|PENSIONISTAS|TRABAJADORES|SERVIDORES|EX TRABAJADORES|VOLUNTARIADO|DAMAS))\b/;

const PUBLIC_ENTITY_START =
  /^(MUNICIPALIDAD|HOSPITAL|GOBIERNO REGIONAL|INSTITUTO NACIONAL|INSTITUTO REGIONAL|DIRECCION|RED DE SALUD|RED ASISTENCIAL|UNIVERSIDAD NACIONAL|SUPERINTENDENCIA|PROGRAMA NACIONAL|MINISTERIO|SEGURO SOCIAL|ORGANISMO|AUTORIDAD|SERVICIO NACIONAL|CENTRO NACIONAL|CORTE SUPERIOR)\b/;

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y']);

/** Restos de un dominio al final de un nombre armado desde la web. */
const WEB_TAIL = /(?:\s+(?:COM|EDU|ORG|GOB|NET|MIL|SLD))?\s+PE$|\s+COM$/;

/** Mayúsculas, sin tildes, sólo letras/dígitos/& y espacios simples (sin quitar formas). */
function plainUpper(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Núcleo peruano (el MISMO de `normalizePeruCompanyCore`). */
function peruCore(name: string): string {
  return normalizeCompanyNameCore(name, PERU_LEGAL_FORMS);
}

/** ¿Termina el texto en una forma societaria peruana («… S.A.C.», «… SOCIEDAD ANONIMA»)? */
export function endsWithPeruLegalForm(name: string): boolean {
  const upper = plainUpper(name);
  return PERU_LEGAL_FORMS.some((form) => upper !== form && upper.endsWith(` ${form}`));
}

/**
 * Partes de un nombre separadas por « - », «|», «/», «>», «: » o «(»: la razón
 * social y su nombre conocido, o el nombre y un resto de la web.
 */
export function splitPeruNameParts(name: string): string[] {
  return name
    .split(/\s+-\s+|\s*\|\s*|\s*\/\s*|\s*>\s*|:\s+|\s*\(\s*/)
    .map((part) => part.replace(/\)\s*$/, '').trim())
    .filter((part) => part.length > 0);
}

/**
 * Clave pública: para un núcleo que empieza como una entidad del Estado, el mismo
 * núcleo sin palabras de enlace. `null` si el núcleo no es de una entidad pública.
 */
export function peruPublicEntityKey(core: string): string | null {
  if (!PUBLIC_ENTITY_START.test(core)) return null;
  const key = core
    .split(' ')
    .filter((word) => word.length > 0 && !LINK_WORDS.has(word))
    .join(' ');
  return key.length >= 2 && key !== core ? key : null;
}

/** Datos de la fila que deciden qué alias se guardan. */
export type PeruAliasContext = {
  taxpayerType: string | null;
  workers: number | null;
};

function pushKey(keys: string[], core: string, exclude: string): void {
  if (core.length < 2 || core === exclude || keys.includes(core)) return;
  keys.push(core);
}

/**
 * Claves EXTRA de una razón social del padrón (sin su núcleo de siempre): los
 * alias de sus partes y la clave pública. Vacío para sindicatos, consorcios y
 * similares.
 */
export function peruRegistryAliasKeys(legalName: string, context: PeruAliasContext): string[] {
  const mainCore = peruCore(legalName);
  const keys: string[] = [];
  const taxpayerType = context.taxpayerType?.trim().toUpperCase() ?? '';
  if (PE_NO_ALIAS_TAXPAYER_TYPES.has(taxpayerType) || NO_ALIAS_NAME_START.test(plainUpper(legalName))) {
    return keys;
  }

  const cores = [mainCore];
  const parts = splitPeruNameParts(legalName);
  if (parts.length > 1) {
    const isPublic = PE_PUBLIC_TAXPAYER_TYPES.has(taxpayerType);
    const isLarge = context.workers !== null && context.workers >= PE_SINGLE_WORD_MIN_WORKERS;
    cores.push(peruCore(parts[parts.length - 1]));
    if (endsWithPeruLegalForm(parts[0]) || isPublic || isLarge) cores.push(peruCore(parts[0]));
  }
  for (const core of cores) {
    pushKey(keys, core, mainCore);
    const publicKey = peruPublicEntityKey(core);
    if (publicKey !== null) pushKey(keys, publicKey, mainCore);
  }
  return keys;
}

/**
 * Claves de una entidad del listado de entidades contratantes del Estado (OECE):
 * su nombre completo, la parte antes del guion (la provincia o la sigla) y sus
 * claves públicas. Aquí sí cuentan todas: es un listado oficial de entidades.
 */
export function peruPublicEntityNameKeys(entityName: string): string[] {
  const keys: string[] = [];
  const parts = splitPeruNameParts(entityName);
  const cores = [peruCore(entityName), ...parts.map(peruCore)];
  for (const core of cores) {
    pushKey(keys, core, '');
    const publicKey = peruPublicEntityKey(core);
    if (publicKey !== null) pushKey(keys, publicKey, '');
  }
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type PeruNameVariant = {
  core: string;
  origin: 'name' | 'web' | 'part' | 'without_peru' | 'with_peru' | 'public';
};

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentre algo
 * decide. El núcleo de siempre va primero.
 */
export function peruCandidateNameVariants(name: string | null | undefined): PeruNameVariant[] {
  const variants: PeruNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: PeruNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(peruCore(name), 'name');

  const beforeArrow = name.split(/\s*>\s*/)[0] ?? name;
  if (beforeArrow.includes('.')) add(peruCore(plainUpper(beforeArrow).replace(WEB_TAIL, '')), 'web');

  const parts = splitPeruNameParts(name);
  if (parts.length > 1) {
    add(peruCore(parts[0]), 'part');
    // Una parte posterior sólo si es una razón social completa («ICCGSA - Ingenieros
    // Civiles y Contratistas Generales S.A.»), nunca un descriptor («- Salud Ocupacional»).
    for (const part of parts.slice(1)) if (endsWithPeruLegalForm(part)) add(peruCore(part), 'part');
  }

  for (const variant of [...variants]) {
    // «VOLCAN COM PE» no es un nombre: su versión limpia ya está en la lista.
    if (variant.core.split(' ').length < 2 || WEB_TAIL.test(variant.core)) continue;
    if (variant.core.endsWith(' DEL PERU')) add(variant.core.slice(0, -' DEL PERU'.length), 'without_peru');
    else if (variant.core.endsWith(' PERU')) add(variant.core.slice(0, -' PERU'.length), 'without_peru');
    else {
      add(`${variant.core} DEL PERU`, 'with_peru');
      add(`${variant.core} PERU`, 'with_peru');
    }
  }

  // La clave pública de cada variante va justo detrás de ella: «Municipalidad
  // Provincial de San Martín» prueba «… SAN MARTIN» antes que «… SAN MARTIN DEL PERU».
  const ordered: PeruNameVariant[] = [];
  for (const variant of variants) {
    ordered.push(variant);
    const publicKey = peruPublicEntityKey(variant.core);
    if (publicKey !== null && !variants.some((v) => v.core === publicKey) && !ordered.some((v) => v.core === publicKey)) {
      ordered.push({ core: publicKey, origin: 'public' });
    }
  }
  return ordered;
}

/**
 * SOURCES-PE-ALIAS-OWNERSHIP-1 — los nombres PROPIOS de una sociedad del padrón:
 * su núcleo y, si es una entidad pública, su clave pública.
 */
export function peruOwnNameKeys(mainCore: string): string[] {
  const keys = mainCore.length >= 2 ? [mainCore] : [];
  const publicKey = peruPublicEntityKey(mainCore);
  if (publicKey !== null) keys.push(publicKey);
  return keys;
}

/**
 * SOURCES-PE-ALIAS-OWNERSHIP-1 — un alias nunca puede ser el nombre PROPIO de
 * otra sociedad. Medido en Prod el 06-10-2026 (corrida Perú × Salud): 1.387 de
 * 74.016 claves eran el núcleo de otra sociedad («PERU», «LIMA», o «GOBIERNO
 * REGIONAL DE LORETO» como primera parte de cada subunidad del OECE). No daban un
 * RUC equivocado (dos RUC ⇒ pista), pero le quitaban el RUC seguro a la sociedad
 * que se llama así. `owners`: nombre propio → RUC que lo llevan
 * (`peruOwnNameKeys` de cada fila del padrón).
 */
export function dropAliasKeysOwnedByOthers(
  keys: readonly string[],
  ruc: string,
  owners: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  return keys.filter((key) => {
    const ownedBy = owners.get(key);
    return ownedBy === undefined || ownedBy.has(ruc);
  });
}
