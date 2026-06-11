// ── Types: Industry Catalog UI payload ────────────────────────────────────────
// Server-safe types. Do not include rules, aliases, or search terms here.

export type CatalogIndustryOption = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
};

export type CatalogSubindustryOption = {
  id: string;
  industryId: string;
  name: string;
  slug: string;
  description: string | null;
  applicableCountries: string[] | null;
  sortOrder: number;
};

export type ActiveIndustryCatalog = {
  version: string;
  industries: CatalogIndustryOption[];
  subindustries: CatalogSubindustryOption[];
};

// ── Form Input (client → server) ──────────────────────────────────────────────
// Only fields safe to accept from the browser.
// employee threshold, enforcement, industry/subindustry names are derived server-side.

export type ExploratorySearchFormInput = {
  countryCode: string;
  industryId: string;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
  requestedCount: number;
  catalogVersion: string;
};

// ── Validation Result (server → client) ───────────────────────────────────────

export type ExploratorySearchValidationResult = {
  valid: boolean;
  preview: {
    catalogVersion: string;
    countryCode: string;
    countryName: string;
    industryId: string;
    industryName: string;
    subindustries: Array<{ id: string; name: string }>;
    additionalCriteriaRaw: string | null;
    additionalCriteriaNormalized: string | null;
    employeeSizeCriteria: {
      minEmployeeCountExclusive: 200;
      enforcement: 'hard_filter';
      scope: 'local_legal_entity';
    };
    requestedCount: number;
  } | null;
  warnings: string[];
  fieldErrors: Record<string, string[]>;
};
