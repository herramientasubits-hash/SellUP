/**
 * Source Catalog — Enrichment Types
 *
 * Contrato reutilizable para conectar fuentes validadas del catálogo
 * con el wizard de prospección para enriquecimiento post-discovery.
 *
 * Solo server-side. No importar en Client Components.
 */

// ─── Source capabilities taxonomy ─────────────────────────────────────────────

export type SourceCapability =
  | 'discovery_primary'          // Can find new companies proactively
  | 'discovery_secondary'        // Can suggest companies but not primary
  | 'enrichment_after_discovery' // Enriches already-found candidates
  | 'tax_id_validation'          // Validates NIT/RUC/RUT
  | 'financial_signals'          // Provides financial data signals
  | 'commercial_signals'         // Contract/procurement signals
  | 'prioritization'             // Can boost/rank candidates
  | 'manual_signal';             // Signal source, not automated

// ─── How the source integrates with the wizard ────────────────────────────────

export type WizardUsage =
  | 'discovery_primary'
  | 'post_discovery_enrichment'
  | 'validation_only'
  | 'manual_signal_only'
  | 'not_in_wizard';

// ─── What to do if source fails or has no data ────────────────────────────────

export type FallbackBehavior =
  | 'skip_without_blocking'  // Silently skip, wizard continues
  | 'warn_but_continue'      // Add warning, wizard continues
  | 'block_if_required';     // Block wizard (use sparingly)

// ─── Validated source config ──────────────────────────────────────────────────

/** Describes how a validated source participates in enrichment. */
export interface ValidatedSourceConfig {
  sourceKey: string;
  countryCodes: string[];
  capabilities: SourceCapability[];
  wizardUsage: WizardUsage;
  /** True = uses cached snapshot, not live */
  requiresSnapshot: boolean;
  /** True = can query live without snapshot */
  canRunLive: boolean;
  /** Key to look up in ENRICHMENT_ADAPTER_REGISTRY */
  adapterKey: string;
  fallbackBehavior: FallbackBehavior;
  /** Human-readable reason for this config */
  description: string;
}

// ─── Enrichment adapter input/output ─────────────────────────────────────────

/** Input to the enrichment adapter — one candidate at a time. */
export interface SourceEnrichmentInput {
  candidateName: string;
  candidateTaxId?: string | null;
  countryCode: string;
  sector?: string | null;
  existingMetadata?: Record<string, unknown>;
  capability: SourceCapability;
}

/** Output from the enrichment adapter. */
export interface SourceEnrichmentOutput {
  sourceKey: string;
  status: 'matched' | 'no_match' | 'skipped' | 'error';
  matchedBy: 'tax_id' | 'exact_name' | 'normalized_name' | null;
  /** 0.0 to 1.0 */
  confidence: number;
  sourceYear?: number | null;
  /** 0 = no boost, positive = boost */
  priorityBoost?: number;
  signals?: Record<string, unknown>;
  financials?: Record<string, unknown>;
  /** Why skipped/error */
  reason?: string;
  metadata?: Record<string, unknown>;
}

// ─── Adapter contract ─────────────────────────────────────────────────────────

/** Each validated source implements this interface. */
export interface SourceEnrichmentAdapter {
  sourceKey: string;
  supportedCapabilities: SourceCapability[];
  enrichCandidate(input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput>;
  getSnapshotStatus?(): Promise<{
    available: boolean;
    year?: number;
    recordCount?: number;
    lastImportedAt?: string;
  }>;
  getHealthStatus?(): Promise<{ healthy: boolean; message?: string }>;
}

// ─── Multi-source enrichment (wizard hook) ────────────────────────────────────

export interface EnrichCandidatesInput {
  candidates: Array<{
    name: string;
    taxId?: string | null;
    countryCode: string;
    sector?: string | null;
    existingMetadata?: Record<string, unknown>;
  }>;
  countryCode: string;
  stage: 'post_discovery_enrichment' | 'prioritization';
}

export interface EnrichedCandidateResult {
  candidateIndex: number;
  candidateName: string;
  /** Keyed by sourceKey */
  sourceEnrichments: Record<string, SourceEnrichmentOutput>;
  /** Sum of all priority boosts */
  priorityBoostTotal: number;
  /** For metadata.source_enrichment */
  enrichmentMetadata: Record<string, unknown>;
}

export interface EnrichCandidatesOutput {
  results: EnrichedCandidateResult[];
  sourcesApplied: string[];
  sourcesSkipped: string[];
  warnings: string[];
  errors: string[];
}
