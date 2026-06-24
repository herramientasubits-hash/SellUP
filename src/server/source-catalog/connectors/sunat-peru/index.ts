/**
 * SUNAT Peru Bulk Connector — Public API
 *
 * Exports del conector seguro SUNAT Padrón Reducido RUC.
 * Solo server-side. No importar desde Client Components.
 */

export {
  checkSunatBulkAvailability,
  probeSunatBulkRange,
} from './sunat-bulk-client';
export type { SunatBulkHeadResult, SunatBulkProbeResult } from './sunat-bulk-client';

export {
  normalizeRuc,
  isValidRuc,
  isLikelyCompanyRuc,
  isNaturalPersonRuc,
  classifyRuc,
  normalizeLegalName,
  deriveTaxpayerStatus,
  normalizeSunatRecord,
} from './normalizers';
export type { RucCategory } from './normalizers';

export { runSunatBulkDryRun } from './run-sunat-bulk-dry-run';

export { parseSunatBulkLines } from './sunat-bulk-parser';

export { probeSunatZipStructure } from './sunat-zip-probe';

export { extractSunatBulkSample } from './sunat-sample-extractor';

export { runSunatBulkSampleParseDryRun } from './sunat-sample-parse-dry-run';

export {
  createDefaultPipeConfig,
  createTabConfig,
  SUNAT_PADRON_REDUCIDO_REAL_CONFIG,
  SUNAT_REAL_EXPECTED_COLUMN_COUNT,
  PIPE_COLUMN_MAPPING,
  PIPE_DELIMITER,
  TAB_DELIMITER,
  COMMA_DELIMITER,
} from './sunat-bulk-parser-config';

export type {
  SunatBulkAvailabilityStatus,
  SunatBulkHttpMetadata,
  SunatBulkDryRunInput,
  SunatBulkDryRunOutput,
  SunatBulkParsedRecord,
  SunatBulkNormalizedCompany,
  SunatBulkValidationWarning,
  SunatBulkDownloadGuard,
  SunatBulkDelimiter,
  SunatBulkColumnMapping,
  SunatBulkParserConfig,
  SunatBulkParseInput,
  SunatBulkParseOutput,
  SunatBulkLineParseResult,
  SunatBulkParserWarning,
  SunatBulkParserStats,
  SunatZipProbeInput,
  SunatZipProbeOutput,
  SunatZipCentralDirectoryEntry,
  SunatZipProbeWarning,
  SunatZipProbeStats,
  SunatZipProbeStatus,
  SunatBulkSampleExtractionInput,
  SunatBulkSampleExtractionOutput,
  SunatBulkSampleLine,
  SunatBulkSampleExtractionStats,
  SunatBulkSampleExtractionWarning,
  SunatBulkDelimiterInference,
  SunatBulkSampleParseDryRunInput,
  SunatBulkSampleParseDryRunOutput,
  SunatBulkSampleParseDryRunExtraction,
  SunatBulkSampleParseDryRunParsing,
  SunatBulkSampleParseDryRunSampleCompany,
  SunatBulkSampleParseDryRunObservation,
  SunatBulkB2bSampleStatus,
  SunatBulkDryRunRecommendation,
  SunatBulkSampleParseDryRunStatus,
} from './types';

export {
  SUNAT_BULK_SOURCE_KEY,
  SUNAT_BULK_COUNTRY_CODE,
  SUNAT_BULK_URL,
  SUNAT_BULK_MAX_SAMPLE_BYTES,
} from './types';
