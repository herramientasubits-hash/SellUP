/**
 * wizard-idempotency.ts — Durable idempotency primitive for chat wizard executions.
 *
 * Implements an atomic reserve-or-return pattern using a database-level unique
 * constraint on (created_by, client_request_id). The reservation must be created
 * BEFORE any provider call (Tavily, Apollo, HubSpot, etc.).
 *
 * Design principles:
 * - Dependency injection: receives the DB client, never imports it globally.
 * - No in-memory state (Set, Map, module-level variable).
 * - Handles PostgreSQL error code '23505' (unique_violation) atomically.
 * - Non-23505 errors propagate as typed WizardIdempotencyError.
 */

import {
  RUN_PROVIDER_SELECTION_METADATA_KEY,
  type WizardRunProviderSelectionMetadata,
} from './wizard-run-provider-selection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WizardExecutionReservationInput = {
  /** UUID of the authenticated internal user performing the wizard execution. */
  userId: string;
  /** Client-generated UUID that identifies this specific wizard execution attempt. */
  clientRequestId: string;
  /** Payload for the initial prospect_batch row. */
  initialBatchPayload: {
    requestSource: 'chat_wizard';
    catalogVersionId: string;
    industryId: string;
    subindustryIds: string[];
    countryCode: string;
    additionalCriteria: string | null;
    /**
     * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-2 REVIEW-1 § 3 — el objetivo
     * PERSISTIBLE canónico de la petición, el que el producto le promete a la
     * persona.
     *
     * Aterriza en el INSERT del slot y no en una escritura posterior, y ése es
     * el hito entero. Antes `target_count` nacía NULL y lo establecía el primer
     * contribuyente que adoptaba el lote. En el mundo mixto que viene eso
     * miente: con 10 pedidos, 7 cerrados gratis y 3 de residual de pago, el
     * contribuyente de pago llegaría con 3 y sería ÉL quien fijara el objetivo
     * global. Un residual no puede establecer la petición.
     *
     * 🔴 Es el objetivo PERSISTIBLE (10), no `WIZARD_SYSTEM_CONTROLS.targetCount`
     * (25), que es AMPLITUD DE BÚSQUEDA del pipeline. Confundirlos publicaría un
     * objetivo que el producto nunca prometió. Las dos rutas del wizard —Apollo y
     * Tavily— prometen el mismo 10.
     */
    targetCount: number;
    /**
     * REVIEW-1 § 4 — el resto de la verdad request-global que ya se conoce
     * canónicamente ANTES de que exista contribuyente alguno.
     *
     * `country` es el NOMBRE (la columna `country`); el ISO viaja aparte en
     * `countryCode`. `industry` es el nombre de display del catálogo resuelto.
     * `searchDepth` es la profundidad con la que el wizard invoca el pipeline.
     *
     * Objetivo: que un slot NUEVO del wizard nazca con su identidad completa y
     * que «el primero establece» quede como respaldo para filas heredadas, no
     * como el modelo de propiedad normal.
     */
    country: string;
    industry: string;
    searchDepth: string;
    /**
     * A1-APOLLO-QA-CONTROL-SURFACE-1 § 8/§ 26 — selección de proveedor de la
     * corrida, ya resuelta server-side.
     *
     * Aterriza en el INSERT inicial y no en una segunda escritura. Eso importa por
     * dos razones: la ruta Tavily no tiene costura `extraBatchMetadata` (sólo la
     * de Apollo la tiene), así que sin esto una corrida Tavily con petición
     * explícita no conservaba requested/resolved/reason en ninguna parte; y es la
     * fila que un reintento vuelve a leer para conservar su proveedor original.
     *
     * Ausente ⇒ el metadata queda EXACTAMENTE igual que antes del hito.
     */
    runProviderSelection?: WizardRunProviderSelectionMetadata;
    /**
     * MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 8 — bajo qué taxonomía se creó la
     * solicitud.
     *
     * Aterriza en el INSERT inicial por la misma razón que
     * `runProviderSelection`: es un hecho de la PETICIÓN, hace falta para TODOS
     * los proveedores, y la costura `extraBatchMetadata` sólo existe en la ruta
     * de Apollo. Ausente ⇒ el metadata queda exactamente igual que antes.
     */
    discoveryTaxonomy?: Record<string, unknown>;
  };
};

