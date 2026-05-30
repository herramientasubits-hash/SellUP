/**
 * DENUE Mexico Connector — Public API
 *
 * Exports del conector. Solo server-side.
 * No importar desde Client Components.
 */

export { fetchDenueDatasetSample } from './denue-client';
export type { FetchDenueParams, FetchDenueResult } from './denue-client';

export { normalizeDenueRecord, deriveSizeFlagFromPerOcu } from './normalizers';

export { mapDenueSampleToStructuredCandidate } from './candidate-mapper';

export { runDenueCandidateDryRun } from './run-denue-candidate-dry-run';
export type {
  DenueCandidateDryRunItem,
  DenueCandidateDryRunReport,
} from './run-denue-candidate-dry-run';

export type {
  MexicoCompanySource,
  DenueEstablishmentRaw,
  NormalizedMexicoCompanySample,
  DenueDatasetResult,
  DenueMexicoSampleReport,
  DenueCandidateDryRunInput,
} from './types';
