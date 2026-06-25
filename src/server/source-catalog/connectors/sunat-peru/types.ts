/**
 * SUNAT Peru Bulk Connector — Types
 *
 * Tipos para el conector seguro del Padrón Reducido RUC de SUNAT.
 * Solo disponibilidad y metadata HTTP. Sin descarga completa.
 * Sin writes. Sin candidatos.
 *
 * local/offline/development-only — No ejecutar en Vercel ni production.
 */

export const SUNAT_BULK_SOURCE_KEY = 'pe_sunat_bulk';
export const SUNAT_BULK_COUNTRY_CODE = 'PE';
export const SUNAT_BULK_URL = 'http://www2.sunat.gob.pe/padron_reducido_ruc.zip';
export const SUNAT_BULK_MAX_SAMPLE_BYTES = 512 * 1024;
export const SUNAT_BULK_HEAD_TIMEOUT_MS = 15_000;
export const SUNAT_BULK_PROBE_TIMEOUT_MS = 30_000;

export type SunatBulkAvailabilityStatus = 'available' | 'unavailable' | 'blocked' | 'error';

export type SunatBulkHttpMetadata = {
  url: string;
  httpStatus: number | null;
  ok: boolean;
  contentType?: string;
  contentLengthBytes?: number;
  lastModified?: string;
  acceptRanges?: string;
  supportsRangeRequests?: boolean;
  responseTimeMs?: number;
};

export type SunatBulkDryRunInput = {
  mode?: 'availability_check' | 'sample_probe';
  maxSampleBytes?: number;
};

export type SunatBulkDryRunOutput = {
  sourceKey: 'pe_sunat_bulk';
  mode: 'availability_check' | 'sample_probe';
  status: SunatBulkAvailabilityStatus;
  metadata: SunatBulkHttpMetadata;
  guard: SunatBulkDownloadGuard;
  sample?: {
    attempted: boolean;
    method: 'range_request' | 'not_attempted';
    recordsParsed: number;
    normalizedCompanies: SunatBulkNormalizedCompany[];
    warnings: SunatBulkValidationWarning[];
  };
  warnings: string[];
  errors: string[];
};

export type SunatBulkDownloadGuard = {
  fullDownloadAllowed: false;
  reason: string;
  maxAllowedBytesForDryRun: number;
  observedContentLengthBytes?: number;
};

/**
 * Registro raw SUNAT tal como se espera del parser futuro.
 * Una línea del Padrón Reducido RUC.
 */
export type SunatBulkParsedRecord = {
  ruc: string;
  legalName: string;
  taxpayerStatus?: string;
  domicileCondition?: string;
  ubigeo?: string;
  department?: string;
  province?: string;
  district?: string;
  address?: string;
};

/**
 * Empresa normalizada para dry-run.
 * No es un prospect_candidate — solo muestra de disponibilidad.
 */
export type SunatBulkNormalizedCompany = {
  sourceKey: 'pe_sunat_bulk';
  countryCode: 'PE';
  taxIdentifier: string;
  taxIdentifierType: 'RUC';
  legalName: string;
  companyName: string;
  taxpayerStatus?: string;
  domicileCondition?: string;
  ubigeo?: string;
  department?: string;
  province?: string;
  district?: string;
  address?: string;
  isActiveTaxpayer?: boolean;
  isLikelyCompany?: boolean;
  exclusionReasons: string[];
};

export type SunatBulkValidationWarning =
  | 'empty_legal_name'
  | 'invalid_ruc'
  | 'possible_natural_person'
  | 'ruc_not_11_digits'
  | 'inactive_taxpayer'
  | 'large_file_warning'
  | 'partial_zip_no_records'
  | 'unexpected_file_format'
  | 'empty_sample_response';

// ─── Line Parser Types ───────────────────────────────────────────────────────────

export type SunatBulkDelimiter = '|' | '\t' | ',';

export interface SunatBulkColumnMapping {
  ruc: number;
  legalName: number;
  taxpayerStatus?: number;
  domicileCondition?: number;
  ubigeo?: number;
  department?: number;
  province?: number;
  district?: number;
  address?: number;
}

export interface SunatBulkParserConfig {
  delimiter: SunatBulkDelimiter;
  columnMapping: SunatBulkColumnMapping;
  skipEmptyLines: boolean;
  maxLineLength: number;
  strictMode: boolean;
  hasHeaderRow?: boolean;
  includeNaturalPersons?: boolean;
  expectedColumnCount?: number;
}

