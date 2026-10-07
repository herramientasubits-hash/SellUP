/**
 * hn-honducompras-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Honduras.
 *
 * SOURCES-HN-CLOSE-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `hn_honducompras_directory` + `hn_public_entities` / `HN` y a la macro pedida
 * (las entidades públicas sólo tienen Gobierno), ordenado por relevancia
 * (`priority_score`) y, en los empates, por identidad para que dos corridas
 * idénticas lean las mismas filas.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY,
  HN_PUBLIC_ENTITIES_SOURCE_KEY,
} from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-sources-rows';
import type {
  HnHonducomprasDirectoryDiscoveryReads,
  HnHonducomprasDirectorySnapshotReadRow,
} from './hn-honducompras-directory-discovery-adapter';

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

function toRow(row: SnapshotSelectRow): HnHonducomprasDirectorySnapshotReadRow {
  return {
    record_identity_key: row.record_identity_key,
    rtn: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    directory_kind: text(row.raw_data?.['directory_kind']),
    activity_code: text(row.raw_data?.['activity_code']),
    website_domain: text(row.raw_data?.['website_domain']),
    awarded_hnl: toNumber(row.raw_data?.['awarded_hnl']),
    last_award_year: toNumber(row.raw_data?.['last_award_year']),
    priority_score: toNumber(row.priority_score),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Honduras. */
export function buildHnHonducomprasDirectoryDiscoveryReads(client: SupabaseClient): HnHonducomprasDirectoryDiscoveryReads {
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .in('source_key', [HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY, HN_PUBLIC_ENTITIES_SOURCE_KEY])
          .eq('country_code', 'HN')
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .order('priority_score', { ascending: false })
          .order('record_identity_key', { ascending: true })
          .limit(limit);
        if (error || !Array.isArray(data)) return [];
        return (data as unknown as SnapshotSelectRow[]).map(toRow);
      } catch {
        return [];
      }
    },
  };
}
