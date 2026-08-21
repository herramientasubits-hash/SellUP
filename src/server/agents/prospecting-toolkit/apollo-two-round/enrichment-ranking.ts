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
  | 'sector_not_mapped'
  /**
   * SECTOR-EVIDENCE-BOOTSTRAP-1 — no hay política de sector Y el proveedor no
   * declaró clasificación alguna, y la corrida está autorizada a adquirirla.
   *
   * Compite por un enrichment igual que `sector_evidence_missing_needs_enrichment`
   * y, como él, NO confirma nada y NO cuenta para el objetivo: `isEligible` exige
   * `sector_evidence_confirmed` y este estado no lo es.
   */
  | 'sector_evidence_missing_bootstrap_eligible';

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
  /**
   * QUERY-QUALITY-2 § 7 — la INDUSTRIA DECLARADA contradice la subindustria
   * buscada, y ninguna señal positiva la desmiente.
   *
   * Se lee sólo de campos declarados (`industry`, `industries[]`), nunca de la
   * descripción: un supermercado con crédito de consumo la menciona sin ser un
   * banco. Es la señal que impide repetir el crédito gastado en Citigroup en una
   * búsqueda de supermercados.
   *
   * Opcional: un checkpoint escrito antes de este hito no la trae, y su ausencia
   * significa «no se observó contradicción», no «hay contradicción».
   */
  declaredSectorContradiction?: boolean;
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
    // § 7 — la contradicción declarada anula el premio por «sin evidencia en
    // contra»: la evidencia en contra existe y es gratuita.
    signals.freeOfContradictoryEvidence && signals.declaredSectorContradiction !== true,
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
  | 'resolves_missing_sector_evidence_highest_free_signal_rank'
  /**
   * AGENT1-APOLLO-FINALIZATION-HARDENING-1 § B/C — el sector ya está confirmado
   * GRATIS, pero a la empresa todavía le falta `employee_count` o LinkedIn —
   * ambos resolubles por `organization_enrichment` — y por eso compite igual que
   * cualquier otra candidata. Antes de este hito, `sector_evidence_confirmed`
   * descalificaba sin mirar qué le faltaba: la corrida `bdc51c49` confirmó a
   * Surtifamiliar y La Canasta por nombre comercial y las dejó con
   * `employee_count = NULL` para siempre, porque nunca competían por un
   * enrichment que sí podía resolverlo.
   */
  | 'resolves_missing_required_field_highest_free_signal_rank';