export interface SunatBulkParseInput {
  lines: string[];
  config: SunatBulkParserConfig;
}

export interface SunatBulkParserWarning {
  code: string;
  message: string;
  lineNumber: number;
  redactedLinePreview?: string;
}

export interface SunatBulkParserStats {
  inputLines: number;
  parsedLines: number;
  validCompanies: number;
  invalidLines: number;
  skippedNaturalPersons: number;
  skippedNonCompanyRuc: number;
  headerRowsSkipped: number;
  activeCompanies: number;
  inactiveCompanies: number;
}

export interface SunatBulkLineParseResult {
  lineNumber: number;
  success: boolean;
  company?: SunatBulkNormalizedCompany;
  warning?: SunatBulkParserWarning;
  error?: string;
}

export interface SunatBulkParseOutput {
  sourceKey: 'pe_sunat_bulk';
  mode: 'line_parser';
  companies: SunatBulkNormalizedCompany[];
  stats: SunatBulkParserStats;
  warnings: SunatBulkParserWarning[];
  errors: string[];
}

// ─── ZIP Probe Types ─────────────────────────────────────────────────────────────

export type SunatZipProbeInput = {
  maxTailBytes?: number;
};

export type SunatZipCentralDirectoryEntry = {
  fileName: string;
  compressedSizeBytes?: number;
  uncompressedSizeBytes?: number;
  compressionMethod?: number;
  lastModifiedRaw?: string;
  localHeaderOffset?: number;
  fileNameLength?: number;
  extraFieldLength?: number;
  likelyTextFile: boolean;
  likelyCsvFile: boolean;
  likelyLargeFile: boolean;
};

export type SunatZipProbeWarning =
  | 'no_content_length'
  | 'no_range_support'
  | 'eocd_not_found'
  | 'central_directory_truncated'
  | 'range_exceeds_maximum'
  | 'fetch_error'
  | 'empty_response';

export type SunatZipProbeStats = {
  entriesDetected: number;
  totalCompressedSizeBytes?: number;
  totalUncompressedSizeBytes?: number;
  eocdFound: boolean;
  centralDirectoryParsed: boolean;
};

export type SunatZipProbeStatus = 'probed' | 'partial' | 'blocked' | 'error';

export type SunatZipProbeOutput = {
  sourceKey: 'pe_sunat_bulk';
  mode: 'zip_structure_probe';
  status: SunatZipProbeStatus;
  metadata: SunatBulkHttpMetadata;
  probe: {
    attempted: boolean;
    method: 'range_tail';
    requestedBytes: number;
    eocdFound: boolean;
    centralDirectoryParsed: boolean;
    entries: SunatZipCentralDirectoryEntry[];
  };
  stats: SunatZipProbeStats;
  guard: SunatBulkDownloadGuard;
  warnings: SunatZipProbeWarning[];
  errors: string[];
};

// ─── Sample Extraction Types ─────────────────────────────────────────────────────

export type SunatBulkSampleExtractionInput = {
  maxCompressedBytes?: number;
  maxDecompressedBytes?: number;
  maxLines?: number;
};

export type SunatBulkSampleLine = {
  lineNumber: number;
  columnCount?: number;
  redactedPreview: string;
};

export type SunatBulkSampleExtractionStats = {
  compressedBytesRead: number;
  decompressedBytesRead: number;
  linesDetected: number;
  linesReturned: number;
  truncated: boolean;
  rangeRequestMode: 'open_ended_stream_capped' | 'bounded_range';
};

// ─── Sample Parse Dry-Run Types ────────────────────────────────────────────────────

export interface SunatBulkSampleParseDryRunInput {
  maxCompressedBytesToRead?: number;
  maxDecompressedBytesToRead?: number;
  maxLinesToReturn?: number;
  includeNaturalPersons?: boolean;
}

export type SunatBulkB2bSampleStatus =
  | 'companies_found'
  | 'only_natural_persons_in_head_sample'
  | 'no_parseable_lines'
  | 'blocked'
  | 'error';

export type SunatBulkDryRunRecommendation =
  | 'ready_for_candidate_preview'
  | 'needs_deeper_local_scan'
  | 'needs_full_local_snapshot_strategy'
  | 'blocked';

export interface SunatBulkSampleParseDryRunExtraction {
  status: string;
  fileName?: string;
  compressedBytesRead: number;
  decompressedBytesRead: number;
  linesDetected: number;
  linesReturned: number;
  inferredDelimiter?: string;
  inferredColumnCount?: number;
  streamCancelled: boolean;
  fullDownloadPrevented: boolean;
}

