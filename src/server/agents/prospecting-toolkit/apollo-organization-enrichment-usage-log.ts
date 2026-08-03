/**
 * apollo-organization-enrichment-usage-log.ts — Único escritor de
 * `provider_usage_logs` para `apollo` / `organization_enrichment`.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX · § 1.
 *
 * El hueco que cierra: había UN solo sitio que escribía la fila económica de un
 * Organization Enrichment —el bucle final de
 * `apollo-organizations-search-provider`— y la modalidad de dos rondas llama a
 * `runApolloOrganizationEnrichmentCascade` directamente, sin pasar por ese
 * bucle. Resultado: enrichments reales pagados que no dejaban ninguna fila en
 * `provider_usage_logs`, y por tanto una reconciliación que no podía verlos.
 *
 * Aquí vive el constructor de la fila y el escritor. Las DOS rutas lo usan:
 *
 *   ruta legacy (provider)   → un enrichment por entrada del cascade
 *   ruta de dos rondas       → un enrichment por operación del orquestador
 *
 * Lo que este módulo NO hace, a propósito:
 *   - no llama a Apollo (nunca vuelve a pedir nada para poder escribir el log);
 *   - no decide si hubo cobro: recibe el veredicto ya clasificado;
 *   - no promueve `credits_used` a "confirmado por el proveedor". Esa cantidad
 *     sigue siendo nuestra contabilidad, no la factura de Apollo.
 *
 * Idempotencia: `usage_key` es determinística y única por operación lógica, así
 * que un reintento que la repita choca contra el índice único y
 * `realLogApolloOrgsUsage` la reporta como `already_logged` — nunca como una
 * segunda fila ni un segundo crédito.
 */

