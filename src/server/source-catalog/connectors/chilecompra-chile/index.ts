/**
 * ChileCompra Connector — Public API
 *
 * Exports del conector ChileCompra / Mercado Público Chile. Solo server-side.
 * No importar desde Client Components.
 */

export {
  fetchChileCompraProviders,
  buildTicketInstructions,
  CHILECOMPRA_OCDS_ENDPOINT,
  CHILECOMPRA_API_ENDPOINT,
} from './chilecompra-client';
export type { FetchChileCompraParams, FetchChileCompraResult } from './chilecompra-client';

export { normalizeChileCompraRecord, ICP_KEYWORDS } from './normalizers';

export { mapChileCompraSampleToStructuredCandidate } from './candidate-mapper';

export { runChileCompraDryRun } from './run-chilecompra-dry-run';

export type {
  ChileCompraRawRecord,
  NormalizedChileCompraSupplier,
  ChileCompraReviewFlag,
  ChileCompraQualityDecision,
  RunChileCompraDryRunInput,
  RunChileCompraDryRunReport,
  ChileCompraEndpointStatus,
} from './types';
