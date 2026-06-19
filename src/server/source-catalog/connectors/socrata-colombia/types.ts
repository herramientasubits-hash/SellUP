/**
 * Socrata Colombia Connector — Types
 *
 * Tipos para muestra de validación de datos.gov.co.
 * Solo lectura. Sin candidatos. Sin Supabase writes.
 */

export type ColombiaCompanySource =
  | 'rues'
  | 'secop2'
  | 'secop2_proveedores'
  | 'reps'
  | 'superfinanciera';

/** Registro normalizado para muestra de validación — no es un prospect_candidate. */
export type NormalizedColombiaCompanySample = {
  source: ColombiaCompanySource;
  sourceKey: string;
  datasetId: string;
  companyName: string | null;
  taxId: string | null;
  legalStatus: string | null;
  sectorCode: string | null;
  sectorDescription: string | null;
  city: string | null;
  department: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  rawRecordId: string | null;
  /** Solo metadatos auxiliares — sin raw completo, sin PII innecesaria. */
  sourceMetadata: Record<string, string | number | boolean | null>;
};

export type SocrataSampleDatasetResult = {
  ok: boolean;
  recordsRead: number;
  normalizedCount: number;
  sample: NormalizedColombiaCompanySample[];
  error: string | null;
};

export type SocrataColombiaSampleReport = {
  executedAt: string;
  limitPerDataset: number;
  results: Record<ColombiaCompanySource, SocrataSampleDatasetResult>;
};
