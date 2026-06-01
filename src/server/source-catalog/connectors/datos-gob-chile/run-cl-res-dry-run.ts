/**
 * Chile RES — Dry Run
 *
 * Ejecuta el flujo completo CKAN → normalizar → mapear en memoria.
 * NO escribe en Supabase. NO crea prospect_batches. NO crea prospect_candidates.
 * NO toca HubSpot. NO toca Tavily. NO activa Agent 1.
 * Solo lectura. Solo reporte.
 */

import {
  fetchClResRecords,
  RES_RESOURCE_ID_2025,
  RES_DATASET_ID,
} from './cl-res-client';
import { normalizeResChileRecord } from './normalizers';
import { mapResChileSampleToStructuredCandidate } from './candidate-mapper';
import type { RunClResDryRunInput, RunClResDryRunReport } from './types';

const DEFAULT_LIMIT = 20;
const DEFAULT_FILTERS = { 'Tipo de actuacion': 'CONSTITUCIÓN' };
const MAX_ACCEPTED_SAMPLES = 5;
const MAX_FILTERED_SAMPLES = 5;

/**
 * Dry-run seguro del conector RES Chile.
 *
 * Flujo:
 *   1. Fetch CKAN datos.gob.cl (sin credencial)
 *   2. Normalizar cada registro
 *   3. Mapear a StructuredSourceCandidateDraft
 *   4. Clasificar aceptados vs filtrados
 *   5. Devolver reporte — sin persistir nada
 */
export async function runClResDryRun(
  input?: RunClResDryRunInput,
): Promise<RunClResDryRunReport> {
  const executedAt = new Date().toISOString();
  const resourceId = input?.resourceId ?? RES_RESOURCE_ID_2025;
  const limit = input?.limit ?? DEFAULT_LIMIT;
  const offset = input?.offset ?? 0;
  const filters = input?.filters ?? DEFAULT_FILTERS;

  const queryParams = { resource_id: resourceId, limit, offset, filters };
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Fetch CKAN
  const fetchResult = await fetchClResRecords({ resourceId, limit, offset, filters });

  if (!fetchResult.ok) {
    return {
      sourceKey: 'cl_res',
      sourceProvider: 'datos_gob_cl',
      countryCode: 'CL',
      datasetId: RES_DATASET_ID,
      resourceId,
      queryParams,
      executedAt,
      summary: {
        recordsRead: 0,
        normalizedCount: 0,
        acceptedDraftsCount: 0,
        filteredOutCount: 0,
        errorsCount: 1,
        missingRutCount: 0,
        missingLegalNameCount: 0,
        noSectorDataCount: 0,
        capitalAvailableCount: 0,
      },
      acceptedSamples: [],
      filteredSamples: [],
      warnings,
      errors: [fetchResult.error],
    };
  }

  const rawRecords = fetchResult.records;
  const recordsRead = rawRecords.length;

  if (recordsRead === 0) {
    warnings.push(`CKAN devolvió 0 registros con filtros: ${JSON.stringify(filters)}`);
  }

  // 2. Normalizar y clasificar
  const accepted = [];
  const filtered = [];
  let normalizedCount = 0;
  let missingRutCount = 0;
  let missingLegalNameCount = 0;
  let capitalAvailableCount = 0;

  for (const raw of rawRecords) {
    try {
      const normalized = normalizeResChileRecord(raw, resourceId);
      normalizedCount++;

      if (!normalized.taxId) missingRutCount++;
      if (!normalized.legalName) missingLegalNameCount++;
      if (normalized.capitalAmount !== null) capitalAvailableCount++;

      if (normalized.qualityDecision === 'accepted') {
        accepted.push(normalized);
      } else {
        filtered.push({
          rawRecordId: normalized.rawRecordId,
          legalName: normalized.legalName,
          tipoActuacion: raw['Tipo de actuacion'] !== undefined
            ? String(raw['Tipo de actuacion'])
            : null,
          filterReason: normalized.qualityReason,
        });
      }
    } catch (itemErr: unknown) {
      const msg = itemErr instanceof Error ? itemErr.message : 'Error normalizando registro RES Chile';
      errors.push(msg);
    }
  }

  // 3. Mapear aceptados a StructuredSourceCandidateDraft (sin persistir)
  for (const sample of accepted.slice(0, MAX_ACCEPTED_SAMPLES)) {
    try {
      mapResChileSampleToStructuredCandidate(sample);
    } catch (mapErr: unknown) {
      const msg = mapErr instanceof Error ? mapErr.message : 'Error mapeando candidato RES Chile';
      errors.push(msg);
    }
  }

  // Advertencias de calidad
  const noSectorDataCount = normalizedCount;
  if (noSectorDataCount > 0) {
    warnings.push(
      `${noSectorDataCount}/${normalizedCount} registros sin sector/giro — RES Chile no incluye CIIU ni actividad económica`,
    );
  }
  if (missingRutCount > 0) {
    warnings.push(`${missingRutCount} registros sin RUT — serán filtrados automáticamente`);
  }

  return {
    sourceKey: 'cl_res',
    sourceProvider: 'datos_gob_cl',
    countryCode: 'CL',
    datasetId: RES_DATASET_ID,
    resourceId,
    queryParams,
    executedAt,
    summary: {
      recordsRead,
      normalizedCount,
      acceptedDraftsCount: accepted.length,
      filteredOutCount: filtered.length,
      errorsCount: errors.length,
      missingRutCount,
      missingLegalNameCount,
      noSectorDataCount,
      capitalAvailableCount,
    },
    acceptedSamples: accepted.slice(0, MAX_ACCEPTED_SAMPLES),
    filteredSamples: filtered.slice(0, MAX_FILTERED_SAMPLES),
    warnings,
    errors,
  };
}
