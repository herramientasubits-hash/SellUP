/**
 * Q3F-5BB.11B — Pure provider-routing core (barrel).
 *
 * Pure module: no runtime wiring, no env, no provider calls, no DB. Exposes the
 * declarative registry, the pure resolver, and the plan contract types.
 */

export * from './types';
export {
  DEFAULT_PROVIDER_REGISTRY,
  getProviderDescriptor,
} from './provider-registry';
export {
  resolveProviderRoutingPlan,
  DEFAULT_MIN_USEFUL_CANDIDATES,
} from './resolve-provider-routing-plan';

// Q3F-5BB.11C — additive metadata contract (pure builders + merges).
export {
  PROVIDER_ROUTING_CONTRACT_VERSION,
  BATCH_PROVIDER_ROUTING_KEY,
  BATCH_PROVIDER_ATTEMPTS_KEY,
  CANDIDATE_SOURCE_PROVIDER_KEY,
  CANDIDATE_PROVIDER_TRACE_KEY,
  SOURCE_TRACE_PROVIDER_KEY,
  ProviderMetadataConsistencyError,
  buildProviderRoutingMetadata,
  buildProviderAttemptMetadata,
  buildCandidateProviderTraceMetadata,
  mergeProviderRoutingBatchMetadata,
  mergeCandidateProviderMetadata,
  resolveCandidateProviderConsistency,
} from './metadata-contract';
export type {
  ProviderRoutingContractVersion,
  ProviderRoutingEstimatedCostMetadata,
  ProviderRoutingMetadata,
  ProviderAttemptStatus,
  ProviderAttemptMetadata,
  CandidateCostAttributionMetadata,
  CandidateProviderTraceMetadata,
  ProviderRoutingMetadataContext,
  ProviderAttemptMetadataContext,
  ProviderTraceCandidateSource,
  CandidateProviderTraceContext,
  ProviderMetadataConsistencyCode,
  ProviderConsistencyResult,
  CandidateProviderMetadataInput,
  CandidateProviderMetadataResult,
} from './metadata-contract';
