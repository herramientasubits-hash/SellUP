/**
 * ec-scvs-registry-rows.ts — filas de `source_company_snapshots` para el RUC por
 * nombre de Ecuador dentro de la corrida del Agente 1, CON el tamaño oficial.
 *
 * SOURCES-EC-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj (la hora de
 * importación se inyecta).
 *
 * Los mismos dos archivos públicos de la Superintendencia de Compañías que el
 * buscador gratuito (`ec-scvs-directory-rows.ts`), pero SIN corte de tamaño:
 *   - `ec_scvs_registry`: TODAS las compañías ACTIVAS con RUC de sociedad
 *     (≈183.000), con su razón social limpia y, si el ranking la trae, los
 *     empleados de su último año (≈158.000). Así una empresa que llega por Apollo,
 *     Tavily o Claude recibe su RUC y su tamaño por el mismo camino que el SII de
 *     Chile (`workforceFromRawData` → gate ICP de tamaño): micro y pequeñas salen.
 *   - `ec_scvs_alias_registry`: la sigla o el nombre corto que la propia razón
 *     social trae («… S.A. CONECEL», «(DIFARE)»), una por RUC, con los mismos
 *     empleados. Apollo y Tavily nombran a las grandes por esa sigla.
 *
 * Sustituye en la corrida a `ec_scvs` (bi_compania de julio: 340.000 filas con
 * activas e inactivas y sin empleados). Una compañía INACTIVA nunca da RUC: en
 * julio «MOVISTAR S.A.» y «PETROECUADOR S.A.» (otras compañías, no Otecel ni la EP)
 * se habrían ofrecido como RUC seguro.
 *
 * 🔴 No se guardan representante legal, teléfono ni dirección.
 */

import { deriveTaxRecordIdentity } from '../../record-identity';
import type { RecordIdentityKey } from '../../record-identity';
import { ecCompanyNameAlias, normalizeEcCompanyCore } from './ec-company-name-core';
import { normalizeEcuadorRuc } from './ec-ruc-normalizer';
import type { EcDirectoryRecord, EcRankingMetrics } from './ec-scvs-directory-rows';

export const EC_SCVS_REGISTRY_SOURCE_KEY = 'ec_scvs_registry' as const;
export const EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY = 'ec_scvs_alias_registry' as const;
const EC = 'EC' as const;

/** RUC de sociedad: provincia válida (01-24 o 30) + 8 dígitos + 001 (EC-RUC-v1). */
const COMPANY_RUC = /^(0[1-9]|1[0-9]|2[0-4]|30)\d{8}001$/;

