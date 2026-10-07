/**
 * pa-free-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Panamá.
 *
 * SOURCES-PA-CLOSE-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `pa_free_directory` / `PA` y a la macro pedida, ordenado por relevancia
 * (`priority_score`: Grandes Contribuyentes y entidades públicas, después
 * entidades a las que vende) y, en los empates, por RUC para que dos corridas
 * idénticas lean las mismas filas.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PaFreeDirectoryDiscoveryReads,
  PaFreeDirectorySnapshotReadRow,
} from './pa-free-directory-discovery-adapter';

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

function toRow(row: SnapshotSelectRow): PaFreeDirectorySnapshotReadRow {
  return {
    record_identity_key: row.record_identity_key,
    ruc: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    directory_kind: text(row.raw_data?.['directory_kind']),
    activity_code: text(row.raw_data?.['activity_code']),
    public_entity_area: text(row.raw_data?.['public_entity_area']),
    website_domain: text(row.raw_data?.['website_domain']),
    official_size_band: text(row.raw_data?.['official_size_band']),
    priority_score: toNumber(row.priority_score),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Panamá. */
export function buildPaFreeDirectoryDiscoveryReads(client: SupabaseClient): PaFreeDirectoryDiscoveryReads {
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .eq('source_key', 'pa_free_directory')
          .eq('country_code', 'PA')
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .order('priority_score', { ascending: false })
          .order('normalized_tax_id', { ascending: true })
          .limit(limit);
        if (error || !Array.isArray(data)) return [];
        return (data as unknown as SnapshotSelectRow[]).map(toRow);
      } catch {
        return [];
      }
    },
  };
}
