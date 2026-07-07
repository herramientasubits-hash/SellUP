/**
 * Tests — GT RGAE Adapter + Dedup
 * Hito: Centroamérica.7G.1
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adaptRgaeRows } from '../gt-rgae-adapter';
import type { GtRgaeRawRow } from '../gt-rgae-types';

function makeRow(overrides: Partial<GtRgaeRawRow> = {}): GtRgaeRawRow {
  return {
    NIT_PROVEEDOR: '1234567',
    TIPO_PROVEEDOR: 'Sociedades',
    NOMBRE_PROVEEDOR: 'EMPRESA TEST SA',
    TIPO_SOLICITUD: 'INSCRIPCION',
    FECHA_RESOLUCION: '2025-01-15',
    NO_RESOLUCION: 100,
    NO_CONSTANCIA: 200,
    CAPACIDAD_ECONOMICA: 'N/A',
    ...overrides,
  };
}

describe('adaptRgaeRows — tipo proveedor filter', () => {
  it('Persona Individual es excluida', () => {
    const { candidates, stats } = adaptRgaeRows([makeRow({ TIPO_PROVEEDOR: 'Persona Individual' })]);
    assert.equal(candidates.length, 0);
    assert.equal(stats.personaIndividual, 1);
  });

  it('Comerciante Individual es excluida', () => {
    const { candidates, stats } = adaptRgaeRows([makeRow({ TIPO_PROVEEDOR: 'Comerciante Individual' })]);
    assert.equal(candidates.length, 0);
    assert.equal(stats.comercianteIndividual, 1);
  });

  it('ONG es excluida en v1', () => {
    const { candidates, stats } = adaptRgaeRows([makeRow({ TIPO_PROVEEDOR: 'ONG' })]);
    assert.equal(candidates.length, 0);
    assert.equal(stats.ong, 1);
  });

  it('Asociación es excluida en v1', () => {
    const { candidates, stats } = adaptRgaeRows([makeRow({ TIPO_PROVEEDOR: 'Asociación' })]);
    assert.equal(candidates.length, 0);
    assert.equal(stats.asociacion, 1);
  });

  it('Sociedades es admitida', () => {
    const { candidates, stats } = adaptRgaeRows([makeRow({ TIPO_PROVEEDOR: 'Sociedades' })]);
    assert.equal(candidates.length, 1);
    assert.equal(stats.sociedades, 1);
  });
});

describe('adaptRgaeRows — NIT inválido excluido', () => {
  it('NIT con letras es excluido', () => {
    const { candidates, stats } = adaptRgaeRows([makeRow({ NIT_PROVEEDOR: 'ABCDEF' })]);
    assert.equal(candidates.length, 0);
    assert.equal(stats.sociedadesInvalidNit, 1);
  });

  it('NIT de 4 dígitos es excluido', () => {
    const { candidates, stats } = adaptRgaeRows([makeRow({ NIT_PROVEEDOR: '1234' })]);
    assert.equal(candidates.length, 0);
    assert.equal(stats.sociedadesInvalidNit, 1);
  });

  it('NIT de 11 dígitos es excluido', () => {
    const { candidates, stats } = adaptRgaeRows([makeRow({ NIT_PROVEEDOR: '12345678901' })]);
    assert.equal(candidates.length, 0);
    assert.equal(stats.sociedadesInvalidNit, 1);
  });
});

describe('adaptRgaeRows — dedup', () => {
  it('NIT duplicado resulta en un solo candidato', () => {
    const rows: GtRgaeRawRow[] = [
      makeRow({ FECHA_RESOLUCION: '2024-01-01', NO_RESOLUCION: 100 }),
      makeRow({ FECHA_RESOLUCION: '2025-06-01', NO_RESOLUCION: 200 }),
    ];
    const { candidates, stats } = adaptRgaeRows(rows);
    assert.equal(candidates.length, 1);
    assert.equal(stats.duplicateSociedadRows, 1);
  });

  it('resolución más reciente gana (tie-breaker 1: fecha)', () => {
    const rows: GtRgaeRawRow[] = [
      makeRow({ FECHA_RESOLUCION: '2025-06-01', NO_RESOLUCION: 50, NOMBRE_PROVEEDOR: 'EMPRESA NUEVA SA' }),
      makeRow({ FECHA_RESOLUCION: '2024-01-01', NO_RESOLUCION: 500, NOMBRE_PROVEEDOR: 'EMPRESA VIEJA SA' }),
    ];
    const { candidates } = adaptRgaeRows(rows);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.resolutionDate, '2025-06-01');
  });

  it('mismo fecha → NO_RESOLUCION mayor gana (tie-breaker 2)', () => {
    const rows: GtRgaeRawRow[] = [
      makeRow({ FECHA_RESOLUCION: '2025-01-15', NO_RESOLUCION: 50 }),
      makeRow({ FECHA_RESOLUCION: '2025-01-15', NO_RESOLUCION: 999 }),
    ];
    const { candidates } = adaptRgaeRows(rows);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.resolutionNumber, 999);
  });

  it('tie-breaker 3 es determinístico (NOMBRE alphabetically first gana)', () => {
    const rows: GtRgaeRawRow[] = [
      makeRow({ FECHA_RESOLUCION: '2025-01-15', NO_RESOLUCION: 100, NOMBRE_PROVEEDOR: 'ZEBRA SA' }),
      makeRow({ FECHA_RESOLUCION: '2025-01-15', NO_RESOLUCION: 100, NOMBRE_PROVEEDOR: 'ALFA SA' }),
    ];
    const { candidates } = adaptRgaeRows(rows);
    assert.equal(candidates.length, 1);
    // ALFA < ZEBRA alphabetically → ALFA gana
    assert.equal(candidates[0]!.normalizedSupplierName, 'ALFA SA');
  });
});

describe('adaptRgaeRows — invariantes del candidato', () => {
  it('sourceType = government_supplier_registry', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.sourceType, 'government_supplier_registry');
  });

  it('supplierType = Sociedades', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.supplierType, 'Sociedades');
  });

  it('humanReviewRequired = true', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.humanReviewRequired, true);
  });

  it('postApprovalEnabled = false', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.postApprovalEnabled, false);
  });

  it('matchingAutomaticEnabled = false', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.matchingAutomaticEnabled, false);
  });

  it('accountCreationEnabled = false', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.accountCreationEnabled, false);
  });

  it('canonicalNameOverwriteEnabled = false', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.canonicalNameOverwriteEnabled, false);
  });

  it('fiscalValidationStatus = not_applicable', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.fiscalValidationStatus, 'not_applicable');
  });

  it('legalValidationStatus = not_applicable', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.equal(candidates[0]!.legalValidationStatus, 'not_applicable');
  });

  it('normalizedNit contiene solo dígitos', () => {
    const { candidates } = adaptRgaeRows([makeRow({ NIT_PROVEEDOR: '123-456-7' })]);
    assert.ok(candidates.length > 0);
    assert.match(candidates[0]!.normalizedNit, /^\d+$/);
  });

  it('normalizedNit longitud entre 5 y 10', () => {
    const { candidates } = adaptRgaeRows([makeRow()]);
    assert.ok(candidates.length > 0);
    const len = candidates[0]!.normalizedNit.length;
    assert.ok(len >= 5 && len <= 10, `longitud ${len} fuera de rango`);
  });
});
