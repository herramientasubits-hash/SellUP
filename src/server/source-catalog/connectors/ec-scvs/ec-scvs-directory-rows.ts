/**
 * ec-scvs-directory-rows.ts — arma filas de `source_company_snapshots` para
 * `ec_scvs_directory`: compañías ecuatorianas ACTIVAS con 200 o más empleados.
 *
 * SOURCES-EC-FREE-DISCOVERY-1. Puro: sin env, sin I/O, sin DB, sin reloj (la hora
 * de importación se inyecta).
 *
 * Dos archivos públicos de la Superintendencia de Compañías, cruzados por
 * `expediente`:
 *   - Directorio de compañías (`directorio_companias.xlsx`): RUC, razón social,
 *     situación legal, tipo, provincia, ciudad y CIIU 4.0 a 6 niveles.
 *   - Ranking empresarial (`bi_ranking.csv`): por año, número de empleados e
 *     ingresos por ventas declarados en los estados financieros.
 *
 * Una compañía entra sólo si (1) está ACTIVA, (2) tiene RUC de 13 dígitos de
 * sociedad (termina en 001), y (3) su último año en el ranking declara 200 o más
 * empleados, que es el umbral de tamaño del Agente 1. Así la capa gratuita nunca
 * cierra un objetivo con microempresas.
 *
 * 🔴 No se guardan representante legal, teléfono ni dirección: el Agente 1 no
 * recoge datos de personas desde esta fuente.
 */

import { deriveTaxRecordIdentity } from '../../record-identity';
import type { RecordIdentityKey } from '../../record-identity';
import { normalizeEcCompanyCore } from './ec-company-name-core';
import { normalizeEcuadorRuc } from './ec-ruc-normalizer';
import {
  EC_SCVS_MACRO_TABLE_VERSION,
  normalizeEcCiiuCode,
  resolveEcActivityMacro,
} from '@/server/prospect-batches/country-source-discovery/ec-scvs-macro-table';

export const EC_SCVS_DIRECTORY_SOURCE_KEY = 'ec_scvs_directory' as const;
export const EC_SCVS_DIRECTORY_COUNTRY_CODE = 'EC' as const;

/** Umbral de tamaño del Agente 1 (más de 200 empleados se redondea a 200 o más). */
export const EC_SCVS_DIRECTORY_MIN_EMPLOYEES = 200;

/**
 * RUC de sociedad: provincia válida (01-24 o 30) + 8 dígitos + 001. Misma regla
 * de formato que `tax-identifier-rules.ts` (EC-RUC-v1), restringida al primer
 * establecimiento.
 */
const COMPANY_RUC = /^(0[1-9]|1[0-9]|2[0-4]|30)\d{8}001$/;

/** Lo que se usa de una fila del directorio (cabeceras tal como las publica la SCVS). */
export type EcDirectoryRecord = {
  expediente: string;
  ruc: string;
  legalName: string;
  legalStatus: string;
  companyType: string;
  province: string;
  city: string;
  ciiuCode: string | null;
};

/** El último año del ranking de una compañía. */
export type EcRankingMetrics = {
  year: number;
  employees: number | null;
  salesRevenue: number | null;
};

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();

/** Fila del directorio (objeto por cabecera) → registro, o `null` si falta expediente o RUC. */
export function readEcDirectoryRecord(row: Readonly<Record<string, unknown>>): EcDirectoryRecord | null {
  const expediente = text(row['EXPEDIENTE']);
  const ruc = text(row['RUC']);
  if (expediente === '' || ruc === '') return null;
  return {
    expediente,
    ruc,
    legalName: text(row['NOMBRE']),
    legalStatus: text(row['SITUACIÓN LEGAL']).toUpperCase(),
    companyType: text(row['TIPO']),
    province: text(row['PROVINCIA']),
    city: text(row['CIUDAD']),
    ciiuCode: normalizeEcCiiuCode(text(row['CIIU NIVEL 6'])),
  };
}

