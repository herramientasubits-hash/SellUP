/**
 * Context Assembler — Public API (Hito 16AB.24.2)
 *
 * Exporta únicamente las interfaces públicas del Context Assembler.
 * No exporta detalles de implementación interna.
 */

export { assembleVerificationContext } from './context-assembler';
export { CONTEXT_VERSION, TOKEN_BUDGET } from './context-config';
export { estimateTokens, estimateTokensFromObject } from './token-estimator';
export { buildCandidateDelta } from './candidate-delta-builder';

export type {
  VerificationCandidateInput,
  AssembledVerificationContext,
  AssembleOptions,
  AssembleResult,
  ContextRule,
  CandidateDelta,
  ExecutionLayer,
  RulePriority,
  ContextBudgetError,
} from './types';