export type EcScvsRegistryRow = {
  source_key: typeof EC_SCVS_REGISTRY_SOURCE_KEY | typeof EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY;
  country_code: typeof EC;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: string | null;
  region: string | null;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Corte de «pequeña» del gate ICP (`OFFICIAL_REGISTRY_WORKERS_SMALL_CUTOFF`). */
const SMALL_WORKERS_CUTOFF = 50;

/**
 * Techo de ventas anuales de la pequeña empresa en Ecuador (US$ 1.000.000,
 * reglamento del Código Orgánico de la Producción, art. 106). Si empleados y
 * ventas no cuadran, la norma hace PREVALECER las ventas.
 */
export const EC_SMALL_COMPANY_MAX_SALES_USD = 1_000_000;

/**
 * SOURCES-EC-CLOSE-1 — los empleados que pueden decidir el tamaño en el gate ICP.
 *
 * Prod 06-10: 851 compañías activas declaran menos de 50 empleados y venden más de
 * US$ 10 millones («CORPORACION EL ROSADO S.A.»: 6 empleados, US$ 1.641 millones;
 * Tiendas Tuti, Superdeporte, Terpel…): su planilla está tercerizada o en otra
 * razón social. Con menos de 50 empleados el gate la descartaría como pequeña. Por
 * eso, si las ventas superan el techo legal de la pequeña empresa, la cifra NO se
 * usa como tamaño (`workers` ausente: no decide) y queda como dato declarado
 * (`declared_workers`) para quien revise. Puro.
 */
export function ecWorkforceFields(metrics: EcRankingMetrics | null): Record<string, unknown> {
  if (metrics === null || metrics.employees === null) return {};
  const contradictedBySales =
    metrics.employees < SMALL_WORKERS_CUTOFF &&
    metrics.salesRevenue !== null &&
    metrics.salesRevenue > EC_SMALL_COMPANY_MAX_SALES_USD;
  if (contradictedBySales) {
    return {
      declared_workers: metrics.employees,
      metrics_year: metrics.year,
      workers_omitted_reason: 'sales_above_small_company_ceiling',
    };
  }
  return { workers: metrics.employees, metrics_year: metrics.year };
}

/** Una compañía ya cruzada: su fila del directorio y, si existe, su último año del ranking. */
export type EcRegistryEntry = { record: EcDirectoryRecord; metrics: EcRankingMetrics | null };

/** ¿Entra al registro? Devuelve el RUC normalizado o `null` (ACTIVA + RUC de sociedad + nombre). */
export function admitEcRegistryCompany(record: EcDirectoryRecord): string | null {
  if (record.legalStatus !== 'ACTIVA' || record.legalName === '') return null;
  const ruc = normalizeEcuadorRuc(record.ruc);
  if (ruc.status !== 'valid' || ruc.normalized === null || !COMPANY_RUC.test(ruc.normalized)) return null;
  return ruc.normalized;
}

/**
 * Un RUC, una compañía: si dos expedientes comparten RUC gana el que declara más
 * empleados (y, si ninguno declara, el primero leído).
 */
export function pickEcRegistryEntry(previous: EcRegistryEntry | undefined, next: EcRegistryEntry): EcRegistryEntry {
  if (previous === undefined) return next;
  return (next.metrics?.employees ?? -1) > (previous.metrics?.employees ?? -1) ? next : previous;
}

/**
 * Las filas (registro y, si la hay, sigla) de una compañía admitida.
 * `workers` y `metrics_year` siguen el formato del SII de Chile, así que
 * `workforceFromRawData` los lee igual. `sourceYear` es el año de la carga cuando
 * el ranking no trae a la compañía.
 */
export function buildEcScvsRegistryRows(params: {
  ruc: string;
  entry: EcRegistryEntry;
  sourceYear: number;
  importedAt: string;
}): EcScvsRegistryRow[] {
  const { ruc, entry, sourceYear, importedAt } = params;
  const { record, metrics } = entry;
  const core = normalizeEcCompanyCore(record.legalName);
  if (core.length === 0) return [];
  const identity = deriveTaxRecordIdentity(ruc);
  const workforce = ecWorkforceFields(metrics);
  const base = {
    country_code: EC,
    source_year: metrics?.year ?? sourceYear,
    tax_id: ruc,
    normalized_tax_id: ruc,
    legal_name: record.legalName,
    sector: record.ciiuCode,
    city: record.city || null,
    region: record.province || null,
    imported_at: importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
  const raw = {
    tax_identifier_type: 'RUC',
    expediente: record.expediente,
    company_type: record.companyType || null,
    ciiu_code: record.ciiuCode,
    ...workforce,
    source_type: 'company_registry_and_financial_ranking',
  };

  const rows: EcScvsRegistryRow[] = [
    { ...base, source_key: EC_SCVS_REGISTRY_SOURCE_KEY, normalized_legal_name: core, raw_data: raw },
  ];
  const alias = ecCompanyNameAlias(record.legalName);
  if (alias !== null) {
    rows.push({
      ...base,
      source_key: EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY,
      normalized_legal_name: alias,
      raw_data: { ...raw, alias_of_core: core, source_type: 'company_registry_name_alias' },
    });
  }
  return rows;
}
