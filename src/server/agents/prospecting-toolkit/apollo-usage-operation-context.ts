/**
 * apollo-usage-operation-context.ts — Identidad de UNA operación Apollo dentro de
 * una corrida, tal como aterriza en `provider_usage_logs.metadata`.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX · § 2.
 *
 * El hueco que cierra: la correlación económica (`reservation_id`,
 * `client_request_id`, `wizard_run_id`, `request_fingerprint`,
 * `idempotency_key`) identifica la CORRIDA, pero no la operación. Con dos
 * búsquedas y dos enrichments por corrida, eso deja cuatro filas
 * indistinguibles entre sí: no se puede decir cuál fue la ronda 2, ni a qué
 * organización se le compró evidencia.
 *
 * Va en `metadata` y no en columnas nuevas a propósito: la migración 100 no
 * añadió `round_number` ni `operation_subject`, y este hito no crea esquema para
 * un dato que el JSONB ya transporta y que los lectores ya saben leer.
 *
 * Módulo deliberadamente sin dependencias: lo importan tanto el logger de
 * búsqueda como el de enrichment, y un tipo compartido en cualquiera de los dos
 * los volvería circulares.
 */

/** Operaciones Apollo que una ronda puede emitir. */
export type ApolloUsageOperationKey = 'organizations_search' | 'organization_enrichment';

export type ApolloUsageOperationContextMetadata = {
  round_number: number;
  operation_key: ApolloUsageOperationKey;
  /**
   * Sujeto concreto de la operación, ya sanitizado.
   *
   * Para una búsqueda: la huella de la hipótesis de consulta.
   * Para un enrichment: la organización — id del proveedor, dominio normalizado
   * o clave estable de candidato, en ese orden.
   *
   * Nunca un timestamp: dos reintentos de la misma operación deben producir el
   * mismo sujeto, y un reloj no garantiza eso.
   */
  operation_subject: string;
  /** Digest estable de (correlación, ronda, operación, sujeto). */
  operation_id: string;
  /** Id de la petición al proveedor cuando existe. Nunca inventado. */
  provider_request_id: string | null;
};

// ─── Contrato económico de la fila (CAS-CLOSE § 5) ────────────────────────────

/**
 * Qué modalidad produjo la fila y bajo qué criterio de cobro se escribió.
 *
 * Las dos rutas registran el gasto de un Organization Enrichment con criterios
 * DISTINTOS, y las dos son correctas para su contexto:
 *
 *   `apollo_legacy_v1`     — criterio histórico y conservador: un enrichment que
 *                            salió a la red registra 1 crédito, devolviera datos
 *                            o fallara después. No se reclasifica hacia atrás.
 *   `apollo_two_round_v1`  — clasificación por el desenlace OBSERVADO:
 *                            `charged` (1 crédito), `no_match` (0, hubo respuesta
 *                            definitiva sin organización), `not_charged` (0, error
 *                            definitivo antes de facturar) e `indeterminate`
 *                            (`credits_used` NULL — cobro desconocido, jamás 0).
 *
 * Sin este discriminador en la fila, la reconciliación tendría que inferir el
 * criterio por la forma de la metadata. Es aditivo dentro del JSONB: no hay
 * migración, no hay backfill y las filas históricas no se tocan.
 */
export type ApolloUsageExecutionMode = 'apollo_legacy' | 'apollo_two_round';
export type ApolloUsageBillingContractVersion = 'apollo_legacy_v1' | 'apollo_two_round_v1';

export type ApolloUsageBillingContractMetadata = {
  execution_mode: ApolloUsageExecutionMode;
  billing_contract_version: ApolloUsageBillingContractVersion;
};

export const APOLLO_LEGACY_BILLING_CONTRACT: ApolloUsageBillingContractMetadata = {
  execution_mode: 'apollo_legacy',
  billing_contract_version: 'apollo_legacy_v1',
};

export const APOLLO_TWO_ROUND_BILLING_CONTRACT: ApolloUsageBillingContractMetadata = {
  execution_mode: 'apollo_two_round',
  billing_contract_version: 'apollo_two_round_v1',
};
