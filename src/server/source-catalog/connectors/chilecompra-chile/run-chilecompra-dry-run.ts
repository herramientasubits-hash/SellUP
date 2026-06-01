/**
 * ChileCompra — Dry Run
 *
 * Soporta dos modos:
 *   - health_check (default): lista compradores del Estado para confirmar que la API vive.
 *   - supplier_signal: busca RUTs concretos y consulta órdenes de compra por CódigoProveedor.
 *
 * NO escribe en Supabase. NO crea prospect_batches. NO crea prospect_candidates.
 * NO toca HubSpot. NO loguea el ticket. Solo lectura. Solo reporte.
 */

import {
  listChileCompraBuyers,
  searchChileCompraSupplierByRut,
  fetchChileCompraPurchaseOrdersBySupplier,
  buildTicketInstructions,
  CHILECOMPRA_BUSCAR_COMPRADOR,
  CHILECOMPRA_BUSCAR_PROVEEDOR,
} from './chilecompra-client';
import { ICP_KEYWORDS } from './normalizers';
import type {
  RunChileCompraDryRunInput,
  RunChileCompraDryRunReport,
  SupplierLookupResult,
} from './types';

const MAX_SAMPLE_RUTS = 3;

// ── Modo 1: health_check ───────────────────────────────────────────────────────

async function runHealthCheck(
  ticket: string,
  executedAt: string,
): Promise<RunChileCompraDryRunReport> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const result = await listChileCompraBuyers({ ticket });

  if (!result.ok) {
    const isCredentialError =
      result.httpStatus === 401 ||
      result.httpStatus === 403 ||
      (result.error ?? '').toLowerCase().includes('ticket');

    return {
      sourceKey: 'cl_chilecompra',
      sourceProvider: 'chilecompra_chile',
      countryCode: 'CL',
      dryRunMode: 'health_check',
      queryParams: {
        limit: 0,
        endpointUsed: CHILECOMPRA_BUSCAR_COMPRADOR,
        ticketRequired: isCredentialError,
      },
      executedAt,
      endpointStatus: isCredentialError ? 'requires_ticket' : 'error',
      healthCheck: { buyersFound: 0, apiAlive: false },
      summary: emptyDryRunSummary(1),
      qualitySummary: {
        filterStrategy: 'Health check — BuscarComprador',
        includedKeywords: ICP_KEYWORDS.slice(0, 10),
        procurementSignal: true,
        credentialRequired: isCredentialError,
        credentialInstructions: isCredentialError ? buildTicketInstructions() : null,
      },
      acceptedSamples: [],
      lowPrioritySamples: [],
      filteredSamples: [],
      warnings,
      errors: [result.error ?? 'Error al consultar BuscarComprador'],
    };
  }

  const buyersFound = result.buyersCount ?? 0;

  if (buyersFound === 0) {
    warnings.push(
      'BuscarComprador retornó 0 organismos — verificar ticket o disponibilidad de la API.',
    );
  }

  return {
    sourceKey: 'cl_chilecompra',
    sourceProvider: 'chilecompra_chile',
    countryCode: 'CL',
    dryRunMode: 'health_check',
    queryParams: {
      limit: 0,
      endpointUsed: CHILECOMPRA_BUSCAR_COMPRADOR,
      ticketRequired: false,
    },
    executedAt,
    endpointStatus: 'connected',
    healthCheck: { buyersFound, apiAlive: true },
    summary: emptyDryRunSummary(0),
    qualitySummary: {
      filterStrategy: 'Health check — BuscarComprador',
      includedKeywords: ICP_KEYWORDS.slice(0, 10),
      procurementSignal: true,
      credentialRequired: false,
      credentialInstructions: null,
    },
    acceptedSamples: [],
    lowPrioritySamples: [],
    filteredSamples: [],
    warnings,
    errors,
  };
}

// ── Modo 2: supplier_signal ────────────────────────────────────────────────────

async function runSupplierSignal(
  ticket: string,
  sampleRuts: string[],
  executedAt: string,
): Promise<RunChileCompraDryRunReport> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const supplierLookups: SupplierLookupResult[] = [];

  const rutsToQuery = sampleRuts.slice(0, MAX_SAMPLE_RUTS);

  for (const rut of rutsToQuery) {
    const lookupResult = await searchChileCompraSupplierByRut({ rut, ticket });

    if (!lookupResult.ok) {
      supplierLookups.push({
        rut,
        rutFormatted: lookupResult.rutFormatted,
        found: false,
        error: lookupResult.error,
      });
      errors.push(`RUT ${lookupResult.rutFormatted}: ${lookupResult.error ?? 'Error al buscar proveedor'}`);
      continue;
    }

    if (!lookupResult.found || !lookupResult.supplierCode) {
      supplierLookups.push({
        rut,
        rutFormatted: lookupResult.rutFormatted,
        found: false,
      });
      continue;
    }

    // Proveedor encontrado — consultar órdenes de compra
    let ordersCount: number | undefined;
    const ordersResult = await fetchChileCompraPurchaseOrdersBySupplier({
      supplierCode: lookupResult.supplierCode,
      ticket,
    });

    if (ordersResult.ok) {
      ordersCount = ordersResult.ordersCount;
    } else {
      warnings.push(
        `Proveedor ${lookupResult.rutFormatted} encontrado (código: ${lookupResult.supplierCode}) ` +
        `pero error al consultar órdenes: ${ordersResult.error ?? 'error desconocido'}`,
      );
    }

    supplierLookups.push({
      rut,
      rutFormatted: lookupResult.rutFormatted,
      found: true,
      supplierCode: lookupResult.supplierCode,
      supplierName: lookupResult.supplierName,
      ordersCount,
    });
  }

  const foundCount = supplierLookups.filter((r) => r.found).length;

  if (foundCount === 0 && rutsToQuery.length > 0) {
    warnings.push(
      `Ninguno de los ${rutsToQuery.length} RUTs de muestra existe como proveedor en Mercado Público. ` +
      'Los RUTs de producción deben provenir de cl_res.',
    );
  }

  return {
    sourceKey: 'cl_chilecompra',
    sourceProvider: 'chilecompra_chile',
    countryCode: 'CL',
    dryRunMode: 'supplier_signal',
    queryParams: {
      limit: rutsToQuery.length,
      endpointUsed: CHILECOMPRA_BUSCAR_PROVEEDOR,
      ticketRequired: false,
    },
    executedAt,
    endpointStatus: errors.length === rutsToQuery.length && rutsToQuery.length > 0 ? 'error' : 'ok',
    supplierLookups,
    summary: emptyDryRunSummary(errors.length),
    qualitySummary: {
      filterStrategy: 'Lookup por RUT → CódigoProveedor → órdenes de compra',
      includedKeywords: ICP_KEYWORDS.slice(0, 10),
      procurementSignal: true,
      credentialRequired: false,
      credentialInstructions: null,
    },
    acceptedSamples: [],
    lowPrioritySamples: [],
    filteredSamples: [],
    warnings,
    errors,
  };
}

