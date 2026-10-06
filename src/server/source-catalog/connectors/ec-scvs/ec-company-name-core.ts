/**
 * ec-company-name-core.ts — núcleo comparable del nombre de una compañía
 * ecuatoriana (Superintendencia de Compañías, `ec_scvs`).
 *
 * SOURCES-EC-RUC-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * El MISMO cálculo se usa al completar `normalized_legal_name` de `ec_scvs` y al
 * buscar una empresa por nombre dentro de la corrida del Agente 1. La versión SQL
 * de la migración de datos (`EC_COMPANY_NAME_CORE_SQL`) replica esta función; su
 * equivalencia se verifica contra una muestra antes de escribir.
 *
 * Núcleo = mayúsculas, sin tildes, sólo letras/dígitos/&, espacios simples y sin
 * la forma societaria final («S.A.», «S.A.S.», «CIA. LTDA.», «C LTDA»…).
 *
 * 🔴 «EN LIQUIDACIÓN» NO se quita a propósito: una compañía en liquidación
 * conserva ese texto en su núcleo y por eso nunca coincide con el nombre de una
 * empresa activa. Nunca recibe el RUC de otra, ni otra el suyo.
 */

/**
 * Formas societarias ecuatorianas, más largas primero.
 *
 * SOURCES-EC-CLOSE-1 — Prod 06-10: unos 5.000 nombres de `ec_scvs` conservaban la
 * forma al final porque no estaba en la lista: «B.I.C.» (sociedad de beneficio e
 * interés colectivo, 2.295), «C.L.» (abreviatura de compañía limitada, 1.963),
 * «COMPAÑÍA ANÓNIMA» (321) y formas extranjeras con sucursal en Ecuador («S.L.»,
 * «S.R.L.», «S.A.C.», «INC.», «L.L.C.»). Las empresas públicas terminan en «E.P.»
 * («CNT EP») y las de economía mixta en «C.E.M.». Se quitan de una en una, así
 * que las apiladas («CIA. LTDA. B.I.C.») también salen.
 */
export const EC_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD POR ACCIONES SIMPLIFICADA',
  'COMPANIA DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD CIVIL Y COMERCIAL',
  'COMPANIA LIMITADA',
  'COMPANIA ANONIMA',
  'SOCIEDAD ANONIMA',
  'EMPRESA PUBLICA',
  'SOCIEDAD CIVIL',
  'CIA ANONIMA',
  'CIA LTDA',
  'C LTDA',
  'S A S',
  'S A C',
  'S R L',
  'L L C',
  'B I C',
  'C E M',
  'S C C',
  'S A',
  'C A',
  'C L',
  'S L',
  'S C',
  'E P',
  'LTDA',
  'CIA',
  'SAS',
  'SAC',
  'SRL',
  'LLC',
  'INC',
  'BIC',
  'CEM',
  'SA',
  'CA',
  'EP',
];

