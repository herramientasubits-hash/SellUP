/**
 * Incremental Search — Tipos (Hito 16T.1)
 *
 * Contratos de entrada, salida y metadata del orquestador incremental.
 * No contienen lógica. No importan nada externo.
 *
 * Reglas de seguridad:
 * - webSearchProvider limitado a 'tavily' | 'mock' (google_cse no disponible en flujo incremental)
 * - No hace referencia a Supabase, HubSpot, Apollo, Lusha ni Google CSE.
 */

import type { ProspectingPipelineCandidate } from './types';
import type { TavilyUsageBaseContext } from './tavily-usage-logging';

// ─── Input ────────────────────────────────────────────────────────────────────

export type IncrementalSearchWebProvider = 'tavily' | 'mock';

export type IncrementalSearchInput = {
  country: string;
  countryCode: string;
  industry: string;

  /**
   * Nombres canónicos de subindustrias resueltos desde el catálogo.
   * Provisto server-side por el wizard. Nunca controlado por el cliente.
   * Cuando está presente, los query builders los inyectan en las queries de discovery.
   * Hito 16AB.43.14.
   */
  subindustries?: string[];

  /** Web search provider. Limitado a tavily y mock en flujo incremental.
   * Default: 'mock' */
  webSearchProvider?: IncrementalSearchWebProvider;

  /** Mínimo de candidatos útiles (non-duplicate, non-discard) para detener la búsqueda.
   * Default: 7 */
  minUsefulCandidates?: number;

  /** Objetivo interno de candidatos por ronda (pasado a pipeline como targetCount).
   * Default: 10 */
  targetInternal?: number;

  /** Número máximo de rondas de búsqueda.
   * Default: 2 */
  maxRounds?: number;

  /** Máximo de resultados raw acumulados a evaluar entre todas las rondas.
   * Default: 50 */
  maxTotalRawToEvaluate?: number;

  /** Costo máximo estimado en USD. Reservado para uso futuro.
   * Default: 0.15 */
  maxEstimatedCostUsd?: number;

  /** Objetivo de candidatos persistibles (post-novelty) para detener la búsqueda.
   * Cuando se alcanza, el orquestador para y marca targetReached=true en el output.
   * Default: 10 */
  targetPersistibleCandidates?: number;

  /** Cuando true (default en validación), no llama writeProspectingCandidates.
   * Default: true */
  dryRun?: boolean;

  triggeredByUserId?: string | null;
  ownerId?: string | null;
  batchName?: string | null;
  /**
   * When provided, the writer reuses this batch instead of creating a new one.
   * Forwarded verbatim to writeProspectingCandidates.
   * Internal-only — not exposed to UI or external clients.
   */
  existingBatchId?: string | null;

  /**
   * Contexto de uso económico para trazabilidad Tavily.
   * Provisto server-side por el wizard. No controlado por el cliente.
   * roundNumber se asigna internamente por ronda.
   */
  usageInputContext?: TavilyUsageBaseContext | null;

  /**
   * Criterios adicionales ingresados por el usuario en el wizard.
   * Provisto server-side — nunca controlado por el cliente directamente.
   * Se persiste en el metadata del batch como snapshot y puede influir en queries.
   */
  additionalCriteria?: string | null;
};

// ─── Round metadata ───────────────────────────────────────────────────────────

export type IncrementalSearchRoundMeta = {
  round: number;
  queriesUsed: string[];
  rawResultsCount: number;
  candidatesEvaluated: number;
  candidatesNewAfterDomainFilter: number;
  candidatesAccumulatedTotal: number;
  usefulCandidatesAccumulated: number;
  seenDomainsAtRoundStart: number;
  newDomainsFoundThisRound: number;
  /** Candidatos cuyo dominio ya estaba en la memoria negativa (corridas previas de agent_1). */
  excludedByNegativeMemoryCount?: number;
  /** Candidatos nuevos después de filtrar memoria negativa. */
  newAfterNegativeMemoryCount?: number;
};

// ─── Stopped reason ───────────────────────────────────────────────────────────

