// Tests — SIIS Snapshot ETL: parser, normalizer, financial parser, adapter
//
// Todos los tests son in-process. Sin llamadas externas. Sin Supabase.
// Usa fixtures generados in-memory con xlsx.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import {
  normalizeSiisNIT,
  normalizeSiisLegalName,
  parseSiisFinancialValue,
  parseExcelRows,
  mapRowToRecord,
  normalizeSiisHeaderCell,
  detectSiisHeaderRowIndex,
} from '../siis-snapshot-etl';
import type { SiisCompanyFinancialRecord } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExcelBuffer(
  headers: string[],
  rows: unknown[][],
): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SIIS');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function makeExcelBufferWithPreamble(
  preamble: unknown[][],
  headers: unknown[],
  rows: unknown[][],
): Buffer {
  const allRows = [...preamble, headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '2024');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ─── 1. normalizeSiisNIT ──────────────────────────────────────────────────────

describe('normalizeSiisNIT', () => {
  it('strips dots', () => {
    assert.equal(normalizeSiisNIT('900.123.456'), '900123456');
  });

  it('strips verification digit after dash', () => {
    assert.equal(normalizeSiisNIT('900123456-1'), '900123456');
  });

  it('strips dots and verification digit', () => {
    assert.equal(normalizeSiisNIT('900.123.456-1'), '900123456');
  });

  it('strips leading/trailing spaces', () => {
    assert.equal(normalizeSiisNIT('  900123456  '), '900123456');
  });

  it('returns plain digits unchanged', () => {
    assert.equal(normalizeSiisNIT('900123456'), '900123456');
  });

  it('returns null for undefined', () => {
    assert.equal(normalizeSiisNIT(undefined), null);
  });

  it('returns null for null', () => {
    assert.equal(normalizeSiisNIT(null), null);
  });

  it('returns null for empty string', () => {
    assert.equal(normalizeSiisNIT(''), null);
  });
});

// ─── 2. normalizeSiisLegalName ────────────────────────────────────────────────

describe('normalizeSiisLegalName', () => {
  it('lowercases and trims', () => {
    assert.equal(normalizeSiisLegalName('  TECHNO CORP SAS  '), 'techno');
  });

  it('removes accents', () => {
    assert.equal(normalizeSiisLegalName('Tecnología Avanzada'), 'tecnologia avanzada');
  });

  it('removes common legal suffixes', () => {
    assert.equal(normalizeSiisLegalName('Empresa S.A.S.'), 'empresa');
    assert.equal(normalizeSiisLegalName('Empresa S.A.S'), 'empresa');
    assert.equal(normalizeSiisLegalName('Empresa S.A.'), 'empresa');
    assert.equal(normalizeSiisLegalName('Empresa LTDA'), 'empresa');
    assert.equal(normalizeSiisLegalName('Empresa LTDA.'), 'empresa');
    assert.equal(normalizeSiisLegalName('Empresa E.U.'), 'empresa');
    assert.equal(normalizeSiisLegalName('Empresa SAS'), 'empresa');
    assert.equal(normalizeSiisLegalName('Empresa Corp.'), 'empresa');
    assert.equal(normalizeSiisLegalName('Empresa LLC'), 'empresa');
  });

  it('removes non-alphanumeric characters', () => {
    assert.equal(normalizeSiisLegalName('Empresa #1 (Test)'), 'empresa 1 test');
  });

  it('returns null for undefined', () => {
    assert.equal(normalizeSiisLegalName(undefined), null);
  });

  it('returns null for null', () => {
    assert.equal(normalizeSiisLegalName(null), null);
  });
});

// ─── 3. parseSiisFinancialValue ────────────────────────────────────────────────

describe('parseSiisFinancialValue', () => {
  it('parses plain number', () => {
    assert.equal(parseSiisFinancialValue(1234567), 1234567);
  });

  it('parses zero', () => {
    assert.equal(parseSiisFinancialValue(0), 0);
  });

  it('returns null for null', () => {
    assert.equal(parseSiisFinancialValue(null), null);
  });

  it('returns null for undefined', () => {
    assert.equal(parseSiisFinancialValue(undefined), null);
  });

  it('parses Colombian format with periods and comma', () => {
    assert.equal(parseSiisFinancialValue('1.234.567,89'), 1234567.89);
  });

  it('parses Colombian format with comma decimal', () => {
    assert.equal(parseSiisFinancialValue('1234567,89'), 1234567.89);
  });

  it('parses US format with commas', () => {
    assert.equal(parseSiisFinancialValue('1,234,567'), 1234567);
  });

  it('parses negative number', () => {
    assert.equal(parseSiisFinancialValue('-500000'), -500000);
  });

  it('returns null for empty string', () => {
    assert.equal(parseSiisFinancialValue(''), null);
  });

  it('returns null for N/A', () => {
    assert.equal(parseSiisFinancialValue('N/A'), null);
    assert.equal(parseSiisFinancialValue('n/a'), null);
  });

  it('parses string with currency symbol', () => {
    assert.equal(parseSiisFinancialValue('$1.234.567,89'), 1234567.89);
  });

  it('returns null for Infinity', () => {
    assert.equal(parseSiisFinancialValue(Infinity), null);
  });
});

// ─── 4. mapRowToRecord ────────────────────────────────────────────────────────

describe('mapRowToRecord', () => {
  it('maps a complete row correctly', () => {
    const row = {
      NIT: '900.123.456-1',
      'RAZÓN SOCIAL': 'Tecnología Avanzada SAS',
      SUPERVISOR: 'Supersociedades',
      REGIÓN: 'Central',
      'DEPARTAMENTO DOMICILIO': 'Cundinamarca',
      'CIUDAD DOMICILIO': 'Bogotá',
      CIIU: '6201',
      MACROSECTOR: 'Servicios',
      'INGRESOS OPERACIONALES 2024': '1.234.567.000',
      'GANANCIA (PÉRDIDA) 2024': '123.456.700',
      'TOTAL ACTIVOS 2024': '2.345.678.000',
      'TOTAL PASIVOS 2024': '1.000.000.000',
      'TOTAL PATRIMONIO 2024': '1.345.678.000',
      'INGRESOS OPERACIONALES 2023': '1.000.000.000',
      'GANANCIA (PÉRDIDA) 2023': '100.000.000',
      'TOTAL ACTIVOS 2023': '2.000.000.000',
      'TOTAL PASIVOS 2023': '900.000.000',
      'TOTAL PATRIMONIO 2023': '1.100.000.000',
    };

    const result = mapRowToRecord(row, 2024);
    assert.notEqual(result, null);
    assert.equal(result!.sourceKey, 'co_siis');
    assert.equal(result!.countryCode, 'CO');
    assert.equal(result!.sourceYear, 2024);
    assert.equal(result!.taxId, '900.123.456-1');
    assert.equal(result!.legalName, 'Tecnología Avanzada SAS');
    assert.equal(result!.supervisor, 'Supersociedades');
    assert.equal(result!.region, 'Central');
    assert.equal(result!.department, 'Cundinamarca');
    assert.equal(result!.city, 'Bogotá');
    assert.equal(result!.ciiu, '6201');
    assert.equal(result!.macrosector, 'Servicios');
    assert.equal(result!.financials!.operatingRevenueCurrent, 1234567000);
    assert.equal(result!.financials!.profitLossCurrent, 123456700);
    assert.equal(result!.financials!.totalAssetsCurrent, 2345678000);
    assert.equal(result!.financials!.totalLiabilitiesCurrent, 1000000000);
    assert.equal(result!.financials!.totalEquityCurrent, 1345678000);
    assert.equal(result!.financials!.operatingRevenuePrevious, 1000000000);
    assert.equal(result!.financials!.profitLossPrevious, 100000000);
    assert.equal(result!.financials!.totalAssetsPrevious, 2000000000);
    assert.equal(result!.financials!.totalLiabilitiesPrevious, 900000000);
    assert.equal(result!.financials!.totalEquityPrevious, 1100000000);
  });

  it('returns null when NIT is missing', () => {
    const result = mapRowToRecord({ 'RAZÓN SOCIAL': 'Empresa X' }, 2024);
    assert.equal(result, null);
  });

  it('returns null when Razón Social is missing', () => {
    const result = mapRowToRecord({ NIT: '900123456' }, 2024);
    assert.equal(result, null);
  });

  it('handles minimal columns', () => {
    const result = mapRowToRecord({ NIT: '900123456', 'RAZÓN SOCIAL': 'Empresa' }, 2024);
    assert.notEqual(result, null);
    assert.equal(result!.taxId, '900123456');
    assert.equal(result!.legalName, 'Empresa');
    assert.equal(result!.financials?.operatingRevenueCurrent, null);
  });

  it('tolerates extra columns', () => {
    const row = {
      NIT: '900123456',
      'RAZÓN SOCIAL': 'Empresa X',
      RANKING: 1,
      EXTRA_COL: 'ignored',
    };
    const result = mapRowToRecord(row, 2024);
    assert.notEqual(result, null);
  });
});

// ─── 5. normalizeSiisHeaderCell ──────────────────────────────────────────────

describe('normalizeSiisHeaderCell', () => {
  it('normalizes accents', () => {
    assert.equal(normalizeSiisHeaderCell('RAZÓN SOCIAL'), 'RAZON SOCIAL');
  });

  it('removes asterisks', () => {
    assert.equal(normalizeSiisHeaderCell('INGRESOS OPERACIONALES 2024*'), 'INGRESOS OPERACIONALES 2024');
  });

  it('normalizes double spaces', () => {
    assert.equal(normalizeSiisHeaderCell('TOTAL PASIVOS  2024'), 'TOTAL PASIVOS 2024');
  });

  it('normalizes triple spaces', () => {
    assert.equal(normalizeSiisHeaderCell('TOTAL  PATRIMONIO   2024'), 'TOTAL PATRIMONIO 2024');
  });

  it('uppercases', () => {
    assert.equal(normalizeSiisHeaderCell('nit'), 'NIT');
  });

  it('returns empty string for null', () => {
    assert.equal(normalizeSiisHeaderCell(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(normalizeSiisHeaderCell(undefined), '');
  });

  it('returns empty string for empty string', () => {
    assert.equal(normalizeSiisHeaderCell(''), '');
  });
});

// ─── 6. detectSiisHeaderRowIndex ──────────────────────────────────────────────

describe('detectSiisHeaderRowIndex', () => {
  it('finds header at row 0 with NIT and RAZÓN SOCIAL', () => {
    const rows: unknown[][] = [
      ['NIT', 'RAZÓN SOCIAL', 'CIIU', 'MACROSECTOR', 'INGRESOS OPERACIONALES 2024'],
    ];
    assert.equal(detectSiisHeaderRowIndex(rows), 0);
  });

  it('finds header at row 3 when preamble precedes it', () => {
    const rows: unknown[][] = [
      ['Nota: información en billones de pesos'],
      ['Módulo SIIS Supersociedades'],
      ['Billones de pesos', '2024', '2023'],
      ['NIT', 'RAZÓN SOCIAL', 'CIIU', 'MACROSECTOR', 'TOTAL ACTIVOS 2024'],
      ['900123456', 'Empresa A', '6201', 'Servicios', '1000000'],
    ];
    assert.equal(detectSiisHeaderRowIndex(rows), 3);
  });

  it('prefers row with higher score', () => {
    const rows: unknown[][] = [
      ['NIT', 'RAZÓN SOCIAL'],                    // score 200
      ['NIT', 'RAZÓN SOCIAL', 'CIIU', 'MACROSECTOR'], // score 300
    ];
    assert.equal(detectSiisHeaderRowIndex(rows), 1);
  });

  it('returns -1 when no header found', () => {
    const rows: unknown[][] = [
      ['Nota al pie'],
      ['Título del reporte'],
    ];
    assert.equal(detectSiisHeaderRowIndex(rows), -1);
  });

  it('returns -1 for empty rows', () => {
    assert.equal(detectSiisHeaderRowIndex([]), -1);
  });

  it('handles headers with extra spaces', () => {
    const rows: unknown[][] = [
      ['NIT', 'RAZÓN SOCIAL', 'TOTAL PASIVOS  2024'],
    ];
    assert.equal(detectSiisHeaderRowIndex(rows), 0);
  });

  it('handles headers with asterisks', () => {
    const rows: unknown[][] = [
      ['NIT', 'RAZÓN SOCIAL', 'INGRESOS OPERACIONALES 2024*'],
    ];
    assert.equal(detectSiisHeaderRowIndex(rows), 0);
  });

  it('handles headers with null cells interspersed', () => {
    const rows: unknown[][] = [
      [null, 'RAZÓN SOCIAL', null, 'NIT', null, 'CIIU'],
    ];
    assert.equal(detectSiisHeaderRowIndex(rows), 0);
  });
});

// ─── 7. parseExcelRows with real xlsx buffer ──────────────────────────────────

describe('parseExcelRows', () => {
  it('parses a real Excel buffer with SIIS columns', () => {
    const headers = [
      'NIT',
      'RAZÓN SOCIAL',
      'SUPERVISOR',
      'REGIÓN',
      'DEPARTAMENTO DOMICILIO',
      'CIUDAD DOMICILIO',
      'CIIU',
      'MACROSECTOR',
      'INGRESOS OPERACIONALES 2024',
      'GANANCIA (PÉRDIDA) 2024',
      'TOTAL ACTIVOS 2024',
      'TOTAL PASIVOS 2024',
      'TOTAL PATRIMONIO 2024',
    ];

    const rows: unknown[][] = [
      ['900.123.456-1', 'Tecnología Avanzada SAS', 'Supersociedades', 'Central', 'Cundinamarca', 'Bogotá', '6201', 'Servicios', 1234567000, 123456700, 2345678000, 1000000000, 1345678000],
      ['800.987.654-5', 'Construcciones del Sur S.A.S.', 'Supersociedades', 'Sur', 'Antioquia', 'Medellín', '4101', 'Construcción', 5000000000, 500000000, 8000000000, 3000000000, 5000000000],
    ];

    const buffer = makeExcelBuffer(headers, rows);
    const records = parseExcelRows(buffer, 2024);

    assert.equal(records.length, 2);
    assert.equal(records[0].taxId, '900.123.456-1');
    assert.equal(records[0].legalName, 'Tecnología Avanzada SAS');
    assert.equal(records[0].financials?.operatingRevenueCurrent, 1234567000);
    assert.equal(records[1].taxId, '800.987.654-5');
    assert.equal(records[1].legalName, 'Construcciones del Sur S.A.S.');
    assert.equal(records[1].financials?.operatingRevenueCurrent, 5000000000);
  });

  it('filters rows without NIT', () => {
    const headers = ['NIT', 'RAZÓN SOCIAL'];
    const rows: unknown[][] = [
      ['900123456', 'Empresa Válida'],
      [null, 'Empresa Sin NIT'],
      ['', 'Empresa Sin NIT 2'],
    ];
    const buffer = makeExcelBuffer(headers, rows);
    const records = parseExcelRows(buffer, 2024);
    assert.equal(records.length, 1);
    assert.equal(records[0].legalName, 'Empresa Válida');
  });

  it('filters rows without Razón Social', () => {
    const headers = ['NIT', 'RAZÓN SOCIAL'];
    const rows: unknown[][] = [
      ['900123456', 'Empresa Válida'],
      ['800987654', null],
    ];
    const buffer = makeExcelBuffer(headers, rows);
    const records = parseExcelRows(buffer, 2024);
    assert.equal(records.length, 1);
    assert.equal(records[0].taxId, '900123456');
  });

  it('returns empty array for empty sheet', () => {
    const headers: string[] = ['NIT', 'RAZÓN SOCIAL'];
    const rows: unknown[][] = [];
    const buffer = makeExcelBuffer(headers, rows);
    const records = parseExcelRows(buffer, 2024);
    assert.equal(records.length, 0);
  });

  it('parses Excel with 3 preamble rows before header at row 3', () => {
    const preamble: unknown[][] = [
      ['Nota: información en billones de pesos'],
      ['Módulo SIIS Supersociedades'],
      ['Billones de pesos', '2024', '2023'],
    ];
    const headers: unknown[] = [
      'NIT',
      'RAZÓN SOCIAL',
      'SUPERVISOR',
      'REGIÓN',
      'DEPARTAMENTO DOMICILIO',
      'CIUDAD DOMICILIO',
      'CIIU',
      'MACROSECTOR',
      'INGRESOS OPERACIONALES 2024',
      'GANANCIA (PÉRDIDA) 2024',
    ];
    const rows: unknown[][] = [
      ['900.123.456-1', 'Tecnología Avanzada SAS', 'Supersociedades', 'Central', 'Cundinamarca', 'Bogotá', '6201', 'Servicios', 1234567000, 123456700],
    ];

    const buffer = makeExcelBufferWithPreamble(preamble, headers, rows);
    const records = parseExcelRows(buffer, 2024);

    assert.equal(records.length, 1);
    assert.equal(records[0].taxId, '900.123.456-1');
    assert.equal(records[0].legalName, 'Tecnología Avanzada SAS');
    assert.equal(records[0].financials?.operatingRevenueCurrent, 1234567000);
  });

  it('parses header with extra spaces in column names', () => {
    const headers: string[] = [
      'NIT',
      'RAZÓN SOCIAL',
      'TOTAL PASIVOS  2024',
      'TOTAL PATRIMONIO  2024',
    ];
    const rows: unknown[][] = [
      ['900123456', 'Empresa X', 5000000, 3000000],
    ];

    const buffer = makeExcelBuffer(headers, rows);
    const records = parseExcelRows(buffer, 2024);

    assert.equal(records.length, 1);
    assert.equal(records[0].taxId, '900123456');
    assert.equal(records[0].financials?.totalLiabilitiesCurrent, 5000000);
    assert.equal(records[0].financials?.totalEquityCurrent, 3000000);
  });

  it('parses header with asterisk in column name', () => {
    const headers: string[] = [
      'NIT',
      'RAZÓN SOCIAL',
      'INGRESOS OPERACIONALES 2024*',
    ];
    const rows: unknown[][] = [
      ['900123456', 'Empresa Y', 10000000],
    ];

    const buffer = makeExcelBuffer(headers, rows);
    const records = parseExcelRows(buffer, 2024);

    assert.equal(records.length, 1);
    assert.equal(records[0].financials?.operatingRevenueCurrent, 10000000);
  });

  it('parses header at row 0 (no preamble)', () => {
    const headers = ['NIT', 'RAZÓN SOCIAL'];
    const rows: unknown[][] = [
      ['900123456', 'Empresa Z'],
    ];

    const buffer = makeExcelBuffer(headers, rows);
    const records = parseExcelRows(buffer, 2024);

    assert.equal(records.length, 1);
    assert.equal(records[0].taxId, '900123456');
  });

  it('returns empty array when no header found', () => {
    const rows: unknown[][] = [
      ['Nota al pie'],
      ['Título del reporte'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '2024');
    const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const records = parseExcelRows(buffer, 2024);
    assert.equal(records.length, 0);
  });
});

// ─── 8. Priority score (indirect via adapter logic snapshot row) ──────────────

describe('snapshot row build (upsert payload expectation)', () => {
  it('produces expected normalized fields from a record', () => {
    const record: SiisCompanyFinancialRecord = {
      sourceKey: 'co_siis',
      countryCode: 'CO',
      sourceYear: 2024,
      taxId: '900.123.456-1',
      legalName: 'Tecnología Avanzada SAS',
      supervisor: 'Supersociedades',
      region: 'Central',
      department: 'Cundinamarca',
      city: 'Bogotá',
      ciiu: '6201',
      macrosector: 'Servicios',
      financials: {
        currentYear: 2024,
        previousYear: 2023,
        operatingRevenueCurrent: 1_000_000_000,
      },
    };

    const normNit = normalizeSiisNIT(record.taxId);
    const normName = normalizeSiisLegalName(record.legalName);

    assert.equal(normNit, '900123456');
    assert.equal(normName, 'tecnologia avanzada');
  });
});
