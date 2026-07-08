// mapping-publication-validator.ts — Provider Industry Mapping Pre-Publication
// Validator (Q3F-5AJ).
//
// Pure, deterministic validation of an already-loaded DRAFT snapshot's
// content prior to publication. No Supabase query, no RPC, no provider call,
// no AI call, no clock read, no random ID, no input mutation. Same input
// always produces the same ordered result.
//
// Frozen trust model: DOMAIN_VALIDATOR + PV1_REVISION_PIN + PUBLICATION_RPC.
// This validator proves semantic parity of already-loaded application state —
// it does NOT prove DB lifecycle integrity by itself, and it does NOT resolve
// provider→canonical industry aliases (no resolveIndustry(), no fuzzy
// matching, no stemming, no translation).
//
// Empty-snapshot rule: zero concept entries and/or zero associations are
// valid (frozen storage contract permits an empty PUBLISHED snapshot). A
// concept entry with zero associations (known-but-unmapped) is valid. Two or
// more distinct industry targets for one concept entry (AMBIGUOUS) are valid.

import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';
import { RELATION_SEMANTICS_VALUES, type SnapshotStatus } from './mapping-draft-types';

// ── Validator input (already-loaded domain data only) ───────────────────────

export interface PublicationValidatorSnapshotInput {
  id: string;
  sourceVocabularyKey: string;
  catalogVersionId: string;
  status: SnapshotStatus;
  contentRevision: number;
  createdBy: string;
  versionLabel: string | null;
  changeReason: string | null;
}

export interface PublicationValidatorConceptEntryInput {
  id: string;
  snapshotId: string;
  rawLabel: string;
  normalizedLookupKey: string;
}

export interface PublicationValidatorAssociationInput {
  id: string;
  snapshotId: string;
  conceptEntryId: string;
  industryId: string;
  catalogVersionId: string;
  relationSemantics: string;
}

/** Canonical industry reference for the snapshot's catalog version (CAT-FK2 target proof). */
export interface PublicationValidatorCanonicalIndustryInput {
  id: string;
  catalogVersionId: string;
}

export interface MappingPublicationValidatorInput {
  snapshot: PublicationValidatorSnapshotInput;
  conceptEntries: readonly PublicationValidatorConceptEntryInput[];
  associations: readonly PublicationValidatorAssociationInput[];
  canonicalIndustries: readonly PublicationValidatorCanonicalIndustryInput[];
}

// ── Validation issue taxonomy ────────────────────────────────────────────────
// Ordered top-to-bottom exactly as ISSUE_CODE_ORDER below — this array is the
// single owned ordering authority (section 20 of Q3F-5AJ).

export type MappingPublicationValidationIssueCode =
  | 'SNAPSHOT_NOT_DRAFT'
  | 'SNAPSHOT_VERSION_LABEL_MISSING'
  | 'SNAPSHOT_CHANGE_REASON_MISSING'
  | 'CONCEPT_SNAPSHOT_MISMATCH'
  | 'CONCEPT_NORMALIZED_KEY_EMPTY'
  | 'CONCEPT_NORMALIZED_KEY_MISMATCH'
  | 'CONCEPT_NORMALIZED_KEY_COLLISION'
  | 'ASSOCIATION_SNAPSHOT_MISMATCH'
  | 'ASSOCIATION_CONCEPT_NOT_FOUND'
  | 'ASSOCIATION_CONCEPT_SNAPSHOT_MISMATCH'
  | 'ASSOCIATION_RELATION_SEMANTICS_INVALID'
  | 'ASSOCIATION_CATALOG_VERSION_MISMATCH'
  | 'ASSOCIATION_INDUSTRY_NOT_FOUND'
  | 'ASSOCIATION_INDUSTRY_CATALOG_VERSION_MISMATCH'
  | 'ASSOCIATION_DUPLICATE_TARGET';

const ISSUE_CODE_ORDER: readonly MappingPublicationValidationIssueCode[] = [
  'SNAPSHOT_NOT_DRAFT',
  'SNAPSHOT_VERSION_LABEL_MISSING',
  'SNAPSHOT_CHANGE_REASON_MISSING',
  'CONCEPT_SNAPSHOT_MISMATCH',
  'CONCEPT_NORMALIZED_KEY_EMPTY',
  'CONCEPT_NORMALIZED_KEY_MISMATCH',
  'CONCEPT_NORMALIZED_KEY_COLLISION',
  'ASSOCIATION_SNAPSHOT_MISMATCH',
  'ASSOCIATION_CONCEPT_NOT_FOUND',
  'ASSOCIATION_CONCEPT_SNAPSHOT_MISMATCH',
  'ASSOCIATION_RELATION_SEMANTICS_INVALID',
  'ASSOCIATION_CATALOG_VERSION_MISMATCH',
  'ASSOCIATION_INDUSTRY_NOT_FOUND',
  'ASSOCIATION_INDUSTRY_CATALOG_VERSION_MISMATCH',
  'ASSOCIATION_DUPLICATE_TARGET',
];

