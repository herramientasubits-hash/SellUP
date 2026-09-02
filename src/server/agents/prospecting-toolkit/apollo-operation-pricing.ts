/**
 * apollo-operation-pricing.ts — Single source of Apollo per-operation credit pricing.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * Root cause this file closes:
 *   The wizard reserved `maxQueries × maxResults` credits (1 × 3 = 3) for an
 *   Apollo run, but a run can also spend Organization Enrichment credits. The
 *   QA batch of 2026-07-30 (7a75df68-aaa2-4558-9118-0846486a3e97) was charged
 *   4 credits — 3 organizations_search + 1 organization_enrichment — against a
 *   3-credit reservation. The reservation only knew about one of the two
 *   billable operations.
 *
 * Contract:
 *   - Every module needing an Apollo credit number (preflight estimation, cost
 *     guardrails, usage logging, reconciliation) reads it from here.
 *   - No caller may hardcode `3`, `+ 1`, or `3 + 1`.
 *   - Each breakdown carries `pricingSource` and `pricingVersion`, so a
 *     reconciliation can tell which pricing produced a given reservation.
 *
 * ── AGENT1-APOLLO-BILLING-MODE-V2 ────────────────────────────────────────────
 *
 * Este archivo declaraba una unidad de facturación FALSA para
 * `organizations_search`: «1 crédito por organización DEVUELTA». Apollo Support
 * confirmó el modelo real —1 crédito por PÁGINA NO VACÍA de Organization
 * Search, sin importar cuántos resultados traiga esa página (100 cuestan lo
 * mismo que 1)— y el runtime ya factura así: el ledger por página
 * (`apollo-organizations-paginated-search.ts`) y el volumen pagado
 * (`apollo-organizations-paid-volume.ts`) cuentan páginas no vacías, no filas.
 *
 * Lo que quedaba hablando v1 y este corte cierra:
 *   1. La UNIDAD declarada aquí (el comentario que induce al siguiente
 *      llamador a pasar un conteo de organizaciones).
 *   2. `estimateApolloRunCreditBreakdown`, que reservaba
 *      `maxQueries × maxResults` — por RESULTADO. Ahora reserva
 *      `maxQueries × maxPagesPerQuery`, que es lo que una invocación puede
 *      llegar a pagar.
 *   3. `APOLLO_PRICING_VERSION`, que seguía siendo `v1` aunque el modelo ya
 *      había cambiado: una reserva o una fila estampada hoy era indistinguible
 *      de una de julio, cuyos créditos significan otra cosa.
 *
 * Compatibilidad histórica: NO hay backfill. Las filas y reservas previas
 * conservan su `pricing_version` v1 y deben leerse bajo el modelo por
 * organización. La AUSENCIA de `pricing_version` en una fila de
 * `organizations_search` significa v1 (el stamping en filas es de este corte);
 * `resolveApolloPricingModelFromMetadata` es el único lector autorizado de esa
 * regla, para que ningún panel la reinvente.
 *
 * Pure: no I/O and no process.env reads. Caps are injected by the caller, which
 * keeps this module deterministic and testable offline.
 */

/** Apollo operations that consume credits in the Agent 1 company-discovery run. */
export type ApolloBillableOperationKey =
  | 'organizations_search'
  | 'organization_enrichment';

/** Canonical operation keys, exactly as written to provider_usage_logs.operation_key. */
export const APOLLO_BILLABLE_OPERATION_KEYS: readonly ApolloBillableOperationKey[] = [
  'organizations_search',
  'organization_enrichment',
] as const;

/**
 * Bumped whenever the credit model changes (units, operations, or formula).
 * Persisted alongside reservations so an old reservation stays interpretable.
 *
 * v2 = `organizations_search` se factura por PÁGINA NO VACÍA (modelo confirmado
 * por Apollo Support). `organization_enrichment` no cambió de unidad.
 */
export const APOLLO_PRICING_VERSION = 'a1-apollo-operation-pricing-v2-per-page';

