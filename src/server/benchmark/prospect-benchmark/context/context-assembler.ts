/**
 * Context Assembler — Assembler (Hotfix 16AB.24.5)
 *
 * Orquesta el ensamblado completo del contexto de verificación.
 * Separa modelContext (payload para Claude) de internalPolicyContext (código).
 * No llama Anthropic ni ninguna API externa.
 * No ejecuta el benchmark real.
 * No modifica producción.
 */

import { createHash } from 'node:crypto';

import type { ContextRule, AssembledVerificationContext, AssembleOptions, AssembleResult } from './types';
import { CONTEXT_VERSION } from './context-config';
import {
  resolveCountryKey,
  resolveIndustryKey,
  loadCountryProfile,
  loadIndustryProfile,
  loadEvidencePolicy,
  extractRulesFromProfile,
  extractAllSharedRules,
} from './context-loader';
import { buildCandidateDelta } from './candidate-delta-builder';
import { buildTokenEstimate } from './token-estimator';
import { validateTokenBudget, validateRules, validateCandidateDelta } from './context-validator';
import { buildModelContext, buildInternalPolicyContext } from './compact-context-builder';

// ─── Serialización estable para hashes ───────────────────────────────────────

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + (value as unknown[]).map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

// ─── Deduplicación y ordenado determinístico de reglas ───────────────────────

function deduplicateRules(rules: ContextRule[]): ContextRule[] {
  const seen = new Set<string>();
  return rules.filter((r) => {
    if (seen.has(r.ruleId)) return false;
    seen.add(r.ruleId);
    return true;
  });
}

function sortRulesDeterministically(rules: ContextRule[]): ContextRule[] {
  const priorityOrder: Record<string, number> = {
    blocking: 0,
    high: 1,
    medium: 2,
    normal: 3,
  };
  return [...rules].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 9;
    const pb = priorityOrder[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

// ─── Ensamblador principal ────────────────────────────────────────────────────

export function assembleVerificationContext(options: AssembleOptions): AssembleResult {
  const { candidate, country, industry, mode = 'validation' } = options;

  const warnings: string[] = [];

  // 1. Normalizar y resolver perfiles
  const countryKey = resolveCountryKey(country);
  if (!countryKey) {
    return {
      ok: false,
      error: { code: 'unsupported_country', detail: `País no soportado: ${country}` },
    };
  }

  const industryKey = resolveIndustryKey(industry);
  if (!industryKey) {
    return {
      ok: false,
      error: { code: 'unsupported_industry', detail: `Industria no soportada: ${industry}` },
    };
  }

  // 2. Cargar perfiles
  const countryProfile = loadCountryProfile(countryKey);
  if (!countryProfile) {
    return {
      ok: false,
      error: { code: 'profile_not_found', detail: `Perfil de país no encontrado: ${countryKey}` },
    };
  }

  const industryProfile = loadIndustryProfile(industryKey);
  if (!industryProfile) {
    return {
      ok: false,
      error: { code: 'profile_not_found', detail: `Perfil de industria no encontrado: ${industryKey}` },
    };
  }

  // 3. Construir delta dinámico por candidato
  const delta = buildCandidateDelta(candidate);

  // 4. Validar delta
  const deltaValidation = validateCandidateDelta(delta);
  if (!deltaValidation.valid) {
    return {
      ok: false,
      error: {
        code: 'invalid_candidate_delta',
        detail: deltaValidation.errors.join('; '),
      },
    };
  }
  warnings.push(...deltaValidation.warnings);

  // 5. Recopilar todas las reglas con trazabilidad
  const sharedRules = extractAllSharedRules();
  const countryRules = extractRulesFromProfile(countryProfile);
  const industryRules = extractRulesFromProfile(industryProfile);

  const allRules = [...sharedRules, ...countryRules, ...industryRules];

  // 6. Deduplicar y ordenar determinísticamente
  const uniqueRules = deduplicateRules(allRules);
  const sortedRules = sortRulesDeterministically(uniqueRules);

  // 7. Validar trazabilidad
  const ruleValidation = validateRules(sortedRules);
  if (!ruleValidation.valid) {
    return {
      ok: false,
      error: { code: 'rule_traceability_error', detail: ruleValidation.errors.join('; ') },
    };
  }
  warnings.push(...ruleValidation.warnings);

  // 8. Construir contexto separado modelo / interno
  const evidencePolicy = loadEvidencePolicy();
  const modelContext = buildModelContext(countryProfile, industryProfile, sortedRules);
  const internalPolicyContext = buildInternalPolicyContext(sortedRules, countryProfile, evidencePolicy);

  // 9. Calcular hashes estables
  //    sharedContextHash: basado en modelContext (lo que envía al modelo)
  const sharedContextHash = sha256(stableStringify(modelContext));
  const candidateDeltaHash = sha256(stableStringify(delta));
  const assembledContextHash = sha256(
    stableStringify({ modelContext, internalPolicyContext, delta, contextVersion: CONTEXT_VERSION }),
  );

  // 10. Estimar tokens por capa
  const tokenEstimate = buildTokenEstimate(modelContext, delta, internalPolicyContext);

  // 11. Validar presupuesto de tokens (solo sobre contexto del modelo)
  const budgetResult = validateTokenBudget(tokenEstimate);
  if (budgetResult.status === 'exceeded') {
    return {
      ok: false,
      error: {
        code: budgetResult.errorCode ?? 'context_budget_exceeded',
        detail: budgetResult.detail ?? 'Presupuesto de tokens excedido',
        estimatedTokens: tokenEstimate.totalTokens,
        limitTokens: 5_500,
      } as { code: 'context_budget_exceeded'; detail: string; estimatedTokens: number; limitTokens: number },
    };
  }
  warnings.push(...budgetResult.warnings);

  // 12. Construir resultado final
  const context: AssembledVerificationContext = {
    contextVersion: CONTEXT_VERSION,
    mode,
    countryProfile: countryKey,
    industryProfile: industryKey,

    modelContext,
    internalPolicyContext,
    traceability: sortedRules,
    candidateDelta: delta,

    appliedRuleIds: sortedRules.map((r) => r.ruleId),

    sharedContextHash,
    candidateDeltaHash,
    assembledContextHash,

    estimatedModelSharedTokens: tokenEstimate.sharedTokens,
    estimatedCandidateTokens: tokenEstimate.candidateTokens,
    estimatedModelTotalTokens: tokenEstimate.totalTokens,
    estimatedFullInternalContextTokens: tokenEstimate.fullInternalContextTokens,

    cacheable: true,
    warnings,
  };

  return { ok: true, context };
}
