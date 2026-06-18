/**
 * SIIS Colombia Connector — Public API
 *
 * Exports para el conector SIIS (Supersociedades).
 * Solo server-side.
 */

export { siisEnrichmentAdapter } from './siis-enrichment-adapter';
export { runSiisSnapshotEtl } from './siis-snapshot-etl';
export type { SiisSnapshotEtlResult } from './siis-snapshot-etl';
export * from './types';
export * from './siis-client';
