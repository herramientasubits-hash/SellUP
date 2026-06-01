/**
 * ChileCompra Connector — Public API
 *
 * Exports del conector ChileCompra / Mercado Público Chile. Solo server-side.
 * No importar desde Client Components.
 */

export {
  testChileCompraConnection,
  listChileCompraBuyers,
  searchChileCompraSupplierByRut,
  fetchChileCompraPurchaseOrdersBySupplier,
  fetchChileCompraTendersBySupplier,
  fetchCompraAgilList,
  fetchCompraAgilDetail,
  buildTicketInstructions,
  formatChileRut,
  CHILECOMPRA_BUSCAR_COMPRADOR,
  CHILECOMPRA_BUSCAR_PROVEEDOR,
  CHILECOMPRA_LICITACIONES,
  CHILECOMPRA_ORDENES,
  CHILECOMPRA_V2_BASE,
  CHILECOMPRA_V2_COMPRA_AGIL,
} from './chilecompra-client';

export type {
  ChileCompraConnectionTestResult,
  ListChileCompraBuyersResult,
  SearchChileCompraSupplierResult,
  FetchChileCompraPurchaseOrdersResult,
  FetchChileCompraTendersResult,
  CompraAgilListItem,
  CompraAgilProveedor,
  CompraAgilDetail,
  FetchCompraAgilListResult,
  FetchCompraAgilDetailResult,
} from './chilecompra-client';

export { normalizeChileCompraRecord, ICP_KEYWORDS } from './normalizers';

export { mapChileCompraSampleToStructuredCandidate } from './candidate-mapper';

export { runChileCompraDryRun } from './run-chilecompra-dry-run';

export type {
  ChileCompraRawRecord,
  NormalizedChileCompraSupplier,
  ChileCompraReviewFlag,
  ChileCompraQualityDecision,
  ChileCompraDryRunMode,
  RunChileCompraDryRunInput,
  RunChileCompraDryRunReport,
  ChileCompraEndpointStatus,
  SupplierLookupResult,
  CompraAgilDiscoveryItem,
} from './types';
