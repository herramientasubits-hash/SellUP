/**
 * Q3F-5BB.10B1 — Provider-agnostic Agent 1 intake layer (public surface).
 *
 * Pure contracts + adapters + normalization. Nothing here is wired into the live
 * pipeline yet; this barrel only re-exports the shared types and pure functions
 * so the next slice (10B2 shared mandatory gate) can build on a single import.
 */

export type {
  ProspectIntakeProvider,
  IntakeIndustryCodes,
  ProspectSearchCriteria,
  ProviderDiscoveredCompany,
  IntakeNormalizationWarning,
  IntakeNormalizationIssue,
  IntakeTrace,
  NormalizedProspectCandidate,
  ProviderAdapterContext,
} from './types';

export { normalizeProviderDiscoveredCompany } from './normalize';

export {
  mapLushaCompanyToProviderDiscoveredCompany,
  type LushaRawCompany,
} from './adapters/lusha';
export {
  mapApolloCompanyToProviderDiscoveredCompany,
  type ApolloRawOrganization,
} from './adapters/apollo';
export {
  mapWebAiCompanyToProviderDiscoveredCompany,
  type WebAiRawCompany,
  type WebAiAdapterContext,
} from './adapters/tavily';
