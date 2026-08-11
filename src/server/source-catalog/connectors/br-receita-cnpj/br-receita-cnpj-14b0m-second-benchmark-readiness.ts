/**
 * BR Receita CNPJ — SECOND-BENCHMARK TECHNICAL READINESS (BR-SOURCE-14B.0M § 29).
 *
 * BR-SOURCE-14B.0L's own memory record states the exact stale shortcut this gate exists to remove:
 * "18/18 partes adquiridas ⇒ NATIONAL_INPUT_COMPLETENESS=complete" was read as the dataset having
 * become second-benchmark-ready, when the actual blocker was structural — the manifest bridge
 * rejected a second entry per family, so the pipeline still only read 1 of 10 parts regardless of how
 * many were on disk. `NATIONAL_INPUT_COMPLETENESS == complete` is necessary; it was never sufficient.
 *
 * This module states the full conjunction explicitly, as a pure function over inputs the caller
 * supplies — it holds no global state and hardcodes no verdict for any of the seven conditions. Each
 * one is evidence that must be established elsewhere (the 14B.0J/14B.0K inventory gate, the manifest
 * bridge's own tests, the identifier-shape module's tests, the size preflight, the attempt ledger) and
 * handed in; this module only refuses to call the AND anything but what it actually is.
 *
 * `ATTEMPT_2_AUTHORIZED` is NEVER a function of this result (§ 29 says so explicitly) — technical
 * readiness is a precondition for asking an owner, never a substitute for being answered. Nothing in
 * this module reads, writes, or references the attempt ledger's authorization flag.
 */

export type BrazilReceitaBytesCapPreflightVerdict = 'pass' | 'fail' | 'indeterminate';

export interface BrazilReceitaSecondBenchmarkReadinessInputs {
  readonly nationalInputCompletenessVerdict: 'complete' | 'incomplete' | 'indeterminate';
  readonly nationalMultiPartInputReady: boolean;
  readonly parserJoinAlphanumericCompatible: boolean;
  readonly numericCnpjRedactionReady: boolean;
  readonly alphanumericCnpjRedactionReady: boolean;
  readonly fullNationalBytesCapPreflight: BrazilReceitaBytesCapPreflightVerdict;
  readonly attempt2StructurallySupported: boolean;
}

export interface BrazilReceitaSecondBenchmarkReadinessResult {
  readonly technicallyReady: boolean;
  /** Every condition that did NOT hold. Empty exactly when `technicallyReady` is `true`. */
  readonly unmetConditions: readonly string[];
}

/**
 * Evaluates whether every one of the seven conditions § 29 requires holds. All seven, every time —
 * there is no early return, so a caller sees the FULL list of what is missing in one pass.
 */
export function evaluateBrazilReceitaSecondBenchmarkTechnicalReadiness(
  inputs: BrazilReceitaSecondBenchmarkReadinessInputs,
): BrazilReceitaSecondBenchmarkReadinessResult {
  const unmetConditions: string[] = [];

  if (inputs.nationalInputCompletenessVerdict !== 'complete') {
    unmetConditions.push('national_input_completeness_not_complete');
  }
  if (!inputs.nationalMultiPartInputReady) {
    unmetConditions.push('national_multi_part_input_not_ready');
  }
  if (!inputs.parserJoinAlphanumericCompatible) {
    unmetConditions.push('parser_join_alphanumeric_incompatible');
  }
  if (!inputs.numericCnpjRedactionReady) {
    unmetConditions.push('numeric_cnpj_redaction_not_ready');
  }
  if (!inputs.alphanumericCnpjRedactionReady) {
    unmetConditions.push('alphanumeric_cnpj_redaction_not_ready');
  }
  if (inputs.fullNationalBytesCapPreflight === 'fail') {
    unmetConditions.push('full_national_bytes_cap_preflight_failed');
  }
  if (!inputs.attempt2StructurallySupported) {
    unmetConditions.push('attempt_2_not_structurally_supported');
  }

  return { technicallyReady: unmetConditions.length === 0, unmetConditions };
}
