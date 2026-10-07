/**
 * bo-large-taxpayer-rows.ts — lista de GRANDES CONTRIBUYENTES de Bolivia, lista
 * para `source_company_snapshots` (`source_key = bo_large_taxpayers`).
 *
 * SOURCES-BO-CLOSE-1. Bolivia no publica un padrón descargable. Lo que sí es
 * público (y gratuito):
 *
 *   - Impuestos Nacionales: las resoluciones de categorización PRICO (principales
 *     contribuyentes) y GRACO (grandes contribuyentes), con los NIT en anexos. La
 *     lista vigente se reconstruye desde la recategorización completa de 2018
 *     (RND 101800000003) con las altas y bajas de 2022, 2023 y 2024
 *     (RND 102200000011, 102300000018 y 102400000041, vigente desde el 01-01-2025).
 *   - Aduana Nacional: Principales Operadores de Comercio Exterior (PRIO) y
 *     Operadores Económicos Autorizados (OEA).
 *
 * Esas listas traen sólo el NIT. El nombre, el tipo societario, el departamento y
 * el objeto social salen del SEPREC, consultado una vez por NIT
 * (`scripts/source-catalog/run-bo-seprec-nit-crawl.ts`). Una fila por NIT.
 *
 * Qué entra: sociedades (NIT de persona jurídica) que el SEPREC tiene ACTIVAS y no
 * son unipersonales. Las de matrícula NO renovada entran (su NIT por nombre sigue
 * valiendo: el SEPREC en vivo no muestra su ficha), pero el buscador gratuito no las
 * ofrece.
 *
 * Nunca se guardan contactos ni personas.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { classifyBoliviaActivity, BO_ACTIVITY_MACRO_TABLE_VERSION } from '@/server/prospect-batches/country-source-discovery/bo-activity-macro-table';
import { boliviaLegalNameAliases, normalizeBoliviaCompanyCore } from '../seprec-bolivia/bo-company-name-core';

export const BO_LARGE_TAXPAYERS_SOURCE_KEY = 'bo_large_taxpayers' as const;
/** Año de la carga (la categorización vigente rige desde el 01-01-2025). */
export const BO_LARGE_TAXPAYERS_SOURCE_YEAR = 2026;
/** Año de la categorización vigente de Impuestos Nacionales. */
export const BO_TAXPAYER_CATEGORY_YEAR = 2025;

/** Categoría tributaria o lista de la Aduana de donde salió el NIT. */
export type BoLargeTaxpayerFlag = 'prico' | 'graco' | 'prio' | 'oea';

/** Una línea del archivo que deja la consulta al SEPREC. */
export type BoSeprecCrawlRecord = {
  nit: string;
  flags: readonly string[];
  found: boolean;
  legalName?: string | null;
  status?: string | null;
  unitTypeCode?: string | null;
  unitType?: string | null;
  renewalCode?: string | null;
  department?: string | null;
  detailStatus?: number | null;
  detailNit?: string | null;
  socialPurpose?: string | null;
  lastUpdateYear?: string | null;
};

/** NIT de persona jurídica: el penúltimo dígito es 2 (persona natural: 1). */
const COMPANY_NIT = /^\d{7,13}$/;
export function isBoliviaCompanyNit(nit: string): boolean {
  return COMPANY_NIT.test(nit) && nit[nit.length - 2] === '2';
}

/** Tipo «EMPRESA UNIPERSONAL»: una persona. */
const SOLE_TRADER_CODE = '01';

/** Prioridad de lectura del buscador gratuito: la categoría más alta primero. */
export const BO_FLAG_PRIORITY: Readonly<Record<BoLargeTaxpayerFlag, number>> = {
  prico: 4,
  prio: 2,
  graco: 1,
  oea: 1,
};

const FLAG_ORDER: readonly BoLargeTaxpayerFlag[] = ['prico', 'graco', 'prio', 'oea'];

function isFlag(value: string): value is BoLargeTaxpayerFlag {
  return (FLAG_ORDER as readonly string[]).includes(value);
}

/** Texto limpio o `null`. */
function clean(value: string | null | undefined, max = 600): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, max) : null;
}

export type BoLargeTaxpayerSnapshotRow = {
  source_key: typeof BO_LARGE_TAXPAYERS_SOURCE_KEY;
  country_code: 'BO';
  source_year: number;
  source_period: null;
  record_identity_key: string;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: null;
  department: string | null;
  region: string | null;
  priority_score: number;
  raw_data: {
    taxpayer_category: 'PRICO' | 'GRACO' | null;
    lists: BoLargeTaxpayerFlag[];
    metrics_year: number;
    unit_type: string | null;
    matricula_renewed: boolean;
    social_purpose: string | null;
    last_update_year: number | null;
    macro_industry_key: string | null;
    macro_rule: string | null;
    macro_basis: 'legal_name' | 'social_purpose' | null;
    macro_table_version: string;
    name_aliases: string[];
  };
};

