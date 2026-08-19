/**
 * lusha-provider-usage-recorder.ts — Escribe la ÚNICA fila de uso de una corrida
 * Lusha Macro-v2, DESPUÉS de que la liquidación ya fue terminal.
 *
 * AGENT1-LUSHA-PROVIDER-USAGE-OBSERVABILITY-1 §§ 6, 12.
 *
 * Orden del contrato (§ 12), el mismo que Apollo demuestra en Producción:
 *
 *   ejecución del proveedor → liquidación veraz → observabilidad de uso
 *
 * Nada de lo que hay aquí puede reordenar eso, y por construcción no puede
 * provocar una segunda petición al proveedor ni una segunda liquidación: este
 * módulo no tiene ninguna dependencia del cliente de Lusha ni de las RPC de
 * presupuesto. Sus únicas dos operaciones son leer la tarifa activa e insertar
 * una fila.
 *
 * NUNCA lanza. Un fallo de observabilidad no puede convertir una corrida que el
 * proveedor YA cobró en un error del usuario: eso le ofrecería un reintento que
 * volvería a gastar. El fallo se DEVUELVE y se registra, nunca se propaga.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  insertCorrelatedProviderUsageRow,
  buildProviderUsageLogRowWithBillingState,
  buildCorrelationColumnsWithBillingState,
  type CorrelatedProviderUsageLogResult,
  type ProviderUsageInsertClient,
} from '@/modules/usage-tracking/correlated-provider-usage-log';
import { loadActiveLushaCompanyProspectingPricing } from '@/modules/usage-tracking/provider-pricing';
import type { ActiveProviderCreditPricingV1 } from '@/modules/usage-tracking/provider-pricing';
import {
  decideLushaCreditsToConfirm,
  type LushaBudgetSettlementOutcome,
} from '@/modules/prospect-batches/lusha-budget-gate';
import type { WizardRunCorrelation } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import {
  buildLushaProviderUsageLogInput,
  decideLushaUsageCredits,
  resolveLushaUsageBillingState,
  resolveLushaUsageResultsReturned,
  shouldRecordLushaProviderUsage,
  LUSHA_COMPANY_DISCOVERY_OPERATION_KEY,
  LUSHA_COMPANY_DISCOVERY_PROVIDER_KEY,
  type LushaUsagePricingSnapshot,
} from './lusha-provider-usage-observability';
import type { LushaRunTelemetry } from './lusha-multibranch-execution';

/** Código estable del log cuando la observabilidad no se pudo escribir. */
export const LUSHA_PROVIDER_USAGE_LOG_FAILED_CODE =
  'lusha_provider_usage_log_failed' as const;

export type RecordLushaProviderUsageResult =
  | CorrelatedProviderUsageLogResult
  /** El proveedor NUNCA fue llamado ⇒ no hay uso pagado que registrar (§ 13). */
  | { kind: 'skipped_provider_not_called' };

/** Lo que la corrida ya sabe de sí misma cuando llega aquí. */
export type RecordLushaProviderUsageInput = {
  correlation: WizardRunCorrelation;
  triggeredByUserId: string;
  countryCode: string;
  macroIndustryKey: string;
  creditsReserved: number;
  settlement: LushaBudgetSettlementOutcome;
  durationMs: number | null;
  run: {
    status: 'success' | 'empty' | 'error';
    creditsChargedTotal: number | null;
    resultsReturned: number | null;
    rawResultsTotal: number | null;
    pagesRequested: number | null;
    providerRequestsUsed: number | null;
    stopReason: string | null;
    reviewableFoundTotal: number | null;
    acceptedForTargetTotal: number;
    targetOverflowDiscarded: number | null;
    precisionRejectedTotal: number | null;
    historicalActiveSkips: number;
    exactDuplicates: number;
    possibleDuplicates: number;
    telemetry: LushaRunTelemetry | null;
  };
};

export type RecordLushaProviderUsageDeps = {
  /** Cliente de inserción. Por defecto, el admin de service-role. */
  client?: ProviderUsageInsertClient | null;
  /** Tarifa activa. Inyectable para probar sin base de datos. */
  loadPricing?: () => Promise<ActiveProviderCreditPricingV1 | null>;
  /** Sumidero del aviso de degradación por columna ausente. */
  warn?: (signal: string, detail: Record<string, unknown>) => void;
};

function tryGetAdminClient(): ProviderUsageInsertClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key) as unknown as ProviderUsageInsertClient;
}

