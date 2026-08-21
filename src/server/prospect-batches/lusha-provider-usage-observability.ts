/**
 * lusha-provider-usage-observability.ts — Observabilidad económica CANÓNICA de
 * una corrida Lusha Macro-v2 de Agente 1.
 *
 * AGENT1-LUSHA-PROVIDER-USAGE-OBSERVABILITY-1.
 *
 * El hueco que cierra: la primera corrida REAL de Lusha (19-08) dejó facturación
 * veraz en `wizard_budget_reservations`, en `prospect_batches.metadata.billing` y
 * en la telemetría multi-rama, pero NINGUNA fila canónica en
 * `provider_usage_logs`. Ese alcance legacy era intencional —la acción sólo
 * estaba autorizada a escribir `prospect_batches` y `prospect_candidates`— así
 * que la corrida existía económicamente en tres sitios y era invisible en el
 * ledger que el resto de los proveedores SÍ alimentan.
 *
 * Qué NO es este módulo:
 *   - NO es una segunda autoridad de presupuesto. La reserva y su liquidación
 *     (M121 · `confirm_wizard_credits`) siguen siendo la ÚNICA autoridad de
 *     gasto. Aquí sólo se REGISTRA lo que esa autoridad ya decidió; nada de lo
 *     que hay debajo puede reservar, confirmar ni liberar un crédito.
 *   - NO reinterpreta el importe liquidado. Sin recortes: un sobrepaso real se
 *     publica como sobrepaso.
 *   - NO escribe `agent_runs` ni `agent_run_steps`. La frontera autorizada de
 *     este hito es exactamente UNA tabla existente: `provider_usage_logs`.
 *
 * Granularidad: UNA fila agregada por ejecución del wizard (§ 4). Ni una por
 * rama ni una por página — la reserva y la liquidación de Lusha son de corrida,
 * y una fila por página multiplicaría el mismo gasto por el número de páginas.
 *
 * Puro: sin I/O, sin `process.env`, sin `Date.now()`, sin aleatoriedad. Las
 * mismas entradas producen siempre la misma fila, que es lo que hace que el
 * registro sea idempotente.
 */