import type { LogProviderUsageInput, ProviderUsageStatus } from '@/modules/usage-tracking/types';
import { creditsForApolloOperation } from './apollo-operation-pricing';
import {
  realLogApolloOrgsUsage,
  type ApolloOrgsUsageLogResult,
  type ApolloOrgsUsageLogDeps,
} from './apollo-organizations-usage-logging';
import {
  APOLLO_SPEND_OBSERVABILITY_KEY,
  buildApolloSpendObservabilityRecord,
  toApolloSpendObservabilityMetadata,
} from './apollo-spend-observability';
import { RUN_CORRELATION_METADATA_KEY } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import {
  APOLLO_LEGACY_BILLING_CONTRACT,
  type ApolloUsageBillingContractMetadata,
  type ApolloUsageOperationContextMetadata,
} from './apollo-usage-operation-context';
import type {
  RunCorrelationMetadata,
  WizardRunBillingState,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';

/** `operation_key` exacto con el que la fila aterriza en la tabla. */
export const APOLLO_ORGANIZATION_ENRICHMENT_OPERATION_KEY = 'organization_enrichment' as const;

/** `provider_key` de la cuenta de proveedor. No es el nombre del wizard. */
export const APOLLO_USAGE_PROVIDER_KEY = 'apollo' as const;

/**
 * Código de error estático de una operación cuyo cobro quedó indeterminado.
 *
 * Es el mismo vocabulario que el resultado devuelve al llamador, para que la
 * fila de la base y la respuesta de la ejecución se lean como el mismo hecho.
 */
export const APOLLO_OPERATION_INDETERMINATE_ERROR_CODE = 'apollo_operation_indeterminate' as const;

/** Código estático de una respuesta definitiva sin organización coincidente. */
export const APOLLO_ENRICHMENT_NO_MATCH_ERROR_CODE = 'organization_enrichment_no_match' as const;

// ─── Clasificación del cobro ──────────────────────────────────────────────────

/**
 * Qué sabemos del cobro de UN Organization Enrichment.
 *
 * `charged`       — Apollo devolvió una organización: hubo match y hubo cargo.
 * `no_match`      — respuesta definitiva SIN organización. No hay match al que
 *                   atribuir un crédito, y registrar 1 sería exactamente
 *                   "registrar un match inexistente como crédito confirmado".
 * `not_charged`   — el proveedor respondió con un error definitivo (credencial,
 *                   permiso, parámetro): la operación no llegó a facturarse.
 * `indeterminate` — la petición SALIÓ y no volvió (timeout, corte, 5xx, cuota
 *                   agotada tras el envío). Apollo pudo haberla procesado y
 *                   cobrado. No se reintenta y no se afirma un número.
 */
export type ApolloEnrichmentBillingOutcome =
  | 'charged'
  | 'no_match'
  | 'not_charged'
  | 'indeterminate';

export type ApolloEnrichmentTransportObservation = {
  /** El transporte lanzó: la petición salió y no hubo respuesta interpretable. */
  threw?: boolean;
  /** El fallo fue timeout / abort. */
  timedOut?: boolean;
  /** `success` del resultado del cliente Apollo. */
  success?: boolean;
  /** True cuando la respuesta trajo una organización. */
  matched?: boolean;
  /** Status HTTP del fallo, cuando el cliente lo expuso. */
  statusCode?: number | null;
};

/**
 * Traduce una observación del transporte al veredicto de cobro.
 *
 * Conservador en la dirección que importa: ante la duda, `indeterminate` —que
 * obliga a conciliación manual y bloquea el reintento automático— en vez de
 * `not_charged`, que daría por gratis una llamada que pudo costar.
 */
export function classifyApolloEnrichmentBillingOutcome(
  observation: ApolloEnrichmentTransportObservation,
): ApolloEnrichmentBillingOutcome {
  if (observation.threw === true || observation.timedOut === true) return 'indeterminate';

  if (observation.success === true) {
    return observation.matched === true ? 'charged' : 'no_match';
  }

  const status = observation.statusCode ?? null;
  // Sin status no hay respuesta que interpretar: la petición salió y no sabemos
  // qué pasó con ella.
  if (status === null) return 'indeterminate';
  // 5xx y 429 pueden haberse procesado del otro lado antes de fallar.
  if (status >= 500 || status === 429) return 'indeterminate';
  // 4xx definitivos: credencial, permiso, parámetro. No hay cargo.
  if (status >= 400) return 'not_charged';
  // Un 2xx que llegó aquí es una respuesta sin datos interpretables.
  return 'indeterminate';
}

/**
 * Reconstruye el veredicto desde la metadata que el cascade dejó, cuando el
 * transporte no se pudo observar (un llamador que inyecta el cascade completo).
 *
 * `enrichment_returned_no_data` es el literal EXACTO con el que el cascade marca
 * un 200 sin organización, así que ese caso se reconoce como `no_match`.
 * Cualquier otro fallo del cascade se resuelve como `indeterminate`: desde
 * fuera del transporte no se puede distinguir un 401 de un timeout, y suponer
 * "no costó" sería la suposición equivocada.
 */
export function classifyApolloEnrichmentOutcomeFromCascadeEntry(entry: {
  enriched?: boolean;
  skip_reason?: string;
  error?: string;
}): ApolloEnrichmentBillingOutcome {
  if (entry.enriched === true) return 'charged';
  if (entry.skip_reason !== 'enrichment_failed') return 'not_charged';
  return entry.error === 'enrichment_returned_no_data' ? 'no_match' : 'indeterminate';
}

// ─── Proyección del veredicto a la fila ───────────────────────────────────────

export type ApolloEnrichmentUsageAccounting = {
  /** `undefined` ⇒ columna NULL. Nunca 0 fabricado para un cobro desconocido. */
  creditsUsed: number | undefined;
  resultsReturned: number;
  status: ProviderUsageStatus;
  errorCode: string | undefined;
  billingState: WizardRunBillingState;
};

/**
 * Cuánto se registra por cada veredicto.
 *
 * `charged` es el único caso con crédito registrado. `indeterminate` deja
 * `credits_used` en NULL a propósito: la reconciliación lee ese NULL como
 * `usage_credits_unknown` y la corrida termina en `billing_unknown` en vez de
 * declararse conciliada con un número inventado.
 */
export function resolveApolloEnrichmentUsageAccounting(
  outcome: ApolloEnrichmentBillingOutcome,
): ApolloEnrichmentUsageAccounting {
  switch (outcome) {
    case 'charged':
      return {
        creditsUsed: creditsForApolloOperation(APOLLO_ORGANIZATION_ENRICHMENT_OPERATION_KEY, 1),
        resultsReturned: 1,
        status: 'success',
        errorCode: undefined,
        billingState: 'recorded',
      };
    case 'no_match':
      return {
        creditsUsed: 0,
        resultsReturned: 0,
        status: 'success',
        errorCode: APOLLO_ENRICHMENT_NO_MATCH_ERROR_CODE,
        billingState: 'estimated',
      };
    case 'not_charged':
      return {
        creditsUsed: 0,
        resultsReturned: 0,
        status: 'error',
        errorCode: 'enrichment_failed',
        billingState: 'estimated',
      };
    case 'indeterminate':
      return {
        creditsUsed: undefined,
        resultsReturned: 0,
        status: 'error',
        errorCode: APOLLO_OPERATION_INDETERMINATE_ERROR_CODE,
        billingState: 'unknown',
      };
  }
}

// ─── usage_key ────────────────────────────────────────────────────────────────

/**
 * Clave determinística de UNA operación de enrichment.
 *
 * Con `operationId` (modalidad de dos rondas) la clave es estable entre
 * reintentos y distinta por ronda y por organización, porque el `operationId` ya
 * es un digest de (correlación, ronda, sujeto). Sin él se conserva la forma
 * histórica de la ruta legacy —dominio, y timestamp sólo cuando no hay lote—
 * para no cambiar claves ya escritas.
 */
export function buildApolloEnrichmentUsageKey(input: {
  batchId?: string | null;
  domain?: string | null;
  operationId?: string | null;
  fallbackTimestampMs: number;
}): string {
  const subject = input.operationId ?? input.domain ?? 'unknown';
  if (input.batchId) {
    return `${APOLLO_ORGANIZATION_ENRICHMENT_OPERATION_KEY}:${input.batchId}:${subject}`;
  }
  return `${APOLLO_ORGANIZATION_ENRICHMENT_OPERATION_KEY}:no_batch:${subject}:${input.fallbackTimestampMs}`;
}

// ─── Constructor de la fila ───────────────────────────────────────────────────

export type ApolloEnrichmentUsageLogInput = {
  batchId?: string | null;
  agentRunId?: string | null;
  triggeredByUserId?: string | null;
  /** Dominio enriquecido. Es identidad de empresa, no dato personal. */
  domain: string | null;
  /** Campos que el enrichment añadió. Nombres, nunca valores. */
  fieldsAdded?: readonly string[];
  cascadeVersion?: string | null;
  /** Costo unitario vivo. `null` ⇒ costo desconocido, jamás 0 fabricado. */
  unitCostUsd?: number | null;
  errorMessage?: string | null;
  /** Correlación económica de la corrida. */
  runCorrelation?: RunCorrelationMetadata | null;
  /** § 2 — ronda, operación y sujeto. Ausente en la ruta legacy. */
  operationContext?: ApolloUsageOperationContextMetadata | null;
  /**
   * Sella el `billing_state` de ESTA operación dentro de la correlación.
   *
   * Sólo lo pide la modalidad de dos rondas, que es la que distingue cuatro
   * veredictos de cobro por operación. La ruta legacy deja pasar la correlación
   * de la corrida tal cual: cambiarle el `billing_state` reescribiría filas cuyo
   * significado nadie ha auditado todavía, y ese no es el hueco que este hito
   * cierra.
   */
  stampOperationBillingState?: boolean;
  /**
   * CAS-CLOSE § 5 — bajo qué contrato económico se escribió esta fila.
   *
   * Por defecto el legacy, que es el criterio que esta fila ha tenido siempre:
   * omitirlo NO cambia la fila más allá de dos claves aditivas, y ningún fixture
   * que compare el resto de la metadata se rompe.
   */
  billingContract?: ApolloUsageBillingContractMetadata;
  /** Contabilidad ya resuelta desde el veredicto de cobro. */
  accounting: ApolloEnrichmentUsageAccounting;
  usageKey: string;
  durationMs?: number | null;
};

/**
 * Construye la fila. Un solo constructor para las dos rutas: si la forma de la
 * fila divergiera entre ellas, la reconciliación tendría que conocer dos
 * contratos para el mismo gasto.
 *
 * La correlación viaja SIEMPRE en `metadata.run_correlation`, incluidos los
 * casos `no_match`, `not_charged` e `indeterminate`: una operación sin cargo
 * conocido sigue perteneciendo a una reserva concreta, y perder esa atadura es
 * perder la capacidad de explicarla después.
 */
export function buildApolloEnrichmentUsageLogInput(
  input: ApolloEnrichmentUsageLogInput,
): LogProviderUsageInput {
  const { accounting } = input;
  const runCorrelation = input.runCorrelation
    ? {
        [RUN_CORRELATION_METADATA_KEY]: input.stampOperationBillingState
          ? { ...input.runCorrelation, billing_state: accounting.billingState }
          : input.runCorrelation,
      }
    : {};

  return {
    usage_key: input.usageKey,
    provider_key: APOLLO_USAGE_PROVIDER_KEY,
    operation_key: APOLLO_ORGANIZATION_ENRICHMENT_OPERATION_KEY,
    batch_id: input.batchId ?? undefined,
    agent_run_id: input.agentRunId ?? undefined,
    credits_used: accounting.creditsUsed,
    results_returned: accounting.resultsReturned,
    estimated_cost_usd: input.unitCostUsd ?? null,
    status: accounting.status,
    error_code: accounting.errorCode,
    error_message: input.errorMessage ? input.errorMessage.slice(0, 200) : undefined,
    duration_ms: input.durationMs ?? undefined,
    triggered_by: input.triggeredByUserId ?? undefined,
    metadata: {
      domain: input.domain,
      fields_added: input.fieldsAdded ? [...input.fieldsAdded] : [],
      cascade_version: input.cascadeVersion ?? null,
      pricing_missing_warning: (input.unitCostUsd ?? null) === null,
      billing_outcome_billing_state: accounting.billingState,
      // § 5 — el criterio bajo el que se leyó el cobro, explícito en la fila. Sin
      // migración: dos claves aditivas dentro del JSONB que ya se escribía.
      ...(input.billingContract ?? APOLLO_LEGACY_BILLING_CONTRACT),
      ...runCorrelation,
      ...(input.operationContext
        ? {
            round_number: input.operationContext.round_number,
            operation_key: input.operationContext.operation_key,
            operation_subject: input.operationContext.operation_subject,
            operation_id: input.operationContext.operation_id,
            provider_request_id: input.operationContext.provider_request_id,
          }
        : {}),
      [APOLLO_SPEND_OBSERVABILITY_KEY]: toApolloSpendObservabilityMetadata(
        buildApolloSpendObservabilityRecord({
          resultsReturned: accounting.resultsReturned,
          billingState: accounting.billingState,
          recordedUsageCredits: accounting.creditsUsed ?? null,
        }),
      ),
    },
  };
}

export type ApolloEnrichmentUsageLogDeps = ApolloOrgsUsageLogDeps & {
  /** Escritor inyectable. Por defecto el logger real con manejo de 23505. */
  log?: typeof realLogApolloOrgsUsage;
};

/** Escribe UNA fila por enrichment. Nunca lanza; el resultado se reporta. */
export async function logApolloOrganizationEnrichmentUsage(
  input: ApolloEnrichmentUsageLogInput,
  deps?: ApolloEnrichmentUsageLogDeps,
): Promise<ApolloOrgsUsageLogResult> {
  const log = deps?.log ?? realLogApolloOrgsUsage;
  return log(buildApolloEnrichmentUsageLogInput(input), {
    client: deps?.client,
    warn: deps?.warn,
  });
}
