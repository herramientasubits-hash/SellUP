/**
 * Costa Rica — gancho de servidor de «Proveedores de una empresa»: la industria del
 * proveedor por su ACTIVIDAD oficial desde las fichas ya cargadas en
 * `source_company_snapshots` (sólo service_role, sólo lectura).
 *
 * Orden de autoridad (la primera fuente con una macro gana):
 *   1. `cr_company_registry` — CIIU del MEIC («7490 - …», ~83 % de las cédulas) con la
 *      tabla CIIU Rev. 4 aprobada para Costa Rica (`crActivityMacro`).
 *   2. `cr_free_directory` — la macro ya decidida por su tabla aprobada (UNSPSC de lo
 *      que ofertó en SICOP 2022-24, CAECR de Zona Franca, CICR).
 *   3. `latam_curated_directory` — la macro de su tabla aprobada.
 * Sin ninguna, el proveedor queda SIN industria y no se ofrece.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import { crActivityMacro } from './cr';
import type { LoadedCountryServerHooks } from './loaded-lookups.server';

export const CR_ACTIVITY_SOURCE_KEYS = ['cr_company_registry', 'cr_free_directory', 'latam_curated_directory'] as const;

type ActivityRow = { tax_id: string | null; source_key: string; ciiu: string | null; macro: string | null };

const KNOWN_MACROS: ReadonlySet<string> = new Set(MACRO_INDUSTRY_KEYS);

export function crRowMacro(row: Pick<ActivityRow, 'source_key' | 'ciiu' | 'macro'>): string | null {
  if (row.source_key === 'cr_company_registry') return crActivityMacro(row.ciiu);
  return row.macro && KNOWN_MACROS.has(row.macro) ? row.macro : null;
}

/** Por cédula, la macro de la fuente más autorizada que tenga una. */
export function crMacroByTaxId(rows: readonly ActivityRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const sourceKey of CR_ACTIVITY_SOURCE_KEYS) {
    for (const row of rows) {
      if (row.source_key !== sourceKey || !row.tax_id || out.has(row.tax_id)) continue;
      const macro = crRowMacro(row);
      if (macro) out.set(row.tax_id, macro);
    }
  }
  return out;
}

export const CR_SERVER_HOOKS: LoadedCountryServerHooks = {
  activityMacroByTaxId: async (serviceClient: SupabaseClient, taxIds) => {
    if (taxIds.length === 0) return new Map();
    const { data, error } = await serviceClient
      .from('source_company_snapshots')
      .select('tax_id, source_key, ciiu:raw_data->>ciiu, macro:raw_data->>macro_industry_key')
      .eq('country_code', 'CR')
      .in('source_key', [...CR_ACTIVITY_SOURCE_KEYS])
      .in('tax_id', [...taxIds]);
    if (error) {
      console.error('[supplier-public-buyer:CR] activity:', error.message);
      return new Map();
    }
    return crMacroByTaxId((data ?? []) as unknown as ActivityRow[]);
  },
};