export interface SunatBulkSampleParseDryRunParsing {
  inputLines: number;
  headerRowsSkipped: number;
  validCompanies: number;
  skippedNaturalPersons: number;
  skippedNonCompanyRuc: number;
  invalidLines: number;
  activeCompanies: number;
  inactiveCompanies: number;
}

export interface SunatBulkSampleParseDryRunSampleCompany {
  taxIdentifier: string;
  legalName: string;
  taxpayerStatus?: string;
  domicileCondition?: string;
  ubigeo?: string;
  isActiveTaxpayer?: boolean;
  isLikelyCompany?: boolean;
}

export interface SunatBulkSampleParseDryRunObservation {
  b2bSampleStatus: SunatBulkB2bSampleStatus;
  recommendation: SunatBulkDryRunRecommendation;
  reason: string;
}

export type SunatBulkSampleParseDryRunStatus = 'parsed' | 'sampled_no_companies' | 'blocked' | 'error';

export interface SunatBulkSampleParseDryRunOutput {
  sourceKey: 'pe_sunat_bulk';
  mode: 'sample_parse_dry_run';
  status: SunatBulkSampleParseDryRunStatus;
  extraction: SunatBulkSampleParseDryRunExtraction;
  parsing: SunatBulkSampleParseDryRunParsing;
  sampleCompanies: SunatBulkSampleParseDryRunSampleCompany[];
  sampleObservation: SunatBulkSampleParseDryRunObservation;
  warnings: string[];
  errors: string[];
}

export type SunatBulkSampleExtractionWarning = {
  code: string;
  message: string;
};

export type SunatBulkDelimiterInference = 'pipe' | 'tab' | 'comma' | 'unknown';

export type SunatBulkSampleExtractionOutput = {
  sourceKey: 'pe_sunat_bulk';
  mode: 'controlled_sample_extraction';
  status: 'sampled' | 'partial' | 'blocked' | 'error';
  entry: {
    fileName: string;
    compressedSizeBytes?: number;
    uncompressedSizeBytes?: number;
    compressionMethod?: number;
    compressedDataStartOffset?: number;
  };
  guard: {
    fullDownloadAllowed: false;
    maxCompressedBytesToRead: number;
    maxDecompressedBytesToRead: number;
    maxLinesToReturn: number;
    reason: string;
  };
  sample: {
    lines: SunatBulkSampleLine[];
    /**
     * INTERNAL ONLY — Artefacto de dry-run para conectar extractor + parser.
     * NO debe persistirse en Supabase.
     * NO debe exponerse en UI.
     * NO debe incluirse en metadata de candidatos.
     * NO debe usarse fuera del conector SUNAT Perú.
     * Máximo ABSOLUTE_MAX_LINES (200) líneas.
     * No es rawRows/allRows/fullRows del ZIP completo.
     */
    fullSampleLines: string[];
    inferredDelimiter?: SunatBulkDelimiterInference;
    inferredColumnCount?: number;
    parserConfigSuggestion?: string;
  };
  stats: SunatBulkSampleExtractionStats;
  warnings: SunatBulkSampleExtractionWarning[];
  errors: string[];
}

// ─── Local Deeper Scan Types ──────────────────────────────────────────────────────
// local/offline/development-only
// No ejecutar en Vercel ni production.

export type SunatLocalDeeperScanInput = {
  tempDir?: string;
  targetCompanyCount?: number;
  maxLinesToScan?: number;
  maxDecompressedBytes?: number;
  maxDurationMs?: number;
  downloadIfMissing?: boolean;
  requireAck?: boolean;
};

export type SunatLocalDeeperScanStatus =
  | 'completed'
  | 'completed_no_companies'
  | 'blocked'
  | 'error';

export type SunatLocalDeeperScanEnvironment = {
  localOnly: true;
  vercelDetected: boolean;
  productionDetected: boolean;
  ackProvided: boolean;
  tempDirIgnoredByGit: boolean;
};

export type SunatLocalDeeperScanDownload = {
  attempted: boolean;
  reusedExistingFile: boolean;
  zipPath?: string;
  contentLengthBytes?: number;
  bytesWritten?: number;
  completed: boolean;
};

export type SunatLocalDeeperScanZipEntry = {
  fileName: string;
  compressedSizeBytes?: number;
  uncompressedSizeBytes?: number;
  compressionMethod?: number;
  compressedDataStartOffset?: number;
};

