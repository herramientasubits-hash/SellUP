/**
 * Prospect Generation Benchmark — Types (Hito 16AB.23)
 *
 * Contratos de entrada/salida del benchmark aislado.
 * No escribe en DB. No escribe en HubSpot. Solo lectura y generación.
 */

// ─── Solicitud canónica ───────────────────────────────────────────────────────

export type BenchmarkRequest = {
  country: string;
  country_code: string;
  industry: string;
  requested_count: number;
  commercial_context: string;
};

// ─── Modos de proveedor ───────────────────────────────────────────────────────

export type BenchmarkProviderMode =
  | 'current_sellup'
  | 'anthropic_native_search'
  | 'openai_native_search'
  | 'gemini_native_search';

// ─── Plan de búsqueda (Fase A) ────────────────────────────────────────────────

export type SearchPlan = {
  subsectors: string[];
  cities: string[];
  queries_planned: string[];
  sources_prioritized: string[];
  exclusions: string[];
  quality_criteria: string[];
  diversification_strategy: string;
};

// ─── Clasificación de entidad ─────────────────────────────────────────────────

export type EntityType =
  | 'company'
  | 'association'
  | 'directory'
  | 'article'
  | 'blog_post'
  | 'social_post'
  | 'forum_post'
  | 'event'
  | 'product'
  | 'brand_without_legal_entity'
  | 'government_entity'
  | 'unknown';

// ─── Estado de LinkedIn (16AB.23.2 — estados granulares) ─────────────────────

export type LinkedInStatus =
  | 'confirmed'          // Verificación HTTP exitosa
  | 'http_unverified'    // Formato válido + slug coherente + modelo y fuentes coinciden → probable
  | 'slug_matches'       // Formato válido + slug coherente con nombre de empresa
  | 'url_format_valid'   // Solo tiene patrón /company/ — slug no relacionado
  | 'found'              // Compat hacia atrás (equivale a http_unverified)
  | 'searched_not_found'
  | 'not_searched'
  | 'invalid';

// ─── Resolución de identidad empresarial ──────────────────────────────────────

export type IdentityResolution = {
  original_title: string;
  resolved_company_name: string | null;
  resolved_official_domain: string | null;
  evidence: string | null;
  confidence: 'high' | 'medium' | 'low';
};

// ─── Candidato rechazado ──────────────────────────────────────────────────────

export type RejectedCandidate = {
  rejection_code: string;
  rejection_reason: string;
  original_name: string;
  original_url: string | null;
  entity_type?: EntityType;
};

// ─── Candidato del benchmark (contrato oficial de salida) ─────────────────────

export type BenchmarkCandidate = {
  name: string;
  country: string;
  sector: string;
  website: string | null;
  linkedin: string | null;
  city: string | null;
  estimated_size: string | null;
  description: string | null;
  evidence_url: string | null;
  evidence_source: string | null;
  confidence: 'Alta' | 'Media' | 'Baja';
  notes: string | null;

  // Campos internos del benchmark (no se muestran en TSV de revisión ciega)
  _quality_label?: string;
  _duplicate_status?: string;
  _rejection_reason?: string;
  _queries_used?: string[];
};

// ─── Candidato verificado (post-pipeline de verificación) ────────────────────

export type VerifiedBenchmarkCandidate = BenchmarkCandidate & {
  entity_type: EntityType;
  identity_resolution: IdentityResolution | null;
  official_website_url: string | null;
  discovery_url: string | null;
  linkedin_status: LinkedInStatus;
  colombia_evidence: string | null;
  sector_evidence: string | null;
  is_verified_company: boolean;
};

// ─── Cap aplicado ─────────────────────────────────────────────────────────────

export type CapApplication = {
  cap_name: string;
  cap_value: number;
  reason: string;
  metric_value: number | string;
};

// ─── Resultado de duplicados (Fase D) ────────────────────────────────────────

export type DuplicatePhaseResult = {
  candidate_name: string;
  status: 'new_candidate' | 'duplicate_sellup' | 'duplicate_hubspot' | 'duplicate_inside_result' | 'unchecked';
  matched_id?: string;
};

// ─── Métricas de diversificación (Fase E) ────────────────────────────────────

export type DiversificationMetrics = {
  cities_distinct: number;
  subsectors_distinct: number;
  max_concentration_city: { city: string; count: number };
  max_concentration_subsector: { subsector: string; count: number };
  size_distribution: Record<string, number>;
};

// ─── Uso de recursos ─────────────────────────────────────────────────────────

export type BenchmarkUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  searches_executed: number;
  estimated_cost_usd: number | null;
  cost_status: 'calculated' | 'estimated' | 'unavailable';
};

// ─── Tiempos ─────────────────────────────────────────────────────────────────