import type { LogProviderUsageInput, ProviderUsageStatus } from '@/modules/usage-tracking/types';
import {
  RUN_CORRELATION_METADATA_KEY,
  toRunCorrelationMetadata,
  type WizardRunBillingState,
  type WizardRunCorrelation,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import type { LushaBudgetSettlementOutcome } from '@/modules/prospect-batches/lusha-budget-gate';
import {
  toLushaRunTelemetryMetadata,
  type LushaRunTelemetry,
} from './lusha-multibranch-execution';

// ─── Contrato de la fila ──────────────────────────────────────────────────────

/** `provider_usage_logs.provider_key` de esta operación. */
export const LUSHA_COMPANY_DISCOVERY_PROVIDER_KEY = 'lusha' as const;

/**
 * `provider_usage_logs.operation_key` de esta operación.
 *
 * Coincide EXACTAMENTE con el `operation_key` de la fila activa de
 * `provider_pricing_config` (lusha/company_prospecting_v3/per_credit): el ledger
 * y la tarifa tienen que nombrar la misma operación o la conciliación compararía
 * dos cosas distintas.
 */
export const LUSHA_COMPANY_DISCOVERY_OPERATION_KEY = 'company_prospecting_v3' as const;

/** Prefijo del `usage_key`. Legible en una consulta, estable entre corridas. */
export const LUSHA_COMPANY_DISCOVERY_USAGE_KEY_PREFIX = 'lusha_company_prospecting' as const;

/**
 * Versión del MODELO de crédito de esta operación, no de la tarifa.
 *
 * Se sube cuando cambia lo que se cuenta (1 crédito por petición de página) o
 * cómo se deriva el importe liquidado. La TARIFA vive en
 * `provider_pricing_config` y viaja aparte como `pricing_config_id`, así que una
 * subida de precio no necesita tocar esta constante.
 */
export const LUSHA_COMPANY_DISCOVERY_PRICING_VERSION =
  'a1-lusha-company-prospecting-pricing-v1' as const;

/** Clave del bloque de observabilidad dentro de `metadata`. */
export const LUSHA_USAGE_OBSERVABILITY_METADATA_KEY = 'lusha_run_observability' as const;

/** Clave del bloque de tarifa dentro de `metadata`. */
export const LUSHA_USAGE_PRICING_METADATA_KEY = 'pricing' as const;

/**
 * De dónde sale el número de créditos registrado.
 *
 * `provider_reported`      — Lusha reportó el cobro por página y se liquidó eso.
 * `conservative_fallback`  — no reportó nada: se liquidó la reserva ENTERA.
 * `overage_reported`       — lo reportado superó lo reservado; se registra sin recortar.
 */
export type LushaUsageCreditsSource =
  | 'provider_reported'
  | 'conservative_fallback'
  | 'overage_reported';

// ─── ¿Hubo una operación PAGADA que registrar? ────────────────────────────────

/**
 * ¿Se emite una fila de uso PAGADO?
 *
 * Dos señales, en este orden, y ninguna redundante:
 *
 *   1. Lo que la CORRIDA declaró. `providerRequestsUsed` es la señal multi-rama y
 *      `pagesRequested` la histórica de una sola rama — la MISMA que
 *      `shouldReleaseLushaReservation` usa para decidir si la reserva se libera.
 *      Que las dos decisiones lean la misma señal es lo que impide que exista una
 *      fila pagada cuya reserva se liberó por no haber gastado.
 *
 *   2. Cuando la corrida NO llegó a declararlo —lanzó antes de devolver un
 *      resultado— manda el desenlace de la liquidación, que es la autoridad de
 *      gasto: `released` significa que la corrida fue estructuralmente incapaz de
 *      gastar ⇒ ninguna fila. Cualquier otro desenlace significa que hubo
 *      consumo (o que no se puede descartar), y ahí callar sería lo mentiroso: el
 *      presupuesto habría registrado un gasto conservador que el ledger negaría.
 *
 * Lo que NUNCA produce fila (§ 13): flag apagado, bloqueo de presupuesto, fallo de
 * reserva, credencial ausente ANTES de la llamada, routing indisponible y
 * validación fallida. Los seis se detienen aguas arriba y no llegan hasta aquí,
 * así que ninguno puede fabricar una fila de `company_prospecting_v3` diciendo que
 * se consumieron créditos que nadie cobró.
 */
export function shouldRecordLushaProviderUsage(input: {
  providerRequestsUsed?: number | null;
  pagesRequested?: number | null;
  settlementStatus: LushaBudgetSettlementOutcome['status'];
}): boolean {
  const declared = input.providerRequestsUsed ?? input.pagesRequested ?? null;
  if (declared !== null && Number.isFinite(declared)) return declared > 0;
  return input.settlementStatus !== 'released';
}

// ─── Idempotencia ─────────────────────────────────────────────────────────────

/**
 * `usage_key` determinístico de la corrida.
 *
 * Se DERIVA de la identidad que la corrida ya tenía antes de salir al proveedor:
 * `correlation.idempotencyKey` es `sha256(wizardRunId, reservationId)`, y
 * `wizardRunId` es a su vez `sha256(userId, clientRequestId)` — el mismo
 * `(user, clientRequestId)` sobre el que `try_reserve_wizard_credits` identifica
 * la reserva. Nada de `Math.random()`, nada de UUID acuñado después de la
 * corrida, nada de marcas de tiempo.
 *
 * Por qué el `usage_key` y no la columna `idempotency_key`: en Producción el
 * ÚNICO índice único disponible para esto es
 * `idx_provider_usage_usage_key_unique` (parcial, WHERE usage_key IS NOT NULL).
 * `idempotency_key` es una columna INDEXADA pero NO única, así que apoyar la
 * idempotencia en ella no impediría una segunda fila. La columna se escribe
 * igual, para poder consultar por ella; quien hace cumplir el «una sola fila»
 * es esta clave.
 */
export function buildLushaRunUsageKey(idempotencyKey: string): string {
  return `${LUSHA_COMPANY_DISCOVERY_USAGE_KEY_PREFIX}:${idempotencyKey}`;
}

/**
 * Firma estable de LO QUE SE PIDIÓ, para `request_fingerprint`.
 *
 * Sin PII y sin nombres de empresa: país, macro industria y la forma del plan.
 * Es lo que permite detectar «mismo id de corrida, petición distinta».
 */
export function buildLushaRunRequestSignature(input: {
  countryCode: string;
  macroIndustryKey: string;
  subIndustryId?: number | null;
  sizeBandKey?: string | null;
  branchCountPlanned: number;
  requiredCredits: number;
}): string {
  return [
    `country=${input.countryCode.trim().toUpperCase()}`,
    `macro=${input.macroIndustryKey.trim()}`,
    `sub=${input.subIndustryId ?? 'none'}`,
    `size=${input.sizeBandKey?.trim() ?? 'none'}`,
    `branches=${input.branchCountPlanned}`,
    `credits=${input.requiredCredits}`,
  ].join('|');
}

// ─── Semántica económica (§ 7) ────────────────────────────────────────────────

export type LushaUsageCreditsDecision = {
  /** Créditos LIQUIDADOS contra el presupuesto global de esta corrida. */
  creditsUsed: number;
  /** De dónde sale ese número. */
  creditsSource: LushaUsageCreditsSource;
  /** Lo que el proveedor reportó, o null si no reportó nada. */
  providerReportedCredits: number | null;
};

/**
 * Cuántos créditos registra la fila de uso.
 *
 * NO es una segunda aritmética: reproduce exactamente lo que la liquidación ya
 * decidió, leyendo su desenlace.
 *
 *   · `confirmed_with_overage` → el importe REAL que la RPC confirmó, sin
 *     recorte. La RPC es quien tiene la fila bloqueada y quien decide que hubo
 *     sobrepaso; aquí sólo se publica.
 *   · el resto → `decideLushaCreditsToConfirm` es la ÚNICA fuente del número,
 *     la misma función que la liquidación usó: reportado si lo hubo, reserva
 *     ENTERA si el proveedor no reportó nada (gasto no verificable ⇒ no se
 *     devuelve headroom, mismo sesgo conservador que Apollo/Tavily).
 *
 * Un costo desconocido NUNCA se representa como 0: cuando no hay número
 * reportado, el que se registra es el reservado, y `creditsSource` lo declara.
 */
export function decideLushaUsageCredits(input: {
  creditsReserved: number;
  creditsChargedTotal: number | null | undefined;
  settlement: LushaBudgetSettlementOutcome;
  /** La MISMA función que usó la liquidación. Inyectada, nunca reimplementada. */
  decideCreditsToConfirm: (args: {
    creditsReserved: number;
    creditsChargedTotal: number | null | undefined;
  }) => number;
}): LushaUsageCreditsDecision {
  const providerReportedCredits =
    typeof input.creditsChargedTotal === 'number' && Number.isFinite(input.creditsChargedTotal)
      ? input.creditsChargedTotal
      : null;

  if (input.settlement.status === 'confirmed_with_overage') {
    return {
      creditsUsed: input.settlement.creditsActual,
      creditsSource: 'overage_reported',
      providerReportedCredits,
    };
  }

  return {
    creditsUsed: input.decideCreditsToConfirm({
      creditsReserved: input.creditsReserved,
      creditsChargedTotal: input.creditsChargedTotal,
    }),
    creditsSource:
      providerReportedCredits === null ? 'conservative_fallback' : 'provider_reported',
    providerReportedCredits,
  };
}

/**
 * `billing_state` de la fila, dentro del vocabulario CANÓNICO de Agente 1.
 *
 * 🔑 El vocabulario NO es libre: `provider_usage_logs_billing_state_check` en
 * Producción sólo admite `unknown | estimated | recorded | provider_confirmed`,
 * y las filas Apollo de Agente 1 llevan `recorded`. Un valor inventado —del tipo
 * `actual_settled`— sería rechazado por la constraint y perdería el log entero.
 *
 *   · liquidada (confirmada, con sobrepaso, o ya terminal) ⇒ `recorded`:
 *     nuestras propias filas dicen lo que se gastó.
 *   · liquidación FALLIDA ⇒ `recorded` si el proveedor reportó un número (hay
 *     evidencia de gasto aunque el período no se pudiera cerrar), y `unknown`
 *     si no reportó nada: sin evidencia utilizable no se afirma un importe.
 *
 * `provider_confirmed` no se emite nunca automáticamente: eso exige una factura
 * externa, y nuestra contabilidad no es la de Lusha.
 */
export function resolveLushaUsageBillingState(input: {
  settlement: LushaBudgetSettlementOutcome;
  providerReportedCredits: number | null;
}): WizardRunBillingState {
  if (input.settlement.status === 'failed') {
    return input.providerReportedCredits === null ? 'unknown' : 'recorded';
  }
  return 'recorded';
}

// ─── Metadata SEGURA (§ 11) ───────────────────────────────────────────────────

/**
 * Tarifa aplicada. `unitCostUsd`/`pricingConfigId` null ⇒ no había tarifa activa
 * y el costo queda DESCONOCIDO (SQL NULL), nunca 0.
 */
export type LushaUsagePricingSnapshot = {
  pricingConfigId: string | null;
  unitCostUsd: number | null;
};

/**
 * Costo estimado de la fila.
 *
 * `null` cuando no hay tarifa activa: un costo desconocido reportado como 0
 * haría que un panel de gasto sumara cero por una corrida que sí se cobró.
 * Nunca hay un literal de tarifa en runtime — el número sale de
 * `provider_pricing_config`.
 */
export function resolveLushaUsageEstimatedCostUsd(
  creditsUsed: number,
  pricing: LushaUsagePricingSnapshot,
): number | null {
  if (pricing.unitCostUsd === null || !Number.isFinite(pricing.unitCostUsd)) return null;
  return creditsUsed * pricing.unitCostUsd;
}

/**
 * Filas CRUDAS que el proveedor devolvió, que es lo que la petición pagó (§ 10).
 *
 * NO es el número de candidatos persistidos: la calidad y el rendimiento son
 * analítica posterior y viajan en la metadata. Una fila de uso que publicara los
 * persistidos diría que una página de 10 devolvió 5, y la conciliación con la
 * factura dejaría de cuadrar.
 */
export function resolveLushaUsageResultsReturned(input: {
  rawResultsTotal?: number | null;
  resultsReturned?: number | null;
}): number {
  const raw = input.rawResultsTotal;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const reported = input.resultsReturned;
  if (typeof reported === 'number' && Number.isFinite(reported)) return reported;
  return 0;
}

export type LushaUsageObservabilityInput = {
  countryCode: string;
  macroIndustryKey: string;
  creditsReserved: number;
  credits: LushaUsageCreditsDecision;
  settlement: LushaBudgetSettlementOutcome;
  /** Telemetría completa de la corrida. Ya es snake_case y libre de PII. */
  telemetry?: LushaRunTelemetry | null;
  /** Métricas de admisión del writer, para la lectura de rendimiento. */
  admission: {
    reviewableFoundTotal: number | null;
    acceptedForTargetTotal: number;
    targetOverflowDiscarded: number | null;
    precisionRejectedTotal: number | null;
    historicalActiveSkips: number;
    exactDuplicates: number;
    possibleDuplicates: number;
  };
};

/**
 * Bloque de observabilidad SEGURO.
 *
 * Lo que entra: cifras, claves de catálogo, ids internos y motivos.
 * Lo que NO entra, ni aquí ni en ninguna rama: payload crudo del proveedor,
 * clave de API, correo, teléfono, PII de contacto, volcados de petición o
 * respuesta, y listas de empresas. Un nombre o un dominio de empresa no hace
 * falta para observar el COSTO de un proveedor, y tenerlo convertiría este
 * ledger en una copia no gobernada de los datos del proveedor.
 *
 * El detalle por rama/página sale de `toLushaRunTelemetryMetadata`, que es el
 * serializador que el lote ya usa: una segunda copia de la misma intención
 * derivaría en silencio.
 */
export function buildLushaUsageObservabilityMetadata(
  input: LushaUsageObservabilityInput,
): Record<string, unknown> {
  const { credits, admission } = input;
  return {
    country_code: input.countryCode.trim().toUpperCase(),
    macro_industry_key: input.macroIndustryKey.trim(),
    // Economía: reservado, reportado, liquidado y de dónde sale cada uno.
    credits_reserved: input.creditsReserved,
    provider_reported_credits: credits.providerReportedCredits,
    credits_settled: credits.creditsUsed,
    credits_source: credits.creditsSource,
    settlement_status: input.settlement.status,
    // Rendimiento: lo que la página pagada rindió frente a lo que el objetivo absorbió.
    reviewable_found_total: admission.reviewableFoundTotal,
    accepted_for_target_total: admission.acceptedForTargetTotal,
    target_overflow_discarded: admission.targetOverflowDiscarded,
    precision_rejected: admission.precisionRejectedTotal,
    historical_active_skips: admission.historicalActiveSkips,
    exact_duplicates: admission.exactDuplicates,
    possible_duplicates: admission.possibleDuplicates,
    // Corrida + ramas, del serializador canónico.
    run: input.telemetry ? toLushaRunTelemetryMetadata(input.telemetry) : null,
  };
}

// ─── Entrada completa del logger ──────────────────────────────────────────────

export type BuildLushaProviderUsageLogInput = LushaUsageObservabilityInput & {
  correlation: WizardRunCorrelation;
  billingState: WizardRunBillingState;
  pricing: LushaUsagePricingSnapshot;
  resultsReturned: number;
  triggeredByUserId: string;
  durationMs: number | null;
  /** `error` sólo cuando la corrida terminó en fallo de proveedor. */
  status: ProviderUsageStatus;
  /** Clasificación estable, nunca un mensaje crudo del proveedor. */
  errorCode: string | null;
};

/**
 * Construye la ÚNICA fila de uso de la corrida.
 *
 * `error_message` no se escribe A PROPÓSITO: el mensaje de una corrida fallida
 * puede arrastrar texto del proveedor, y `error_code` —una clasificación
 * estable— ya dice lo que un diagnóstico necesita.
 */
export function buildLushaProviderUsageLogInput(
  input: BuildLushaProviderUsageLogInput,
): LogProviderUsageInput {
  const observability = buildLushaUsageObservabilityMetadata(input);
  const runCorrelation = toRunCorrelationMetadata(input.correlation, input.billingState);

  return {
    provider_key: LUSHA_COMPANY_DISCOVERY_PROVIDER_KEY,
    operation_key: LUSHA_COMPANY_DISCOVERY_OPERATION_KEY,
    usage_key: buildLushaRunUsageKey(input.correlation.idempotencyKey),
    ...(input.correlation.batchId !== null ? { batch_id: input.correlation.batchId } : {}),
    credits_used: input.credits.creditsUsed,
    results_returned: input.resultsReturned,
    estimated_cost_usd: resolveLushaUsageEstimatedCostUsd(
      input.credits.creditsUsed,
      input.pricing,
    ),
    // Igual que Apollo: se concilia post-factura, jamás se afirma aquí.
    real_cost_usd: null,
    status: input.status,
    ...(input.errorCode !== null ? { error_code: input.errorCode } : {}),
    ...(input.durationMs !== null ? { duration_ms: input.durationMs } : {}),
    triggered_by: input.triggeredByUserId,
    metadata: {
      [RUN_CORRELATION_METADATA_KEY]: runCorrelation,
      [LUSHA_USAGE_OBSERVABILITY_METADATA_KEY]: observability,
      [LUSHA_USAGE_PRICING_METADATA_KEY]: {
        pricing_version: LUSHA_COMPANY_DISCOVERY_PRICING_VERSION,
        pricing_config_id: input.pricing.pricingConfigId,
        provider_key: LUSHA_COMPANY_DISCOVERY_PROVIDER_KEY,
        operation_key: LUSHA_COMPANY_DISCOVERY_OPERATION_KEY,
        unit: 'per_credit',
        unit_cost_usd: input.pricing.unitCostUsd,
        credits_priced: input.credits.creditsUsed,
      },
    },
  };
}
