/**
 * enrichment-ranking.ts — Selección económica de los enrichments pagados.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 6 y § 9.
 *
 * El defecto que cierra: se enriquecía el PRIMER resultado recibido. Así se pagó
 * por `citi.com` en una búsqueda de supermercados y se descartó después. Aquí el
 * orden lo decide un ranking construido SÓLO con señales gratuitas —todo lo que
 * ya venía en la respuesta de búsqueda— y el gasto se reserva para candidatos
 * que resuelven una ambigüedad concreta.
 *
 * Regla central: un enrichment sólo se justifica cuando falta evidencia
 * sectorial. Un candidato ya confirmado no necesita que le compremos la
 * confirmación, y uno contradicho no mejora comprándole una descripción.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

// ─── Señales gratuitas ────────────────────────────────────────────────────────

/**
 * Veredicto sectorial del candidato, en el vocabulario del § 5.
 * Sólo `sector_evidence_missing_needs_enrichment` compite por un enrichment.
 */
export type CandidateSectorEvidenceState =
  | 'sector_evidence_confirmed'
  | 'sector_evidence_missing_needs_enrichment'
  | 'sector_evidence_contradictory'
  | 'sector_not_mapped';

/** Señales que ya están en la respuesta de búsqueda: leerlas no cuesta un crédito. */
export type FreeCandidateSignals = {
  /** Identidad estable del candidato dentro de la corrida. */
  candidateKey: string;
  /** Ronda en la que apareció. */
  roundNumber: number;
  /** Posición original en la respuesta del proveedor (desempate estable). */
  providerRank: number;

  countryCompatible: boolean;
  /** Dominio presente, estructuralmente válido y no de plataforma/correo. */
  domainConfident: boolean;
  /** El dominio pertenece plausiblemente a la empresa nombrada. */
  ownershipConfident: boolean;
  /** Cuántas señales positivas del sector aparecieron en el texto libre. */
  sectorKeywordMatchCount: number;
  /** El candidato no se había visto en rondas anteriores ni en el historial. */
  novel: boolean;
  /** Apollo declaró número de empleados. */
  hasCompanySizeSignal: boolean;
  /** Apollo declaró ciudad o país. */
  hasLocationSignal: boolean;
  hasLinkedInUrl: boolean;
  /** Ninguna evidencia contradice el sector buscado. */
  freeOfContradictoryEvidence: boolean;

  sectorEvidenceState: CandidateSectorEvidenceState;
  /** Duplicado conocido (SellUp, HubSpot, ronda previa, sugerencia previa). */
  knownDuplicate: boolean;
  /** Cooldown activo sobre el dominio. */
  cooldownActive: boolean;
};

// ─── Pesos ────────────────────────────────────────────────────────────────────

/**
 * Pesos del ranking. Declarados como datos para que el orden sea auditable sin
 * leer la fórmula, y para que un cambio de criterio sea un cambio de tabla.
 *
 * La compatibilidad de país y la confianza en el dominio pesan más que el resto:
 * son las dos condiciones sin las cuales un enrichment no puede devolver algo
 * útil, por buenas que sean las demás señales.
 */
export const ENRICHMENT_RANKING_WEIGHTS = {
  countryCompatible: 30,
  domainConfident: 25,
  ownershipConfident: 20,
  freeOfContradictoryEvidence: 15,
  novel: 12,
  /** Por señal positiva encontrada, hasta `sectorKeywordMatchCap`. */
  sectorKeywordMatch: 4,
  sectorKeywordMatchCap: 12,
  hasLinkedInUrl: 6,
  hasCompanySizeSignal: 4,
  hasLocationSignal: 3,
} as const;

/** Puntaje de un candidato y las señales que lo produjeron. */
export type EnrichmentRankingScore = {
  candidateKey: string;
  score: number;
  contributingSignals: string[];
};

