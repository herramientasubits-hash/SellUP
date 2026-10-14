/**
 * us-free-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Estados Unidos.
 *
 * SOURCES-US-CLOSE-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `us_free_directory` + `us_public_entities` / `US` y a la macro pedida, ordenado por relevancia
 * (`priority_score`) y, en los empates, por EIN y razón social para que dos
 * corridas idénticas lean las mismas filas.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { US_FREE_DIRECTORY_SOURCE_KEY } from '@/server/source-catalog/connectors/us-ein/us-free-directory-rows';
import { US_PUBLIC_ENTITIES_SOURCE_KEY } from '@/server/source-catalog/connectors/us-ein/us-public-entities';
import type {
  UsFreeDirectoryDiscoveryReads,
  UsFreeDirectorySnapshotReadRow,
} from './us-free-directory-discovery-adapter';

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

function toRow(row: SnapshotSelectRow): UsFreeDirectorySnapshotReadRow {
  const raw = row.raw_data ?? {};
  return {
    record_identity_key: row.record_identity_key,
    ein: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    directory_kind: text(raw['directory_kind']),
    activity_system: text(raw['activity_system']),
    activity_code: text(raw['activity_code']),
    activity_text: text(raw['activity_text']),
    size_band: text(raw['size_band']),
    size_source: text(raw['size_source']),
    website_domain: text(raw['website_domain']),
    priority_score: toNumber(row.priority_score),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Estados Unidos. */
export function buildUsFreeDirectoryDiscoveryReads(client: SupabaseClient): UsFreeDirectoryDiscoveryReads {
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .in('source_key', [US_FREE_DIRECTORY_SOURCE_KEY, US_PUBLIC_ENTITIES_SOURCE_KEY])
          .eq('country_code', 'US')
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .order('priority_score', { ascending: false })
          .order('normalized_tax_id', { ascending: true })
          .order('legal_name', { ascending: true })
          .limit(limit);
        if (error || !Array.isArray(data)) return [];
        return (data as unknown as SnapshotSelectRow[]).map(toRow);
      } catch {
        return [];
      }
    },
  };
}
