/**
 * structured-discovery-provenance.ts — la frontera TIPADA y VALIDADA EN TIEMPO
 * DE EJECUCIÓN entre la metadata arbitraria de un adapter de discovery y la fila
 * que se persiste en `prospect_candidates.metadata`.
 *
 * AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1 §§ 2, 3, 6.
 *
 * ── 🔴 Por qué una allowlist de CLAVES no era suficiente ─────────────────────
 *
 * La primera versión de este fix copiaba `metadata[key]` como `unknown` para tres
 * claves autorizadas. Eso deja la puerta abierta al mismo daño que pretendía
 * cerrar: un adapter con un defecto —o mal escrito— puede persistir un objeto
 * entero bajo una clave permitida.
 *
 *     { discovery_layer: { email: '…', raw_payload: { … } } }
 *
 * La clave está en la allowlist; el VALOR es un payload crudo con PII. Con la
 * allowlist de claves sola, esa fila llega a la base de datos. Por eso la
 * frontera valida también el valor de cada clave, y cualquier valor que no
 * encaje se OMITE — nunca se coacciona a texto, porque `String({email})` sería
 * exactamente la misma fuga con otra forma.
 *
 * ── 🔴 Sin una segunda taxonomía macro (§ 5 del hito base) ───────────────────
 *
 * `macro_industry_key` NO se valida contra una lista propia. La única autoridad
 * de la taxonomía macro en código es `@/modules/macro-industry-catalog/
 * macro-industries`, y aquí se consume su predicado `isMacroIndustryKey`. Un
 * segundo hardcode de las 12 claves es precisamente lo que ese módulo prohíbe.
 *
 * ── Dónde se aplica ──────────────────────────────────────────────────────────
 *
 * DOS veces, a propósito:
 *
 *   1. En `adaptCandidate`, al traducir un `SourceDiscoveryCandidate` (cuya
 *      `metadata` es `Record<string, unknown>` sin contrato).
 *   2. En la construcción del `metadata` de la fila, justo antes del INSERT.
 *
 * El paso 2 no es redundante: el writer también acepta
 * `StructuredSourceCandidateDraft` YA construidos, que `adaptCandidate` devuelve
 * intactos (duck typing sobre `hubspotTrace`/`commercialTrace`). Sin la segunda
 * pasada, un caller podría fabricar `discoveryProvenance: { raw_payload: … }` y
 * saltarse la frontera entera. La defensa tiene que sostenerse en el límite de
 * la FILA, no sólo en el de la adaptación.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

import {
  isMacroIndustryKey,
  type MacroIndustryKey,
} from '@/modules/macro-industry-catalog/macro-industries';

/**
 * Capa de discovery gratuita previa al pago (Colombia · co_siis).
 *
 * Vive aquí, en la frontera de persistencia, porque es la frontera la que tiene
 * que saber qué valores son legítimos para poder rechazar el resto. Los
 * productores la IMPORTAN en vez de repetir el literal.
 */
export const COUNTRY_SOURCE_PREPAID_DISCOVERY_LAYER = 'country_source_prepaid' as const;

/**
 * El conjunto CERRADO de capas de discovery que pueden persistirse.
 *
 * Hoy hay una. Añadir otra es añadirla aquí — y eso es deliberado: una capa que
 * nadie declaró no debe poder escribirse porque un adapter la nombre.
 */
export const STRUCTURED_DISCOVERY_LAYERS = [
  COUNTRY_SOURCE_PREPAID_DISCOVERY_LAYER,
] as const;

export type StructuredDiscoveryLayer = (typeof STRUCTURED_DISCOVERY_LAYERS)[number];

/**
 * Procedencia de discovery persistible. Tipo ESTRECHO, no `Record<string,
 * unknown>`: cada clave tiene un tipo concreto y no hay clave índice, así que el
 * compilador rechaza `{ raw_payload: … }` en cualquier caller tipado.
 *
 * Todas opcionales: una procedencia que la fuente no calculó no se inventa.
 */
export type StructuredDiscoveryProvenance = {
  /** Qué capa de discovery produjo el candidato. */
  discovery_layer?: StructuredDiscoveryLayer;
  /** Clave canónica de la macro industria (autoridad: macro-industries). */
  macro_industry_key?: MacroIndustryKey;
  /** ¿La fuente traía sitio web? Booleano estricto, jamás `'false'`. */
  website_available?: boolean;
};

/** ¿Es este valor una capa de discovery declarada? */
export function isStructuredDiscoveryLayer(
  value: unknown,
): value is StructuredDiscoveryLayer {
  return (
    typeof value === 'string' &&
    (STRUCTURED_DISCOVERY_LAYERS as readonly string[]).includes(value)
  );
}

/**
 * ¿Es un objeto llano del que se puede leer una propiedad propia?
 *
 * Los arrays se excluyen explícitamente: `['health_pharma', {…}]` es un valor
 * malformado, no una procedencia, y `key in array` podría dar sorpresas.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lee una propiedad PROPIA. Nada heredado del prototipo cuenta: `key in obj`
 * habría aceptado una clave inyectada vía `__proto__`.
 */
function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/**
 * Normaliza cualquier valor a una procedencia persistible.
 *
 * Contrato:
 *
 *   - entrada que no es objeto llano (undefined, null, array, string, número) ⇒ `{}`;
 *   - `discovery_layer` sobrevive SÓLO si es una capa declarada;
 *   - `macro_industry_key` sobrevive SÓLO si es clave canónica del catálogo macro;
 *   - `website_available` sobrevive SÓLO si es `boolean` (incluido `false`);
 *   - cualquier otra clave NO se copia, exista o no en la entrada;
 *   - un valor inválido se OMITE. No se coacciona, no se trunca, no se serializa.
 *
 * El objeto devuelto es nuevo: la entrada nunca se muta.
 */
export function sanitizeStructuredDiscoveryProvenance(
  value: unknown,
): StructuredDiscoveryProvenance {
  if (!isPlainRecord(value)) return {};

  const provenance: StructuredDiscoveryProvenance = {};

  const layer = ownValue(value, 'discovery_layer');
  if (isStructuredDiscoveryLayer(layer)) {
    provenance.discovery_layer = layer;
  }

  const macro = ownValue(value, 'macro_industry_key');
  // 🔴 `isMacroIndustryKey` acepta `string | null | undefined`; un objeto o un
  // array tienen que quedar fuera ANTES de llamarla.
  if (typeof macro === 'string' && isMacroIndustryKey(macro)) {
    provenance.macro_industry_key = macro;
  }

  const websiteAvailable = ownValue(value, 'website_available');
  if (typeof websiteAvailable === 'boolean') {
    provenance.website_available = websiteAvailable;
  }

  return provenance;
}