/** Núcleo comparable del nombre, o cadena vacía si no queda nada. */
export function normalizeEcCompanyCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';

  let core = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    for (const form of EC_LEGAL_FORMS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/** Formas que aparecen en MITAD de la razón social, separando nombre y sigla. */
const EC_MID_NAME_FORMS: readonly string[] = ['CIA LTDA', 'C LTDA', 'S A S', 'S A', 'C A', 'SAS', 'SA', 'CA'];

/** Una sigla o un nombre corto que puede ser la marca: 1 a 3 palabras. */
const MAX_ALIAS_WORDS = 3;
const MIN_ALIAS_LENGTH = 3;

/**
 * Lo que va entre paréntesis a veces es un lugar, no la marca: «G4S SECURE
 * SOLUTIONS (ECUADOR)», «INTERNATIONAL WATER SERVICES ( GUAYAQUIL ) INTERAGUA».
 * País, ciudades grandes y provincias nunca son el otro nombre de una compañía.
 */
const EC_PLACE_ALIASES: ReadonlySet<string> = new Set([
  'ECUADOR', 'DEL ECUADOR', 'ECUATORIANA', 'ECUATORIANO', 'ECUADOR SUCURSAL', 'SUCURSAL ECUADOR', 'SUCURSAL',
  'QUITO', 'GUAYAQUIL', 'CUENCA', 'AZUAY', 'BOLIVAR', 'CANAR', 'CARCHI', 'CHIMBORAZO', 'COTOPAXI',
  'EL ORO', 'ESMERALDAS', 'GALAPAGOS', 'GUAYAS', 'IMBABURA', 'LOJA', 'LOS RIOS', 'MANABI',
  'MORONA SANTIAGO', 'NAPO', 'ORELLANA', 'PASTAZA', 'PICHINCHA', 'SANTA ELENA', 'SANTO DOMINGO',
  'SUCUMBIOS', 'TUNGURAHUA', 'ZAMORA CHINCHIPE', 'MANTA', 'MACHALA', 'AMBATO',
]);

function usableAlias(alias: string, core: string): string | null {
  const words = alias.split(' ').filter((w) => w.length > 0);
  if (alias.length < MIN_ALIAS_LENGTH || words.length === 0 || words.length > MAX_ALIAS_WORDS) return null;
  if (alias === core || EC_LEGAL_FORMS.includes(alias) || /\bLIQUIDACION\b/.test(alias)) return null;
  if (EC_PLACE_ALIASES.has(alias)) return null;
  // Sólo números («2000») o sólo iniciales sueltas («A Y A») no identifican a nadie.
  if (!/[A-Z]/.test(alias) || words.every((w) => w.length === 1)) return null;
  return alias;
}

/**
 * SOURCES-EC-CLOSE-1 — el OTRO nombre por el que se conoce a una compañía, sacado
 * de su propia razón social. Las grandes de Ecuador se registran así:
 *
 *   «CONSORCIO ECUATORIANO DE TELECOMUNICACIONES S.A. CONECEL» → «CONECEL»
 *   «PROCESADORA NACIONAL DE ALIMENTOS C.A. PRONACA»           → «PRONACA»
 *   «DISTRIBUIDORA FARMACEUTICA ECUATORIANA (DIFARE) S.A.»      → «DIFARE»
 *   «EMBARFRU S.A. EMBARCADORA DE FRUTAS TROPICALES»            → «EMBARFRU»
 *
 * y Apollo, Tavily o Claude las nombran por la sigla. Regla, en este orden:
 *   1. lo que va entre paréntesis (1 a 3 palabras);
 *   2. con una forma societaria en mitad del nombre: la palabra que la sigue si es
 *      UNA sola (la sigla); si la siguen varias, lo que va antes (1 a 3 palabras).
 * Si no hay ninguna de las dos, `null`. Nunca devuelve el núcleo completo ni una
 * forma societaria. Puro.
 */
export function ecCompanyNameAlias(legalName: string | null | undefined): string | null {
  if (typeof legalName !== 'string' || legalName.trim().length === 0) return null;
  const core = normalizeEcCompanyCore(legalName);
  // Una compañía en liquidación nunca presta otro nombre a una activa.
  if (core.length === 0 || /\bLIQUIDACION\b/.test(core)) return null;

  const parenthesized = /\(([^()]{2,60})\)/.exec(legalName);
  if (parenthesized) {
    const alias = usableAlias(normalizeEcCompanyCore(parenthesized[1]), core);
    if (alias !== null) return alias;
  }

  for (const form of EC_MID_NAME_FORMS) {
    const at = core.indexOf(` ${form} `);
    if (at <= 0) continue;
    const before = core.slice(0, at).trim();
    const after = normalizeEcCompanyCore(core.slice(at + form.length + 2));
    const afterWords = after.split(' ').filter((w) => w.length > 0);
    const alias = afterWords.length === 1 ? usableAlias(after, core) : usableAlias(before, core);
    if (alias !== null) return alias;
  }
  return null;
}

/**
 * Versión SQL (PostgreSQL) de `normalizeEcCompanyCore` sobre la columna `legal_name`,
 * para completar `normalized_legal_name` en una sola sentencia.
 *
 * Diferencia conocida y SEGURA: SQL sólo quita las tildes del castellano (no todas
 * las marcas combinantes, como hace NFD). Un nombre con otra marca queda con un
 * núcleo distinto al de TypeScript y simplemente no coincide: nunca produce una
 * coincidencia falsa. La forma se quita hasta 3 veces (nunca hay más apiladas).
 */
export const EC_COMPANY_NAME_CORE_SQL = (() => {
  const forms = EC_LEGAL_FORMS.join('|');
  const base =
    "btrim(regexp_replace(regexp_replace(upper(translate(legal_name, " +
    "'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖáéíóúüñàèìòùâêîôûäëïö', " +
    "'AEIOUUNAEIOUAEIOUAEIOaeiouunaeiouaeiouaeio')), '[^A-Z0-9& ]', ' ', 'g'), '\\s+', ' ', 'g'))";
  const strip = (expr: string) => `regexp_replace(${expr}, ' (${forms})$', '')`;
  return `btrim(${strip(strip(strip(base)))})`;
})();
