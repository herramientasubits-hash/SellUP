/**
 * SOURCES-PA-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) del RUC por nombre de
 * Panamá: un SELECT acotado sobre `source_company_snapshots`, a la vez en el
 * registro unido (`pa_ruc_registry`) y en sus alias (`pa_ruc_name_alias`), con
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
  PanamaNameQuery,
  PanamaNameRow,
} from '@/server/agents/prospect-intake/resolvers/panama-official-source-resolver';
import {
  PA_RUC_NAME_ALIAS_SOURCE_KEY,
  PA_RUC_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/panamacompra-pa/pa-sources-rows';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const PANAMA_NAME_QUERY_LIMIT = 20;

/** Procedencia del tramo «gran contribuyente» (la lista de la DGI). */
export const PA_DGI_LARGE_TAXPAYER_SOURCE = 'pa_dgi_large_taxpayers' as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Panamá. */
export function buildPanamaSnapshotNameQuery(client: SupabaseClient): PanamaNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data, source_year')
        .in('source_key', [PA_RUC_REGISTRY_SOURCE_KEY, PA_RUC_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'PA')
        .eq('normalized_legal_name', key)
        .limit(PANAMA_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(
        (row): PanamaNameRow => ({
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          workforce: workforceFromRawData(row['raw_data'], PA_DGI_LARGE_TAXPAYER_SOURCE),
          alias: row['source_key'] === PA_RUC_NAME_ALIAS_SOURCE_KEY,
        }),
      );
    } catch {
      return [];
    }
  };
}
