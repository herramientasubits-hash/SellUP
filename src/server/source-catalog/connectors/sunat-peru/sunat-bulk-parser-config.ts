/**
 * SUNAT Peru Bulk — Parser Config
 *
 * Configuraciones predefinidas para el parser de líneas del Padrón Reducido RUC.
 * El formato SUNAT usa pipe como separador con columnado fijo.
 */

import type {
  SunatBulkColumnMapping,
  SunatBulkParserConfig,
} from './types';

export const DEFAULT_SUNAT_BULK_MAX_LINE_LENGTH = 10_000;

export const PIPE_DELIMITER = '|' as const;
export const TAB_DELIMITER = '\t' as const;
export const COMMA_DELIMITER = ',' as const;

export const PIPE_COLUMN_MAPPING: SunatBulkColumnMapping = {
  ruc: 0,
  legalName: 1,
  taxpayerStatus: 2,
  domicileCondition: 3,
  ubigeo: 4,
  department: 5,
  province: 6,
  district: 7,
};

export function createDefaultPipeConfig(): SunatBulkParserConfig {
  return {
    delimiter: PIPE_DELIMITER,
    columnMapping: { ...PIPE_COLUMN_MAPPING },
    skipEmptyLines: true,
    maxLineLength: DEFAULT_SUNAT_BULK_MAX_LINE_LENGTH,
    strictMode: false,
  };
}

export function createTabConfig(columnMapping: SunatBulkColumnMapping): SunatBulkParserConfig {
  return {
    delimiter: TAB_DELIMITER,
    columnMapping,
    skipEmptyLines: true,
    maxLineLength: DEFAULT_SUNAT_BULK_MAX_LINE_LENGTH,
    strictMode: false,
  };
}
