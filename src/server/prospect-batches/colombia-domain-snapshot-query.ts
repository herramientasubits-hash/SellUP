/**
 * colombia-domain-snapshot-query.ts — lectura web → filas oficiales de Colombia.
 *
 * SOURCES-CO-CLOSE-1. Un `SELECT … LIMIT` sobre `source_company_snapshots`,
 * filtrado a las dos fuentes con web cargada (`co_public_entities`, `co_siis`) y a
 * las llaves del dominio de la candidata. No hay escritura posible; cualquier
 * error ⇒ `[]` (la candidata sigue sin NIT, como antes).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CoDomainQuery,
  CoDomainRow,
} from '@/server/agents/prospect-intake/resolvers/colombia-domain-official-source-resolver';
import { workforceFromRawData } from './snapshot-name-query';

/** Fuentes de Colombia con `raw_data.website_domain`. */
export const CO_DOMAIN_SOURCE_KEYS = ['co_public_entities', 'co_siis'] as const;

/**
 * Servidores mínimos para que el SIGEP viaje como tamaño. El SIGEP cuenta sólo
 * servidores de planta y para algunas entidades reporta cifras incompletas
 * (06-10-2026: IDARTES 1, IDIGER 1, Idipron 2): por debajo del corte ICP de
 * micro/pequeña (50) el número no es fiable y descartaría entidades grandes. Así
 * el SIGEP nunca descarta: sólo informa el tamaño cuando ya es al menos mediano.
 */
export const CO_PUBLIC_ENTITY_MIN_TRUSTED_WORKERS = 50;

/** Techo de filas por consulta (una web la comparten pocas entidades). */
export const CO_DOMAIN_QUERY_LIMIT = 20;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

type SelectRow = {
  source_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  source_year: number | null;
  raw_data: Record<string, unknown> | null;
};

/** Adapta un cliente (de `service_role`) a la lectura por web. */
export function buildColombiaDomainSnapshotQuery(client: SupabaseClient): CoDomainQuery {
  return async (domains: readonly string[]): Promise<CoDomainRow[]> => {
    const keys = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0))];
    if (keys.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('source_key, normalized_tax_id, legal_name, source_year, raw_data')
        .in('source_key', [...CO_DOMAIN_SOURCE_KEYS])
        .eq('country_code', 'CO')
        .in('raw_data->>website_domain', keys)
        .limit(CO_DOMAIN_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as SelectRow[]).map((row): CoDomainRow => {
        const raw = row.raw_data ?? {};
        const official =
          row.source_key === 'co_public_entities' ? workforceFromRawData(raw, row.source_key, row.source_year) : null;
        const workforce = official !== null && official.workers >= CO_PUBLIC_ENTITY_MIN_TRUSTED_WORKERS ? official : null;
        return {
          sourceKey: row.source_key,
          taxId: text(row.normalized_tax_id),
          legalName: text(row.legal_name),
          websiteDomain: text(raw['website_domain'])?.toLowerCase() ?? null,
          entityHead: raw['entity_head'] === true,
          ...(workforce ? { workforce } : {}),
        };
      });
    } catch {
      return [];
    }
  };
}
