/**
 * Prospecting Toolkit — Tipos base.
 *
 * Contiene los contratos de deduplicación y del catálogo de fuentes.
 * No contienen lógica, no importan nada externo.
 */

export type DuplicateStatus =
  | "new_candidate"
  | "existing_in_sellup"
  | "existing_in_hubspot"
  | "possible_duplicate"
  | "insufficient_data"
  | "unchecked"
  | "error";

export type DuplicateCheckInput = {
  name: string;
  legalName?: string | null;
  normalizedName?: string | null;
  website?: string | null;
  domain?: string | null;
  country?: string | null;
  countryCode?: string | null;
  taxIdentifier?: string | null;
  taxIdentifierCandidate?: string | null;
};

export type DuplicateMatch = {
  source: "sellup" | "hubspot";
  status: DuplicateStatus;
  confidence: number;
  matchedId?: string | null;
  matchedName?: string | null;
  matchedDomain?: string | null;
  matchedWebsite?: string | null;
  matchedTaxIdentifier?: string | null;
  reason: string;
  raw?: unknown;
};

export type DuplicateCheckResult = {
  status: DuplicateStatus;
  confidence: number;
  input: DuplicateCheckInput;
  matches: DuplicateMatch[];
  summary: string;
  checkedSources: Array<"sellup" | "hubspot">;
  errors?: string[];
};

// ============================================================
// Catalog Context Retriever — tipos
// ============================================================

export type SearchDepth = "basic" | "standard" | "deep";

export type SourcePriority = "P0" | "P1" | "P2";

/**
 * Estado operativo formal de una fuente del catálogo (Hito 16AA.3).
 *
 * Determina programáticamente si una fuente puede usarse para discovery automático,
 * requiere acción previa, o solo es útil para validación/señal.
 *
 * - operational_verified: acceso público/API/bulk validado, lista para alimentar Inventory Engine.
 * - connection_required: alto potencial, requiere credencial/acuerdo/token/endpoint o validación ToS.
 * - pending_validation: prometedora, sin extracción mínima probada.
 * - manual_signal_only: útil como señal/gremio/evento; no usar automáticamente.
 * - validation_only: para validar o enriquecer empresas ya conocidas, no discovery masivo.
 * - discarded_paid_or_tos: no usable por costo, ToS o riesgo legal.
 * - discarded_low_value: no recomendada por bajo volumen, baja calidad o ruido.
 */
// ─── Catálogo operativo — clasificación funcional (Hito 16AK) ─────────────

export type SellupUse =
  | 'discovery'
  | 'enrichment'
  | 'legal_validation'
  | 'validation_only'
  | 'commercial_signal'
  | 'contextual_signal'
  | 'technical_container'
  | 'manual_reference'
  | 'not_for_ai_flow'
  | 'pending_classification';

export type AiFlowStatus =
  | 'connected'
  | 'connected_post_approval'
  | 'eligible_not_connected'
  | 'partial_pending_data'
  | 'source_guided'
  | 'manual_only'
  | 'signal_connected_read_only'
  | 'dry_run_validated'
  | 'paused'
  | 'not_applicable'
  | 'pending_classification';

export type ConnectionMode =
  | 'wizard_discovery'
  | 'automatic_enrichment'
  | 'source_guided_query'
  | 'offline_signal'
  | 'credential_configured'
  | 'read_only_signal'
  | 'not_connected'
  | 'not_persisted'
  | 'not_applicable';

export type CatalogSourceOperationalStatus =
  | 'operational_verified'
  | 'connection_required'
  | 'pending_validation'
  | 'dry_run_validated'
  | 'manual_signal_only'
  | 'validation_only'
  | 'discarded_paid_or_tos'
  | 'discarded_low_value'
  | 'mvp_inferred_sector';

export type CatalogSource = {
  key: string;
  name: string;
  countryCodes: string[];
  sectors: string[];
  priority: SourcePriority;
  type:
    | "official_registry"
    | "public_dataset"
    | "procurement"
    | "industry_association"
    | "commercial_provider"
    | "web_search"
    | "other";
  url?: string | null;
  automationLevel: "high" | "medium" | "low" | "manual";
  operationalStatus: CatalogSourceOperationalStatus;
  recommendedUse: string;
  limitations?: string[];
  riskNotes?: string[];
  /** Clasificación funcional: para qué sirve la fuente en SellUp */
  sellupUse?: SellupUse;
  /** Estado de la fuente en el flujo IA */
  aiFlowStatus?: AiFlowStatus;
  /** Cómo se conecta la fuente al sistema */
  connectionMode?: ConnectionMode;
  /** Texto corto de siguiente acción para UI */
  nextAction?: string;
};