export type IncrementalSearchStoppedReason =
  | 'min_useful_reached'
  | 'target_reached'
  | 'max_rounds_reached'
  | 'max_raw_exceeded'
  | 'cost_limit_exceeded'
  | 'no_results_round_1'
  | 'novelty_exhausted_no_diversification_available'
  | 'error';

// ─── Discovery strategy metadata (Hito 16AB.43.24) ──────────────────────────

export type SourceGatingDecisionSummary = {
  source_key: string;
  allowed: boolean;
  reason: string;
};

/**
 * Metadata del plan de discovery novelty-aware persistido en el batch.
 * Documenta qué estrategia se usó, qué dominios se excluyeron y por qué.
 */
export type DiscoveryStrategyMetadata = {
  version: 'novelty_aware_v1';
  negative_memory_enabled: boolean;
  excluded_domains_count: number;
  excluded_domains_sample: string[];
  query_families_used: string[];
  source_gating_applied: boolean;
  source_gating_decisions: SourceGatingDecisionSummary[];
  secop_excluded: boolean;
  round2_strategy?: string;
  early_stop_reason?: string;
  credits_saved_estimate?: number;
};

// ─── Adaptive discovery metadata (Hito 16AB.43.26 / 16AB.43.27) ─────────────

export type AdaptiveDiscoveryResultStatus =
  | 'success_target_reached'
  | 'success_partial'
  | 'no_new_candidates'
  | 'insufficient_budget';

export type AdaptiveDiscoveryMetadata = {
  enabled: boolean;
  target_persistible_candidates: number;
  /** Actual candidates persisted by the writer (reconciled post-writer). */
  persisted_count: number;
  /** Candidates estimated persistible before target cap (reconciled post-writer). */
  eligible_before_cap?: number;
  persistible_estimate: number;
  remaining_to_target: number;
  max_rounds: number;
  rounds_executed: number;
  stop_reason:
    | 'target_reached'
    | 'max_rounds_reached'
    | 'budget_cap_reached'
    | 'novelty_exhausted_no_diversification_available';
  /** High-level result status set after writer completes (Hito 16AB.43.27). */
  result_status?: AdaptiveDiscoveryResultStatus;
};

// ─── Query cap metadata (Hito v1.3) ─────────────────────────────────────────

export type QueryCapMetadata = {
  searchDepth: 'standard' | 'deep';
  totalQueryCap: number;
  perRoundCap: number;
  queryCapApplied: boolean;
  queriesGeneratedBeforeCap: number;
  queriesExecutedAfterCap: number;
  skippedByQueryCap: number;
};

// ─── Incremental search plan (Hito v1.3) ────────────────────────────────────

export type IncrementalSearchPlanMeta = {
  version: 'search_planner_v1_3';
  usedForExecution: true;
  fallbackUsed: false;
  querySelectionReason: 'incremental_multi_round';
  queryCap: QueryCapMetadata;
  queryFamilies: string[];
  sourceStrategy: SourceGatingDecisionSummary[];
};

// ─── Target cap metadata (Hito 16AB.43.27) ───────────────────────────────────

export type TargetCapMetadata = {
  enabled: boolean;
  target: number;
  eligible_before_cap: number;
  persisted_after_cap: number;
  capped_count: number;
};

// ─── Precision gate metadata (Hito 16AB.43.27 / 16AB.43.28) ─────────────────

export type PrecisionGateMetadata = {
  enabled: boolean;
  /** URLs classified as content/article/case-study pages (Hito 16AB.43.28). */
  content_page_exclusions: number;
  /** Candidates removed by intra-batch identity deduplification (Hito 16AB.43.28). */
  intra_batch_duplicates_removed: number;
  country_incompatible_exclusions: number;
  generic_name_exclusions: number;
  target_cap_exclusions: number;
};

// ─── Source-Guided Investigation metadata (Hito v1.12) ───────────────────────

export type SourceGuidedQueryPackMetadata = {
  source_key: string;
  intent: string;
  query_text: string;
  priority: 'high' | 'medium' | 'low';
};

/**
 * Metadata del investigation source-guided v1.12.
 * Documenta cuántas queries source-guided se generaron, cuántas pasaron
 * el filtro de estrategia, y qué fuentes quedaron bloqueadas.
 */
