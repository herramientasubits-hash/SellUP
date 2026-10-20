/**
 * ve-free-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Venezuela.
 *
 * SOURCES-VE-CLOSE-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `ve_free_directory` + `ve_free_directory_web` / `VE` y a la macro pedida,
 * ordenado por relevancia (`priority_score`) y, en los empates, por la identidad
 * del registro para que dos corridas idénticas lean las mismas filas.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildReadKnownSnapshotIdentities,
  readFreshSnapshotWindow,
  snapshotWebsiteDomain,
} from './country-source-fresh-window';
import {
  VE_FREE_DIRECTORY_SOURCE_KEY,
  VE_FREE_DIRECTORY_WEB_SOURCE_KEY,
} from '@/server/source-catalog/connectors/ve-sources/ve-sources-rows';
import type {
  VeFreeDirectoryDiscoveryReads,
  VeFreeDirectorySnapshotReadRow,
} from './ve-free-directory-discovery-adapter';

type SnapshotSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  priority_score: number | string | null;
  raw_data: Record<string, unknown> | null;
};

const SELECTED_COLUMNS =
  'record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, city, region, priority_score, raw_data';

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Fila de la tabla → fila de la proyección. */
export function toVeFreeDirectoryReadRow(row: SnapshotSelectRow): VeFreeDirectorySnapshotReadRow {
  return {
    record_identity_key: row.record_identity_key,
    rif: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    directory_kind: text(row.raw_data?.['directory_kind']),
    activity_code: text(row.raw_data?.['activity_code']),
    public_entity_kind: text(row.raw_data?.['public_entity_kind']),
    website_domain: text(row.raw_data?.['website_domain']),
    workers: toNumber(row.raw_data?.['workers']),
    metrics_year: toNumber(row.raw_data?.['metrics_year']),
    workforce_source: text(row.raw_data?.['workforce_source']),
    official_size_band: text(row.raw_data?.['official_size_band']),
    priority_score: toNumber(row.priority_score),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Venezuela. */
export function buildVeFreeDirectoryDiscoveryReads(client: SupabaseClient): VeFreeDirectoryDiscoveryReads {
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        // AUDIT-A1-WS7 — por páginas y saltando lo que SellUp ya conoce: la ventana
        // fija de siempre se agotaba tras la primera corrida (ver country-source-fresh-window.ts).
        const rows = await readFreshSnapshotWindow<SnapshotSelectRow>({
          size: limit,
          countryCode: 'VE',
          readKnown: buildReadKnownSnapshotIdentities(client),
          taxIdOf: (row) => row.normalized_tax_id,
          domainOf: (row) => snapshotWebsiteDomain(row.raw_data),
          readRange: async (from, to) => {
            const query = client
              .from('source_company_snapshots')
              .select(SELECTED_COLUMNS)
              .in('source_key', [VE_FREE_DIRECTORY_SOURCE_KEY, VE_FREE_DIRECTORY_WEB_SOURCE_KEY])
              .eq('country_code', 'VE')
              .eq('raw_data->>macro_industry_key', macroIndustryKey)
              .order('priority_score', { ascending: false })
              .order('record_identity_key', { ascending: true });
            const { data, error } = await (from === 0 ? query.limit(limit) : query.range(from, to));
            if (error || !Array.isArray(data)) throw new Error('snapshot_read_failed');
            return data as unknown as SnapshotSelectRow[];
          },
        });
        return rows.map(toVeFreeDirectoryReadRow);
      } catch {
        return [];
      }
    },
  };
}
