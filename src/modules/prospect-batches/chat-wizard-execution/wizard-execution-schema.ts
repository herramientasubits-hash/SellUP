import { z } from 'zod';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { detectPromptInjection, normalizeCriteria } from '@/modules/industry-catalog/schema';
import { competitorReferenceSchema } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import { REFERENCE_COMPANY_LIMITS } from '@/modules/prospect-batches/chat-wizard/wizard-config';

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
    /**
     * A1-APOLLO-TWO-ROUND-QUALITY-1-FIX § 3 — costura interna/admin para fijar
     * el proveedor de UNA corrida (QA y rollout controlado). NO es un selector
     * para usuarios finales y la UI no lo envía.
     *
     * Es una PETICIÓN, no una decisión: la autoridad se resuelve server-side
     * contra la sesión y el rol, y el kill switch global manda por encima. Un
     * cliente que envíe `apollo_organizations` sin ser admin obtiene el
     * proveedor global, no Apollo.
     *
     * El schema sólo admite los valores del contrato de routing; cualquier otro
     * valor invalida la solicitud entera en vez de degradarse en silencio.
     */
    requestedDiscoveryProvider: z
      .enum(['tavily', 'apollo_organizations', 'lusha_companies'])
      .optional(),
    /**
     * AGENT1-SUPPLIER-SEARCH-1 — forma de la búsqueda. Ausente = «Empresas por
     * criterios», así que toda solicitud anterior sigue siendo idéntica. «Proveedores»
     * exige `referenceCompanyName` y la bandera `ENABLE_AGENT1_SUPPLIER_SEARCH` (que
     * el servidor mira al ejecutar, no aquí). «Competidores» exige `referenceCompany`
     * (la ficha confirmada en el asistente).
     */
    searchMode: z.enum(['exploratory', 'suppliers', 'competitors']).optional(),
    referenceCompanyName: z
      .string()
      // Va dentro de una instrucción a Claude: sin comillas, ángulos ni saltos que
      // permitan salirse del texto citado.
      .transform((value) => sanitizeReferenceCompanyName(value))
      .pipe(
        z
          .string()
          .min(REFERENCE_COMPANY_LIMITS.minChars, 'Escribe el nombre de la empresa de referencia.')
          .max(
            REFERENCE_COMPANY_LIMITS.maxChars,
            `La empresa de referencia puede tener máximo ${REFERENCE_COMPANY_LIMITS.maxChars} caracteres.`,
          ),
      )
      .optional(),
    /** «Competidores de una empresa»: la ficha de la referencia. */
    referenceCompany: competitorReferenceSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // «Competidores»: la ficha es obligatoria y sólo existe en ese modo.
    const isCompetitors = value.searchMode === 'competitors';
    if (isCompetitors && !value.referenceCompany) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceCompany'],
        message: 'Falta la empresa de referencia.',
      });
    }
    if (!isCompetitors && value.referenceCompany) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceCompany'],
        message: 'La empresa de referencia sólo aplica a la búsqueda de competidores.',
      });
    }

    if (value.searchMode === 'suppliers') {
      if (!value.referenceCompanyName) {
        ctx.addIssue({
          code: 'custom',
          path: ['referenceCompanyName'],
          message: 'Escribe la empresa de la que quieres encontrar proveedores.',
        });
        return;
      }
      // Va dentro de un prompt de Claude: mismas guardas que el criterio adicional.
      if (validateAndNormalizeCriteria(value.referenceCompanyName).ok === false) {
        ctx.addIssue({
          code: 'custom',
          path: ['referenceCompanyName'],
          message: 'La empresa de referencia contiene texto que no se puede procesar.',
        });
      }
      return;
    }
    if (value.referenceCompanyName !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceCompanyName'],
        message: 'La empresa de referencia sólo aplica a «Proveedores de una empresa».',
      });
    }
  });

/** AGENT1-SUPPLIER-SEARCH-1 — nombre de empresa apto para citarlo en un prompt. */
export function sanitizeReferenceCompanyName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f«»"'`<>{}\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
