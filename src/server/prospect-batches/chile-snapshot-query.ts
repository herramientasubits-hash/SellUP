/**
 * SOURCES-CL-NAME-ALIAS-1 — lectura (INYECTADA, SÓLO LECTURA) del RUT por nombre de
 * Chile: un SELECT acotado sobre `source_company_snapshots`, a la vez en el registro
 * del SII (`cl_sii_registry`) y en sus alias (`cl_sii_name_alias`), con
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
  ChileNameQuery,
  ChileNameRow,
} from '@/server/agents/prospect-intake/resolvers/chile-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import { CL_SII_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/sii-chile/cl-sii-registry-rows';
import { CL_SII_NAME_ALIAS_SOURCE_KEY } from '@/server/source-catalog/connectors/sii-chile/cl-sii-name-alias-rows';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const CHILE_NAME_QUERY_LIMIT = 20;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Chile. */
export function buildChileSnapshotNameQuery(client: SupabaseClient): ChileNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data, source_year')
        .in('source_key', [CL_SII_REGISTRY_SOURCE_KEY, CL_SII_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'CL')
        .eq('normalized_legal_name', key)
        .limit(CHILE_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map((row): ChileNameRow => {
        const sourceYear = typeof row['source_year'] === 'number' ? (row['source_year'] as number) : null;
        return {
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          workforce: workforceFromRawData(row['raw_data'], CL_SII_REGISTRY_SOURCE_KEY, sourceYear),
          alias: row['source_key'] === CL_SII_NAME_ALIAS_SOURCE_KEY,
        };
      });
    } catch {
      return [];
    }
  };
}
