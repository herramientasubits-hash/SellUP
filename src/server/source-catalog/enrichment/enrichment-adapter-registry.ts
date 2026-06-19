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
import { secop2ProveedoresEnrichmentAdapter } from '../connectors/secop2-proveedores-colombia/secop2-proveedores-enrichment-adapter';
import { personasJuridicasCCEnrichmentAdapter } from '../connectors/personas-juridicas-cc-colombia/personas-juridicas-cc-enrichment-adapter';
import { minsaludRepsEnrichmentAdapter } from '../connectors/minsalud-reps-colombia/minsalud-reps-enrichment-adapter';
import { superfinancieraEnrichmentAdapter } from '../connectors/superfinanciera-colombia/superfinanciera-enrichment-adapter';

export const ENRICHMENT_ADAPTER_REGISTRY: Record<string, SourceEnrichmentAdapter> = {
  co_siis: siisEnrichmentAdapter,
  co_secop2_proveedores: secop2ProveedoresEnrichmentAdapter,
  co_personas_juridicas_cc: personasJuridicasCCEnrichmentAdapter,
  co_minsalud_reps: minsaludRepsEnrichmentAdapter,
  co_superfinanciera: superfinancieraEnrichmentAdapter,
};
