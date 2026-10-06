/**
 * cl-sii-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Chile.
 *
 * SOURCES-CL-SII-FREE-DISCOVERY-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `cl_sii_directory` / `CL` y a la macro pedida, ordenado por trabajadores
 * (`priority_score`, percentil 0-100) y, en los empates, por RUT para que dos
 * corridas idénticas lean las mismas filas.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ClSiiDirectoryDiscoveryReads,
  ClSiiDirectorySnapshotReadRow,
} from './cl-sii-directory-discovery-adapter';

type SnapshotSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  priority_score: number | string | null;
  raw_data: Record<string, unknown> | null;
};

/**
 * SOURCES-CL-NO-RECYCLE-1 — la lectura es determinista (mismo orden por
 * trabajadores), así que la 2.ª corrida del mismo industria × país relee las
 * mismas empresas. Se marca lo que SellUp ya vio y se lee de más para que el
 * tope siga llenándose con empresas nuevas. Patrón de Argentina (#611).
 */
export const CL_DISCOVERY_READ_OVERSAMPLE = 3;
/** Techo de filas leídas por consulta. */
export const CL_DISCOVERY_READ_CAP = 600;
/** RUT por consulta al marcar lo ya visto (la URL de PostgREST tiene límite). */
const SIGHTING_CHUNK = 150;

/**
 * RUT que SellUp ya tiene: candidato en cualquier lote o descartado del buscador
 * gratuito (`provider_identifier = tax:<RUT>`). Sólo lectura; si una consulta
 * falla, esa parte no marca nada (fail-open: la fila se ofrece como antes).
 */
async function readAlreadySeen(client: SupabaseClient, ruts: readonly string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < ruts.length; i += SIGHTING_CHUNK) {
    const chunk = ruts.slice(i, i + SIGHTING_CHUNK);
    try {
      const { data, error } = await client.from('prospect_candidates').select('tax_identifier').in('tax_identifier', chunk);
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ tax_identifier: string | null }>) {
          if (row.tax_identifier) seen.add(row.tax_identifier);
        }
      }
    } catch {
      /* fail-open */
    }
    try {
      const { data, error } = await client
        .from('prospect_discarded_dispositions')
        .select('provider_identifier')
        .eq('source_primary', 'public_source')
        .in('provider_identifier', chunk.map((rut) => `tax:${rut}`));
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ provider_identifier: string | null }>) {
          if (row.provider_identifier?.startsWith('tax:')) seen.add(row.provider_identifier.slice(4));
        }
      }
    } catch {
      /* fail-open */
    }
  }
  return seen;
}

const SELECTED_COLUMNS =
  'record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, priority_score, raw_data';

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toInteger(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

const toText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function toRow(row: SnapshotSelectRow): ClSiiDirectorySnapshotReadRow {
  return {
    record_identity_key: row.record_identity_key,
    rut: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    activity_code: toText(row.raw_data?.['activity_code']),
    activity: toText(row.raw_data?.['activity']),
    workers: toInteger(row.raw_data?.['workers']),
    metrics_year: toInteger(row.raw_data?.['metrics_year']),
    priority_score: toNumber(row.priority_score),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Chile. */
export function buildClSiiDirectoryDiscoveryReads(client: SupabaseClient): ClSiiDirectoryDiscoveryReads {
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .eq('source_key', 'cl_sii_directory')
          .eq('country_code', 'CL')
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .order('priority_score', { ascending: false })
          .order('normalized_tax_id', { ascending: true })
          .limit(Math.min(limit * CL_DISCOVERY_READ_OVERSAMPLE, CL_DISCOVERY_READ_CAP));
        if (error || !Array.isArray(data)) return [];
        const rows = (data as unknown as SnapshotSelectRow[]).map(toRow);
        const ruts = [...new Set(rows.map((row) => row.rut).filter((rut): rut is string => Boolean(rut)))];
        const seen = ruts.length > 0 ? await readAlreadySeen(client, ruts) : new Set<string>();
        return rows.map((row) => ({ ...row, already_seen: row.rut !== null && seen.has(row.rut) }));
      } catch {
        return [];
      }
    },
  };
}