/**
 * Puntúa un candidato con señales gratuitas exclusivamente.
 *
 * No mira nada que requiera una llamada pagada: si hiciera falta pagar para
 * puntuar, el ranking no podría decidir a quién pagar.
 */
export function scoreCandidateForEnrichment(
  signals: FreeCandidateSignals,
): EnrichmentRankingScore {
  const w = ENRICHMENT_RANKING_WEIGHTS;
  const contributing: string[] = [];
  let score = 0;

  const add = (condition: boolean, weight: number, name: string): void => {
    if (!condition) return;
    score += weight;
    contributing.push(name);
  };

  add(signals.countryCompatible, w.countryCompatible, 'country_compatibility');
  add(signals.domainConfident, w.domainConfident, 'domain_confidence');
  add(signals.ownershipConfident, w.ownershipConfident, 'name_domain_ownership_confidence');
  add(
    signals.freeOfContradictoryEvidence,
    w.freeOfContradictoryEvidence,
    'absence_of_contradictory_evidence',
  );
  add(signals.novel, w.novel, 'novelty_confidence');
  add(signals.hasLinkedInUrl, w.hasLinkedInUrl, 'presence_of_linkedin_url');
  add(signals.hasCompanySizeSignal, w.hasCompanySizeSignal, 'company_size_signal');
  add(signals.hasLocationSignal, w.hasLocationSignal, 'location_signal');

  if (signals.sectorKeywordMatchCount > 0) {
    const keywordScore = Math.min(
      signals.sectorKeywordMatchCount * w.sectorKeywordMatch,
      w.sectorKeywordMatchCap,
    );
    score += keywordScore;
    contributing.push('sector_keyword_confidence');
  }

  return { candidateKey: signals.candidateKey, score, contributingSignals: contributing };
}

// ─── Selección bajo cap ───────────────────────────────────────────────────────

/** Por qué un candidato NO recibió enrichment. Cero llamadas, cero créditos. */
export type EnrichmentSkippedReason =
  | 'sector_evidence_already_confirmed'
  | 'sector_evidence_contradictory'
  | 'sector_not_mapped'
  | 'known_duplicate'
  | 'cooldown_active'
  | 'country_incompatible'
  | 'domain_not_confident'
  | 'target_already_reached'
  | 'enrichment_cap_reached'
  /**
   * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX § 4 — una operación anterior quedó
   * con cobro sin confirmar. Los enrichments restantes no se ejecutan: el
   * presupuesto real de la corrida ya no es conocido.
   */
  | 'prior_operation_indeterminate';

/** Por qué un candidato SÍ lo recibió. */
export type EnrichmentSelectionReason =
  'resolves_missing_sector_evidence_highest_free_signal_rank';

export type EnrichmentSelection = {
  candidateKey: string;
  roundNumber: number;
  score: number;
  selectionReason: EnrichmentSelectionReason;
  contributingSignals: string[];
};

export type EnrichmentSkip = {
  candidateKey: string;
  roundNumber: number;
  skippedReason: EnrichmentSkippedReason;
};

export type EnrichmentSelectionResult = {
  selected: EnrichmentSelection[];
  skipped: EnrichmentSkip[];
  /** Enrichments que quedan disponibles después de esta selección. */
  remainingEnrichmentBudget: number;
};

export type EnrichmentSelectionInput = {
  candidates: readonly FreeCandidateSignals[];
  /** Enrichments aún disponibles. Es GLOBAL para ambas rondas, no por ronda. */
  remainingEnrichmentBudget: number;
  /** Elegibles únicas ya acumuladas. Si ya llegan al objetivo, no se paga más. */
  eligibleCompaniesSoFar: number;
  targetEligibleCompanies: number;
};

/**
 * Motivo de exclusión inmediata, evaluado antes del ranking.
 *
 * El orden va del hecho más categórico al más contingente, de modo que el motivo
 * reportado sea siempre el más informativo de los que aplican: un duplicado
 * conocido es un duplicado con independencia de su país.
 */
