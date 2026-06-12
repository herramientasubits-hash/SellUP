// ── Deterministic catalog normalizer — Hito 16AB.37 ──────────────────────────
// Pure functions. No Supabase, no LLM, no randomness, no side effects.
// Invariants enforced: subindustryId requires industryId; subindustry must belong
// to the resolved industry; ambiguous matches are never silently resolved.

import {
  normalizeClassificationValue,
  sanitizeClassificationInput,
  MAX_INDUSTRY_VALUE_LENGTH,
  MAX_SUBINDUSTRY_VALUE_LENGTH,
} from './catalog-normalization';
import { buildImportCatalogIndexes } from './catalog-index-builder';
import type {
  ImportClassificationRowInput,
  ImportClassificationBatchInput,
  ImportClassificationBatchResult,
  ImportedProspectClassification,
  ImportCatalogIndexes,
  ImportCatalogSubindustry,
  ClassificationMatchStatus,
  ClassificationSource,
  ClassificationWarning,
} from './import-classification-types';

// ── Internal resolution result types ─────────────────────────────────────────

type IndustryResolution = {
  id: string | null;
  slug: string | null;
  name: string | null;
  status: ClassificationMatchStatus;
  source: ClassificationSource;
};

type SubindustryResolution = {
  id: string | null;
  slug: string | null;
  name: string | null;
  status: ClassificationMatchStatus;
  source: ClassificationSource;
  suggestedIndustryId: string | null;
};

// ── Industry resolver ─────────────────────────────────────────────────────────

function resolveIndustry(
  sanitizedValue: string | null,
  indexes: ImportCatalogIndexes,
  warnings: ClassificationWarning[],
): IndustryResolution {
  if (!sanitizedValue || !sanitizedValue.trim()) {
    warnings.push({
      code: 'INDUSTRY_MISSING',
      field: 'industry',
      message: 'Industry value is empty or not provided.',
    });
    return { id: null, slug: null, name: null, status: 'missing', source: 'none' };
  }

  const trimmed = sanitizedValue.trim();

  // Step 1: exact case-insensitive name match
  const lcName = trimmed.toLowerCase();
  const exactMatches = indexes.industryByLowercaseName.get(lcName) ?? [];
  if (exactMatches.length === 1) {
    const m = exactMatches[0];
    return { id: m.id, slug: m.slug, name: m.name, status: 'exact_match', source: 'catalog_name' };
  }
  if (exactMatches.length > 1) {
    warnings.push({ code: 'INDUSTRY_AMBIGUOUS', field: 'industry', message: `Ambiguous industry name: "${trimmed}".` });
    return { id: null, slug: null, name: null, status: 'ambiguous', source: 'catalog_name' };
  }

  // Step 2: slug match
  const slugMatch = indexes.industryBySlug.get(lcName);
  if (slugMatch) {
    return { id: slugMatch.id, slug: slugMatch.slug, name: slugMatch.name, status: 'slug_match', source: 'catalog_slug' };
  }

  // Step 3: normalized text match
  const normalized = normalizeClassificationValue(trimmed);
  if (normalized) {
    const normMatches = indexes.industryByNormalizedName.get(normalized) ?? [];
    if (normMatches.length === 1) {
      const m = normMatches[0];
      return { id: m.id, slug: m.slug, name: m.name, status: 'normalized_match', source: 'normalized_text' };
    }
    if (normMatches.length > 1) {
      warnings.push({ code: 'INDUSTRY_AMBIGUOUS', field: 'industry', message: `Ambiguous industry after normalization: "${trimmed}".` });
      return { id: null, slug: null, name: null, status: 'ambiguous', source: 'normalized_text' };
    }
  }

  warnings.push({ code: 'INDUSTRY_NOT_FOUND', field: 'industry', message: `Industry not found in catalog: "${trimmed}".` });
  return { id: null, slug: null, name: null, status: 'not_found', source: 'none' };
}

// ── Subindustry candidate finder ──────────────────────────────────────────────
// Returns all candidates plus the method used. Stops at first method with results.

