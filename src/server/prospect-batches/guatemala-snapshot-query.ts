/**
 * SOURCES-GT-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) del NIT por nombre de
 * Guatemala: un SELECT acotado sobre `source_company_snapshots`, a la vez en el
 * registro unido (`gt_nit_registry`) y en sus alias (`gt_nit_name_alias`), con
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
  GuatemalaNameQuery,
  GuatemalaNameRow,
} from '@/server/agents/prospect-intake/resolvers/guatemala-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  GT_NIT_NAME_ALIAS_SOURCE_KEY,
  GT_NIT_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/gt-guatecompras/gt-sources-rows';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const GUATEMALA_NAME_QUERY_LIMIT = 20;

/** Procedencia del tramo «grande» (listado de agentes de retención del IVA de la SAT). */
export const GT_IVA_AGENT_SIZE_SOURCE = 'gt_sat_iva_agent' as const;

/** Año del listado de la SAT cargado (01-04-2026) si la fila no trae su fecha. */
const GT_IVA_AGENT_LIST_YEAR = 2026;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Guatemala. */
export function buildGuatemalaSnapshotNameQuery(client: SupabaseClient): GuatemalaNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data')
        .in('source_key', [GT_NIT_REGISTRY_SOURCE_KEY, GT_NIT_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'GT')
        .eq('normalized_legal_name', key)
        .limit(GUATEMALA_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(
        (row): GuatemalaNameRow => ({
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          workforce: workforceFromRawData(row['raw_data'], GT_IVA_AGENT_SIZE_SOURCE, GT_IVA_AGENT_LIST_YEAR),
          alias: row['source_key'] === GT_NIT_NAME_ALIAS_SOURCE_KEY,
        }),
      );
    } catch {
      return [];
    }
  };
}
