/**
 * SOURCES-UY-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) del RUT por nombre de
 * Uruguay: un SELECT acotado sobre `source_company_snapshots`, a la vez en el RUPE
 * (`uy_rupe_registry`) y en sus alias (`uy_rupe_name_alias`), con
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
  UruguayNameQuery,
  UruguayNameRow,
} from '@/server/agents/prospect-intake/resolvers/uruguay-official-source-resolver';
import {
  UY_RUPE_NAME_ALIAS_SOURCE_KEY,
  UY_RUPE_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/rupe-uruguay/uy-rupe-registry-row';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const URUGUAY_NAME_QUERY_LIMIT = 20;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Uruguay. */
export function buildUruguaySnapshotNameQuery(client: SupabaseClient): UruguayNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data')
        .in('source_key', [UY_RUPE_REGISTRY_SOURCE_KEY, UY_RUPE_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'UY')
        .eq('normalized_legal_name', key)
        .limit(URUGUAY_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map((row): UruguayNameRow => {
        const raw = row['raw_data'];
        const state = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>)['rupe_state'] : null;
        return {
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          rupeState: text(state),
          alias: row['source_key'] === UY_RUPE_NAME_ALIAS_SOURCE_KEY,
        };
      });
    } catch {
      return [];
    }
  };
}
