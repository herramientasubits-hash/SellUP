/**
 * SUNAT Peru Bulk — Sample Parse Dry-Run
 *
 * Conecta extractSunatBulkSample + parseSunatBulkLines + SUNAT_PADRON_REDUCIDO_REAL_CONFIG
 * para validar con muestra real controlada si el parser funciona con líneas reales,
 * cuántas empresas B2B RUC 20 aparecen, cuántas RUC 10 se saltan,
 * y si la muestra inicial es suficiente.
 *
 * NO genera candidatos.
 * NO activa Perú.
 * NO descarga ZIP completo.
 * NO guarda archivos en disco.
 * NO escribe Supabase.
 */

import { extractSunatBulkSample } from './sunat-sample-extractor';
import { parseSunatBulkLines } from './sunat-bulk-parser';
import { SUNAT_PADRON_REDUCIDO_REAL_CONFIG } from './sunat-bulk-parser-config';
import { SUNAT_BULK_SOURCE_KEY } from './types';
import type {
  SunatBulkSampleParseDryRunInput,
  SunatBulkSampleParseDryRunOutput,
  SunatBulkSampleExtractionOutput,
  SunatBulkParseOutput,
  SunatBulkB2bSampleStatus,
  SunatBulkDryRunRecommendation,
  SunatBulkSampleParseDryRunSampleCompany,
} from './types';

const DEFAULT_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const ABSOLUTE_MAX_COMPRESSED_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_DECOMPRESSED_BYTES = 512 * 1024;
const ABSOLUTE_MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_LINES = 200;
const ABSOLUTE_MAX_LINES = 500;

function clampInput(input?: SunatBulkSampleParseDryRunInput): {
  maxCompressedBytesToRead: number;
  maxDecompressedBytesToRead: number;
  maxLinesToReturn: number;
  includeNaturalPersons: boolean;
} {
  return {
    maxCompressedBytesToRead: Math.min(
      input?.maxCompressedBytesToRead ?? DEFAULT_MAX_COMPRESSED_BYTES,
      ABSOLUTE_MAX_COMPRESSED_BYTES,
    ),
    maxDecompressedBytesToRead: Math.min(
      input?.maxDecompressedBytesToRead ?? DEFAULT_MAX_DECOMPRESSED_BYTES,
      ABSOLUTE_MAX_DECOMPRESSED_BYTES,
    ),
    maxLinesToReturn: Math.min(
      input?.maxLinesToReturn ?? DEFAULT_MAX_LINES,
      ABSOLUTE_MAX_LINES,
    ),
    includeNaturalPersons: input?.includeNaturalPersons ?? false,
  };
}

function buildFromExtraction(
  extraction: SunatBulkSampleExtractionOutput,
  parsing: SunatBulkParseOutput | null,
  b2bSampleStatus: SunatBulkB2bSampleStatus,
  recommendation: SunatBulkDryRunRecommendation,
  reason: string,
): SunatBulkSampleParseDryRunOutput {
  const sampleCompanies: SunatBulkSampleParseDryRunSampleCompany[] =
    parsing
      ? parsing.companies.map(c => ({
          taxIdentifier: c.taxIdentifier,
          legalName: c.legalName,
          taxpayerStatus: c.taxpayerStatus,
          domicileCondition: c.domicileCondition,
          ubigeo: c.ubigeo,
          isActiveTaxpayer: c.isActiveTaxpayer,
          isLikelyCompany: c.isLikelyCompany,
        }))
      : [];

  const warnings: string[] = [];
  for (const w of extraction.warnings) {
    warnings.push(`[extraction] ${w.code}: ${w.message}`);
  }
  if (parsing) {
    for (const w of parsing.warnings) {
      warnings.push(`[parsing] ${w.code}: ${w.message} (line ${w.lineNumber})`);
    }
  }

  const errors: string[] = [...extraction.errors];
  if (parsing && parsing.errors.length > 0) {
    errors.push(...parsing.errors);
  }

  const status =
    b2bSampleStatus === 'blocked'
      ? ('blocked' as const)
      : b2bSampleStatus === 'error'
        ? ('error' as const)
        : sampleCompanies.length > 0 && sampleCompanies.some(c => c.isLikelyCompany === true)
          ? ('parsed' as const)
          : ('sampled_no_companies' as const);

  return {
    sourceKey: SUNAT_BULK_SOURCE_KEY,
    mode: 'sample_parse_dry_run',
    status,
    extraction: {
      status: extraction.status,
      fileName: extraction.entry.fileName || undefined,
      compressedBytesRead: extraction.stats.compressedBytesRead,
      decompressedBytesRead: extraction.stats.decompressedBytesRead,
      linesDetected: extraction.stats.linesDetected,
      linesReturned: extraction.stats.linesReturned,
      inferredDelimiter: extraction.sample.inferredDelimiter,
      inferredColumnCount: extraction.sample.inferredColumnCount,
      streamCancelled: extraction.stats.truncated,
      fullDownloadPrevented: extraction.guard.fullDownloadAllowed === false,
    },
    parsing: {
      inputLines: parsing?.stats.inputLines ?? 0,
      headerRowsSkipped: parsing?.stats.headerRowsSkipped ?? 0,
      validCompanies: parsing?.stats.validCompanies ?? 0,
      skippedNaturalPersons: parsing?.stats.skippedNaturalPersons ?? 0,
      skippedNonCompanyRuc: parsing?.stats.skippedNonCompanyRuc ?? 0,
      invalidLines: parsing?.stats.invalidLines ?? 0,
      activeCompanies: parsing?.stats.activeCompanies ?? 0,
      inactiveCompanies: parsing?.stats.inactiveCompanies ?? 0,
    },
    sampleCompanies,
    sampleObservation: { b2bSampleStatus, recommendation, reason },
    warnings,
    errors,
  };
}

