/**
 * AGENT1-CUT3B1-FISCAL-IDENTITY-TRUTH — autoridad canónica de identidad fiscal.
 *
 * ÚNICA autoridad de Agente 1 para decidir si dos filas hablan de la MISMA
 * identidad fiscal. Antes de este módulo existían varios normalizadores fiscales
 * con semánticas distintas y el chequeo de novedad gratuito comparaba una aguja
 * YA normalizada contra el valor CRUDO almacenado en la columna — de modo que una
 * misma empresa legal podía resultar invisible para la otra capa aun cuando ambas
 * poseían el mismo identificador fiscal.
 *
 * Invariante (CUT-3B1 § 3):
 *
 *     identidad fiscal automática = PAÍS + IDENTIFICADOR FISCAL CANÓNICO
 *
 * Un número fiscal desnudo NO es único globalmente: sin país NO hay igualdad
 * automática. La igualdad NO se deriva nunca de nombre, dominio, id de proveedor,
 * LinkedIn ni coincidencia difusa — esas señales pertenecen a cortes posteriores.
 *
 * Separación explícita (CUT-3B1 § 6):
 *   - VALOR ALMACENADO / DE FUENTE: conserva la representación legal de origen y
 *     NO se reescribe. Este módulo no muta filas ni hace backfill.
 *   - VALOR CANÓNICO DE COMPARACIÓN: se deriva aquí, en tiempo de comparación.
 *
 * `normalizeTaxIdentifier` (./normalization) sigue siendo el normalizador de
 * derivación de `identity_key` y NO es autoritativo para comparación: unificar esa
 * columna persistida pertenece al corte del registro (CUT-3B2), que es quien puede
 * decidir versionado/backfill.
 *
 * Sin writes. Sin llamadas a proveedores. Puro y determinístico.
 */

/**
 * Longitud canónica mínima para considerar un identificador fiscal utilizable.
 * Por debajo de esto no hay identidad: se devuelve `null` en vez de una clave
 * pobre que produciría falsos positivos.
 */
export const MIN_CANONICAL_FISCAL_LENGTH = 5;

/**
 * Etiquetas de identificador fiscal que algunas fuentes prefijan al valor.
 * Se exige separador explícito O que la etiqueta vaya seguida de un dígito, para
 * que una razón social que EMPIECE por las mismas letras no se mutile
 * ("NITROGENO SA" no es "NIT ROGENO").
 */
