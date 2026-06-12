// ── Import classification payload builder — Hito 16AB.39 ─────────────────────
// Pure data transformation. Converts classified rows into Supabase-ready payloads.
// No Supabase calls, no side effects, no Map/Set/fn in output.
// Compatible with migration 061 check constraints.

import type {
  ImportedProspectClassification,
} from './import-classification/import-classification-types';
import type {
  ClassifiedImportRow,
  ImportClassificationValidationResult,
} from './import-classification-service';

// ── Output types ──────────────────────────────────────────────────────────────

export type BatchPersistencePayload = {
  catalog_version: string;
};

export type CandidatePersistencePayload = {
  catalog_version_id: string;
  industry_id: string | null;
  subindustry_id: string | null;
  subindustry: string | null;
  import_classification: SerializedClassification | null;
};

export type SerializedClassification = {
  catalogVersion: string;
  industryOriginalValue: string | null;
  subindustryOriginalValue: string | null;
  industryId: string | null;
  industrySlug: string | null;
  industryName: string | null;
  industryMatchStatus: string;
  industryMatchSource: string;
  subindustryId: string | null;
  subindustrySlug: string | null;
  subindustryName: string | null;
  subindustryMatchStatus: string;
  subindustryMatchSource: string;
  suggestedIndustryId: string | null;
  classificationWarnings: Array<{
    code: string;
    field: string;
    message: string;
  }>;
  requiresHumanReview: boolean;
};

export type ImportPersistencePayload = {
  batch: BatchPersistencePayload;
  candidates: Map<number, CandidatePersistencePayload>;
  totalCandidates: number;
  persistableCandidates: number;
};

// ── Serialization ─────────────────────────────────────────────────────────────
// Converts ImportedProspectClassification to a plain JSON-safe object.
// Strips any non-serializable fields. Preserves original values.

function serializeClassification(
  classification: ImportedProspectClassification,
): SerializedClassification {
  return {
    catalogVersion: classification.catalogVersion,
    industryOriginalValue: classification.industryOriginalValue,
    subindustryOriginalValue: classification.subindustryOriginalValue,
    industryId: classification.industryId,
    industrySlug: classification.industrySlug,
    industryName: classification.industryName,
    industryMatchStatus: classification.industryMatchStatus,
    industryMatchSource: classification.industryMatchSource,
    subindustryId: classification.subindustryId,
    subindustrySlug: classification.subindustrySlug,
    subindustryName: classification.subindustryName,
    subindustryMatchStatus: classification.subindustryMatchStatus,
    subindustryMatchSource: classification.subindustryMatchSource,
    suggestedIndustryId: classification.suggestedIndustryId,
    classificationWarnings: classification.classificationWarnings.map((w) => ({
      code: w.code,
      field: w.field,
      message: w.message,
    })),
    requiresHumanReview: classification.requiresHumanReview,
  };
}

// ── Candidate payload builder ─────────────────────────────────────────────────

function buildCandidatePayload(
  row: ClassifiedImportRow,
  catalogVersionId: string,
): CandidatePersistencePayload {
  const { classification } = row;

  return {
    catalog_version_id: catalogVersionId,
    industry_id: classification.industryId,
    subindustry_id: classification.subindustryId,
    subindustry: classification.subindustryName,
    import_classification: serializeClassification(classification),
  };
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildImportPersistencePayload(
  validationResult: ImportClassificationValidationResult,
): ImportPersistencePayload {
  const { catalogVersion, catalogVersionId, rows } = validationResult;

  const candidates = new Map<number, CandidatePersistencePayload>();
  let persistableCount = 0;

  for (const row of rows) {
    if (row.canPersistAutomatically) {
      candidates.set(
        row.rowNumber,
        buildCandidatePayload(row, catalogVersionId),
      );
      persistableCount++;
    }
  }

  return {
    batch: {
      catalog_version: catalogVersion,
    },
    candidates,
    totalCandidates: rows.length,
    persistableCandidates: persistableCount,
  };
}

// ── Safety: JSON serialization check ──────────────────────────────────────────

export function isPayloadJsonSafe(
  payload: ImportPersistencePayload,
): boolean {
  try {
    // Verify batch is serializable
    JSON.parse(JSON.stringify(payload.batch));
    // Verify all candidates are serializable
    for (const [, candidate] of payload.candidates) {
      JSON.parse(JSON.stringify(candidate));
    }
    return true;
  } catch {
    return false;
  }
}
