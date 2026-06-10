/**
 * Context Assembler — Assembler (Hito 16AB.24.2)
 *
 * Orquesta el ensamblado completo del contexto de verificación.
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
  loadSharedContext,
  loadEvidencePolicy,
  loadVerificationSchema,
  extractRulesFromProfile,
  extractAllSharedRules,
} from './context-loader';
import { buildCandidateDelta } from './candidate-delta-builder';
import { buildTokenEstimate } from './token-estimator';
import { validateTokenBudget, validateRules, validateCandidateDelta } from './context-validator';

// ─── Serialización estable para hashes ───────────────────────────────────────

function stableStringify(value: unknown): string {
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

// ─── Bloque compartido ────────────────────────────────────────────────────────

type SharedContextBlock = {
  globalRules: unknown;
  countryProfile: unknown;
  industryProfile: unknown;
  evidencePolicy: unknown;
  verificationSchema: unknown;
  contextVersion: string;
};

function buildSharedBlock(
  countryKey: string,
  industryKey: string
): SharedContextBlock | null {
  const countryProfile = loadCountryProfile(countryKey);
  if (!countryProfile) return null;

  const industryProfile = loadIndustryProfile(industryKey);
  if (!industryProfile) return null;

  return {
    globalRules: loadSharedContext(),
    countryProfile,
    industryProfile,
    evidencePolicy: loadEvidencePolicy(),
    verificationSchema: loadVerificationSchema(),
    contextVersion: CONTEXT_VERSION,
  };
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

  // 2. Construir bloque compartido cacheable
  const sharedBlock = buildSharedBlock(countryKey, industryKey);
  if (!sharedBlock) {
    return {
      ok: false,
      error: { code: 'profile_not_found', detail: `Perfil no encontrado: ${countryKey}/${industryKey}` },
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
  const countryRules = extractRulesFromProfile(sharedBlock.countryProfile);
  const industryRules = extractRulesFromProfile(sharedBlock.industryProfile);

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

  // 8. Calcular hashes estables
  const sharedContextHash = sha256(stableStringify(sharedBlock));
  const candidateDeltaHash = sha256(stableStringify(delta));
  const assembledContextHash = sha256(
    stableStringify({ sharedBlock, delta, contextVersion: CONTEXT_VERSION })
  );

  // 9. Estimar tokens
  const tokenEstimate = buildTokenEstimate(sharedBlock, delta);

  // 10. Validar presupuesto de tokens
  const budgetResult = validateTokenBudget(tokenEstimate);
  if (budgetResult.status === 'exceeded') {
    return {
      ok: false,
      error: {
        code: budgetResult.errorCode ?? 'context_budget_exceeded',
        detail: budgetResult.detail ?? 'Presupuesto de tokens excedido',
        estimatedTokens: tokenEstimate.totalTokens,
        limitTokens: 5200,
      } as { code: 'context_budget_exceeded'; detail: string; estimatedTokens: number; limitTokens: number },
    };
  }
  warnings.push(...budgetResult.warnings);

  // 11. Construir resultado final
  const context: AssembledVerificationContext = {
    contextVersion: CONTEXT_VERSION,
    mode,
    countryProfile: countryKey,
    industryProfile: industryKey,

    sharedContext: sharedBlock,
    candidateDelta: delta,

    appliedRuleIds: sortedRules.map((r) => r.ruleId),
    traceability: sortedRules,

    sharedContextHash,
    candidateDeltaHash,
    assembledContextHash,

    estimatedSharedTokens: tokenEstimate.sharedTokens,
    estimatedCandidateTokens: tokenEstimate.candidateTokens,
    estimatedTotalTokens: tokenEstimate.totalTokens,

    cacheable: true,
    warnings,
  };

  return { ok: true, context };
}