/**
 * Versión anterior, conservada SÓLO para leer lo ya escrito.
 *
 * Nada la escribe: una reserva o una fila con esta versión —o SIN versión— se
 * generó bajo «1 crédito por organización devuelta» y sus créditos no son
 * comparables con los de v2. No se backfillea (ver cabecera).
 */
export const APOLLO_PRICING_VERSION_V1_PER_RESULT = 'a1-apollo-operation-pricing-v1';

/** Where the numbers come from. Not a live provider_pricing_config read. */
export const APOLLO_PRICING_SOURCE = 'apollo_operation_pricing_table';

/** Unidad que Apollo factura en cada operación de descubrimiento de Agente 1. */
export type ApolloBillableUnit = 'non_empty_page' | 'enrichment_call_attempted';

/**
 * La unidad facturable declarada, por operación.
 *
 * 🔴 Es la parte del contrato que se leía mal: `APOLLO_CREDITS_PER_UNIT` decía
 * «1» y el comentario decía «por organización devuelta», así que un llamador
 * que pasara un conteo de organizaciones compilaba y facturaba 5× de más. La
 * unidad ahora es explícita y tipada, y los envoltorios de abajo la nombran.
 */
export const APOLLO_BILLABLE_UNIT: Readonly<
  Record<ApolloBillableOperationKey, ApolloBillableUnit>
> = {
  organizations_search: 'non_empty_page',
  organization_enrichment: 'enrichment_call_attempted',
};

/**
 * Credits charged per billable unit (ver `APOLLO_BILLABLE_UNIT` para la unidad).
 *   organizations_search    → 1 credit per NON-EMPTY PAGE returned.
 *   organization_enrichment → 1 credit per enrichment API call attempted.
 */
export const APOLLO_CREDITS_PER_UNIT: Readonly<
  Record<ApolloBillableOperationKey, number>
> = {
  organizations_search: 1,
  organization_enrichment: 1,
};

export type ApolloRunPricingInput = {
  /**
   * Resolved cap of Apollo search INVOCATIONS for the whole run.
   *
   * El nombre se conserva (`max_queries_per_run` ya viaja en metadata
   * histórica), pero lo que cuenta son invocaciones de búsqueda, cada una de
   * las cuales puede pagar hasta `maxPagesPerQuery` páginas.
   */
  maxQueriesPerRun: number;
  /**
   * Páginas que UNA invocación de búsqueda puede llegar a pagar.
   *
   * Obligatorio a propósito: es el único número que multiplica créditos de
   * búsqueda, y hacerlo opcional habría dejado a los llamadores existentes
   * reservando en silencio bajo el modelo viejo. Debe salir del mismo techo que
   * `createApolloPaginationBudget` aplica en runtime, nunca de un literal
   * local.
   */
  maxPagesPerQuery: number;
  /**
   * Resolved cap of results requested per query (`per_page`).
   *
   * 🔴 ECO INFORMATIVO: no multiplica créditos. Con cobro por página no vacía,
   * pedir 100 resultados cuesta lo mismo que pedir 3. Se conserva en el
   * desglose para que una reserva siga siendo reproducible desde su registro.
   */
  maxResultsPerQuery: number;
  /**
   * Resolved cap of Organization Enrichment calls for the whole run.
   * Callers pass the run-level cap, not the per-call cap.
   */
  maxEnrichmentsPerRun: number;
  /**
   * False when the enrichment cascade flag is OFF. A disabled cascade cannot
   * issue enrichment calls, so it reserves zero enrichment credits — but the
   * breakdown still records that the operation was considered.
   */
  enrichmentEnabled: boolean;
};

export type ApolloRunCreditBreakdown = {
  searchReservedCredits: number;
  enrichmentReservedCredits: number;
  totalReservedCredits: number;
  pricingSource: string;
  pricingVersion: string;
  /** Echo of the caps used, so a reservation is reproducible from its record. */
  inputs: ApolloRunPricingInput;
};

function toNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Returns the full credit breakdown for one Apollo wizard run.
 *
 * search     = maxQueriesPerRun × maxPagesPerQuery × credits/non-empty page
 * enrichment = maxEnrichmentsPerRun × credits/enrichment (0 when disabled)
 *
 * `maxResultsPerQuery` NO participa: con cobro por página no vacía, el tamaño
 * de página no es una palanca de gasto.
 *
 * The total is what must be reserved before the first Apollo call.
 */