export type WizardExecutionReservationResult =
  | { status: 'reserved'; batchId: string }
  | { status: 'already_reserved'; batchId: string };

export class WizardIdempotencyError extends Error {
  constructor(
    public readonly code: 'DB_INSERT_FAILED' | 'DB_LOOKUP_FAILED' | 'BATCH_NOT_FOUND',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WizardIdempotencyError';
  }
}

// ── Database client interface (injectable) ────────────────────────────────────
// Matches the minimal surface required from @supabase/supabase-js SupabaseClient.
// Declared as an interface so tests can inject lightweight fakes.

export interface IdempotencyDbClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{ data: { id: string } | null; error: DbError | null }>;
      };
    };
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          single(): Promise<{ data: { id: string } | null; error: DbError | null }>;
        };
      };
    };
  };
}

export type DbError = {
  code?: string;
  message?: string;
  details?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

/** PostgreSQL error code for unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

/** Initial status for a wizard-reserved batch (matches CHECK constraint in migration 040) */
const INITIAL_BATCH_STATUS = 'draft';

/** Source identifier stored in prospect_batches.source */
const WIZARD_SOURCE = 'agent_1';

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Atomically reserves a prospect_batch row for the given (userId, clientRequestId) pair.
 *
 * Flow:
 * 1. Attempt INSERT with client_request_id set.
 * 2. If INSERT succeeds → return { status: 'reserved', batchId }.
 * 3. If INSERT fails with code 23505 (unique_violation) → the slot was already reserved
 *    by a prior (or concurrent) request. Look up the existing row and return
 *    { status: 'already_reserved', batchId }.
 * 4. Any other error → throw WizardIdempotencyError.
 *
 * IMPORTANT: This function does NOT call any external provider. The caller must
 * check the result BEFORE invoking Tavily, Apollo, or any other provider.
 */
export async function reserveWizardExecutionSlot(
  input: WizardExecutionReservationInput,
  db: IdempotencyDbClient,
): Promise<WizardExecutionReservationResult> {
  const { userId, clientRequestId, initialBatchPayload } = input;

  const batchName = buildBatchName(initialBatchPayload);
  const metadataEntry = buildMetadata(initialBatchPayload);

  // ── Step 1: Attempt atomic INSERT ─────────────────────────────────────────
  const { data: insertedRow, error: insertError } = await db
    .from('prospect_batches')
    .insert({
      name: batchName,
      status: INITIAL_BATCH_STATUS,
      source: WIZARD_SOURCE,
      created_by: userId,
      client_request_id: clientRequestId,
      metadata: metadataEntry,
      // CUT-2 REVIEW-1 §§ 3/4 — la verdad request-global se establece AQUÍ,
      // antes de cualquier contribuyente. `adopted-batch-truth.ts` la preserva
      // después; su regla de «el primero establece» pasa a ser respaldo para
      // filas heredadas, no el modelo de propiedad de los lotes mixtos nuevos.
      target_count: initialBatchPayload.targetCount,
      country: initialBatchPayload.country,
      country_code: initialBatchPayload.countryCode,
      industry: initialBatchPayload.industry,
      search_depth: initialBatchPayload.searchDepth,
    })
    .select('id')
    .single();

  if (!insertError) {
    // INSERT succeeded — slot is freshly reserved
    if (!insertedRow) {
      throw new WizardIdempotencyError(
        'DB_INSERT_FAILED',
        'INSERT succeeded but returned no row.',
      );
    }
    return { status: 'reserved', batchId: insertedRow.id };
  }

  // ── Step 2: Handle unique_violation (23505) ───────────────────────────────
  if (insertError.code === PG_UNIQUE_VIOLATION) {
    // Another request (concurrent or prior) already reserved this slot.
    // Look up the existing batch by the idempotency key.
    const { data: existingRow, error: lookupError } = await db
      .from('prospect_batches')
      .select('id')
      .eq('created_by', userId)
      .eq('client_request_id', clientRequestId)
      .single();

    if (lookupError) {
      throw new WizardIdempotencyError(
        'DB_LOOKUP_FAILED',
        `Failed to look up existing batch after 23505: ${lookupError.message ?? 'unknown'}`,
        lookupError,
      );
    }

    if (!existingRow) {
      throw new WizardIdempotencyError(
        'BATCH_NOT_FOUND',
        'Received 23505 but the existing batch row could not be found.',
      );
    }

    return { status: 'already_reserved', batchId: existingRow.id };
  }

  // ── Step 3: Any other error — propagate ───────────────────────────────────
  throw new WizardIdempotencyError(
    'DB_INSERT_FAILED',
    `Unexpected database error during reservation: ${insertError.message ?? 'unknown'} (code: ${insertError.code ?? 'n/a'})`,
    insertError,
  );
}

// ── Private helpers ───────────────────────────────────────────────────────────

function buildBatchName(payload: WizardExecutionReservationInput['initialBatchPayload']): string {
  return `Wizard: ${payload.industryId} / ${payload.countryCode}`;
}

function buildMetadata(
  payload: WizardExecutionReservationInput['initialBatchPayload'],
): Record<string, unknown> {
  return {
    request_source: payload.requestSource,
    catalog_version_id: payload.catalogVersionId,
    industry_id: payload.industryId,
    subindustry_ids: payload.subindustryIds,
    country_code: payload.countryCode,
    additional_criteria: payload.additionalCriteria,
    // Aditivo: sin selección el objeto no gana ninguna clave nueva.
    ...(payload.runProviderSelection
      ? { [RUN_PROVIDER_SELECTION_METADATA_KEY]: payload.runProviderSelection }
      : {}),
    ...(payload.discoveryTaxonomy
      ? { apollo_discovery_taxonomy: payload.discoveryTaxonomy }
      : {}),
  };
}

// ── Lectura del proveedor del intento anterior (§ 9) ──────────────────────────

/**
 * Cliente mínimo para releer la selección de proveedor de una corrida existente.
 * Declarado aparte de `IdempotencyDbClient` porque selecciona otra columna.
 */
export interface PreviousAttemptProviderDbClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          maybeSingle(): Promise<{
            data: { metadata: unknown } | null;
            error: DbError | null;
          }>;
        };
      };
    };
  };
}

