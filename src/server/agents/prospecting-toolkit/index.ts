/**
 * Prospecting Toolkit — Punto de entrada público.
 *
 * Exporta solo la API pública del toolkit.
 * Los helpers internos de normalización y los checkers individuales
 * quedan encapsulados; importar desde aquí es el contrato estable.
 */

// Tipos públicos
export type {
  DuplicateStatus,
  DuplicateCheckInput,
  DuplicateMatch,
  DuplicateCheckResult,
} from './types';

// Normalización — útil para quienes necesiten pre-normalizar antes de llamar al orquestador
export {
  normalizeCompanyName,
  normalizeDomain,
  extractDomainFromWebsite,
  normalizeTaxIdentifier,
  buildCompanySearchTerms,
} from './normalization';

// Orquestador principal
export { checkCompanyDuplicate } from './duplicate-checker';

// Checkers individuales (acceso directo cuando se necesita solo uno)
export { checkSellUpDuplicates } from './sellup-duplicate-checker';
export { checkHubSpotDuplicates } from './hubspot-duplicate-checker';

// Catalog Context Retriever — Hito 2
export type {
  SearchDepth,
  SourcePriority,
  CatalogSource,
  CatalogContextInput,
  CatalogContextResult,
} from './types';
export { getCatalogContext } from './catalog-context-retriever';

// Web Search Tool — Hito 3A (query builder + noise filter: Hito 7C, multi-query: Hito 12B)
export type {
  WebSearchProviderKey,
  WebSearchIntent,
  WebSearchInput,
  WebSearchResult,
  WebSearchOutput,
  MultiQuerySearchInput,
  MultiQueryQueryResult,
  MultiQuerySearchResultEntry,
  MultiQueryWebSearchOutput,
} from './types';
export {
  runWebSearch,
  runMultiQueryWebSearch,
  buildCompanyDiscoveryQuery,
  buildSectorSpecificSearchTerms,
  buildNoiseExclusionTerms,
  buildCleanMultiQueryDiscoveryQueries,
} from './web-search-tool';
export type { CompanyDiscoveryQueryOptions } from './web-search-tool';

// Noise Filter — Hito 7C
export type {
  WebSearchResultType,
  NoiseClassification,
  FilteredSearchResults,
} from './noise-filter';
export { classifySearchResult, filterNoiseResults } from './noise-filter';

// Website Verifier — Hito 3B
export type {
  WebsiteVerificationStatus,
  WebsiteVerificationInput,
  WebsiteVerificationOutput,
} from './types';
export { verifyWebsite, scoreCompanyNameAgainstPage } from './website-verifier';

// Candidate Scorer — Hito 3C
export type {
  CandidateQualityLabel,
  CandidateRecommendedAction,
  CandidateScoringInput,
  CandidateScoreBreakdown,
  CandidateScoringOutput,
} from './types';
export { scoreCandidate } from './candidate-scorer';

// Prospecting Pipeline — Hito 4
export type {
  ProspectingPipelineInput,
  ProspectingPipelineCandidate,
  ProspectingPipelineSummary,
  ProspectingPipelineOutput,
} from './types';
export { runProspectingPipeline } from './prospecting-pipeline';

// Candidate Writer — Hito 5
export type {
  CandidateWriterSource,
  CandidateWriterStatus,
  CandidateWriterInput,
  CandidateWriterSkipped,
  CandidateWriterOutput,
  ProspectingPipelineWriteOutput,
} from './types';
export {
  writeProspectingCandidates,
  runAndWriteProspectingPipeline,
} from './candidate-writer';

// LLM Evaluator — Hito 16H
export type {
  LLMEvaluatorDecision,
  LLMEvaluatorRawInput,
  LLMEvaluatorInput,
  LLMEvaluatorResult,
  LLMEvaluatorUsage,
  LLMEvaluatorOutput,
  LLMEvaluationMetadata,
  LLMEvaluatorThresholds,
} from './llm-evaluator-types';
export {
  DEFAULT_LLM_EVALUATOR_THRESHOLDS,
  KNOWN_MODEL_PRICING,
} from './llm-evaluator-types';
export {
  LLMEvaluatorNotConfiguredError,
  LLMEvaluatorParseError,
  evaluateTavilyResultsWithLLM,
  buildLLMEvaluationMetadata,
  estimateLLMCost,
  deduplicateEvaluatedResults,
  applyThresholds,
  selectTopEvaluatedCandidates,
} from './llm-evaluator';