export type SunatLocalDeeperScanStopReason =
  | 'target_company_count_reached'
  | 'max_lines_reached'
  | 'max_decompressed_bytes_reached'
  | 'max_duration_reached'
  | 'end_of_file'
  | 'error';

export type SunatLocalDeeperScanSampleCompany = {
  taxIdentifier: string;
  legalName: string;
  taxpayerStatus?: string;
  domicileCondition?: string;
  ubigeo?: string;
  isActiveTaxpayer?: boolean;
  redactedPreview?: string;
};

export type SunatLocalDeeperScanDistributionItem = {
  value: string;
  count: number;
};

export type SunatLocalDeeperScanDistributions = {
  taxpayerStatusTop?: SunatLocalDeeperScanDistributionItem[];
  domicileConditionTop?: SunatLocalDeeperScanDistributionItem[];
  ubigeoTop?: SunatLocalDeeperScanDistributionItem[];
  departmentTop?: SunatLocalDeeperScanDistributionItem[];
};

export type SunatLocalDeeperScanHeader = {
  detected: boolean;
  columns: string[];
  columnCount: number;
};

export type SunatLocalDeeperScanRecommendation =
  | 'ready_for_candidate_preview_design'
  | 'needs_full_local_snapshot_strategy'
  | 'blocked'
  | 'error';

export type SunatLocalDeeperScanScan = {
  linesScanned: number;
  decompressedBytesRead: number;
  headerRowsSkipped: number;
  naturalPersonsSkipped: number;
  unsupportedRucSkipped: number;
  invalidLines: number;
  companiesFound: number;
  firstCompanyLineNumber?: number;
  stoppedBecause: SunatLocalDeeperScanStopReason;
};

export type SunatLocalDeeperScanOutput = {
  sourceKey: 'pe_sunat_bulk';
  mode: 'local_deeper_scan';
  status: SunatLocalDeeperScanStatus;
  environment: SunatLocalDeeperScanEnvironment;
  download: SunatLocalDeeperScanDownload;
  zipEntry: SunatLocalDeeperScanZipEntry;
  scan: SunatLocalDeeperScanScan;
  sampleCompanies: SunatLocalDeeperScanSampleCompany[];
  distributions: SunatLocalDeeperScanDistributions;
  header: SunatLocalDeeperScanHeader;
  ciiuAvailability: string;
  recommendation: SunatLocalDeeperScanRecommendation;
  warnings: string[];
  errors: string[];
}

// ─── Local RUC20 Filtered Snapshot Types ─────────────────────────────────────────
// local/offline/development-only
// No ejecutar en Vercel ni production.

export type SunatLocalRuc20SnapshotInput = {
  tempDir?: string;
  zipPath?: string;
  outputPath?: string;
  reportPath?: string;
  requireAck?: boolean;
  maxLinesToScan?: number;
  maxDurationMs?: number;
  overwrite?: boolean;
};

export type SunatLocalRuc20SnapshotStatus = 'completed' | 'blocked' | 'error';

export type SunatLocalRuc20SnapshotEnvironment = {
  localOnly: true;
  vercelDetected: boolean;
  productionDetected: boolean;
  ackProvided: boolean;
  tempDirIgnoredByGit: boolean;
};

export type SunatLocalRuc20SnapshotStopReason =
  | 'end_of_file'
  | 'max_lines_reached'
  | 'max_duration_reached'
  | 'error';

export type SunatLocalRuc20SnapshotDistributionItem = {
  value: string;
  count: number;
};

export type SunatLocalRuc20SnapshotQualityVerdict =
  | 'usable_for_candidate_preview'
  | 'weak_due_to_low_active_habido_density'
  | 'weak_due_to_missing_sector_ciiu'
  | 'not_usable_for_discovery';

export type SunatLocalRuc20SnapshotSampleCompany = {
  taxIdentifier: string;
  legalName: string;
  taxpayerStatus: string;
  domicileCondition: string;
  ubigeo?: string;
  redactedPreview: string;
};