export type CatalogContextInput = {
  country: string;
  countryCode: string;
  industry: string;
  searchDepth?: SearchDepth;
};

export type CatalogContextResult = {
  country: string;
  countryCode: string;
  industry: string;
  searchDepth: SearchDepth;
  fiscalIdentifierLabel: string | null;
  recommendedSources: CatalogSource[];
  sectorSources: CatalogSource[];
  risks: string[];
  operatingRules: string[];
  coverageNotes: string[];
  promptContext: string;
};

// ============================================================
// Web Search Tool — tipos (Hito 3A)
// ============================================================

export type WebSearchProviderKey =
  | "mock"
  | "tavily"
  | "google_cse"
  | "brave"
  | "serpapi"
  | "exa"
  | "firecrawl"
  | "apollo_organizations";

export type WebSearchIntent =
  | "company_discovery"
  | "website_discovery"
  | "linkedin_company_discovery"
  | "source_validation";

export type WebSearchInput = {
  query: string;
  country?: string | null;
  countryCode?: string | null;
  industry?: string | null;
  intent?: WebSearchIntent;
  maxResults?: number;
  provider?: WebSearchProviderKey;
  searchDepth?: SearchDepth;
  /**
   * Subindustrias canónicas resueltas del catálogo (L2.7).
   * Usadas por Apollo para priorizar keywords específicas sobre el sector padre.
   * Tavily no las usa — fluye por el texto original del wizard.
   */
  subindustries?: string[];
  /**
   * Tokens comerciales extraídos del criterio adicional libre del usuario (L2.7).
   * Producidos por parseAdditionalCriteriaTokens en wizard-context-normalizer.ts.
   * Usados por Apollo para enriquecer q_organization_keyword_tags con señales del usuario.
   * Tavily no los usa — sigue con el texto original.
   */
  additionalCriteriaTokens?: string[];
  /**
   * L2.11: Umbral mínimo de empleados derivado del ICP del wizard.
   * Cuando está presente, Apollo Organization Search incluye organization_num_employees_ranges
   * con todos los rangos desde este umbral en adelante.
   * Null/undefined → no se envía filtro de tamaño.
   */
  targetEmployeeThreshold?: number | null;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string | null;
  source?: string | null;
  rank: number;
  provider: WebSearchProviderKey;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
};

export type WebSearchOutput = {
  provider: WebSearchProviderKey;
  query: string;
  results: WebSearchResult[];
  resultsCount: number;
  skipped: boolean;
  skipReason?: string | null;
  estimatedCostUsd?: number | null;
  metadata?: Record<string, unknown>;
};

// ============================================================
// Candidate Scorer — tipos (Hito 3C)
// ============================================================

export type CandidateQualityLabel =
  | "high_quality_new"
  | "needs_review"
  | "duplicate"
  | "insufficient_data"
  | "discard";

export type CandidateRecommendedAction =
  | "approve_for_review"
  | "review_manually"
  | "exclude_existing"
  | "enrich_before_review"
  | "discard";

export type CandidateScoringInput = {
  name: string;
  legalName?: string | null;
  country?: string | null;
  countryCode?: string | null;
  industry?: string | null;
  subsector?: string | null;
  city?: string | null;
  region?: string | null;
  website?: string | null;
  domain?: string | null;
  linkedinCompanyUrl?: string | null;
  taxIdentifier?: string | null;
  companySize?: string | null;
  sourcePrimary?: string | null;
  sourcePriority?: SourcePriority | null;
  reasonForFit?: string | null;
  websiteVerification?: WebsiteVerificationOutput | null;
  duplicateCheck?: DuplicateCheckResult | null;
  catalogContext?: CatalogContextResult | null;
  /** Source title from search result — used for commercial fit calibration (v1.11) */
  sourceTitle?: string | null;
  /** Source snippet from search result — used for commercial fit calibration (v1.11) */
  sourceSnippet?: string | null;
  /** Country evidence level — used for commercial fit calibration (v1.11) */
  countryEvidenceLevel?: 'strong' | 'weak' | 'query_only' | null;
};

export type CandidateScoreBreakdown = {
  existenceSignals: number;
  websiteSignals: number;
  duplicateSignals: number;
  sourceSignals: number;
  fitSignals: number;
  completenessSignals: number;
  penalties: number;
};

