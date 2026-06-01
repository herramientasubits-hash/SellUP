/**
 * ChileCompra — Dry Run
 *
 * Ejecuta el flujo completo: cliente → normalizar → filtrar → mapear en memoria.
 * NO escribe en Supabase. NO crea prospect_batches. NO crea prospect_candidates.
 * NO toca HubSpot. NO toca Tavily. NO activa Agent 1.
 * Solo lectura. Solo reporte.
 */

import {
  fetchChileCompraProviders,
  buildTicketInstructions,
  CHILECOMPRA_OCDS_ENDPOINT,
} from './chilecompra-client';
import { normalizeChileCompraRecord, ICP_KEYWORDS } from './normalizers';
import { mapChileCompraSampleToStructuredCandidate } from './candidate-mapper';
import type {
  RunChileCompraDryRunInput,
  RunChileCompraDryRunReport,
  NormalizedChileCompraSupplier,
} from './types';

const DEFAULT_LIMIT = 50;
const MAX_SAMPLES = 5;

/**
 * Dry-run seguro del conector ChileCompra.
 *
 * Flujo:
 *   1. Fetch ChileCompra (OCDS sin ticket, o API con ticket si se provee)
 *   2. Normalizar cada registro
 *   3. Clasificar: accepted / low_priority / filtered
 *   4. Mapear aceptados a StructuredSourceCandidateDraft (sin persistir)
 *   5. Devolver reporte — sin persistir nada
 */
export async function runChileCompraDryRun(
  input?: RunChileCompraDryRunInput,
): Promise<RunChileCompraDryRunReport> {
  const executedAt = new Date().toISOString();
  const limit = input?.limit ?? DEFAULT_LIMIT;
  const ticket = input?.ticket;

  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Fetch
  const fetchResult = await fetchChileCompraProviders({ limit, ticket });

  const endpointUsed = fetchResult.endpointUsed ?? CHILECOMPRA_OCDS_ENDPOINT;
  const ticketRequired = fetchResult.ticketRequired ?? false;

  const credentialInstructions = ticketRequired ? buildTicketInstructions() : null;

  if (!fetchResult.ok) {
    const endpointStatus = ticketRequired ? 'requires_ticket' as const : 'error' as const;

    if (ticketRequired) {
      warnings.push(
        'ChileCompra requiere ticket de API. ' +
        'El dry-run se ejecutó sin ticket (Opción A — OCDS). ' +
        buildTicketInstructions(),
      );
    }

    return {
      sourceKey: 'cl_chilecompra',
      sourceProvider: 'chilecompra_chile',
      countryCode: 'CL',
      queryParams: {
        limit,
        endpointUsed,
        ticketRequired,
      },
      executedAt,
      endpointStatus,
      summary: {
        recordsRead: 0,
        normalizedCount: 0,
        acceptedDraftsCount: 0,
        lowPriorityCount: 0,
        filteredOutCount: 0,
        missingRutCount: 0,
        missingCategoryCount: 0,
        icpMatchCount: 0,
        errorsCount: 1,
      },
      qualitySummary: {
        filterStrategy: 'ICP UBITS por categoría UNSPSC / nombre de rubro',
        includedKeywords: ICP_KEYWORDS.slice(0, 15),
        procurementSignal: true,
        credentialRequired: ticketRequired,
        credentialInstructions,
      },
      acceptedSamples: [],
      lowPrioritySamples: [],
      filteredSamples: [],
      warnings,
      errors: [fetchResult.error],
    };
  }

  const rawRecords = fetchResult.records;
  const recordsRead = rawRecords.length;

  if (recordsRead === 0) {
    warnings.push(
      'ChileCompra devolvió 0 registros. ' +
      'El endpoint OCDS puede estar paginando o vacío. ' +
      'Considerar activar ticket de API para mayor cobertura.',
    );
  }

  // 2. Normalizar y clasificar
  const accepted: NormalizedChileCompraSupplier[] = [];
  const lowPriority: NormalizedChileCompraSupplier[] = [];
  const filtered: Array<{ rawRecordId: string | null; legalName: string | null; filterReason: string }> = [];

  let normalizedCount = 0;
  let missingRutCount = 0;
  let missingCategoryCount = 0;
  let icpMatchCount = 0;

  for (let i = 0; i < rawRecords.length; i++) {
    const raw = rawRecords[i];
    try {
      const normalized = normalizeChileCompraRecord(raw, i);
      normalizedCount++;

      if (!normalized.taxId) missingRutCount++;
      if (!normalized.procurementCategoryCode && !normalized.procurementCategoryName) {
        missingCategoryCount++;
      }
      if (normalized.icpMatch) icpMatchCount++;

      if (normalized.qualityDecision === 'accepted') {
        accepted.push(normalized);
      } else if (normalized.qualityDecision === 'low_priority') {
        lowPriority.push(normalized);
      } else {
        filtered.push({
          rawRecordId: normalized.rawRecordId,
          legalName: normalized.legalName,
          filterReason: normalized.qualityReason,
        });
      }
    } catch (itemErr: unknown) {
      const msg = itemErr instanceof Error
        ? itemErr.message
        : 'Error normalizando registro ChileCompra';
      errors.push(msg);
    }
  }

  // 3. Mapear a StructuredSourceCandidateDraft (sin persistir)
  for (const supplier of accepted.slice(0, MAX_SAMPLES)) {
    try {
      mapChileCompraSampleToStructuredCandidate(supplier);
    } catch (mapErr: unknown) {
      const msg = mapErr instanceof Error
        ? mapErr.message
        : 'Error mapeando candidato ChileCompra';
      errors.push(msg);
    }
  }

  // Advertencias de calidad
  if (missingCategoryCount > 0) {
    warnings.push(
      `${missingCategoryCount}/${normalizedCount} registros sin categoría UNSPSC — ` +
      'la señal de sector depende de que ChileCompra incluya el rubro en el contrato.',
    );
  }
  if (missingRutCount > 0) {
    warnings.push(
      `${missingRutCount} registros sin RUT — serán filtrados automáticamente.`,
    );
  }
  if (icpMatchCount === 0 && normalizedCount > 0) {
    warnings.push(
      'Ningún registro coincidió con las keywords ICP UBITS. ' +
      'Esto puede indicar que la muestra del endpoint no cubre proveedores de capacitación/tecnología. ' +
      'Se recomienda configurar el ticket de API para búsqueda segmentada.',
    );
  }

  const endpointStatus = 'ok' as const;

  return {
    sourceKey: 'cl_chilecompra',
    sourceProvider: 'chilecompra_chile',
    countryCode: 'CL',
    queryParams: {
      limit,
      endpointUsed,
      ticketRequired: false,
    },
    executedAt,
    endpointStatus,
    summary: {
      recordsRead,
      normalizedCount,
      acceptedDraftsCount: accepted.length,
      lowPriorityCount: lowPriority.length,
      filteredOutCount: filtered.length,
      missingRutCount,
      missingCategoryCount,
      icpMatchCount,
      errorsCount: errors.length,
    },
    qualitySummary: {
      filterStrategy: 'ICP UBITS por categoría UNSPSC / nombre de rubro',
      includedKeywords: ICP_KEYWORDS.slice(0, 15),
      procurementSignal: true,
      credentialRequired: false,
      credentialInstructions: null,
    },
    acceptedSamples: accepted.slice(0, MAX_SAMPLES),
    lowPrioritySamples: lowPriority.slice(0, MAX_SAMPLES),
    filteredSamples: filtered.slice(0, MAX_SAMPLES),
    warnings,
    errors,
  };
}