export type SunatLocalRuc20SnapshotOutput = {
  sourceKey: 'pe_sunat_bulk';
  mode: 'local_ruc20_filtered_snapshot';
  status: SunatLocalRuc20SnapshotStatus;
  environment: SunatLocalRuc20SnapshotEnvironment;
  input: {
    zipPath: string;
    zipBytes: number;
    entryName: string;
  };
  output: {
    snapshotPath: string;
    reportPath: string;
    snapshotBytesWritten: number;
    reportBytesWritten: number;
  };
  scan: {
    totalLinesScanned: number;
    headerRowsSkipped: number;
    ruc10Rows: number;
    ruc20Rows: number;
    unsupportedRucRows: number;
    invalidRows: number;
    activeRuc20Rows: number;
    activeHabidoRuc20Rows: number;
    inactiveRuc20Rows: number;
    firstRuc20LineNumber?: number;
    lastRuc20LineNumber?: number;
    stoppedBecause: SunatLocalRuc20SnapshotStopReason;
  };
  distributions: {
    ruc20TaxpayerStatusTop: SunatLocalRuc20SnapshotDistributionItem[];
    ruc20DomicileConditionTop: SunatLocalRuc20SnapshotDistributionItem[];
    ruc20UbigeoTop: SunatLocalRuc20SnapshotDistributionItem[];
  };
  quality: {
    hasEnoughRuc20ForCandidatePreview: boolean;
    hasEnoughActiveHabido: boolean;
    ubigeoCoverageRate: number;
    ciiuAvailable: boolean;
    verdict: SunatLocalRuc20SnapshotQualityVerdict;
    reason: string;
  };
  sampleActiveHabidoCompanies: SunatLocalRuc20SnapshotSampleCompany[];
  warnings: string[];
  errors: string[];
};

// ─── Migo Vault API Spike Types ──────────────────────────────────────────────
// local/offline/development-only
// No ejecutar en Vercel ni production. Spike controlado con credencial Vault.

export const MIGO_SOURCE_KEY = 'pe_migo_api';
export const MIGO_API_BASE = 'https://api.migo.pe';
export const MIGO_API_PATH = '/api/v1/ruc';

export interface MigoVaultApiSpikeInput {
  sourceKey?: 'pe_migo_api';
  requireAck?: boolean;
  maxRucsToTest?: number;
  throttleMs?: number;
  requestTimeoutMs?: number;
  ruc20SnapshotPath?: string;
  reportPath?: string;
  sampleRucs?: string[];
}

export type MigoVaultApiSpikeStatus =
  | 'completed'
  | 'blocked'
  | 'missing_vault_credential'
  | 'unauthorized'
  | 'rate_limited'
  | 'error';

export interface MigoVaultApiSpikeEnvironment {
  localOnly: true;
  vercelDetected: boolean;
  productionDetected: boolean;
  ackProvided: boolean;
  vaultCredentialPresent: boolean;
}

export interface MigoVaultApiSpikeRequestProfile {
  attemptedRequests: number;
  successfulResponses: number;
  failedResponses: number;
  stoppedBecause?: string;
  rateLimitDetected: boolean;
  averageResponseTimeMs?: number;
}

export interface MigoVaultApiSpikeDataProfile {
  containsRuc: boolean;
  containsLegalName: boolean;
  containsCiiu: boolean;
  containsCiiuRev3: boolean;
  containsCiiuRev4: boolean;
  containsActivityDescription: boolean;
  containsSecondaryActivities: boolean;
  containsTaxpayerStatus: boolean;
  containsDomicileCondition: boolean;
  containsAddress: boolean;
  containsLegalRepresentatives: boolean;
}

export interface MigoVaultApiSpikeSampleRow {
  ruc: string;
  legalName?: string;
  ciiuCode?: string;
  ciiuDescription?: string;
  activityDescription?: string;
  taxpayerStatus?: string;
  domicileCondition?: string;
  redactedPreview: string;
}

export type MigoVaultApiSpikeVerdict =
  | 'MIGO_CONFIRMED_FOR_CIIU_ENRICHMENT'
  | 'MIGO_PARTIAL_PAYLOAD'
  | 'MIGO_AUTH_FAILED'
  | 'MIGO_RATE_LIMIT_BLOCKED'
  | 'MIGO_NOT_USEFUL_FOR_CIIU'
  | 'UNKNOWN_NEEDS_MANUAL_REVIEW';

export interface MigoVaultApiSpikeOutput {
  sourceKey: 'pe_migo_api';
  mode: 'local_vault_api_spike';
  status: MigoVaultApiSpikeStatus;
  environment: MigoVaultApiSpikeEnvironment;
  requestProfile: MigoVaultApiSpikeRequestProfile;
  dataProfile: MigoVaultApiSpikeDataProfile;
  persistenceRecommendation: {
    persistAllowed: string[];
    persistForbidden: string[];
    sensitiveFieldsDetected: string[];
  };
  sampleRows: MigoVaultApiSpikeSampleRow[];
  verdict: MigoVaultApiSpikeVerdict;
  recommendation: string;
  warnings: string[];
  errors: string[];
}

