/**
 * SOURCES-PE-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) del RUC por nombre de
 * Perú: un SELECT acotado sobre `source_company_snapshots`, a la vez en el padrón
 * (`pe_sunat_registry`) y en sus alias (`pe_sunat_name_alias`), con
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
  PeruNameQuery,
  PeruNameRow,
} from '@/server/agents/prospect-intake/resolvers/peru-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import { PE_SUNAT_NAME_ALIAS_SOURCE_KEY } from '@/server/source-catalog/connectors/sunat-peru/pe-sunat-source-rows';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const PERU_NAME_QUERY_LIMIT = 20;

const PERU_REGISTRY_SOURCE_KEY = 'pe_sunat_registry';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Perú. */
export function buildPeruSnapshotNameQuery(client: SupabaseClient): PeruNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data, source_year')
        .in('source_key', [PERU_REGISTRY_SOURCE_KEY, PE_SUNAT_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'PE')
        .eq('normalized_legal_name', key)
        .limit(PERU_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map((row): PeruNameRow => {
        const sourceYear = typeof row['source_year'] === 'number' ? (row['source_year'] as number) : null;
        return {
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          workforce: workforceFromRawData(row['raw_data'], PERU_REGISTRY_SOURCE_KEY, sourceYear),
          alias: row['source_key'] === PE_SUNAT_NAME_ALIAS_SOURCE_KEY,
        };
      });
    } catch {
      return [];
    }
  };
}