/** Commercial fit calibration breakdown — v1.11 */
export type FitBreakdown = {
  product_fit: number;
  country_fit: number;
  b2b_signal: number;
  duplicate_penalty: number;
  country_evidence_penalty: number;
  generic_agency_penalty: number;
  commercial_calibration_delta: number;
  final_fit_score: number;
  fit_label: 'high' | 'medium' | 'low' | 'reject';
  fit_reasons: string[];
  fit_penalties: string[];
};

export type CandidateScoringOutput = {
  confidenceScore: number;
  fitScore: number;
  dataCompletenessScore: number;
  qualityLabel: CandidateQualityLabel;
  recommendedAction: CandidateRecommendedAction;
  breakdown: CandidateScoreBreakdown;
  reasons: string[];
  warnings: string[];
  blockers: string[];
  fitBreakdown?: FitBreakdown | null;
  metadata?: Record<string, unknown>;
};

// ============================================================
// LinkedIn Company Enrichment — tipos (Hito v1.15)
// ============================================================

export type LinkedInEnrichmentStatus =
  | 'not_found'
  | 'found'
  | 'ambiguous'
  | 'rejected'
  | 'skipped';

export type LinkedInEnrichmentSignals = {
  name_match: boolean;
  domain_match: boolean;
  country_match: boolean;
  is_company_page: boolean;
};

export type LinkedInEnrichmentSource =
  | 'provided_search_result'
  | 'existing_candidate_metadata'
  | 'manual_input'
  | 'tavily_linkedin_search'
  | 'mock_linkedin_search'
  | 'controlled_linkedin_search'
  // v1.16K-R: company LinkedIn URL returned by Apollo's organization search.
  // Cost-zero — the URL is already in the Apollo payload; we only preserve it.
  | 'apollo'
  // v1.16K-R-G: LinkedIn URL found by fetching the company's official website.
  // Cost-zero — no external search API. Runs before Tavily as a free first pass.
  | 'website_social_link'
  | 'future_provider'
  | 'none';

export type LinkedInEnrichmentMetadata = {
  enabled: boolean;
  status: LinkedInEnrichmentStatus;
  company_url?: string | null;
  normalized_company_slug?: string | null;
  confidence: number;
  match_reason?: string | null;
  signals?: LinkedInEnrichmentSignals | null;
  warnings: string[];
  source: LinkedInEnrichmentSource;
  checked_at: string;
  // v1.16K-R-H: present when status=ambiguous and company_url is a valid company page.
  // Signals that the URL is a reviewable suggestion, not a confirmed match.
  review_required?: boolean;
  suggestion_type?: 'linkedin_company_candidate';
};

// ============================================================
// Prospecting Pipeline — tipos (Hito 4)
// ============================================================

export type ProspectingPipelineInput = {
  country: string;
  countryCode: string;
  industry: string;
  searchDepth?: SearchDepth;
  targetCount?: number;
  webSearchProvider?: WebSearchProviderKey;
  mode?: 'single_query' | 'multi_query' | 'tavily_llm_evaluator';
  maxResultsPerQuery?: number;
  /** When true, runs the LLM evaluator on Tavily raw results before candidate scoring. */
  useLLMEvaluator?: boolean;
  /** Optional query overrides for multi-query mode. When provided, these queries
   * replace the standard buildCleanMultiQueryDiscoveryQueries output.
   * Used by the incremental search orchestrator (Hito 16T.1). */
  queryOverrides?: string[];
  /** Contexto de uso económico por ronda. Asignado server-side; no proviene del cliente. */
  usageContext?: import('./tavily-usage-logging').TavilyUsageContext | null;
  /** Subindustrias canónicas del catálogo (L2.7). Solo para Apollo; Tavily las ignora aquí. */
  subindustries?: string[];
  /** Tokens del criterio adicional del usuario (L2.7). Solo para Apollo; Tavily los ignora. */
  additionalCriteriaTokens?: string[];
};

export type NameInferenceSource = 'title_prefix' | 'domain' | 'title_fallback';

