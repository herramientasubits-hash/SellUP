/**
 * GT RGAE — Snapshot Mapper
 *
 * Convierte GtRgaeNormalizedCandidate → fila compatible con source_company_snapshots.
 *
 * Scope conservador v1:
 *   - Solo candidatos de tipo Sociedades con NIT válido (ya garantizado por el adapter)
 *   - source_year fijo: 2025
 *   - priority_score: 0 (ver nota abajo)
 *
 * RGAE economic capacity is a government procurement qualification attribute.
 * It is not an approved SellUp commercial prioritization signal.
 * priority_score = 0 para RGAE v1.
 *
 * Nota sobre legal_name:
 *   legal_name almacena el nombre de proveedor reportado por RGAE (MINFIN Guatemala).
 *   NO es un nombre legal canónico verificado por Registro Mercantil de Guatemala.
 *   No debe sobreescribir automáticamente la identidad legal de una cuenta.
 *   El raw_data.canonical_name_overwrite_enabled = false es la barrera técnica;
 *   este comentario es la barrera semántica para revisores futuros.
 *
 * Hito: Centroamérica.7G.3 — snapshot writer (sin writes DB).
 */

import type { GtRgaeNormalizedCandidate, GtRgaeDryRunSummary } from './gt-rgae-types';
import { GT_NIT_MIN_LENGTH, GT_NIT_MAX_LENGTH } from './gt-rgae-types';

// ─── Constantes ────────────────────────────────────────────────────────────────

export const GT_RGAE_SNAPSHOT_SOURCE_KEY = 'gt_rgae_proveedores' as const;
export const GT_RGAE_SNAPSHOT_COUNTRY_CODE = 'GT' as const;

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type GtRgaeSnapshotRawData = {
  source_type: 'government_supplier_registry';
  tax_identifier_type: 'NIT';
  supplier_type: 'Sociedades';

  request_type: string | null;

  resolution_date: string;
  resolution_number: number | null;
  certificate_number: number | null;

  economic_capacity: {
    kind: 'not_applicable' | 'direct_purchase' | 'numeric' | 'unparsed';
    amount: number | null;
    raw: string | null;
  };

  tax_validation_status: 'not_applicable';
  legal_validation_status: 'not_applicable';

  human_review_required: true;
  post_approval_enabled: false;
  matching_automatic_enabled: false;
  account_creation_enabled: false;
  canonical_name_overwrite_enabled: false;
};

export type GtRgaeSnapshotRow = {
  source_key: typeof GT_RGAE_SNAPSHOT_SOURCE_KEY;
  country_code: typeof GT_RGAE_SNAPSHOT_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: null;
  city: null;
  department: null;
  region: null;
  priority_score: 0;
  signals: Record<string, never>;
  financials: Record<string, never>;
  raw_data: GtRgaeSnapshotRawData;
};

// ─── Mapper ────────────────────────────────────────────────────────────────────

export function mapCandidateToSnapshot(candidate: GtRgaeNormalizedCandidate): GtRgaeSnapshotRow {
  const rawData: GtRgaeSnapshotRawData = {
    source_type: 'government_supplier_registry',
    tax_identifier_type: 'NIT',
    supplier_type: 'Sociedades',

    request_type: candidate.requestType,

    resolution_date: candidate.resolutionDate,
    resolution_number: candidate.resolutionNumber,
    certificate_number: candidate.certificateNumber,

    economic_capacity: {
      kind: candidate.economicCapacity.kind,
      amount: candidate.economicCapacity.kind === 'numeric' ? candidate.economicCapacity.amount : null,
      raw: candidate.economicCapacity.raw,
    },

    // Traducción semántica intencional:
    // candidate.fiscalValidationStatus → raw_data.tax_validation_status
    // candidate.legalValidationStatus  → raw_data.legal_validation_status
    // La convención de raw_data usa prefijos "tax_" y "legal_" mientras que el
    // modelo de candidato usa prefijos "fiscal_" y "legal_".
    tax_validation_status: candidate.fiscalValidationStatus,
    legal_validation_status: candidate.legalValidationStatus,

    human_review_required: candidate.humanReviewRequired,
    post_approval_enabled: candidate.postApprovalEnabled,
    matching_automatic_enabled: candidate.matchingAutomaticEnabled,
    account_creation_enabled: candidate.accountCreationEnabled,
    canonical_name_overwrite_enabled: candidate.canonicalNameOverwriteEnabled,
  };

  return {
    source_key: GT_RGAE_SNAPSHOT_SOURCE_KEY,
    country_code: GT_RGAE_SNAPSHOT_COUNTRY_CODE,
    source_year: candidate.sourceYear,
    tax_id: candidate.normalizedNit,
    normalized_tax_id: candidate.normalizedNit,
    // legal_name almacena el nombre RGAE reportado por MINFIN. No es nombre
    // legal canónico verificado. Ver nota en cabecera del archivo.
    legal_name: candidate.supplierName.trim(),
    normalized_legal_name: candidate.normalizedSupplierName,
    sector: null,
    city: null,
    department: null,
    region: null,
    // RGAE economic capacity is a government procurement qualification attribute.
    // It is not an approved SellUp commercial prioritization signal.
    priority_score: 0,
    signals: {},
    financials: {},
    raw_data: rawData,
  };
}