function disqualify(
  candidate: FreeCandidateSignals,
): EnrichmentSkippedReason | null {
  if (candidate.knownDuplicate) return 'known_duplicate';
  if (candidate.cooldownActive) return 'cooldown_active';
  if (!candidate.countryCompatible) return 'country_incompatible';
  if (!candidate.domainConfident) return 'domain_not_confident';
  if (candidate.sectorEvidenceState === 'sector_evidence_contradictory') {
    return 'sector_evidence_contradictory';
  }
  if (candidate.sectorEvidenceState === 'sector_not_mapped') return 'sector_not_mapped';
  if (candidate.sectorEvidenceState === 'sector_evidence_confirmed') {
    // No es un rechazo del candidato: es un rechazo del GASTO. Ya sabemos que
    // pertenece al sector; comprar esa confirmación no resuelve ninguna duda.
    return 'sector_evidence_already_confirmed';
  }
  return null;
}

/**
 * Selecciona a lo sumo `remainingEnrichmentBudget` candidatos para enrichment.
 *
 * Garantías:
 *   - máximo un enrichment por organización (las claves son únicas por corrida);
 *   - nunca duplicados ni cooldown;
 *   - nunca sector contradictorio ni dominio incompatible;
 *   - cada enrichment resuelve una ambigüedad concreta (evidencia sectorial
 *     ausente);
 *   - si ya se alcanzó el objetivo, no se ejecuta ningún enrichment restante;
 *   - el cap es GLOBAL para ambas rondas.
 */
export function selectCandidatesForEnrichment(
  input: EnrichmentSelectionInput,
): EnrichmentSelectionResult {
  const { candidates, eligibleCompaniesSoFar, targetEligibleCompanies } = input;
  const budget = Math.max(0, Math.floor(input.remainingEnrichmentBudget));

  const skipped: EnrichmentSkip[] = [];

  // § 6: objetivo alcanzado ⇒ no se ejecutan los enrichments restantes.
  if (eligibleCompaniesSoFar >= targetEligibleCompanies) {
    for (const candidate of candidates) {
      skipped.push({
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        skippedReason: 'target_already_reached',
      });
    }
    return { selected: [], skipped, remainingEnrichmentBudget: budget };
  }

  const contenders: Array<{ candidate: FreeCandidateSignals; score: EnrichmentRankingScore }> = [];
  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    // Máximo un enrichment por organización: una segunda aparición de la misma
    // clave dentro de la misma selección es un duplicado, no un segundo cobro.
    if (seenKeys.has(candidate.candidateKey)) {
      skipped.push({
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        skippedReason: 'known_duplicate',
      });
      continue;
    }
    seenKeys.add(candidate.candidateKey);

    const reason = disqualify(candidate);
    if (reason !== null) {
      skipped.push({
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        skippedReason: reason,
      });
      continue;
    }
    contenders.push({ candidate, score: scoreCandidateForEnrichment(candidate) });
  }

  // Orden estable: puntaje descendente, luego ronda, luego posición original del
  // proveedor. Sin el desempate, dos candidatos empatados podrían alternar entre
  // ejecuciones y romper la idempotencia de un reintento.
  contenders.sort((a, b) => {
    if (b.score.score !== a.score.score) return b.score.score - a.score.score;
    if (a.candidate.roundNumber !== b.candidate.roundNumber) {
      return a.candidate.roundNumber - b.candidate.roundNumber;
    }
    if (a.candidate.providerRank !== b.candidate.providerRank) {
      return a.candidate.providerRank - b.candidate.providerRank;
    }
    return a.candidate.candidateKey.localeCompare(b.candidate.candidateKey);
  });

  const selected: EnrichmentSelection[] = [];
  for (const contender of contenders) {
    if (selected.length >= budget) {
      skipped.push({
        candidateKey: contender.candidate.candidateKey,
        roundNumber: contender.candidate.roundNumber,
        skippedReason: 'enrichment_cap_reached',
      });
      continue;
    }
    selected.push({
      candidateKey: contender.candidate.candidateKey,
      roundNumber: contender.candidate.roundNumber,
      score: contender.score.score,
      selectionReason: 'resolves_missing_sector_evidence_highest_free_signal_rank',
      contributingSignals: contender.score.contributingSignals,
    });
  }

  return {
    selected,
    skipped,
    remainingEnrichmentBudget: Math.max(0, budget - selected.length),
  };
}