type SubindustryCandidateResult = {
  candidates: ImportCatalogSubindustry[];
  status: ClassificationMatchStatus;
  source: ClassificationSource;
} | null;

function findSubindustryCandidates(
  trimmed: string,
  indexes: ImportCatalogIndexes,
): SubindustryCandidateResult {
  const lcName = trimmed.toLowerCase();

  // Step 1: exact case-insensitive name match
  const exactMatches = indexes.subindustryByLowercaseName.get(lcName) ?? [];
  if (exactMatches.length > 0) {
    return { candidates: exactMatches, status: 'exact_match', source: 'catalog_name' };
  }

  // Step 2: slug match
  const slugMatch = indexes.subindustryBySlug.get(lcName);
  if (slugMatch) {
    return { candidates: [slugMatch], status: 'slug_match', source: 'catalog_slug' };
  }

  // Step 3: alias match
  const normalized = normalizeClassificationValue(trimmed);
  if (normalized) {
    const aliasMatches = indexes.aliasesByNormalizedValue.get(normalized) ?? [];
    if (aliasMatches.length > 0) {
      return { candidates: aliasMatches, status: 'alias_match', source: 'catalog_alias' };
    }

    // Step 4: normalized text match
    const normMatches = indexes.subindustriesByNormalizedName.get(normalized) ?? [];
    if (normMatches.length > 0) {
      return { candidates: normMatches, status: 'normalized_match', source: 'normalized_text' };
    }
  }

  return null;
}

// ── Subindustry resolver ──────────────────────────────────────────────────────

function resolveSubindustry(
  sanitizedValue: string | null,
  resolvedIndustryId: string | null,
  countryCode: string | null,
  indexes: ImportCatalogIndexes,
  warnings: ClassificationWarning[],
): SubindustryResolution {
  if (!sanitizedValue || !sanitizedValue.trim()) {
    warnings.push({
      code: 'SUBINDUSTRY_MISSING',
      field: 'subindustry',
      message: 'Subindustry value is empty or not provided.',
    });
    return { id: null, slug: null, name: null, status: 'missing', source: 'none', suggestedIndustryId: null };
  }

  const trimmed = sanitizedValue.trim();
  const found = findSubindustryCandidates(trimmed, indexes);

  if (!found) {
    warnings.push({ code: 'SUBINDUSTRY_NOT_FOUND', field: 'subindustry', message: `Subindustry not found in catalog: "${trimmed}".` });
    return { id: null, slug: null, name: null, status: 'not_found', source: 'none', suggestedIndustryId: null };
  }

  const { candidates, status: detectedStatus, source: detectedSource } = found;

  // Deduplicate candidates by ID
  const deduped = deduplicateById(candidates);

  // ── When the industry is resolved: filter to that industry ────────────────

  if (resolvedIndustryId) {
    const inSameIndustry = deduped.filter((s) => s.industryId === resolvedIndustryId);

    if (inSameIndustry.length === 0) {
      // Candidates exist but all belong to a different industry
      warnings.push({
        code: 'SUBINDUSTRY_WRONG_INDUSTRY',
        field: 'subindustry',
        message: `Subindustry "${trimmed}" was found in catalog but does not belong to the resolved industry.`,
      });
      return { id: null, slug: null, name: null, status: 'wrong_industry', source: detectedSource, suggestedIndustryId: null };
    }

    if (inSameIndustry.length > 1) {
      warnings.push({
        code: 'SUBINDUSTRY_AMBIGUOUS',
        field: 'subindustry',
        message: `Ambiguous subindustry "${trimmed}" — multiple matches within the resolved industry.`,
      });
      return { id: null, slug: null, name: null, status: 'ambiguous', source: detectedSource, suggestedIndustryId: null };
    }

    const match = inSameIndustry[0];
    return applyGeographicCheck(match, detectedStatus, detectedSource, countryCode, warnings);
  }

  // ── Industry not resolved: find and suggest ───────────────────────────────

  if (deduped.length > 1) {
    warnings.push({
      code: 'SUBINDUSTRY_AMBIGUOUS',
      field: 'subindustry',
      message: `Ambiguous subindustry "${trimmed}" — multiple matches across industries, no industry context to disambiguate.`,
    });
    return { id: null, slug: null, name: null, status: 'ambiguous', source: detectedSource, suggestedIndustryId: null };
  }

  // Single candidate found but no confirmed industry — suggest, do not approve
  const candidate = deduped[0];
  warnings.push({
    code: 'INDUSTRY_SUGGESTED_FROM_SUBINDUSTRY',
    field: 'industry',
    message: `Subindustry "${candidate.name}" recognized; parent industry suggested but not confirmed.`,
  });
  return {
    id: null,
    slug: null,
    name: null,
    status: 'requires_review',
    source: detectedSource,
    suggestedIndustryId: candidate.industryId,
  };
}

