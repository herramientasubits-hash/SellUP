/**
 * DGII República Dominicana Bulk Connector — Types
 *
 * Tipos para el conector seguro del padrón RNC de la DGII.
 * Solo disponibilidad, muestra y metadata HTTP. Sin descarga completa.
 * Sin writes. Sin candidatos.
 *
 * local/offline/development-only — No ejecutar en Vercel ni production.
 */

export const RD_DGII_BULK_SOURCE_KEY = 'rd_dgii_bulk' as const;
export const RD_DGII_BULK_COUNTRY_CODE = 'DO';

export const RD_DGII_RNC_PAGE_URL =
  'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx' as const;

export const RD_DGII_RNC_TXT_ZIP_URL =
  'https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip' as const;

export const RD_DGII_RNC_CSV_ZIP_URL =
  'https://dgii.gov.do/app/WebApps/Consultas/RNC/RNC_CONTRIBUYENTES.zip' as const;

export const RD_DGII_BULK_HEAD_TIMEOUT_MS = 20_000;
export const RD_DGII_BULK_FETCH_TIMEOUT_MS = 60_000;
export const RD_DGII_BULK_MAX_SAMPLE_BYTES = 4 * 1024 * 1024; // 4 MB — zip ~22 MB, header+first entries

export type DgiiAvailabilityStatus = 'available' | 'unavailable' | 'blocked' | 'error';

export type DgiiHttpMetadata = {
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

export type DgiiRncType = 'business_rnc' | 'cedula_persona' | 'unknown';

/**
 * Registro raw del padrón DGII tal como llega del parser.
 * Campos mínimos del archivo pipe-delimitado.
 */
export type DgiiParsedRecord = {
  rnc: string;
  legalName: string;
  tradeName?: string;
  category?: string;
  paymentRegime?: string;
  taxpayerStatus: string;
  economicActivity?: string;
  registrationDate?: string;
  localAdministration?: string;
  rncType: DgiiRncType;
  isInScope: boolean; // true solo para RNC jurídico 9 dígitos
};

export type DgiiNormalizedCompany = {
  rnc: string;
  legalName: string;
  tradeName?: string;
  taxpayerStatus: 'active' | 'suspended' | 'inactive' | 'temporary_ceased' | 'unknown';
  isActive: boolean;
  economicActivity?: string;
  registrationDate?: string;
  localAdministration?: string;
  rawStatus: string;
};

export type DgiiParserStats = {
  totalLines: number;
  businessRnc9: number;
  cedula11: number;
  unknown: number;
  headerSkipped: boolean;
  statusDistribution: Record<string, number>;
};

export type DgiiDryRunInput = {
  mode?: 'head_only' | 'full_sample';
  maxSampleBytes?: number;
};

export type DgiiDryRunOutput = {
  sourceKey: typeof RD_DGII_BULK_SOURCE_KEY;
  mode: 'head_only' | 'full_sample';
  status: DgiiAvailabilityStatus;
  metadata: DgiiHttpMetadata;
  sample?: {
    attempted: boolean;
    method: 'range_request' | 'full_download' | 'not_attempted';
    linesRead: number;
    stats: DgiiParserStats;
    examples: DgiiNormalizedCompany[];
    columnMapping?: Record<string, number>;
  };
  warnings: string[];
  errors: string[];
};