// ─── Ranking final de persistencia (§ 9) ──────────────────────────────────────

/** Prioridades del § 9 para elegir qué elegibles se persisten bajo el tope. */
export const FINAL_RANKING_WEIGHTS = {
  sectorConfirmed: 40,
  countryConfirmed: 25,
  novelDomain: 20,
  strongOwnership: 15,
  usefulSizeOrLocationEvidence: 8,
  noPriorSuggestion: 10,
} as const;

export type FinalRankingSignals = FreeCandidateSignals & {
  /** El candidato no había sido sugerido antes en el mismo contexto. */
  noPriorSuggestion: boolean;
};

export function scoreCandidateForFinalRanking(
  signals: FinalRankingSignals,
): EnrichmentRankingScore {
  const w = FINAL_RANKING_WEIGHTS;
  const contributing: string[] = [];
  let score = 0;

  const add = (condition: boolean, weight: number, name: string): void => {
    if (!condition) return;
    score += weight;
    contributing.push(name);
  };

  add(
    signals.sectorEvidenceState === 'sector_evidence_confirmed',
    w.sectorConfirmed,
    'sector_confirmed',
  );
  add(signals.countryCompatible, w.countryConfirmed, 'country_confirmed');
  add(signals.novel, w.novelDomain, 'novel_domain');
  add(signals.ownershipConfident, w.strongOwnership, 'strong_ownership');
  add(
    signals.hasCompanySizeSignal || signals.hasLocationSignal,
    w.usefulSizeOrLocationEvidence,
    'useful_size_or_location_evidence',
  );
  add(signals.noPriorSuggestion, w.noPriorSuggestion, 'no_prior_suggestion');

  return { candidateKey: signals.candidateKey, score, contributingSignals: contributing };
}

export type FinalRankingResult = {
  /** Los mejores hasta el tope, en orden. */
  persisted: EnrichmentRankingScore[];
  /** Elegibles que no se persisten por el tope — sus métricas NO se pierden. */
  notPersisted: Array<EnrichmentRankingScore & { reason: 'eligible_not_persisted_due_to_target_cap' }>;
};

/**
 * Ordena las elegibles y conserva las mejores hasta el tope.
 *
 * Las que quedan fuera se devuelven con su puntaje: el § 9 exige que el exceso
 * quede registrado, no descartado en silencio — un lote que encontró siete
 * elegibles y persistió cinco es información de calidad del proveedor.
 */
export function rankFinalEligibleCompanies(
  candidates: readonly FinalRankingSignals[],
  targetCap: number,
): FinalRankingResult {
  const cap = Math.max(0, Math.floor(targetCap));
  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreCandidateForFinalRanking(candidate),
  }));

  scored.sort((a, b) => {
    if (b.score.score !== a.score.score) return b.score.score - a.score.score;
    if (a.candidate.roundNumber !== b.candidate.roundNumber) {
      return a.candidate.roundNumber - b.candidate.roundNumber;
    }
    if (a.candidate.providerRank !== b.candidate.providerRank) {
      return a.candidate.providerRank - b.candidate.providerRank;
    }
    return a.candidate.candidateKey.localeCompare(b.candidate.candidateKey);
  });

  return {
    persisted: scored.slice(0, cap).map((entry) => entry.score),
    notPersisted: scored.slice(cap).map((entry) => ({
      ...entry.score,
      reason: 'eligible_not_persisted_due_to_target_cap' as const,
    })),
  };
}
