/**
 * run-final-state-consistency.ts — AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § D.
 *
 * Una corrida deja su desenlace escrito en cinco sitios distintos: el desglose
 * por ronda, los `candidate_snapshots` del checkpoint, `run_metrics`, el resumen
 * del writer y el desglose que ve el usuario. La corrida `7d92773b` demostró que
 * pueden contradecirse sin que nada lo advierta:
 *
 *   - `run_metrics.sector_rejected_after_enrichment = 1` mientras
 *     `rounds[2].sector_rejected = 0` (una empresa única sin disposición);
 *   - `candidate_snapshots` guardaba «Supermercado Vaquita» como `eligible: true`
 *     mientras `run_metrics.total_eligible_companies = 0`.
 *
 * Este módulo compara esas fuentes y NOMBRA los conflictos. Reglas:
 *
 *   - **Puro.** Sin I/O, sin env, sin React, sin fechas. Testeable sin base.
 *   - **Sólo estado FINAL.** No exige que las estructuras intermedias coincidan:
 *     un checkpoint de mitad de corrida describe legítimamente un estado previo.
 *     Lo que se compara es lo que se declara final.
 *   - **Observacional.** No lanza y no bloquea la corrida: devuelve la lista de
 *     conflictos para que aterrice en el metadata. Una corrida que ya se pagó no
 *     se tira por una discrepancia de contabilidad; se deja constancia.
 */

// ─── Vistas mínimas de cada fuente ────────────────────────────────────────────

/**
 * Lo único que hace falta de un candidato. Estructural a propósito: acepta tanto
 * un `ApolloTwoRoundCandidateSnapshot` (snake_case, del checkpoint) como
 * cualquier proyección equivalente, sin acoplar este módulo a ninguno de los dos.
 */
export type FinalStateCandidateView = {
  candidate_key: string;
  eligible: boolean;
  finally_rejected_or_duplicated: boolean;
};

/** Desglose por ronda, reducido a las disposiciones que participan del cierre. */
export type FinalStateRoundView = {
  roundNumber: number;
  knownCompanyDuplicates: number;
  countryRejected: number;
  sectorRejected: number;
  ownershipRejected: number;
};

/** Totales declarados por la corrida. */
export type FinalStateRunMetricsView = {
  totalUniqueOrganizations: number;
  totalEligibleCompanies: number;
  persistedCandidates: number;
};

export type ApolloTwoRoundFinalStateConflictCode =
  /** Un snapshot afirma a la vez «elegible» y «rechazado/duplicado final». */
  | 'candidate_snapshot_contradicts_itself'
  /** Los snapshots elegibles no coinciden con `total_eligible_companies`. */
  | 'eligible_count_disagrees_with_run_metrics'
  /** Los snapshots no coinciden con `total_unique_organizations`. */
  | 'candidate_snapshot_count_disagrees_with_run_metrics'
  /** El desglose por ronda no cubre todas las empresas únicas. */
  | 'round_breakdown_leaves_unique_results_unclassified'
  /** El desglose por ronda suma MÁS empresas que las únicas observadas. */
  | 'round_breakdown_over_counts_unique_results'
  /** Se persistieron más candidatos que elegibles hubo. */
  | 'persisted_exceeds_eligible'
  /** `target_reached` no se deriva de las cifras que la propia corrida declara. */
  | 'target_reached_disagrees_with_eligible_count';

export type ApolloTwoRoundFinalStateConflict = {
  code: ApolloTwoRoundFinalStateConflictCode;
  /** Texto corto y SIN datos de empresa: viaja a metadata persistible. */
  detail: string;
};

export type ApolloTwoRoundFinalStateConsistency = {
  ok: boolean;
  conflicts: ApolloTwoRoundFinalStateConflict[];
  /** Empresas únicas que ninguna disposición final del desglose explica. */
  unclassifiedUniqueResults: number;
  /** Elegibles según los snapshots del estado final. */
  eligibleFromCandidateSnapshots: number;
  /**
   * AGENT1-APOLLO-FINALIZATION-HARDENING-1 § E — de las snapshots, cuántas NO
   * son elegibles y TAMPOCO están rechazadas/duplicadas definitivamente.
   *
   * Es la disposición que el desglose por ronda no puede nombrar porque no es
   * un rechazo: son candidatas que pasaron los gates baratos, quedaron con
   * `sector_evidence_missing_needs_enrichment`, y nunca llegaron a competir por
   * un enrichment (`enrichment_cap_reached`) o quedaron fuera cuando el
   * objetivo se declaró alcanzado (`target_already_reached`) — antes de la § A,
   * exactamente los ocho resultados sin clasificar de la corrida `bdc51c49`.
   */
  notSelectedForEnrichmentOrInsufficientEvidence: number;
};

