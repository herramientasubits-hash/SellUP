/**
 * spain-snapshot-query.ts — la lectura (SÓLO LECTURA) del NIF por nombre de España.
 *
 * SOURCES-ES-CLOSE-1. Un único SELECT acotado sobre `source_company_snapshots`:
 * los dos registros de NIF y sus alias, país ES, núcleo exacto. Nunca escribe.
 * Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  SpainNameQuery,
  SpainNameRow,
} from '@/server/agents/prospect-intake/resolvers/spain-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  ES_NIF_NAME_ALIAS_SOURCE_KEY,
  ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY,
  ES_PLACSP_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/placsp-spain/es-sources-rows';

/** Tope de filas por consulta (homónimos, más los alias de cada uno). */
export const SPAIN_NAME_QUERY_LIMIT = 20;

/** Procedencia del tamaño: plantilla de INVENTE o «GRAN EMPRESA» de la BDNS. */
export const ES_INVENTE_SIZE_SOURCE = 'es_invente_workforce' as const;
export const ES_BDNS_SIZE_SOURCE = 'es_bdns_large_company' as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sizeSource(raw: unknown): string {
  return raw && typeof raw === 'object' && (raw as Record<string, unknown>)['workers'] !== undefined
    ? ES_INVENTE_SIZE_SOURCE
    : ES_BDNS_SIZE_SOURCE;
}

/** Adapta un cliente (de `service_role`) a la lectura de nombres de España. */
export function buildSpainSnapshotNameQuery(client: SupabaseClient): SpainNameQuery {
  return async (core) => {
    const key = typeof core === 'string' ? core.trim() : '';
    if (key.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data')
        .in('source_key', [ES_PLACSP_REGISTRY_SOURCE_KEY, ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY, ES_NIF_NAME_ALIAS_SOURCE_KEY])
        .eq('country_code', 'ES')
        .eq('normalized_legal_name', key)
        .limit(SPAIN_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(
        (row): SpainNameRow => ({
          taxId: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
          sourceKey: row['source_key'] === ES_NIF_NAME_ALIAS_SOURCE_KEY ? null : text(row['source_key']),
          workforce: workforceFromRawData(row['raw_data'], sizeSource(row['raw_data'])),
          alias: row['source_key'] === ES_NIF_NAME_ALIAS_SOURCE_KEY,
        }),
      );
    } catch {
      return [];
    }
  };
}