function toNumber(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Fila del ranking → `[expediente, métricas]`, o `null` si no trae expediente o
 * año. Los empleados vienen como decimal (`"350.0"`); se truncan a entero.
 */
export function readEcRankingLine(row: Readonly<Record<string, string>>): [string, EcRankingMetrics] | null {
  const expediente = (row['expediente'] ?? '').trim();
  const year = toNumber(row['anio']);
  if (expediente === '' || year === null || !Number.isInteger(year)) return null;
  const employees = toNumber(row['n_empleados']);
  return [
    expediente,
    {
      year,
      employees: employees !== null && employees >= 0 ? Math.trunc(employees) : null,
      salesRevenue: toNumber(row['ingresos_ventas']),
    },
  ];
}

/** Se queda con el año más reciente de cada compañía (devuelve el ganador). */
export function latestRanking(
  previous: EcRankingMetrics | undefined,
  next: EcRankingMetrics,
): EcRankingMetrics {
  return previous === undefined || next.year > previous.year ? next : previous;
}

export type EcScvsDirectoryRow = {
  source_key: typeof EC_SCVS_DIRECTORY_SOURCE_KEY;
  country_code: typeof EC_SCVS_DIRECTORY_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: string | null;
  department: string | null;
  region: string | null;
  priority_score: number;
  signals: Record<string, unknown>;
  financials: Record<string, unknown>;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/**
 * ¿Entra esta compañía? Devuelve el RUC normalizado o `null`. La razón queda en
 * el contador del cargador; aquí sólo se decide.
 */
export function admitEcDirectoryCompany(
  record: EcDirectoryRecord,
  metrics: EcRankingMetrics | null,
): string | null {
  if (record.legalStatus !== 'ACTIVA' || record.legalName === '') return null;
  const ruc = normalizeEcuadorRuc(record.ruc);
  if (ruc.status !== 'valid' || ruc.normalized === null || !COMPANY_RUC.test(ruc.normalized)) return null;
  if (metrics === null || metrics.employees === null) return null;
  if (metrics.employees < EC_SCVS_DIRECTORY_MIN_EMPLOYEES) return null;
  return ruc.normalized;
}

/**
 * Construye la fila de una compañía admitida. `priorityScore` (0-100) es el
 * percentil de sus empleados entre todas las cargadas: la fuente gratuita ordena
 * por él sin ordenar por un campo JSON.
 *
 * `workers` y `metrics_year` siguen el mismo formato que el SII de Chile, así que
 * `workforceFromRawData` los lee igual.
 */
export function buildEcScvsDirectoryRow(params: {
  record: EcDirectoryRecord;
  ruc: string;
  metrics: EcRankingMetrics;
  priorityScore: number;
  importedAt: string;
}): EcScvsDirectoryRow {
  const { record, ruc, metrics, priorityScore, importedAt } = params;
  const identity = deriveTaxRecordIdentity(ruc);
  const macro = resolveEcActivityMacro(record.ciiuCode);
  const core = normalizeEcCompanyCore(record.legalName);

  return {
    source_key: EC_SCVS_DIRECTORY_SOURCE_KEY,
    country_code: EC_SCVS_DIRECTORY_COUNTRY_CODE,
    source_year: metrics.year,
    tax_id: ruc,
    normalized_tax_id: ruc,
    legal_name: record.legalName,
    normalized_legal_name: core.length > 0 ? core : record.legalName.toUpperCase(),
    sector: record.ciiuCode,
    city: record.city || null,
    department: null,
    region: record.province || null,
    priority_score: Math.max(0, Math.min(100, Math.round(priorityScore * 100) / 100)),
    signals: { employees: metrics.employees, metrics_year: metrics.year },
    financials: metrics.salesRevenue !== null ? { sales_revenue_usd: metrics.salesRevenue } : {},
    raw_data: {
      tax_identifier_type: 'RUC',
      expediente: record.expediente,
      company_type: record.companyType || null,
      ciiu_code: record.ciiuCode,
      macro_industry_key: macro,
      macro_table_version: EC_SCVS_MACRO_TABLE_VERSION,
      workers: metrics.employees,
      metrics_year: metrics.year,
      source_type: 'company_registry_and_financial_ranking',
      sector_source: 'scvs_ciiu4_inec',
      human_review_required: true,
    },
    imported_at: importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
