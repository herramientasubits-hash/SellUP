/**
 * lusha-canonical-batch.ts — EL lote de UNA ejecución de Lusha pending-review.
 *
 * AGENT1-LOCAL-CUT9A-LUSHA-BATCH-OWNERSHIP-SEAM §§ 2, 3, 4, 5, 8.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * La superficie Lusha tenía DOS creadores de lote independientes y ninguna
 * autoridad compartida entre ellos:
 *
 *   capa gratuita  `writeStructuredSourceCandidatesPreview` → creaba su PROPIO lote
 *   capa de pago   `persistLushaPendingReviewBatch`         → INSERT incondicional
 *
 * `runPrePaidNoveltyDiscovery` ya sabía adoptar (`resolveBatchId`), pero la acción
 * Lusha nunca se lo pasaba —CUT-5 cableó la ruta Apollo, no ésta— y la mitad de
 * pago ni siquiera sabía adoptar: su única forma de obtener un `batchId` era
 * crearlo. Con las dos mitades escribiendo en la misma ejecución, UNA búsqueda
 * terminaba en DOS lotes.
 *
 * ── Qué identidad se usa, y cuál NO se inventa ───────────────────────────────
 *
 * 🔴 La identidad canónica es la que YA existe en la base: el índice único
 * `(created_by, client_request_id)` sobre `prospect_batches`. Este corte no
 * introduce `batchExecutionId`, ni `retryGroupId`, ni `logicalSearchId`, ni
 * ninguna segunda identidad equivalente. No hay migración.
 *
 * ── Semántica de reintento (OPTION_A, decidida en producto) ──────────────────
 *
 *   MISMA ejecución / MISMO `clientRequestId`  → MISMO lote canónico.
 *   NUEVO clic / NUEVO `clientRequestId`       → NUEVO lote. Es lo ESPERADO.
 *
 * Lo segundo no es un defecto: el `clientRequestId` de Lusha gobierna TAMBIÉN la
 * reserva económica, y hoy se genera nuevo por clic precisamente para no reutilizar
 * una reserva ya liquidada. Prometer «un reintento percibido por la persona reusa
 * el lote» exigiría desacoplar identidad de lote e identidad de reserva, que es un
 * cambio de política económica que este corte NO hace.
 *
 * ── Qué fija la construcción y qué aporta el contribuyente ───────────────────
 *
 * CUT-5 fijaba el payload ENTERO en la construcción para que el contenido del lote
 * no dependiera de qué rama llegase primero. Aquí eso no es posible sin cambiar lo
 * que el usuario ve: la fila de pago se describe con el resumen de la petición que
 * DEVUELVE el proveedor, y eso no existe hasta después de la búsqueda.
 *
 * Así que la frontera se traza donde de verdad importa:
 *
 *   FIJADO en construcción, y ESTAMPADO sobre cualquier contribución:
 *     `created_by`, `owner_id`   — propiedad
 *     `client_request_id`        — identidad de ejecución
 *     `target_count`             — 🔴 AUTORIDAD DE PETICIÓN (§ 8)
 *     `status`, `source`         — ciclo de vida y vocabulario
 *
 *   APORTADO por quien materializa (con defecto de construcción si nadie aporta):
 *     `name`, `country`, `country_code`, `industry`, `search_depth`, `metadata`
 *
 * 🔴 § 8 — `target_count` es el objetivo PEDIDO, establecido por el primer
 * propietario del lote, y NINGÚN contribuyente posterior lo redefine. Antes la
 * mitad de pago escribía `target_count = persistedCount`: con 5 pedidos y 3
 * persistidos el lote acababa afirmando que se pidieron 3. Es la MISMA regla que
 * CUT-2 fijó para el wizard —«el primero establece la petición, los
 * contribuyentes no la redefinen»— extendida a esta superficie.
 *
 * ── Qué garantiza el resolutor ───────────────────────────────────────────────
 *
 * · PEREZOSO: la fila nace en el primer momento en que alguien de verdad la
 *   necesita. Una corrida que la puerta gratuita descarta sin escribir, o que el
 *   presupuesto bloquea, sigue sin dejar lote.
 * · MEMOIZADO por ejecución: la mitad gratuita y la de pago reciben el MISMO id,
 *   y el orden en que pregunten no cambia cuál es.
 * · CONCURRENTE: dos materializaciones simultáneas comparten la promesa en vuelo,
 *   así que no pueden producir dos INSERT.
 * · Un FALLO no se memoiza. La valla contra el lote duplicado es el índice único
 *   de la base, no este cierre; memorizar el fallo dejaría que un tropiezo
 *   transitorio de la capa gratuita —que falla ABIERTO por diseño— envenenara para
 *   siempre a la ruta de pago, que no depende de ella.
 * · SIN estado de módulo: la instancia vive dentro de una sola llamada a la acción
 *   y muere con ella. No hay caché global, ni «último lote», ni adopción entre
 *   ejecuciones.
 *
 * 🔴 NUNCA se adopta por heurística. No hay `ORDER BY created_at DESC LIMIT 1`, ni
 * emparejamiento por nombre, país o sector. La ÚNICA forma de adoptar es que la
 * base devuelva 23505 sobre `(created_by, client_request_id)` y se relea esa fila
 * exacta por esa misma clave.
 */

