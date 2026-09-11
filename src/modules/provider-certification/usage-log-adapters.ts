/**
 * usage-log-adapters.ts — de la fila de gasto que YA existe a la línea base
 * comparable.
 *
 * A1-CERTIFICATION-BASELINE § CUT-C.3.
 *
 * Estos dos adaptadores son la PRUEBA de la auditoría: demuestran, campo por
 * campo, qué parte de la certificación es alcanzable hoy leyendo
 * `provider_usage_logs` —sin migración, sin corrida nueva y sin volver a pagar—
 * y qué parte no lo es.
 *
 * 🔴 Ninguno de los dos INVENTA. Un campo que su proveedor no publica sale
 * `null`, y `buildCertificationBaselineRow` lo nombra con su costura.
 *
 * 🔴 Las formas de entrada son las REALES, verificadas contra Producción el
 * 11-09-2026:
 *
 *   apollo/organizations_search  → metadata.{apollo_benchmark_funnel,
 *                                  apollo_pagination, country, countryCode,
 *                                  industry, run_correlation}
 *   lusha/company_prospecting_v3 → metadata.{lusha_run_observability,
 *                                  run_correlation}
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

import {
  buildCertificationBaselineRow,
  type CertificationBaselineInput,
  type CertificationBaselineRow,
} from './certification-baseline';

/** La fila de `provider_usage_logs` que hace falta. Estructural a propósito. */
export interface ProviderUsageLogLike {
  readonly provider_key: string;
  readonly operation_key: string;
  readonly credits_used: number | null;
  readonly results_returned: number | null;
  readonly duration_ms: number | null;
  readonly wizard_run_id: string | null;
  readonly request_fingerprint: string | null;
  readonly batch_id: string | null;
  readonly created_at: string | null;
  readonly metadata: Record<string, unknown> | null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Contexto que NO vive en la fila de gasto y que el llamador debe aportar si lo
 * tiene. Ausente ⇒ el campo sale `null` y se nombra su costura.
 */
export interface CertificationRunContext {
  /** Hoy SIEMPRE `null`: el esquema no tiene dónde guardarlo. */
  readonly certificationRunId?: string | null;
  /** Derivado de ordenar por `created_at` las filas del mismo `wizard_run_id`. */
  readonly providerOrder?: number | null;
  /** Conteo por disposición leído de `prospect_discarded_dispositions`. */
  readonly dispositions?: Readonly<Record<string, number>> | null;
  readonly finishedAt?: string | null;
}

/** Apollo: `provider_key='apollo'`, `operation_key='organizations_search'`. */
export function apolloUsageLogToCertificationBaseline(
  log: ProviderUsageLogLike,
  context: CertificationRunContext = {},
): CertificationBaselineRow {
  const meta = obj(log.metadata) ?? {};
  const funnel = obj(meta.apollo_benchmark_funnel) ?? {};
  const pagination = obj(meta.apollo_pagination) ?? {};
  const normalization = obj(pagination.normalization) ?? {};

  const input: CertificationBaselineInput = {
    provider: 'apollo',
    providerOrder: context.providerOrder ?? null,
    wizardRunId: log.wizard_run_id,
    batchId: log.batch_id,
    certificationRunId: context.certificationRunId ?? null,
    country: str(meta.countryCode) ?? str(meta.country),
    macroIndustry: str(meta.industry),
    requestFingerprint:
      log.request_fingerprint ?? str(pagination.effective_request_fingerprint_sent),
    pages: num(pagination.pages_processed),
    credits: num(log.credits_used),
    latencyMs: num(log.duration_ms),
    companiesSeen: num(funnel.paid_raw) ?? num(log.results_returned),
    // 🔴 El campo caro. Apollo lo publica `null` en 16 de 16 filas de Producción:
    // su propio embudo declara la costura. No se sustituye por `unique` ni por
    // `results_returned` — serían OTRA pregunta con el mismo nombre.
    companiesAccepted: num(funnel.accepted_for_target),
    companiesRejected: num(funnel.precision_rejected),
    // El conteo de empleados vive en el candidato escrito, no en la fila de
    // gasto: desde aquí no es observable.
    employeeCountKnown: null,
    identityResolved: num(funnel.unique),
    dedupeRemoved: num(funnel.duplicate) ?? num(normalization.duplicates_removed_count),
    dispositions: context.dispositions ?? null,
    startedAt: log.created_at,
    finishedAt: context.finishedAt ?? null,
  };
  return buildCertificationBaselineRow(input);
}

/** Lusha: `provider_key='lusha'`, `operation_key='company_prospecting_v3'`. */
export function lushaUsageLogToCertificationBaseline(
  log: ProviderUsageLogLike,
  context: CertificationRunContext = {},
): CertificationBaselineRow {
  const meta = obj(log.metadata) ?? {};
  const o = obj(meta.lusha_run_observability) ?? {};
  const run = obj(o.run) ?? {};

  const rejected =
    num(o.precision_rejected) !== null ||
    num(o.exact_duplicates) !== null ||
    num(o.target_overflow_discarded) !== null
      ? (num(o.precision_rejected) ?? 0) +
        (num(o.exact_duplicates) ?? 0) +
        (num(o.target_overflow_discarded) ?? 0)
      : null;

  const input: CertificationBaselineInput = {
    provider: 'lusha',
    providerOrder: context.providerOrder ?? null,
    wizardRunId: log.wizard_run_id,
    batchId: log.batch_id,
    certificationRunId: context.certificationRunId ?? null,
    country: str(o.country_code),
    macroIndustry: str(o.macro_industry_key),
    requestFingerprint: log.request_fingerprint,
    pages: num(run.providerRequestsUsed) ?? num(run.pagesAttempted),
    credits: num(o.credits_settled) ?? num(log.credits_used),
    latencyMs: num(log.duration_ms),
    companiesSeen: num(run.rawResultsTotal) ?? num(log.results_returned),
    // 🔴 Lusha SÍ lo publica. Ésa es exactamente la asimetría con Apollo que la
    // certificación tiene que ver declarada en vez de descubrir al comparar.
    companiesAccepted: num(o.accepted_for_target_total),
    companiesRejected: rejected,
    employeeCountKnown: null,
    identityResolved: null,
    dedupeRemoved: num(run.crossBranchDuplicatesRemoved),
    dispositions: context.dispositions ?? null,
    startedAt: log.created_at,
    finishedAt: context.finishedAt ?? null,
  };
  return buildCertificationBaselineRow(input);
}

/**
 * Deriva `provider_order` ordenando por reloj las filas de un mismo
 * `wizard_run_id`. Puro.
 *
 * 🔴 Se expone porque es el ÚNICO camino disponible hoy, no porque sea bueno:
 * dos filas del mismo instante quedan en orden de entrada, y este módulo no
 * puede saber cuál pierna corrió primero. La costura queda nombrada en
 * `CERT_SEAM_PROVIDER_ORDER_DERIVED_FROM_CLOCK`.
 */
export function deriveProviderOrder(
  logs: readonly ProviderUsageLogLike[],
): ReadonlyMap<ProviderUsageLogLike, number> {
  const sorted = [...logs].sort((a, b) => {
    const ta = a.created_at ?? '';
    const tb = b.created_at ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  return new Map(sorted.map((log, index) => [log, index + 1]));
}
