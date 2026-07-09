/**
 * EC SCVS — Types
 *
 * Tipos para el conector SCVS (Superintendencia de Compañías, Valores y Seguros) Ecuador.
 * Fuente: bi_compania.csv — recurso oficial *.supercias.gob.ec.
 * Semántica: official_company_registry (NO government_supplier_registry).
 *
 * Este dataset NO reporta estado societario, objeto social, representante legal
 * ni CIIU directo. NO implica validación SRI ni validación legal.
 *
 * Hito: Catálogo.EC.3 — dry-run CSV local, sin writes DB.
 */

// ─── Raw row ─────────────────────────────────────────────────────────────────

/** Row cruda tal como viene de bi_compania.csv (6 columnas auditadas en EC.2). */
export interface EcScvsRawRow {
  expediente: string | null;
  ruc: string | null;
  nombre: string | null;
  tipo: string | null;
  pro_codigo: string | null;
  provincia: string | null;
}

export const EC_SCVS_EXPECTED_COLUMNS: ReadonlyArray<keyof EcScvsRawRow> = [
  'expediente',
  'ruc',
  'nombre',
  'tipo',
  'pro_codigo',
  'provincia',
];

// ─── RUC normalization result ─────────────────────────────────────────────────

/**
 * Normalización conservadora de ingesta EC.3.
 * NO es validación SRI. NO es checksum. NO exige sufijo 001.
 * Solo exige: presente, sin puntuación permitida residual, 13 dígitos numéricos.
 */
export type EcRucNormalizationReason =
  | 'missing'
  | 'alphabetic_contamination'
  | 'invalid_length';

export interface EcRucNormalizationResult {
  status: 'valid' | 'missing' | 'invalid_format';
  normalized: string | null;
  reason: EcRucNormalizationReason | null;
  observedLength: number | null;
}

// ─── Normalized candidate ─────────────────────────────────────────────────────

/**
 * Candidato normalizado SCVS.
 * No es snapshot — no escribir en DB en este hito.
 * sourceReportedName deja explícito que "nombre" es tal como lo reporta la fuente,
 * SIN validación legal.
 */
export interface EcScvsNormalizedCandidate {
  sourceRowIndex: number;
  expediente: string | null;
  rawRuc: string | null;
  normalizedRuc: string;
  sourceReportedName: string;
  companyType: string | null;
  provinceCode: string | null;
  province: string | null;
}

// ─── Duplicate profiling ──────────────────────────────────────────────────────

export type EcScvsDuplicateClass =
  | 'A_EXACT_DUPLICATE_ROWS'
  | 'B_SAME_COMPANY_SAME_EXPEDIENT_LOCATION_VARIANT'
  | 'C_SAME_COMPANY_MULTIPLE_EXPEDIENTS'
  | 'D_NAME_VARIANT_SAME_RUC'
  | 'E_COMPANY_TYPE_VARIANT_SAME_RUC'
  | 'F_MULTI_FIELD_CONFLICT';

export interface EcScvsDuplicateGroup {
  /** Hash corto y seguro del RUC normalizado — nunca el RUC completo. */
  groupHash: string;
  rowCount: number;
  duplicateClass: EcScvsDuplicateClass;
}

export interface EcScvsDuplicateClassSummary {
  duplicateClass: EcScvsDuplicateClass;
  groups: number;
  rows: number;
  excessRows: number;
}

export interface EcScvsDuplicateProfilingResult {
  groups: EcScvsDuplicateGroup[];
  classSummary: EcScvsDuplicateClassSummary[];
  totalDuplicateGroups: number;
  totalDuplicateRows: number;
  totalExcessRows: number;
  maxGroupSize: number;
  groupsWithTwoRows: number;
  groupsWithThreeRows: number;
  groupsWithMoreThanThreeRows: number;
}

// ─── Identifier anomaly profiling (raw non-numeric RUC) ───────────────────────

export type EcScvsAnomalyClass =
  | 'A_PUNCTUATION_ONLY_RECOVERABLE'
  | 'B_ALPHABETIC_CONTAMINATION'
  | 'C_INVALID_LENGTH_AFTER_NORMALIZATION'
  | 'D_OTHER_INVALID_FORMAT';

export interface EcScvsAnomalyClassSummary {
  anomalyClass: EcScvsAnomalyClass;
  count: number;
}

// ─── Adapter stats ────────────────────────────────────────────────────────────

export interface EcScvsAdapterStats {
  totalSourceRows: number;
  missingRucRows: number;
  invalidRucRows: number;
  acceptedPreDedupRows: number;
  distinctNormalizedRuc: number;
  duplicateRucGroups: number;
  duplicateRowsExcess: number;
}

export interface EcScvsAdapterResult {
  candidates: EcScvsNormalizedCandidate[];
  invalidCandidates: EcScvsNormalizedCandidate[];
  stats: EcScvsAdapterStats;
}

// ─── Dry-run summary ──────────────────────────────────────────────────────────

export interface EcScvsDryRunSummary {
  file_name: string;

  total_source_rows: number;
  missing_ruc_rows: number;
  raw_non_numeric_ruc: number;

  recoverable_punctuation: number;
  alphabetic_contamination: number;
  invalid_length: number;

  accepted_pre_dedup_rows: number;
  distinct_normalized_ruc: number;
  duplicate_ruc_groups: number;
  duplicate_rows_excess: number;

  db_writes: 0;
  snapshot_writes: 0;
  coverage_writes: 0;
}