import type { LushaPendingReviewBatchRow } from './lusha-pending-review';

/**
 * Época de identidad de un lote RECIÉN creado.
 *
 * `prospect_batches.identity_epoch` nace en 0 por DEFAULT (M126). Se nombra aquí
 * para que la mitad de pago no escriba un 0 suelto cuando adopte.
 */
export const LUSHA_CANONICAL_BATCH_FRESH_EPOCH = 0;

/** Código PostgreSQL de violación de unicidad. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Lo que la mitad de pago necesita saber del lote canónico para escribir.
 *
 * 🔴 `identityEpoch` no es decorativo: la escritura vallada de candidatos
 * (CUT-3B4) declara contra qué estado decidió, y un lote ADOPTADO ya no está en la
 * época 0 —la capa gratuita la avanzó al escribir sus filas—. Devolverla aquí es
 * lo que impide que la adopción convierta un `stale` inalcanzable en un fallo duro.
 */
export type LushaCanonicalBatchReservation = {
  id: string;
  /** `false` ⇒ esta llamada creó la fila. `true` ⇒ ya existía y se releyó. */
  adopted: boolean;
  identityEpoch: number;
};

/**
 * Identidad y autoridad de petición de la ejecución. Se conoce ANTES de que corra
 * nada —gratuito o de pago— y por eso no puede depender del orden.
 */
export type LushaCanonicalBatchIdentity = {
  createdByUserId: string;
  clientRequestId: string;
  /** § 8 — el objetivo PEDIDO. Nunca un residual, nunca lo persistido. */
  requestedTarget: number;
  /** Descripción por defecto, para cuando quien materializa no aporta la suya. */
  defaults: LushaCanonicalBatchDescription;
};

/** Las columnas DESCRIPTIVAS que un contribuyente puede aportar. */
export type LushaCanonicalBatchDescription = {
  name: string;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  search_depth: LushaPendingReviewBatchRow['search_depth'];
  status: LushaPendingReviewBatchRow['status'];
  source: LushaPendingReviewBatchRow['source'];
  metadata: Record<string, unknown>;
};

/** La escritura que el resolutor delega. Inyectable para pruebas. */
export type ReserveLushaCanonicalBatch = (
  row: LushaPendingReviewBatchRow,
) => Promise<LushaCanonicalBatchReservation>;

export type CanonicalLushaBatchResolver = {
  /**
   * Devuelve el lote canónico de ESTA ejecución, creándolo si aún no existe.
   *
   * `contribution` es la descripción que se usa SÓLO si esta llamada es la que
   * materializa. Identidad y autoridad de petición se estampan siempre desde la
   * construcción, así que ninguna contribución puede redefinirlas.
   */
  resolve: (
    contribution?: LushaCanonicalBatchDescription,
  ) => Promise<LushaCanonicalBatchReservation>;
  /** Sólo observacional: ¿ya se materializó la fila en esta ejecución? */
  isMaterialized: () => boolean;
};

/**
 * Compone la fila canónica: la descripción del contribuyente (o el defecto) con la
 * identidad y la autoridad de petición ESTAMPADAS encima.
 *
 * El orden de propagación es deliberado — lo canónico va al final para que ninguna
 * contribución pueda pisarlo.
 */