const FISCAL_LABEL_PREFIX = /^(NIT|RFC|RUC|RUT|CUIT|CNPJ|RNC|RTN)(?:[\s.:#-]+|(?=\d))/i;

/**
 * Dígito de verificación colombiano separado por guion al final del NIT.
 *
 * Esta regla NO se inventa aquí: es la que ya aplica `normalizeSiisNIT`
 * (src/server/source-catalog/connectors/siis-colombia/siis-snapshot-etl.ts), y el
 * DV es un valor DERIVADO del NIT base — `calculateColombianCheckDigit`
 * (src/server/prospect-batches/tax-identifier-providers/colombia.ts) lo calcula.
 * Se preserva el rango `\d{1,2}` tal cual lo define el repositorio en vez de
 * endurecerlo por cuenta propia.
 *
 * Sólo se recorta un DV SEPARADO POR GUION. Un `9001234567` sin guion se deja
 * intacto: no se adivina que su último dígito sea un DV.
 */
const CO_CHECK_DIGIT_SUFFIX = /-\d{1,2}$/;

// ─── AGENT1-FISCAL-CHECK-DIGIT-VARIANTS-1 — dígito de verificación por país ───
//
// 🔴 Compatibilidad: los reclamos globales y las comparaciones guardadas en
// Producción usan la forma canónica que este módulo YA producía. Aquí NO cambia
// la salida de ninguna entrada que ya llegaba a esa forma; sólo se llevan a ella
// las variantes que antes divergían:
//
//   · CO: `9001234567` (NIT empresarial de 9 dígitos con su DV pegado, sin guion)
//         → `900123456`, la misma forma que `900.123.456-7` y `900123456`.
//   · CL: `76123456` (RUT empresarial SIN DV) → `761234567`, la misma forma que
//         `76.123.456-7` y `761234567`.
//   · PY: `80012345` (RUC empresarial SIN DV) → `800123456`, la misma forma que
//         `80012345-6` y `800123456`.
//
// Sólo se toca la variante cuando el DV CALCULADO la respalda y el número cae en
// el rango de personas JURÍDICAS de ese país (CO 8xx/9xx de 9 dígitos, CL cuerpo
// ≥ 50.000.000, PY 80xxxxxx). Una cédula de persona (CO 10 dígitos que empieza por
// 1, CL < 50 millones) no se reinterpreta nunca: ahí no hay forma de saber si el
// último dígito es DV o parte del número.

/** DV de un NIT colombiano (DIAN), el mismo cálculo que `calculateColombianCheckDigit`. */
export function computeColombiaNitCheckDigit(base: string): number {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base.charAt(base.length - 1 - i)) * weights[i];
  }
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

/** DV de un RUT chileno (módulo 11, pesos 2..7): `'0'`–`'9'` o `'k'`. */
export function computeChileRutCheckDigit(body: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body.charAt(i)) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  if (dv === 11) return '0';
  if (dv === 10) return 'k';
  return String(dv);
}

/** DV de un RUC paraguayo (SET, módulo 11 con base 11). */
export function computeParaguayRucCheckDigit(body: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    if (weight > 11) weight = 2;
    sum += Number(body.charAt(i)) * weight;
    weight += 1;
  }
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : 0;
}

/** NIT empresarial colombiano de 9 dígitos con su DV pegado (sin guion). */
const CO_COMPANY_NIT_WITH_GLUED_DV = /^[89]\d{9}$/;
/** Cuerpo de RUT chileno de persona jurídica (≥ 50.000.000) sin DV. */
const CL_COMPANY_RUT_BODY = /^[5-9]\d{7}$/;
/** Cuerpo de RUC paraguayo de persona jurídica (80xxxxxx) sin DV. */
const PY_COMPANY_RUC_BODY = /^80\d{6}$/;

/**
 * Lleva a la forma canónica EXISTENTE las variantes de DV que antes divergían.
 * `value` ya viene sin etiqueta, sin puntuación y en minúsculas; `hadSeparator`
 * dice si la entrada traía un separador explícito antes del DV.
 */
function alignCheckDigitVariant(value: string, namespace: string, hadSeparator: boolean): string {
  if (hadSeparator) return value;
  if (namespace === 'CO' && CO_COMPANY_NIT_WITH_GLUED_DV.test(value)) {
    const base = value.slice(0, 9);
    return computeColombiaNitCheckDigit(base) === Number(value.charAt(9)) ? base : value;
  }
  if (namespace === 'CL' && CL_COMPANY_RUT_BODY.test(value)) {
    // Si las 8 cifras ya son «7 de cuerpo + DV» válidos, se dejan como están: es la
    // lectura que ya se guardaba y no se adivina otra.
    const asBodyAndDv = computeChileRutCheckDigit(value.slice(0, 7)) === value.charAt(7);
    return asBodyAndDv ? value : `${value}${computeChileRutCheckDigit(value)}`;
  }
  if (namespace === 'PY' && PY_COMPANY_RUC_BODY.test(value)) {
    // Sin la salvaguarda de Chile a propósito: «7 de cuerpo + DV» que empiece por
    // 80 sería una cédula ≥ 8.000.000, numeración que Paraguay no ha emitido; las
    // 8 cifras 80xxxxxx son el cuerpo de un RUC de persona jurídica.
    return `${value}${computeParaguayRucCheckDigit(value)}`;
  }
  return value;
}