export type ProspectingPipelineCandidate = {
  name: string;
  /** Raw name before normalization (Hito 16W.2). Present only when wasNormalized is true. */
  originalName?: string | null;
  website: string | null;
  domain: string | null;
  country: string;
  countryCode: string;
  industry: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSnippet: string | null;
  inferredNameSource?: NameInferenceSource | null;
  websiteVerification: WebsiteVerificationOutput | null;
  duplicateCheck: DuplicateCheckResult | null;
  scoring: CandidateScoringOutput;
  /** Company size hint — snake_case variant (v1.16J.1). Used by ICP Size Gate resolver (Fuente 2). */
  company_size?: string | number | null;
  /** Company size hint — camelCase variant (v1.16J.1). Used by ICP Size Gate resolver (Fuente 2). */
  companySize?: string | number | null;
  /** Employee count hint — snake_case variant (v1.16J.1). Used by ICP Size Gate resolver (Fuente 2). */
  employee_count?: number | string | null;
  /** Employee count hint — camelCase variant (v1.16J.1). Used by ICP Size Gate resolver (Fuente 2). */
  employeeCount?: number | string | null;
  /** Present when the candidate was created via the LLM evaluator pipeline (Hito 16H). */
  llmEvaluation?: import('./llm-evaluator-types').LLMEvaluationMetadata | null;
  /** Query trazabilidad: identifica qué query generó este candidato (Hito 16Z.2). */
  searchTrace?: SearchTrace | null;
};

export type ProspectingPipelineSummary = {
  requested: number;
  searched: number;
  returned: number;
  highQualityNew: number;
  needsReview: number;
  duplicates: number;
  insufficientData: number;
  discarded: number;
  unchecked: number;
};

export type ProspectingPipelineOutput = {
  input: ProspectingPipelineInput;
  catalogContext: CatalogContextResult;
  searchQuery: string;
  webSearch: WebSearchOutput;
  candidates: ProspectingPipelineCandidate[];
  summary: ProspectingPipelineSummary;
  warnings: string[];
  metadata?: Record<string, unknown>;
};

// ============================================================
// Candidate Writer — tipos (Hito 5)
// ============================================================

export type CandidateWriterSource = "agent_1" | "mock" | "web_search";

export type CandidateWriterStatus =
  | "success"
  | "partial_success"
  | "failed"
  | "dry_run";

export type CandidateWriterInput = {
  pipelineOutput: ProspectingPipelineOutput;
  triggeredByUserId?: string | null;
  ownerId?: string | null;
  batchName?: string | null;
  source?: CandidateWriterSource;
  dryRun?: boolean;
  extraBatchMetadata?: Record<string, unknown> | null;
  /**
   * When provided, the writer reuses this batch instead of creating a new one.
   * The batch must exist, belong to the requesting user, have source='agent_1',
   * and be in a state compatible with receiving pipeline results ('draft' or 'generating').
   * The existing metadata is preserved and merged with the pipeline metadata.
   * Internal-only — not exposed to any UI or external client.
   */
  existingBatchId?: string | null;
  /**
   * Maximum number of candidates to persist in this run (Hito 16AB.43.27).
   * Candidates are ranked before applying the cap.
   * When undefined, all eligible candidates are persisted (legacy behavior).
   */
  targetPersistibleCandidates?: number | null;
};

export type CandidateWriterSkipped = {
  name: string;
  reason: string;
  domain?: string | null;
  previous_candidate_ids?: string[];
  previous_batch_ids?: string[];
  searchTrace?: SearchTrace | null;
};

export type CandidateWriterOutput = {
  dryRun: boolean;
  batchId: string | null;
  candidatesCreated: number;
  candidatesSkipped: number;
  createdCandidateIds: string[];
  skipped: CandidateWriterSkipped[];
  status: CandidateWriterStatus;
  errors: string[];
};

// Combined output for runAndWriteProspectingPipeline
export type ProspectingPipelineWriteOutput = {
  pipeline: ProspectingPipelineOutput;
  writer: CandidateWriterOutput;
};

// ============================================================
// Website Verifier — tipos (Hito 3B)
// ============================================================

export type WebsiteVerificationStatus =
  | "verified"
  | "inferred"
  | "mismatch"
  | "not_found"
  | "error";

export type WebsiteVerificationInput = {
  candidateName: string;
  websiteOrDomain?: string | null;
  country?: string | null;
  countryCode?: string | null;
  expectedDomain?: string | null;
  timeoutMs?: number;
};

