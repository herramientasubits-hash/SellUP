/**
 * SOURCES-HN-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) del RTN por nombre de
 * Honduras: un SELECT acotado sobre `source_company_snapshots`, a la vez en el
 * registro (`hn_ocds_rtn_registry`) y en sus alias (`hn_rtn_name_alias`), con
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
  HondurasNameQuery,
  HondurasNameRow,
} from '@/server/agents/prospect-intake/resolvers/honduras-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  HN_OCDS_RTN_SOURCE_KEY,
  HN_RTN_NAME_ALIAS_SOURCE_KEY,
} from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-sources-rows';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const HONDURAS_NAME_QUERY_LIMIT = 20;

/** Procedencia del tramo declarado (la marca «*MIPYME*» de HonduCompras). */
export const HN_DECLARED_SIZE_SOURCE = 'hn_honducompras_mipyme' as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Honduras. */
export function buildHondurasSnapshotNameQuery(client: SupabaseClient): HondurasNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data')
        .in('source_key', [HN_OCDS_RTN_SOURCE_KEY, HN_RTN_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'HN')
        .eq('normalized_legal_name', key)
        .limit(HONDURAS_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(
        (row): HondurasNameRow => ({
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          workforce: workforceFromRawData(row['raw_data'], HN_DECLARED_SIZE_SOURCE),
          alias: row['source_key'] === HN_RTN_NAME_ALIAS_SOURCE_KEY,
        }),
      );
    } catch {
      return [];
    }
  };
}
