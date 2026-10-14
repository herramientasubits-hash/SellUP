/**
 * SOURCES-VE-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) del RIF por nombre de
 * Venezuela: un SELECT acotado sobre `source_company_snapshots`, a la vez en el
 * registro unido (`ve_rif_registry`) y en sus alias (`ve_rif_name_alias`), con
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
  VenezuelaNameQuery,
  VenezuelaNameRow,
} from '@/server/agents/prospect-intake/resolvers/venezuela-official-source-resolver';
import {
  VE_RIF_NAME_ALIAS_SOURCE_KEY,
  VE_RIF_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/ve-sources/ve-sources-rows';
import { VE_WORKFORCE_SOURCE_LABEL, type VeWorkforceSource } from '@/server/source-catalog/connectors/ve-sources/ve-official-workforce';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const VENEZUELA_NAME_QUERY_LIMIT = 20;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Etiqueta de la fuente de los trabajadores guardada en la fila. */
function veWorkforceSourceLabel(raw: unknown): string {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['workforce_source'] : null;
  return VE_WORKFORCE_SOURCE_LABEL[source as VeWorkforceSource] ?? 'Venezuela';
}

/** Fila de la tabla → fila del resolvedor. */
export function toVenezuelaNameRow(row: Record<string, unknown>): VenezuelaNameRow {
  return {
    taxId: text(row['normalized_tax_id']),
    legalName: text(row['legal_name']),
    normalizedLegalName: text(row['normalized_legal_name']),
    workforce: workforceFromRawData(row['raw_data'], veWorkforceSourceLabel(row['raw_data'])),
    alias: row['source_key'] === VE_RIF_NAME_ALIAS_SOURCE_KEY,
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Venezuela. */
export function buildVenezuelaSnapshotNameQuery(client: SupabaseClient): VenezuelaNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data')
        .in('source_key', [VE_RIF_REGISTRY_SOURCE_KEY, VE_RIF_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'VE')
        .eq('normalized_legal_name', key)
        .limit(VENEZUELA_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(toVenezuelaNameRow);
    } catch {
      return [];
    }
  };
}
