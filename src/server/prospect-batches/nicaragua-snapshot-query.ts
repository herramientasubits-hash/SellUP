/**
 * SOURCES-NI-CLOSE-2 — lectura (INYECTADA, SÓLO LECTURA) del RUC por nombre de
 * Nicaragua: un SELECT acotado sobre `source_company_snapshots`, a la vez en el
 * registro unido (`ni_ruc_registry`) y en sus alias (`ni_ruc_name_alias`), con
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
  NicaraguaNameQuery,
  NicaraguaNameRow,
} from '@/server/agents/prospect-intake/resolvers/nicaragua-official-source-resolver';
import {
  NI_LARGE_TAXPAYER_LIST_YEAR,
  NI_RUC_NAME_ALIAS_SOURCE_KEY,
  NI_RUC_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/ni-sources/ni-sources-rows';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const NICARAGUA_NAME_QUERY_LIMIT = 20;

/** Procedencia del tramo «gran contribuyente» (la lista de la DGI). */
export const NI_DGI_LARGE_TAXPAYER_SOURCE = 'ni_dgi_large_taxpayers' as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Fila de la tabla → fila del resolvedor. */
export function toNicaraguaNameRow(row: Record<string, unknown>): NicaraguaNameRow {
  return {
    taxId: text(row['normalized_tax_id']),
    legalName: text(row['legal_name']),
    normalizedLegalName: text(row['normalized_legal_name']),
    workforce: workforceFromRawData(row['raw_data'], NI_DGI_LARGE_TAXPAYER_SOURCE, NI_LARGE_TAXPAYER_LIST_YEAR),
    alias: row['source_key'] === NI_RUC_NAME_ALIAS_SOURCE_KEY,
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Nicaragua. */
export function buildNicaraguaSnapshotNameQuery(client: SupabaseClient): NicaraguaNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data')
        .in('source_key', [NI_RUC_REGISTRY_SOURCE_KEY, NI_RUC_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'NI')
        .eq('normalized_legal_name', key)
        .limit(NICARAGUA_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(toNicaraguaNameRow);
    } catch {
      return [];
    }
  };
}
