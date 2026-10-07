/**
 * SOURCES-PY-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) del RUC por nombre de
 * Paraguay: un SELECT acotado sobre `source_company_snapshots`, a la vez en el
 * padrón (`py_set_registry`) y en sus alias (`py_set_name_alias`), con
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
  ParaguayNameQuery,
  ParaguayNameRow,
} from '@/server/agents/prospect-intake/resolvers/paraguay-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  PY_SET_NAME_ALIAS_SOURCE_KEY,
  PY_SET_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/set-paraguay/py-set-registry-row';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const PARAGUAY_NAME_QUERY_LIMIT = 20;

/** Procedencia del tamaño declarado (la DNCP, no el padrón de la DNIT). */
export const PY_DECLARED_SIZE_SOURCE = 'py_dncp_mipyme_size' as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Paraguay. */
export function buildParaguaySnapshotNameQuery(client: SupabaseClient): ParaguayNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data, source_year')
        .in('source_key', [PY_SET_REGISTRY_SOURCE_KEY, PY_SET_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'PY')
        .eq('normalized_legal_name', key)
        .limit(PARAGUAY_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(
        (row): ParaguayNameRow => ({
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          workforce: workforceFromRawData(row['raw_data'], PY_DECLARED_SIZE_SOURCE),
          alias: row['source_key'] === PY_SET_NAME_ALIAS_SOURCE_KEY,
        }),
      );
    } catch {
      return [];
    }
  };
}
