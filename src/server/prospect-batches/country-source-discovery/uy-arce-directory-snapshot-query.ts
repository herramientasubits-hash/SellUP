/**
 * uy-arce-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Uruguay.
 *
 * SOURCES-UY-CLOSE-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `uy_arce_directory` + `uy_public_entities` / `UY` y a la macro pedida, ordenado
 * por relevancia (`priority_score`) y, en los empates, por RUT y razón social para
 * que dos corridas idénticas lean las mismas filas.
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
import { UY_ARCE_DIRECTORY_SOURCE_KEY } from '@/server/source-catalog/connectors/rupe-uruguay/uy-arce-directory-row';
import { UY_PUBLIC_ENTITIES_SOURCE_KEY } from '@/server/source-catalog/connectors/rupe-uruguay/uy-public-entities';
import type {
  UyArceDirectoryDiscoveryReads,
  UyArceDirectorySnapshotReadRow,
} from './uy-arce-directory-discovery-adapter';

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

function toRow(row: SnapshotSelectRow): UyArceDirectorySnapshotReadRow {
  return {
    record_identity_key: row.record_identity_key,
    rut: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    directory_kind: text(row.raw_data?.['directory_kind']),
    sice_class: text(row.raw_data?.['sice_class']),
    activity_text: text(row.raw_data?.['activity_text']),
    website_domain: text(row.raw_data?.['website_domain']),
    official_workers: toNumber(row.raw_data?.['official_workers']),
    official_workers_year: toNumber(row.raw_data?.['official_workers_year']),
    priority_score: toNumber(row.priority_score),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Uruguay. */
export function buildUyArceDirectoryDiscoveryReads(client: SupabaseClient): UyArceDirectoryDiscoveryReads {
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        // AUDIT-A1-WS7 — por páginas y saltando lo que SellUp ya conoce: la ventana
        // fija de siempre se agotaba tras la primera corrida (ver country-source-fresh-window.ts).
        const rows = await readFreshSnapshotWindow<SnapshotSelectRow>({
          size: limit,
          countryCode: 'UY',
          readKnown: buildReadKnownSnapshotIdentities(client),
          taxIdOf: (row) => row.normalized_tax_id,
          domainOf: (row) => snapshotWebsiteDomain(row.raw_data),
          readRange: async (from, to) => {
            const query = client
              .from('source_company_snapshots')
              .select(SELECTED_COLUMNS)
              .in('source_key', [UY_ARCE_DIRECTORY_SOURCE_KEY, UY_PUBLIC_ENTITIES_SOURCE_KEY])
              .eq('country_code', 'UY')
              .eq('raw_data->>macro_industry_key', macroIndustryKey)
              .order('priority_score', { ascending: false })
              .order('normalized_tax_id', { ascending: true })
              .order('legal_name', { ascending: true });
            const { data, error } = await (from === 0 ? query.limit(limit) : query.range(from, to));
            if (error || !Array.isArray(data)) throw new Error('snapshot_read_failed');
            return data as unknown as SnapshotSelectRow[];
          },
        });
        return rows.map(toRow);
      } catch {
        return [];
      }
    },
  };
}