// ── Geographic applicability check ────────────────────────────────────────────

function applyGeographicCheck(
  sub: ImportCatalogSubindustry,
  detectedStatus: ClassificationMatchStatus,
  detectedSource: ClassificationSource,
  countryCode: string | null,
  warnings: ClassificationWarning[],
): SubindustryResolution {
  // Null applicableCountries = valid for all countries
  if (sub.applicableCountries === null) {
    return { id: sub.id, slug: sub.slug, name: sub.name, status: detectedStatus, source: detectedSource, suggestedIndustryId: null };
  }

  // Country missing for a restricted subindustry
  if (!countryCode) {
    warnings.push({
      code: 'COUNTRY_REQUIRED_FOR_APPLICABILITY_CHECK',
      field: 'country',
      message: `Subindustry "${sub.name}" has country restrictions but no country code is available to verify applicability.`,
    });
    // Record the match but flag for review (cannot confirm applicability)
    return {
      id: sub.id,
      slug: sub.slug,
      name: sub.name,
      status: detectedStatus,
      source: detectedSource,
      suggestedIndustryId: null,
    };
  }

  // Country present — check if it's allowed
  if (sub.applicableCountries.includes(countryCode)) {
    return { id: sub.id, slug: sub.slug, name: sub.name, status: detectedStatus, source: detectedSource, suggestedIndustryId: null };
  }

  // Country not in the allowed list
  warnings.push({
    code: 'SUBINDUSTRY_NOT_APPLICABLE_TO_COUNTRY',
    field: 'subindustry',
    message: `Subindustry "${sub.name}" is not applicable to country "${countryCode}" (allowed: ${sub.applicableCountries.join(', ')}).`,
  });
  return {
    id: sub.id,
    slug: sub.slug,
    name: sub.name,
    status: 'not_applicable_to_country',
    source: detectedSource,
    suggestedIndustryId: null,
  };
}

// ── Deduplication helper ──────────────────────────────────────────────────────

function deduplicateById(subs: ImportCatalogSubindustry[]): ImportCatalogSubindustry[] {
  const seen = new Set<string>();
  const result: ImportCatalogSubindustry[] = [];
  for (const sub of subs) {
    if (!seen.has(sub.id)) {
      seen.add(sub.id);
      result.push(sub);
    }
  }
  return result;
}

// ── requiresHumanReview logic ─────────────────────────────────────────────────

const REVIEW_STATUSES = new Set<ClassificationMatchStatus>([
  'not_found',
  'ambiguous',
  'wrong_industry',
  'not_applicable_to_country',
  'requires_review',
]);

function computeRequiresHumanReview(
  industry: IndustryResolution,
  subindustry: SubindustryResolution,
  warnings: ClassificationWarning[],
): boolean {
  if (REVIEW_STATUSES.has(industry.status)) return true;
  if (subindustry.status !== 'missing' && REVIEW_STATUSES.has(subindustry.status)) return true;
  if (subindustry.suggestedIndustryId !== null) return true;
  if (warnings.some((w) => w.code === 'COUNTRY_REQUIRED_FOR_APPLICABILITY_CHECK')) return true;
  return false;
}

