/**
 * adopted-batch-truth.ts — ¿qué puede escribir un contribuyente sobre un lote
 * que YA existía cuando llegó?
 *
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-2 (BATCH TRUTHFULNESS) · P0.
 *
 * CUT-1 defendió que un contribuyente posterior no pueda BORRAR semánticamente
 * las filas durables de un lote. Este corte defiende algo distinto y adyacente:
 * que no pueda REDEFINIR la petición que creó el lote.
 *
 * El defecto que cierra: la UPDATE de adopción del escritor escribe hoy
 * `name`, `country`, `country_code`, `industry`, `target_count`, `search_depth`
 * y `metadata` con los valores de LA INVOCACIÓN ACTUAL. Sobre un lote nuevo eso
 * es correcto —el escritor es su dueño—. Sobre un lote ADOPTADO es «gana el
 * último que escribe», y en el mundo mixto que viene eso miente:
 *
 *   objetivo del wizard = 10
 *   aporte gratuito     = 7
 *   residual de pago    = 3
 *
 * El contribuyente de pago llega con `target_count = 3` —su residual— y hoy lo
 * escribiría encima del 10 del usuario. El lote pasaría a anunciar que se
 * pidieron 3 empresas. Lo mismo con el país, la industria y el nombre: un
 * proveedor con su propia clasificación local reescribiría la del usuario.
 *
 * La invariante que se defiende:
 *
 *   LA IDENTIDAD GLOBAL DE LA PETICIÓN ES DEL LOTE, NO DEL CONTRIBUYENTE.
 *
 * Un contribuyente puede añadir candidatos, añadir SU telemetría y decidir el
 * estado terminal según CUT-1. No puede reescribir de qué iba la petición.
 *
 * ── Por qué «no nulo existente gana» y no «existente gana» a secas ───────────
 *
 * `reserveWizardExecutionSlot` (wizard-idempotency.ts) crea la fila del lote con
 * SÓLO `name`, `status`, `source`, `created_by`, `client_request_id` y
 * `metadata`. `country`, `country_code`, `industry` y `target_count` nacen NULL:
 * quien los establece hoy es precisamente esta UPDATE de adopción. Una regla de
 * «lo existente gana siempre» los dejaría NULL para siempre y el lote perdería
 * su identidad entera — una mentira mayor que la que este corte arregla.
 *
 * La regla correcta es por tanto EL PRIMERO ESTABLECE:
 *
 *   · columna con valor  ⇒ es la verdad de la petición, se PRESERVA;
 *   · columna en NULL    ⇒ no hay verdad que proteger, el contribuyente la FIJA.
 *
 * Puro: sin I/O, sin Supabase, sin env, sin React, sin reloj.
 *
 * ALCANCE: la forma del PATCH de adopción. Este módulo NO crea lotes, NO decide
 * estado (eso es CUT-1), NO toca `source` y NO toca candidatos.
 */

// ─── Columnas de identidad global de la petición ──────────────────────────────

/**
 * Columnas de `prospect_batches` que describen LA PETICIÓN, no el aporte de
 * quien escribe. Enumeradas de forma explícita y cerrada: una columna nueva
 * tiene que decidirse aquí a mano, nunca heredar una regla por parecido.
 *
 * 🔴 `source` NO está en la lista, y es deliberado: su protección ya la ejerce
 * la validación de adopción del escritor —que RECHAZA cualquier lote cuyo
 * `source` no sea `agent_1`— y el PATCH de adopción nunca lo ha llevado. Meterlo
 * aquí sugeriría que este módulo gobierna un vocabulario que no gobierna.
 *
 * 🔴 `country_name` NO existe en el esquema (migración 040): el país vive en
 * `country` (nombre) y `country_code` (ISO). No se inventa la columna.
 */
export const REQUEST_GLOBAL_BATCH_COLUMNS = [
  'name',
  'country',
  'country_code',
  'industry',
  'target_count',
  'search_depth',
] as const;

export type RequestGlobalBatchColumn = (typeof REQUEST_GLOBAL_BATCH_COLUMNS)[number];

/**
 * Claves de `metadata` que produce el escritor de candidatos POR SÍ MISMO (su
 * bloque observacional). Son las únicas que puede actualizar sobre un lote
 * adoptado: un reintento del mismo contribuyente reescribe su propia telemetría
 * —que es el comportamiento canónico— y nada más.
 *
 * Se pasan como dato, no se enumeran aquí: el dueño del conjunto es el propio
 * escritor, y duplicar su lista en este módulo sólo crearía deriva silenciosa.
 */

