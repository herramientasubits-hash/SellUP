// Q3F-5AY.2 — Record Origin Derivation Classifier (pure, Phase 1).
//
// Derives `record_origin`, `rejection_reason` and `classification_source` for
// Agent 1 candidates (`prospect_candidates`) from candidate + optional batch
// (`prospect_batches`) evidence. Based on the approved design Q3F-5AY.1.
//
// STRICTLY PURE:
//   - No DB. No fetch. No provider calls. No Supabase import. No env.
//   - Never mutates its inputs.
//   - Never throws on null/undefined/partial data.
//
// Marker semantics are aligned with the existing, canonical detector
// `isQaOrSmokeCandidateForNegativeMemory` in
// src/server/agents/prospecting-toolkit/novelty-checker.ts so the two agree on
// what counts as a smoke/QA/cleanup record.

// ─────────────────────────────────────────────────────────────────────────────
// Taxonomies (Q3F-5AY.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where the record actually came from. `synthetic` is reserved for a real
 * non-smoke synthetic path; today all synthetic SMOKE data folds into
 * `smoke_test` (see `synthetic_folded_into_smoke_test` warning).
 */
export type RecordOrigin =
  | 'production'
  | 'smoke_test'
  | 'qa'
  | 'historical_cleanup'
  | 'import'
  | 'unknown'
  | 'synthetic';

/**
 * Why a candidate was rejected/discarded/duplicated. Null unless the record is
 * discarded/duplicate. Mechanical values are safe to derive; the reserved
 * human-only commercial values must NOT be derived aggressively — only on an
 * explicit signal (see `outside_icp`).
 */
export type RejectionReason =
  // Mechanical (safe to derive):
  | 'test_record'
  | 'cleanup_record'
  | 'duplicate'
  | 'unknown'
  // Reserved / human-only (not derived aggressively):
  | 'outside_icp'
  | 'existing_account'
  | 'insufficient_data'
  | 'invalid_company'
  | 'provider_noise'
  | 'marketplace_or_directory'
  | 'geographic_mismatch'
  | 'industry_mismatch'
  | 'do_not_use'
  | 'no_longer_relevant'
  | 'other';

/** Which piece of evidence drove the classification. */
export type ClassificationSource =
  | 'writer'
  | 'derived_metadata'
  | 'derived_source_primary'
  | 'derived_review_notes'
  | 'derived_batch'
  | 'manual'
  | 'derived_status'
  | 'unknown';

/** The first rule (top-down) that matched. */
export type MatchedRule =
  | 'smoke_marker'
  | 'qa_marker'
  | 'historical_cleanup_note'
  | 'external_import'
  | 'duplicate_status'
  | 'outside_icp_note'
  | 'production_status'
  | 'discarded_unknown'
  | 'fallback_unknown';

/** Non-fatal caveats surfaced alongside a classification. */
export type ClassificationWarning =
  | 'ambiguous_review_note'
  | 'commercial_reason_low_confidence'
  | 'unknown_discarded_reason'
  | 'batch_origin_used'
  | 'synthetic_folded_into_smoke_test';

