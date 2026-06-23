/**
 * SUNAT Peru Bulk — Line Parser
 *
 * Parser seguro de líneas del Padrón Reducido RUC.
 * Soporta separador configurable (pipe, tab, comma) y column mapping.
 * No descarga ZIP. No guarda archivos. No escribe en DB.
 */

import type {
  SunatBulkParseInput,
  SunatBulkParseOutput,
  SunatBulkParsedRecord,
  SunatBulkParserWarning,
  SunatBulkParserStats,
  SunatBulkColumnMapping,
} from './types';
import { normalizeRuc, normalizeSunatRecord } from './normalizers';

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

export function parseSunatBulkLines(input: SunatBulkParseInput): SunatBulkParseOutput {
  const { lines, config } = input;
  const { delimiter, columnMapping, skipEmptyLines, maxLineLength } = config;

  const companies: SunatBulkParseOutput['companies'] = [];
  const warnings: SunatBulkParserWarning[] = [];
  const errors: string[] = [];

  let parsedLines = 0;
  let invalidLines = 0;
  let skippedNaturalPersons = 0;
  let activeCompanies = 0;
  let inactiveCompanies = 0;

  const processedIndexes = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
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
      if (config.strictMode) {
        invalidLines++;
        continue;
      }
    }

    const parts = line.split(delimiter);
    const rucIdx = columnMapping.ruc;

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
    processedIndexes.add(i);

    if (!normalized.isLikelyCompany) {
      skippedNaturalPersons++;
    }

    if (normalized.isActiveTaxpayer === true) {
      activeCompanies++;
    } else if (normalized.isActiveTaxpayer === false) {
      inactiveCompanies++;
    }

    companies.push(normalized);
  }

  const stats: SunatBulkParserStats = {
    inputLines: lines.length,
    parsedLines,
    validCompanies: companies.length,
    invalidLines,
    skippedNaturalPersons,
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
