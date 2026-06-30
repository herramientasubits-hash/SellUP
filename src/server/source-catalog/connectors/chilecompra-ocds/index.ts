/**
 * ChileCompra / Mercado Público OCDS Connector — Public API
 *
 * Fuente abierta OCDS (sin auth). Solo server-side. No importar desde Client Components.
 * Separado del connector legacy `chilecompra-chile` (ticket/Clave Única, bloqueado).
 */

export {
  OCDS_BASE,
  OCDS_SERVER_MAX_LIMIT,
  buildListadoUrl,
  buildTenderUrl,
  fetchOcdsListado,
  fetchOcdsTender,
  extractTotal,
  extractListItems,
  extractRelease,
} from './chilecompra-ocds-client';
export type {
  FetchListadoResult,
  FetchTenderResult,
  ListadoErrorKind,
} from './chilecompra-ocds-client';

export {
  normalizeOcdsRelease,
  normalizeRut,
  resolveBuyer,
  resolveAward,
  collectUnspsc,
} from './normalizers';

export { runChileCompraOcdsHealthCheck } from './run-chilecompra-ocds-health-check';
export { runChileCompraOcdsDryRun } from './run-chilecompra-ocds-dry-run';

export type {
  OcdsRelease,
  OcdsParty,
  OcdsAward,
  ChileCompraOcdsListItem,
  NormalizedOcdsProcess,
  ChileCompraOcdsHealthCheckInput,
  ChileCompraOcdsHealthCheckReport,
  ChileCompraOcdsDryRunInput,
  ChileCompraOcdsDryRunReport,
  ChileCompraOcdsDryRunSummary,
} from './types';
