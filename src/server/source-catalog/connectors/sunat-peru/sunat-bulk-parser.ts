/**
 * SUNAT Peru Bulk — Line Parser
 *
 * Parser seguro de líneas del Padrón Reducido RUC.
 * Soporta separador configurable (pipe, tab, comma), column mapping,
 * detección de header row, y filtro B2B (RUC 20).
 *
 * No descarga ZIP. No guarda archivos. No escribe en DB.
 */

import type {
  SunatBulkParseInput,
  SunatBulkParseOutput,
  SunatBulkParsedRecord,
  SunatBulkParserWarning,
  SunatBulkParserStats,
} from './types';
import { normalizeRuc, normalizeSunatRecord, classifyRuc } from './normalizers';
import { SUNAT_REAL_EXPECTED_COLUMN_COUNT } from './sunat-bulk-parser-config';

const MAX_PREVIEW_LENGTH = 120;

function truncateLine(line: string, max: number = MAX_PREVIEW_LENGTH): string {
  if (line.length <= max) return line;
  return line.slice(0, max) + '...';
}

function getColumn(
  parts: string[],
  idx: number | undefined,
): string | undefined {
  if (idx === undefined || idx >= parts.length) return undefined;
  const val = parts[idx].trim();
  return val || undefined;
}

function isHeaderRow(
  parts: string[],
  rucIdx: number,
): boolean {
  if (rucIdx >= parts.length) return false;
  return parts[rucIdx].trim().toUpperCase() === 'RUC';
}

function detectHeaderRow(lines: string[], delimiter: string, rucIdx: number): number {
  if (lines.length === 0) return -1;
  const parts = lines[0].split(delimiter);
  if (isHeaderRow(parts, rucIdx)) return 0;
  return -1;
}

export function parseSunatBulkLines(input: SunatBulkParseInput): SunatBulkParseOutput {
  const { lines, config } = input;
  const {
    delimiter,
    columnMapping,
    skipEmptyLines,
    maxLineLength,
    strictMode,
    hasHeaderRow,
    includeNaturalPersons,
    expectedColumnCount,
  } = config;

  const companies: SunatBulkParseOutput['companies'] = [];
  const warnings: SunatBulkParserWarning[] = [];
  const errors: string[] = [];

  let parsedLines = 0;
  let invalidLines = 0;
  let skippedNaturalPersons = 0;
  let skippedNonCompanyRuc = 0;
  let headerRowsSkipped = 0;
  let activeCompanies = 0;
  let inactiveCompanies = 0;

  const startIndex = hasHeaderRow
    ? detectHeaderRow(lines, delimiter, columnMapping.ruc)
    : -1;

  if (startIndex >= 0) {
    headerRowsSkipped++;
    warnings.push({
      code: 'header_row_skipped',
      message: 'Header row detectada y omitida (primera columna: RUC)',
      lineNumber: 1,
      redactedLinePreview: truncateLine(lines[0]),
    });
  }

  const effectiveStart = startIndex >= 0 ? startIndex + 1 : 0;

  for (let i = effectiveStart; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (skipEmptyLines && line.trim() === '') {
      continue;
    }

    if (line.length > maxLineLength) {
      warnings.push({
        code: 'line_too_long',
        message: `Línea ${lineNumber} excede longitud máxima de ${maxLineLength}`,
        lineNumber,
        redactedLinePreview: truncateLine(line),
      });
      if (strictMode) {
        invalidLines++;
        continue;
      }
    }

    const parts = line.split(delimiter);
    const rucIdx = columnMapping.ruc;

    const actualColumnCount = parts.length;

    if (expectedColumnCount !== undefined && actualColumnCount !== expectedColumnCount) {
      warnings.push({
        code: 'unexpected_column_count',
        message: `Línea ${lineNumber}: ${actualColumnCount} columnas (esperadas: ${expectedColumnCount})`,
        lineNumber,
        redactedLinePreview: truncateLine(line),
      });
    }

    if (rucIdx >= parts.length) {
      warnings.push({
        code: 'missing_ruc_column',
        message: `Línea ${lineNumber}: índice de columna RUC ${rucIdx} fuera de rango (${parts.length} columnas)`,
        lineNumber,
        redactedLinePreview: truncateLine(line),
      });
      invalidLines++;
      continue;
    }

    const rawRuc = parts[rucIdx].trim();
    const cleanedRuc = normalizeRuc(rawRuc);

    if (!cleanedRuc || cleanedRuc.length < 8) {
      warnings.push({
        code: 'invalid_ruc',
        message: `Línea ${lineNumber}: RUC inválido`,
        lineNumber,
        redactedLinePreview: truncateLine(line),
      });
      invalidLines++;
      continue;
    }

    const record: SunatBulkParsedRecord = {
      ruc: cleanedRuc,
      legalName: getColumn(parts, columnMapping.legalName) ?? '',
      taxpayerStatus: getColumn(parts, columnMapping.taxpayerStatus),
      domicileCondition: getColumn(parts, columnMapping.domicileCondition),
      ubigeo: getColumn(parts, columnMapping.ubigeo),
      department: getColumn(parts, columnMapping.department),
      province: getColumn(parts, columnMapping.province),
      district: getColumn(parts, columnMapping.district),
      address: getColumn(parts, columnMapping.address),
    };

    const normalized = normalizeSunatRecord(record);
    parsedLines++;

    const rucCategory = classifyRuc(cleanedRuc);

    if (rucCategory === 'company') {
      companies.push(normalized);
      if (normalized.isActiveTaxpayer === true) {
        activeCompanies++;
      } else if (normalized.isActiveTaxpayer === false) {
        inactiveCompanies++;
      }
    } else if (rucCategory === 'natural_person') {
      skippedNaturalPersons++;
      if (!includeNaturalPersons) {
        warnings.push({
          code: 'natural_person_ruc_skipped',
          message: `Línea ${lineNumber}: RUC 10 (persona natural) omitida. Usar includeNaturalPersons: true para incluir`,
          lineNumber,
          redactedLinePreview: truncateLine(line),
        });
      } else {
        companies.push(normalized);
        if (normalized.isActiveTaxpayer === true) {
          activeCompanies++;
        } else if (normalized.isActiveTaxpayer === false) {
          inactiveCompanies++;
        }
      }
    } else {
      skippedNonCompanyRuc++;
      warnings.push({
        code: 'unsupported_ruc_prefix',
        message: `Línea ${lineNumber}: RUC con prefijo no soportado para B2B (${cleanedRuc.slice(0, 2)}...)`,
        lineNumber,
        redactedLinePreview: truncateLine(line),
      });
    }
  }

  const stats: SunatBulkParserStats = {
    inputLines: lines.length,
    parsedLines,
    validCompanies: companies.length,
    invalidLines,
    skippedNaturalPersons,
    skippedNonCompanyRuc,
    headerRowsSkipped,
    activeCompanies,
    inactiveCompanies,
  };

  return {
    sourceKey: 'pe_sunat_bulk',
    mode: 'line_parser',
    companies,
    stats,
    warnings,
    errors,
  };
}
