// Q3F-5AX.2 — Cost completeness detection (pure, Phase 1).
//
// Decides how trustworthy the cost/outcome attribution is for a scope, WITHOUT
// pretending precision the data can't support. Pure functions only — no client,
// no provider calls, no writes.

import type { Agent1CostCompletenessFlag } from './types';

/** Minimal cost signal per provider usage row. */
export interface UsageCostSignal {
  providerKey: string;
  estimatedCostUsd: number | null;
  creditsUsed: number | null;
}

/**
 * Provider keys treated as LLM/AI cost sources. If a scope has usage rows but
 * none of these, LLM cost is very likely not persisted (a known Phase 1 gap).
 */
export const LLM_PROVIDER_KEYS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'claude',
  'gpt',
  'llm',
]);

/** A row is missing cost when estimated_cost_usd is null/undefined. */
export function isMissingCostRow(row: UsageCostSignal): boolean {
  return row.estimatedCostUsd == null;
}

/**
 * A zero-cost row is only SUSPICIOUS when credits were consumed (> 0) but the
 * estimated cost is exactly 0 — a strong hint the provider pricing is missing.
 * A plain 0 with 0 credits is not necessarily wrong (may be free/unknown).
 */
export function isSuspiciousZeroCostRow(row: UsageCostSignal): boolean {
  return row.estimatedCostUsd === 0 && (row.creditsUsed ?? 0) > 0;
}

/** True when at least one row comes from a known LLM/AI provider. */
export function hasLlmCostEvidence(rows: readonly UsageCostSignal[]): boolean {
  return rows.some((r) => LLM_PROVIDER_KEYS.has(r.providerKey.trim().toLowerCase()));
}

export interface CostCompletenessInput {
  usageRows: readonly UsageCostSignal[];
  /** Number of batches in scope; used to distinguish "empty scope" from "no cost". */
  batchesCount: number;
  /** True when any batch could not expose its generated-candidate count. */
  generatedCountsMissing: boolean;
}

export interface CostCompletenessResult {
  flag: Agent1CostCompletenessFlag;
  warnings: string[];
  missingCostRows: number;
  suspiciousZeroCostRows: number;
}

/**
 * Computes the completeness flag + warnings. Priority (most→least severe):
 *   unknown → missing_provider_pricing → missing_llm_cost →
 *   missing_candidate_outcomes → complete.
 *
 * Never throws: tolerates empty arrays, nulls, and unknown providers.
 */
export function computeCostCompleteness(input: CostCompletenessInput): CostCompletenessResult {
  const rows = input.usageRows ?? [];
  const missingCostRows = rows.filter(isMissingCostRow).length;
  const suspiciousZeroCostRows = rows.filter(isSuspiciousZeroCostRow).length;
  const warnings: string[] = [];

  // Empty scope, or batches with no provider usage logs at all → cannot attribute.
  if (input.batchesCount === 0) {
    warnings.push('No hay lotes en el alcance seleccionado; efectividad indeterminada.');
    return { flag: 'unknown', warnings, missingCostRows, suspiciousZeroCostRows };
  }
  if (rows.length === 0) {
    warnings.push('No hay registros de uso de proveedores para el alcance; el costo no es atribuible.');
    return { flag: 'unknown', warnings, missingCostRows, suspiciousZeroCostRows };
  }

  if (suspiciousZeroCostRows > 0) {
    warnings.push(
      `${suspiciousZeroCostRows} fila(s) con créditos > 0 pero costo 0: pricing de proveedor posiblemente ausente.`,
    );
  }

  // Most severe partial first.
  if (missingCostRows > 0) {
    warnings.push(`${missingCostRows} fila(s) sin estimated_cost_usd (pricing de proveedor faltante).`);
    return { flag: 'partial_missing_provider_pricing', warnings, missingCostRows, suspiciousZeroCostRows };
  }

  if (!hasLlmCostEvidence(rows)) {
    warnings.push('No se detectó costo de LLM persistido para el alcance (gap conocido de Fase 1).');
    return { flag: 'partial_missing_llm_cost', warnings, missingCostRows, suspiciousZeroCostRows };
  }

  if (input.generatedCountsMissing) {
    warnings.push('Algunos lotes no exponen su conteo de candidatos generados; el funnel es parcial.');
    return { flag: 'partial_missing_candidate_outcomes', warnings, missingCostRows, suspiciousZeroCostRows };
  }

  return { flag: 'complete', warnings, missingCostRows, suspiciousZeroCostRows };
}
