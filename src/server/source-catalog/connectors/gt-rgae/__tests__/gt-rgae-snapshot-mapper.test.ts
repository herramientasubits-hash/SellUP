/**
 * GT RGAE — Snapshot Mapper tests
 *
 * Cubre: Tareas 14, 15, 17 (mapping, invariants, coverage payload)
 * Hito: Centroamérica.7G.3
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapCandidateToSnapshot,
  mapCandidatesToSnapshot,
  findSnapshotInvariantViolations,
  buildGtRgaeCoveragePayload,
  GT_RGAE_SNAPSHOT_SOURCE_KEY,
  GT_RGAE_SNAPSHOT_COUNTRY_CODE,
} from '../gt-rgae-snapshot-mapper';
import type { GtRgaeNormalizedCandidate, GtRgaeDryRunSummary } from '../gt-rgae-types';

// ─── Fixture helpers ────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<GtRgaeNormalizedCandidate> = {}): GtRgaeNormalizedCandidate {
  return {
    normalizedNit: '1234567',
    maskedNit: '123****',
    supplierName: 'EMPRESA EJEMPLO S.A.',
    normalizedSupplierName: 'EMPRESA EJEMPLO S.A.',
    supplierType: 'Sociedades',
    requestType: 'INSCRIPCION',
    resolutionDate: '2025-03-15',
    resolutionNumber: 42,
    certificateNumber: 1001,
    economicCapacity: { kind: 'numeric', amount: 500000, raw: 'Q500,000.00' },
    sourceYear: 2025,
    sourceType: 'government_supplier_registry',
    fiscalValidationStatus: 'not_applicable',
    legalValidationStatus: 'not_applicable',
    humanReviewRequired: true,
    postApprovalEnabled: false,
    matchingAutomaticEnabled: false,
    accountCreationEnabled: false,
    canonicalNameOverwriteEnabled: false,
    ...overrides,
  };
}

function makeBaseSummary(overrides: Partial<GtRgaeDryRunSummary> = {}): GtRgaeDryRunSummary {
  return {
    year: 2025,
    file_name: 'operaciones_registrales_2025.xlsx',
    sheet_name: 'Hoja1',
    rows_read: 137753,
    persona_individual_rows: 120209,
    sociedades_rows: 8854,
    comerciante_individual_rows: 8603,
    ong_rows: 58,
    asociacion_rows: 22,
    other_type_rows: 7,
    missing_type_rows: 0,
    sociedades_with_valid_nit: 8757,
    sociedades_invalid_nit: 97,
    sociedades_unique_nit: 6245,
    duplicate_sociedad_rows: 2512,
    dedup_replacements: 2119,
    resolution_date_invalid: 0,
    resolution_number_invalid: 0,
    economic_capacity_not_applicable: 0,
    economic_capacity_direct_purchase: 4397,
    economic_capacity_numeric: 1848,
    economic_capacity_unparsed: 0,
    supplier_name_missing: 0,
    supplier_name_normalization_collisions: 0,
    normalized_candidates: 6245,
    invariant_violations: 0,
    db_writes: 0,
    snapshot_writes: 0,
    coverage_writes: 0,
    ...overrides,
  };
}

// ─── Tarea 14: Mapper tests ────────────────────────────────────────────────────

describe('mapCandidateToSnapshot — mapping', () => {
  it('source_key es gt_rgae_proveedores', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.source_key, GT_RGAE_SNAPSHOT_SOURCE_KEY);
    assert.equal(row.source_key, 'gt_rgae_proveedores');
  });

  it('country_code es GT', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.country_code, GT_RGAE_SNAPSHOT_COUNTRY_CODE);
    assert.equal(row.country_code, 'GT');
  });

  it('source_year se preserva del candidato', () => {
    const row = mapCandidateToSnapshot(makeCandidate({ sourceYear: 2025 }));
    assert.equal(row.source_year, 2025);
  });

  it('tax_id = normalizedNit', () => {
    const row = mapCandidateToSnapshot(makeCandidate({ normalizedNit: '9876543' }));
    assert.equal(row.tax_id, '9876543');
  });

  it('normalized_tax_id = normalizedNit', () => {
    const row = mapCandidateToSnapshot(makeCandidate({ normalizedNit: '9876543' }));
    assert.equal(row.normalized_tax_id, '9876543');
  });

  it('legal_name = supplierName.trim()', () => {
    const row = mapCandidateToSnapshot(makeCandidate({ supplierName: '  EMPRESA S.A.  ' }));
    assert.equal(row.legal_name, 'EMPRESA S.A.');
  });

  it('normalized_legal_name = normalizedSupplierName', () => {
    const row = mapCandidateToSnapshot(makeCandidate({ normalizedSupplierName: 'EMPRESA S.A.' }));
    assert.equal(row.normalized_legal_name, 'EMPRESA S.A.');
  });

  it('priority_score = 0 siempre', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.priority_score, 0);
  });

  it('signals = {}', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.deepEqual(row.signals, {});
  });

  it('financials = {}', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.deepEqual(row.financials, {});
  });

  it('raw_data.source_type = government_supplier_registry', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.raw_data.source_type, 'government_supplier_registry');
  });

  it('raw_data.tax_identifier_type = NIT', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.raw_data.tax_identifier_type, 'NIT');
  });

  it('raw_data.tax_validation_status = not_applicable (traducido desde fiscalValidationStatus)', () => {
    const row = mapCandidateToSnapshot(makeCandidate({ fiscalValidationStatus: 'not_applicable' }));
    assert.equal(row.raw_data.tax_validation_status, 'not_applicable');
  });

  it('raw_data.legal_validation_status = not_applicable (traducido desde legalValidationStatus)', () => {
    const row = mapCandidateToSnapshot(makeCandidate({ legalValidationStatus: 'not_applicable' }));
    assert.equal(row.raw_data.legal_validation_status, 'not_applicable');
  });

  it('raw_data.human_review_required = true', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.raw_data.human_review_required, true);
  });

  it('raw_data.post_approval_enabled = false', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.raw_data.post_approval_enabled, false);
  });

  it('raw_data.matching_automatic_enabled = false', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.raw_data.matching_automatic_enabled, false);
  });

  it('raw_data.account_creation_enabled = false', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.raw_data.account_creation_enabled, false);
  });

  it('raw_data.canonical_name_overwrite_enabled = false', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.raw_data.canonical_name_overwrite_enabled, false);
  });

  it('maskedNit NO persiste en el snapshot row', () => {
    const c = makeCandidate({ maskedNit: '123****' });
    const row = mapCandidateToSnapshot(c);
    const rowStr = JSON.stringify(row);
    assert.equal(rowStr.includes('maskedNit'), false);
    assert.equal(rowStr.includes('masked_nit'), false);
    assert.equal(rowStr.includes('123****'), false);
  });

  it('path local de archivo no persiste', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    const rowStr = JSON.stringify(row);
    assert.equal(rowStr.includes('local-file'), false);
    assert.equal(rowStr.includes('/Users/'), false);
  });

  it('sin campos de currency en row', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    const rowStr = JSON.stringify(row);
    assert.equal(rowStr.includes('"currency"'), false);
  });

  it('sin campos de revenue', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    const rowStr = JSON.stringify(row);
    assert.equal(rowStr.includes('"revenue"'), false);
  });

  it('sin campos de ARR', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    const rowStr = JSON.stringify(row);
    assert.equal(rowStr.includes('"arr"'), false);
    assert.equal(rowStr.includes('annual_recurring'), false);
  });

  it('sin campos de company_size', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    const rowStr = JSON.stringify(row);
    assert.equal(rowStr.includes('company_size'), false);
  });

  it('economic_capacity.kind numeric preservado', () => {
    const row = mapCandidateToSnapshot(
      makeCandidate({ economicCapacity: { kind: 'numeric', amount: 300000, raw: 'Q300,000' } }),
    );
    assert.equal(row.raw_data.economic_capacity.kind, 'numeric');
    assert.equal(row.raw_data.economic_capacity.amount, 300000);
  });

  it('economic_capacity.kind direct_purchase preservado', () => {
    const row = mapCandidateToSnapshot(
      makeCandidate({ economicCapacity: { kind: 'direct_purchase', amount: null, raw: 'COMPRA DIRECTA' } }),
    );
    assert.equal(row.raw_data.economic_capacity.kind, 'direct_purchase');
    assert.equal(row.raw_data.economic_capacity.amount, null);
  });

  it('raw_data.supplier_type = Sociedades', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.raw_data.supplier_type, 'Sociedades');
  });

  it('sector, city, department, region son null', () => {
    const row = mapCandidateToSnapshot(makeCandidate());
    assert.equal(row.sector, null);
    assert.equal(row.city, null);
    assert.equal(row.department, null);
    assert.equal(row.region, null);
  });
});

// ─── Tarea 15: Invariant validator ────────────────────────────────────────────

describe('findSnapshotInvariantViolations', () => {
  it('row válida: sin violaciones', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    assert.equal(findSnapshotInvariantViolations(rows).length, 0);
  });

  it('source_key incorrecto → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).source_key = 'wrong_key';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('source_key')), true);
  });

  it('country_code incorrecto → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).country_code = 'SV';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('country_code')), true);
  });

  it('normalized_tax_id con letras → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).normalized_tax_id = '123ABC';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('normalized_tax_id')), true);
  });

  it('normalized_tax_id muy corto → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).normalized_tax_id = '123';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('normalized_tax_id')), true);
  });

  it('normalized_tax_id muy largo → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).normalized_tax_id = '12345678901';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('normalized_tax_id')), true);
  });

  it('legal_name vacío → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).legal_name = '';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('legal_name')), true);
  });

  it('priority_score != 0 → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).priority_score = 25;
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('priority_score')), true);
  });

  it('raw_data.source_type incorrecto → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.source_type = 'procurement_signal';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('source_type')), true);
  });

  it('raw_data.supplier_type incorrecto → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.supplier_type = 'ONG';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('supplier_type')), true);
  });

  it('raw_data.tax_validation_status incorrecto → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.tax_validation_status = 'not_validated';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('tax_validation_status')), true);
  });

  it('raw_data.legal_validation_status incorrecto → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.legal_validation_status = 'not_validated';
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('legal_validation_status')), true);
  });

  it('human_review_required = false → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.human_review_required = false;
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('human_review_required')), true);
  });

  it('post_approval_enabled = true → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.post_approval_enabled = true;
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('post_approval_enabled')), true);
  });

  it('matching_automatic_enabled = true → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.matching_automatic_enabled = true;
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('matching_automatic_enabled')), true);
  });

  it('account_creation_enabled = true → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.account_creation_enabled = true;
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('account_creation_enabled')), true);
  });

  it('canonical_name_overwrite_enabled = true → violation', () => {
    const rows = mapCandidatesToSnapshot([makeCandidate()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows[0] as any).raw_data.canonical_name_overwrite_enabled = true;
    assert.equal(findSnapshotInvariantViolations(rows).some(v => v.includes('canonical_name_overwrite_enabled')), true);
  });
});

// ─── Tarea 17: Coverage payload ────────────────────────────────────────────────

describe('buildGtRgaeCoveragePayload', () => {
  it('loaded_rows = rowsWritten exitosos', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.loaded_rows, 6245);
  });

  it('coverage_status = complete_snapshot', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.coverage_status, 'complete_snapshot');
  });

  it('coverage_kind = government_supplier_registry', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.coverage_kind, 'government_supplier_registry');
  });

  it('country_code = GT', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.country_code, 'GT');
  });

  it('source_year = 2025 en coverage_breakdown', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.coverage_breakdown.source_year, 2025);
  });

  it('exclusiones preservadas independientemente', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.coverage_breakdown.excluded_persona_individual, 120209);
    assert.equal(p.coverage_breakdown.excluded_comerciante_individual, 8603);
    assert.equal(p.coverage_breakdown.excluded_ong, 58);
    assert.equal(p.coverage_breakdown.excluded_asociacion, 22);
    assert.equal(p.coverage_breakdown.excluded_other_types, 7);
  });

  it('duplicate_rows preservadas independientemente', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.coverage_breakdown.duplicate_sociedad_rows, 2512);
    assert.equal(p.coverage_breakdown.dedup_replacements, 2119);
  });

  it('NIT inválidos preservados independientemente', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.coverage_breakdown.sociedades_invalid_nit, 97);
  });

  it('out_of_scope_entities no aparece en el payload', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    const payloadStr = JSON.stringify(p);
    assert.equal(payloadStr.includes('out_of_scope_entities'), false);
  });

  it('sin company names en coverage', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    const payloadStr = JSON.stringify(p);
    assert.equal(payloadStr.includes('EMPRESA EJEMPLO'), false);
  });

  it('sin local file path en coverage', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    const payloadStr = JSON.stringify(p);
    assert.equal(payloadStr.includes('/Users/'), false);
  });

  it('complete_snapshot semántica correctamente acotada en coverage_notes', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.coverage_notes.complete_snapshot_scope.includes('Sociedades'), true);
    assert.equal(p.coverage_notes.complete_snapshot_scope.includes('NIT válido'), true);
    assert.equal(
      p.coverage_notes.complete_snapshot_is_not.includes('universo completo de empresas de Guatemala'),
      true,
    );
  });

  it('guardrails en coverage_notes', () => {
    const p = buildGtRgaeCoveragePayload({ rowsWritten: 6245, summary: makeBaseSummary(), invariantViolations: 0 });
    assert.equal(p.coverage_notes.human_review_required, true);
    assert.equal(p.coverage_notes.post_approval_enabled, false);
    assert.equal(p.coverage_notes.matching_automatic_enabled, false);
    assert.equal(p.coverage_notes.account_creation_enabled, false);
    assert.equal(p.coverage_notes.canonical_name_overwrite_enabled, false);
  });
});
