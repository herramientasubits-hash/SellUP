/**
 * DGII República Dominicana Bulk — Parser
 *
 * Parser de líneas pipe-delimitadas del padrón RNC DGII.
 * Soporta detección de header y mapping posicional configurable.
 * Filtra cédulas de 11 dígitos (solo RNC jurídicos 9 dígitos en scope B2B).
 *
 * No descarga ZIP. No escribe en Supabase.
 */

import type { DgiiParsedRecord, DgiiNormalizedCompany, DgiiParserStats } from './types';
import {
  normalizeDominicanRnc,
  isDominicanBusinessRnc,
  normalizeDgiiStatus,
  isActiveDgiiTaxpayer,
} from './normalizers';

export const DGII_DEFAULT_DELIMITER = '|';

/**
 * Mapping posicional real del padrón TXT DGII (verificado en muestra 2026-06-30):
 * col 0: RNC/cédula
 * col 1: Nombre / Razón Social
 * col 2: Nombre Comercial
 * col 3: Actividad Económica (texto libre)
 * col 4-7: campos vacíos/reservados en la versión TXT
 * col 8: Fecha de Constitución (DD/MM/YYYY)
 * col 9: Estado del Contribuyente (ACTIVO, SUSPENDIDO, …)
 * col 10: Régimen de Pago (NORMAL, …)
 */
export const DGII_DEFAULT_COLUMN_MAPPING: Record<string, number> = {
  rnc: 0,
  legalName: 1,
  tradeName: 2,
  economicActivity: 3,
  registrationDate: 8,
  taxpayerStatus: 9,
  paymentRegime: 10,
};

const KNOWN_HEADER_VALUES = ['RNC', 'NOMBRE', 'NOMBRE_COMERCIAL', 'ESTADO', 'ACTIVIDAD'];

function isHeaderLine(parts: string[]): boolean {
  const first = parts[0]?.trim().toUpperCase();
  return first === 'RNC' || KNOWN_HEADER_VALUES.includes(first);
}

function detectColumnMapping(headerLine: string, delimiter: string): Record<string, number> | null {
  const parts = headerLine.split(delimiter).map((p) => p.trim().toUpperCase());
  if (!isHeaderLine(parts)) return null;

  const mapping: Record<string, number> = { ...DGII_DEFAULT_COLUMN_MAPPING };

  for (let i = 0; i < parts.length; i++) {
    const col = parts[i];
    if (col === 'RNC') mapping.rnc = i;
    else if (col === 'NOMBRE' || col === 'NOMBRE_RAZON_SOCIAL') mapping.legalName = i;
    else if (col === 'NOMBRE_COMERCIAL') mapping.tradeName = i;
    else if (col === 'CATEGORIA') mapping.category = i;
    else if (col === 'REGIMEN_PAGO' || col === 'REGIMEN') mapping.paymentRegime = i;
    else if (col === 'ESTADO') mapping.taxpayerStatus = i;
    else if (col === 'ACTIVIDAD_ECONOMICA' || col === 'ACTIVIDAD') mapping.economicActivity = i;
    else if (col === 'FECHA_CONSTITUCION' || col === 'FECHA') mapping.registrationDate = i;
    else if (col === 'ADMINISTRACION_LOCAL' || col === 'ADMINISTRACION') mapping.localAdministration = i;
  }

  return mapping;
}

function getCol(parts: string[], idx: number | undefined): string | undefined {
  if (idx === undefined || idx >= parts.length) return undefined;
  const val = parts[idx]?.trim();
  return val || undefined;
}

export type ParseDgiiLinesInput = {
  lines: string[];
  delimiter?: string;
  columnMapping?: Record<string, number>;
  maxRecords?: number;
};

export type ParseDgiiLinesOutput = {
  records: DgiiParsedRecord[];
  normalizedCompanies: DgiiNormalizedCompany[];
  stats: DgiiParserStats;
  detectedColumnMapping: Record<string, number>;
  headerSkipped: boolean;
  mappingSource: 'detected_from_header' | 'positional_default';
};

export function parseDgiiLines(input: ParseDgiiLinesInput): ParseDgiiLinesOutput {
  const {
    lines,
    delimiter = DGII_DEFAULT_DELIMITER,
    maxRecords = 1000,
  } = input;

  let columnMapping = input.columnMapping ?? { ...DGII_DEFAULT_COLUMN_MAPPING };
  let headerSkipped = false;
  let mappingSource: 'detected_from_header' | 'positional_default' = 'positional_default';

  // Detectar header en primera línea
  if (lines.length > 0) {
    const detected = detectColumnMapping(lines[0], delimiter);
    if (detected) {
      columnMapping = detected;
      headerSkipped = true;
      mappingSource = 'detected_from_header';
    }
  }

  const startIndex = headerSkipped ? 1 : 0;
  const records: DgiiParsedRecord[] = [];
  const normalizedCompanies: DgiiNormalizedCompany[] = [];
  const statusDistribution: Record<string, number> = {};

  let businessRnc9 = 0;
  let cedula11 = 0;
  let unknownType = 0;

  for (let i = startIndex; i < lines.length && records.length < maxRecords; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const parts = line.split(delimiter);
    const rawRnc = getCol(parts, columnMapping.rnc) ?? '';
    const normalized = normalizeDominicanRnc(rawRnc);

    let rncType: DgiiParsedRecord['rncType'] = 'unknown';
    let isInScope = false;

    if (normalized?.length === 9) {
      rncType = 'business_rnc';
      isInScope = true;
      businessRnc9++;
    } else if (normalized?.length === 11) {
      rncType = 'cedula_persona';
      isInScope = false;
      cedula11++;
    } else {
      unknownType++;
    }

    const rawStatus = getCol(parts, columnMapping.taxpayerStatus) ?? '';
    const statusKey = rawStatus.trim().toUpperCase() || 'DESCONOCIDO';
    statusDistribution[statusKey] = (statusDistribution[statusKey] ?? 0) + 1;

    const record: DgiiParsedRecord = {
      rnc: normalized ?? rawRnc,
      legalName: getCol(parts, columnMapping.legalName) ?? '',
      tradeName: getCol(parts, columnMapping.tradeName),
      category: getCol(parts, columnMapping.category),
      paymentRegime: getCol(parts, columnMapping.paymentRegime),
      taxpayerStatus: rawStatus,
      economicActivity: getCol(parts, columnMapping.economicActivity), // texto libre, sin inventar CIIU
      registrationDate: getCol(parts, columnMapping.registrationDate),
      localAdministration: getCol(parts, columnMapping.localAdministration),
      rncType,
      isInScope,
    };

    records.push(record);

    if (isInScope && normalized) {
      const normalizedStatus = normalizeDgiiStatus(rawStatus);
      normalizedCompanies.push({
        rnc: normalized,
        legalName: record.legalName,
        tradeName: record.tradeName,
        taxpayerStatus: normalizedStatus,
        isActive: isActiveDgiiTaxpayer(rawStatus),
        economicActivity: record.economicActivity,
        registrationDate: record.registrationDate,
        localAdministration: record.localAdministration,
        rawStatus,
      });
    }
  }

  const stats: DgiiParserStats = {
    totalLines: records.length,
    businessRnc9,
    cedula11,
    unknown: unknownType,
    headerSkipped,
    statusDistribution,
  };

  return {
    records,
    normalizedCompanies,
    stats,
    detectedColumnMapping: columnMapping,
    headerSkipped,
    mappingSource,
  };
}
