// ── Import catalog loader — Hito 16AB.39 ─────────────────────────────────────
// Server-only. Fetches published catalog (industries + subindustries + aliases)
// in a single logical operation and returns the contract required by the
// import classification normalizer (16AB.37).
//
// Two queries — both scoped to the published version via their respective views:
//   active_industry_catalog      → industries + subindustries
//   active_subindustry_aliases   → aliases
//
// Never queries search_terms, rules, or other catalog metadata.
// Never calls any AI provider.

import { createClient } from '@/lib/supabase/server';
import type {
  ImportClassificationCatalog,
  ImportCatalogIndustry,
  ImportCatalogSubindustry,
  ImportCatalogAlias,
} from './import-classification/import-classification-types';

// ── Result types ──────────────────────────────────────────────────────────────

export type ImportCatalogLoadErrorCode =
  | 'supabase_error'
  | 'empty_catalog'
  | 'mixed_versions'
  | 'missing_ids'
  | 'alias_version_mismatch';

export type ImportCatalogLoadResult =
  | {
      success: true;
      catalog: ImportClassificationCatalog;
      catalogVersionId: string;
    }
  | {
      success: false;
      code: ImportCatalogLoadErrorCode;
      message: string;
    };

// ── Raw row types ─────────────────────────────────────────────────────────────

type CatalogRow = {
  catalog_version_id: string;
  catalog_version: string;
  industry_id: string;
  industry_name: string;
  industry_slug: string;
  subindustry_id: string;
  subindustry_name: string;
  subindustry_slug: string;
  applicable_countries: string[] | null;
};

type AliasRow = {
  id: string;
  subindustry_id: string;
  catalog_version_id: string;
  alias: string;
  language_code: string | null;
  country_code: string | null;
};

// ── Main loader ───────────────────────────────────────────────────────────────

export async function loadImportCatalog(): Promise<ImportCatalogLoadResult> {
  const supabase = await createClient();

  // ── Query 1: industries + subindustries from published version ────────────

  const { data: catalogData, error: catalogError } = await supabase
    .from('active_industry_catalog')
    .select(
      'catalog_version_id, catalog_version, industry_id, industry_name, industry_slug, subindustry_id, subindustry_name, subindustry_slug, applicable_countries',
    );

  if (catalogError) {
    return {
      success: false,
      code: 'supabase_error',
      message: `active_industry_catalog query failed: ${catalogError.message}`,
    };
  }

  if (!catalogData || catalogData.length === 0) {
    return {
      success: false,
      code: 'empty_catalog',
      message: 'No published catalog found in active_industry_catalog.',
    };
  }

  const rows = catalogData as CatalogRow[];

  // Validate: single version
  const versionIds = new Set(rows.map((r) => r.catalog_version_id));
  if (versionIds.size > 1) {
    return {
      success: false,
      code: 'mixed_versions',
      message: `active_industry_catalog returned rows from multiple version IDs: ${[...versionIds].join(', ')}`,
    };
  }

  const catalogVersionId = [...versionIds][0];
  const catalogVersion = rows[0].catalog_version;

  // Validate: no missing IDs
  for (const row of rows) {
    if (!row.industry_id?.trim()) {
      return { success: false, code: 'missing_ids', message: 'Row with missing industry_id found.' };
    }
    if (!row.subindustry_id?.trim()) {
      return { success: false, code: 'missing_ids', message: 'Row with missing subindustry_id found.' };
    }
  }

  // Build industries (deduplicated)
  const industryMap = new Map<string, ImportCatalogIndustry>();
  for (const row of rows) {
    if (!industryMap.has(row.industry_id)) {
      industryMap.set(row.industry_id, {
        id: row.industry_id,
        name: row.industry_name,
        slug: row.industry_slug,
        active: true,
      });
    }
  }

  // Build subindustries (deduplicated)
  const subindustryMap = new Map<string, ImportCatalogSubindustry>();
  for (const row of rows) {
    if (!subindustryMap.has(row.subindustry_id)) {
      subindustryMap.set(row.subindustry_id, {
        id: row.subindustry_id,
        industryId: row.industry_id,
        name: row.subindustry_name,
        slug: row.subindustry_slug,
        applicableCountries: row.applicable_countries ?? null,
        active: true,
      });
    }
  }

  // ── Query 2: aliases from published version ───────────────────────────────

  const { data: aliasData, error: aliasError } = await supabase
    .from('active_subindustry_aliases')
    .select('id, subindustry_id, catalog_version_id, alias, language_code, country_code');

  if (aliasError) {
    return {
      success: false,
      code: 'supabase_error',
      message: `active_subindustry_aliases query failed: ${aliasError.message}`,
    };
  }

  const aliasRows = (aliasData ?? []) as AliasRow[];

  // Validate: all aliases belong to the same catalog version
  for (const alias of aliasRows) {
    if (alias.catalog_version_id !== catalogVersionId) {
      return {
        success: false,
        code: 'alias_version_mismatch',
        message: `Alias ${alias.id} belongs to version ${alias.catalog_version_id} but catalog is ${catalogVersionId}.`,
      };
    }
  }

  const aliases: ImportCatalogAlias[] = aliasRows
    .filter((a) => subindustryMap.has(a.subindustry_id))
    .map((a) => ({
      id: a.id,
      subindustryId: a.subindustry_id,
      alias: a.alias,
      languageCode: a.language_code,
      countryCode: a.country_code,
      active: true,
    }));

  const catalog: ImportClassificationCatalog = {
    version: catalogVersion,
    industries: [...industryMap.values()],
    subindustries: [...subindustryMap.values()],
    aliases,
  };

  return { success: true, catalog, catalogVersionId };
}
