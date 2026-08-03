/**
 * run-state.ts — Estado persistible de una corrida de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FIX · § 7.
 *
 * El hueco que cierra: un reintento reconocía por clave de operación que la
 * ronda 1 ya se había buscado y la SALTABA, pero sin nada que recuperar la
 * trataba como si hubiera devuelto cero candidatos. La corrida terminaba vacía
 * después de haber pagado — el peor de los dos mundos: se gastó y no se
 * persistió.
 *
 * Aquí se serializa lo mínimo suficiente para continuar:
 *
 *   organizaciones vistas
 *   candidatos elegibles y rechazados, con su motivo
 *   métricas por ronda
 *   claves de operación completadas
 *   créditos ya registrados
 *
 * Todo lo derivable (ranking final, métricas de corrida) se recalcula: guardarlo
 * sólo abriría la puerta a que el estado y el resultado discrepen.
 *
 * Puro: sin I/O, sin reloj, sin env. La lectura y la escritura contra Supabase
 * viven en `run-state.server.ts`.
 */

import type { ApolloTwoRoundRunCorrelation } from './idempotency';
import type { ApolloTwoRoundResumeState } from './orchestrator';
import type { ProspectingPipelineCandidate, WebSearchResult } from '../types';

/** Clave bajo la que el estado aterriza en `prospect_batches.metadata`. */
export const APOLLO_TWO_ROUND_RUN_STATE_KEY = 'apollo_two_round_run_state' as const;

/** Versión del formato. Un estado de otra versión se ignora, nunca se adivina. */
export const APOLLO_TWO_ROUND_RUN_STATE_VERSION = 1 as const;

export type ApolloTwoRoundPersistedRunState = {
  version: typeof APOLLO_TWO_ROUND_RUN_STATE_VERSION;
  /**
   * Identidad de la corrida. Un estado cuya identidad no coincide pertenece a
   * OTRO trabajo y reutilizarlo saltaría operaciones que nunca se hicieron.
   */
  idempotency_key: string;
  request_fingerprint: string;
  completed_operation_keys: string[];
  recorded_usage_credits: number;
  candidates_persisted: boolean;
  /** Estado del orquestador, tal cual. Se guarda como JSON plano. */
  resume: ApolloTwoRoundResumeState;
  /**
   * Candidatos ya construidos (verificación, dedup y scoring incluidos), por
   * clave.
   *
   * Sin ellos, un reintento recuperaba el veredicto del orquestador pero no
   * tenía nada que persistir: la corrida terminaba con cero candidatos después
   * de haber pagado la búsqueda. Están acotados por el tope de resultados crudos
   * de la corrida (diez), así que el documento no crece sin control.
   */
  pipeline_candidates: Record<string, ProspectingPipelineCandidate>;
  /**
   * Resultado de búsqueda por clave. Lo necesita un reintento que aún tenga
   * enrichments pendientes: sin el resultado no hay a quién enriquecer.
   */
  search_results: Record<string, WebSearchResult>;
};

export type SerializeRunStateInput = {
  correlation: ApolloTwoRoundRunCorrelation;
  completedOperationKeys: readonly string[];
  resume: ApolloTwoRoundResumeState;
  recordedUsageCredits: number;
  candidatesPersisted: boolean;
  pipelineCandidates: ReadonlyMap<string, ProspectingPipelineCandidate>;
  searchResults: ReadonlyMap<string, WebSearchResult>;
};

export function serializeRunState(
  input: SerializeRunStateInput,
): ApolloTwoRoundPersistedRunState {
  return {
    version: APOLLO_TWO_ROUND_RUN_STATE_VERSION,
    idempotency_key: input.correlation.idempotencyKey,
    request_fingerprint: input.correlation.requestFingerprint,
    completed_operation_keys: [...input.completedOperationKeys],
    recorded_usage_credits: input.recordedUsageCredits,
    candidates_persisted: input.candidatesPersisted,
    resume: input.resume,
    pipeline_candidates: Object.fromEntries(input.pipelineCandidates),
    search_results: Object.fromEntries(input.searchResults),
  };
}

export type RestoredRunState = {
  completedOperationKeys: string[];
  resume: ApolloTwoRoundResumeState;
  recordedUsageCredits: number;
  candidatesPersisted: boolean;
  pipelineCandidates: Map<string, ProspectingPipelineCandidate>;
  searchResults: Map<string, WebSearchResult>;
};

/**
 * Rehidrata el estado de un intento anterior.
 *
 * Devuelve `null` —y la corrida empieza de cero— cuando el estado falta, tiene
 * otra versión, o pertenece a otra corrida. Fallar hacia "empezar de cero" es
 * seguro para la CALIDAD (se vuelve a buscar) pero costoso; aceptar un estado
 * ajeno sería inseguro para el GASTO, porque saltaría operaciones que esta
 * corrida nunca ejecutó. Entre las dos, se elige la segura.
 */
export function deserializeRunState(
  raw: unknown,
  correlation: ApolloTwoRoundRunCorrelation,
): RestoredRunState | null {
  if (raw === null || typeof raw !== 'object') return null;
  const state = raw as Partial<ApolloTwoRoundPersistedRunState>;

  if (state.version !== APOLLO_TWO_ROUND_RUN_STATE_VERSION) return null;
  if (state.idempotency_key !== correlation.idempotencyKey) return null;
  if (state.request_fingerprint !== correlation.requestFingerprint) return null;
  if (!state.resume || typeof state.resume !== 'object') return null;
  if (!Array.isArray(state.completed_operation_keys)) return null;

  const resume = state.resume as ApolloTwoRoundResumeState;
  if (!Array.isArray(resume.candidates) || !Array.isArray(resume.rounds)) return null;
  if (!Array.isArray(resume.seenIdentities)) return null;

  return {
    completedOperationKeys: state.completed_operation_keys.filter(
      (key): key is string => typeof key === 'string',
    ),
    resume: {
      ...resume,
      totalRawResults: numberOrZero(resume.totalRawResults),
      totalSearchCredits: numberOrZero(resume.totalSearchCredits),
      totalEnrichmentCredits: numberOrZero(resume.totalEnrichmentCredits),
      enrichmentsExecuted: numberOrZero(resume.enrichmentsExecuted),
      observedRejectionReasons: Array.isArray(resume.observedRejectionReasons)
        ? resume.observedRejectionReasons
        : [],
    },
    recordedUsageCredits: numberOrZero(state.recorded_usage_credits),
    candidatesPersisted: state.candidates_persisted === true,
    pipelineCandidates: toMap(state.pipeline_candidates),
    searchResults: toMap(state.search_results),
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toMap<T>(value: unknown): Map<string, T> {
  if (value === null || typeof value !== 'object') return new Map();
  return new Map(Object.entries(value as Record<string, T>));
}
