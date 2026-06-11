import { z } from 'zod';

// ── Form constants ─────────────────────────────────────────────────────────────
// Single source of truth for limits used in both schema validation and UI.

export const EXPLORATORY_SEARCH_LIMITS = {
  requestedCount: {
    min: 10,
    max: 25,
    default: 25,
    options: [10, 15, 20, 25] as const,
  },
  subindustries: {
    max: 5,
  },
  additionalCriteria: {
    maxChars: 500,
  },
} as const;

// ── Schema ────────────────────────────────────────────────────────────────────

export const exploratorySearchSchema = z.object({
  countryCode: z
    .string()
    .min(1, 'País requerido.')
    .regex(/^[A-Z]{2}$/, 'Código de país inválido.'),
  industryId: z
    .string()
    .uuid('ID de industria inválido.')
    .min(1, 'Industria requerida.'),
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
  requestedCount: z
    .number()
    .int()
    .min(
      EXPLORATORY_SEARCH_LIMITS.requestedCount.min,
      `La cantidad mínima es ${EXPLORATORY_SEARCH_LIMITS.requestedCount.min}.`,
    )
    .max(
      EXPLORATORY_SEARCH_LIMITS.requestedCount.max,
      `La cantidad máxima es ${EXPLORATORY_SEARCH_LIMITS.requestedCount.max}.`,
    ),
  catalogVersion: z.string().min(1, 'Versión de catálogo requerida.'),
});

export type ExploratorySearchFormInputParsed = z.infer<typeof exploratorySearchSchema>;

// ── Prompt injection patterns ─────────────────────────────────────────────────
// In this phase the criteria is not sent to a model, but we detect and warn.
// Detection does NOT block the form — it returns a warning in the server response.

const INJECTION_PATTERNS = [
  /ignora\s+(las\s+)?instrucciones/i,
  /ignore\s+(all\s+)?(previous\s+)?instructions/i,
  /ignora\s+el\s+país/i,
  /ignora\s+el\s+tamaño/i,
  /omite\s+duplicados/i,
  /no\s+verifiques\s+evidencia/i,
  /olvida\s+(todo|las\s+reglas)/i,
  /act\s+as\s+if/i,
  /you\s+are\s+now/i,
  /system\s+prompt/i,
  /\[system\]/i,
  /\<\/?system\>/i,
  /bypass\s+(filter|rule|check)/i,
];

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

// ── Criteria normalizer ───────────────────────────────────────────────────────

export function normalizeCriteria(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars);
  return trimmed === '' ? null : trimmed;
}
