// ── In-memory catalog index builder — Hito 16AB.37 ───────────────────────────
// Pure function. Builds O(1) lookup structures from a validated catalog.
// Does not query Supabase. Does not produce side effects.

import { normalizeClassificationValue } from './catalog-normalization';
import type {
  ImportClassificationCatalog,
  ImportCatalogIndustry,
  ImportCatalogSubindustry,
  ImportCatalogIndexes,
  CatalogIndexBuildResult,
  CatalogIndexIssue,
} from './import-classification-types';

// ── Internal helper ───────────────────────────────────────────────────────────

function addToMultiMap<V>(map: Map<string, V[]>, key: string, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildImportCatalogIndexes(
  catalog: ImportClassificationCatalog,
): CatalogIndexBuildResult {
  const issues: CatalogIndexIssue[] = [];

  // ── Version check ─────────────────────────────────────────────────────────

  if (!catalog.version || !catalog.version.trim()) {
    issues.push({
      code: 'MISSING_CATALOG_VERSION',
      severity: 'warning',
      message: 'Catalog version is empty or missing.',
    });
  }

  // ── Industry indexes ──────────────────────────────────────────────────────

  const industryById = new Map<string, ImportCatalogIndustry>();
  const industryBySlug = new Map<string, ImportCatalogIndustry>();
  const industryByLowercaseName = new Map<string, ImportCatalogIndustry[]>();
  const industryByNormalizedName = new Map<string, ImportCatalogIndustry[]>();

  for (const industry of catalog.industries) {
    if (!industry.active) {
      issues.push({
        code: 'INACTIVE_INDUSTRY',
        severity: 'warning',
        message: `Industry "${industry.name}" (id: ${industry.id}) is inactive and excluded from matching.`,
        entityId: industry.id,
      });
      continue;
    }

    if (industryById.has(industry.id)) {
      issues.push({
        code: 'DUPLICATE_INDUSTRY_ID',
        severity: 'error',
        message: `Duplicate industry ID: "${industry.id}".`,
        entityId: industry.id,
      });
      continue;
    }
    industryById.set(industry.id, industry);

    if (industryBySlug.has(industry.slug)) {
      issues.push({
        code: 'DUPLICATE_INDUSTRY_SLUG',
        severity: 'warning',
        message: `Duplicate industry slug: "${industry.slug}". Slug match may be ambiguous.`,
        entityId: industry.id,
      });
    } else {
      industryBySlug.set(industry.slug, industry);
    }

    addToMultiMap(industryByLowercaseName, industry.name.toLowerCase(), industry);

    const norm = normalizeClassificationValue(industry.name);
    if (norm) {
      addToMultiMap(industryByNormalizedName, norm, industry);
    }
  }

  for (const [key, entries] of industryByNormalizedName) {
    if (entries.length > 1) {
      issues.push({
        code: 'AMBIGUOUS_INDUSTRY_NAME',
        severity: 'warning',
        message: `Multiple active industries normalize to "${key}": ${entries.map((e) => e.name).join(', ')}.`,
      });
    }
  }

  // ── Subindustry indexes ───────────────────────────────────────────────────

  const subindustryById = new Map<string, ImportCatalogSubindustry>();
  const subindustryBySlug = new Map<string, ImportCatalogSubindustry>();
  const subindustryByLowercaseName = new Map<string, ImportCatalogSubindustry[]>();
  const subindustriesByNormalizedName = new Map<string, ImportCatalogSubindustry[]>();
  const subindustriesByIndustryId = new Map<string, ImportCatalogSubindustry[]>();

  for (const sub of catalog.subindustries) {
    if (!sub.active) {
      issues.push({
        code: 'INACTIVE_SUBINDUSTRY',
        severity: 'warning',
        message: `Subindustry "${sub.name}" (id: ${sub.id}) is inactive and excluded from matching.`,
        entityId: sub.id,
      });
      continue;
    }

    if (!industryById.has(sub.industryId)) {
      issues.push({
        code: 'SUBINDUSTRY_REFERENCES_UNKNOWN_INDUSTRY',
        severity: 'error',
        message: `Subindustry "${sub.name}" (id: ${sub.id}) references unknown or inactive industry "${sub.industryId}".`,
        entityId: sub.id,
      });
      continue;
    }

    if (subindustryById.has(sub.id)) {
      issues.push({
        code: 'DUPLICATE_SUBINDUSTRY_ID',
        severity: 'error',
        message: `Duplicate subindustry ID: "${sub.id}".`,
        entityId: sub.id,
      });
      continue;
    }
    subindustryById.set(sub.id, sub);

    if (subindustryBySlug.has(sub.slug)) {
      issues.push({
        code: 'DUPLICATE_SUBINDUSTRY_SLUG',
        severity: 'warning',
        message: `Duplicate subindustry slug: "${sub.slug}". Slug match may be ambiguous.`,
        entityId: sub.id,
      });
    } else {
      subindustryBySlug.set(sub.slug, sub);
    }

    addToMultiMap(subindustryByLowercaseName, sub.name.toLowerCase(), sub);

    const norm = normalizeClassificationValue(sub.name);
    if (norm) {
      addToMultiMap(subindustriesByNormalizedName, norm, sub);
    }

    addToMultiMap(subindustriesByIndustryId, sub.industryId, sub);
  }

  for (const [key, entries] of subindustriesByNormalizedName) {
    if (entries.length > 1) {
      issues.push({
        code: 'AMBIGUOUS_SUBINDUSTRY_NAME',
        severity: 'warning',
        message: `Multiple active subindustries normalize to "${key}": ${entries.map((e) => e.name).join(', ')}.`,
      });
    }
  }

  // ── Alias indexes ─────────────────────────────────────────────────────────

  const aliasesByNormalizedValue = new Map<string, ImportCatalogSubindustry[]>();

  for (const alias of catalog.aliases) {
    if (!alias.active) continue;

    if (!subindustryById.has(alias.subindustryId)) {
      issues.push({
        code: 'ALIAS_REFERENCES_UNKNOWN_SUBINDUSTRY',
        severity: 'error',
        message: `Alias "${alias.alias}" (id: ${alias.id}) references unknown or inactive subindustry "${alias.subindustryId}".`,
        entityId: alias.id,
      });
      continue;
    }

    const sub = subindustryById.get(alias.subindustryId)!;
    const normAlias = normalizeClassificationValue(alias.alias);
    if (normAlias) {
      addToMultiMap(aliasesByNormalizedValue, normAlias, sub);
    }
  }

  for (const [key, subs] of aliasesByNormalizedValue) {
    const uniqueIds = new Set(subs.map((s) => s.id));
    if (uniqueIds.size > 1) {
      issues.push({
        code: 'AMBIGUOUS_ALIAS',
        severity: 'warning',
        message: `Alias value "${key}" maps to ${uniqueIds.size} distinct subindustries.`,
      });
    }
  }

  // ── Validity decision ─────────────────────────────────────────────────────

  const hasErrors = issues.some((i) => i.severity === 'error');

  if (hasErrors) {
    return { valid: false, indexes: null, issues };
  }

  const indexes: ImportCatalogIndexes = {
    industryById,
    industryBySlug,
    industryByLowercaseName,
    industryByNormalizedName,
    subindustryById,
    subindustryBySlug,
    subindustryByLowercaseName,
    subindustriesByNormalizedName,
    aliasesByNormalizedValue,
    subindustriesByIndustryId,
  };

  return { valid: true, indexes, issues };
}