export type SourceGuidedInvestigationMetadata = {
  enabled: boolean;
  version: 'source_guided_investigation_v1_12';
  generated_query_count: number;
  selected_query_count: number;
  source_guided_selected_count: number;
  fallback_selected_count: number;
  query_packs: SourceGuidedQueryPackMetadata[];
  blocked_source_query_count: number;
  blocked_sources: string[];
};

// ─── Search Strategy Runtime metadata (Hito v1.8.1) ──────────────────────────

/**
 * Sample de una query bloqueada por la estrategia de búsqueda.
 * Permite auditar qué se filtró y por qué.
 */
export type BlockedQuerySample = {
  query_text: string;
  query_source_key: string;
  reason: string;
};

/**
 * Métricas de runtime del filtro de estrategia de búsqueda.
 * Persisted in batch metadata under 'search_strategy_runtime'.
 */
export type SearchStrategyRuntimeMetadata = {
  enabled: true;
  source_guided_queries_allowed: number;
  source_guided_queries_blocked: number;
  fallback_queries_allowed: number;
  blocked_samples: BlockedQuerySample[];
};

// ─── Novelty pre-check ───────────────────────────────────────────────────────

/** Resultado del pre-check estimado antes de la decisión de ronda 2. */
export type NoveltyPrecheckSummary = {
  enabled: boolean;
  estimated_skipped_count: number;
  estimated_persistable_count: number;
};

// ─── Metadata ────────────────────────────────────────────────────────────────

export type IncrementalSearchMetadata = {
  rounds_executed: number;
  stopped_reason: IncrementalSearchStoppedReason;
  total_raw_evaluated: number;
  total_candidates_accumulated: number;
  /** Candidatos útiles (non-duplicate, non-discard) antes de aplicar novelty. */
  useful_candidates_count: number;
  /**
   * Candidatos útiles que estimamos sobrevivirían el novelty filter del writer.
   * Solo presente cuando dryRun=false y env Supabase disponible.
   */
  useful_candidates_count_before_novelty?: number;
  estimated_persistable_after_novelty?: number;
  estimated_novelty_skipped?: number;
  novelty_precheck?: NoveltyPrecheckSummary;
  /**
   * True cuando el pre-check confirma que 0 candidatos útiles sobrevivirían el
   * novelty filter. Señal de agotamiento de novedad — el universo de empresas
   * disponibles con estas queries ya fue visitado recientemente.
   */
  novelty_exhausted?: boolean;
  /** Total de candidatos excluidos por memoria negativa en todas las rondas. */
  excluded_by_negative_memory_total?: number;
  /** Metadata del plan de discovery novelty-aware (Hito 16AB.43.24). */
  discovery_strategy?: DiscoveryStrategyMetadata;
  /** Metadata del adaptive discovery budget (Hito 16AB.43.26). */
  adaptive_discovery?: AdaptiveDiscoveryMetadata;
  /** Metadata del source-guided investigation v1.12. */
  source_guided_investigation?: SourceGuidedInvestigationMetadata;
  min_useful_candidates: number;
  target_internal: number;
  max_rounds: number;
  max_total_raw_to_evaluate: number;
  dry_run: boolean;
  rounds: IncrementalSearchRoundMeta[];
};

// ─── Output ───────────────────────────────────────────────────────────────────

export type IncrementalSearchOutput = {
  input: IncrementalSearchInput;
  candidates: ProspectingPipelineCandidate[];
  candidatesCount: number;
  usefulCandidatesCount: number;
  /** Actual count persisted by writeProspectingCandidates (dryRun=false only).
   * May be less than usefulCandidatesCount due to novelty filtering in the writer. */
  candidatesCreated?: number;
  metadata: IncrementalSearchMetadata;
  warnings: string[];
  /** Set when dryRun=false and writeProspectingCandidates succeeds. */
  batchId?: string | null;
  /** True when actual candidatesCreated >= targetPersistibleCandidates after writing. */
  targetReached?: boolean;
  /** The configured target (for UI display). */
  targetPersistibleCandidates?: number;
  /** Runtime stats from the search strategy filter (Hito v1.8.1). Always present. */
  searchStrategyRuntime?: SearchStrategyRuntimeMetadata;
};
