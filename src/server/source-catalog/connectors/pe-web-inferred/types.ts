/**
 * pe-web-inferred — Types
 *
 * Tipos exclusivos para el adapter de discovery Perú con sector inferido.
 * No depende de sunat-peru/types.
 */

export const PE_WEB_INFERRED_SOURCE_KEY = 'pe_web_inferred';
export const PE_WEB_INFERRED_COUNTRY_CODE = 'PE';

export type PeSectorConfidenceLabel = 'sector_inferred';

export type PeSectorSource = 'inferred_web_ai';

export type PeCiiuStatus = 'unavailable_for_mvp';

export type PeLegalValidationMode = 'offline_snapshot_or_worker';

export type PeLegalValidationStatus =
  | 'pending_snapshot_validation'
  | 'verified'
  | 'not_found'
  | 'error';

export type PeInferenceMethod =
  | 'keyword_razon_social'
  | 'web_search'
  | 'domain_analysis'
  | 'combined';

export interface PeCandidateLegalValidation {
  source: 'pe_sunat_bulk';
  status: PeLegalValidationStatus;
  validated_at: string | null;
  ruc_match: boolean;
  name_match: boolean;
}

export interface PeCandidateMetadata {
  sector_inferred: string | null;
  sector_confidence_score: number | null;
  sector_source: PeSectorSource;
  confidence_label: PeSectorConfidenceLabel;
  ciiu_status: PeCiiuStatus;
  official_ciiu_available: false;
  inference_method: PeInferenceMethod | null;
  inference_evidence: string[];
  human_review_required: true;
  legal_validation_source: 'pe_sunat_bulk';
  legal_validation_mode: PeLegalValidationMode;
  legal_validation_status: PeLegalValidationStatus;
  legal_validation: PeCandidateLegalValidation;
}

export interface PeWebInferredDryRunInput {
  limit?: number;
  offset?: number;
  criteria?: {
    country?: string;
    industry?: string | null;
    keywords?: string[];
  };
}

export interface PeWebInferredDryRunReport {
  recordsRead: number;
  acceptedCount: number;
  lowPriorityCount: number;
  filteredOutCount: number;
  warnings: string[];
  errors: string[];
  samples: PeWebInferredSample[];
}

export interface PeWebInferredSample {
  name: string;
  legalName: string | null;
  taxId: string | null;
  taxIdentifierType: string;
  country: string;
  countryCode: string;
  city: string | null;
  region: string | null;
  sectorDescription: string | null;
  sectorCode: string | null;
  sourcePrimary: string;
  metadata: PeCandidateMetadata;
  qualityDecision: string;
  reviewFlags: string[];
}
