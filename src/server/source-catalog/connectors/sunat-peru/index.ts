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
  normalizeLegalName,
  deriveTaxpayerStatus,
  normalizeSunatRecord,
} from './normalizers';

export { runSunatBulkDryRun } from './run-sunat-bulk-dry-run';

export { parseSunatBulkLines } from './sunat-bulk-parser';

export {
  createDefaultPipeConfig,
  createTabConfig,
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
} from './types';

export {
  SUNAT_BULK_SOURCE_KEY,
  SUNAT_BULK_COUNTRY_CODE,
  SUNAT_BULK_URL,
  SUNAT_BULK_MAX_SAMPLE_BYTES,
} from './types';