// ─── Batch mapper ──────────────────────────────────────────────────────────────

export function mapCandidatesToSnapshot(candidates: GtRgaeNormalizedCandidate[]): GtRgaeSnapshotRow[] {
  return candidates.map(mapCandidateToSnapshot);
}

// ─── Invariant validator ───────────────────────────────────────────────────────

/**
 * Valida los invariantes obligatorios de cada fila snapshot RGAE.
 * Retorna mensajes de violación; array vacío = todas las filas válidas.
 * Si el array no está vacío, NO deben ejecutarse writes.
 */
export function findSnapshotInvariantViolations(rows: GtRgaeSnapshotRow[]): string[] {
  const violations: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const idx = `row[${i}]`;

    if (r.source_key !== GT_RGAE_SNAPSHOT_SOURCE_KEY)
      violations.push(`${idx} source_key=${r.source_key}`);

    if (r.country_code !== GT_RGAE_SNAPSHOT_COUNTRY_CODE)
      violations.push(`${idx} country_code=${r.country_code}`);

    if (r.source_year !== 2025)
      violations.push(`${idx} source_year=${r.source_year}`);

    if (!/^\d+$/.test(r.normalized_tax_id))
      violations.push(`${idx} normalized_tax_id non-numeric`);
    else if (r.normalized_tax_id.length < GT_NIT_MIN_LENGTH || r.normalized_tax_id.length > GT_NIT_MAX_LENGTH)
      violations.push(`${idx} normalized_tax_id length ${r.normalized_tax_id.length} out of range [${GT_NIT_MIN_LENGTH},${GT_NIT_MAX_LENGTH}]`);

    if (!r.legal_name || r.legal_name.trim() === '')
      violations.push(`${idx} legal_name empty`);

    if (r.priority_score !== 0)
      violations.push(`${idx} priority_score=${r.priority_score} (expected 0)`);

    if (typeof r.signals !== 'object' || r.signals === null || Array.isArray(r.signals))
      violations.push(`${idx} signals not an object`);

    if (typeof r.financials !== 'object' || r.financials === null || Array.isArray(r.financials))
      violations.push(`${idx} financials not an object`);

    if (r.raw_data.source_type !== 'government_supplier_registry')
      violations.push(`${idx} raw_data.source_type=${r.raw_data.source_type}`);

    if (r.raw_data.tax_identifier_type !== 'NIT')
      violations.push(`${idx} raw_data.tax_identifier_type=${r.raw_data.tax_identifier_type}`);

    if (r.raw_data.supplier_type !== 'Sociedades')
      violations.push(`${idx} raw_data.supplier_type=${r.raw_data.supplier_type}`);

    if (r.raw_data.tax_validation_status !== 'not_applicable')
      violations.push(`${idx} raw_data.tax_validation_status=${r.raw_data.tax_validation_status}`);

    if (r.raw_data.legal_validation_status !== 'not_applicable')
      violations.push(`${idx} raw_data.legal_validation_status=${r.raw_data.legal_validation_status}`);

    if (r.raw_data.human_review_required !== true)
      violations.push(`${idx} raw_data.human_review_required=${String(r.raw_data.human_review_required)}`);

    if (r.raw_data.post_approval_enabled !== false)
      violations.push(`${idx} raw_data.post_approval_enabled=${String(r.raw_data.post_approval_enabled)}`);

    if (r.raw_data.matching_automatic_enabled !== false)
      violations.push(`${idx} raw_data.matching_automatic_enabled=${String(r.raw_data.matching_automatic_enabled)}`);

    if (r.raw_data.account_creation_enabled !== false)
      violations.push(`${idx} raw_data.account_creation_enabled=${String(r.raw_data.account_creation_enabled)}`);

    if (r.raw_data.canonical_name_overwrite_enabled !== false)
      violations.push(`${idx} raw_data.canonical_name_overwrite_enabled=${String(r.raw_data.canonical_name_overwrite_enabled)}`);
  }

  return violations;
}

// ─── Coverage breakdown ────────────────────────────────────────────────────────

