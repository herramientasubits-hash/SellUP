/**
 * bo-official-discovery-snapshot-query.ts — las lecturas (SÓLO LECTURA) del
 * descubrimiento gratuito de Bolivia.
 *
 * SOURCES-BO-CLOSE-1.
 *
 * Dos SELECT acotados sobre `source_company_snapshots`, filtrados a la macro
 * pedida y ordenados por prioridad y, en los empates, por la clave del registro
 * para que dos corridas idénticas lean las mismas filas:
 *   - `bo_large_taxpayers` (sólo matrícula renovada), con lo que SellUp ya vio de
 *     cada NIT (`readCountrySourcePriorSightings`, el módulo común de Ecuador);
 *   - `bo_public_entities`.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BoLargeTaxpayerReadRow,
  BoOfficialDiscoveryReads,
  BoPublicEntityReadRow,
} from './bo-official-discovery-adapter';
import { readCountrySourcePriorSightings } from './country-source-prior-sightings';

type SnapshotSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  department: string | null;
  priority_score: number | string | null;
  raw_data: Record<string, unknown> | null;
};

const SELECTED_COLUMNS =
  'record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, city, department, priority_score, raw_data';

/**
 * Se leen más filas de las pedidas: parte de ellas ya están en SellUp o la tabla
 * de hoy las clasifica en otra macro (mismo factor que Ecuador).
 */
export const BO_DISCOVERY_READ_OVERSAMPLE = 3;
/** Techo de filas leídas por consulta. */
export const BO_DISCOVERY_READ_CAP = 600;

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toTaxpayer(row: SnapshotSelectRow): BoLargeTaxpayerReadRow {
  return {
    record_identity_key: row.record_identity_key,
    nit: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    department: row.department,
    social_purpose: text(row.raw_data?.['social_purpose']),
    matricula_renewed: row.raw_data?.['matricula_renewed'] === true,
    taxpayer_category: text(row.raw_data?.['taxpayer_category']),
    priority_score: toNumber(row.priority_score),
  };
}

function toEntity(row: SnapshotSelectRow): BoPublicEntityReadRow {
  return {
    record_identity_key: row.record_identity_key,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    department: row.department,
    entity_kind: text(row.raw_data?.['entity_kind']),
    website_domain: text(row.raw_data?.['website_domain']),
    macro_industry_key: text(row.raw_data?.['macro_industry_key']),
  };
}

/** Adapta un cliente (de `service_role`) a las lecturas de descubrimiento de Bolivia. */
export function buildBoOfficialDiscoveryReads(client: SupabaseClient): BoOfficialDiscoveryReads {
  return {
    async readLargeTaxpayersByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .eq('source_key', 'bo_large_taxpayers')
          .eq('country_code', 'BO')
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .eq('raw_data->>matricula_renewed', 'true')
          .order('priority_score', { ascending: false })
          .order('normalized_tax_id', { ascending: true })
          .limit(Math.min(limit * BO_DISCOVERY_READ_OVERSAMPLE, BO_DISCOVERY_READ_CAP));
        if (error || !Array.isArray(data)) return [];
        const rows = (data as unknown as SnapshotSelectRow[]).map(toTaxpayer);
        const nits = [...new Set(rows.map((row) => row.nit).filter((nit): nit is string => Boolean(nit)))];
        const sightings = nits.length > 0 ? await readCountrySourcePriorSightings(client, nits) : new Map();
        return rows.map((row) => ({ ...row, prior_sighting: (row.nit && sightings.get(row.nit)) || null }));
      } catch {
        return [];
      }
    },
    async readPublicEntitiesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .eq('source_key', 'bo_public_entities')
          .eq('country_code', 'BO')
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .order('priority_score', { ascending: false })
          .order('record_identity_key', { ascending: true })
          .limit(Math.min(limit * BO_DISCOVERY_READ_OVERSAMPLE, BO_DISCOVERY_READ_CAP));
        if (error || !Array.isArray(data)) return [];
        return (data as unknown as SnapshotSelectRow[]).map(toEntity);
      } catch {
        return [];
      }
    },
  };
}
