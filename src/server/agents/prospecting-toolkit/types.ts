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
