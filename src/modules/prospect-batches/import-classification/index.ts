// ── Public API — Import Classification (16AB.37) ──────────────────────────────

// Types
export type {
  ClassificationMatchStatus,
  ClassificationSource,
  ClassificationWarningCode,
  ClassificationWarning,
  ImportedProspectClassification,
  ImportCatalogIndustry,
  ImportCatalogSubindustry,
  ImportCatalogAlias,
  ImportClassificationCatalog,
  ImportCatalogIndexes,
  CatalogIndexIssueCode,
  CatalogIndexIssue,
  CatalogIndexBuildResult,
  ImportClassificationRowInput,
  ImportClassificationBatchRow,
  ImportClassificationBatchInput,
  ImportClassificationBatchResult,
  ClassificationValidationStatus,
} from './import-classification-types';

// Core functions
export { normalizeClassificationValue } from './catalog-normalization';
export { buildImportCatalogIndexes } from './catalog-index-builder';
export {
  normalizeImportedProspectClassification,
  normalizeImportedProspectClassifications,
} from './import-catalog-normalizer';
export { deriveClassificationValidationStatus } from './import-classification-selectors';
