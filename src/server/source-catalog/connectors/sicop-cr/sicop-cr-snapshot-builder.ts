/**
 * SICOP Costa Rica — Snapshot Builder
 *
 * Construye filas para source_company_snapshots agrupando registros SICOP
 * por proveedor (cédula jurídica normalizada) y año.
 *
 * Clave única: (source_key, country_code, source_year, normalized_tax_id)
 *
 * Guardrails semánticos obligatorios en raw_data:
 *   source_type: 'procurement_signal'
 *   legal_validation_status: 'not_applicable'   — SICOP no es fuente fiscal
 *   tax_validation_status: 'not_applicable'
 *   official_ciiu_available: false
 *   ciiu_status: 'unavailable_for_mvp'
 *   sector_source: 'procurement_category_or_not_official'
 *   human_review_required: true
 *   priority_boost: true
 *
 * Hito: Centroamérica.4A
 */

import type { UniqueProvider, SicopProviderRecord } from './sicop-cr-normalizer';

// ─── Constantes ────────────────────────────────────────────────────────────────

export const SICOP_SOURCE_KEY = 'cr_sicop' as const;
export const SICOP_COUNTRY_CODE = 'CR' as const;

/** Máximo de registros en sample_records para no inflar el payload. */
const MAX_SAMPLE_RECORDS = 8;

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type SicopSampleRecord = {
  dataset: string;
  procedure_number: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  event_date: string | null;
};

export type SicopSnapshotRawData = {
  source_type: 'procurement_signal';
  legal_validation_status: 'not_applicable';
  tax_validation_status: 'not_applicable';
  official_ciiu_available: false;
  ciiu_status: 'unavailable_for_mvp';
  sector_source: 'procurement_category_or_not_official';
  human_review_required: true;
  priority_boost: true;
  supplier_id: string;
  supplier_name: string;
  total_records_year: number;
  datasets_seen: string[];
  sample_records: SicopSampleRecord[];
};

export type SicopSnapshotRow = {
  source_key: typeof SICOP_SOURCE_KEY;
  country_code: typeof SICOP_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string | null;
  sector: null;
  city: null;
  department: null;
  region: null;
  priority_score: number;
  signals: {
    total_records_year: number;
    datasets_seen: string[];
    last_event_date: string | null;
  };
  financials: Record<string, never>;
  raw_data: SicopSnapshotRawData;
  imported_at: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Infiere el año del snapshot a partir de los registros del proveedor.
 * Toma el año más frecuente de las fechas disponibles, o el año actual.
 */
function inferYear(records: SicopProviderRecord[]): number {
  const yearCounts = new Map<number, number>();
  for (const rec of records) {
    if (!rec.eventDate) continue;
    // Fechas en formatos: YYYY-MM-DD, DD/MM/YYYY, YYYY
    const match = rec.eventDate.match(/(\d{4})/);
    if (!match) continue;
    const y = parseInt(match[1], 10);
    if (y >= 2015 && y <= 2030) {
      yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
    }
  }
  if (yearCounts.size === 0) return new Date().getFullYear();
  let bestYear = new Date().getFullYear();
  let bestCount = 0;
  for (const [y, count] of yearCounts) {
    if (count > bestCount) { bestYear = y; bestCount = count; }
  }
  return bestYear;
}

/**
 * Extrae la última fecha de evento de los registros.
 */
function lastEventDate(records: SicopProviderRecord[]): string | null {
  let latest: string | null = null;
  for (const rec of records) {
    if (!rec.eventDate) continue;
    if (!latest || rec.eventDate > latest) latest = rec.eventDate;
  }
  return latest;
}

// ─── Builder ───────────────────────────────────────────────────────────────────

/**
 * Construye una fila de source_company_snapshots para un proveedor SICOP.
 * Todos los guardrails semánticos van en raw_data.
 */
export function buildSicopSnapshotRow(params: {
  provider: UniqueProvider;
  importedAt?: string;
}): SicopSnapshotRow {
  const { provider } = params;
  const importedAt = params.importedAt ?? new Date().toISOString();

  const year = inferYear(provider.records);
  const datasets = [...new Set(provider.records.map((r) => r.dataset))];
  const lastDate = lastEventDate(provider.records);

  const sampleRecords: SicopSampleRecord[] = provider.records
    .slice(0, MAX_SAMPLE_RECORDS)
    .map((r) => ({
      dataset: r.dataset,
      procedure_number: r.procedureNumber,
      buyer_id: r.buyerId,
      buyer_name: r.buyerName,
      event_date: r.eventDate,
    }));

  const rawData: SicopSnapshotRawData = {
    source_type: 'procurement_signal',
    legal_validation_status: 'not_applicable',
    tax_validation_status: 'not_applicable',
    official_ciiu_available: false,
    ciiu_status: 'unavailable_for_mvp',
    sector_source: 'procurement_category_or_not_official',
    human_review_required: true,
    priority_boost: true,
    supplier_id: provider.cedula,
    supplier_name: provider.name,
    total_records_year: provider.records.length,
    datasets_seen: datasets,
    sample_records: sampleRecords,
  };

  return {
    source_key: SICOP_SOURCE_KEY,
    country_code: SICOP_COUNTRY_CODE,
    source_year: year,
    tax_id: provider.cedula,
    normalized_tax_id: provider.cedula,
    legal_name: provider.name,
    sector: null,
    city: null,
    department: null,
    region: null,
    priority_score: Math.min(provider.records.length * 10, 100),
    signals: {
      total_records_year: provider.records.length,
      datasets_seen: datasets,
      last_event_date: lastDate,
    },
    financials: {},
    raw_data: rawData,
    imported_at: importedAt,
  };
}

/**
 * Construye un array de filas listo para upsert.
 */
export function buildSicopSnapshotRows(
  providers: UniqueProvider[],
  importedAt?: string,
): SicopSnapshotRow[] {
  return providers.map((p) => buildSicopSnapshotRow({ provider: p, importedAt }));
}
