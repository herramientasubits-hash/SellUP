/**
 * ChileCompra — Dry Run
 *
 * Soporta tres modos:
 *   - health_check (default): valida ticket via GET /v2/compra-agil con header auth.
 *   - compra_agil_discovery: busca por keywords ICP, obtiene detalles y extrae
 *     proveedores_cotizando. Principal modo de discovery B2G.
 *   - supplier_signal: busca RUTs concretos en BuscarProveedor (validación secundaria).
 *
 * NO escribe en Supabase. NO crea prospect_batches. NO crea prospect_candidates.
 * NO toca HubSpot. NO loguea el ticket. Solo lectura. Solo reporte.
 */

import {
  fetchCompraAgilList,
  fetchCompraAgilDetail,
  searchChileCompraSupplierByRut,
  fetchChileCompraPurchaseOrdersBySupplier,
  buildTicketInstructions,
  formatChileRut,
  CHILECOMPRA_V2_COMPRA_AGIL,
  CHILECOMPRA_BUSCAR_PROVEEDOR,
} from './chilecompra-client';
import { ICP_KEYWORDS } from './normalizers';
import type {
  RunChileCompraDryRunInput,
  RunChileCompraDryRunReport,
  SupplierLookupResult,
  CompraAgilDiscoveryItem,
  NormalizedChileCompraSupplier,
  ChileCompraReviewFlag,
} from './types';

// ── Constantes de límite ──────────────────────────────────────────────────────

const MAX_DISCOVERY_KEYWORDS = 3;
const MAX_ITEMS_PER_KEYWORD = 10;
const MAX_DETAILS_TO_FETCH = 5;
const MAX_SUPPLIERS_PER_DETAIL = 10;
const MAX_SAMPLE_RUTS = 3;

// ── Keywords ICP por defecto ──────────────────────────────────────────────────

const DEFAULT_DISCOVERY_KEYWORDS = ['capacitacion', 'software', 'formacion', 'tecnologia'];

// ── Modo 1: health_check ───────────────────────────────────────────────────────

