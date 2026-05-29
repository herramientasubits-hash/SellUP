/**
 * Structured Candidate Types — Hito 16AB.4
 *
 * Tipos para candidatos provenientes de fuentes masivas estructuradas
 * (Socrata Colombia, registros oficiales, etc.).
 *
 * No modifica ni reexporta tipos del pipeline web_ai.
 * No contiene lógica. No importa nada externo.
 */

// ── Enums de clasificación ────────────────────────────────────

export type EmployeeCountStatus =
  | 'confirmed_100_plus'
  | 'confirmed_under_100'
  | 'unknown_requires_manual_validation'
  | 'estimated_100_plus'
  | 'estimated_under_100'
  | 'not_applicable';

export type CommercialFitStatus =
  | 'likely_fit'
  | 'needs_manual_review'
  | 'likely_not_fit'
  | 'risky_fit'
  | 'blocked'
  | 'duplicate'
  | 'customer_blocked'
  | 'recyclable_prospect';

export type HubspotMatchStatus =
  | 'no_match'
  | 'exact_match_customer'
  | 'exact_match_prospect_active'
  | 'exact_match_prospect_recyclable'
  | 'exact_match_ex_customer'
  | 'possible_match_requires_review'
  | 'hubspot_lookup_failed'
  | 'not_attempted';

export type RecyclableStatus =
  | 'not_recyclable'
  | 'recyclable'
  | 'pending_review';

export type ReviewStatus =
  | 'generated'
  | 'normalized'
  | 'needs_enrichment'
  | 'enrichment_in_progress'
  | 'enriched'
  | 'needs_manual_review'
  | 'ready_for_approval'
  | 'approved'
  | 'rejected'
  | 'blocked_customer'
  | 'blocked_duplicate'
  | 'synced_to_hubspot'
  | 'sync_failed';

export type ReviewFlag =
  | 'size_unknown'
  | 'size_confirmed'
  | 'size_estimated'
  | 'size_below_threshold'
  | 'size_estimated_below_threshold'
  | 'missing_website'
  | 'missing_linkedin'
  | 'missing_decision_maker'
  | 'no_tax_id'
  | 'inactive_company'
  | 'possible_duplicate'
  | 'hubspot_existing_customer'
  | 'hubspot_existing_prospect'
  | 'hubspot_recyclable_prospect'
  | 'source_low_confidence'
  | 'sector_match'
  | 'sector_unknown'
  | 'natural_person_risk'
  | 'pii_email_risk'
  | 'pii_phone_risk';

// ── Traces tipados ────────────────────────────────────────────

export type SocrataSourceTrace = {
  sourceProvider: 'socrata_colombia';
  sourceKey: string;
  datasetId: string;
  sourceRecordId: string | null;
  queryParams: {
    soqlFilter?: string;
    limit?: number;
    offset?: number;
  };
  fetchedAt: string;
  connectorVersion: string;
  normalizedAt: string;
};

export type HubspotTrace = {
  lookupAttempted: boolean;
  lookupAt: string | null;
  matchStatus: HubspotMatchStatus;
  matchedCompanyId: string | null;
  matchedBy: 'nit' | 'domain' | 'name' | 'id' | null;
  possibleMatches: Array<{
    hubspotId: string;
    name: string | null;
    confidence: number;
  }>;
  syncAttempted: boolean;
  syncAt: string | null;
  syncStatus: 'success' | 'failed' | 'skipped' | null;
  syncError: string | null;
  syncedByUserId: string | null;
};

export type CommercialTrace = {
  employeeCountStatus: EmployeeCountStatus;
  employeeCountSource: string | null;
  employeeCountConfidence: number | null;
  fitReasons: string[];
  reviewFlags: ReviewFlag[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

// ── Draft conceptual (no es insert de DB) ────────────────────

/**
 * Representación conceptual de un candidato proveniente de fuente
 * estructurada. No es un insert directo a prospect_candidates.
 * Usado por el mapper Socrata → candidato para validación local.
 */
export type StructuredSourceCandidateDraft = {
  // Identidad
  name: string;
  taxId: string | null;
  city: string | null;
  department: string | null;
  sectorCode: string | null;
  sectorDescription: string | null;
  legalStatus: string | null;
  website: string | null;
  countryCode: 'CO';

  // Fuente
  sourcePrimary: 'socrata_colombia';

  // Tamaño (siempre unknown para Socrata en primera pasada)
  employeeCount: null;
  employeeCountStatus: 'unknown_requires_manual_validation';

  // Clasificación inicial
  commercialFitStatus: 'needs_manual_review';
  hubspotMatchStatus: 'not_attempted';
  reviewStatus: 'needs_manual_review';
  reviewFlags: ReviewFlag[];

  // Trazabilidad
  sourceTrace: SocrataSourceTrace;
  hubspotTrace: HubspotTrace;
  commercialTrace: CommercialTrace;
};