/**
 * Claves de `metadata` que pertenecen a la capa GRATUITA / de fuente
 * estructurada (`structured-source-candidate-writer.ts` +
 * `persist-country-source-candidates.ts`).
 *
 * Por qué existe esta lista: una clave que pertenece a los DOS dueños —al
 * bloque observacional del escritor y al bloque de origen gratuito— no puede
 * resolverse «gana el de pago» sin borrar verdad ajena. Cuando hay disputa, la
 * resolución es CONSERVADORA: gana lo que ya estaba.
 *
 * Hoy la intersección con el bloque del escritor es exactamente `warning`.
 */
export const STRUCTURED_SOURCE_BATCH_METADATA_KEYS = [
  'initiated_by',
  'agent_run_id',
  'batch_type',
  'source_channels',
  'structured_source_keys',
  'source_provider',
  'source_key',
  'source_discovery_mode',
  'country_code',
  'industry',
  'target_count',
  'preview_mode',
  'human_review_required',
  'hubspot_sync_enabled',
  'run_hubspot_check',
  'total_candidates_input',
  'total_candidates_written',
  'total_candidates_skipped',
  'writer_version',
  'dataset',
  'ui_smoke_test',
  'warning',
  'discovery_layer',
  'macro_industry_key',
] as const;

// ─── Fusión de metadata con dueño ─────────────────────────────────────────────

export interface AdoptedBatchMetadataMergeInput {
  /** Metadata que la fila del lote YA tenía. Cualquier forma no-objeto ⇒ `{}`. */
  existingMetadata: unknown;
  /** Metadata que trae el contribuyente actual. */
  incomingMetadata: Record<string, unknown> | null | undefined;
  /**
   * Claves que el contribuyente produce por sí mismo. Sólo estas pueden pisar
   * un valor previo — y ni siquiera estas si además son de origen gratuito.
   */
  contributorOwnedKeys: readonly string[];
}