// ── Utilidades ──────────────────────────────────────────────────────────────────

function emptyDryRunSummary(errorsCount: number) {
  return {
    recordsRead: 0,
    normalizedCount: 0,
    acceptedDraftsCount: 0,
    lowPriorityCount: 0,
    filteredOutCount: 0,
    missingRutCount: 0,
    missingCategoryCount: 0,
    icpMatchCount: 0,
    errorsCount,
  };
}

// ── Punto de entrada público ────────────────────────────────────────────────────

/**
 * Dry-run seguro del conector ChileCompra.
 *
 * Modo health_check (default):
 *   - Llama BuscarComprador para confirmar que el ticket y la API funcionan.
 *   - Retorna buyersFound + apiAlive.
 *
 * Modo supplier_signal (requiere sampleRuts):
 *   - Para cada RUT, busca el proveedor y consulta sus órdenes de compra.
 *   - Retorna supplierLookups con found/supplierCode/ordersCount.
 *
 * Sin writes. Sin candidatos. Sin HubSpot.
 */
export async function runChileCompraDryRun(
  input?: RunChileCompraDryRunInput,
): Promise<RunChileCompraDryRunReport> {
  const executedAt = new Date().toISOString();
  const ticket = input?.ticket;
  const sampleRuts = input?.sampleRuts ?? [];
  const requestedMode = input?.mode;

  // Sin ticket no se puede ejecutar nada
  if (!ticket?.trim()) {
    return {
      sourceKey: 'cl_chilecompra',
      sourceProvider: 'chilecompra_chile',
      countryCode: 'CL',
      dryRunMode: 'health_check',
      queryParams: { limit: 0, endpointUsed: CHILECOMPRA_BUSCAR_COMPRADOR, ticketRequired: true },
      executedAt,
      endpointStatus: 'requires_ticket',
      healthCheck: { buyersFound: 0, apiAlive: false },
      summary: emptyDryRunSummary(1),
      qualitySummary: {
        filterStrategy: 'Sin ticket disponible',
        includedKeywords: ICP_KEYWORDS.slice(0, 10),
        procurementSignal: true,
        credentialRequired: true,
        credentialInstructions: buildTicketInstructions(),
      },
      acceptedSamples: [],
      lowPrioritySamples: [],
      filteredSamples: [],
      warnings: [
        'ChileCompra requiere un ticket de API para funcionar. ' +
        'Configurar el secreto en Vault y volver a ejecutar.',
      ],
      errors: ['Ticket no disponible'],
    };
  }

  // Elegir modo: supplier_signal solo si hay RUTs explícitos o mode forzado
  const useSupplierMode =
    requestedMode === 'supplier_signal' || sampleRuts.length > 0;

  if (useSupplierMode && sampleRuts.length === 0) {
    return {
      sourceKey: 'cl_chilecompra',
      sourceProvider: 'chilecompra_chile',
      countryCode: 'CL',
      dryRunMode: 'supplier_signal',
      queryParams: { limit: 0, endpointUsed: CHILECOMPRA_BUSCAR_PROVEEDOR, ticketRequired: false },
      executedAt,
      endpointStatus: 'ok',
      supplierLookups: [],
      summary: emptyDryRunSummary(0),
      qualitySummary: {
        filterStrategy: 'Lookup por RUT — sin RUTs de entrada',
        includedKeywords: ICP_KEYWORDS.slice(0, 10),
        procurementSignal: true,
        credentialRequired: false,
        credentialInstructions: null,
      },
      acceptedSamples: [],
      lowPrioritySamples: [],
      filteredSamples: [],
      warnings: [
        'Para discovery productivo, ChileCompra debe combinarse con RUTs de cl_res. ' +
        'Proporciona sampleRuts para usar el modo supplier_signal.',
      ],
      errors: [],
    };
  }

  if (useSupplierMode) {
    return runSupplierSignal(ticket, sampleRuts, executedAt);
  }

  return runHealthCheck(ticket, executedAt);
}
