export interface ResolveTaxIdentifierInput {
  name: string;
  domain?: string | null;
  website?: string | null;
  countryCode: string;
  sector?: string | null;
  existingMetadata?: Record<string, unknown>;
}

export interface TaxIdentifierCandidate {
  taxIdentifier: string;
  legalName: string;
  sourceKey: string;
  confidence: number;
  reason: string;
}

export interface ResolveTaxIdentifierOutput {
  status: 'resolved' | 'ambiguous' | 'not_found' | 'skipped' | 'error' | 'not_resolvable_automatically';
  taxIdentifier?: string;
  confidence: number;
  matchedBy?: 'exact_name' | 'normalized_name' | 'partial_normalized_name' | 'source_cross_match';
  sourceKey?: string;
  candidates?: TaxIdentifierCandidate[];
  metadata?: {
    normalizedSearchName?: string;
    matchedLegalName?: string;
    sourceYear?: number;
    warning?: string;
    human_review_required?: boolean;
    reason?: string;
    recommended_next_step?: string;
    contextual_sources_available?: string[];
  };
}

export interface TaxIdentifierResolutionMetadata {
  status: string;
  tax_identifier?: string;
  confidence: number;
  matched_by?: string;
  source_key?: string;
  matched_legal_name?: string;
  source_year?: number;
  candidates?: TaxIdentifierCandidate[];
  warning?: string;
}

export interface TaxIdentifierResolutionBatchMetadata {
  attempted: boolean;
  candidates_processed: number;
  resolved_count: number;
  ambiguous_count: number;
  not_found_count: number;
  skipped_count: number;
  not_resolvable_automatically_count: number;
  human_review_required_count: number;
  errors: string[];
}
