/**
 * candidate-final-disposition.ts — Taxonomía canónica y mutuamente excluyente
 * de la disposición final de cada resultado único del proveedor.
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · § E.
 *
 * El defecto que cierra, medido en la corrida `bdc51c49…`: `unique = 17` y el
 * desglose por ronda + `persisted_candidates` sólo explicaban 9. Los ocho que
 * faltaban no eran un fallo de conteo — eran candidatas reales que superaron
 * los gates baratos, quedaron con `sector_evidence_missing_needs_enrichment`, y
 * nunca llegaron a competir por un enrichment (`enrichment_cap_reached`) o
 * quedaron fuera cuando la corrida creyó (equivocadamente, § A) que el objetivo
 * ya estaba cubierto (`target_already_reached`). No tenían nombre: no eran
 * elegibles, no estaban rechazadas, y por tanto no aparecían en ningún lado.
 *
 * Este módulo le da nombre a las doce disposiciones posibles y garantiza, por
 * construcción, que la suma cierra: cada candidato rastreado (`tracked` /
 * `evaluatedCandidates`) cae en EXACTAMENTE una.
 *
 * Alcance deliberado: opera SÓLO sobre lo que el orquestador puede saber, es
 * decir, antes del writer. Las disposiciones `provisionally_persisted_*` no son
 * el desenlace final de verdad — el writer todavía puede rechazar por calidad,
 * duplicado activo o fallo de escritura — y por eso llevan `terminalStage:
 * 'pre_writer'`. La reconciliación post-writer YA EXISTE y es agregada, no por
 * candidato: `persistence_reconciliation.gap_causes` en
 * `apollo-persisted-candidate-truth.ts`. Este módulo no la duplica; la
 * complementa nombrando el universo COMPLETO de candidatas, no sólo las que
 * llegaron al writer.
 *
 * Puro: sin I/O, sin reloj.
 */

import type {
  ApolloTwoRoundRunResult,
  CheapRejectionReason,
  ResumedCandidate,
} from './orchestrator';
import type { EnrichmentSkippedReason } from './enrichment-ranking';

// ─── Taxonomía ────────────────────────────────────────────────────────────────

export type ApolloCandidateFinalDisposition =
  /** Elegible y bajo el tope: va al writer. Su desenlace REAL es post-writer. */
  | 'provisionally_persisted_pending_writer_final'
  /** Elegible, pero el tope del objetivo la deja fuera. */
  | 'target_cap_final'
  /** Pagó su enrichment y el sector siguió ambiguo. SIEMPRE `needs_review`. */
  | 'persisted_review_only_final'
  | 'hubspot_duplicate_final'
  | 'sellup_duplicate_final'
  | 'cooldown_final'
  | 'country_rejected_final'
  | 'ownership_rejected_final'
  | 'sector_subindustry_rejected_final'
  /** Perdió su cupo de enrichment por el cap global de enrichments/corrida. */
  | 'enrichment_budget_exhausted_final'
  /**
   * Perdió su cupo porque una cuenta —ahora ESTABLE, § A— declaró el objetivo
   * alcanzado antes de que a esta candidata le tocara competir.
   */
  | 'not_selected_for_enrichment_final'
  /**
   * Nunca llegó a la fase de selección de enrichment. No debería ocurrir: es
   * la red de seguridad para un candidato con evidencia sectorial pendiente
   * que ni se seleccionó ni se saltó explícitamente.
   */
  | 'insufficient_evidence_not_enriched_final'
  /**
   * Inalcanzable en la práctica: `definitiveRejectionReason` cayó en un valor
   * que este módulo no sabe nombrar. Su presencia en el resultado es en sí
   * misma la señal de alarma — ver `assertNoUnclassifiedFinalDispositions`.
   */
  | 'unclassified_final';

export type ApolloCandidateFinalDispositionEntry = {
  candidateKey: string;
  roundNumber: number;
  finalDisposition: ApolloCandidateFinalDisposition;
  /** Motivo textual, cuando lo hay. Vocabulario ya existente — nunca inventado. */
  finalReason: CheapRejectionReason | 'sector_evidence_contradictory' | EnrichmentSkippedReason | null;
  terminalStage: 'pre_writer' | 'orchestrator_final';
};

const OWNERSHIP_REASONS: ReadonlySet<CheapRejectionReason> = new Set([
  'invalid_domain',
  'external_platform_domain',
  'ownership_mismatch',
]);

const SECTOR_REASONS: ReadonlySet<CheapRejectionReason | 'sector_evidence_contradictory'> = new Set([
  'sector_not_mapped',
  'sector_evidence_contradictory',
]);

function classifyDefinitiveRejection(
  reason: CheapRejectionReason | 'sector_evidence_contradictory',
): ApolloCandidateFinalDisposition {
  if (reason === 'duplicate_in_hubspot') return 'hubspot_duplicate_final';
  if (reason === 'duplicate_in_sellup') return 'sellup_duplicate_final';
  if (reason === 'cooldown_or_prior_suggestion') return 'cooldown_final';
  if (reason === 'country_incompatible') return 'country_rejected_final';
  if (OWNERSHIP_REASONS.has(reason as CheapRejectionReason)) return 'ownership_rejected_final';
  if (SECTOR_REASONS.has(reason)) return 'sector_subindustry_rejected_final';
  // `duplicate_within_response` / `seen_in_previous_round` / `raw_result_cap_reached`
  // nunca llegan a `tracked`: el orquestador las descarta ANTES de crear el
  // candidato. Llegar aquí con una de ellas sería un candidato fantasma.
  return 'unclassified_final';
}