export type BoLargeTaxpayerSkip =
  | 'not_in_seprec'
  | 'inactive'
  | 'sole_trader'
  | 'not_a_company_nit'
  | 'nit_mismatch'
  | 'no_name';

/** Un registro de la consulta → fila, o el motivo por el que no entra. */
export function buildBoLargeTaxpayerRow(
  record: BoSeprecCrawlRecord,
): { row: BoLargeTaxpayerSnapshotRow } | { skip: BoLargeTaxpayerSkip } {
  const nit = record.nit.replace(/\D/g, '');
  if (!isBoliviaCompanyNit(nit)) return { skip: 'not_a_company_nit' };
  if (!record.found) return { skip: 'not_in_seprec' };
  if ((record.status ?? '').toUpperCase() !== 'ACTIVO') return { skip: 'inactive' };
  if (record.unitTypeCode === SOLE_TRADER_CODE) return { skip: 'sole_trader' };
  // La ficha confirma el NIT cuando la hay; si dice otro, la fila no es fiable.
  const detailNit = record.detailNit?.replace(/\D/g, '') ?? '';
  if (detailNit.length > 0 && detailNit !== nit) return { skip: 'nit_mismatch' };
  const legalName = clean(record.legalName, 300);
  const core = normalizeBoliviaCompanyCore(legalName);
  if (legalName === null || core.length < 2) return { skip: 'no_name' };

  const lists = FLAG_ORDER.filter((flag) => record.flags.some((value) => isFlag(value) && value === flag));
  const category = lists.includes('prico') ? 'PRICO' : lists.includes('graco') ? 'GRACO' : null;
  const socialPurpose = clean(record.socialPurpose);
  const activity = classifyBoliviaActivity(legalName, socialPurpose);
  const lastUpdate = Number(record.lastUpdateYear);
  const department = clean(record.department, 60);

  return {
    row: {
      source_key: BO_LARGE_TAXPAYERS_SOURCE_KEY,
      country_code: 'BO',
      source_year: BO_LARGE_TAXPAYERS_SOURCE_YEAR,
      source_period: null,
      record_identity_key: `tax:${nit}`,
      tax_id: nit,
      normalized_tax_id: nit,
      legal_name: legalName,
      normalized_legal_name: core,
      sector: activity.rule,
      city: null,
      department,
      region: department,
      priority_score: lists.reduce((sum, flag) => sum + BO_FLAG_PRIORITY[flag], 0),
      raw_data: {
        taxpayer_category: category,
        lists,
        metrics_year: BO_TAXPAYER_CATEGORY_YEAR,
        unit_type: clean(record.unitType, 80),
        matricula_renewed: record.renewalCode === '0',
        social_purpose: socialPurpose,
        last_update_year: Number.isInteger(lastUpdate) && lastUpdate > 1900 ? lastUpdate : null,
        macro_industry_key: activity.macroIndustryKey,
        macro_rule: activity.rule,
        macro_basis: activity.basis,
        macro_table_version: BO_ACTIVITY_MACRO_TABLE_VERSION,
        name_aliases: boliviaLegalNameAliases(legalName),
      },
    },
  };
}

/** Todos los registros → filas (un NIT, una fila; la primera gana) y el recuento de descartes. */
export function buildBoLargeTaxpayerRows(records: Iterable<BoSeprecCrawlRecord>): {
  rows: BoLargeTaxpayerSnapshotRow[];
  skipped: Record<BoLargeTaxpayerSkip, number>;
} {
  const rows: BoLargeTaxpayerSnapshotRow[] = [];
  const seen = new Set<string>();
  const skipped: Record<BoLargeTaxpayerSkip, number> = {
    not_in_seprec: 0,
    inactive: 0,
    sole_trader: 0,
    not_a_company_nit: 0,
    nit_mismatch: 0,
    no_name: 0,
  };
  for (const record of records) {
    const result = buildBoLargeTaxpayerRow(record);
    if ('skip' in result) {
      skipped[result.skip] += 1;
      continue;
    }
    if (seen.has(result.row.tax_id)) continue;
    seen.add(result.row.tax_id);
    rows.push(result.row);
  }
  return { rows, skipped };
}
