/**
 * Prospecting Toolkit — Tipos base.
 *
 * Contiene los contratos de deduplicación y del catálogo de fuentes.
 * No contienen lógica, no importan nada externo.
 */

export type DuplicateStatus =
  | "new_candidate"
  | "existing_in_sellup"
  | "existing_in_hubspot"
  | "possible_duplicate"
  | "insufficient_data"
  | "unchecked"
  | "error";

export type DuplicateCheckInput = {
  name: string;
  legalName?: string | null;
  normalizedName?: string | null;
  website?: string | null;
  domain?: string | null;
  country?: string | null;
  countryCode?: string | null;
  taxIdentifier?: string | null;
};

export type DuplicateMatch = {
  source: "sellup" | "hubspot";
  status: DuplicateStatus;
  confidence: number;
  matchedId?: string | null;
  matchedName?: string | null;
  matchedDomain?: string | null;
  matchedWebsite?: string | null;
  matchedTaxIdentifier?: string | null;
  reason: string;
  raw?: unknown;
};

export type DuplicateCheckResult = {
  status: DuplicateStatus;
  confidence: number;
  input: DuplicateCheckInput;
  matches: DuplicateMatch[];
  summary: string;
  checkedSources: Array<"sellup" | "hubspot">;
  errors?: string[];
};

// ============================================================
// Catalog Context Retriever — tipos
// ============================================================

export type SearchDepth = "basic" | "standard" | "deep";

export type SourcePriority = "P0" | "P1" | "P2";

export type CatalogSource = {
  key: string;
  name: string;
  countryCodes: string[];
  sectors: string[];
  priority: SourcePriority;
  type:
    | "official_registry"
    | "public_dataset"
    | "procurement"
    | "industry_association"
    | "commercial_provider"
    | "web_search"
    | "other";
  url?: string | null;
  automationLevel: "high" | "medium" | "low" | "manual";
  recommendedUse: string;
  limitations?: string[];
  riskNotes?: string[];
};

export type CatalogContextInput = {
  country: string;
  countryCode: string;
  industry: string;
  searchDepth?: SearchDepth;
};

export type CatalogContextResult = {
  country: string;
  countryCode: string;
  industry: string;
  searchDepth: SearchDepth;
  fiscalIdentifierLabel: string | null;
  recommendedSources: CatalogSource[];
  sectorSources: CatalogSource[];
  risks: string[];
  operatingRules: string[];
  coverageNotes: string[];
  promptContext: string;
};

// ============================================================
// Web Search Tool — tipos (Hito 3A)
// ============================================================

export type WebSearchProviderKey =
  | "mock"
  | "tavily"
  | "brave"
  | "serpapi"
  | "exa"
  | "firecrawl";

export type WebSearchIntent =
  | "company_discovery"
  | "website_discovery"
  | "linkedin_company_discovery"
  | "source_validation";

export type WebSearchInput = {
  query: string;
  country?: string | null;
  countryCode?: string | null;
  industry?: string | null;
  intent?: WebSearchIntent;
  maxResults?: number;
  provider?: WebSearchProviderKey;
  searchDepth?: SearchDepth;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string | null;
  source?: string | null;
  rank: number;
  provider: WebSearchProviderKey;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
};

export type WebSearchOutput = {
  provider: WebSearchProviderKey;
  query: string;
  results: WebSearchResult[];
  resultsCount: number;
  skipped: boolean;
  skipReason?: string | null;
  estimatedCostUsd?: number | null;
  metadata?: Record<string, unknown>;
};

// ============================================================
// Candidate Scorer — tipos (Hito 3C)
// ============================================================

export type CandidateQualityLabel =
  | "high_quality_new"
  | "needs_review"
  | "duplicate"
  | "insufficient_data"
  | "discard";

export type CandidateRecommendedAction =
  | "approve_for_review"
  | "review_manually"
  | "exclude_existing"
  | "enrich_before_review"
  | "discard";

export type CandidateScoringInput = {
  name: string;
  legalName?: string | null;
  country?: string | null;
  countryCode?: string | null;
  industry?: string | null;
  subsector?: string | null;
  city?: string | null;
  region?: string | null;
  website?: string | null;
  domain?: string | null;
  linkedinCompanyUrl?: string | null;
  taxIdentifier?: string | null;
  companySize?: string | null;
  sourcePrimary?: string | null;
  sourcePriority?: SourcePriority | null;
  reasonForFit?: string | null;
  websiteVerification?: WebsiteVerificationOutput | null;
  duplicateCheck?: DuplicateCheckResult | null;
  catalogContext?: CatalogContextResult | null;
};

export type CandidateScoreBreakdown = {
  existenceSignals: number;
  websiteSignals: number;
  duplicateSignals: number;
  sourceSignals: number;
  fitSignals: number;
  completenessSignals: number;
  penalties: number;
};

