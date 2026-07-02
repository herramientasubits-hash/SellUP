/**
 * Tests unitarios — SICOP CR Normalizer + Parser
 *
 * Sin red real. Cubre normalización de cédula jurídica,
 * extracción de columnas y parsing de filas.
 *
 * Hito: Centroamérica.4A
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeCostaRicaLegalId,
  extractCedula,
  extractProviderName,
  parseSicopRows,
  deduplicateProviders,
} from '../sicop-cr-normalizer';

// ─── normalizeCostaRicaLegalId ────────────────────────────────────────────────

describe('normalizeCostaRicaLegalId', () => {
  // Caso 9: acepta cédula jurídica válida que inicia con 3
  it('acepta cédula jurídica con formato 3-101-XXXXXX (10 dígitos)', () => {
    const result = normalizeCostaRicaLegalId('3-101-123456');
    assert.ok(result.valid);
    if (result.valid) assert.equal(result.normalized, '3101123456');
  });

  it('acepta cédula jurídica sin guiones ya limpia', () => {
    const result = normalizeCostaRicaLegalId('3101123456');
    assert.ok(result.valid);
    if (result.valid) assert.equal(result.normalized, '3101123456');
  });

  it('acepta cédula con puntos como separadores', () => {
    const result = normalizeCostaRicaLegalId('3.101.123456');
    assert.ok(result.valid);
    if (result.valid) assert.equal(result.normalized, '3101123456');
  });

  it('acepta cédula con espacios como separadores', () => {
    const result = normalizeCostaRicaLegalId('3 101 123456');
    assert.ok(result.valid);
    if (result.valid) assert.equal(result.normalized, '3101123456');
  });

  // Caso 10: rechaza cédula física/no empresa (no inicia con 3)
  it('rechaza cédula de persona física (inicia con 1) → non_company_identifier', () => {
    const result = normalizeCostaRicaLegalId('1-1234-5678');
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'non_company_identifier');
  });

  it('rechaza cédula que inicia con 2 → non_company_identifier', () => {
    const result = normalizeCostaRicaLegalId('2-123456789');
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'non_company_identifier');
  });

  it('rechaza cédula que inicia con 5 → non_company_identifier', () => {
    const result = normalizeCostaRicaLegalId('5101123456');
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'non_company_identifier');
  });

  // Caso 11: rechaza identificador inválido
  it('rechaza identificador con letras → invalid_identifier', () => {
    const result = normalizeCostaRicaLegalId('3-ABC-12345');
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'invalid_identifier');
  });

  it('rechaza identificador demasiado corto → invalid_identifier', () => {
    const result = normalizeCostaRicaLegalId('3101');
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'invalid_identifier');
  });

  it('rechaza identificador demasiado largo → invalid_identifier', () => {
    const result = normalizeCostaRicaLegalId('310112345678901');
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'invalid_identifier');
  });

  it('rechaza null → no_identifier', () => {
    const result = normalizeCostaRicaLegalId(null);
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'no_identifier');
  });

  it('rechaza string vacío → no_identifier', () => {
    const result = normalizeCostaRicaLegalId('');
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'no_identifier');
  });
});

// ─── extractCedula / extractProviderName ─────────────────────────────────────

// Caso 12: parser soporta CEDULA_PROVEEDOR + PROVEEDOR
describe('extractCedula + extractProviderName con columna PROVEEDOR', () => {
  it('extrae CEDULA_PROVEEDOR y PROVEEDOR', () => {
    const row = { CEDULA_PROVEEDOR: '3101123456', PROVEEDOR: 'EMPRESA DEMO S.A.' };
    assert.equal(extractCedula(row), '3101123456');
    assert.equal(extractProviderName(row), 'EMPRESA DEMO S.A.');
  });
});

// Caso 13: parser soporta CEDULA_PROVEEDOR + EMPRESA_PROVEEDORA
describe('extractProviderName con columna EMPRESA_PROVEEDORA', () => {
  it('extrae EMPRESA_PROVEEDORA cuando no hay PROVEEDOR', () => {
    const row = { CEDULA_PROVEEDOR: '3101123456', EMPRESA_PROVEEDORA: 'DEMO CORP S.A.' };
    assert.equal(extractProviderName(row), 'DEMO CORP S.A.');
  });

  it('prioriza PROVEEDOR sobre EMPRESA_PROVEEDORA si ambas existen', () => {
    const row = { CEDULA_PROVEEDOR: '3101123456', PROVEEDOR: 'NOMBRE_A', EMPRESA_PROVEEDORA: 'NOMBRE_B' };
    assert.equal(extractProviderName(row), 'NOMBRE_A');
  });
});

// ─── parseSicopRows ───────────────────────────────────────────────────────────

describe('parseSicopRows', () => {
  it('parsea filas válidas con cédula jurídica y nombre', () => {
    const rows = [
      { CEDULA_PROVEEDOR: '3-101-123456', PROVEEDOR: 'EMPRESA A S.A.', NUMERO_PROCEDIMIENTO: 'LP-001-2024', CEDULA_INSTITUCION: '4000042011', INSTITUCION: 'CCSS', FECHA_SOLICITUD: '2024-03-15' },
      { CEDULA_PROVEEDOR: '3-102-654321', EMPRESA_PROVEEDORA: 'EMPRESA B LTDA', NRO_PROCEDIMIENTO: 'CD-005-2024' },
    ];
    const result = parseSicopRows(rows, 'ofertas_2024');
    assert.equal(result.totalRows, 2);
    assert.equal(result.providers.length, 2);
    assert.equal(result.providers[0].cedula, '3101123456');
    assert.equal(result.providers[0].name, 'EMPRESA A S.A.');
    assert.equal(result.providers[0].procedureNumber, 'LP-001-2024');
    assert.equal(result.providers[0].buyerName, 'CCSS');
    assert.equal(result.providers[0].dataset, 'ofertas_2024');
    assert.equal(result.providers[1].cedula, '3102654321');
    assert.equal(result.providers[1].name, 'EMPRESA B LTDA');
  });

  it('skipea filas con cédula de persona física', () => {
    const rows = [
      { CEDULA_PROVEEDOR: '1-1234-5678', PROVEEDOR: 'PERSONA NATURAL' },
    ];
    const result = parseSicopRows(rows, 'recursos');
    assert.equal(result.providers.length, 0);
    assert.equal(result.skippedNonCompany, 1);
  });

  it('skipea filas sin identificador', () => {
    const rows = [
      { PROVEEDOR: 'SIN CEDULA', NUMERO_PROCEDIMIENTO: 'LP-001' },
    ];
    const result = parseSicopRows(rows, 'aclaraciones');
    assert.equal(result.providers.length, 0);
    assert.equal(result.skippedNoIdentifier, 1);
  });

  it('respeta limit-rows', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      CEDULA_PROVEEDOR: `310${i}123456`,
      PROVEEDOR: `EMPRESA ${i}`,
    }));
    const result = parseSicopRows(rows, 'ofertas_2024', 3);
    assert.equal(result.totalRows, 3);
    assert.ok(result.warnings.length > 0);
  });

  it('skipea filas completamente vacías', () => {
    const rows = [
      {},
      { CEDULA_PROVEEDOR: '', PROVEEDOR: '' },
    ];
    const result = parseSicopRows(rows, 'recursos');
    assert.equal(result.providers.length, 0);
    assert.ok(result.skippedEmptyRow + result.skippedNoIdentifier >= 2);
  });
});

// ─── deduplicateProviders ─────────────────────────────────────────────────────

describe('deduplicateProviders', () => {
  it('agrupa registros del mismo proveedor por cédula', () => {
    const records = [
      { cedula: '3101123456', name: 'EMPRESA A S.A.', procedureNumber: 'LP-001', buyerId: null, buyerName: null, eventDate: '2024-01-01', dataset: 'ofertas_2024' },
      { cedula: '3101123456', name: 'EMPRESA A S.A.', procedureNumber: 'LP-002', buyerId: null, buyerName: null, eventDate: '2024-02-01', dataset: 'ofertas_2024' },
      { cedula: '3102654321', name: 'EMPRESA B LTDA', procedureNumber: 'CD-001', buyerId: null, buyerName: null, eventDate: '2024-01-15', dataset: 'recursos' },
    ];
    const result = deduplicateProviders(records);
    assert.equal(result.length, 2);
    const a = result.find((p) => p.cedula === '3101123456');
    assert.ok(a);
    assert.equal(a.records.length, 2);
  });

  it('respeta maxProviders', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      cedula: `310${i}000001`,
      name: `EMPRESA ${i}`,
      procedureNumber: null, buyerId: null, buyerName: null, eventDate: null,
      dataset: 'recursos',
    }));
    const result = deduplicateProviders(records, 3);
    assert.equal(result.length, 3);
  });
});