export function estimateApolloRunCreditBreakdown(
  input: ApolloRunPricingInput,
): ApolloRunCreditBreakdown {
  const queries = toNonNegativeInt(input.maxQueriesPerRun);
  const pagesPerQuery = toNonNegativeInt(input.maxPagesPerQuery);
  const results = toNonNegativeInt(input.maxResultsPerQuery);
  const enrichments = input.enrichmentEnabled
    ? toNonNegativeInt(input.maxEnrichmentsPerRun)
    : 0;

  const searchReservedCredits =
    queries * pagesPerQuery * APOLLO_CREDITS_PER_UNIT.organizations_search;
  const enrichmentReservedCredits =
    enrichments * APOLLO_CREDITS_PER_UNIT.organization_enrichment;

  return {
    searchReservedCredits,
    enrichmentReservedCredits,
    totalReservedCredits: searchReservedCredits + enrichmentReservedCredits,
    pricingSource: APOLLO_PRICING_SOURCE,
    pricingVersion: APOLLO_PRICING_VERSION,
    inputs: {
      maxQueriesPerRun: queries,
      maxPagesPerQuery: pagesPerQuery,
      maxResultsPerQuery: results,
      maxEnrichmentsPerRun: enrichments,
      enrichmentEnabled: input.enrichmentEnabled,
    },
  };
}

/**
 * Credits charged for N units of an operation.
 *
 * `units` se cuenta en la unidad DE ESA OPERACIÓN (`APOLLO_BILLABLE_UNIT`):
 * páginas no vacías para `organizations_search`, llamadas intentadas para
 * `organization_enrichment`. Prefiera los envoltorios nombrados de abajo: dicen
 * la unidad en el nombre y por eso no se pueden llamar con la cifra equivocada
 * por descuido.
 *
 * Used by usage logging so the credits it records and the credits the wizard
 * reserved come from the same table rather than two independent constants.
 */
export function creditsForApolloOperation(
  operation: ApolloBillableOperationKey,
  units: number,
): number {
  return toNonNegativeInt(units) * APOLLO_CREDITS_PER_UNIT[operation];
}

/**
 * Créditos de Organization Search: 1 por página NO VACÍA.
 *
 * El argumento son PÁGINAS, nunca organizaciones ni filas. Un llamador que
 * tenga a mano un conteo de resultados no tiene nada que hacer aquí.
 */
export function creditsForApolloNonEmptyPages(nonEmptyPages: number): number {
  return creditsForApolloOperation('organizations_search', nonEmptyPages);
}

/** Créditos de Organization Enrichment: 1 por llamada INTENTADA. */
export function creditsForApolloEnrichmentCalls(callsAttempted: number): number {
  return creditsForApolloOperation('organization_enrichment', callsAttempted);
}

/** Credits a single unit of the given operation costs. */
export function creditsForApolloOperationUnit(
  operation: ApolloBillableOperationKey,
): number {
  return APOLLO_CREDITS_PER_UNIT[operation];
}

/** True when the operation key is one this pricing model bills. */
export function isApolloBillableOperation(
  operationKey: string,
): operationKey is ApolloBillableOperationKey {
  return (APOLLO_BILLABLE_OPERATION_KEYS as readonly string[]).includes(operationKey);
}

/** Diagnostic shape persisted in batch/reservation metadata. No secrets. */
export type ApolloRunCreditBreakdownMetadata = {
  search_reserved_credits: number;
  enrichment_reserved_credits: number;
  total_reserved_credits: number;
  pricing_source: string;
  pricing_version: string;
  /** Unidad con la que se reservó la búsqueda. Sin esto, el número es ambiguo. */
  search_billing_unit: ApolloBillableUnit;
  max_queries_per_run: number;
  max_pages_per_query: number;
  max_results_per_query: number;
  max_enrichments_per_run: number;
  enrichment_enabled: boolean;
};

