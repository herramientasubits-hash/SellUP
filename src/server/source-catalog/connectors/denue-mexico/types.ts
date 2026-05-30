/**
 * DENUE Mexico Connector — Types
 *
 * Tipos para muestra de validación DENUE / INEGI México.
 * Solo lectura. Sin candidatos en DB. Sin writes a Supabase.
 */

/** Fuente DENUE — por ahora solo 'denue' como dataset piloto */
export type MexicoCompanySource = 'denue';

/**
 * Registro raw tal como llega del API DENUE/INEGI.
 * Todos los campos son opcionales y pueden ser strings incluso si la API
 * los documenta como números — normalización defensiva obligatoria.
 */
export type DenueEstablishmentRaw = {
  id?: unknown;
  nom_estab?: unknown;
  raz_social?: unknown;
  codigo_act?: unknown;
  nombre_act?: unknown;
  per_ocu?: unknown;
  estrato?: unknown;
  tipo_vial?: unknown;
  nom_vial?: unknown;
  num_ext?: unknown;
  nom_loc?: unknown;
  nom_mun?: unknown;
  nom_ent?: unknown;
  cod_postal?: unknown;
  correoelec?: unknown;
  www?: unknown;
  telefono?: unknown;
  [key: string]: unknown;
};

/** Registro normalizado para muestra de validación — no es un prospect_candidate. */
export type NormalizedMexicoCompanySample = {
  source: MexicoCompanySource;
  sourceKey: string;
  datasetId: string;
  companyName: string | null;
  legalName: string | null;
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
  /** Estrato bruto de DENUE para derivar tamaño. Ejemplo: "51 a 100 personas". */
  perOcuRaw: string | null;
  /** Solo metadatos auxiliares — sin raw completo, sin PII innecesaria. */
  sourceMetadata: Record<string, string | number | boolean | null>;
};

export type DenueDatasetResult = {
  ok: boolean;
  recordsRead: number;
  normalizedCount: number;
  sample: NormalizedMexicoCompanySample[];
  error: string | null;
};

export type DenueMexicoSampleReport = {
  executedAt: string;
  limitPerDataset: number;
  results: Record<MexicoCompanySource, DenueDatasetResult>;
};

export type DenueCandidateDryRunInput = {
  limitPerDataset?: number;
  /** Código SCIAN para filtrar — por defecto tecnología/TI */
  codigoActividad?: string;
  /** Clave INEGI de entidad federativa — por defecto 09 (CDMX) */
  entidad?: string;
};
