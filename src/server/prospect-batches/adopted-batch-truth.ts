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
 * `country`, `country_code`, `industry`, `target_count`, `search_depth` y
 * `metadata` con los valores de LA INVOCACIÓN ACTUAL. Sobre un lote nuevo eso
 * es correcto —el escritor es su dueño—. Sobre un lote ADOPTADO es «gana el
 * último que escribe», y en el mundo mixto que viene eso miente:
 *
 *   objetivo del wizard = 10
 *   aporte gratuito     = 7
 *   residual de pago    = 3
 *
 * El contribuyente de pago llega con `target_count = 3` —su residual— y hoy lo
 * escribiría encima del 10 del usuario. El lote pasaría a anunciar que se
 * pidieron 3 empresas. Lo mismo con el país y la industria: un proveedor con su
 * propia clasificación local reescribiría la del usuario.
 *
 * La invariante que se defiende:
 *
 *   LA IDENTIDAD GLOBAL DE LA PETICIÓN ES DEL LOTE, NO DEL CONTRIBUYENTE.
 *
 * Un contribuyente puede añadir candidatos, añadir SU telemetría, poner el
 * nombre humano canónico y decidir el estado terminal según CUT-1. No puede
 * reescribir de qué iba la petición.
 *
 * ── Dos reglas distintas, y por qué no son la misma ──────────────────────────
 *
 * REVIEW-1 § 11 obliga a distinguirlas explícitamente:
 *
 *  1. AUTORIDAD EN ORIGEN (la normal para lotes nuevos del wizard).
 *     `reserveWizardExecutionSlot` establece la verdad global de la petición
 *     —`target_count`, `country`, `country_code`, `industry`, `search_depth`—
 *     en el INSERT del slot, ANTES de que exista contribuyente alguno. Cuando
 *     el contribuyente de pago llega, la fila ya sabe que se pidieron 10, y
 *     este módulo simplemente no deja que la toque.
 *
 *  2. «EL PRIMERO ESTABLECE» (respaldo para filas heredadas / ad-hoc).
 *     Una fila que nació SIN esa verdad —lotes anteriores a este hito, o
 *     creados por caminos que no son la reserva del wizard— tiene la columna en
 *     NULL. Una regla de «lo existente gana siempre» la dejaría NULL para
 *     siempre y el lote perdería su identidad entera: una mentira mayor que la
 *     que este corte arregla. Así que si no hay verdad que proteger, el
 *     contribuyente la fija.
 *
 * 🔴 El respaldo (2) NO es el modelo de propiedad de los lotes mixtos nuevos, y
 * `target_count` es el caso donde la diferencia importa: un residual de 3 NO
 * puede ser quien establezca el objetivo global. Por eso la reserva lo escribe
 * en origen y esta ruta nunca llega a ejercerse para el wizard. Si un día
 * volviera a ejercerse ahí, sería la señal de que la reserva dejó de poblarlo.
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
 * 🔴 `name` NO está en la lista, y es una DECISIÓN, no un olvido: ver
 * `PRESENTATION_BATCH_COLUMNS`.
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
  'country',
  'country_code',
  'industry',
  'target_count',
  'search_depth',
] as const;

export type RequestGlobalBatchColumn = (typeof REQUEST_GLOBAL_BATCH_COLUMNS)[number];

/**
 * Columnas de PRESENTACIÓN: las escribe siempre el contribuyente que adopta.
 *
 * REVIEW-1 § 6 (decisión de la dueña) — `name` es una ETIQUETA HUMANA, no
 * verdad semántica global de la petición. El nombre que deja la reserva del
 * wizard, `Wizard: {industryId} / {countryCode}`, es un rótulo PROVISIONAL de
 * idempotencia: identificadores técnicos que nadie quiere ver en la lista de
 * lotes. Clasificarlo como global lo habría congelado y habría dejado ese
 * rótulo visible para siempre — una regresión de producto.
 *
 * Así que la canonicalización del nombre sigue donde estaba: el escritor lo
 * escribe en cada adopción, exactamente como antes de CUT-2, y sigue saliendo
 * de contexto GLOBAL (país e industria de la petición), nunca del proveedor.
 *
 * 🔴 «Se escribe siempre» no es lo mismo que «gana el último que escribe» sobre
 * verdad de petición: aquí no hay verdad ajena que borrar, sólo un rótulo que se
 * recalcula. La diferencia es la razón de que esta lista exista aparte.
 */
export const PRESENTATION_BATCH_COLUMNS = ['name'] as const;

export type PresentationBatchColumn = (typeof PRESENTATION_BATCH_COLUMNS)[number];

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

/**
 * REVIEW-1 §§ 7/8 — los TRES canales llegan SEPARADOS, y es el punto entero.
 *
 * La versión anterior recibía `metadata` ya fusionada más una lista de claves
 * «del contribuyente». Eso abría un agujero exacto: un valor de PASO A TRAVÉS
 * que colisionara con una clave del escritor heredaba su autoridad, porque la
 * lista decía «esta clave es propia» mientras el objeto ya llevaba dentro el
 * valor ajeno. La procedencia del VALOR se perdía antes de resolver el dueño.
 *
 * Aquí no se puede perder: cada valor llega por su canal y se resuelve en su
 * paso.
 */
export interface AdoptedBatchMetadataMergeInput {
  /** Metadata que la fila del lote YA tenía. Cualquier forma no-objeto ⇒ `{}`. */
  existingMetadata: unknown;
  /**
   * Bloque que el contribuyente produce POR SÍ MISMO. Su propiedad es
   * intrínseca —son sus claves, no una lista paralela que pueda mentir—.
   */
  writerOwnedMetadata: Record<string, unknown> | null | undefined;
  /**
   * Metadata de PASO A TRAVÉS: la rellena el llamador y transporta claves de
   * otros dueños (`run_provider_selection` y `apollo_discovery_taxonomy` las
   * escribe también la reserva del wizard). Nunca adquiere autoridad de
   * escritor, ni siquiera colisionando con una clave del escritor.
   */
  passthroughMetadata: Record<string, unknown> | null | undefined;
}