// ─── Evaluación ───────────────────────────────────────────────────────────────

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function evaluateApolloTwoRoundFinalStateConsistency(input: {
  rounds: readonly FinalStateRoundView[];
  /** Snapshots del estado FINAL. Un checkpoint intermedio no se evalúa aquí. */
  candidates: readonly FinalStateCandidateView[];
  runMetrics: FinalStateRunMetricsView;
  targetEligibleCompanies: number;
  targetReached: boolean;
}): ApolloTwoRoundFinalStateConsistency {
  const conflicts: ApolloTwoRoundFinalStateConflict[] = [];

  // 1 · Un candidato no puede ser elegible y estar definitivamente descartado.
  const contradictory = input.candidates.filter(
    (candidate) => candidate.eligible && candidate.finally_rejected_or_duplicated,
  );
  if (contradictory.length > 0) {
    conflicts.push({
      code: 'candidate_snapshot_contradicts_itself',
      detail: `${contradictory.length} snapshot(s) con eligible=true y finally_rejected_or_duplicated=true`,
    });
  }

  // 2 · Elegibles según snapshots vs. `run_metrics`.
  const eligibleFromCandidateSnapshots = input.candidates.filter(
    (candidate) => candidate.eligible && !candidate.finally_rejected_or_duplicated,
  ).length;
  const declaredEligible = safeCount(input.runMetrics.totalEligibleCompanies);
  if (eligibleFromCandidateSnapshots !== declaredEligible) {
    conflicts.push({
      code: 'eligible_count_disagrees_with_run_metrics',
      detail: `candidate_snapshots=${eligibleFromCandidateSnapshots} run_metrics=${declaredEligible}`,
    });
  }

  // 3 · Universo observado vs. snapshots. Se comprueba sólo cuando hay snapshots:
  // un estado final sin candidatos puede venir de una corrida rehidratada que ya
  // compactó su evidencia, y ahí la comparación no diría nada.
  const declaredUnique = safeCount(input.runMetrics.totalUniqueOrganizations);
  if (input.candidates.length > 0 && input.candidates.length !== declaredUnique) {
    conflicts.push({
      code: 'candidate_snapshot_count_disagrees_with_run_metrics',
      detail: `candidate_snapshots=${input.candidates.length} run_metrics=${declaredUnique}`,
    });
  }

  // 4 · El desglose por ronda tiene que cerrar contra las empresas únicas.
  //     `seenDuplicates` NO participa: cuenta eventos de repetición, no empresas.
  //
  // § E — las snapshots aportan la disposición que el desglose por ronda no
  // nombra: candidatas que ni son elegibles ni están rechazadas/duplicadas
  // definitivamente. Sólo se suma cuando HAY snapshots (check 3 ya explica por
  // qué una corrida rehidratada puede llegar sin ellas): sin candidatos, sumar
  // cero no es afirmar "no hay pendientes", es "no se pudo saber".
  const notSelectedForEnrichmentOrInsufficientEvidence =
    input.candidates.length > 0
      ? input.candidates.filter(
          (candidate) => !candidate.eligible && !candidate.finally_rejected_or_duplicated,
        ).length
      : 0;
  const classified =
    input.rounds.reduce(
      (sum, round) =>
        sum +
        safeCount(round.knownCompanyDuplicates) +
        safeCount(round.countryRejected) +
        safeCount(round.sectorRejected) +
        safeCount(round.ownershipRejected),
      0,
    ) +
    safeCount(input.runMetrics.persistedCandidates) +
    notSelectedForEnrichmentOrInsufficientEvidence;
  const delta = declaredUnique - classified;
  const unclassifiedUniqueResults = delta > 0 ? delta : 0;
  if (delta > 0) {
    conflicts.push({
      code: 'round_breakdown_leaves_unique_results_unclassified',
      detail: `unique=${declaredUnique} clasificadas=${classified} sin_clasificar=${delta}`,
    });
  } else if (delta < 0) {
    conflicts.push({
      code: 'round_breakdown_over_counts_unique_results',
      detail: `unique=${declaredUnique} clasificadas=${classified} sobreconteo=${-delta}`,
    });
  }

  // 5 · No se puede persistir más de lo que fue elegible.
  const persisted = safeCount(input.runMetrics.persistedCandidates);
  if (persisted > declaredEligible) {
    conflicts.push({
      code: 'persisted_exceeds_eligible',
      detail: `persistidos=${persisted} elegibles=${declaredEligible}`,
    });
  }

  // 6 · `target_reached` se DERIVA; no se declara por separado.
  const derivedTargetReached = declaredEligible >= safeCount(input.targetEligibleCompanies);
  if (derivedTargetReached !== input.targetReached) {
    conflicts.push({
      code: 'target_reached_disagrees_with_eligible_count',
      detail: `declarado=${input.targetReached} derivado=${derivedTargetReached}`,
    });
  }

  return {
    ok: conflicts.length === 0,
    conflicts,
    unclassifiedUniqueResults,
    eligibleFromCandidateSnapshots,
    notSelectedForEnrichmentOrInsufficientEvidence,
  };
}

/** Proyección a metadata persistible. Sin nombres de empresa ni dominios. */
export function toFinalStateConsistencyMetadata(
  consistency: ApolloTwoRoundFinalStateConsistency,
): Record<string, unknown> {
  return {
    ok: consistency.ok,
    unclassified_unique_results: consistency.unclassifiedUniqueResults,
    eligible_from_candidate_snapshots: consistency.eligibleFromCandidateSnapshots,
    not_selected_for_enrichment_or_insufficient_evidence:
      consistency.notSelectedForEnrichmentOrInsufficientEvidence,
    conflicts: consistency.conflicts.map((conflict) => ({
      code: conflict.code,
      detail: conflict.detail,
    })),
  };
}
