/**
 * Perú — Inferred Sector Metadata Types (Perú.4D)
 *
 * Define el metadata que describe candidate discovery del Agente 1 para Perú.
 * El sector es inferido vía web/IA, no oficial. No CIIU.
 *
 * Esto NO es un adapter — es un contrato de datos para cuando el pipeline
 * del Agente 1 procesa candidatos Perú (Tavily/web search + inferencia IA).
 * Ver docs/PERU_MVP_ACTIVATION_PLAN.md §4.
 */

export type PeSectorConfidenceLabel = 'sector_inferred';
export type PeSectorSource = 'inferred_web_ai';
export type PeCiiuStatus = 'unavailable_for_mvp';
export type PeLegalValidationMode = 'offline_snapshot_or_worker';
export type PeLegalValidationStatus = 'pending_snapshot_validation' | 'verified' | 'not_found' | 'error';
export type PeInferenceMethod = 'keyword_razon_social' | 'web_search' | 'domain_analysis' | 'combined';

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

export function buildEmptyMetadata(): PeCandidateMetadata {
  return {
    sector_inferred: null,
    sector_confidence_score: null,
    sector_source: 'inferred_web_ai',
    confidence_label: 'sector_inferred',
    ciiu_status: 'unavailable_for_mvp',
    official_ciiu_available: false,
    inference_method: null,
    inference_evidence: [],
    human_review_required: true,
    legal_validation_source: 'pe_sunat_bulk',
    legal_validation_mode: 'offline_snapshot_or_worker',
    legal_validation_status: 'pending_snapshot_validation',
    legal_validation: {
      source: 'pe_sunat_bulk',
      status: 'pending_snapshot_validation',
      validated_at: null,
      ruc_match: false,
      name_match: false,
    },
  };
}
