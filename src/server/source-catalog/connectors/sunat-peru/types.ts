/**
 * SUNAT Peru Bulk Connector — Types
 *
 * Tipos para el conector seguro del Padrón Reducido RUC de SUNAT.
 * Solo disponibilidad y metadata HTTP. Sin descarga completa.
 * Sin writes. Sin candidatos.
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
