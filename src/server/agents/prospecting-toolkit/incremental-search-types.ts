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
};

// ─── Stopped reason ───────────────────────────────────────────────────────────

export type IncrementalSearchStoppedReason =
  | 'min_useful_reached'
  | 'max_rounds_reached'
  | 'max_raw_exceeded'
  | 'cost_limit_exceeded'
  | 'no_results_round_1'
  | 'error';

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
};
