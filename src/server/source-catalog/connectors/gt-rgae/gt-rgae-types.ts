/**
 * GT RGAE — Types
 *
 * Tipos para el conector RGAE (Registro General de Adquisiciones del Estado) Guatemala.
 * Fuente: MINFIN Guatemala — Listado de Proveedores del Estado.
 * Semántica: government_supplier_registry.
 *
 * Hito: Centroamérica.7G.1 — dry-run XLSX local, sin writes DB.
 */

// ─── Raw row ─────────────────────────────────────────────────────────────────

/** Row cruda tal como viene del XLSX RGAE oficial (8 columnas auditadas). */
export interface GtRgaeRawRow {
  NIT_PROVEEDOR: string | number | null;
  TIPO_PROVEEDOR: string | null;
  NOMBRE_PROVEEDOR: string | null;
  TIPO_SOLICITUD: string | null;
  FECHA_RESOLUCION: string | number | null;
  NO_RESOLUCION: string | number | null;
  NO_CONSTANCIA: string | number | null;
  CAPACIDAD_ECONOMICA: string | number | null;
}

export const GT_RGAE_EXPECTED_COLUMNS: ReadonlyArray<keyof GtRgaeRawRow> = [
  'NIT_PROVEEDOR',
  'TIPO_PROVEEDOR',
  'NOMBRE_PROVEEDOR',
  'TIPO_SOLICITUD',
  'FECHA_RESOLUCION',
  'NO_RESOLUCION',
  'NO_CONSTANCIA',
  'CAPACIDAD_ECONOMICA',
];

// ─── Tipo proveedor ───────────────────────────────────────────────────────────

export type GtRgaeSupplierType =
  | 'Sociedades'
  | 'Persona Individual'
  | 'Comerciante Individual'
  | 'ONG'
  | 'Asociación'
  | 'other'
  | 'missing';

// ─── Economic capacity ────────────────────────────────────────────────────────

/** Resultado del parser de CAPACIDAD_ECONOMICA. Preserva el valor raw siempre. */
export type GtRgaeEconomicCapacity =
  | { kind: 'not_applicable'; amount: null; raw: string }
  | { kind: 'direct_purchase'; amount: null; raw: string }
  | { kind: 'numeric'; amount: number; raw: string }
  | { kind: 'unparsed'; amount: null; raw: string | null };

// ─── NIT normalization result ─────────────────────────────────────────────────

/**
 * Rango técnico conservador basado en el dataset RGAE 2025 auditado.
 * NO es validación fiscal SAT. Es un guardrail de ingesta.
 */
export const GT_NIT_MIN_LENGTH = 5;
export const GT_NIT_MAX_LENGTH = 10;

export type GtNitValidationReason =
  | 'missing'
  | 'non_numeric'
  | 'too_short'
  | 'too_long';

export interface GtNitNormalizationResult {
  isValid: boolean;
  normalized: string | null;
  reason: GtNitValidationReason | null;
  observedLength: number | null;
}

// ─── Normalized candidate ─────────────────────────────────────────────────────

/**
 * Candidato normalizado RGAE.
 * No es snapshot — no escribir en DB en este hito.
 * humanReviewRequired y postApprovalEnabled son invariantes de auditoría.
 */
export interface GtRgaeNormalizedCandidate {
  normalizedNit: string;
  maskedNit: string;

  supplierName: string;
  normalizedSupplierName: string;

  supplierType: 'Sociedades';

  requestType: string | null;

  resolutionDate: string;
  resolutionNumber: number | null;
  certificateNumber: number | null;

  economicCapacity: GtRgaeEconomicCapacity;

  sourceYear: 2025;
  sourceType: 'government_supplier_registry';

  fiscalValidationStatus: 'not_applicable';
  legalValidationStatus: 'not_applicable';

  humanReviewRequired: true;
  postApprovalEnabled: false;
  matchingAutomaticEnabled: false;
  accountCreationEnabled: false;
  canonicalNameOverwriteEnabled: false;
}

// ─── Dry-run summary ──────────────────────────────────────────────────────────

export interface GtRgaeDryRunSummary {
  year: number;
  file_name: string;
  sheet_name: string;

  rows_read: number;

  persona_individual_rows: number;
  sociedades_rows: number;
  comerciante_individual_rows: number;
  ong_rows: number;
  asociacion_rows: number;
  other_type_rows: number;
  missing_type_rows: number;

  sociedades_with_valid_nit: number;
  sociedades_invalid_nit: number;
  sociedades_unique_nit: number;

  duplicate_sociedad_rows: number;
  dedup_replacements: number;

  resolution_date_invalid: number;
  resolution_number_invalid: number;

  economic_capacity_not_applicable: number;
  economic_capacity_direct_purchase: number;
  economic_capacity_numeric: number;
  economic_capacity_unparsed: number;

  supplier_name_missing: number;
  supplier_name_normalization_collisions: number;

  normalized_candidates: number;

  invariant_violations: number;

  db_writes: 0;
  snapshot_writes: 0;
  coverage_writes: 0;
}
