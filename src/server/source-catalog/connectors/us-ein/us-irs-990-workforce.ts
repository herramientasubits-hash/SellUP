/**
 * us-irs-990-workforce.ts — empleados oficiales de las organizaciones sin ánimo de
 * lucro de Estados Unidos, del extracto anual del Formulario 990 del IRS.
 *
 * SOURCES-US-SIZE-990-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * El IRS (SOI, «Annual Extract of Tax-Exempt Organization Financial Data»,
 * `24eoextract990.csv`, presentaciones de 2024) publica por EIN el número de
 * empleados declarado en el W-3 (`noemplyeesw3cnt`) y el periodo fiscal (`tax_pd`,
 * AAAAMM). Se guarda en `raw_data` como `workers` + `metrics_year`, la forma que ya
 * lee el filtro de tamaño (`workforceFromRawData` → `extractOfficialRegistryWorkforce`),
 * así que el tamaño llega a la ficha por el mismo camino que en los demás países.
 *
 * Sólo cuentan las organizaciones que presentan el 990 completo: las universidades
 * públicas y las agencias de Gobierno no lo presentan y siguen sin número.
 */

import { formatEin } from './us-ein-registry-rows';

/** Nombre corto de la fuente para la ficha. */
export const US_IRS_990_WORKFORCE_SOURCE_LABEL = 'IRS – Formulario 990';

export type UsIrs990Workforce = { workers: number; year: number };

/** Fila del extracto del 990 → EIN + empleados + año, o `null` (sin empleados declarados). */
export function parseIrs990WorkforceRecord(
  record: Record<string, string>,
): ({ ein: string } & UsIrs990Workforce) | null {
  const ein = formatEin(record['EIN']);
  const workers = Number((record['noemplyeesw3cnt'] ?? '').trim());
  const period = (record['tax_pd'] ?? '').trim();
  const year = /^\d{6}$/.test(period) ? Number(period.slice(0, 4)) : NaN;
  if (ein === null || !Number.isInteger(workers) || workers <= 0 || !Number.isInteger(year)) return null;
  return { ein, workers, year };
}

/**
 * Índice EIN → empleados. Si un EIN presentó más de un 990 en el extracto, manda
 * el del periodo más reciente.
 */
export function buildIrs990WorkforceIndex(
  records: Iterable<Record<string, string>>,
): ReadonlyMap<string, UsIrs990Workforce> {
  const index = new Map<string, UsIrs990Workforce>();
  for (const record of records) {
    const parsed = parseIrs990WorkforceRecord(record);
    if (parsed === null) continue;
    const current = index.get(parsed.ein);
    if (current === undefined || parsed.year > current.year) {
      index.set(parsed.ein, { workers: parsed.workers, year: parsed.year });
    }
  }
  return index;
}

type RowWithEin = { normalized_tax_id: string | null; raw_data: Record<string, unknown> };

/**
 * Pone los empleados del 990 en `raw_data` de las filas cuyo EIN aparece. Devuelve
 * filas NUEVAS (no modifica las recibidas) y cuántas lo ganaron.
 */
export function attachIrs990Workforce<T extends RowWithEin>(
  rows: readonly T[],
  index: ReadonlyMap<string, UsIrs990Workforce>,
): { rows: T[]; attached: number } {
  let attached = 0;
  const next = rows.map((row) => {
    const hit = row.normalized_tax_id !== null ? index.get(row.normalized_tax_id) : undefined;
    if (hit === undefined) return row;
    attached++;
    return {
      ...row,
      raw_data: {
        ...row.raw_data,
        workers: hit.workers,
        metrics_year: hit.year,
        workers_source: US_IRS_990_WORKFORCE_SOURCE_LABEL,
      },
    };
  });
  return { rows: next, attached };
}
