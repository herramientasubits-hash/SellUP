// ── Classification validation selectors — Hito 16AB.37 ───────────────────────
// Pure derived-state selectors. No side effects.

import type {
  ImportedProspectClassification,
  ClassificationValidationStatus,
  ClassificationMatchStatus,
} from './import-classification-types';

// ── Match status sets ─────────────────────────────────────────────────────────

const APPROVED_STATUSES = new Set<ClassificationMatchStatus>([
  'exact_match',
  'slug_match',
]);

const NORMALIZED_STATUSES = new Set<ClassificationMatchStatus>([
  'alias_match',
  'normalized_match',
]);

const REVIEW_STATUSES = new Set<ClassificationMatchStatus>([
  'not_found',
  'ambiguous',
  'wrong_industry',
  'not_applicable_to_country',
  'requires_review',
]);

// ── Selector ──────────────────────────────────────────────────────────────────

export function deriveClassificationValidationStatus(
  classification: ImportedProspectClassification,
): ClassificationValidationStatus {
  const { industryMatchStatus, subindustryMatchStatus, requiresHumanReview } = classification;

  // Catalog-level structural errors surface as requires_review at row level
  // (batch normalizer sets requiresHumanReview via REVIEW_STATUSES)

  if (REVIEW_STATUSES.has(industryMatchStatus)) return 'requires_review';
  if (subindustryMatchStatus !== 'missing' && REVIEW_STATUSES.has(subindustryMatchStatus)) return 'requires_review';
  if (requiresHumanReview) return 'requires_review';

  const industryOk = APPROVED_STATUSES.has(industryMatchStatus) || NORMALIZED_STATUSES.has(industryMatchStatus);
  const subOk =
    subindustryMatchStatus === 'missing' ||
    APPROVED_STATUSES.has(subindustryMatchStatus) ||
    NORMALIZED_STATUSES.has(subindustryMatchStatus);

  if (!industryOk) {
    // Missing industry: warn but do not block
    if (industryMatchStatus === 'missing') {
      return subindustryMatchStatus === 'missing' ? 'warning' : 'requires_review';
    }
    return 'requires_review';
  }

  if (!subOk) return 'requires_review';

  // Both resolved — determine quality
  const industryNormalized = NORMALIZED_STATUSES.has(industryMatchStatus);
  const subNormalized =
    subindustryMatchStatus !== 'missing' && NORMALIZED_STATUSES.has(subindustryMatchStatus);

  if (industryNormalized || subNormalized) return 'normalized';

  // Missing subindustry with valid industry is a warning (not blocking)
  if (subindustryMatchStatus === 'missing') return 'warning';

  return 'valid';
}
