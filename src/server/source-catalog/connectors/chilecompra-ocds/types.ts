/**
 * ChileCompra / Mercado Público OCDS Connector — Types
 *
 * Fuente abierta OCDS de Mercado Público (Chile). Sin auth, sin API key.
 * Separada del connector legacy `chilecompra-chile` (ticket/Clave Única, bloqueado).
 *
 * Solo lectura. Estos tipos describen una vista DEFENSIVA del OCDS:
 * casi todo es opcional porque el detalle puede venir incompleto.
 */

// ─── OCDS raw shapes (parcial / defensivo) ──────────────────────────────────────

export type OcdsClassification = {
  scheme?: string | null;
  id?: string | number | null;
  description?: string | null;
};

export type OcdsItem = {
  classification?: OcdsClassification | null;
  additionalClassifications?: OcdsClassification[] | null;
};

export type OcdsValue = {
  amount?: number | null;
  currency?: string | null;
};

export type OcdsPeriod = {
  startDate?: string | null;
  endDate?: string | null;
};

export type OcdsTender = {
  id?: string | number | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  value?: OcdsValue | null;
  procurementMethod?: string | null;
  procurementMethodDetails?: string | null;
  tenderPeriod?: OcdsPeriod | null;
  items?: OcdsItem[] | null;
};

export type OcdsIdentifier = {
  scheme?: string | null;
  id?: string | number | null;
};

export type OcdsAddress = {
  region?: string | null;
  countryName?: string | null;
};

export type OcdsContactPoint = {
  name?: string | null;
  email?: string | null;
  telephone?: string | null;
};

export type OcdsParty = {
  id?: string | number | null;
  name?: string | null;
  roles?: string[] | null;
  identifier?: OcdsIdentifier | null;
  address?: OcdsAddress | null;
  /** Pertenece al comprador — NUNCA mapear como contacto comercial del proveedor. */
  contactPoint?: OcdsContactPoint | null;
};

export type OcdsAwardSupplier = {
  id?: string | number | null;
  name?: string | null;
};

export type OcdsAward = {
  id?: string | number | null;
  status?: string | null;
  suppliers?: OcdsAwardSupplier[] | null;
};

export type OcdsRelease = {
  ocid?: string | null;
  id?: string | number | null;
  tender?: OcdsTender | null;
  parties?: OcdsParty[] | null;
  buyer?: { id?: string | number | null; name?: string | null } | null;
  awards?: OcdsAward[] | null;
};

// ─── Listado ────────────────────────────────────────────────────────────────────

export type ChileCompraOcdsListItem = {
  ocid: string;
  urlTender: string | null;
  urlAward: string | null;
};

// ─── Proceso normalizado (salida por item del dry-run) ──────────────────────────

export type NormalizedOcdsProcess = {
  ocid: string;
  tender_id: string | null;
  tender_title: string | null;
  tender_description_short: string | null;
  tender_status: string | null;
  buyer_name: string | null;
  buyer_rut: string | null;
  buyer_region: string | null;
  buyer_country: string | null;
  tender_value_amount: number | null;
  tender_value_currency: string | null;
  procurement_method: string | null;
  tender_period_start: string | null;
  tender_period_end: string | null;
  award_status: string | null;
  awarded_supplier_name: string | null;
  awarded_supplier_rut: string | null;
  unspsc_codes: string[];
  unspsc_descriptions: string[];
  source_url: string;
};

// ─── Health-check ────────────────────────────────────────────────────────────────

export type ChileCompraOcdsHealthCheckInput = {
  year: number;
  month: number;
  limit?: number;
  offset?: number;
};

export type ChileCompraOcdsHealthCheckReport = {
  status: 'operational' | 'error';
  year: number;
  month: number;
  limit: number;
  offset: number;
  totalMonthProcesses: number | null;
  firstOcids: string[];
  writes_performed: 0;
  message: string;
  error?: string;
};

// ─── Dry-run ──────────────────────────────────────────────────────────────────────

export type ChileCompraOcdsDryRunInput = {
  year: number;
  month: number;
  sampleSize?: number;
  offset?: number;
};

export type ChileCompraOcdsDryRunSummary = {
  requested_sample_size: number;
  listed_count: number;
  details_attempted: number;
  details_success: number;
  details_failed: number;
  total_month_processes: number | null;
  awarded_count: number;
  suppliers_detected_count: number;
  unique_buyers_count: number;
  unique_suppliers_count: number;
  writes_performed: 0;
};

export type ChileCompraOcdsDryRunReport = {
  executedAt: string;
  year: number;
  month: number;
  sampleSize: number;
  offset: number;
  items: NormalizedOcdsProcess[];
  summary: ChileCompraOcdsDryRunSummary;
  warnings: string[];
  message: string;
};
