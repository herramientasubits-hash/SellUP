/**
 * ChileCompra Connector — Types
 *
 * Tipos defensivos para el conector ChileCompra / Mercado Público Chile.
 * sourceKey: cl_chilecompra | sourceProvider: chilecompra_chile
 * Solo lectura. Sin writes. Sin candidatos en DB.
 *
 * Fuente: OCDS / API pública Mercado Público.
 * RUT proveedor + razón social + categoría UNSPSC disponibles en API.
 * Señal B2G: empresas con contratos vigentes con el Estado chileno.
 */

/** Registro raw de proveedor desde la API ChileCompra / OCDS. */
export type ChileCompraRawRecord = {
  // Campos del endpoint de proveedores
  CodigoProveedor?: unknown;
  RutProveedor?: unknown;
  NombreProveedor?: unknown;
  RazonSocial?: unknown;
  // Campos OCDS release
  Rut?: unknown;
  Nombre?: unknown;
  rut?: unknown;
  nombre?: unknown;
  // Categoría / UNSPSC
  CodigoUnspsc?: unknown;
  NombreUnspsc?: unknown;
  Unspsc?: unknown;
  CodigoProducto?: unknown;
  NombreProducto?: unknown;
  // Geografía
  Region?: unknown;
  Ciudad?: unknown;
  Municipio?: unknown;
  // Comprador / contrato
  OrganismoComprador?: unknown;
  NombreOrganismo?: unknown;
  CodigoLicitacion?: unknown;
  NombreLicitacion?: unknown;
  Estado?: unknown;
  FechaAdjudicacion?: unknown;
  MontoTotal?: unknown;
  // Campos OCDS genéricos
  [key: string]: unknown;
};

/** Tipo de señal de contratación pública. */
export type ChileProcurementSignal =
  | 'active_supplier'
  | 'historical_supplier'
  | 'unknown';

/** Registro normalizado para dry-run — no es un prospect_candidate. */
export type NormalizedChileCompraSupplier = {
  sourceKey: 'cl_chilecompra';
  companyName: string | null;
  legalName: string | null;
  taxId: string | null;
  taxIdentifierType: 'RUT';
  country: 'Chile';
  countryCode: 'CL';
  city: string | null;
  region: string | null;
  procurementCategoryCode: string | null;
  procurementCategoryName: string | null;
  unspscCode: string | null;
  unspscDescription: string | null;
  governmentBuyer: string | null;
  procurementActivityCount: number | null;
  procurementSignal: true;
  sourceType: 'structured_procurement';
  sourceRecordId: string | null;
  rawRecordId: string | null;
  reviewFlags: ChileCompraReviewFlag[];
  qualityDecision: ChileCompraQualityDecision;
  qualityReason: string;
  /** true = categoría ICP-UBITS relevante */
  icpMatch: boolean;
  icpMatchKeyword: string | null;
};

/** Flags de revisión específicas del conector ChileCompra. */
export type ChileCompraReviewFlag =
  | 'procurement_signal'
  | 'rut_available'
  | 'missing_rut'
  | 'no_website'
  | 'no_contact_data'
  | 'sector_from_procurement_category'
  | 'requires_manual_business_validation'
  | 'icp_category_match'
  | 'icp_category_no_match'
  | 'missing_category'
  | 'b2g_supplier';

/** Decisión de calidad para registros ChileCompra. */
export type ChileCompraQualityDecision = 'accepted' | 'low_priority' | 'filtered';

/** Modo de ejecución del dry-run. */
export type ChileCompraDryRunMode = 'health_check' | 'supplier_signal';

/** Parámetros de input para el dry-run. */
export type RunChileCompraDryRunInput = {
  limit?: number;
  /** Ticket API Mercado Público si está disponible. */
  ticket?: string;
  /**
   * Modo de ejecución:
   *   - health_check (default): lista compradores para confirmar que la API está viva.
   *   - supplier_signal: busca RUTs específicos y obtiene señal B2G.
   */
  mode?: ChileCompraDryRunMode;
  /**
   * RUTs de prueba para modo supplier_signal.
   * Si no se proveen, el modo health_check es el único disponible.
   */
  sampleRuts?: string[];
};

/** Resultado de búsqueda de un proveedor por RUT en el dry-run. */
export type SupplierLookupResult = {
  rut: string;
  rutFormatted: string;
  found: boolean;
  supplierCode?: string;
  supplierName?: string;
  ordersCount?: number;
  error?: string;
};

/** Estado del endpoint durante el dry-run. */
export type ChileCompraEndpointStatus =
  | 'ok'
  | 'connected'
  | 'requires_ticket'
  | 'unavailable'
  | 'error';

/** Reporte final del dry-run — nunca escribe en DB. */
export type RunChileCompraDryRunReport = {
  sourceKey: 'cl_chilecompra';
  sourceProvider: 'chilecompra_chile';
  countryCode: 'CL';
  dryRunMode: ChileCompraDryRunMode;
  queryParams: {
    limit: number;
    endpointUsed: string;
    ticketRequired: boolean;
  };
  executedAt: string;
  endpointStatus: ChileCompraEndpointStatus;
  /** Resultado del health check (modo health_check). */
  healthCheck?: {
    buyersFound: number;
    apiAlive: boolean;
  };
  /** Resultados de búsqueda por RUT (modo supplier_signal). */
  supplierLookups?: SupplierLookupResult[];
  summary: {
    recordsRead: number;
    normalizedCount: number;
    acceptedDraftsCount: number;
    lowPriorityCount: number;
    filteredOutCount: number;
    missingRutCount: number;
    missingCategoryCount: number;
    icpMatchCount: number;
    errorsCount: number;
  };
  qualitySummary: {
    filterStrategy: string;
    includedKeywords: string[];
    procurementSignal: true;
    credentialRequired: boolean;
    credentialInstructions: string | null;
  };
  acceptedSamples: NormalizedChileCompraSupplier[];
  lowPrioritySamples: NormalizedChileCompraSupplier[];
  filteredSamples: Array<{
    rawRecordId: string | null;
    legalName: string | null;
    filterReason: string;
  }>;
  warnings: string[];
  errors: string[];
};
