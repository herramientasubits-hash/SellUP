/**
 * SUNAT Peru Bulk — Dry Run
 *
 * Ejecuta el flujo seguro de verificación de disponibilidad del
 * Padrón Reducido RUC de SUNAT.
 *
 * Por defecto: availability_check (HEAD request).
 * Opcional: sample_probe (rango parcial, máximo 512 KB).
 *
 * NO descarga ZIP completo. NO guarda archivos. NO escribe en DB.
 * NO toca Supabase. NO crea candidatos. NO registra en SOURCE_DISCOVERY_REGISTRY.
 */

import type {
  SunatBulkDryRunInput,
  SunatBulkDryRunOutput,
  SunatBulkDownloadGuard,
  SunatBulkAvailabilityStatus,
  SunatBulkValidationWarning,
} from './types';
import { checkSunatBulkAvailability, probeSunatBulkRange } from './sunat-bulk-client';
import {
  SUNAT_BULK_SOURCE_KEY,
  SUNAT_BULK_MAX_SAMPLE_BYTES,
} from './types';

const LARGE_FILE_WARNING_THRESHOLD = 100 * 1024 * 1024;

function buildDownloadGuard(
  observedContentLengthBytes?: number,
): SunatBulkDownloadGuard {
  return {
    fullDownloadAllowed: false,
    reason:
      'Hito Perú.2 — conector seguro inicial. ' +
      'Descarga completa deshabilitada hasta hito Perú.3.',
    maxAllowedBytesForDryRun: SUNAT_BULK_MAX_SAMPLE_BYTES,
    observedContentLengthBytes,
  };
}

function deriveStatus(
  httpStatus: number | null,
  ok: boolean,
  errors: string[],
): SunatBulkAvailabilityStatus {
  if (errors.length > 0) return 'error';
  if (httpStatus === null) return 'error';
  if (httpStatus === 200 || httpStatus === 206) return 'available';
  if (httpStatus === 403 || httpStatus === 404) return 'blocked';
  if (httpStatus >= 500) return 'unavailable';
  if (ok) return 'available';
  return 'unavailable';
}

/**
 * Dry-run seguro del conector SUNAT Perú Bulk.
 *
 * Por defecto ejecuta availability_check (HEAD request).
 * No descarga ZIP completo. No guarda archivos. No escribe en DB.
 */
export async function runSunatBulkDryRun(
  input?: SunatBulkDryRunInput,
): Promise<SunatBulkDryRunOutput> {
  const mode = input?.mode ?? 'availability_check';
  const warnings: string[] = [];
  const errors: string[] = [];

  if (mode === 'availability_check') {
    const { metadata } = await checkSunatBulkAvailability();
    if (metadata.httpStatus === null) {
      errors.push('No se pudo conectar con SUNAT — error de red o timeout');
    }
    const guard = buildDownloadGuard(metadata.contentLengthBytes);

    if (
      metadata.contentLengthBytes &&
      metadata.contentLengthBytes > LARGE_FILE_WARNING_THRESHOLD
    ) {
      warnings.push(
        `Archivo grande detectado: ${(metadata.contentLengthBytes / (1024 * 1024)).toFixed(1)} MB. ` +
          `Descarga completa no permitida en este hito.`,
      );
    }

    if (metadata.supportsRangeRequests) {
      warnings.push(
        'Servidor soporta Range requests. Se podrá usar descarga parcial en hito futuro.',
      );
    }

    return {
      sourceKey: SUNAT_BULK_SOURCE_KEY,
      mode,
      status: deriveStatus(metadata.httpStatus, metadata.ok, errors),
      metadata,
      guard,
      warnings,
      errors,
    };
  }

  const maxBytes = Math.min(
    input?.maxSampleBytes ?? SUNAT_BULK_MAX_SAMPLE_BYTES,
    SUNAT_BULK_MAX_SAMPLE_BYTES,
  );
  const { metadata, rawBytes, isZipFile, error } = await probeSunatBulkRange(maxBytes);
  const guard = buildDownloadGuard(metadata.contentLengthBytes);

  if (error) {
    errors.push(error);
  }
  if (metadata.httpStatus === null && errors.length === 0) {
    errors.push('No se pudo conectar con SUNAT — error de red o timeout');
  }

  if (
    metadata.contentLengthBytes &&
    metadata.contentLengthBytes > LARGE_FILE_WARNING_THRESHOLD
  ) {
    warnings.push(
      `Archivo grande detectado: ${(metadata.contentLengthBytes / (1024 * 1024)).toFixed(1)} MB. ` +
        `Descarga completa no permitida en este hito.`,
    );
  }

  const sampleWarnings: SunatBulkValidationWarning[] = [];

  if (rawBytes && rawBytes.length > 0) {
    if (isZipFile) {
      warnings.push(
        `Formato ZIP confirmado (${(rawBytes.length / 1024).toFixed(1)} KB descargados). ` +
          `No se pueden extraer registros de un rango parcial.`,
      );
      sampleWarnings.push('partial_zip_no_records');
    } else if (rawBytes.length >= 4) {
      warnings.push(
        `El archivo descargado no parece un ZIP estándar ` +
          `(magic bytes: ${Array.from(rawBytes.slice(0, 4))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ')}). ` +
          `Puede que el rango parcial no sea suficiente.`,
      );
      sampleWarnings.push('unexpected_file_format');
    } else {
      warnings.push(
        `Respuesta demasiado pequeña (${rawBytes.length} bytes). ` +
          `No se pudo verificar el formato del archivo.`,
      );
      sampleWarnings.push('empty_sample_response');
    }
  }

  return {
    sourceKey: SUNAT_BULK_SOURCE_KEY,
    mode,
    status: deriveStatus(metadata.httpStatus, metadata.ok, errors),
    metadata,
    guard,
    sample: {
      attempted: true,
      method: 'range_request',
      recordsParsed: 0,
      normalizedCompanies: [],
      warnings: sampleWarnings,
    },
    warnings,
    errors,
  };
}