export type GtRgaeCoverageBreakdown = {
  source_year: 2025;
  total_source_rows: number;

  sociedades_rows: number;
  sociedades_with_valid_nit: number;
  sociedades_invalid_nit: number;

  unique_valid_nit: number;
  duplicate_sociedad_rows: number;
  dedup_replacements: number;
  normalized_candidates: number;

  supplier_type_filter: 'Sociedades';

  excluded_persona_individual: number;
  excluded_comerciante_individual: number;
  excluded_ong: number;
  excluded_asociacion: number;
  excluded_other_types: number;

  economic_capacity_not_applicable: number;
  economic_capacity_direct_purchase: number;
  economic_capacity_numeric: number;
  economic_capacity_unparsed: number;

  human_review_required: true;
  post_approval_enabled: false;
  matching_automatic_enabled: false;

  source_type: 'government_supplier_registry';
  invariant_violations: number;
};

export type GtRgaeCoverageSummaryPayload = {
  source_key: typeof GT_RGAE_SNAPSHOT_SOURCE_KEY;
  country_code: typeof GT_RGAE_SNAPSHOT_COUNTRY_CODE;
  coverage_kind: 'government_supplier_registry';
  entity_label: 'Sociedades con operación registral RGAE 2025';
  coverage_status: 'complete_snapshot';
  loaded_rows: number;
  next_recommended_offset: 0;
  refresh_source: 'gt_rgae_7g3_snapshot_apply';
  coverage_breakdown: GtRgaeCoverageBreakdown;
  coverage_notes: {
    complete_snapshot_scope: string;
    complete_snapshot_is_not: string[];
    human_review_required: true;
    post_approval_enabled: false;
    matching_automatic_enabled: false;
    account_creation_enabled: false;
    canonical_name_overwrite_enabled: false;
  };
};

/**
 * Construye el payload de coverage a partir del summary del dry-run/apply.
 *
 * "complete_snapshot" significa carga completa del scope conservador definido
 * por el connector: TIPO_PROVEEDOR = Sociedades, NIT válido, deduplicado por NIT,
 * source_year 2025. NO significa universo completo de empresas de Guatemala.
 *
 * No incluye out_of_scope_entities: ese campo mezclaría filas excluidas por tipo,
 * NIT inválido, y dedup, y no representaría entidades únicas fuera de alcance.
 * Los conteos individuales en coverage_breakdown son suficientes y honestos.
 */
export function buildGtRgaeCoveragePayload(opts: {
  rowsWritten: number;
  summary: GtRgaeDryRunSummary;
  invariantViolations: number;
}): GtRgaeCoverageSummaryPayload {
  const s = opts.summary;

  const breakdown: GtRgaeCoverageBreakdown = {
    source_year: 2025,
    total_source_rows: s.rows_read,

    sociedades_rows: s.sociedades_rows,
    sociedades_with_valid_nit: s.sociedades_with_valid_nit,
    sociedades_invalid_nit: s.sociedades_invalid_nit,

    unique_valid_nit: s.sociedades_unique_nit,
    duplicate_sociedad_rows: s.duplicate_sociedad_rows,
    dedup_replacements: s.dedup_replacements,
    normalized_candidates: s.normalized_candidates,

    supplier_type_filter: 'Sociedades',

    excluded_persona_individual: s.persona_individual_rows,
    excluded_comerciante_individual: s.comerciante_individual_rows,
    excluded_ong: s.ong_rows,
    excluded_asociacion: s.asociacion_rows,
    excluded_other_types: s.other_type_rows,

    economic_capacity_not_applicable: s.economic_capacity_not_applicable,
    economic_capacity_direct_purchase: s.economic_capacity_direct_purchase,
    economic_capacity_numeric: s.economic_capacity_numeric,
    economic_capacity_unparsed: s.economic_capacity_unparsed,

    human_review_required: true,
    post_approval_enabled: false,
    matching_automatic_enabled: false,

    source_type: 'government_supplier_registry',
    invariant_violations: opts.invariantViolations,
  };

  return {
    source_key: GT_RGAE_SNAPSHOT_SOURCE_KEY,
    country_code: GT_RGAE_SNAPSHOT_COUNTRY_CODE,
    coverage_kind: 'government_supplier_registry',
    entity_label: 'Sociedades con operación registral RGAE 2025',
    coverage_status: 'complete_snapshot',
    loaded_rows: opts.rowsWritten,
    next_recommended_offset: 0,
    refresh_source: 'gt_rgae_7g3_snapshot_apply',
    coverage_breakdown: breakdown,
    coverage_notes: {
      complete_snapshot_scope:
        'Carga completa del scope conservador: TIPO_PROVEEDOR=Sociedades, NIT válido (5-10 dígitos), ' +
        'deduplicado por NIT (tie-breaker: fecha resolución más reciente), source_year=2025.',
      complete_snapshot_is_not: [
        'universo completo de empresas de Guatemala',
        'todas las personas jurídicas de Guatemala',
        'empresas activas según SAT',
        'validación fiscal NIT ante SAT',
        'entidades con validación legal ante Registro Mercantil',
      ],
      human_review_required: true,
      post_approval_enabled: false,
      matching_automatic_enabled: false,
      account_creation_enabled: false,
      canonical_name_overwrite_enabled: false,
    },
  };
}
