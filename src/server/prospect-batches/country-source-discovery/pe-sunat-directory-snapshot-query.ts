/**
 * pe-sunat-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Perú.
 *
 * SOURCES-PE-FREE-DISCOVERY-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `pe_sunat_directory` / `PE` y a la macro pedida, ordenado por trabajadores
 * (`priority_score`) y, en los empates, por RUC para que dos
 * corridas idénticas lean las mismas filas.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PeSunatDirectoryDiscoveryReads,
  PeSunatDirectorySnapshotReadRow,
} from './pe-sunat-directory-discovery-adapter';

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

function toInteger(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

function toRow(row: SnapshotSelectRow): PeSunatDirectorySnapshotReadRow {
  const code = row.raw_data?.['ciiu4_code'];
  const activity = row.raw_data?.['activity_text'];
  return {
    record_identity_key: row.record_identity_key,
    ruc: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    ciiu4_code: typeof code === 'string' ? code : null,
    activity_text: typeof activity === 'string' ? activity : null,
    employees: toInteger(row.raw_data?.['workers']),
    metrics_year: toInteger(row.raw_data?.['metrics_year']),
    priority_score: toNumber(row.priority_score),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Perú. */
export function buildPeSunatDirectoryDiscoveryReads(client: SupabaseClient): PeSunatDirectoryDiscoveryReads {
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .eq('source_key', 'pe_sunat_directory')
          .eq('country_code', 'PE')
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
