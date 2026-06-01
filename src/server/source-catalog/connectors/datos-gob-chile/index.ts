/**
 * Chile RES Connector — Public API
 *
 * Exports del conector datos.gob.cl / RES Chile. Solo server-side.
 * No importar desde Client Components.
 */

export { fetchClResRecords, RES_RESOURCE_ID_2025, RES_DATASET_ID } from './cl-res-client';
export type { FetchClResParams, FetchClResResult } from './cl-res-client';

export { normalizeResChileRecord } from './normalizers';

export { mapResChileSampleToStructuredCandidate } from './candidate-mapper';

export { runClResDryRun } from './run-cl-res-dry-run';

export type {
  ResChileRawRecord,
  NormalizedChileCompanySample,
  ResChileReviewFlag,
  ResChileQualityDecision,
  RunClResDryRunInput,
  RunClResDryRunReport,
} from './types';