/**
 * Minimal relevant-fields-only context. Only the fields meaningful to the
 * issue's code are populated — never a generic message-only shape, never raw
 * SQL, DB credentials, provider payloads, or secrets.
 */
export interface MappingPublicationValidationIssue {
  code: MappingPublicationValidationIssueCode;
  message: string;
  snapshotId?: string;
  conceptEntryIds?: readonly string[];
  associationId?: string;
  associationIds?: readonly string[];
  industryId?: string;
  catalogVersionId?: string;
  normalizedKey?: string;
  relationSemanticsValues?: readonly string[];
}

export type MappingPublicationValidationResult =
  | { valid: true; issues: readonly [] }
  | { valid: false; issues: readonly MappingPublicationValidationIssue[] };

// ── Deterministic ordering ───────────────────────────────────────────────────
// Stable code-order (ISSUE_CODE_ORDER) first, then a complete variant-specific
// canonical sort key built from every diagnostic identity field that can
// distinguish two issues of the same code (not just the first id in an array).
// Ordinal (non-locale) string comparison throughout — no locale-dependent
// collation, no reliance on original caller array order.

const SORT_KEY_NULL = '\u0000NULL\u0000';
const SORT_KEY_SEP = '\u0001';

function ordinalCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function scalarKeyPart(value: string | undefined): string {
  return value === undefined ? SORT_KEY_NULL : JSON.stringify(value);
}

function sortedListKeyPart(values: readonly string[] | undefined): string {
  if (values === undefined || values.length === 0) return SORT_KEY_NULL;
  return JSON.stringify([...values].sort(ordinalCompare));
}

/**
 * Canonical, complete identity key for one issue, scoped by its own code.
 * Every field that can vary between two issues sharing the same code (and,
 * for the array-keyed codes, the same first sorted id) is included, so
 * malformed duplicate-ID input cannot produce caller-order-dependent output.
 */
function deterministicIssueSortKey(issue: MappingPublicationValidationIssue): string {
  switch (issue.code) {
    case 'SNAPSHOT_NOT_DRAFT':
    case 'SNAPSHOT_VERSION_LABEL_MISSING':
    case 'SNAPSHOT_CHANGE_REASON_MISSING':
      return [issue.code, scalarKeyPart(issue.snapshotId)].join(SORT_KEY_SEP);

    case 'CONCEPT_SNAPSHOT_MISMATCH':
    case 'CONCEPT_NORMALIZED_KEY_EMPTY':
      return [issue.code, sortedListKeyPart(issue.conceptEntryIds)].join(SORT_KEY_SEP);

    case 'CONCEPT_NORMALIZED_KEY_MISMATCH':
    case 'CONCEPT_NORMALIZED_KEY_COLLISION':
      return [issue.code, sortedListKeyPart(issue.conceptEntryIds), scalarKeyPart(issue.normalizedKey)].join(
        SORT_KEY_SEP,
      );

    case 'ASSOCIATION_SNAPSHOT_MISMATCH':
    case 'ASSOCIATION_CONCEPT_NOT_FOUND':
    case 'ASSOCIATION_CONCEPT_SNAPSHOT_MISMATCH':
      return [issue.code, scalarKeyPart(issue.associationId)].join(SORT_KEY_SEP);

    case 'ASSOCIATION_RELATION_SEMANTICS_INVALID':
      // No dedicated field carries the offending literal — it only appears in
      // `message` (interpolated from the association's own relationSemantics
      // value, never raw/random) — included here to distinguish two same-ID
      // associations with different invalid literals.
      return [issue.code, scalarKeyPart(issue.associationId), scalarKeyPart(issue.message)].join(SORT_KEY_SEP);

    case 'ASSOCIATION_CATALOG_VERSION_MISMATCH':
      return [issue.code, scalarKeyPart(issue.associationId), scalarKeyPart(issue.catalogVersionId)].join(
        SORT_KEY_SEP,
      );

    case 'ASSOCIATION_INDUSTRY_NOT_FOUND':
      return [issue.code, scalarKeyPart(issue.associationId), scalarKeyPart(issue.industryId)].join(SORT_KEY_SEP);

    case 'ASSOCIATION_INDUSTRY_CATALOG_VERSION_MISMATCH':
      return [
        issue.code,
        scalarKeyPart(issue.associationId),
        scalarKeyPart(issue.industryId),
        scalarKeyPart(issue.catalogVersionId),
      ].join(SORT_KEY_SEP);

    case 'ASSOCIATION_DUPLICATE_TARGET':
      return [issue.code, sortedListKeyPart(issue.associationIds), sortedListKeyPart(issue.relationSemanticsValues)].join(
        SORT_KEY_SEP,
      );

    default: {
      const exhaustiveCheck: never = issue.code;
      return exhaustiveCheck;
    }
  }
}

