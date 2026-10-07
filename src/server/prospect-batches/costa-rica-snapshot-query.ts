/**
 * SOURCES-CR-CLOSE-1 — lectura (INYECTADA, SÓLO LECTURA) de la cédula jurídica
 * por nombre de Costa Rica: un SELECT acotado sobre `source_company_snapshots`, a
 * la vez en el registro (`cr_company_registry`) y en sus alias
 * (`cr_company_name_alias`), con `normalized_legal_name = <variante>` (el
 * resolvedor pide una variante cada vez y para en la primera que encuentra algo).
 * Lo sirve el índice existente `(source_key, normalized_legal_name)`. Nunca
 * escribe; cualquier fallo degrada a `[]` (fail-soft).
 *
 * Client note: `source_company_snapshots` es sólo para `service_role`; el llamador
 * pasa un cliente de la factoría aprobada `createSupabaseAdminClient`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CostaRicaNameQuery,
  CostaRicaNameRow,
} from '@/server/agents/prospect-intake/resolvers/costa-rica-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  CR_COMPANY_NAME_ALIAS_SOURCE_KEY,
  CR_COMPANY_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/cr-registry/cr-company-registry-rows';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const COSTA_RICA_NAME_QUERY_LIMIT = 20;

/** Procedencia del tramo PYME (el MEIC, no el registro combinado). */
export const CR_MEIC_SIZE_SOURCE = 'cr_meic_pymes' as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de Costa Rica. */
export function buildCostaRicaSnapshotNameQuery(client: SupabaseClient): CostaRicaNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data, source_year')
        .in('source_key', [CR_COMPANY_REGISTRY_SOURCE_KEY, CR_COMPANY_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'CR')
        .eq('normalized_legal_name', key)
        .limit(COSTA_RICA_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(
        (row): CostaRicaNameRow => ({
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          workforce: workforceFromRawData(row['raw_data'], CR_MEIC_SIZE_SOURCE),
          alias: row['source_key'] === CR_COMPANY_NAME_ALIAS_SOURCE_KEY,
        }),
      );
    } catch {
      return [];
    }
  };
}