// ─── PRODUCE MiPyme Source Probe Types ───────────────────────────────────────
// local/offline/development-only
// No ejecutar en Vercel ni production. No escribe Supabase. No crea candidatos.

export const PRODUCE_MIPYME_SOURCE_KEY = 'pe_produce_mipyme_sector';

/** URL del dataset page en datosabiertos.gob.pe (CKAN). Documentada en Perú.3K. */
export const PRODUCE_MIPYME_DATASET_PAGE_URL =
  'https://www.datosabiertos.gob.pe/dataset/directorio-de-empresas-mipyme-por-sector-productivo-ministerio-de-la-producción-produce';

/** ID CKAN normalizado a ASCII (sin tildes) para uso en la API. */
export const PRODUCE_MIPYME_CKAN_DATASET_ID =
  'directorio-de-empresas-mipyme-por-sector-productivo-ministerio-de-la-produccion-produce';

/** URL base de la API CKAN de datosabiertos.gob.pe. */
export const DATOSABIERTOS_CKAN_API_BASE =
  'https://www.datosabiertos.gob.pe/api/3/action/package_show';

export type ProduceMipymeVerdict =
  | 'CONNECT_NOW'
  | 'SPIKE_LOCAL_FIRST'
  | 'USE_AS_REFERENCE_ONLY'
  | 'POST_MVP'
  | 'REJECT'
  | 'UNKNOWN_NEEDS_MANUAL_REVIEW';

export type ProduceMipymeProbeStatus = 'completed' | 'blocked' | 'error';
export type ProduceMipymeAccessMode = 'public_download' | 'unknown';

export interface ProduceMipymeSourceProbeInput {
  sourceUrl?: string;
  tempDir?: string;
  localPath?: string;
  reportPath?: string;
  downloadIfMissing?: boolean;
  requireAck?: boolean;
  maxRowsToProfile?: number;
  ruc20SnapshotPath?: string;
}

export interface ProduceMipymeSourceProfile {
  url: string;
  owner: 'PRODUCE';
  accessMode: ProduceMipymeAccessMode;
  requiresCredentials: boolean;
  fileFormat?: string;
  contentType?: string;
  contentLengthBytes?: number;
}

export interface ProduceMipymeEnvironment {
  localOnly: true;
  vercelDetected: boolean;
  productionDetected: boolean;
  ackProvided: boolean;
  tempDirIgnoredByGit: boolean;
}

export interface ProduceMipymeDownload {
  attempted: boolean;
  completed: boolean;
  localPath?: string;
  bytesWritten?: number;
  reusedExistingFile: boolean;
}

export interface ProduceMipymeSchemaProfile {
  detectedDelimiter?: string;
  sheetNames?: string[];
  columns: string[];
  normalizedColumns: string[];
  rowCountProfiled: number;
  containsRuc: boolean;
  containsCiiu: boolean;
  containsActivityDescription: boolean;
  containsSector: boolean;
  rucColumnCandidates: string[];
  ciiuColumnCandidates: string[];
  activityDescriptionColumnCandidates: string[];
  sectorColumnCandidates: string[];
}

export interface ProduceMipymeCoverageProfile {
  produceRowsWithRuc: number;
  produceRowsWithCiiu: number;
  uniqueProduceRucsProfiled: number;
  matchedRuc20SnapshotProfiled: number;
  matchRateAgainstProfiledRuc20?: number;
}

export interface ProduceMipymeSampleRow {
  ruc?: string;
  ciiu?: string;
  activityDescription?: string;
  sector?: string;
  redactedPreview: string;
}

export interface ProduceMipymeSourceProbeOutput {
  sourceKey: 'pe_produce_mipyme_sector';
  mode: 'local_source_probe';
  status: ProduceMipymeProbeStatus;
  source: ProduceMipymeSourceProfile;
  environment: ProduceMipymeEnvironment;
  download: ProduceMipymeDownload;
  schemaProfile: ProduceMipymeSchemaProfile;
  coverageProfile: ProduceMipymeCoverageProfile;
  sampleRows: ProduceMipymeSampleRow[];
  verdict: ProduceMipymeVerdict;
  recommendation: string;
  warnings: string[];
  errors: string[];
}
