/**
 * Context Assembler — Context Validator (Hito 16AB.24.2)
 *
 * Validaciones determinísticas offline:
 * - Trazabilidad de reglas
 * - Presupuesto de tokens
 * - Integridad del contrato de salida
 * - Gates de bloqueo combinados
 *
 * No llama APIs externas. No modifica el contexto, solo lo valida.
 */

import type { ContextRule, CandidateDelta } from './types';
import type { TokenEstimate } from './token-estimator';
import { TOKEN_BUDGET } from './context-config';

// ─── Validación de reglas ─────────────────────────────────────────────────────

export type RuleValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

const VALID_EXECUTION_LAYERS = new Set(['model', 'code', 'combined']);
const VALID_PRIORITIES = new Set(['blocking', 'high', 'medium', 'normal']);

export function validateRules(rules: ContextRule[]): RuleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (const rule of rules) {
    if (!rule.ruleId) {
      errors.push('Regla sin ruleId');
      continue;
    }

    if (seenIds.has(rule.ruleId)) {
      errors.push(`ruleId duplicado: ${rule.ruleId}`);
    }
    seenIds.add(rule.ruleId);

    if (!rule.sourceDocument) {
      errors.push(`Regla ${rule.ruleId}: falta sourceDocument`);
    }

    if (!rule.sourceSection) {
      errors.push(`Regla ${rule.ruleId}: falta sourceSection`);
    }

    if (!VALID_EXECUTION_LAYERS.has(rule.executionLayer)) {
      errors.push(`Regla ${rule.ruleId}: executionLayer inválida: ${rule.executionLayer}`);
    }

    if (!VALID_PRIORITIES.has(rule.priority)) {
      warnings.push(`Regla ${rule.ruleId}: priority desconocida: ${rule.priority}`);
    }

    if (!rule.ruleSummary) {
      warnings.push(`Regla ${rule.ruleId}: sin ruleSummary`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Validación de presupuesto de tokens ─────────────────────────────────────

export type BudgetValidationResult = {
  status: 'ok' | 'warning' | 'exceeded';
  warnings: string[];
  errorCode?: 'context_budget_exceeded';
  detail?: string;
};

export function validateTokenBudget(estimate: TokenEstimate): BudgetValidationResult {
  const warnings: string[] = [];

  if (estimate.totalTokens > TOKEN_BUDGET.totalHardLimit) {
    return {
      status: 'exceeded',
      warnings,
      errorCode: 'context_budget_exceeded',
      detail: `Total estimado ${estimate.totalTokens} supera el límite de ${TOKEN_BUDGET.totalHardLimit} tokens.`,
    };
  }

  if (estimate.sharedTokens > TOKEN_BUDGET.sharedHardLimit) {
    return {
      status: 'exceeded',
      warnings,
      errorCode: 'context_budget_exceeded',
      detail: `Bloque compartido estimado ${estimate.sharedTokens} supera el límite de ${TOKEN_BUDGET.sharedHardLimit} tokens.`,
    };
  }

  if (estimate.candidateTokens > TOKEN_BUDGET.candidateHardLimit) {
    return {
      status: 'exceeded',
      warnings,
      errorCode: 'context_budget_exceeded',
      detail: `Delta candidato estimado ${estimate.candidateTokens} supera el límite de ${TOKEN_BUDGET.candidateHardLimit} tokens.`,
    };
  }

  if (estimate.sharedTokens > TOKEN_BUDGET.sharedWarningThreshold) {
    warnings.push(
      `Bloque compartido (${estimate.sharedTokens} tokens) cerca del límite de ${TOKEN_BUDGET.sharedHardLimit}.`
    );
  }

  if (estimate.candidateTokens > TOKEN_BUDGET.candidateWarningThreshold) {
    warnings.push(
      `Delta candidato (${estimate.candidateTokens} tokens) cerca del límite de ${TOKEN_BUDGET.candidateHardLimit}.`
    );
  }

  if (estimate.totalTokens > TOKEN_BUDGET.totalWarningThreshold) {
    warnings.push(
      `Total estimado (${estimate.totalTokens} tokens) cerca del límite de ${TOKEN_BUDGET.totalHardLimit}.`
    );
  }

  return {
    status: warnings.length > 0 ? 'warning' : 'ok',
    warnings,
  };
}

// ─── Validación de delta de candidato ────────────────────────────────────────

export type DeltaValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export function validateCandidateDelta(delta: CandidateDelta): DeltaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!delta.candidateName || delta.candidateName.trim() === '') {
    errors.push('candidateName es obligatorio');
  }

  if (delta.linkedinWarning) {
    warnings.push(delta.linkedinWarning);
  }

  // Gate: not_found incompatible con confianza Alta se evalúa en el modelo,
  // pero el delta no debe transportar URLs inválidas como si fueran válidas
  if (delta.proposedWebsite !== null) {
    if (!delta.proposedWebsite.startsWith('http')) {
      errors.push(`proposedWebsite no es URL válida: ${delta.proposedWebsite}`);
    }
  }

  if (delta.proposedLinkedin !== null) {
    if (!/linkedin\.com\/company\//i.test(delta.proposedLinkedin)) {
      errors.push(
        `proposedLinkedin no es URL corporativa de LinkedIn: ${delta.proposedLinkedin}`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Validación de trazabilidad completa ─────────────────────────────────────

export function validateTraceability(rules: ContextRule[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const rulesWithoutSource = rules.filter(
    (r) => !r.sourceDocument || !r.sourceSection
  );

  for (const r of rulesWithoutSource) {
    issues.push(`Regla ${r.ruleId} sin trazabilidad documental completa`);
  }

  const blockingRules = rules.filter((r) => r.priority === 'blocking');
  if (blockingRules.length === 0) {
    issues.push('No se encontraron reglas con prioridad blocking — verifique la carga del contexto');
  }

  return { valid: issues.length === 0, issues };
}