async function runHealthCheck(
  ticket: string,
  executedAt: string,
): Promise<RunChileCompraDryRunReport> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const result = await fetchCompraAgilList({ ticket, tamano_pagina: 1, numero_pagina: 1 });

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
        endpointUsed: CHILECOMPRA_V2_COMPRA_AGIL,
        ticketRequired: isCredentialError,
      },
      executedAt,
      endpointStatus: isCredentialError ? 'requires_ticket' : 'error',
      healthCheck: { compraAgilFound: 0, apiAlive: false },
      summary: emptyDryRunSummary(1),
      qualitySummary: {
        filterStrategy: 'Health check — Compra Ágil V2',
        includedKeywords: ICP_KEYWORDS.slice(0, 10),
        procurementSignal: true,
        credentialRequired: isCredentialError,
        credentialInstructions: isCredentialError ? buildTicketInstructions() : null,
      },
      acceptedSamples: [],
      lowPrioritySamples: [],
      filteredSamples: [],
      warnings,
      errors: [result.error ?? 'Error al consultar Compra Ágil V2'],
    };
  }

  const compraAgilFound = result.total ?? result.items.length;

  if (compraAgilFound === 0) {
    warnings.push(
      'Compra Ágil V2 retornó 0 ítems — verificar ticket o disponibilidad del endpoint.',
    );
  }

  return {
    sourceKey: 'cl_chilecompra',
    sourceProvider: 'chilecompra_chile',
    countryCode: 'CL',
    dryRunMode: 'health_check',
    queryParams: {
      limit: 0,
      endpointUsed: CHILECOMPRA_V2_COMPRA_AGIL,
      ticketRequired: false,
    },
    executedAt,
    endpointStatus: 'connected',
    healthCheck: { compraAgilFound, apiAlive: true },
    summary: emptyDryRunSummary(0),
    qualitySummary: {
      filterStrategy: 'Health check — Compra Ágil V2',
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

// ── Modo 2: compra_agil_discovery ─────────────────────────────────────────────

function matchesIcpKeyword(text: string): string | null {
  const lower = text.toLowerCase();
  for (const kw of ICP_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function buildNormalizedFromCompraAgil(
  rut: string,
  razonSocial: string,
  icpKeyword: string | null,
  organismo: string | null,
  region: string | null,
  titulo: string | null,
  index: number,
): NormalizedChileCompraSupplier {
  const icpMatch = icpKeyword !== null;
  const flags: ChileCompraReviewFlag[] = [
    'procurement_signal',
    'b2g_supplier',
    rut ? 'rut_available' : 'missing_rut',
    icpMatch ? 'icp_category_match' : 'icp_category_no_match',
  ];

  return {
    sourceKey: 'cl_chilecompra',
    companyName: razonSocial || null,
    legalName: razonSocial || null,
    taxId: rut ? formatChileRut(rut) : null,
    taxIdentifierType: 'RUT',
    country: 'Chile',
    countryCode: 'CL',
    city: null,
    region: region || null,
    procurementCategoryCode: null,
    procurementCategoryName: titulo || null,
    unspscCode: null,
    unspscDescription: null,
    governmentBuyer: organismo || null,
    procurementActivityCount: null,
    procurementSignal: true,
    sourceType: 'structured_procurement',
    sourceRecordId: `compra-agil-${index}`,
    rawRecordId: `compra-agil-${index}`,
    reviewFlags: flags,
    qualityDecision: icpMatch ? 'accepted' : 'low_priority',
    qualityReason: icpMatch
      ? `Proveedor cotizando en proceso B2G relacionado con "${icpKeyword}"`
      : 'Proveedor B2G sin match de keyword ICP — baja prioridad',
    icpMatch,
    icpMatchKeyword: icpKeyword,
  };
}

async function runCompraAgilDiscovery(
  ticket: string,
  searchKeywords: string[],
  executedAt: string,
): Promise<RunChileCompraDryRunReport> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const compraAgilItems: CompraAgilDiscoveryItem[] = [];
  const acceptedSamples: NormalizedChileCompraSupplier[] = [];
  const lowPrioritySamples: NormalizedChileCompraSupplier[] = [];

  const keywords = searchKeywords.slice(0, MAX_DISCOVERY_KEYWORDS);
  const seenCodigos = new Set<string>();
  const seenRuts = new Set<string>();
  let supplierIndex = 0;
  let detailsFetched = 0;

  for (const keyword of keywords) {
    const listResult = await fetchCompraAgilList({
      ticket,
      q: keyword,
      tamano_pagina: MAX_ITEMS_PER_KEYWORD,
      numero_pagina: 1,
    });

    if (!listResult.ok) {
      errors.push(`Error buscando "${keyword}": ${listResult.error ?? 'error desconocido'}`);
      continue;
    }

    for (const item of listResult.items) {
      if (detailsFetched >= MAX_DETAILS_TO_FETCH) break;

      const codigo = item.codigo != null ? String(item.codigo) : null;
      if (!codigo || seenCodigos.has(codigo)) continue;
      seenCodigos.add(codigo);

      const titulo =
        item.titulo != null ? String(item.titulo) :
        item.nombre != null ? String(item.nombre) :
        keyword;

      const icpKeyword = matchesIcpKeyword(titulo) ?? keyword;
      const organismo = item.organismo != null ? String(item.organismo) : null;
      const region = item.region != null ? String(item.region) : null;

      const detailResult = await fetchCompraAgilDetail({ codigo, ticket });
      detailsFetched++;

      if (!detailResult.ok || !detailResult.detail) {
        warnings.push(
          `Proceso ${codigo} (${titulo.slice(0, 60)}): no se pudo obtener detalle — ${detailResult.error ?? 'error'}`,
        );
        compraAgilItems.push({
          codigo,
          titulo,
          organismo: organismo ?? undefined,
          region: region ?? undefined,
          suppliersExtracted: 0,
          suppliers: [],
        });
        continue;
      }

      const detail = detailResult.detail;
      const proveedores = (detail.proveedores_cotizando ?? []).slice(0, MAX_SUPPLIERS_PER_DETAIL);

      const itemSuppliers: CompraAgilDiscoveryItem['suppliers'] = [];

      for (const p of proveedores) {
        const rut = p.rut_proveedor != null ? String(p.rut_proveedor) : '';
        const razonSocial = p.razon_social != null ? String(p.razon_social) : '';
        if (!rut || seenRuts.has(rut)) continue;
        seenRuts.add(rut);

        itemSuppliers.push({
          rut,
          razonSocial,
          esEmt: p.es_emt === true,
          idCotizacion: p.id_cotizacion != null ? String(p.id_cotizacion) : undefined,
        });

        const normalized = buildNormalizedFromCompraAgil(
          rut, razonSocial, icpKeyword,
          organismo ?? detail.organismo ?? null,
          region ?? detail.region ?? null,
          titulo,
          supplierIndex++,
        );

        if (normalized.qualityDecision === 'accepted') {
          acceptedSamples.push(normalized);
        } else {
          lowPrioritySamples.push(normalized);
        }
      }

      compraAgilItems.push({
        codigo,
        titulo,
        organismo: organismo ?? detail.organismo ?? undefined,
        region: region ?? detail.region ?? undefined,
        estado: item.estado != null ? String(item.estado) : detail.estado ?? undefined,
        suppliersExtracted: itemSuppliers.length,
        suppliers: itemSuppliers,
      });
    }
  }

  if (compraAgilItems.length === 0) {
    warnings.push(
      'No se encontraron procesos Compra Ágil con los keywords utilizados. ' +
      'Verificar que el ticket tiene acceso a la API V2.',
    );
  }

  const totalSuppliersExtracted = compraAgilItems.reduce((s, i) => s + i.suppliersExtracted, 0);

  if (totalSuppliersExtracted === 0 && compraAgilItems.length > 0) {
    warnings.push(
      'Procesos Compra Ágil encontrados pero sin proveedores_cotizando. ' +
      'Los procesos pueden estar en fase previa a cotización.',
    );
  }

  return {
    sourceKey: 'cl_chilecompra',
    sourceProvider: 'chilecompra_chile',
    countryCode: 'CL',
    dryRunMode: 'compra_agil_discovery',
    queryParams: {
      limit: keywords.length * MAX_ITEMS_PER_KEYWORD,
      endpointUsed: CHILECOMPRA_V2_COMPRA_AGIL,
      ticketRequired: false,
    },
    executedAt,
    endpointStatus: errors.length > 0 && compraAgilItems.length === 0 ? 'error' : 'ok',
    compraAgilItems,
    summary: {
      recordsRead: compraAgilItems.length,
      normalizedCount: totalSuppliersExtracted,
      acceptedDraftsCount: acceptedSamples.length,
      lowPriorityCount: lowPrioritySamples.length,
      filteredOutCount: 0,
      missingRutCount: 0,
      missingCategoryCount: 0,
      icpMatchCount: acceptedSamples.length,
      errorsCount: errors.length,
    },
    qualitySummary: {
      filterStrategy: 'Compra Ágil V2 — keywords ICP → proveedores_cotizando',
      includedKeywords: keywords,
      procurementSignal: true,
      credentialRequired: false,
      credentialInstructions: null,
    },
    acceptedSamples: acceptedSamples.slice(0, 5),
    lowPrioritySamples: lowPrioritySamples.slice(0, 5),
    filteredSamples: [],
    warnings,
    errors,
  };
}

// ── Modo 3: supplier_signal ────────────────────────────────────────────────────

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
      supplierLookups.push({ rut, rutFormatted: lookupResult.rutFormatted, found: false });
      continue;
    }

    let ordersCount: number | undefined;
    const ordersResult = await fetchChileCompraPurchaseOrdersBySupplier({
      supplierCode: lookupResult.supplierCode,
      ticket,
    });

    if (ordersResult.ok) {
      ordersCount = ordersResult.ordersCount;
    } else {
      warnings.push(
        `Proveedor ${lookupResult.rutFormatted} encontrado pero error en órdenes: ${ordersResult.error ?? 'error'}`,
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
      `Ninguno de los ${rutsToQuery.length} RUTs existe como proveedor en Mercado Público. ` +
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
 * Modo compra_agil_discovery (recomendado):
 *   - Busca por keywords ICP en /v2/compra-agil (header auth).
 *   - Obtiene detalles y extrae proveedores_cotizando.
 *   - Genera muestras accepted/low_priority de proveedores B2G.
 *
 * Modo health_check (default sin keywords):
 *   - Valida ticket con GET /v2/compra-agil mínimo.
 *
 * Modo supplier_signal (validación secundaria):
 *   - BuscarProveedor por RUT + órdenes de compra.
 *
 * Sin writes. Sin candidatos. Sin HubSpot.
 */
export async function runChileCompraDryRun(
  input?: RunChileCompraDryRunInput,
): Promise<RunChileCompraDryRunReport> {
  const executedAt = new Date().toISOString();
  const ticket = input?.ticket;
  const sampleRuts = input?.sampleRuts ?? [];
  const searchKeywords = input?.searchKeywords ?? [];
  const requestedMode = input?.mode;

  if (!ticket?.trim()) {
    return {
      sourceKey: 'cl_chilecompra',
      sourceProvider: 'chilecompra_chile',
      countryCode: 'CL',
      dryRunMode: 'health_check',
      queryParams: { limit: 0, endpointUsed: CHILECOMPRA_V2_COMPRA_AGIL, ticketRequired: true },
      executedAt,
      endpointStatus: 'requires_ticket',
      healthCheck: { compraAgilFound: 0, apiAlive: false },
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
        'ChileCompra requiere un ticket de API. ' +
        'Configurar el secreto en Vault y volver a ejecutar.',
      ],
      errors: ['Ticket no disponible'],
    };
  }

  if (requestedMode === 'supplier_signal' || sampleRuts.length > 0) {
    if (sampleRuts.length === 0) {
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
        warnings: ['Proporciona sampleRuts para usar el modo supplier_signal.'],
        errors: [],
      };
    }
    return runSupplierSignal(ticket, sampleRuts, executedAt);
  }

  if (requestedMode === 'compra_agil_discovery' || searchKeywords.length > 0) {
    const keywords = searchKeywords.length > 0
      ? searchKeywords
      : DEFAULT_DISCOVERY_KEYWORDS;
    return runCompraAgilDiscovery(ticket, keywords, executedAt);
  }

  // Default: health_check
  return runHealthCheck(ticket, executedAt);
}
