/**
 * do-dgii-snapshot-query.ts — la lectura (SÓLO LECTURA) del descubrimiento
 * gratuito de República Dominicana.
 *
 * SOURCES-DO-FREE-DISCOVERY-1 · SOURCES-DO-SIZE-SIGNAL-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `do_dgii_size_registry` / `DO` y a la macro pedida, ordenado por
 * `priority_score` (nivel de tamaño y, dentro del nivel, importe adjudicado) y,
 * en los empates, por RNC para que dos corridas idénticas lean las mismas filas.
 *
 * Filtra por la macro guardada en la fila y no por la lista de textos de
 * actividad: una macro grande (372 textos en Industria) no cabe en la URL.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío: sin filas
 * no hay candidatos (fail-closed hacia el proveedor de pago).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por
 * la factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DO_DGII_SIZE_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/dgii-rd/do-size-registry-rows';
import type { DoDgiiActiveRow, DoDgiiDiscoveryReads } from './do-dgii-discovery-adapter';

type SnapshotSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: string | null;
  size_tier: unknown;
};

const SELECTED_COLUMNS =
  'record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, sector, size_tier:raw_data->size_tier';

function toTier(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
}

function toRow(row: SnapshotSelectRow): DoDgiiActiveRow {
  return {
    record_identity_key: row.record_identity_key,
    rnc: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    sector: row.sector,
    size_tier: toTier(row.size_tier),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura del adapter. */
export function buildDoDgiiDiscoveryReads(client: SupabaseClient): DoDgiiDiscoveryReads {
  return {
    async readSizedCompaniesByMacro({ macroIndustryKey, limit }) {
      const cap = Math.max(0, Math.trunc(limit));
      if (cap === 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .eq('source_key', DO_DGII_SIZE_REGISTRY_SOURCE_KEY)
          .eq('country_code', 'DO')
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .order('priority_score', { ascending: false })
          .order('normalized_tax_id', { ascending: true })
          .limit(cap);
        if (error || !Array.isArray(data)) return [];
        return (data as unknown as SnapshotSelectRow[]).map(toRow);
      } catch {
        return [];
      }
    },
  };
}
