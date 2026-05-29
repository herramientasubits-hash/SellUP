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