function classifyPendingWithoutDisposition(
  skippedReason: EnrichmentSkippedReason | null,
): ApolloCandidateFinalDisposition {
  if (skippedReason === 'enrichment_cap_reached') return 'enrichment_budget_exhausted_final';
  if (skippedReason === 'target_already_reached') return 'not_selected_for_enrichment_final';
  // `known_duplicate` (colisión de clave dentro de la misma selección),
  // `prior_operation_indeterminate` y los descalificadores categóricos
  // (`country_incompatible`, `domain_not_confident`, `sector_not_mapped`,
  // `sector_evidence_contradictory`, `cooldown_active`) que SÍ llegan aquí lo
  // hacen porque `disqualify()` los evaluó en la fase de enrichment sin que el
  // gate barato los hubiera marcado — señales libres, no evidencia comprada.
  // Todos comparten el mismo desenlace real: nunca compitieron por un
  // enrichment que las hubiera podido mover.
  if (skippedReason !== null) return 'not_selected_for_enrichment_final';
  return 'insufficient_evidence_not_enriched_final';
}

/**
 * § E — la disposición final de TODOS los resultados únicos de una corrida.
 *
 * Invariante garantizada por construcción:
 * `evaluatedCandidates.length === result.length` y ninguna entrada repite
 * `candidateKey`.
 */
export function evaluateApolloCandidateFinalDispositions(
  runResult: ApolloTwoRoundRunResult,
): ApolloCandidateFinalDispositionEntry[] {
  const persistedKeys = new Set(runResult.persisted.map((c) => c.candidateKey));
  const reviewOnlyKeys = new Set(runResult.reviewOnly.map((c) => c.candidateKey));
  const notPersistedKeys = new Set(runResult.notPersisted.map((c) => c.candidateKey));

  // § A — si un candidato aparece más de una vez en `enrichmentSkips` (por
  // ejemplo saltado primero por un descalificador categórico y luego, en un
  // reintento, por el cap), el motivo más INFORMATIVO es el último: refleja el
  // estado de la corrida más cercano al cierre.
  const latestSkipReasonByKey = new Map<string, EnrichmentSkippedReason>();
  for (const skip of runResult.enrichmentSkips) {
    latestSkipReasonByKey.set(skip.candidateKey, skip.skippedReason);
  }

  return runResult.evaluatedCandidates.map((candidate: ResumedCandidate) => {
    if (persistedKeys.has(candidate.candidateKey)) {
      return {
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        finalDisposition: 'provisionally_persisted_pending_writer_final' as const,
        finalReason: null,
        terminalStage: 'pre_writer' as const,
      };
    }
    if (notPersistedKeys.has(candidate.candidateKey)) {
      return {
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        finalDisposition: 'target_cap_final' as const,
        finalReason: null,
        terminalStage: 'orchestrator_final' as const,
      };
    }
    if (reviewOnlyKeys.has(candidate.candidateKey)) {
      return {
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        finalDisposition: 'persisted_review_only_final' as const,
        finalReason: null,
        terminalStage: 'orchestrator_final' as const,
      };
    }

    if (candidate.definitivelyRejected === true && candidate.definitiveRejectionReason != null) {
      const reason = candidate.definitiveRejectionReason;
      return {
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        finalDisposition: classifyDefinitiveRejection(reason),
        finalReason: reason,
        terminalStage: 'orchestrator_final' as const,
      };
    }

    // Ni elegible, ni en el tope, ni en revisión, ni rechazada con causa: nunca
    // llegó a confirmarse. La razón, si la hay, vive en `enrichmentSkips`.
    const skippedReason = latestSkipReasonByKey.get(candidate.candidateKey) ?? null;
    return {
      candidateKey: candidate.candidateKey,
      roundNumber: candidate.roundNumber,
      finalDisposition: classifyPendingWithoutDisposition(skippedReason),
      finalReason: skippedReason,
      terminalStage: 'orchestrator_final' as const,
    };
  });
}

/**
 * § E — invariante: `unclassified_final` debe estar SIEMPRE vacío. Su
 * aparición es un candidato fantasma (una combinación de estado que este
 * módulo no anticipó), no un dato faltante que se pueda rellenar.
 */
export function countUnclassifiedFinalDispositions(
  entries: readonly ApolloCandidateFinalDispositionEntry[],
): number {
  return entries.filter((entry) => entry.finalDisposition === 'unclassified_final').length;
}

/** Proyección a metadata persistible. Sin nombres de empresa ni dominios. */
export function toCandidateFinalDispositionsMetadata(
  entries: readonly ApolloCandidateFinalDispositionEntry[],
): Record<string, unknown> {
  const breakdown: Record<string, number> = {};
  for (const entry of entries) {
    breakdown[entry.finalDisposition] = (breakdown[entry.finalDisposition] ?? 0) + 1;
  }
  return {
    total_unique_results: entries.length,
    unclassified_count: countUnclassifiedFinalDispositions(entries),
    breakdown,
  };
}