/** Clave de identidad fiscal con ámbito de país: `<PAÍS>:<canónico>`. */
export type FiscalIdentityKey = string;

/** Ámbito de país resuelto para una comparación fiscal. */
export type FiscalCountryScope = {
  /** Valor tal cual se envía al filtro de base de datos (se preserva el original recortado). */
  queryValue: string;
  /** Namespace estable de la clave (mayúsculas), para que `co` y `CO` no partan el índice. */
  namespace: string;
};

/**
 * Resuelve el ámbito de país. `null` cuando no hay país: sin país NO puede haber
 * igualdad fiscal automática (CUT-3B1 § 8).
 */
export function resolveFiscalCountryScope(
  countryCode: string | null | undefined,
): FiscalCountryScope | null {
  if (countryCode == null) return null;
  const trimmed = countryCode.trim();
  if (!trimmed) return null;
  return { queryValue: trimmed, namespace: trimmed.toUpperCase() };
}

/**
 * Canonicaliza un identificador fiscal para COMPARACIÓN.
 *
 * Determinística, pura y sin fabricar identidad: sólo normaliza diferencias de
 * REPRESENTACIÓN (etiqueta, puntuación, espaciado, caja) y, en Colombia, el DV
 * separado por guion que el repositorio ya trata como derivado.
 *
 * Devuelve `null` para entrada nula/vacía/inutilizable: un valor no utilizable
 * NUNCA se convierte en una clave de identidad.
 *
 * @example
 * canonicalizeFiscalIdentifier('900.123.456', 'CO')     → '900123456'
 * canonicalizeFiscalIdentifier('NIT 900.123.456', 'CO') → '900123456'
 * canonicalizeFiscalIdentifier('900123456-7', 'CO')     → '900123456'   // DV derivado
 * canonicalizeFiscalIdentifier('8909039388', 'CO')      → '890903938'   // DV pegado que el cálculo respalda
 * canonicalizeFiscalIdentifier('1012345678', 'CO')      → '1012345678'  // cédula: no se adivina DV
 * canonicalizeFiscalIdentifier('ABC-123456-AB1', 'MX')  → 'abc123456ab1'
 * canonicalizeFiscalIdentifier('12', 'CO')              → null
 * canonicalizeFiscalIdentifier(null)                    → null
 */
export function canonicalizeFiscalIdentifier(
  value: string | null | undefined,
  countryCode?: string | null,
): string | null {
  if (value == null) return null;
  let v = value.trim();
  if (!v) return null;

  v = v.replace(FISCAL_LABEL_PREFIX, '').trim();
  if (!v) return null;

  // Semántica por país: hoy sólo Colombia tiene una regla canónica soportada por
  // el repositorio (el DV derivado). Para el resto de países no se inventa
  // ninguna: el país entra en la identidad por el ÁMBITO OBLIGATORIO de la clave.
  const scope = resolveFiscalCountryScope(countryCode);
  if (scope?.namespace === 'CO') {
    v = v.replace(/[\s.]/g, '').replace(/[–—]/g, '-').replace(CO_CHECK_DIGIT_SUFFIX, '');
  }

  // AGENT1-FISCAL-CHECK-DIGIT-VARIANTS-1 — ¿la entrada separaba el DV? (`-7`, `-K`).
  const hadSeparator = /[-–—]\s*[0-9kK]$/.test(v);

  v = v.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (v.length < MIN_CANONICAL_FISCAL_LENGTH) return null;
  return scope ? alignCheckDigitVariant(v, scope.namespace, hadSeparator) : v;
}

/**
 * Compone la clave de identidad fiscal con ámbito de país.
 * `null` cuando falta el canónico O falta el país — jamás una coincidencia
 * transfronteriza a partir del identificador desnudo.
 */
