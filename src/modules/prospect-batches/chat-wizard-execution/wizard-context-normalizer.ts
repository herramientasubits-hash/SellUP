/**
 * Wizard Context Normalizer — L2.7
 *
 * Normaliza el contexto resuelto del wizard a una estructura canónica
 * que cualquier provider (Apollo, Lusha a futuro, etc.) puede consumir.
 *
 * Reglas:
 *   - Puro: sin side effects, sin llamadas externas, sin env vars.
 *   - Testeable con inputs puros.
 *   - No importa nada de Apollo, Lusha ni Tavily.
 *   - additionalCriteriaTokens son tokens comercialmente relevantes
 *     para providers estructurados (Apollo, Lusha).
 *   - Tavily sigue usando su texto original sin este módulo.
 */

import type { ResolvedWizardExecution } from './wizard-execution-types';

// ─── Versión ──────────────────────────────────────────────────────────────────

export const NORMALIZER_VERSION = 'L2.7' as const;

// ─── Stopwords ────────────────────────────────────────────────────────────────

/**
 * Conectores y preposiciones que no aportan señal a búsquedas estructuradas.
 * Combinación español + inglés. Normalizados sin acentos.
 */
const STOPWORDS = new Set([
  // Español — preposiciones y artículos
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'para', 'que', 'y', 'o', 'a',
  'un', 'una', 'por', 'se', 'su', 'sus', 'al', 'lo', 'mas', 'pero', 'como',
  'muy', 'sobre', 'entre', 'sin', 'desde', 'hasta', 'hacia', 'durante', 'ante',
  'bajo', 'contra', 'esto', 'este', 'esta', 'estos', 'estas', 'ese', 'esa',
  'nos', 'les', 'me', 'te', 'le', 'hay', 'ser', 'son', 'son', 'fue', 'era',
  'solo', 'tambien', 'bien', 'solo', 'gran', 'grandes', 'buenas',
  // Términos genéricos de empresa que no aportan precisión
  'empresas', 'empresa', 'compania', 'organizacion', 'organizaciones', 'negocio', 'negocios',
  'sector', 'industria', 'mercado', 'nacional', 'regional',
  // Inglés — conectores
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'only', 'also', 'more', 'less', 'very', 'just', 'large', 'big', 'good',
  // Términos genéricos de empresa en inglés
  'companies', 'company', 'business', 'businesses', 'organization', 'organizations',
  'sector', 'industry', 'market', 'national', 'regional', 'local',
]);

// ─── Normalize helpers ────────────────────────────────────────────────────────

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function normalizeText(text: string): string {
  return stripAccents(text).toLowerCase().trim();
}

// ─── parseAdditionalCriteriaTokens ───────────────────────────────────────────

/**
 * Extrae tokens comercialmente relevantes del criterio libre del usuario.
 *
 * Diseñado para providers estructurados como Apollo y Lusha (a futuro).
 * Tavily sigue usando el texto original — este parser NO afecta Tavily.
 *
 * Reglas:
 *   - Acepta null / undefined / string vacío → []
 *   - Normaliza a minúsculas y remueve acentos
 *   - Remueve stopwords del conjunto definido
 *   - Conserva términos comerciales cortos reconocidos (lms, b2b, saas, erp, crm…)
 *   - Descarta tokens de 1-2 caracteres salvo lista de excepciones controlada
 *   - Limita output a MAX_TOKENS tokens o frases
 *
 * @param text Texto libre del wizard. Puede ser null o undefined.
 * @returns Array de tokens limpios, máx MAX_TOKENS.
 */

const MAX_TOKENS = 5;

/** Términos cortos (1-3 chars) que sí tienen valor comercial. */
const SHORT_TERM_ALLOWLIST = new Set(['ti', 'bi', 'ai', 'hr', 'b2b', 'b2c', 'erp', 'crm', 'lms', 'rpa', 'esg']);

