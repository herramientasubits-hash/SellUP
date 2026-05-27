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

// ─── Input ────────────────────────────────────────────────────────────────────

export type IncrementalSearchWebProvider = 'tavily' | 'mock';

export type IncrementalSearchInput = {
  country: string;
  countryCode: string;
  industry: string;

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

// ─── Metadata ────────────────────────────────────────────────────────────────

export type IncrementalSearchMetadata = {
  rounds_executed: number;
  stopped_reason: IncrementalSearchStoppedReason;
  total_raw_evaluated: number;
  total_candidates_accumulated: number;
  useful_candidates_count: number;
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
  metadata: IncrementalSearchMetadata;
  warnings: string[];
};
