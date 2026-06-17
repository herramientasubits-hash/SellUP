import { z } from 'zod';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { detectPromptInjection, normalizeCriteria } from '@/modules/industry-catalog/schema';

// ── Request schema ────────────────────────────────────────────────────────────
// .strict() rejects unknown fields — targetCount and userId sent from the client
// are treated as invalid requests, not silently ignored.

export const wizardExecutionRequestSchema = z
  .object({
    countryCode: z
      .string()
      .min(1, 'País requerido.')
      .regex(/^[A-Z]{2}$/, 'Código de país inválido.'),
    industryId: z.string().uuid('ID de industria inválido.'),
    subindustryIds: z
      .array(z.string().uuid('ID de subindustria inválido.'))
      .max(
        EXPLORATORY_SEARCH_LIMITS.subindustries.max,
        `Máximo ${EXPLORATORY_SEARCH_LIMITS.subindustries.max} subindustrias.`,
      )
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'No se permiten subindustrias duplicadas.',
      ),
    additionalCriteriaRaw: z
      .string()
      .max(
        EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars,
        `El criterio específico puede tener máximo ${EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars} caracteres.`,
      )
      .nullable(),
    catalogVersion: z.string().min(1, 'Versión de catálogo requerida.'),
    clientRequestId: z.string().uuid('ID de solicitud inválido.'),
  })
  .strict();

export type WizardExecutionRequestParsed = z.infer<typeof wizardExecutionRequestSchema>;

// ── Re-export shared guardrail primitives ─────────────────────────────────────

export { detectPromptInjection, normalizeCriteria } from '@/modules/industry-catalog/schema';

// ── Discriminatory criteria detection ────────────────────────────────────────
// Blocks searches that explicitly target or exclude people based on protected
// characteristics. This is a deterministic heuristic — no LLM required.

const DISCRIMINATORY_PATTERNS = [
  // \b does not work with accented chars in JS — use lookaround-free alternation
  /(^|\s)(solo|únicamente|exclusivamente)\s+(hombres|mujeres|gay|hetero|trans)(\s|$)/i,
  /(raza|etnia|religión|orientación\s+sexual|género|sexo).{0,60}(excluir|filtrar|rechazar|evitar)/i,
  /(excluir|filtrar|rechazar|evitar).{0,60}(raza|etnia|religión|orientación\s+sexual|género|sexo)/i,
  /\b(no\s+contraten|no\s+empleen|no\s+trabajen)\s+con?\s+\w+/i,
];

// ── Out-of-scope criteria detection ──────────────────────────────────────────
// Blocks criteria that attempt to use the search pipeline for unintended purposes.

const OUT_OF_SCOPE_PATTERNS = [
  /\b(hackear|hack|exploit|phishing|malware|ddos|bypass\s+security)\b/i,
  /\b(robar|robo|hurtar|extorsionar|estafar|fraude)\b/i,
  /\b(armas?|explosivos?|drogas?|narcóticos?)\b/i,
  /\bespiar|espionaje\b/i,
  /datos?\s+(personales?|privados?|sensibles?)\s+(ilegalmente?|sin\s+permiso)/i,
];

export function detectDiscriminatoryCriteria(text: string): boolean {
  return DISCRIMINATORY_PATTERNS.some((p) => p.test(text));
}

export function detectOutOfScopeCriteria(text: string): boolean {
  return OUT_OF_SCOPE_PATTERNS.some((p) => p.test(text));
}

// ── Criteria validation result ────────────────────────────────────────────────

export type CriteriaValidationResult =
  | { ok: true; normalizedCriteria: string | null }
  | {
      ok: false;
      reason:
        | 'DISCRIMINATORY_CRITERIA'
        | 'OUT_OF_SCOPE'
        | 'PROMPT_INJECTION'
        | 'INVALID_CRITERIA';
    };

// ── Criteria pipeline: normalize → guard → return ────────────────────────────
// Deterministic. No network calls. No LLM.
// Order: normalize first, then check discriminatory, out-of-scope, injection.

export function validateAndNormalizeCriteria(
  raw: string | null,
): CriteriaValidationResult {
  if (raw === null) return { ok: true, normalizedCriteria: null };

  const normalized = normalizeCriteria(raw);
  if (normalized === null) return { ok: true, normalizedCriteria: null };

  if (detectDiscriminatoryCriteria(normalized)) {
    return { ok: false, reason: 'DISCRIMINATORY_CRITERIA' };
  }

  if (detectOutOfScopeCriteria(normalized)) {
    return { ok: false, reason: 'OUT_OF_SCOPE' };
  }

  if (detectPromptInjection(normalized)) {
    return { ok: false, reason: 'PROMPT_INJECTION' };
  }

  return { ok: true, normalizedCriteria: normalized };
}