export type EnrichmentSelection = {
  candidateKey: string;
  roundNumber: number;
  score: number;
  selectionReason: EnrichmentSelectionReason;
  contributingSignals: string[];
  /** § C — campos obligatorios que este enrichment intenta resolver. */
  enrichmentReasons: ApolloEnrichmentReason[];
  /** § C — lo que faltaba ANTES de gastar. El desenlace lo registra quien recibe la respuesta. */
  missingBefore: ApolloResolvableEvidenceField[];
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

// ─── AGENT1-APOLLO-FINALIZATION-HARDENING-1 § B — necesidad real de enrichment ──

/**
 * § B — campo obligatorio para `complete_valid` (contrato en
 * `candidate-completeness-contract.ts`) que `organization_enrichment` puede
 * resolver. `sector_evidence` no es un campo de esa lista — es una PRECONDICIÓN
 * para competir siquiera —, pero se modela igual porque comparte el mismo
 * mecanismo: falta, y Apollo puede llenarla.
 */
export type ApolloResolvableEvidenceField =
  | 'sector_evidence'
  | 'employee_count'
  | 'linkedin_url';

/** Motivo por el que ESTE campo, si se resuelve, justifica el enrichment. */
export type ApolloEnrichmentReason =
  | 'resolves_missing_sector_evidence'
  | 'resolves_missing_employee_count'
  | 'resolves_missing_linkedin_url';

/**
 * § B — evaluación canónica de si un candidato debe competir por un enrichment.
 *
 * Sustituye a la pregunta única "¿el sector está confirmado?" por la pregunta
 * real: "¿queda algo OBLIGATORIO por resolver, y Apollo puede resolverlo?". Un
 * candidato con sector confirmado y `employee_count` ausente sigue teniendo una
 * razón real para gastar un enrichment — la que `disqualify()` ignoraba antes
 * de este hito.
 */
export type ApolloEnrichmentNeedEvaluation = {
  /** Campos obligatorios que este candidato NO tiene todavía. */
  missingRequiredEvidence: ApolloResolvableEvidenceField[];
  /** Subconjunto de los anteriores que `organization_enrichment` puede llenar. */
  providerResolvableEvidence: ApolloResolvableEvidenceField[];
  /** Por qué gastar, uno por campo resoluble pendiente. Vacío ⇒ no hay por qué. */
  enrichmentReasons: ApolloEnrichmentReason[];
  /**
   * Si resolver lo pendiente puede hacer que este candidato cuente hacia el
   * objetivo. `no_target_value` cuando no queda nada resoluble que comprar, o
   * cuando un descalificador categórico (duplicado, país, dominio, contradicción)
   * ya decidió que ningún enrichment ayuda.
   */
  expectedTargetValue: 'contributes_to_target' | 'no_target_value';
  eligibleForEnrichment: boolean;
  /** Motivo de exclusión cuando `eligibleForEnrichment` es `false`. */
  disqualifiedReason: EnrichmentSkippedReason | null;
};

const REASON_BY_FIELD: Record<ApolloResolvableEvidenceField, ApolloEnrichmentReason> = {
  sector_evidence: 'resolves_missing_sector_evidence',
  employee_count: 'resolves_missing_employee_count',
  linkedin_url: 'resolves_missing_linkedin_url',
};

/**
 * § B — evalúa la necesidad real de enrichment de UN candidato.
 *
 * Puro: sólo lee señales gratuitas. No decide CUÁNTO enrichment hay presupuesto
 * para comprar — eso lo decide `selectCandidatesForEnrichment` bajo el cap.
 */
export function evaluateApolloEnrichmentNeed(
  candidate: FreeCandidateSignals,
): ApolloEnrichmentNeedEvaluation {
  const disqualifyCategorically = (): EnrichmentSkippedReason | null => {
    if (candidate.knownDuplicate) return 'known_duplicate';
    if (candidate.cooldownActive) return 'cooldown_active';
    if (!candidate.countryCompatible) return 'country_incompatible';
    if (!candidate.domainConfident) return 'domain_not_confident';
    // § 7 — una contradicción VISIBLE en campos gratuitos impide el enrichment,
    // aunque el veredicto sectorial todavía diga «falta evidencia». Comprar la
    // descripción de un banco no lo convierte en supermercado.
    if (candidate.declaredSectorContradiction === true) return 'sector_evidence_contradictory';
    if (candidate.sectorEvidenceState === 'sector_evidence_contradictory') {
      return 'sector_evidence_contradictory';
    }
    if (candidate.sectorEvidenceState === 'sector_not_mapped') return 'sector_not_mapped';
    return null;
  };

  const categoricalReason = disqualifyCategorically();
  if (categoricalReason !== null) {
    return {
      missingRequiredEvidence: [],
      providerResolvableEvidence: [],
      enrichmentReasons: [],
      expectedTargetValue: 'no_target_value',
      eligibleForEnrichment: false,
      disqualifiedReason: categoricalReason,
    };
  }

  const missing: ApolloResolvableEvidenceField[] = [];
  if (
    candidate.sectorEvidenceState === 'sector_evidence_missing_needs_enrichment' ||
    // SECTOR-EVIDENCE-BOOTSTRAP-1 — la evidencia sectorial falta igual, y el
    // proveedor puede resolverla igual. La diferencia entre los dos estados no es
    // qué falta, sino si existía política para juzgarlo antes de preguntar.
    candidate.sectorEvidenceState === 'sector_evidence_missing_bootstrap_eligible'
  ) {
    missing.push('sector_evidence');
  }
  if (!candidate.hasCompanySizeSignal) missing.push('employee_count');
  if (!candidate.hasLinkedInUrl) missing.push('linkedin_url');

  // Todo lo que falta en esta lista es, hoy, resoluble por organization_enrichment.
  const resolvable = [...missing];

  if (resolvable.length === 0) {
    // Sector confirmado (o no aplicable) y ambos campos ya presentes: no hay
    // nada que comprar. Es el caso original — «ya sabemos que pertenece al
    // sector, comprar esa confirmación no resuelve ninguna duda» — generalizado
    // a cualquier campo obligatorio, no sólo al sectorial.
    return {
      missingRequiredEvidence: [],
      providerResolvableEvidence: [],
      enrichmentReasons: [],
      expectedTargetValue: 'no_target_value',
      eligibleForEnrichment: false,
      disqualifiedReason: 'sector_evidence_already_confirmed',
    };
  }

  return {
    missingRequiredEvidence: missing,
    providerResolvableEvidence: resolvable,
    enrichmentReasons: resolvable.map((field) => REASON_BY_FIELD[field]),
    expectedTargetValue: 'contributes_to_target',
    eligibleForEnrichment: true,
    disqualifiedReason: null,
  };
}


/**
 * SECTOR-EVIDENCE-BOOTSTRAP-1 § 7 — desempate declarado entre estados que compiten.
 *
 * Menor gana. Sólo se consulta con puntajes EMPATADOS, así que nunca desplaza a
 * un candidato con mejores señales gratuitas: describe una preferencia, no un peso.
 */
function sectorEvidenceStateSelectionRank(state: CandidateSectorEvidenceState): number {
  return state === 'sector_evidence_missing_bootstrap_eligible' ? 1 : 0;
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

  const contenders: Array<{
    candidate: FreeCandidateSignals;
    score: EnrichmentRankingScore;
    need: ApolloEnrichmentNeedEvaluation;
  }> = [];
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

    const need = evaluateApolloEnrichmentNeed(candidate);
    if (!need.eligibleForEnrichment) {
      skipped.push({
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        skippedReason: need.disqualifiedReason ?? 'sector_evidence_already_confirmed',
      });
      continue;
    }
    contenders.push({ candidate, score: scoreCandidateForEnrichment(candidate), need });
  }

  // Orden estable: puntaje descendente, luego ronda, luego posición original del
  // proveedor. Sin el desempate, dos candidatos empatados podrían alternar entre
  // ejecuciones y romper la idempotencia de un reintento.
  //
  // SECTOR-EVIDENCE-BOOTSTRAP-1 — entre puntajes IGUALES, una duda que sí se pudo
  // medir se resuelve antes que una que ni siquiera tenía política con que
  // medirse. No mueve nada en las corridas existentes: una corrida tiene un solo
  // sector, así que o todos sus candidatos tienen política o ninguno la tiene, y
  // con un único rango el orden es byte-idéntico al anterior.
  contenders.sort((a, b) => {
    if (b.score.score !== a.score.score) return b.score.score - a.score.score;
    const stateRankA = sectorEvidenceStateSelectionRank(a.candidate.sectorEvidenceState);
    const stateRankB = sectorEvidenceStateSelectionRank(b.candidate.sectorEvidenceState);
    if (stateRankA !== stateRankB) return stateRankA - stateRankB;
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
    // § B — el nombre de la razón distingue "resuelve el sector" (el caso
    // original) de "resuelve un campo obligatorio con el sector ya confirmado"
    // (lo que este hito habilita). Un candidato puede necesitar ambos a la vez;
    // el nombre reporta el motivo PRINCIPAL, y `enrichmentReasons` lleva la
    // lista completa para quien necesite el detalle.
    const selectionReason: EnrichmentSelectionReason =
      contender.need.missingRequiredEvidence.includes('sector_evidence')
        ? 'resolves_missing_sector_evidence_highest_free_signal_rank'
        : 'resolves_missing_required_field_highest_free_signal_rank';
    selected.push({
      candidateKey: contender.candidate.candidateKey,
      roundNumber: contender.candidate.roundNumber,
      score: contender.score.score,
      selectionReason,
      contributingSignals: contender.score.contributingSignals,
      enrichmentReasons: contender.need.enrichmentReasons,
      missingBefore: contender.need.missingRequiredEvidence,
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