export function buildLushaCanonicalBatchRow(
  identity: LushaCanonicalBatchIdentity,
  contribution?: LushaCanonicalBatchDescription,
): LushaPendingReviewBatchRow {
  const description = contribution ?? identity.defaults;
  return {
    name: description.name,
    country: description.country,
    country_code: description.country_code,
    industry: description.industry,
    search_depth: description.search_depth,
    metadata: description.metadata,
    // ── Canónico. Nunca aportado, nunca redefinido. ──
    status: identity.defaults.status,
    source: identity.defaults.source,
    owner_id: identity.createdByUserId,
    created_by: identity.createdByUserId,
    client_request_id: identity.clientRequestId,
    target_count: identity.requestedTarget,
  };
}

export function createCanonicalLushaBatchResolver(
  reserve: ReserveLushaCanonicalBatch,
  identity: LushaCanonicalBatchIdentity,
): CanonicalLushaBatchResolver {
  let settled: LushaCanonicalBatchReservation | null = null;
  let inFlight: Promise<LushaCanonicalBatchReservation> | null = null;

  const resolve = async (
    contribution?: LushaCanonicalBatchDescription,
  ): Promise<LushaCanonicalBatchReservation> => {
    if (settled !== null) return settled;
    if (inFlight !== null) return inFlight;

    const attempt = (async () => {
      const result = await reserve(buildLushaCanonicalBatchRow(identity, contribution));
      settled = result;
      return result;
    })();

    inFlight = attempt;

    try {
      return await attempt;
    } catch (error) {
      // El fallo NO se memoriza — ver la cabecera. Una llamada posterior válida
      // dentro de la MISMA ejecución debe poder reintentar.
      inFlight = null;
      throw error;
    }
  };

  return { resolve, isMaterialized: () => settled !== null };
}

// ── Cliente mínimo, inyectable ───────────────────────────────────────────────

export type LushaCanonicalBatchDbError = {
  code?: string;
  message?: string;
};

export interface LushaCanonicalBatchDbClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{
          data: { id: string; identity_epoch?: number | null } | null;
          error: LushaCanonicalBatchDbError | null;
        }>;
      };
    };
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          single(): Promise<{
            data: { id: string; identity_epoch?: number | null } | null;
            error: LushaCanonicalBatchDbError | null;
          }>;
        };
      };
    };
  };
}

/**
 * RESERVE-OR-RETURN atómico sobre `(created_by, client_request_id)`.
 *
 *   INSERT ok      → `{ adopted: false, identityEpoch: 0 }`
 *   23505          → relee ESA fila por ESA clave → `{ adopted: true, epoch real }`
 *   cualquier otro → LANZA. Un fallo de escritura no se degrada a «no hay lote».
 *
 * 🔴 La relectura es por CLAVE CANÓNICA, nunca por «el último lote». Adoptar por
 * recencia dejaría que una ejecución se apropiara del lote de otra.
 */
export async function reserveOrReturnLushaCanonicalBatch(
  row: LushaPendingReviewBatchRow,
  db: LushaCanonicalBatchDbClient,
): Promise<LushaCanonicalBatchReservation> {
  const { data: inserted, error: insertError } = await db
    .from('prospect_batches')
    .insert(row as unknown as Record<string, unknown>)
    .select('id')
    .single();

  if (!insertError) {
    if (!inserted) {
      throw new Error('No se pudo crear el lote: INSERT sin fila devuelta.');
    }
    return {
      id: inserted.id,
      adopted: false,
      identityEpoch: LUSHA_CANONICAL_BATCH_FRESH_EPOCH,
    };
  }

  if (insertError.code !== PG_UNIQUE_VIOLATION) {
    throw new Error(`No se pudo crear el lote: ${insertError.message ?? 'sin datos'}`);
  }

  const { data: existing, error: lookupError } = await db
    .from('prospect_batches')
    .select('id, identity_epoch')
    .eq('created_by', row.created_by)
    .eq('client_request_id', row.client_request_id)
    .single();

  if (lookupError || !existing) {
    throw new Error(
      `No se pudo releer el lote canónico tras 23505: ${lookupError?.message ?? 'sin datos'}`,
    );
  }

  // 🔴 `identity_epoch` ausente ⇒ la M126 no está aplicada y la columna no existe.
  // Se cae a la época fresca: la RPC vallada responderá `capability_absent` y la
  // escritura tomará la ruta anterior a B4, que es la verdad de ese esquema.
  const epoch = existing.identity_epoch;
  return {
    id: existing.id,
    adopted: true,
    identityEpoch:
      typeof epoch === 'number' && Number.isFinite(epoch)
        ? epoch
        : LUSHA_CANONICAL_BATCH_FRESH_EPOCH,
  };
}
