/**
 * Source Catalog — Enrichment Adapter Registry
 *
 * Mapa de adapterKey → SourceEnrichmentAdapter.
 * Agregar nuevos adaptadores aquí cuando se implementen.
 *
 * Solo server-side. No importar en Client Components.
 */

import type { SourceEnrichmentAdapter } from './types';
import { siisEnrichmentAdapter } from '../connectors/siis-colombia/siis-enrichment-adapter';

export const ENRICHMENT_ADAPTER_REGISTRY: Record<string, SourceEnrichmentAdapter> = {
  co_siis: siisEnrichmentAdapter,
};