export function toApolloRunCreditBreakdownMetadata(
  breakdown: ApolloRunCreditBreakdown,
): ApolloRunCreditBreakdownMetadata {
  return {
    search_reserved_credits: breakdown.searchReservedCredits,
    enrichment_reserved_credits: breakdown.enrichmentReservedCredits,
    total_reserved_credits: breakdown.totalReservedCredits,
    pricing_source: breakdown.pricingSource,
    pricing_version: breakdown.pricingVersion,
    search_billing_unit: APOLLO_BILLABLE_UNIT.organizations_search,
    max_queries_per_run: breakdown.inputs.maxQueriesPerRun,
    max_pages_per_query: breakdown.inputs.maxPagesPerQuery,
    max_results_per_query: breakdown.inputs.maxResultsPerQuery,
    max_enrichments_per_run: breakdown.inputs.maxEnrichmentsPerRun,
    enrichment_enabled: breakdown.inputs.enrichmentEnabled,
  };
}

// ─── Estampado y lectura del modelo de precios en filas de uso ───────────────

/** Clave del bloque de pricing en `provider_usage_logs.metadata`. */
export const APOLLO_PRICING_METADATA_KEY = 'apollo_pricing' as const;

export type ApolloPricingMetadata = {
  pricing_version: string;
  pricing_source: string;
  billing_unit: ApolloBillableUnit;
};

/**
 * Bloque que estampa BAJO QUÉ MODELO se calculó el `credits_used` de esta fila.
 *
 * Antes de este corte ninguna fila de `organizations_search` lo llevaba, así
 * que una fila de julio (créditos = organizaciones) y una de hoy (créditos =
 * páginas no vacías) eran indistinguibles salvo por su fecha. Se escribe en
 * TODAS las filas de la operación —éxito, error, dry-run— porque el modelo es
 * un hecho de la fila, no de su desenlace.
 */
export function toApolloPricingMetadata(
  operation: ApolloBillableOperationKey,
): ApolloPricingMetadata {
  return {
    pricing_version: APOLLO_PRICING_VERSION,
    pricing_source: APOLLO_PRICING_SOURCE,
    billing_unit: APOLLO_BILLABLE_UNIT[operation],
  };
}

/**
 * Modelo bajo el que hay que leer el `credits_used` de una fila ya escrita.
 *
 *   'non_empty_page'                 — v2: créditos = páginas no vacías.
 *   'per_organization_returned_v1'   — v1 o SIN estampar: créditos =
 *                                      organizaciones devueltas. Sobre-anotado
 *                                      ~4,8× frente al cobro real medido.
 *
 * Regla deliberada: la AUSENCIA de bloque se resuelve como v1, nunca como v2.
 * El estampado nació en este corte, así que «no dice nada» sólo puede
 * significar «se escribió antes». Un lector que asumiera v2 por defecto
 * declararía correctas las 565 filas sobre-anotadas de Prod.
 *
 * Único lector autorizado de esa regla: paneles y reconciliaciones la llaman en
 * vez de re-derivarla por fecha.
 */
export type ApolloPricingModel = 'non_empty_page' | 'per_organization_returned_v1';

export function resolveApolloPricingModelFromMetadata(
  metadata: unknown,
): ApolloPricingModel {
  if (!metadata || typeof metadata !== 'object') return 'per_organization_returned_v1';
  const block = (metadata as Record<string, unknown>)[APOLLO_PRICING_METADATA_KEY];
  if (!block || typeof block !== 'object') return 'per_organization_returned_v1';
  const version = (block as Partial<ApolloPricingMetadata>).pricing_version;
  if (version === APOLLO_PRICING_VERSION) return 'non_empty_page';
  return 'per_organization_returned_v1';
}

/**
 * True cuando dos filas NO son comparables porque se escribieron bajo modelos
 * distintos. Sumarlas produce un total sin unidad.
 */
export function apolloPricingModelsAreComparable(
  leftMetadata: unknown,
  rightMetadata: unknown,
): boolean {
  return (
    resolveApolloPricingModelFromMetadata(leftMetadata) ===
    resolveApolloPricingModelFromMetadata(rightMetadata)
  );
}