export function parseAdditionalCriteriaTokens(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];

  const normalized = normalizeText(text);

  // Separar en tokens por espacios y signos de puntuación no-alfanuméricos
  // Preservamos caracteres típicos en acrónimos: letras + dígitos + guión
  const rawTokens = normalized
    .replace(/[^\w\s-]/g, ' ')   // sustituye puntuación por espacio
    .split(/\s+/)
    .filter(Boolean);

  const tokens: string[] = [];

  for (const token of rawTokens) {
    if (!token) continue;

    // Saltear stopwords
    if (STOPWORDS.has(token)) continue;

    // Tokens muy cortos: solo allowlist
    if (token.length <= 2 && !SHORT_TERM_ALLOWLIST.has(token)) continue;
    if (token.length === 3 && !SHORT_TERM_ALLOWLIST.has(token) && /^[a-z]{3}$/.test(token)) {
      // Permitir tokens de 3 letras solo si están en la allowlist o tienen dígitos
      // Ejemplo: "lms" → en allowlist; "abc" → rechazado si no es allowlist
      if (!SHORT_TERM_ALLOWLIST.has(token)) {
        // Permitir si parece acrónimo (todas mayúsculas antes de normalizar)
        // Aquí ya normalizamos, así que confiar en el allowlist
        continue;
      }
    }

    // Saltear números puros (umbrales de empleados ya se capturan en targetEmployeeThreshold)
    if (/^\d+\+?$/.test(token)) continue;

    if (!tokens.includes(token)) {
      tokens.push(token);
    }

    if (tokens.length >= MAX_TOKENS) break;
  }

  return tokens;
}

// ─── Employee threshold extractor ─────────────────────────────────────────────

/**
 * Extrae umbral de empleados del texto libre del criterio adicional.
 * Ejemplo: "más de 200 empleados" → 200; "200+" → 200.
 * Retorna null si no se detecta umbral numérico.
 */
export function extractEmployeeThresholdFromText(text: string | null | undefined): number | null {
  if (!text?.trim()) return null;
  const cleaned = normalizeText(text);
  // "más de 200" / "200+" / "mas de 200 empleados" / "over 200"
  const match = cleaned.match(/(?:mas\s+de|more\s+than|over|al?\s+menos|at\s+least)\s+(\d+)|(\d+)\s*\+/);
  if (match) {
    const n = parseInt(match[1] ?? match[2] ?? '', 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

// ─── NormalizedWizardContext ──────────────────────────────────────────────────

/** Contexto canónico del wizard normalizado para providers estructurados. */
export type NormalizedWizardContext = {
  /** Nombre completo del país (ej. "Colombia"). */
  country: string;
  /** Código ISO-2 del país (ej. "CO"). */
  countryCode: string;
  /** Nombre canonical del sector/industria (ej. "Educación"). */
  sector: string;
  /** Sector normalizado sin acentos y minúsculas (ej. "educacion"). */
  sectorKey: string;
  /** Nombres canónicos de subindustrias resueltos del catálogo. */
  subindustries: string[];
  /** Subindustrias normalizadas sin acentos y minúsculas. */
  subindustryKeys: string[];
  /** Texto libre original del criterio adicional. Null si no hay. */
  additionalCriteriaRaw: string | null;
  /** Tokens comercialmente relevantes extraídos del criterio adicional. Máx 5. */
  additionalCriteriaTokens: string[];
  /** Umbral de empleados del systemControls. Null si no aplica. */
  targetEmployeeThreshold: number | null;
  /** Profundidad de búsqueda implícita del wizard. */
  searchDepth: 'basic' | 'advanced';
  /** Provider destino para este contexto (informativo). */
  provider: string | null;
  /** Versión del normalizer. */
  version: typeof NORMALIZER_VERSION;
};

/**
 * Normaliza el contexto resuelto del wizard a `NormalizedWizardContext`.
 *
 * @param resolved  ResolvedWizardExecution ya validado server-side.
 * @param provider  Provider al que se destinará este contexto (solo informativo).
 */
export function normalizeWizardContext(
  resolved: ResolvedWizardExecution,
  provider?: string | null,
): NormalizedWizardContext {
  const subindustries = resolved.subindustries.map((s) => s.name);
  const subindustryKeys = subindustries.map(normalizeText);

  const additionalCriteriaTokens = parseAdditionalCriteriaTokens(resolved.additionalCriteria);

  // targetEmployeeThreshold: preferir systemControls (server-side), luego extraer del texto
  const fromControls = resolved.systemControls.minimumEmployees > 0
    ? resolved.systemControls.minimumEmployees
    : null;
  const targetEmployeeThreshold =
    fromControls ?? extractEmployeeThresholdFromText(resolved.additionalCriteria);

  return {
    country: resolved.country.name,
    countryCode: resolved.country.code,
    sector: resolved.industry.name,
    sectorKey: normalizeText(resolved.industry.name),
    subindustries,
    subindustryKeys,
    additionalCriteriaRaw: resolved.additionalCriteria,
    additionalCriteriaTokens,
    targetEmployeeThreshold,
    searchDepth: 'advanced',
    provider: provider ?? null,
    version: NORMALIZER_VERSION,
  };
}
