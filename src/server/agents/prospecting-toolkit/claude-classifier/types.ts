/**
 * Agente 1 · Clasificador Claude (fase A1) — tipos.
 *
 * Claude lee el sitio de una empresa YA encontrada (Apollo/Lusha) y SUGIERE su
 * macroindustria (contra el catálogo activo; subindustria sólo si el catálogo
 * publicado la tiene) y su tamaño estimado. La sugerencia se
 * guarda con su fuente en `metadata.claude_classification`; NO cambia el
 * estado del candidato. Todo dato sin fuente verificable se descarta.
 */

export const CLAUDE_CLASSIFIER_PROVIDER_KEY = 'anthropic';
export const CLAUDE_CLASSIFIER_OPERATION_KEY = 'company_classification';
export const CLAUDE_CLASSIFICATION_METADATA_KEY = 'claude_classification';
export const CLAUDE_CLASSIFIER_CONTRACT_VERSION = 'a1.v1';

/** Macroindustria del catálogo activo, con sus subindustrias (vacías en el catálogo v2). */
export type ClassifierCatalogIndustry = {
  industryId: string;
  industryName: string;
  industryDescription: string | null;
  subindustries: ReadonlyArray<{ id: string; name: string; description: string | null }>;
};

export type ClassifierCompanyInput = {
  candidateId: string;
  name: string;
  websiteOrDomain: string | null;
  countryCode: string | null;
  countryName: string | null;
  /** Macroindustria con la que el candidato entró al lote (para comparar). */
  currentIndustryId: string | null;
  /** Nombre de esa macroindustria (en candidatos de Apollo/Lusha el ID suele venir vacío). */
  currentIndustryName: string | null;
};

/** Lo que Claude devuelve por el tool estricto `submit_company_classification`. */
export type RawClassifierSubmission = {
  sector: {
    industry_id: string | null;
    subindustry_id: string | null;
    quote: string | null;
    source_url: string | null;
    confidence: number;
  };
  employee_range: {
    min: number | null;
    max: number | null;
    quote: string | null;
    source_url: string | null;
    confidence: number;
  };
  is_operating_company: boolean;
  /** Página de empresa en LinkedIn (linkedin.com/company/…), o null. */
  linkedin_company_url?: string | null;
  notes: string | null;
};

/**
 * LinkedIn de la empresa, verificado:
 *  - `website_social_link`: el sitio oficial (descargado por nosotros) enlaza a esa página;
 *  - `provided_search_result`: la devolvió la búsqueda web y el slug coincide con la empresa.
 * Son valores que ya existen en `LinkedInEnrichmentSource`.
 */
export type VerifiedLinkedInCompany = {
  url: string;
  slug: string;
  source: 'website_social_link' | 'provided_search_result';
};

/**
 * Nivel de verificación de un dato:
 *  - `quote_verified`: la cita aparece textual en un texto que NO escribió Claude
 *    (la página oficial que descargamos, la fuente de búsqueda que descargamos, o el
 *    `cited_text` que devolvió la propia búsqueda web para esa URL).
 *  - `source_listed`: la URL fue devuelta por la búsqueda web, pero la cita NO se pudo
 *    comprobar (p. ej. LinkedIn bloquea la descarga). La UI lo dice tal cual.
 *  - `rejected`: sin fuente verificable → el dato se descarta.
 */
export type EvidenceVerificationLevel = 'quote_verified' | 'source_listed' | 'rejected';

export type VerifiedSectorSuggestion = {
  industryId: string;
  industryName: string;
  subindustryId: string | null;
  subindustryName: string | null;
  /** ¿Coincide con la macroindustria con la que el candidato entró? null = no se sabe. */
  matchesCurrentIndustry: boolean | null;
  quote: string;
  sourceUrl: string;
  confidence: number;
  verification: Exclude<EvidenceVerificationLevel, 'rejected'>;
};

export type VerifiedEmployeeRangeSuggestion = {
  min: number;
  max: number | null;
  quote: string;
  sourceUrl: string;
  confidence: number;
  verification: Exclude<EvidenceVerificationLevel, 'rejected'>;
  /** Siempre estimado: Claude no tiene base de empleados. */
  status: 'estimated';
};

export type RejectedField = {
  field: 'sector' | 'subindustry' | 'employee_range' | 'linkedin';
  reason: string;
};

export type ClassifierUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
  estimatedCostUsd: number;
  /** `fallback` = el modelo no estaba en la tabla de precios; el costo es aproximado. */
  pricingSource: 'table' | 'fallback';
};

export type ClassifierPageSource = 'own_fetch' | 'anthropic_web_fetch' | 'none';

export type ClassificationOutcome =
  | 'classified'
  | 'partially_classified'
  | 'nothing_verifiable'
  | 'website_unreachable'
  | 'website_redirected_offsite'
  | 'no_website'
  | 'model_error';

/** Resultados definitivos: no se vuelven a pagar. El resto se puede reintentar. */
export const FINAL_CLASSIFICATION_OUTCOMES: readonly ClassificationOutcome[] = [
  'classified',
  'partially_classified',
  'nothing_verifiable',
  'website_redirected_offsite',
  'no_website',
];

/** Marca «en proceso»: evita que dos corridas simultáneas paguen la misma empresa. */
export const CLASSIFICATION_IN_PROGRESS_OUTCOME = 'in_progress';

export type CompanyClassificationResult = {
  candidateId: string;
  outcome: ClassificationOutcome;
  sector: VerifiedSectorSuggestion | null;
  employeeRange: VerifiedEmployeeRangeSuggestion | null;
  rejected: RejectedField[];
  isOperatingCompany: boolean | null;
  linkedin?: VerifiedLinkedInCompany | null;
  pageFinalUrl: string | null;
  usage: ClassifierUsage | null;
  errorCode: string | null;
  /**
   * De dónde salió el texto de la página oficial: nuestra descarga, la lectura
   * web de Anthropic (respaldo cuando la nuestra falla) o ninguna.
   */
  pageSource?: ClassifierPageSource;
  /** Mensaje del proveedor (recortado) para diagnosticar; nunca se muestra en la UI. */
  errorMessage?: string | null;
  durationMs: number;
};

/** Forma persistida en `metadata.claude_classification` (sólo sugerencia). */
export type ClaudeClassificationMetadata = {
  contract_version: typeof CLAUDE_CLASSIFIER_CONTRACT_VERSION;
  classified_at: string;
  advisory_only: true;
  outcome: ClassificationOutcome;
  model: string | null;
  sector: {
    industry_id: string;
    industry_name: string;
    subindustry_id: string | null;
    subindustry_name: string | null;
    matches_current_industry: boolean | null;
    quote: string;
    source_url: string;
    confidence: number;
    verification: VerifiedSectorSuggestion['verification'];
  } | null;
  employee_range: {
    min: number;
    max: number | null;
    status: 'estimated';
    quote: string;
    source_url: string;
    confidence: number;
    verification: VerifiedEmployeeRangeSuggestion['verification'];
  } | null;
  rejected: RejectedField[];
  is_operating_company: boolean | null;
  linkedin_company: { url: string; slug: string; source: VerifiedLinkedInCompany['source'] } | null;
  page_final_url: string | null;
  page_source: ClassifierPageSource | null;
  estimated_cost_usd: number | null;
  web_search_requests: number;
  error_code: string | null;
};
