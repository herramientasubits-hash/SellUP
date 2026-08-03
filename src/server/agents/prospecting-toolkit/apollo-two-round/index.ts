/**
 * Barrel de la modalidad Apollo de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1.
 *
 * Todo lo que se exporta aquí es PURO o por inyección de dependencias: ningún
 * módulo del paquete llama a Apollo, lee `process.env`, toca Supabase ni mira el
 * reloj. El único lector de entorno del hito es
 * `resolveApolloTwoRoundConfigFromEnv`, que vive en el wrapper server-only.
 */

export {
  TARGET_ELIGIBLE_COMPANIES_DEFAULT,
  MAX_SEARCH_ROUNDS_DEFAULT,
  MAX_RESULTS_PER_ROUND_DEFAULT,
  MAX_RAW_RESULTS_PER_RUN_DEFAULT,
  MAX_ENRICHMENTS_PER_RUN_DEFAULT,
  TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
  MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX,
  MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX,
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
  APOLLO_TWO_ROUND_ENV_KEYS,
  parseApolloTwoRoundInt,
  resolveApolloTwoRoundConfig,
  defaultApolloTwoRoundConfig,
  toApolloTwoRoundConfigDiagnostics,
  type ApolloTwoRoundDiscoveryConfig,
  type ApolloTwoRoundConfigResolution,
  type ApolloTwoRoundConfigSource,
  type ApolloTwoRoundConfigDiagnostics,
  type ApolloTwoRoundRawEnv,
} from './config';

export {
  normalizeOrganizationDomain,
  normalizeLinkedInCompanyUrl,
  normalizeCanonicalCompanyName,
  normalizeOrganizationIdentity,
  createSeenOrganizationRegistry,
  evaluateSeenOrganization,
  registerSeenOrganization,
  countSeenOrganizations,
  toSeenRegistrySnapshot,
  type SeenOrganizationRegistry,
  type NormalizedOrganizationIdentity,
  type OrganizationIdentityInput,
  type SeenMatchReason,
  type SeenVerdict,
} from './seen-registry';

export {
  resolveSectorSignalSet,
  buildRound1Hypothesis,
  buildRound2Hypothesis,
  isContradictoryIndustry,
  toQueryHypothesisMetadata,
  type SectorSignalSet,
  type ApolloTwoRoundQueryContext,
  type ApolloTwoRoundQueryHypothesis,
  type ApolloTwoRoundQueryParameters,
  type Round1Feedback,
} from './query-hypothesis';

export {
  ENRICHMENT_RANKING_WEIGHTS,
  FINAL_RANKING_WEIGHTS,
  scoreCandidateForEnrichment,
  selectCandidatesForEnrichment,
  scoreCandidateForFinalRanking,
  rankFinalEligibleCompanies,
  type CandidateSectorEvidenceState,
  type FreeCandidateSignals,
  type FinalRankingSignals,
  type EnrichmentRankingScore,
  type EnrichmentSelection,
  type EnrichmentSelectionResult,
  type EnrichmentSelectionReason,
  type EnrichmentSkip,
  type EnrichmentSkippedReason,
  type FinalRankingResult,
} from './enrichment-ranking';

export {
  BUDGET_EXCEEDED_TWO_ROUND_APOLLO,
  estimateApolloTwoRoundBudget,
  evaluateApolloTwoRoundBudgetPreflight,
  buildApolloTwoRoundSpendAccounting,
  toApolloTwoRoundBudgetMetadata,
  type ApolloTwoRoundBudgetBreakdown,
  type ApolloTwoRoundBudgetPreflight,
  type ApolloTwoRoundBudgetPreflightInput,
  type ApolloTwoRoundSpendAccounting,
} from './budget';

export {
  APOLLO_TWO_ROUND_OBSERVABILITY_KEY,
  buildEmptyRoundMetrics,
  buildRunMetrics,
  countEnrichmentWaste,
  toRoundMetricsMetadata,
  toRunMetricsMetadata,
  type ApolloTwoRoundRoundMetrics,
  type ApolloTwoRoundRunMetrics,
  type EnrichmentOutcome,
} from './observability';

export {
  buildApolloTwoRoundOperationKey,
  toOperationCorrelationMetadata,
  ApolloTwoRoundOperationLedger,
  type ApolloTwoRoundRunCorrelation,
  type ApolloTwoRoundOperation,
  type ApolloTwoRoundOperationKeyInput,
  type ApolloTwoRoundOperationCorrelation,
} from './idempotency';

export {
  APOLLO_TWO_ROUND_RUN_STATE_KEY,
  APOLLO_TWO_ROUND_RUN_STATE_VERSION,
  serializeRunState,
  deserializeRunState,
  type ApolloTwoRoundPersistedRunState,
  type RestoredRunState,
  type SerializeRunStateInput,
} from './run-state';

export {
  runApolloTwoRoundDiscovery,
  toApolloTwoRoundResumeState,
  type ApolloTwoRoundResumeState,
  type ResumedCandidate,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundRunInput,
  type ApolloTwoRoundRunResult,
  type ApolloTwoRoundResultStatus,
  type AccumulatedCompany,
  type CheapAssessment,
  type CheapRejectionReason,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
  type RoundSearchOutcome,
  type SecondRoundSkippedReason,
} from './orchestrator';