export interface AdoptedBatchMetadataMergeResult {
  metadata: Record<string, unknown>;
  /** Claves entrantes que NO se escribieron porque ya había verdad ajena. */
  preservedKeys: string[];
  /** Claves entrantes que se añadieron porque no existían. */
  addedKeys: string[];
  /** Claves propias del contribuyente que actualizó legítimamente. */
  updatedOwnKeys: string[];
  /**
   * Claves de paso a través que se descartaron porque el valor que ocupaba esa
   * clave lo había producido el ESCRITOR. Es la suplantación, con nombre.
   */
  passthroughBlockedByWriterKeys: string[];
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOwn = (target: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

/**
 * Fusiona la metadata de un lote ADOPTADO respetando al dueño de cada VALOR.
 *
 * Reemplaza el `{ ...existingMeta, ...batchMetadata }` anterior, que era «gana
 * el contribuyente actual» sobre TODA colisión, incluida la metadata del wizard
 * y la de origen gratuito.
 *
 * Tres pasos, en este orden (REVIEW-1 § 8):
 *
 *   PASO 1 — se parte de lo EXISTENTE.
 *
 *   PASO 2 — se aplica el bloque PROPIO del escritor:
 *              · clave ausente            ⇒ se AÑADE;
 *              · clave propia no disputada ⇒ se ACTUALIZA (su propio valor
 *                anterior sí puede avanzar: un reintento reescribe su telemetría);
 *              · clave DISPUTADA con el origen gratuito ⇒ gana lo existente.
 *
 *   PASO 3 — se aplica el PASO A TRAVÉS:
 *              · clave ausente   ⇒ se AÑADE (aditivo);
 *              · clave ocupada   ⇒ gana lo que ya estaba, venga de la fila o del
 *                paso 2. Un valor de paso a través NO se convierte en valor del
 *                escritor por coincidir en el nombre de la clave.
 *
 * La regla del paso 3 cubre a la vez la metadata del wizard (`request_source`,
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
  const writerOwned = isPlainRecord(input.writerOwnedMetadata) ? input.writerOwnedMetadata : {};
  const passthrough = isPlainRecord(input.passthroughMetadata) ? input.passthroughMetadata : {};

  const structuredSourceOwned = new Set<string>(STRUCTURED_SOURCE_BATCH_METADATA_KEYS);
  const writerOwnedKeys = new Set(Object.keys(writerOwned));

  // PASO 1 — lo existente es la base.
  const metadata: Record<string, unknown> = { ...existing };
  const preservedKeys: string[] = [];
  const addedKeys: string[] = [];
  const updatedOwnKeys: string[] = [];
  const passthroughBlockedByWriterKeys: string[] = [];

  // PASO 2 — el bloque PROPIO del escritor.
  for (const key of Object.keys(writerOwned)) {
    if (!hasOwn(existing, key)) {
      metadata[key] = writerOwned[key];
      addedKeys.push(key);
      continue;
    }

    // Clave disputada: la reclaman el bloque del contribuyente Y el de origen
    // gratuito. No hay dueño único ⇒ no se pisa (§ 12-B: nunca «gana el pago»
    // en silencio).
    if (structuredSourceOwned.has(key)) {
      preservedKeys.push(key);
      continue;
    }

    metadata[key] = writerOwned[key];
    updatedOwnKeys.push(key);
  }

  // PASO 3 — el PASO A TRAVÉS, que sólo puede ser aditivo.
  for (const key of Object.keys(passthrough)) {
    if (hasOwn(metadata, key)) {
      if (writerOwnedKeys.has(key)) {
        // El valor que ocupa la clave lo produjo el escritor (o lo preservó la
        // fila frente al escritor). El paso a través no lo suplanta.
        passthroughBlockedByWriterKeys.push(key);
      } else {
        preservedKeys.push(key);
      }
      continue;
    }
    metadata[key] = passthrough[key];
    addedKeys.push(key);
  }

  return {
    metadata,
    preservedKeys,
    addedKeys,
    updatedOwnKeys,
    passthroughBlockedByWriterKeys,
  };
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
  /**
   * Nombre humano canónico ya resuelto por el escritor. Se escribe SIEMPRE
   * (columna de presentación, § 6).
   */
  name: string;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  target_count: number | null;
  search_depth: string;
  /** Bloque observacional propio del escritor. */
  writerOwnedMetadata: Record<string, unknown>;
  /** Metadata de paso a través del llamador. */
  passthroughMetadata: Record<string, unknown>;
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
  /** Columnas de presentación que este contribuyente canonicaliza. */
  presentationColumns: PresentationBatchColumn[];
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

  // § 6 — presentación: el nombre humano canónico se recalcula en cada
  // adopción, igual que antes de CUT-2. Sin esto, un lote del wizard se
  // quedaría con el rótulo técnico `Wizard: {industryId} / {countryCode}`.
  patch['name'] = incoming.name;
  const presentationColumns: PresentationBatchColumn[] = ['name'];

  const metadataMerge = mergeAdoptedBatchMetadata({
    existingMetadata: existingBatch.metadata,
    writerOwnedMetadata: incoming.writerOwnedMetadata,
    passthroughMetadata: incoming.passthroughMetadata,
  });

  patch['metadata'] = metadataMerge.metadata;

  return {
    patch,
    metadata: metadataMerge.metadata,
    preservedColumns,
    establishedColumns,
    presentationColumns,
    metadataMerge,
  };
}
