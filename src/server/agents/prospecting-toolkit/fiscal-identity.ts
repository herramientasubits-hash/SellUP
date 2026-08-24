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
 * canonicalizeFiscalIdentifier('9001234567', 'CO')      → '9001234567'  // sin guion: no se adivina DV
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

  v = v.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (v.length < MIN_CANONICAL_FISCAL_LENGTH) return null;
  return v;
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
  if (scope?.namespace !== 'CO') return [];
  return Array.from({ length: 10 }, (_, digit) => `${canonical}-${digit}`);
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
