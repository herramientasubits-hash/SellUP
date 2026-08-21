/**
 * prepaid-novelty-telemetry.ts — qué se puede AFIRMAR sobre lo que no se gastó.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 § 20.
 *
 * ── 🔴 Lo que este módulo se niega a publicar ────────────────────────────────
 *
 * No hay `credits_saved` ni `usd_saved`. Un ahorro exige un contrafactual: lo que
 * la corrida HABRÍA gastado. Ese número no existe salvo que un planificador real
 * lo haya calculado, y en la ruta Apollo la responsabilidad económica ni siquiera
 * depende del hueco (es un techo fijo por proveedor). Publicar un ahorro derivado
 * de `residualGap` sería inventar dinero, que es la clase de cifra que después se
 * cita en una decisión de negocio.
 *
 * Lo que sí se publica son hechos CONTABLES:
 *   · `provider_requests_avoided_by_zero_residual` — 1 cuando la corrida no llegó
 *     a pedir NADA porque el hueco era 0. Es un hecho observado, no una hipótesis.
 *   · `second_pages_avoided_zero_novelty` — cuántas páginas segundas no se
 *     compraron porque su rama vino seca. También observado.
 *
 * snake_case, como el resto del `metadata` del lote. Sin PII, sin nombres de
 * empresa, sin payload de proveedor.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { PrePaidNoveltyContext } from './prepaid-novelty-context';
import type { ProviderExclusionDomainPlan } from './provider-exclusion-domains';

/** Lo que el lado PAGADO de la corrida rindió. Lo rellena el ejecutor. */
export type PaidProviderTelemetryInput = {
  required: boolean;
  initialResidualGap: number;
  pagesAttempted: number;
  /** Páginas no compradas porque su rama vino sin novedad (§ 17). */
  pagesSkippedZeroNovelty: number;
  branchesAttempted: number;
  requestsUsed: number;
  usefulNovel: number;
};

export function buildPrePaidNoveltyTelemetry(
  context: PrePaidNoveltyContext,
  exclusionPlan: ProviderExclusionDomainPlan,
  paid?: PaidProviderTelemetryInput | null,
): Record<string, unknown> {
  const free = context.freeSource;

  return {
    requested_target: context.requestedTarget,
    country_source: {
      source_key: free.sourceKey,
      attempted: free.attempted,
      raw_returned: free.rawReturned,
      macro_confirmed: free.macroConfirmed,
      ambiguous: free.ambiguous,
      rejected: free.rejected,
      sellup_known: free.sellupKnown,
      hubspot_known: free.hubspotKnown,
      accepted_novel: free.acceptedNovel,
      failed: free.failed,
      failure_code: free.failureCode,
    },
    pre_provider: {
      accepted_before_provider: context.acceptedBeforeProvider,
      residual_gap: context.residualGap,
      known_domain_count: exclusionPlan.available,
      exclusion_domains_available: exclusionPlan.available,
      exclusion_domains_sent: exclusionPlan.sent.length,
      exclusion_domains_omitted: exclusionPlan.omittedDueToCap,
    },
    provider: paid
      ? {
          required: paid.required,
          initial_residual_gap: paid.initialResidualGap,
          pages_attempted: paid.pagesAttempted,
          pages_skipped_zero_novelty: paid.pagesSkippedZeroNovelty,
          branches_attempted: paid.branchesAttempted,
          requests_used: paid.requestsUsed,
          useful_novel: paid.usefulNovel,
        }
      : {
          required: context.providerRequired,
          initial_residual_gap: context.residualGap,
          pages_attempted: 0,
          pages_skipped_zero_novelty: 0,
          branches_attempted: 0,
          requests_used: 0,
          useful_novel: 0,
        },
    savings: {
      // Hechos observados, jamás contrafactuales. Ver la cabecera.
      provider_requests_avoided_by_zero_residual: context.providerRequired ? 0 : 1,
      second_pages_avoided_zero_novelty: paid?.pagesSkippedZeroNovelty ?? 0,
    },
  };
}
