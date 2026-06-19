/**
 * SIIS Colombia Connector — Public API
 *
 * Exports para el conector SIIS (Supersociedades).
 * Solo server-side.
 */

export { siisEnrichmentAdapter, buildSiisMatchResult } from './siis-enrichment-adapter';
export { runSiisSnapshotEtl, parseExcelRows, mapRowToRecord, parseSiisFinancialValue, normalizeSiisNIT, normalizeSiisLegalName } from './siis-snapshot-etl';
export type { SiisSnapshotEtlResult } from './siis-snapshot-etl';
export * from './types';
export * from './siis-client';
