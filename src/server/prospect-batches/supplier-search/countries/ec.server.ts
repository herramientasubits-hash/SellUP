/**
 * Ecuador — gancho de servidor de «Proveedores de una empresa»: la industria del
 * proveedor por su ACTIVIDAD oficial (CIIU 4.0 INEC) desde las fichas ya cargadas en
 * `source_company_snapshots` (sólo service_role, sólo lectura).
 *
 * Orden de autoridad (la primera fuente con una macro gana):
 *   1. `ec_scvs_registry` — ranking de compañías de la Superintendencia (CIIU de la SCVS).
 *   2. `ec_scvs_directory` — el mismo CIIU en el directorio gratuito.
 *   3. `ec_sri_registry` — catastro del SRI (mismo CIIU, sin punto).
 *   4. `latam_curated_directory` — la macro ya decidida por su tabla aprobada.
 * Un CIIU sin macro en la tabla aprobada (hoteles, medios, educación…) deja al
 * proveedor SIN industria: no se ofrece.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import { ecActivityMacro } from './ec';
import type { LoadedCountryServerHooks } from './loaded-lookups.server';

export const EC_ACTIVITY_SOURCE_KEYS = ['ec_scvs_registry', 'ec_scvs_directory', 'ec_sri_registry', 'latam_curated_directory'] as const;

type ActivityRow = { tax_id: string | null; source_key: string; ciiu: string | null; macro: string | null };

const KNOWN_MACROS: ReadonlySet<string> = new Set(MACRO_INDUSTRY_KEYS);

/** Macro de una fila de ficha (CIIU por la tabla aprobada; la curada trae la suya). */
export function ecRowMacro(row: Pick<ActivityRow, 'source_key' | 'ciiu' | 'macro'>): string | null {
  if (row.source_key === 'latam_curated_directory') return row.macro && KNOWN_MACROS.has(row.macro) ? row.macro : null;
  return ecActivityMacro(row.ciiu);
}

/** Por RUC, la macro de la fuente más autorizada que tenga una. */
export function ecMacroByTaxId(rows: readonly ActivityRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const sourceKey of EC_ACTIVITY_SOURCE_KEYS) {
    for (const row of rows) {
      if (row.source_key !== sourceKey || !row.tax_id || out.has(row.tax_id)) continue;
      const macro = ecRowMacro(row);
      if (macro) out.set(row.tax_id, macro);
    }
  }
  return out;
}

export const EC_SERVER_HOOKS: LoadedCountryServerHooks = {
  activityMacroByTaxId: async (serviceClient: SupabaseClient, taxIds) => {
    if (taxIds.length === 0) return new Map();
    const { data, error } = await serviceClient
      .from('source_company_snapshots')
      .select('tax_id, source_key, ciiu:raw_data->>ciiu_code, macro:raw_data->>macro_industry_key')
      .eq('country_code', 'EC')
      .in('source_key', [...EC_ACTIVITY_SOURCE_KEYS])
      .in('tax_id', [...taxIds]);
    if (error) {
      console.error('[supplier-public-buyer:EC] activity:', error.message);
      return new Map();
    }
    return ecMacroByTaxId((data ?? []) as unknown as ActivityRow[]);
  },
};
