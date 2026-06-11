import { createClient } from '@/lib/supabase/server';
import type { ActiveIndustryCatalog, CatalogIndustryOption, CatalogSubindustryOption } from './types';

// ── Raw row shape from public.active_industry_catalog ────────────────────────

type CatalogRow = {
  catalog_version: string;
  industry_id: string;
  industry_name: string;
  industry_slug: string;
  industry_description: string | null;
  industry_sort_order: number;
  subindustry_id: string;
  subindustry_name: string;
  subindustry_slug: string;
  subindustry_description: string | null;
  subindustry_sort_order: number;
  applicable_countries: string[] | null;
};

// ── Loader errors ─────────────────────────────────────────────────────────────

export class CatalogLoadError extends Error {
  constructor(
    public readonly reason:
      | 'query_failed'
      | 'empty_catalog'
      | 'mixed_versions'
      | 'invalid_industry'
      | 'invalid_subindustry'
      | 'duplicate_ids'
      | 'inconsistent_payload',
    message: string,
  ) {
    super(message);
    this.name = 'CatalogLoadError';
  }
}

// ── Main loader ───────────────────────────────────────────────────────────────
// Server-only. Queries public.active_industry_catalog via the SSR Supabase client.
// Caching strategy: one Supabase query per page render. The result is passed as
// a serialized prop to the client component — zero re-queries during form interactions.
// A new navigation always triggers a fresh render, so a newly published catalog
// version is picked up without any TTL management or extra infrastructure.

export async function loadActiveCatalog(): Promise<ActiveIndustryCatalog> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('active_industry_catalog')
    .select(
      'catalog_version, industry_id, industry_name, industry_slug, industry_description, industry_sort_order, subindustry_id, subindustry_name, subindustry_slug, subindustry_description, subindustry_sort_order, applicable_countries',
    );

  if (error) {
    throw new CatalogLoadError('query_failed', `Supabase query failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new CatalogLoadError('empty_catalog', 'No published catalog found in active_industry_catalog.');
  }

  const rows = data as CatalogRow[];

  // Validate: single version
  const versions = new Set(rows.map((r) => r.catalog_version));
  if (versions.size > 1) {
    throw new CatalogLoadError(
      'mixed_versions',
      `active_industry_catalog returned rows from multiple versions: ${[...versions].join(', ')}`,
    );
  }

  const version = [...versions][0];

  // Validate: no industry without id
  for (const row of rows) {
    if (!row.industry_id || typeof row.industry_id !== 'string' || row.industry_id.trim() === '') {
      throw new CatalogLoadError('invalid_industry', 'Row with missing industry_id found in catalog.');
    }
    if (!row.subindustry_id || typeof row.subindustry_id !== 'string' || row.subindustry_id.trim() === '') {
      throw new CatalogLoadError('invalid_subindustry', 'Row with missing subindustry_id found in catalog.');
    }
  }

  // Build industry map (deduped)
  const industryMap = new Map<string, CatalogIndustryOption>();
  for (const row of rows) {
    if (!industryMap.has(row.industry_id)) {
      industryMap.set(row.industry_id, {
        id: row.industry_id,
        name: row.industry_name,
        slug: row.industry_slug,
        description: row.industry_description ?? null,
        sortOrder: row.industry_sort_order,
      });
    }
  }

  // Build subindustry map (deduped)
  const subindustryMap = new Map<string, CatalogSubindustryOption>();
  for (const row of rows) {
    if (!subindustryMap.has(row.subindustry_id)) {
      subindustryMap.set(row.subindustry_id, {
        id: row.subindustry_id,
        industryId: row.industry_id,
        name: row.subindustry_name,
        slug: row.subindustry_slug,
        description: row.subindustry_description ?? null,
        applicableCountries: row.applicable_countries ?? null,
        sortOrder: row.subindustry_sort_order,
      });
    } else {
      // Subindustry appeared twice — duplicate id
      const existing = subindustryMap.get(row.subindustry_id)!;
      if (existing.industryId !== row.industry_id) {
        throw new CatalogLoadError(
          'inconsistent_payload',
          `Subindustry ${row.subindustry_id} appears under different industries.`,
        );
      }
    }
  }

  // Validate: all subindustries reference a known industry
  for (const [subId, sub] of subindustryMap) {
    if (!industryMap.has(sub.industryId)) {
      throw new CatalogLoadError(
        'invalid_subindustry',
        `Subindustry ${subId} references unknown industry ${sub.industryId}.`,
      );
    }
  }

  // Check for duplicate industry ids (shouldn't happen but guard anyway)
  if (industryMap.size !== new Set([...industryMap.keys()]).size) {
    throw new CatalogLoadError('duplicate_ids', 'Duplicate industry IDs detected.');
  }

  // Sort both collections deterministically
  const industries = [...industryMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  const subindustries = [...subindustryMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  return { version, industries, subindustries };
}

// Pure helpers live in catalog-utils.ts so client components can import them
// without pulling in the Supabase server client.
export { isSubindustryApplicable, detectIncompatibleSubindustries } from './catalog-utils';
