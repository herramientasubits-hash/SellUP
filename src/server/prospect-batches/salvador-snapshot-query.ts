/**
 * SOURCES-SV-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) del NIT por nombre de El
 * Salvador: un SELECT acotado sobre `source_company_snapshots`, a la vez en el
 * registro unido (`sv_nit_registry`) y en sus alias (`sv_nit_name_alias`), con
 * `normalized_legal_name = <variante>` (el resolvedor pide una variante cada vez y
 * para en la primera que encuentra algo). Lo sirve el índice existente
 * `(source_key, normalized_legal_name)`. Nunca escribe; cualquier fallo degrada a
 * `[]` (fail-soft).
 *
 * Client note: `source_company_snapshots` es sólo para `service_role`; el llamador
 * pasa un cliente de la factoría aprobada `createSupabaseAdminClient`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  SalvadorNameQuery,
  SalvadorNameRow,
} from '@/server/agents/prospect-intake/resolvers/salvador-official-source-resolver';
import {
  SV_NIT_NAME_ALIAS_SOURCE_KEY,
  SV_NIT_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/sv-official-sources/sv-sources-rows';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const SALVADOR_NAME_QUERY_LIMIT = 20;

/** Procedencia del tramo «gran / mediano contribuyente» (listados de Hacienda 2019 y 2012). */
export const SV_HACIENDA_TAXPAYER_CATEGORY_SOURCE = 'sv_hacienda_taxpayer_lists' as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de El Salvador. */
export function buildSalvadorSnapshotNameQuery(client: SupabaseClient): SalvadorNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data, source_year')
        .in('source_key', [SV_NIT_REGISTRY_SOURCE_KEY, SV_NIT_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'SV')
        .eq('normalized_legal_name', key)
        .limit(SALVADOR_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(
        (row): SalvadorNameRow => ({
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          workforce: workforceFromRawData(row['raw_data'], SV_HACIENDA_TAXPAYER_CATEGORY_SOURCE),
          alias: row['source_key'] === SV_NIT_NAME_ALIAS_SOURCE_KEY,
        }),
      );
    } catch {
      return [];
    }
  };
}