function buildBlockedOutput(
  extraction: SunatBulkSampleExtractionOutput,
): SunatBulkSampleParseDryRunOutput {
  return buildFromExtraction(
    extraction,
    null,
    'blocked',
    'blocked',
    extraerFirstWarningMessage(extraction.warnings) || extraction.errors[0] || 'Extracción bloqueada',
  );
}

function buildErrorOutput(
  extraction: SunatBulkSampleExtractionOutput,
): SunatBulkSampleParseDryRunOutput {
  return buildFromExtraction(
    extraction,
    null,
    'error',
    'blocked',
    extraction.errors[0] || 'Error desconocido en extracción',
  );
}

function extraerFirstWarningMessage(warnings: { code: string; message: string }[]): string | undefined {
  if (warnings.length === 0) return undefined;
  return `${warnings[0].code}: ${warnings[0].message}`;
}

/**
 * Ejecuta un dry-run controlado que conecta el sample extractor SUNAT
 * con el parser de líneas usando la configuración real del Padrón Reducido RUC.
 *
 * @param input - Opciones del dry-run (todas opcionales con defaults seguros)
 * @returns SunatBulkSampleParseDryRunOutput con análisis completo
 */
export async function runSunatBulkSampleParseDryRun(
  input?: SunatBulkSampleParseDryRunInput,
): Promise<SunatBulkSampleParseDryRunOutput> {
  const {
    maxCompressedBytesToRead,
    maxDecompressedBytesToRead,
    maxLinesToReturn,
    includeNaturalPersons,
  } = clampInput(input);

  const extractionOutput = await extractSunatBulkSample({
    maxCompressedBytes: maxCompressedBytesToRead,
    maxDecompressedBytes: maxDecompressedBytesToRead,
    maxLines: maxLinesToReturn,
  });

  if (extractionOutput.status === 'blocked') {
    return buildBlockedOutput(extractionOutput);
  }

  if (extractionOutput.status === 'error') {
    return buildErrorOutput(extractionOutput);
  }

  const fullLines = extractionOutput.sample.fullSampleLines;
  if (!fullLines || fullLines.length === 0) {
    return buildFromExtraction(
      extractionOutput,
      null,
      'no_parseable_lines',
      'blocked',
      'La extracción no devolvió líneas para parsear',
    );
  }

  const config = { ...SUNAT_PADRON_REDUCIDO_REAL_CONFIG, includeNaturalPersons };
  const parseOutput = parseSunatBulkLines({ lines: fullLines, config });

  const hasCompanyRuc20 = parseOutput.companies.some(c => c.isLikelyCompany === true);
  const hasAnyCompanies = parseOutput.stats.validCompanies > 0;
  const hasNaturalInCompanies =
    hasAnyCompanies && parseOutput.companies.every(c => c.isLikelyCompany === false);
  const hasOnlySkippedNatural =
    !hasAnyCompanies && parseOutput.stats.skippedNaturalPersons > 0;
  const hasOnlyNaturalInCompanies = hasNaturalInCompanies || hasOnlySkippedNatural;
  const hasParseableLines =
    parseOutput.stats.validCompanies > 0 ||
    parseOutput.stats.skippedNaturalPersons > 0 ||
    parseOutput.stats.skippedNonCompanyRuc > 0 ||
    parseOutput.stats.invalidLines < parseOutput.stats.inputLines;

  let b2bSampleStatus: SunatBulkB2bSampleStatus;
  let recommendation: SunatBulkDryRunRecommendation;
  let reason: string;

  if (hasCompanyRuc20) {
    b2bSampleStatus = 'companies_found';
    recommendation = 'ready_for_candidate_preview';
    reason =
      `Encontradas ${parseOutput.stats.validCompanies} empresas B2B (RUC 20) ` +
      `en muestra de ${fullLines.length} líneas (${parseOutput.stats.activeCompanies} activas).`;
  } else if (hasOnlyNaturalInCompanies) {
    b2bSampleStatus = 'only_natural_persons_in_head_sample';
    recommendation = 'needs_deeper_local_scan';
    reason =
      `Solo RUC 10 (personas naturales) en las primeras ${fullLines.length} líneas ` +
      `(${parseOutput.stats.skippedNaturalPersons} saltadas). ` +
      `No se encontraron RUC 20 en este segmento inicial. ` +
      `Posiblemente el archivo está ordenado por tipo de RUC.`;
  } else if (!hasParseableLines) {
    b2bSampleStatus = 'no_parseable_lines';
    recommendation = 'blocked';
    reason =
      `No se pudieron parsear líneas de la muestra de ${fullLines.length} líneas. ` +
      `El formato puede diferir del esperado.`;
  } else {
    b2bSampleStatus = 'no_parseable_lines';
    recommendation = 'needs_full_local_snapshot_strategy';
    reason =
      `La muestra inicial no contiene empresas RUC 20. ` +
      `Revisar si el archivo está ordenado por RUC (RUC 10 primero).`;
  }

  return buildFromExtraction(
    extractionOutput,
    parseOutput,
    b2bSampleStatus,
    recommendation,
    reason,
  );
}