export function buildFiscalIdentityKey(params: {
  canonical: string | null;
  countryCode: string | null | undefined;
}): FiscalIdentityKey | null {
  const { canonical } = params;
  if (!canonical) return null;
  const scope = resolveFiscalCountryScope(params.countryCode);
  if (!scope) return null;
  return `${scope.namespace}:${canonical}`;
}

/** Atajo: canonicaliza y compone la clave en un paso. */
export function buildFiscalIdentityKeyFromRaw(params: {
  value: string | null | undefined;
  countryCode: string | null | undefined;
}): FiscalIdentityKey | null {
  const canonical = canonicalizeFiscalIdentifier(params.value, params.countryCode);
  return buildFiscalIdentityKey({ canonical, countryCode: params.countryCode });
}

// ─── Compatibilidad de columnas: tax_id vs tax_identifier ─────────────────────

/** De qué columna(s) compatible(s) salió la identidad fiscal de una fila. */
export type StoredFiscalIdentitySource = 'tax_id' | 'tax_identifier' | 'both';

export type StoredFiscalIdentity =
  /** Ninguna columna compatible aporta un identificador utilizable. */
  | { kind: 'absent'; canonical: null; source: null }
  /**
   * Las DOS columnas traen identificadores que canonicalizan DISTINTO.
   * FAIL CLOSED: no se elige una arbitrariamente ni se suprime al candidato.
   */
  | {
      kind: 'conflict';
      canonical: null;
      source: null;
      taxIdCanonical: string;
      taxIdentifierCanonical: string;
    }
  | { kind: 'resolved'; canonical: string; source: StoredFiscalIdentitySource };

/**
 * Lectura de compatibilidad para filas históricas y actuales de
 * `prospect_candidates`.
 *
 * La ruta gratuita escribe `tax_id` Y `tax_identifier`; las rutas de PAGO escriben
 * habitualmente sólo `tax_identifier`. Una identidad fiscal debe reconocerse sin
 * importar qué columna compatible pobló el escritor.
 *
 * NO crea migración, NO hace backfill y NO reescribe filas: la compatibilidad es
 * una semántica de LECTURA (CUT-3B1 § 5 y § 6).
 */
export function resolveStoredFiscalIdentity(
  row: { tax_id?: string | null; tax_identifier?: string | null },
  countryCode?: string | null,
): StoredFiscalIdentity {
  const fromTaxId = canonicalizeFiscalIdentifier(row.tax_id, countryCode);
  const fromTaxIdentifier = canonicalizeFiscalIdentifier(row.tax_identifier, countryCode);

  if (fromTaxId && fromTaxIdentifier) {
    if (fromTaxId === fromTaxIdentifier) {
      return { kind: 'resolved', canonical: fromTaxId, source: 'both' };
    }
    return {
      kind: 'conflict',
      canonical: null,
      source: null,
      taxIdCanonical: fromTaxId,
      taxIdentifierCanonical: fromTaxIdentifier,
    };
  }

  if (fromTaxId) return { kind: 'resolved', canonical: fromTaxId, source: 'tax_id' };
  if (fromTaxIdentifier) {
    return { kind: 'resolved', canonical: fromTaxIdentifier, source: 'tax_identifier' };
  }
  return { kind: 'absent', canonical: null, source: null };
}

// ─── Agujas de búsqueda ───────────────────────────────────────────────────────

export type FiscalLookupNeedles = {
  /** Identificadores canónicos únicos de la entrada. */
  canonical: string[];
  /**
   * Superconjunto acotado para el filtro `.in(...)` de base de datos: el valor
   * CRUDO recortado y su canónico. El filtro es sólo un PREFILTRO respaldado por
   * índice; la igualdad canónica en memoria es la AUTORIDAD.
   */
  lookupValues: string[];
};

