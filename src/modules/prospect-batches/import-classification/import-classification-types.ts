// ── Classification contracts — Hito 16AB.37 ──────────────────────────────────
// Pure TypeScript types. No Supabase, no UI, no side effects.

// ── Match status ──────────────────────────────────────────────────────────────

export type ClassificationMatchStatus =
  | 'exact_match'
  | 'slug_match'
  | 'alias_match'
  | 'normalized_match'
  | 'missing'
  | 'not_found'
  | 'ambiguous'
  | 'wrong_industry'
  | 'not_applicable_to_country'
  | 'requires_review';

export type ClassificationSource =
  | 'catalog_name'
  | 'catalog_slug'
  | 'catalog_alias'
  | 'normalized_text'
  | 'manual'
  | 'none';

// ── Warning contracts ─────────────────────────────────────────────────────────

export type ClassificationWarningCode =
  | 'INDUSTRY_MISSING'
  | 'INDUSTRY_NOT_FOUND'
  | 'INDUSTRY_AMBIGUOUS'
  | 'SUBINDUSTRY_MISSING'
  | 'SUBINDUSTRY_NOT_FOUND'
  | 'SUBINDUSTRY_AMBIGUOUS'
  | 'SUBINDUSTRY_WRONG_INDUSTRY'
  | 'SUBINDUSTRY_NOT_APPLICABLE_TO_COUNTRY'
  | 'INDUSTRY_SUGGESTED_FROM_SUBINDUSTRY'
  | 'COUNTRY_REQUIRED_FOR_APPLICABILITY_CHECK'
  | 'VALUE_TRUNCATED';

export type ClassificationWarning = {
  code: ClassificationWarningCode;
  field: 'industry' | 'subindustry' | 'country';
  message: string;
};

// ── Result per row ────────────────────────────────────────────────────────────

export type ImportedProspectClassification = {
  catalogVersion: string;

  industryOriginalValue: string | null;
  subindustryOriginalValue: string | null;

  industryId: string | null;
  industrySlug: string | null;
  industryName: string | null;
  industryMatchStatus: ClassificationMatchStatus;
  industryMatchSource: ClassificationSource;

  subindustryId: string | null;
  subindustrySlug: string | null;
  subindustryName: string | null;
  subindustryMatchStatus: ClassificationMatchStatus;
  subindustryMatchSource: ClassificationSource;

  suggestedIndustryId: string | null;

  classificationWarnings: ClassificationWarning[];
  requiresHumanReview: boolean;
};

// ── Catalog input types ───────────────────────────────────────────────────────

export type ImportCatalogIndustry = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
};

export type ImportCatalogSubindustry = {
  id: string;
  industryId: string;
  name: string;
  slug: string;
  applicableCountries: string[] | null;
  active: boolean;
};

export type ImportCatalogAlias = {
  id: string;
  subindustryId: string;
  alias: string;
  languageCode: string | null;
  countryCode: string | null;
  active: boolean;
};

export type ImportClassificationCatalog = {
  version: string;
  industries: ImportCatalogIndustry[];
  subindustries: ImportCatalogSubindustry[];
  aliases: ImportCatalogAlias[];
};

// ── In-memory indexes ─────────────────────────────────────────────────────────

export type ImportCatalogIndexes = {
  industryById: Map<string, ImportCatalogIndustry>;
  industryBySlug: Map<string, ImportCatalogIndustry>;
  // exact case-insensitive name lookup (key = name.toLowerCase())
  industryByLowercaseName: Map<string, ImportCatalogIndustry[]>;
  // normalized text lookup (key = normalizeClassificationValue(name))
  industryByNormalizedName: Map<string, ImportCatalogIndustry[]>;
  subindustryById: Map<string, ImportCatalogSubindustry>;
  subindustryBySlug: Map<string, ImportCatalogSubindustry>;
  subindustryByLowercaseName: Map<string, ImportCatalogSubindustry[]>;
  subindustriesByNormalizedName: Map<string, ImportCatalogSubindustry[]>;
  aliasesByNormalizedValue: Map<string, ImportCatalogSubindustry[]>;
  subindustriesByIndustryId: Map<string, ImportCatalogSubindustry[]>;
};

// ── Index build result ────────────────────────────────────────────────────────

export type CatalogIndexIssueCode =
  | 'DUPLICATE_INDUSTRY_ID'
  | 'DUPLICATE_INDUSTRY_SLUG'
  | 'DUPLICATE_SUBINDUSTRY_ID'
  | 'DUPLICATE_SUBINDUSTRY_SLUG'
  | 'AMBIGUOUS_INDUSTRY_NAME'
  | 'AMBIGUOUS_SUBINDUSTRY_NAME'
  | 'AMBIGUOUS_ALIAS'
  | 'ALIAS_REFERENCES_UNKNOWN_SUBINDUSTRY'
  | 'SUBINDUSTRY_REFERENCES_UNKNOWN_INDUSTRY'
  | 'MISSING_CATALOG_VERSION'
  | 'INACTIVE_INDUSTRY'
  | 'INACTIVE_SUBINDUSTRY';

export type CatalogIndexIssue = {
  code: CatalogIndexIssueCode;
  severity: 'error' | 'warning';
  message: string;
  entityId?: string;
};

export type CatalogIndexBuildResult = {
  valid: boolean;
  indexes: ImportCatalogIndexes | null;
  issues: CatalogIndexIssue[];
};

// ── Row input ─────────────────────────────────────────────────────────────────

export type ImportClassificationRowInput = {
  industryValue: string | null;
  subindustryValue: string | null;
  countryCode: string | null;
  catalog: ImportClassificationCatalog;
  indexes: ImportCatalogIndexes;
};

// ── Batch types ───────────────────────────────────────────────────────────────

export type ImportClassificationBatchRow = {
  industryValue: string | null;
  subindustryValue: string | null;
  countryCode: string | null;
};

export type ImportClassificationBatchInput = {
  rows: ImportClassificationBatchRow[];
  catalog: ImportClassificationCatalog;
};

export type ImportClassificationBatchResult = {
  catalogVersion: string;
  rows: ImportedProspectClassification[];
  summary: {
    total: number;
    exactMatches: number;
    aliasMatches: number;
    normalizedMatches: number;
    warnings: number;
    requiresReview: number;
    invalid: number;
  };
  catalogIssues: CatalogIndexIssue[];
};

// ── Derived validation status for preview ─────────────────────────────────────

export type ClassificationValidationStatus =
  | 'valid'
  | 'normalized'
  | 'warning'
  | 'requires_review'
  | 'invalid';
