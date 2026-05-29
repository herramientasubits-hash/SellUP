/**
 * Socrata Colombia Connector — Public API
 *
 * Exports del conector. Solo server-side.
 * No importar desde Client Components.
 */

export { runSocrataColombiaSample } from './run-socrata-colombia-sample';
export { fetchSocrataDatasetSample } from './socrata-client';
export { SOCRATA_COLOMBIA_DATASETS, SOCRATA_COLOMBIA_DATASET_KEYS } from './datasets';
export type {
  ColombiaCompanySource,
  NormalizedColombiaCompanySample,
  SocrataColombiaSampleReport,
  SocrataSampleDatasetResult,
} from './types';

// Dry Run — Hito 16AB.6 (sin writes, sin candidatos, sin lotes)
export { runSocrataCandidateDryRun } from './run-socrata-candidate-dry-run';
export type {
  SocrataCandidateDryRunInput,
  SocrataCandidateDryRunItem,
  SocrataCandidateDryRunReport,
} from './run-socrata-candidate-dry-run';

// Candidate Writer Preview — Hito 16AB.9 (dryRun=false requiere autorización explícita)
export { writeStructuredSourceCandidatesPreview } from './structured-source-candidate-writer';
export type {
  StructuredSourceCandidateWriterInput,
  StructuredSourceCandidateWriterReport,
} from './structured-source-candidate-writer';