export interface RecordOriginClassification {
  recordOrigin: RecordOrigin;
  rejectionReason: RejectionReason | null;
  classificationSource: ClassificationSource;
  /** 0–100 confidence in the derivation. Explicit fields score highest. */
  classificationConfidence: number;
  matchedRule: MatchedRule;
  warnings: ClassificationWarning[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs (shaped after the real DB columns; snake_case on purpose)
// ─────────────────────────────────────────────────────────────────────────────

/** Candidate-like input. All fields optional/nullable; never mutated. */
export interface ClassifiableCandidate {
  id?: string | null;
  status?: string | null;
  duplicate_status?: string | null;
  source_primary?: string | null;
  review_notes?: string | null;
  metadata?: Record<string, unknown> | null;
  review_flags?: Record<string, unknown> | null;
  reviewed_by?: string | null;
}

/** Batch-like input. Used only as a fallback origin signal. */
export interface ClassifiableBatch {
  source?: string | null;
  name?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Statuses that indicate a live/production candidate (schema: migration 040). */
const PRODUCTION_STATUSES: ReadonlySet<string> = new Set([
  'needs_review',
  'converted_to_account',
  'approved',
  'generated',
  'normalized',
]);

const DISCARDED_STATUS = 'discarded';
const DUPLICATE_STATUS = 'duplicate';
const EXACT_DUPLICATE_MATCH = 'exact_duplicate';
const IMPORT_SOURCE = 'external_import';
const SMOKE_SOURCE_PRIMARY = 'smoke_script';

// Confidence tiers.
const CONFIDENCE_EXPLICIT_FIELD = 95;
const CONFIDENCE_METADATA = 90;
const CONFIDENCE_STATUS = 90;
const CONFIDENCE_PRODUCTION_STATUS = 80;
const CONFIDENCE_REVIEW_NOTE = 70;
const CONFIDENCE_BATCH = 60;
const CONFIDENCE_COMMERCIAL_LOW = 40;
const CONFIDENCE_DISCARDED_UNKNOWN = 30;
const CONFIDENCE_FALLBACK = 10;

// Case-insensitive Spanish/marker patterns (matched against review_notes).
const SMOKE_NOTE_RE = /smoke/i;
const QA_NOTE_RE = /\bqa\b/i;
const CLEANUP_NOTE_RE = /limpieza\s+hist[oó]rica/i;
const OUTSIDE_ICP_NOTE_RE = /fuera\s+de(?:l)?\s+segmento/i;
const SYNTHETIC_NOTE_RE = /sint[eé]tic/i;

// ─────────────────────────────────────────────────────────────────────────────
// Null-safe accessors
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asTrimmedLower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asNoteText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker detectors — each returns the driving ClassificationSource or null.
// Candidate signals win over batch signals; a batch hit reports `derived_batch`.
// ─────────────────────────────────────────────────────────────────────────────

function detectSmoke(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): ClassificationSource | null {
  if (asTrimmedLower(candidate.source_primary) === SMOKE_SOURCE_PRIMARY) {
    return 'derived_source_primary';
  }
  const meta = asRecord(candidate.metadata);
  if (meta.smoke_test === true) return 'derived_metadata';
  if (typeof meta.smoke_type === 'string' && meta.smoke_type.trim().length > 0) return 'derived_metadata';
  if (typeof meta.created_by_script === 'string' && meta.created_by_script.toLowerCase().includes('smoke')) {
    return 'derived_metadata';
  }
  if (SMOKE_NOTE_RE.test(asNoteText(candidate.review_notes))) return 'derived_review_notes';

  if (batch && batchIndicatesSmoke(batch)) return 'derived_batch';
  return null;
}

function batchIndicatesSmoke(batch: ClassifiableBatch): boolean {
  const source = asTrimmedLower(batch.source);
  const name = asTrimmedLower(batch.name);
  if (/smoke/.test(source) || /smoke/.test(name)) return true;
  if (/\btest\b/.test(source) || /\btest\b/.test(name)) return true;
  const meta = asRecord(batch.metadata);
  if (meta.smoke_test === true) return true;
  if (typeof meta.smoke_type === 'string' && meta.smoke_type.trim().length > 0) return true;
  return false;
}

function detectQa(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): ClassificationSource | null {
  const meta = asRecord(candidate.metadata);
  // do_not_use_for_sales / do_not_convert are grouped as QA/test markers by the
  // canonical novelty-checker detector; we honor that grouping here.
  if (meta.qa_only === true) return 'derived_metadata';
  if (meta.do_not_use_for_sales === true) return 'derived_metadata';
  if (meta.do_not_convert === true) return 'derived_metadata';
  if (QA_NOTE_RE.test(asNoteText(candidate.review_notes))) return 'derived_review_notes';

  if (batch && batchIndicatesQa(batch)) return 'derived_batch';
  return null;
}

function batchIndicatesQa(batch: ClassifiableBatch): boolean {
  if (QA_NOTE_RE.test(asNoteText(batch.source)) || QA_NOTE_RE.test(asNoteText(batch.name))) return true;
  const meta = asRecord(batch.metadata);
  return meta.qa_only === true;
}

function detectHistoricalCleanup(candidate: ClassifiableCandidate): ClassificationSource | null {
  if (CLEANUP_NOTE_RE.test(asNoteText(candidate.review_notes))) return 'derived_review_notes';
  const cleanup = asRecord(asRecord(candidate.metadata).logical_cleanup);
  if (cleanup.cleanup_mode === 'logical_only') return 'derived_metadata';
  return null;
}

function detectImport(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): ClassificationSource | null {
  if (asTrimmedLower(candidate.source_primary) === IMPORT_SOURCE) return 'derived_source_primary';
  if (batch && asTrimmedLower(batch.source) === IMPORT_SOURCE) return 'derived_batch';
  return null;
}

function isDuplicate(candidate: ClassifiableCandidate): boolean {
  return (
    asTrimmedLower(candidate.status) === DUPLICATE_STATUS ||
    asTrimmedLower(candidate.duplicate_status) === EXACT_DUPLICATE_MATCH
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main classifier — top-down, first match wins (R1 → R9).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the record origin + rejection reason for a candidate. Pure; the input
 * objects are read-only and never mutated. Priority is strict top-down:
 * smoke (R1) > QA (R2) > cleanup (R3) > import (R4) > duplicate (R5) >
 * outside-ICP (R6) > production status (R7) > discarded-unknown (R8) >
 * fallback (R9).
 */
export function deriveRecordOriginClassification(
  candidate: ClassifiableCandidate,
  batch?: ClassifiableBatch,
): RecordOriginClassification {
  const status = asTrimmedLower(candidate.status);
  const isDiscarded = status === DISCARDED_STATUS;
  const noteText = asNoteText(candidate.review_notes);

  // ── R1 — smoke ──────────────────────────────────────────────────────────────
  const smokeSource = detectSmoke(candidate, batch);
  if (smokeSource) {
    const warnings: ClassificationWarning[] = [];
    if (smokeSource === 'derived_batch') warnings.push('batch_origin_used');
    if (
      SYNTHETIC_NOTE_RE.test(noteText) ||
      /synth|sint/i.test(asTrimmedLower(asRecord(candidate.metadata).smoke_type))
    ) {
      warnings.push('synthetic_folded_into_smoke_test');
    }
    return {
      recordOrigin: 'smoke_test',
      rejectionReason: isDiscarded ? 'test_record' : null,
      classificationSource: smokeSource,
      classificationConfidence: confidenceForSource(smokeSource),
      matchedRule: 'smoke_marker',
      warnings,
    };
  }

  // ── R2 — QA ───────────────────────────────────────────────────────────────────
  const qaSource = detectQa(candidate, batch);
  if (qaSource) {
    const warnings: ClassificationWarning[] = [];
    if (qaSource === 'derived_batch') warnings.push('batch_origin_used');
    return {
      recordOrigin: 'qa',
      rejectionReason: isDiscarded ? 'test_record' : null,
      classificationSource: qaSource,
      classificationConfidence: confidenceForSource(qaSource),
      matchedRule: 'qa_marker',
      warnings,
    };
  }

  // ── R3 — historical cleanup ─────────────────────────────────────────────────
  const cleanupSource = detectHistoricalCleanup(candidate);
  if (cleanupSource) {
    return {
      recordOrigin: 'historical_cleanup',
      rejectionReason: isDiscarded ? 'cleanup_record' : null,
      classificationSource: cleanupSource,
      classificationConfidence: confidenceForSource(cleanupSource),
      matchedRule: 'historical_cleanup_note',
      warnings: [],
    };
  }

  // ── R4 — import ────────────────────────────────────────────────────────────────
  const importSource = detectImport(candidate, batch);
  if (importSource) {
    const warnings: ClassificationWarning[] = [];
    if (importSource === 'derived_batch') warnings.push('batch_origin_used');
    // A discarded import with no better reason: 'unknown'. Otherwise null.
    return {
      recordOrigin: 'import',
      rejectionReason: isDiscarded ? 'unknown' : null,
      classificationSource: importSource,
      classificationConfidence: confidenceForSource(importSource),
      matchedRule: 'external_import',
      warnings,
    };
  }

  // ── R5 — duplicate ───────────────────────────────────────────────────────────
  // No test/cleanup/import markers matched, so a duplicate is a production
  // pipeline outcome flagged as a repeat.
  if (isDuplicate(candidate)) {
    return {
      recordOrigin: 'production',
      rejectionReason: 'duplicate',
      classificationSource: 'derived_status',
      classificationConfidence: CONFIDENCE_STATUS,
      matchedRule: 'duplicate_status',
      warnings: [],
    };
  }

  // ── R6 — outside ICP (explicit note only, low confidence) ─────────────────────
  if (OUTSIDE_ICP_NOTE_RE.test(noteText)) {
    return {
      recordOrigin: 'production',
      rejectionReason: 'outside_icp',
      classificationSource: 'derived_review_notes',
      classificationConfidence: CONFIDENCE_COMMERCIAL_LOW,
      matchedRule: 'outside_icp_note',
      warnings: ['commercial_reason_low_confidence'],
    };
  }

  // ── R7 — clean production status ──────────────────────────────────────────────
  if (PRODUCTION_STATUSES.has(status)) {
    return {
      recordOrigin: 'production',
      rejectionReason: null,
      classificationSource: 'derived_status',
      classificationConfidence: CONFIDENCE_PRODUCTION_STATUS,
      matchedRule: 'production_status',
      warnings: [],
    };
  }

  // ── R8 — discarded with no marker ─────────────────────────────────────────────
  if (isDiscarded) {
    const warnings: ClassificationWarning[] = ['unknown_discarded_reason'];
    if (noteText.trim().length > 0) warnings.push('ambiguous_review_note');
    return {
      recordOrigin: 'unknown',
      rejectionReason: 'unknown',
      classificationSource: 'derived_status',
      classificationConfidence: CONFIDENCE_DISCARDED_UNKNOWN,
      matchedRule: 'discarded_unknown',
      warnings,
    };
  }

  // ── R9 — fallback ───────────────────────────────────────────────────────────────
  return {
    recordOrigin: 'unknown',
    rejectionReason: null,
    classificationSource: 'unknown',
    classificationConfidence: CONFIDENCE_FALLBACK,
    matchedRule: 'fallback_unknown',
    warnings: [],
  };
}

function confidenceForSource(source: ClassificationSource): number {
  switch (source) {
    case 'derived_source_primary':
      return CONFIDENCE_EXPLICIT_FIELD;
    case 'derived_metadata':
      return CONFIDENCE_METADATA;
    case 'derived_status':
      return CONFIDENCE_STATUS;
    case 'derived_review_notes':
      return CONFIDENCE_REVIEW_NOTE;
    case 'derived_batch':
      return CONFIDENCE_BATCH;
    default:
      return CONFIDENCE_FALLBACK;
  }
}