export type WebsiteVerificationOutput = {
  status: WebsiteVerificationStatus;
  website: string | null;
  domain: string | null;
  finalUrl: string | null;
  finalDomain: string | null;
  httpStatus: number | null;
  redirected: boolean;
  redirectChain: string[];
  title?: string | null;
  metaDescription?: string | null;
  evidence: string[];
  confidence: number;
  skipped: boolean;
  skipReason?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

// ============================================================
// Search Trace — tipos (Hito 16Z.2)
// ============================================================

export type SearchQueryType =
  | 'standard'
  | 'expanded'
  | 'source_guided'
  | 'override'
  | 'unknown';

export type SearchTrace = {
  query_text: string;
  query_type: SearchQueryType;
  query_source_key: string | null;
  round_number?: number;
  provider_rank?: number;
};

// ============================================================
// Multi-Query Web Search — tipos (Hito 12B)
// ============================================================

export type MultiQuerySearchInput = {
  country: string;
  countryCode?: string | null;
  industry: string;
  provider?: WebSearchProviderKey;
  queries?: string[];
  maxResultsPerQuery?: number;
  targetCount?: number;
  searchDepth?: SearchDepth;
  /** Contexto de uso económico por ronda. Asignado server-side; no proviene del cliente. */
  usageContext?: import('./tavily-usage-logging').TavilyUsageContext | null;
  /** Subindustrias canónicas del catálogo (L2.7). Solo para Apollo; Tavily las ignora. */
  subindustries?: string[];
  /** Tokens del criterio adicional del usuario (L2.7). Solo para Apollo; Tavily los ignora. */
  additionalCriteriaTokens?: string[];
};

export type MultiQueryQueryResult = {
  query: string;
  rawResultsCount: number;
  keptCount: number;
  filteredOutCount: number;
  skipped: boolean;
  skipReason?: string | null;
};

export type MultiQuerySearchResultEntry = WebSearchResult & {
  originQuery: string;
};

export type MultiQueryWebSearchOutput = {
  queryResults: MultiQueryQueryResult[];
  rawResultsCount: number;
  dedupedResultsCount: number;
  filteredOutCount: number;
  keptCount: number;
  results: MultiQuerySearchResultEntry[];
  estimatedCreditCount: number;
  metadata?: Record<string, unknown>;
};

// ============================================================
// Search Strategy v1.8 — Source Catalog vs Search Strategy Separation
// ============================================================

/**
 * Rol de discovery asignado a una fuente del catálogo.
 *
 * - discovery_seed: fuente primaria de discovery (genera candidatos directamente)
 * - sector_signal: señal sectorial válida, puede guiar queries de búsqueda
 * - validation_only: solo para validar empresas ya encontradas (alias de legal_registry para fuentes no legales)
 * - enrichment_only: solo para enriquecer post-discovery, no genera prospectos
 * - legal_registry: registro legal/NIT, no discovery comercial
 * - contextual_signal: señal contextual/gremial, puede orientar queries pero no es seed
 * - manual_signal_only: solo uso manual, no automático
 * - blocked_from_discovery: excluida explícitamente del discovery
 */
export type SourceDiscoveryRole =
  | 'discovery_seed'
  | 'sector_signal'
  | 'validation_only'
  | 'enrichment_only'
  | 'legal_registry'
  | 'contextual_signal'
  | 'manual_signal_only'
  | 'blocked_from_discovery';

export type SourceRoleDecision = {
  sourceKey: string;
  sourceName: string;
  role: SourceDiscoveryRole;
  /** True solo para discovery_seed — puede generar prospectos directamente */
  allowedForDiscovery: boolean;
  /** True para discovery_seed, sector_signal y contextual_signal no pausados */
  allowedForSourceGuidedQueries: boolean;
  reason: string;
};

/**
 * Estrategia de búsqueda materializada para una combinación país/industria/subindustria.
 * Separa explícitamente qué fuentes sirven para discovery vs enrichment vs validación.
 */
export type SearchStrategyV1 = {
  version: 'search_strategy_v1_8';
  countryCode: string;
  industry: string;
  subindustries: string[];
  fintechSignal: boolean;
  b2gSignal: boolean;
  sourceRoles: {
    discovery_seed: string[];
    sector_signal: string[];
    validation_only: string[];
    enrichment_only: string[];
    legal_registry: string[];
    contextual_signal: string[];
    manual_signal_only: string[];
    blocked_from_discovery: string[];
  };
  sourceDecisions: SourceRoleDecision[];
  queryStrategy: {
    /** Source keys (catálogo + intents virtuales) permitidos para source-guided queries */
    sourceGuidedQuerySeeds: string[];
    /** Source keys bloqueados de cualquier generación de queries */
    blockedSourceKeys: string[];
    fintechGated: boolean;
    b2gConditional: boolean;
  };
  evidenceRequirements: {
    requiresOfficialCompanySite: boolean;
    requiresCountryEvidence: boolean;
    allowsQueryOnlyCountry: boolean;
    queryOnlyConfidenceCap: number;
    blocksMediaDirectoriesMarketplaces: boolean;
  };
};
