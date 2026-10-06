/**
 * ar-rns-snapshot-query.ts — la lectura (SÓLO LECTURA) del descubrimiento gratuito
 * de Argentina.
 *
 * SOURCES-AR-RNS-1 · SOURCES-AR-E2E-1.
 *
 * Dos SELECT acotados sobre `source_company_snapshots`, filtrados a `AR` y a la
 * macro pedida, ordenados por `priority_score` (percentil 0-100) y, en los
 * empates, por CUIT para que dos corridas idénticas lean las mismas filas:
 *   - `ar_rns`: proveedoras del Estado, por importe adjudicado.
 *   - `ar_atp_employers`: empleadores ATP 2020 con ≥100 trabajadores, por
 *     trabajadores.
 * Cada fila sale marcada con su origen; el adapter las intercala.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft),
 * fuente por fuente.
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ArRnsDiscoveryOrigin,
  ArRnsDiscoveryReads,
  ArRnsSnapshotReadRow,
} from './ar-rns-discovery-adapter';

/** Fuente cargada → origen que el adapter intercala. */
export const AR_DISCOVERY_SOURCES: ReadonlyArray<{
  sourceKey: string;
  origin: ArRnsDiscoveryOrigin;
}> = [
  { sourceKey: 'ar_rns', origin: 'procurement' },
  { sourceKey: 'ar_atp_employers', origin: 'employer' },
];

type SnapshotSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: string | null;
  city: string | null;
  region: string | null;
  priority_score: number | string | null;
  raw_data: Record<string, unknown> | null;
};

const SELECTED_COLUMNS =
  'record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, sector, city, region, priority_score, raw_data';

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toRow(row: SnapshotSelectRow, origin: ArRnsDiscoveryOrigin): ArRnsSnapshotReadRow {
  const code = row.raw_data?.['actividad_codigo'];
  return {
    origin,
    record_identity_key: row.record_identity_key,
    cuit: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    sector: row.sector,
    city: row.city,
    region: row.region,
    activity_code: typeof code === 'string' ? code : null,
    priority_score: toNumber(row.priority_score),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Argentina. */
export function buildArRnsDiscoveryReads(client: SupabaseClient): ArRnsDiscoveryReads {
  async function readOne(
    sourceKey: string,
    origin: ArRnsDiscoveryOrigin,
    macroIndustryKey: string,
    limit: number,
  ): Promise<ArRnsSnapshotReadRow[]> {
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select(SELECTED_COLUMNS)
        .eq('source_key', sourceKey)
        .eq('country_code', 'AR')
        .eq('raw_data->>macro_industry_key', macroIndustryKey)
        .order('priority_score', { ascending: false })
        .order('normalized_tax_id', { ascending: true })
        .limit(limit);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as SnapshotSelectRow[]).map((row) => toRow(row, origin));
    } catch {
      return [];
    }
  }

  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      const perSource = await Promise.all(
        AR_DISCOVERY_SOURCES.map(({ sourceKey, origin }) =>
          readOne(sourceKey, origin, macroIndustryKey, limit),
        ),
      );
      return perSource.flat();
    },
  };
}