export interface AdoptedBatchMetadataMergeResult {
  metadata: Record<string, unknown>;
  /** Claves entrantes que NO se escribieron porque ya había verdad ajena. */
  preservedKeys: string[];
  /** Claves entrantes que se añadieron porque no existían. */
  addedKeys: string[];
  /** Claves propias del contribuyente que actualizó legítimamente. */
  updatedOwnKeys: string[];
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fusiona la metadata de un lote ADOPTADO respetando al dueño de cada clave.
 *
 * Reemplaza el `{ ...existingMeta, ...batchMetadata }` anterior, que era «gana
 * el contribuyente actual» sobre TODA colisión, incluida la metadata del wizard
 * y la de origen gratuito.
 *
 * Tres reglas, en este orden:
 *
 *   1. clave ausente en lo existente        ⇒ se AÑADE (aditivo, siempre);
 *   2. clave propia del contribuyente y NO
 *      disputada con el origen gratuito     ⇒ se ACTUALIZA (§ 12-C);
 *   3. cualquier otra colisión              ⇒ GANA LO EXISTENTE (§ 12-B/§ 12-D).
 *
 * La regla 3 cubre a la vez la metadata del wizard (`request_source`,
 * `catalog_version_id`, `industry_id`, `subindustry_ids`, `country_code`,
 * `additional_criteria`, `run_provider_selection`, `apollo_discovery_taxonomy`),
 * los bloques de origen gratuito y cualquier clave DESCONOCIDA que dejara un
 * contribuyente futuro: sin dueño probado, no se pisa.
 *
 * Sin metadata entrante el resultado es equivalente clave a clave a lo
 * existente: adoptar no puede vaciar un lote de su historia.
 */
export function mergeAdoptedBatchMetadata(
  input: AdoptedBatchMetadataMergeInput,
): AdoptedBatchMetadataMergeResult {
  const existing = isPlainRecord(input.existingMetadata) ? input.existingMetadata : {};
  const incoming = isPlainRecord(input.incomingMetadata) ? input.incomingMetadata : {};

  const contributorOwned = new Set(input.contributorOwnedKeys);
  const structuredSourceOwned = new Set<string>(STRUCTURED_SOURCE_BATCH_METADATA_KEYS);

  const metadata: Record<string, unknown> = { ...existing };
  const preservedKeys: string[] = [];
  const addedKeys: string[] = [];
  const updatedOwnKeys: string[] = [];

  for (const key of Object.keys(incoming)) {
    if (!Object.prototype.hasOwnProperty.call(existing, key)) {
      metadata[key] = incoming[key];
      addedKeys.push(key);
      continue;
    }

    // Clave disputada: la reclaman el bloque del contribuyente Y el de origen
    // gratuito. No hay dueño único ⇒ no se pisa (§ 12-B: nunca «gana el pago»
    // en silencio).
    const contested = contributorOwned.has(key) && structuredSourceOwned.has(key);

    if (contributorOwned.has(key) && !contested) {
      metadata[key] = incoming[key];
      updatedOwnKeys.push(key);
      continue;
    }

    preservedKeys.push(key);
  }

  return { metadata, preservedKeys, addedKeys, updatedOwnKeys };
}

// ─── PATCH de adopción ────────────────────────────────────────────────────────

/** Fila del lote tal y como está ANTES de adoptarlo. */
export interface ExistingAdoptedBatchRow {
  name?: string | null;
  country?: string | null;
  country_code?: string | null;
  industry?: string | null;
  target_count?: number | null;
  search_depth?: string | null;
  metadata?: unknown;
}

/** Lo que el contribuyente actual traería si el lote fuese suyo. */
export interface AdoptingContributorContribution {
  name: string;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  target_count: number | null;
  search_depth: string;
  metadata: Record<string, unknown>;
  contributorOwnedMetadataKeys: readonly string[];
}

export interface AdoptedBatchPatchResult {
  /** El objeto EXACTO que debe ir a la UPDATE. Nunca lleva `status`. */
  patch: Record<string, unknown>;
  /** Metadata resultante, para reutilizarla sin recalcularla. */
  metadata: Record<string, unknown>;
  /** Columnas globales que el lote ya tenía y que NO se reescriben. */
  preservedColumns: RequestGlobalBatchColumn[];
  /** Columnas globales que estaban en NULL y que este contribuyente establece. */
  establishedColumns: RequestGlobalBatchColumn[];
  metadataMerge: AdoptedBatchMetadataMergeResult;
}

/**
 * `null` / `undefined` ⇒ no hay verdad establecida todavía.
 *
 * Cualquier otro valor —incluidos `0` y `''`— SÍ es una verdad escrita y se
 * respeta: decidir que un cero «no cuenta» sería inventar una política de
 * vacío que la base no declara.
 */
const isUnestablished = (value: unknown): boolean => value === null || value === undefined;

/**
 * Construye el PATCH de una adopción.
 *
 * 🔑 La propiedad importante no es el nombre de esta función: es que el PATCH
 * de ADOPCIÓN y el payload de CREACIÓN de un lote nuevo dejan de salir del
 * mismo objeto sin filtrar. Tienen dueños distintos, así que se construyen por
 * caminos distintos y no se pueden confundir por descuido.
 *
 * `status` NUNCA forma parte del resultado (CUT-1 § 2: el estado terminal lo
 * decide la finalización, después de la sonda durable).
 */
export function resolveAdoptedBatchPatch(input: {
  existingBatch: ExistingAdoptedBatchRow;
  incoming: AdoptingContributorContribution;
}): AdoptedBatchPatchResult {
  const { existingBatch, incoming } = input;

  const incomingColumnValues: Record<RequestGlobalBatchColumn, unknown> = {
    name: incoming.name,
    country: incoming.country,
    country_code: incoming.country_code,
    industry: incoming.industry,
    target_count: incoming.target_count,
    search_depth: incoming.search_depth,
  };

  const patch: Record<string, unknown> = {};
  const preservedColumns: RequestGlobalBatchColumn[] = [];
  const establishedColumns: RequestGlobalBatchColumn[] = [];

  for (const column of REQUEST_GLOBAL_BATCH_COLUMNS) {
    if (!isUnestablished(existingBatch[column])) {
      // Ya hay verdad de petición en la fila: es autoritativa. Ni siquiera se
      // reescribe con un valor idéntico — la columna no viaja en el PATCH.
      preservedColumns.push(column);
      continue;
    }
    const value = incomingColumnValues[column];
    if (isUnestablished(value)) {
      // Nadie tiene verdad para esta columna. Escribir NULL sobre NULL no
      // aporta nada y ensucia el PATCH.
      continue;
    }
    patch[column] = value;
    establishedColumns.push(column);
  }

  const metadataMerge = mergeAdoptedBatchMetadata({
    existingMetadata: existingBatch.metadata,
    incomingMetadata: incoming.metadata,
    contributorOwnedKeys: incoming.contributorOwnedMetadataKeys,
  });

  patch['metadata'] = metadataMerge.metadata;

  return {
    patch,
    metadata: metadataMerge.metadata,
    preservedColumns,
    establishedColumns,
    metadataMerge,
  };
}