// ── Row normalizer ────────────────────────────────────────────────────────────

export function normalizeImportedProspectClassification(
  input: ImportClassificationRowInput,
): ImportedProspectClassification {
  const { industryValue, subindustryValue, countryCode, catalog, indexes } = input;

  const warnings: ClassificationWarning[] = [];

  const cleanIndustry = sanitizeClassificationInput(industryValue, MAX_INDUSTRY_VALUE_LENGTH, 'industry', warnings);
  const cleanSubindustry = sanitizeClassificationInput(subindustryValue, MAX_SUBINDUSTRY_VALUE_LENGTH, 'subindustry', warnings);

  const industryResult = resolveIndustry(cleanIndustry, indexes, warnings);
  const subindustryResult = resolveSubindustry(
    cleanSubindustry,
    industryResult.id,
    countryCode,
    indexes,
    warnings,
  );

  const requiresHumanReview = computeRequiresHumanReview(industryResult, subindustryResult, warnings);

  return {
    catalogVersion: catalog.version,
    industryOriginalValue: industryValue,
    subindustryOriginalValue: subindustryValue,
    industryId: industryResult.id,
    industrySlug: industryResult.slug,
    industryName: industryResult.name,
    industryMatchStatus: industryResult.status,
    industryMatchSource: industryResult.source,
    subindustryId: subindustryResult.id,
    subindustrySlug: subindustryResult.slug,
    subindustryName: subindustryResult.name,
    subindustryMatchStatus: subindustryResult.status,
    subindustryMatchSource: subindustryResult.source,
    suggestedIndustryId: subindustryResult.suggestedIndustryId,
    classificationWarnings: warnings,
    requiresHumanReview,
  };
}

// ── Batch normalizer ──────────────────────────────────────────────────────────

export function normalizeImportedProspectClassifications(
  input: ImportClassificationBatchInput,
): ImportClassificationBatchResult {
  const { rows, catalog } = input;

  // Build indexes once for the entire batch
  const buildResult = buildImportCatalogIndexes(catalog);

  if (!buildResult.valid || !buildResult.indexes) {
    // Catalog structural errors prevent reliable normalization
    return {
      catalogVersion: catalog.version,
      rows: [],
      summary: {
        total: rows.length,
        exactMatches: 0,
        aliasMatches: 0,
        normalizedMatches: 0,
        warnings: 0,
        requiresReview: 0,
        invalid: rows.length,
      },
      catalogIssues: buildResult.issues,
    };
  }

  const indexes = buildResult.indexes;
  const results: ImportedProspectClassification[] = [];

  let exactMatches = 0;
  let aliasMatches = 0;
  let normalizedMatches = 0;
  let warningCount = 0;
  let requiresReview = 0;

  for (const row of rows) {
    const classification = normalizeImportedProspectClassification({
      industryValue: row.industryValue,
      subindustryValue: row.subindustryValue,
      countryCode: row.countryCode,
      catalog,
      indexes,
    });

    results.push(classification);

    // Summary counters — classify by primary match quality
    const primaryStatus = classification.subindustryId
      ? classification.subindustryMatchStatus
      : classification.industryMatchStatus;

    if (primaryStatus === 'exact_match' || primaryStatus === 'slug_match') {
      exactMatches++;
    } else if (primaryStatus === 'alias_match') {
      aliasMatches++;
    } else if (primaryStatus === 'normalized_match') {
      normalizedMatches++;
    }

    if (classification.requiresHumanReview) {
      requiresReview++;
    } else if (classification.classificationWarnings.length > 0) {
      warningCount++;
    }
  }

  return {
    catalogVersion: catalog.version,
    rows: results,
    summary: {
      total: rows.length,
      exactMatches,
      aliasMatches,
      normalizedMatches,
      warnings: warningCount,
      requiresReview,
      invalid: 0,
    },
    catalogIssues: buildResult.issues,
  };
}
