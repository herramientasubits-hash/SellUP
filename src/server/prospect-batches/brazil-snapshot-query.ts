/**
 * SOURCES-BR-LIGHT-1 — lecturas (INYECTADAS, SÓLO LECTURA) del CNPJ por nombre de
 * Brasil: SELECT acotados sobre `source_company_snapshots`.
 *
 *   - por nombre: registro (`br_receita_registry`) y alias (`br_receita_name_alias`)
 *     con `normalized_legal_name = <variante>`;
 *   - por dominio: `br_receita_domain_key` con `normalized_legal_name = '@etiqueta'`.
 *
 * Las dos las sirve el índice existente `(source_key, normalized_legal_name)`.
 * Nunca escribe; cualquier fallo degrada a `[]` (fail-soft).
 *
 * Client note: `source_company_snapshots` es sólo para `service_role`; el llamador
 * pasa un cliente de la factoría aprobada `createSupabaseAdminClient`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BrazilSnapshotReads,
  BrazilSnapshotRow,
} from '@/server/agents/prospect-intake/resolvers/brazil-official-source-resolver';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import {
  BR_RECEITA_DOMAIN_KEY_SOURCE_KEY,
  BR_RECEITA_NAME_ALIAS_SOURCE_KEY,
  BR_RECEITA_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/receita-brasil/br-receita-rows';

/** Tope de filas por consulta (homónimos y empresas del mismo grupo). */
export const BRAZIL_SNAPSHOT_QUERY_LIMIT = 30;

/** Procedencia del tamaño: el porte del cadastro CNPJ. */
export const BR_PORTE_SIZE_SOURCE = 'br_receita_porte' as const;

const SELECTED_COLUMNS = 'source_key, normalized_tax_id, legal_name, normalized_legal_name, raw_data, source_year';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** Fila leída → lo que usa el resolvedor. Exportada para las pruebas. */
export function toBrazilSnapshotRow(row: Record<string, unknown>): BrazilSnapshotRow {
  const raw = (row['raw_data'] && typeof row['raw_data'] === 'object' ? row['raw_data'] : {}) as Record<string, unknown>;
  const year = numberOrNull(row['source_year']);
  return {
    taxId: text(row['normalized_tax_id']),
    legalName: text(row['legal_name']),
    normalizedLegalName: text(row['normalized_legal_name']),
    registryCore: text(raw['alias_of']) ?? text(raw['domain_of']) ?? text(row['normalized_legal_name']),
    websiteDomain: text(raw['website_domain']),
    capital: numberOrNull(raw['capital_social']),
    activeBranches: numberOrNull(raw['active_branches']),
    cvmListed: raw['cvm_listed'] === true,
    publicEntity: raw['public_entity'] === true,
    workforce: workforceFromRawData(raw, BR_PORTE_SIZE_SOURCE, year !== null && Number.isInteger(year) ? year : null),
  };
}

async function readByKey(client: SupabaseClient, sourceKeys: readonly string[], key: string): Promise<BrazilSnapshotRow[]> {
  const value = typeof key === 'string' ? key.trim() : '';
  if (value.length === 0) return [];
  try {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select(SELECTED_COLUMNS)
      .in('source_key', [...sourceKeys])
      .eq('country_code', 'BR')
      .eq('normalized_legal_name', value)
      .limit(BRAZIL_SNAPSHOT_QUERY_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return (data as unknown as Record<string, unknown>[]).map(toBrazilSnapshotRow);
  } catch {
    return [];
  }
}

/** Adapta un cliente (de `service_role`) a las lecturas del CNPJ por nombre de Brasil. */
export function buildBrazilSnapshotReads(client: SupabaseClient): BrazilSnapshotReads {
  return {
    byName: (core) => readByKey(client, [BR_RECEITA_REGISTRY_SOURCE_KEY, BR_RECEITA_NAME_ALIAS_SOURCE_KEY], core),
    byDomainKey: (key) => readByKey(client, [BR_RECEITA_DOMAIN_KEY_SOURCE_KEY], key),
  };
}