function sortIssuesDeterministically(
  issues: readonly MappingPublicationValidationIssue[],
): MappingPublicationValidationIssue[] {
  return [...issues].sort((a, b) => {
    const codeDelta = ISSUE_CODE_ORDER.indexOf(a.code) - ISSUE_CODE_ORDER.indexOf(b.code);
    if (codeDelta !== 0) return codeDelta;
    return ordinalCompare(deterministicIssueSortKey(a), deterministicIssueSortKey(b));
  });
}

// ── Validator ─────────────────────────────────────────────────────────────────

export function validateProviderIndustryMappingForPublication(
  input: MappingPublicationValidatorInput,
): MappingPublicationValidationResult {
  const { snapshot, conceptEntries, associations, canonicalIndustries } = input;
  const issues: MappingPublicationValidationIssue[] = [];

  // ── Snapshot state (section 10) ──────────────────────────────────────────
  if (snapshot.status !== 'draft') {
    issues.push({
      code: 'SNAPSHOT_NOT_DRAFT',
      message: 'The mapping snapshot must be in draft status to be validated for publication.',
      snapshotId: snapshot.id,
    });
  }

  // ── Publication metadata (section 11) ────────────────────────────────────
  // Migration 082's pims_version_label_required_when_finalized /
  // pims_change_reason_required_when_finalized CHECK constraints reject NULL
  // AND blank/whitespace-only strings alike (trim(...) <> '') once the
  // snapshot leaves draft — the domain validator mirrors that exact contract,
  // it does not invent stricter rules (no length limits, no stylistic rules).
  if (snapshot.versionLabel === null || snapshot.versionLabel.trim() === '') {
    issues.push({
      code: 'SNAPSHOT_VERSION_LABEL_MISSING',
      message: 'versionLabel is required (non-null, non-blank) for publication.',
      snapshotId: snapshot.id,
    });
  }
  if (snapshot.changeReason === null || snapshot.changeReason.trim() === '') {
    issues.push({
      code: 'SNAPSHOT_CHANGE_REASON_MISSING',
      message: 'changeReason is required (non-null, non-blank) for publication.',
      snapshotId: snapshot.id,
    });
  }

  // ── Concept entries ───────────────────────────────────────────────────────
  const conceptEntryById = new Map<string, PublicationValidatorConceptEntryInput>();
  for (const concept of conceptEntries) {
    conceptEntryById.set(concept.id, concept);
  }

  for (const concept of conceptEntries) {
    if (concept.snapshotId !== snapshot.id) {
      issues.push({
        code: 'CONCEPT_SNAPSHOT_MISMATCH',
        message: 'Concept entry does not belong to the snapshot being validated.',
        conceptEntryIds: [concept.id],
      });
    }

    const expectedNormalizedKey = normalizeClassificationValue(concept.rawLabel);

    if (expectedNormalizedKey === '') {
      issues.push({
        code: 'CONCEPT_NORMALIZED_KEY_EMPTY',
        message: 'The normalized lookup key recomputed from rawLabel is empty.',
        conceptEntryIds: [concept.id],
      });
    }

    if (concept.normalizedLookupKey !== expectedNormalizedKey) {
      issues.push({
        code: 'CONCEPT_NORMALIZED_KEY_MISMATCH',
        message: 'The persisted normalized lookup key does not match the recomputed value.',
        conceptEntryIds: [concept.id],
        normalizedKey: expectedNormalizedKey,
      });
    }
  }

  // COL1 collision: group by recomputed (not persisted) non-empty key.
  // Recomputed per concept object directly (not via an id-keyed cache) so
  // malformed input with duplicate concept ids cannot silently collapse two
  // distinct rows onto a single (order-dependent) cached key.
  const conceptIdsByRecomputedKey = new Map<string, string[]>();
  for (const concept of conceptEntries) {
    const key = normalizeClassificationValue(concept.rawLabel);
    if (key === '') continue;
    const bucket = conceptIdsByRecomputedKey.get(key);
    if (bucket) {
      bucket.push(concept.id);
    } else {
      conceptIdsByRecomputedKey.set(key, [concept.id]);
    }
  }
  for (const [key, conceptIds] of conceptIdsByRecomputedKey) {
    if (conceptIds.length < 2) continue;
    issues.push({
      code: 'CONCEPT_NORMALIZED_KEY_COLLISION',
      message: 'Two or more concept entries normalize to the same lookup key.',
      conceptEntryIds: [...conceptIds].sort(),
      normalizedKey: key,
    });
  }

  // ── Associations ──────────────────────────────────────────────────────────
  const canonicalIndustryById = new Map<string, PublicationValidatorCanonicalIndustryInput>();
  for (const industry of canonicalIndustries) {
    canonicalIndustryById.set(industry.id, industry);
  }

  const relationSemanticsSet: ReadonlySet<string> = new Set(RELATION_SEMANTICS_VALUES);

  for (const association of associations) {
    if (association.snapshotId !== snapshot.id) {
      issues.push({
        code: 'ASSOCIATION_SNAPSHOT_MISMATCH',
        message: 'Association does not belong to the snapshot being validated.',
        associationId: association.id,
      });
    }

    const parentConcept = conceptEntryById.get(association.conceptEntryId);
    if (!parentConcept) {
      issues.push({
        code: 'ASSOCIATION_CONCEPT_NOT_FOUND',
        message: 'Association references a concept entry that was not found in the loaded snapshot content.',
        associationId: association.id,
      });
    } else if (parentConcept.snapshotId !== association.snapshotId) {
      issues.push({
        code: 'ASSOCIATION_CONCEPT_SNAPSHOT_MISMATCH',
        message: "Association's parent concept entry does not belong to the association's snapshot.",
        associationId: association.id,
      });
    }

    if (!relationSemanticsSet.has(association.relationSemantics)) {
      issues.push({
        code: 'ASSOCIATION_RELATION_SEMANTICS_INVALID',
        message: `Unknown relation semantics literal: ${association.relationSemantics}`,
        associationId: association.id,
      });
    }

    if (association.catalogVersionId !== snapshot.catalogVersionId) {
      issues.push({
        code: 'ASSOCIATION_CATALOG_VERSION_MISMATCH',
        message: "Association's catalogVersionId does not match the snapshot's catalogVersionId.",
        associationId: association.id,
        catalogVersionId: association.catalogVersionId,
      });
    }

    const targetIndustry = canonicalIndustryById.get(association.industryId);
    if (!targetIndustry) {
      issues.push({
        code: 'ASSOCIATION_INDUSTRY_NOT_FOUND',
        message: 'Association targets a canonical industry that was not found in the provided canonical industry set.',
        associationId: association.id,
        industryId: association.industryId,
      });
    } else if (targetIndustry.catalogVersionId !== snapshot.catalogVersionId) {
      issues.push({
        code: 'ASSOCIATION_INDUSTRY_CATALOG_VERSION_MISMATCH',
        message: 'The canonical industry targeted by this association belongs to a different catalog version.',
        associationId: association.id,
        industryId: association.industryId,
        catalogVersionId: targetIndustry.catalogVersionId,
      });
    }
  }

  // ASSOCIATION_DUPLICATE_TARGET: same (concept_entry_id, industry_id) target
  // appearing more than once in the loaded validator input. Mirrors migration
  // 082's pima_concept_industry_uniq physical uniqueness semantics. Duplicate
  // rows with conflicting relation semantics are not reconciled — both
  // literals are surfaced (lexical order) for diagnostic context only.
  const associationsByTarget = new Map<string, PublicationValidatorAssociationInput[]>();
  for (const association of associations) {
    const targetKey = `${association.conceptEntryId} ${association.industryId}`;
    const bucket = associationsByTarget.get(targetKey);
    if (bucket) {
      bucket.push(association);
    } else {
      associationsByTarget.set(targetKey, [association]);
    }
  }
  for (const group of associationsByTarget.values()) {
    if (group.length < 2) continue;
    const associationIds = group.map((a) => a.id).sort();
    const relationSemanticsValues = [...new Set(group.map((a) => a.relationSemantics))].sort();
    issues.push({
      code: 'ASSOCIATION_DUPLICATE_TARGET',
      message: 'Two or more associations target the same concept entry and industry.',
      associationIds,
      relationSemanticsValues,
    });
  }

  const orderedIssues = sortIssuesDeterministically(issues);

  if (orderedIssues.length === 0) {
    return { valid: true, issues: [] as const };
  }
  return { valid: false, issues: orderedIssues };
}
