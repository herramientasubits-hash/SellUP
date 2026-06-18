/**
 * SIIS Colombia Connector — Types
 *
 * Tipos para el conector SIIS (Supersociedades).
 * Solo server-side.
 */

export type SiisExcelUrlParams = {
  year: number;
  n: 1000 | 10000;
};

export type SiisCompanyFinancialRecord = {
  sourceKey: 'co_siis';
  countryCode: 'CO';
  sourceYear: number;
  ranking?: number;
  taxId?: string;
  legalName?: string;
  supervisor?: string;
  region?: string;
  department?: string;
  city?: string;
  ciiu?: string;
  macrosector?: string;
  financials?: {
    currentYear?: number;
    previousYear?: number;
    operatingRevenueCurrent?: number | null;
    profitLossCurrent?: number | null;
    totalAssetsCurrent?: number | null;
    totalLiabilitiesCurrent?: number | null;
    totalEquityCurrent?: number | null;
    operatingRevenuePrevious?: number | null;
    profitLossPrevious?: number | null;
    totalAssetsPrevious?: number | null;
    totalLiabilitiesPrevious?: number | null;
    totalEquityPrevious?: number | null;
  };
  raw?: Record<string, unknown>;
};

export type SiisEnrichmentResult = {
  matched: boolean;
  matchConfidence: number;
  matchedBy: 'tax_id' | 'exact_name' | 'normalized_name' | 'no_match';
  financialSignals?: SiisFinancialSignals;
  priorityBoost?: number;
  sourceYear?: number;
  metadata?: Record<string, unknown>;
};

export type SiisFinancialSignals = {
  hasPositiveRevenue: boolean;
  hasPositiveProfit: boolean;
  revenueGrowth?: number;
  profitMargin?: number;
  assetSize?: 'small' | 'medium' | 'large';
  leverageRatio?: number;
  equityStrength?: 'weak' | 'moderate' | 'strong';
  signalsSummary: string[];
};

export type SiisCandidateEnrichmentInput = {
  candidateName: string;
  candidateTaxId?: string;
  countryCode: string;
  sector?: string;
  existingMetadata?: Record<string, unknown>;
};

export type SiisCandidateEnrichmentOutput = {
  status: 'matched' | 'no_match' | 'skipped' | 'error';
  matchedBy: 'tax_id' | 'exact_name' | 'normalized_name' | null;
  confidence: number;
  sourceYear?: number;
  signals?: SiisFinancialSignals;
  financials?: SiisCompanyFinancialRecord['financials'];
  priorityBoost?: number;
  errorMessage?: string;
};