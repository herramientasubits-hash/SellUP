/**
 * Chile RES Connector — Types
 *
 * Tipos defensivos para el conector datos.gob.cl / CKAN.
 * Registro de Empresas y Sociedades (RES) Chile.
 * Solo lectura. Sin writes. Sin candidatos en DB.
 */

/** Registro raw tal como llega del CKAN datastore_search. */
export type ResChileRawRecord = {
  _id?: unknown;
  ID?: unknown;
  RUT?: unknown;
  'Razon Social'?: unknown;
  'Fecha de actuacion (1era firma)'?: unknown;
  'Fecha de registro (ultima firma)'?: unknown;
  'Fecha de aprobacion x SII'?: unknown;
  Anio?: unknown;
  Mes?: unknown;
  'Comuna Tributaria'?: unknown;
  'Region Tributaria'?: unknown;
  'Codigo de sociedad'?: unknown;
  'Tipo de actuacion'?: unknown;
  Capital?: unknown;
  'Comuna Social'?: unknown;
  'Region Social'?: unknown;
  [key: string]: unknown;
};

/** Tipo de actuación normalizado. */
export type ChileLegalActionType =
  | 'CONSTITUCIÓN'
  | 'MODIFICACIÓN'
  | 'DISOLUCIÓN'
  | 'CONVERSIÓN'
  | 'other';

/** Estado legal inferido desde Tipo de actuacion. */
export type ChileLegalStatus =
  | 'active_candidate'
  | 'dissolved_candidate'
  | 'modified_candidate'
  | 'unknown_requires_review';

/** Registro normalizado para dry-run — no es un prospect_candidate. */
export type NormalizedChileCompanySample = {
  sourceKey: 'cl_res';
  datasetId: string;
  resourceId: string;
  companyName: string | null;
  legalName: string | null;
  taxId: string | null;
  taxIdentifierType: 'RUT';
  country: 'Chile';
  countryCode: 'CL';
  city: string | null;
  region: string | null;
  companyType: string | null;
  legalStatus: ChileLegalStatus;
  incorporationDate: string | null;
  capitalAmount: number | null;
  capitalCurrency: 'CLP';
  sourceRecordId: string | null;
  rawRecordId: string | null;
  reviewFlags: ResChileReviewFlag[];
  qualityDecision: ResChileQualityDecision;
  qualityReason: string;
};

/** Flags de revisión específicas de la fuente RES Chile. */
export type ResChileReviewFlag =
  | 'no_sector_data'
  | 'no_contact_data'
  | 'official_registry'
  | 'rut_available'
  | 'status_inferred'
  | 'capital_available'
  | 'requires_manual_industry_validation'
  | 'missing_rut'
  | 'missing_legal_name'
  | 'dissolved_entity'
  | 'unknown_legal_action';

/** Decisión de calidad para registros RES Chile. */
export type ResChileQualityDecision = 'accepted' | 'filtered';

/** Params de input para dry-run. */
export type RunClResDryRunInput = {
  resourceId?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, string>;
};

/** Reporte final del dry-run — nunca escribe en DB. */
export type RunClResDryRunReport = {
  sourceKey: 'cl_res';
  sourceProvider: 'datos_gob_cl';
  countryCode: 'CL';
  datasetId: string;
  resourceId: string;
  queryParams: {
    resource_id: string;
    limit: number;
    offset: number;
    filters: Record<string, string>;
  };
  executedAt: string;
  summary: {
    recordsRead: number;
    normalizedCount: number;
    acceptedDraftsCount: number;
    filteredOutCount: number;
    errorsCount: number;
    missingRutCount: number;
    missingLegalNameCount: number;
    noSectorDataCount: number;
    capitalAvailableCount: number;
  };
  acceptedSamples: NormalizedChileCompanySample[];
  filteredSamples: Array<{
    rawRecordId: string | null;
    legalName: string | null;
    tipoActuacion: string | null;
    filterReason: string;
  }>;
  warnings: string[];
  errors: string[];
};
