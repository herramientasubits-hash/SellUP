/**
 * Tests unitarios — SICOP CR Snapshot Builder
 *
 * Sin red real. Cubre guardrails semánticos y construcción de filas.
 *
 * Hito: Centroamérica.4A
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSicopSnapshotRow,
  buildSicopSnapshotRows,
  SICOP_SOURCE_KEY,
  SICOP_COUNTRY_CODE,
} from '../sicop-cr-snapshot-builder';
import type { UniqueProvider } from '../sicop-cr-normalizer';
import { validateRecordIdentityKey } from '../../../record-identity';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProvider(cedula = '3101123456', name = 'EMPRESA TEST S.A.'): UniqueProvider {
  return {
    cedula,
    name,
    records: [
      { cedula, name, procedureNumber: 'LP-001-2024', buyerId: '4000042011', buyerName: 'CCSS', eventDate: '2024-03-15', dataset: 'ofertas_2024' },
      { cedula, name, procedureNumber: 'CD-005-2024', buyerId: '2-000-042011', buyerName: 'MEP', eventDate: '2024-06-20', dataset: 'ofertas_2024' },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildSicopSnapshotRow — source_key y country_code', () => {
  // Caso 14: builder usa source_key cr_sicop
  it('usa source_key cr_sicop', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.source_key, SICOP_SOURCE_KEY);
    assert.equal(row.source_key, 'cr_sicop');
  });

  it('usa country_code CR', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.country_code, SICOP_COUNTRY_CODE);
    assert.equal(row.country_code, 'CR');
  });

  it('usa tax_id y normalized_tax_id iguales a cedula', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider('3101123456') });
    assert.equal(row.tax_id, '3101123456');
    assert.equal(row.normalized_tax_id, '3101123456');
  });
});

describe('buildSicopSnapshotRow — guardrails semánticos en raw_data', () => {
  // Caso 15: builder usa source_type procurement_signal
  it('raw_data.source_type = procurement_signal', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.raw_data.source_type, 'procurement_signal');
  });

  // Caso 16: legal_validation_status = not_applicable
  it('raw_data.legal_validation_status = not_applicable', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.raw_data.legal_validation_status, 'not_applicable');
  });

  // Caso 17: tax_validation_status = not_applicable
  it('raw_data.tax_validation_status = not_applicable', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.raw_data.tax_validation_status, 'not_applicable');
  });

  // Caso 18: no inventa CIIU
  it('raw_data.official_ciiu_available = false', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.raw_data.official_ciiu_available, false);
  });

  it('raw_data.ciiu_status = unavailable_for_mvp', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.raw_data.ciiu_status, 'unavailable_for_mvp');
  });

  it('raw_data.sector_source = procurement_category_or_not_official', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.raw_data.sector_source, 'procurement_category_or_not_official');
  });

  it('raw_data.human_review_required = true', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.raw_data.human_review_required, true);
  });

  it('raw_data.priority_boost = true', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.raw_data.priority_boost, true);
  });

  // Caso 19: limita sample_records
  it('raw_data.sample_records limitado a MAX 8 entradas', () => {
    const bigProvider: UniqueProvider = {
      cedula: '3101999999',
      name: 'MEGA CORP S.A.',
      records: Array.from({ length: 20 }, (_, i) => ({
        cedula: '3101999999',
        name: 'MEGA CORP S.A.',
        procedureNumber: `LP-00${i}-2024`,
        buyerId: null,
        buyerName: `INST ${i}`,
        eventDate: `2024-0${(i % 9) + 1}-01`,
        dataset: 'ofertas_2024',
      })),
    };
    const row = buildSicopSnapshotRow({ provider: bigProvider });
    assert.ok(row.raw_data.sample_records.length <= 8);
  });

  it('raw_data.supplier_id = cedula del proveedor', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider('3102654321') });
    assert.equal(row.raw_data.supplier_id, '3102654321');
  });
});

describe('buildSicopSnapshotRow — estructura de columnas top-level', () => {
  it('sector = null (no inventa sector)', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.sector, null);
  });

  it('financials = {} (sin datos financieros)', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.deepEqual(row.financials, {});
  });

  it('legal_name = nombre del proveedor', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider('3101123456', 'MI EMPRESA S.A.') });
    assert.equal(row.legal_name, 'MI EMPRESA S.A.');
  });

  it('signals contiene total_records_year', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider() });
    assert.equal(row.signals.total_records_year, 2);
  });
});

describe('buildSicopSnapshotRows — batch', () => {
  it('construye filas para múltiples proveedores', () => {
    const providers = [makeProvider('3101111111', 'EMPRESA A'), makeProvider('3102222222', 'EMPRESA B')];
    const rows = buildSicopSnapshotRows(providers);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].source_key, 'cr_sicop');
    assert.equal(rows[1].source_key, 'cr_sicop');
  });
});

// ─── buildSicopSnapshotRow — record identity shadow (EC4D5.C2) ────────────────

describe('buildSicopSnapshotRow — record identity shadow (EC4D5.C2)', () => {
  it('setea record_identity_key = tax:<cedula_juridica>', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider('3101123456') });
    assert.equal(row.record_identity_key, 'tax:3101123456');
  });

  it('record_identity_key deriva de normalized_tax_id (= cedula), no de otro campo', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider('3109999999', 'OTRA EMPRESA S.A.') });
    assert.equal(row.record_identity_key, `tax:${row.normalized_tax_id}`);
  });

  it('record_identity_key es null cuando la cedula está vacía, sin excluir la fila', () => {
    const emptyCedulaProvider: UniqueProvider = { ...makeProvider(), cedula: '' };
    const row = buildSicopSnapshotRow({ provider: emptyCedulaProvider });
    assert.equal(row.record_identity_key, null);
    assert.equal(row.source_key, 'cr_sicop');
  });

  it('buildSicopSnapshotRows propaga record_identity_key en cada fila del batch', () => {
    const providers = [makeProvider('3101111111', 'EMPRESA A'), makeProvider('3102222222', 'EMPRESA B')];
    const rows = buildSicopSnapshotRows(providers);
    assert.equal(rows[0].record_identity_key, 'tax:3101111111');
    assert.equal(rows[1].record_identity_key, 'tax:3102222222');
  });
});

// ─── buildSicopSnapshotRow — record identity boundary (APP-B P2B) ─────────────
//
// El upsert real (run-sicop-cr-snapshot-etl.ts) parte las filas en allowed vs
// blocked usando validateRecordIdentityKey. Estos tests cubren, a nivel de
// función pura, los dos resultados posibles del builder frente a esa validación.

describe('buildSicopSnapshotRow — record identity boundary (APP-B P2B)', () => {
  it('una fila con cédula válida produce un record_identity_key que pasa validateRecordIdentityKey', () => {
    const row = buildSicopSnapshotRow({ provider: makeProvider('3101123456') });
    const validation = validateRecordIdentityKey(row.record_identity_key);
    assert.equal(validation.valid, true);
  });

  it('una fila con cédula vacía produce un record_identity_key null que falla validateRecordIdentityKey', () => {
    const emptyCedulaProvider: UniqueProvider = { ...makeProvider(), cedula: '' };
    const row = buildSicopSnapshotRow({ provider: emptyCedulaProvider });
    const validation = validateRecordIdentityKey(row.record_identity_key);
    assert.equal(validation.valid, false);
    if (validation.valid) return;
    assert.equal(validation.reason, 'missing_value');
  });
});