export type CandidateScoringOutput = {
  confidenceScore: number;
  fitScore: number;
  dataCompletenessScore: number;
  qualityLabel: CandidateQualityLabel;
  recommendedAction: CandidateRecommendedAction;
  breakdown: CandidateScoreBreakdown;
  reasons: string[];
  warnings: string[];
  blockers: string[];
  metadata?: Record<string, unknown>;
};

// ============================================================
// Prospecting Pipeline — tipos (Hito 4)
// ============================================================

export type ProspectingPipelineInput = {
  country: string;
  countryCode: string;
  industry: string;
  searchDepth?: SearchDepth;
  targetCount?: number;
  webSearchProvider?: WebSearchProviderKey;
};

export type ProspectingPipelineCandidate = {
  name: string;
  website: string | null;
  domain: string | null;
  country: string;
  countryCode: string;
  industry: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSnippet: string | null;
  websiteVerification: WebsiteVerificationOutput | null;
  duplicateCheck: DuplicateCheckResult | null;
  scoring: CandidateScoringOutput;
};

export type ProspectingPipelineSummary = {
  requested: number;
  searched: number;
  returned: number;
  highQualityNew: number;
  needsReview: number;
  duplicates: number;
  insufficientData: number;
  discarded: number;
  unchecked: number;
};

export type ProspectingPipelineOutput = {
  input: ProspectingPipelineInput;
  catalogContext: CatalogContextResult;
  searchQuery: string;
  webSearch: WebSearchOutput;
  candidates: ProspectingPipelineCandidate[];
  summary: ProspectingPipelineSummary;
  warnings: string[];
  metadata?: Record<string, unknown>;
};

// ============================================================
// Candidate Writer — tipos (Hito 5)
// ============================================================

export type CandidateWriterSource = "agent_1" | "mock" | "web_search";

export type CandidateWriterStatus =
  | "success"
  | "partial_success"
  | "failed"
  | "dry_run";

export type CandidateWriterInput = {
  pipelineOutput: ProspectingPipelineOutput;
  triggeredByUserId?: string | null;
  ownerId?: string | null;
  batchName?: string | null;
  source?: CandidateWriterSource;
  dryRun?: boolean;
};

export type CandidateWriterSkipped = {
  name: string;
  reason: string;
};

export type CandidateWriterOutput = {
  dryRun: boolean;
  batchId: string | null;
  candidatesCreated: number;
  candidatesSkipped: number;
  createdCandidateIds: string[];
  skipped: CandidateWriterSkipped[];
  status: CandidateWriterStatus;
  errors: string[];
};

// Combined output for runAndWriteProspectingPipeline
export type ProspectingPipelineWriteOutput = {
  pipeline: ProspectingPipelineOutput;
  writer: CandidateWriterOutput;
};

// ============================================================
// Website Verifier — tipos (Hito 3B)
// ============================================================

export type WebsiteVerificationStatus =
  | "verified"
  | "inferred"
  | "mismatch"
  | "not_found"
  | "error";

export type WebsiteVerificationInput = {
  candidateName: string;
  websiteOrDomain?: string | null;
  country?: string | null;
  countryCode?: string | null;
  expectedDomain?: string | null;
  timeoutMs?: number;
};

export type WebsiteVerificationOutput = {
  status: WebsiteVerificationStatus;
  website: string | null;
  domain: string | null;
  finalUrl: string | null;
  finalDomain: string | null;
  httpStatus: number | null;
  redirected: boolean;
  redirectChain: string[];
  title?: string | null;
  metaDescription?: string | null;
  evidence: string[];
  confidence: number;
  skipped: boolean;
  skipReason?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

// ============================================================
// Multi-Query Web Search — tipos (Hito 12B)
// ============================================================

export type MultiQuerySearchInput = {
  country: string;
  countryCode?: string | null;
  industry: string;
  provider?: WebSearchProviderKey;
  queries?: string[];
  maxResultsPerQuery?: number;
  targetCount?: number;
  searchDepth?: SearchDepth;
};

export type MultiQueryQueryResult = {
  query: string;
  rawResultsCount: number;
  keptCount: number;
  filteredOutCount: number;
  skipped: boolean;
  skipReason?: string | null;
};

export type MultiQuerySearchResultEntry = WebSearchResult & {
  originQuery: string;
};

export type MultiQueryWebSearchOutput = {
  queryResults: MultiQueryQueryResult[];
  rawResultsCount: number;
  dedupedResultsCount: number;
  filteredOutCount: number;
  keptCount: number;
  results: MultiQuerySearchResultEntry[];
  estimatedCreditCount: number;
  metadata?: Record<string, unknown>;
};
