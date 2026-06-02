/**
 * Source Discovery — Common Types (Hito 16AJ.2)
 *
 * Tipos canónicos para ejecutar discovery sobre fuentes estructuradas.
 * Agnósticos del conector — cada adapter produce SourceDiscoveryOutput.
 *
 * NO escribe en Supabase. NO crea prospect_batches. NO crea prospect_candidates.
 * NO toca HubSpot. NO toca Tavily. Solo lectura.
 */

/** Modo de ejecución del discovery. */
export type SourceDiscoveryMode = 'dry_run' | 'preview';

/** Criterios de búsqueda genéricos. Cada conector los interpreta según su API. */
export interface SourceDiscoveryCriteria {
  country?: string;
  countryCode?: string;
  region?: string | null;
  city?: string | null;
  industry?: string | null;
  sector?: string | null;
  keywords?: string[];
  filters?: Record<string, unknown>;
}

/** Input del discovery — fuente + criterios + opciones. */
export interface SourceDiscoveryInput {
  sourceKey: string;
  countryCode: string;
  criteria?: SourceDiscoveryCriteria;
  limit?: number;
  offset?: number;
  mode?: SourceDiscoveryMode;
}

/** Candidato normalizado — representación homogénea independiente del conector. */
export interface SourceDiscoveryCandidate {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  taxIdentifierType?: string | null;
  country?: string | null;
  countryCode?: string | null;
  city?: string | null;
  region?: string | null;
  sectorCode?: string | null;
  sectorDescription?: string | null;
  sourcePrimary: string;
  sourceTrace?: unknown;
  metadata?: Record<string, unknown>;
  reviewFlags?: string[];
  qualityDecision?: string;
}

/** Output del discovery — resultado homogéneo independiente del conector. */
export interface SourceDiscoveryOutput {
  sourceKey: string;
  sourceProvider: string;
  countryCode: string;
  mode: SourceDiscoveryMode;
  recordsRead: number;
  candidates: SourceDiscoveryCandidate[];
  acceptedCount: number;
  lowPriorityCount: number;
  filteredOutCount: number;
  warnings: string[];
  errors: string[];
  qualitySummary: {
    withTaxId: number;
    withSector: number;
    sectorUnknown: number;
    withRegion: number;
    withWebsite: number;
  };
}

/** Adapter contract: cada fuente implementa esta firma. */
export type SourceDiscoveryAdapter = (
  input: SourceDiscoveryInput,
) => Promise<SourceDiscoveryOutput>;
