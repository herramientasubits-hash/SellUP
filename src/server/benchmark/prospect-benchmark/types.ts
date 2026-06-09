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
};

export type ScoreBreakdown = {
  veracidad_identidad: number;       // max 25
  ajuste_pais_sector: number;         // max 20
  calidad_evidencia: number;          // max 20
  completitud: number;                // max 15
  novedad_sin_duplicados: number;     // max 10
  diversificacion: number;            // max 10
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