/**
 * A1-APOLLO-QA-CONTROL-SURFACE-1 § 9 — proveedor que un intento anterior de la
 * MISMA corrida ya resolvió.
 *
 * Existe para que un reintento no se convierta en Tavily porque el navegador
 * perdió la selección: el proveedor de una corrida se fija una vez y la reserva
 * queda atada a él.
 *
 * Devuelve `null` para cualquier ausencia o forma inesperada —fila inexistente,
 * metadata ilegible, error de lectura— y NUNCA lanza: no poder leer el intento
 * anterior debe degradar al comportamiento previo (decide el global), jamás
 * romper la ejecución. La validación del valor la hace el núcleo puro.
 */
export async function readPreviousAttemptDiscoveryProvider(
  input: { userId: string; clientRequestId: string },
  db: PreviousAttemptProviderDbClient,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('prospect_batches')
      .select('metadata')
      .eq('created_by', input.userId)
      .eq('client_request_id', input.clientRequestId)
      .maybeSingle();

    if (error || !data) return null;

    const metadata = data.metadata;
    if (typeof metadata !== 'object' || metadata === null) return null;

    const selection = (metadata as Record<string, unknown>)[
      RUN_PROVIDER_SELECTION_METADATA_KEY
    ];
    if (typeof selection !== 'object' || selection === null) return null;

    const resolved = (selection as Record<string, unknown>)['resolved_discovery_provider'];
    return typeof resolved === 'string' ? resolved : null;
  } catch {
    return null;
  }
}