export type BenchmarkTimings = {
  started_at: string;
  finished_at: string;
  duration_ms: number;
};

// ─── Error registrado ─────────────────────────────────────────────────────────

export type BenchmarkError = {
  phase: string;
  message: string;
  recoverable: boolean;
};

// ─── Resultado completo de un proveedor ──────────────────────────────────────

export type ProviderRunResult = {
  provider: BenchmarkProviderMode;
  model: string;
  status: 'completed' | 'partial' | 'skipped_not_configured' | 'error';
  skip_reason?: string;
  request: BenchmarkRequest;
  search_plan: SearchPlan | null;
  candidates_discovered: number;
  candidates_rejected: number;
  candidates: BenchmarkCandidate[];
  duplicate_results: DuplicatePhaseResult[];
  diversification: DiversificationMetrics | null;
  usage: BenchmarkUsage;
  timings: BenchmarkTimings;
  errors: BenchmarkError[];
};

// ─── Nivel de evidencia (16AB.23.2) ──────────────────────────────────────────

export type EvidenceLevel = 'A' | 'B' | 'C' | 'D' | 'E';

export type EvidenceClassification = {
  level: EvidenceLevel;
  is_circular: boolean;    // evidence_url tiene el mismo dominio que website
  is_repeated: boolean;    // misma URL usada como evidencia de otra empresa en el pool
  reason: string;
};

// ─── Métricas de pool (16AB.23.2) ────────────────────────────────────────────

export type PoolMetrics = {
  candidate_pool_size: number;
  verification_attempts: number;
  verified_before_dedup: number;
  external_duplicates_removed: number;
  replacement_rounds: number;
  replacement_candidates_verified: number;
  final_candidate_count: number;
  primary_evidence_count: number;
  secondary_high_authority_count: number;
  weak_evidence_count: number;
  circular_evidence_count: number;
  repeated_evidence_count: number;
  low_confidence_removed: number;
  linkedin_confirmed_count: number;
  linkedin_http_unverified_count: number;
  requested_count_reached: boolean;
};

// ─── Métricas calculadas ──────────────────────────────────────────────────────

export type BenchmarkMetrics = {
  provider: BenchmarkProviderMode;
  model: string;
  status: string;

  // Validez básica
  companies_returned: number;
  companies_unique: number;
  companies_with_website: number;
  companies_with_linkedin: number;
  companies_with_evidence_url: number;
  urls_valid: number;
  duplicate_internal: number;
  duplicate_sellup: number;
  duplicate_hubspot: number;

  // Completitud
  completeness_pct: number;

  // Evidencia
  pct_official_source: number;
  pct_strong_evidence: number;
  pct_weak_evidence: number;

  // Diversidad
  cities_distinct: number;
  subsectors_distinct: number;
  max_city_concentration: number;

  // Rendimiento
  duration_ms: number;
  searches_executed: number;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  errors_count: number;

  // Score técnico 0-100
  score: number;
  score_breakdown: ScoreBreakdown;

  // Métricas extendidas (16AB.23.1)
  raw_discovered_count: number;
  verified_company_count: number;
  rejected_non_company_count: number;
  rejected_article_count: number;
  identity_resolution_attempted: number;
  identity_resolution_successful: number;
  official_domain_verified_count: number;
  linkedin_found_count: number;
  linkedin_searched_not_found_count: number;
  missing_description_count: number;
  invalid_final_rows: number;
  score_before_caps: number;
  score_after_caps: number;
  caps_applied: CapApplication[];
  automatically_verified_companies: number;
  human_review_status: 'pending';

  // Métricas de pool (16AB.23.2) — opcionales para compatibilidad con otros proveedores
  pool_metrics?: PoolMetrics;
};

export type ScoreBreakdown = {
  veracidad_identidad: number;       // max 25
  ajuste_pais_sector: number;         // max 20
  calidad_evidencia: number;          // max 20
  completitud: number;                // max 15
  novedad_sin_duplicados: number;     // max 10
  diversificacion: number;            // max 10
};

// ─── Fases del candidato (nuevas en 16AB.23.1) ───────────────────────────────

export type CandidatePhaseResult = {
  raw_discovered_candidates: BenchmarkCandidate[];
  verified_candidates: VerifiedBenchmarkCandidate[];
  rejected_candidates: RejectedCandidate[];
  final_candidates: VerifiedBenchmarkCandidate[];
};

// ─── Reporte completo del benchmark ──────────────────────────────────────────

export type BenchmarkReport = {
  run_id: string;
  canonical_request: BenchmarkRequest;
  providers_attempted: BenchmarkProviderMode[];
  providers_completed: BenchmarkProviderMode[];
  providers_skipped: BenchmarkProviderMode[];
  results: ProviderRunResult[];
  metrics: BenchmarkMetrics[];
  output_dir: string;
  generated_at: string;
};