/**
 * `provider_usage_logs.status` de la corrida.
 *
 * Sólo los cuatro valores que la CHECK constraint de Producción admite
 * (`success | error | rate_limited | quota_exceeded`). Un `empty` —el proveedor
 * respondió sin filas— es una petición EXITOSA que se cobró igual, así que no es
 * un error: publicarlo como tal haría que un panel leyera un fallo donde hubo un
 * cobro legítimo con cero resultados.
 */
function resolveUsageStatus(run: RecordLushaProviderUsageInput['run']): 'success' | 'error' {
  if (run.status === 'error') return 'error';
  if (run.stopReason === 'provider_failure') return 'error';
  return 'success';
}

/**
 * Registra el uso de la corrida. UNA fila, o ninguna.
 *
 * `pricing` null ⇒ costo DESCONOCIDO ⇒ `estimated_cost_usd` queda SQL NULL. No
 * hay ningún literal de tarifa en este runtime: el número sale siempre de
 * `provider_pricing_config`.
 */
export async function recordLushaRunProviderUsage(
  input: RecordLushaProviderUsageInput,
  deps?: RecordLushaProviderUsageDeps,
): Promise<RecordLushaProviderUsageResult> {
  try {
    // § 13 — sin petición al proveedor no hay uso pagado que registrar.
    if (
      !shouldRecordLushaProviderUsage({
        providerRequestsUsed: input.run.providerRequestsUsed,
        pagesRequested: input.run.pagesRequested,
        settlementStatus: input.settlement.status,
      })
    ) {
      return { kind: 'skipped_provider_not_called' };
    }

    const credits = decideLushaUsageCredits({
      creditsReserved: input.creditsReserved,
      creditsChargedTotal: input.run.creditsChargedTotal,
      settlement: input.settlement,
      decideCreditsToConfirm: decideLushaCreditsToConfirm,
    });

    const billingState = resolveLushaUsageBillingState({
      settlement: input.settlement,
      providerReportedCredits: credits.providerReportedCredits,
    });

    const loadPricing = deps?.loadPricing ?? loadActiveLushaCompanyProspectingPricing;
    const activePricing = await loadPricing().catch(() => null);
    const pricing: LushaUsagePricingSnapshot = {
      pricingConfigId: activePricing?.pricingConfigId ?? null,
      unitCostUsd: activePricing?.unitCostUsd ?? null,
    };

    const logInput = buildLushaProviderUsageLogInput({
      correlation: input.correlation,
      billingState,
      pricing,
      resultsReturned: resolveLushaUsageResultsReturned({
        rawResultsTotal: input.run.rawResultsTotal,
        resultsReturned: input.run.resultsReturned,
      }),
      triggeredByUserId: input.triggeredByUserId,
      durationMs: input.durationMs,
      status: resolveUsageStatus(input.run),
      errorCode: resolveUsageStatus(input.run) === 'error' ? (input.run.stopReason ?? 'lusha_run_error') : null,
      countryCode: input.countryCode,
      macroIndustryKey: input.macroIndustryKey,
      creditsReserved: input.creditsReserved,
      credits,
      settlement: input.settlement,
      telemetry: input.run.telemetry,
      admission: {
        reviewableFoundTotal: input.run.reviewableFoundTotal,
        acceptedForTargetTotal: input.run.acceptedForTargetTotal,
        targetOverflowDiscarded: input.run.targetOverflowDiscarded,
        precisionRejectedTotal: input.run.precisionRejectedTotal,
        historicalActiveSkips: input.run.historicalActiveSkips,
        exactDuplicates: input.run.exactDuplicates,
        possibleDuplicates: input.run.possibleDuplicates,
      },
    });

    return insertCorrelatedProviderUsageRow(
      {
        // `preserveUnknownEstimatedCost` es lo que impide que una tarifa ausente
        // se publique como un costo de 0 en una corrida que sí se cobró.
        baseRow: buildProviderUsageLogRowWithBillingState(logInput, billingState, {
          preserveUnknownEstimatedCost: true,
        }),
        correlationColumns: buildCorrelationColumnsWithBillingState(
          logInput.metadata,
          billingState,
        ),
        providerKey: LUSHA_COMPANY_DISCOVERY_PROVIDER_KEY,
        operationKey: LUSHA_COMPANY_DISCOVERY_OPERATION_KEY,
      },
      {
        client: deps?.client ?? tryGetAdminClient(),
        ...(deps?.warn ? { warn: deps.warn } : {}),
      },
    );
  } catch (err: unknown) {
    // Total a propósito: ni una excepción de tarifa, ni una de construcción de
    // fila, ni una del cliente puede escapar hacia el camino de la corrida.
    return {
      kind: 'failed',
      error: err instanceof Error ? err.message : 'unknown lusha usage logging error',
    };
  }
}
