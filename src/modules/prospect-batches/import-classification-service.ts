// ── Import classification service — Hito 16AB.39 ─────────────────────────────
// Server-only orchestrator. Pure data transformation (no Supabase reads/writes).
// Receives parsed rows + catalog, produces classified rows with validation status.
// Does NOT persist data. Does NOT call AI or external providers.

import type { ImportRow } from './import-candidates-parser';
import type {
  ImportClassificationCatalog,
  ImportedProspectClassification,
  ClassificationValidationStatus,
  ImportClassificationBatchRow,
} from './import-classification/import-classification-types';
import {
  normalizeImportedProspectClassifications,
} from './import-classification/import-catalog-normalizer';
import { deriveClassificationValidationStatus } from './import-classification/import-classification-selectors';

// ── Output types ──────────────────────────────────────────────────────────────

export type ClassifiedImportRow = {
  rowNumber: number;
  parsedRow: ImportRow;
  classification: ImportedProspectClassification;
  validationStatus: ClassificationValidationStatus;
  canPersistAutomatically: boolean;
};

export type ImportClassificationBlockingIssue = {
  rowNumber: number;
  code: string;
  field: string;
  message: string;
};

export type ImportClassificationValidationResult = {
  valid: boolean;
  catalogVersion: string;
  catalogVersionId: string;

  rows: ClassifiedImportRow[];

  summary: {
    totalRows: number;
    readyRows: number;
    normalizedRows: number;
    warningRows: number;
    reviewRows: number;
    invalidRows: number;
  };

  blockingIssues: ImportClassificationBlockingIssue[];
};

// ── Blocking statuses (cannot auto-persist) ──────────────────────────────────

const BLOCKING_VALIDATION_STATUSES = new Set<ClassificationValidationStatus>([
  'requires_review',
  'invalid',
]);

// ── Main service ──────────────────────────────────────────────────────────────

export function classifyImportRows(input: {
  rows: ImportRow[];
  catalog: ImportClassificationCatalog;
  catalogVersionId: string;
}): ImportClassificationValidationResult {
  const { rows, catalog, catalogVersionId } = input;

  // 1. Build classification batch input (preserve order, capture original values)
  const batchRows: ImportClassificationBatchRow[] = rows.map((row) => ({
    industryValue: row.industryOriginalValue,
    subindustryValue: row.subindustryOriginalValue,
    countryCode: row.resolved_country_code,
  }));

  // 2. Run the normalizer (builds indexes once, classifies all rows)
  const batchResult = normalizeImportedProspectClassifications({
    rows: batchRows,
    catalog,
  });

  // 3. Derive validation status and canPersistAutomatically per row
  const classifiedRows: ClassifiedImportRow[] = [];
  const blockingIssues: ImportClassificationBlockingIssue[] = [];

  let readyRows = 0;
  let normalizedRows = 0;
  let warningRows = 0;
  let reviewRows = 0;
  let invalidRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const parsedRow = rows[i];
    const classification = batchResult.rows[i];

    if (!classification) {
      // Catalog structural error prevented classification for this row
      invalidRows++;
      classifiedRows.push({
        rowNumber: parsedRow.index + 1,
        parsedRow,
        classification: buildEmptyClassification(catalog.version, parsedRow),
        validationStatus: 'invalid',
        canPersistAutomatically: false,
      });
      blockingIssues.push({
        rowNumber: parsedRow.index + 1,
        code: 'classification_failed',
        field: 'industry',
        message: 'Catalog structural error prevented classification.',
      });
      continue;
    }

    const validationStatus = deriveClassificationValidationStatus(classification);
    const isBlocking = BLOCKING_VALIDATION_STATUSES.has(validationStatus);
    const canPersistAutomatically = !isBlocking && !classification.requiresHumanReview;

    // Count summary categories
    switch (validationStatus) {
      case 'valid':
        readyRows++;
        break;
      case 'normalized':
        normalizedRows++;
        break;
      case 'warning':
        warningRows++;
        break;
      case 'requires_review':
        reviewRows++;
        break;
      case 'invalid':
        invalidRows++;
        break;
    }

    classifiedRows.push({
      rowNumber: parsedRow.index + 1,
      parsedRow,
      classification,
      validationStatus,
      canPersistAutomatically,
    });

    // Collect blocking issues for rows that require review
    if (isBlocking) {
      for (const warning of classification.classificationWarnings) {
        blockingIssues.push({
          rowNumber: parsedRow.index + 1,
          code: warning.code,
          field: warning.field,
          message: warning.message,
        });
      }

      // If no warnings but still requires review, add a generic issue
      if (classification.classificationWarnings.length === 0 && classification.requiresHumanReview) {
        blockingIssues.push({
          rowNumber: parsedRow.index + 1,
          code: 'requires_human_review',
          field: 'industry',
          message: 'Row requires human review based on classification result.',
        });
      }
    }
  }

  // 4. Determine overall validity
  const valid = blockingIssues.length === 0;

  return {
    valid,
    catalogVersion: catalog.version,
    catalogVersionId,
    rows: classifiedRows,
    summary: {
      totalRows: rows.length,
      readyRows,
      normalizedRows,
      warningRows,
      reviewRows,
      invalidRows,
    },
    blockingIssues,
  };
}

// ── Helper: empty classification for failed rows ─────────────────────────────

function buildEmptyClassification(
  catalogVersion: string,
  parsedRow: ImportRow,
): ImportedProspectClassification {
  return {
    catalogVersion,
    industryOriginalValue: parsedRow.industryOriginalValue,
    subindustryOriginalValue: parsedRow.subindustryOriginalValue,
    industryId: null,
    industrySlug: null,
    industryName: null,
    industryMatchStatus: 'not_found',
    industryMatchSource: 'none',
    subindustryId: null,
    subindustrySlug: null,
    subindustryName: null,
    subindustryMatchStatus: 'not_found',
    subindustryMatchSource: 'none',
    suggestedIndustryId: null,
    classificationWarnings: [],
    requiresHumanReview: true,
  };
}