/**
 * Variantes de REPRESENTACIÓN de un identificador canónico que el prefiltro debe
 * poder alcanzar, además del propio canónico.
 *
 * La única variante que este corte genera es la colombiana: el canónico con un
 * DV de un dígito separado por guion. No se adivina CUÁL es el DV correcto —
 * se enumeran los diez posibles y la igualdad canónica en memoria decide. Es
 * exactamente el eje que separa a las dos capas de Agente 1 en Colombia:
 *   - la ruta oficial/de PAGO almacena `nnnnnnnnn-d` (`cleanNit` en
 *     tax-identifier-providers/colombia.ts sólo quita espacios y puntos);
 *   - la ruta gratuita almacena el valor crudo de co_siis, que puede no traer DV.
 *
 * Nota de asimetría deliberada: la regla de RECORTE que hereda el repositorio
 * (`normalizeSiisNIT`) tolera `-\d{1,2}`, pero aquí sólo se GENERA un dígito.
 * Generar DV de dos dígitos sería inventar una representación que ninguna fuente
 * del repositorio produce.
 */
function fiscalRepresentationVariants(
  canonical: string,
  countryCode?: string | null,
): string[] {
  const scope = resolveFiscalCountryScope(countryCode);
  if (scope?.namespace === 'CL' || scope?.namespace === 'PY') {
    // AGENT1-FISCAL-CHECK-DIGIT-VARIANTS-1 — el canónico ya lleva el DV pegado;
    // el prefiltro también tiene que alcanzar la fila guardada con guion
    // (`76123456-7`), que es como la publican el SII y la SET.
    return canonical.length >= 6 ? [`${canonical.slice(0, -1)}-${canonical.slice(-1)}`] : [];
  }
  if (scope?.namespace !== 'CO') return [];
  const variants = Array.from({ length: 10 }, (_, digit) => `${canonical}-${digit}`);
  // AGENT1-FISCAL-CHECK-DIGIT-VARIANTS-1 — y el NIT empresarial guardado con su
  // DV PEGADO (`9001234567`), que ahora canonicaliza igual que `900123456`.
  if (/^[89]\d{8}$/.test(canonical)) {
    variants.push(`${canonical}${computeColombiaNitCheckDigit(canonical)}`);
  }
  return variants;
}

/**
 * Construye las agujas de búsqueda a partir de los identificadores fiscales de
 * entrada.
 *
 * El superconjunto del prefiltro es {valor crudo} ∪ {canónico} ∪ {variantes de
 * representación}. Cubre los dos formatos que las capas gratuita y de PAGO
 * producen realmente hoy.
 *
 * Limitación conocida y DECLARADA de CUT-3B1: sin columna canónica ni índice de
 * expresión (ambos exigirían migración, fuera de alcance en este corte), el
 * prefiltro no alcanza una fila almacenada con una puntuación arbitraria que
 * ninguna aguja ni variante reproduzca (p. ej. un tercer escritor que guardara
 * `900.123.456-7` mientras la aguja llega sin puntos). Esa deriva residual queda
 * reportada para un corte posterior. Lo que este corte SÍ garantiza es que
 * ninguna fila leída se acepta sin igualdad CANÓNICA verificada en memoria: el
 * prefiltro nunca puede producir un falso positivo, sólo un falso negativo.
 */
export function buildFiscalLookupNeedles(
  values: ReadonlyArray<string | null | undefined>,
  countryCode?: string | null,
): FiscalLookupNeedles {
  const canonical = new Set<string>();
  const lookupValues = new Set<string>();

  for (const value of values) {
    if (value == null) continue;
    const raw = value.trim();
    if (!raw) continue;
    const canon = canonicalizeFiscalIdentifier(raw, countryCode);
    if (!canon) continue;
    canonical.add(canon);
    lookupValues.add(raw);
    lookupValues.add(canon);
    for (const variant of fiscalRepresentationVariants(canon, countryCode)) {
      lookupValues.add(variant);
    }
  }

  return { canonical: [...canonical], lookupValues: [...lookupValues] };
}
