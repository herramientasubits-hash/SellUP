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
  ArRnsPriorSighting,
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
    // SOURCES-AR-SIPRO-DOMAIN-1 — dominio del correo del SIPRO histórico, si lo hay.
    website_domain: typeof row.raw_data?.['website_domain'] === 'string' ? row.raw_data['website_domain'] : null,
  };
}

/**
 * SOURCES-AR-NO-RECYCLE-1 — cuántas filas se leen por cada una que se pide. El
 * adapter salta las que SellUp ya vio (candidatas, descartadas), así que se lee
 * de más para que el tope siga llenándose con empresas nuevas.
 */
export const AR_DISCOVERY_READ_OVERSAMPLE = 3;
/** Techo de filas leídas por fuente y consulta. */
export const AR_DISCOVERY_READ_CAP = 600;
/** CUIT por consulta al marcar lo ya visto (la URL de PostgREST tiene límite). */
const SIGHTING_CHUNK = 150;

/** Decisiones del rescate de Claude que cierran el caso de una empresa descartada. */
const DEFINITIVE_RESCUE_DECISIONS: ReadonlySet<string> = new Set(['discard', 'duplicate']);

const SIGHTING_RANK: Record<ArRnsPriorSighting, number> = {
  candidate: 3,
  definitive_discard: 2,
  discard: 1,
};

function strongest(a: ArRnsPriorSighting | undefined, b: ArRnsPriorSighting): ArRnsPriorSighting {
  return a !== undefined && SIGHTING_RANK[a] >= SIGHTING_RANK[b] ? a : b;
}

/**
 * CUIT → lo que SellUp ya sabe de ella: candidata en algún lote, descartada de
 * forma definitiva (Claude dijo otra industria, otro tamaño o duplicada) o
 * descartada sin cierre (p. ej. sin web). Sólo lectura. Si una consulta falla,
 * esa parte no marca nada: la fila se ofrece como antes (fail-open, igual que el
 * resto de la capa gratuita).
 */
async function readPriorSightings(
  client: SupabaseClient,
  cuits: readonly string[],
): Promise<Map<string, ArRnsPriorSighting>> {
  const out = new Map<string, ArRnsPriorSighting>();
  for (let i = 0; i < cuits.length; i += SIGHTING_CHUNK) {
    const chunk = cuits.slice(i, i + SIGHTING_CHUNK);
    try {
      const { data, error } = await client
        .from('prospect_candidates')
        .select('tax_identifier')
        .in('tax_identifier', chunk);
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ tax_identifier: string | null }>) {
          if (row.tax_identifier) out.set(row.tax_identifier, strongest(out.get(row.tax_identifier), 'candidate'));
        }
      }
    } catch {
      /* fail-open */
    }
    try {
      const { data, error } = await client
        .from('prospect_discarded_dispositions')
        .select('provider_identifier, decision:evidence->claude_rescue->>decision')
        .eq('source_primary', 'public_source')
        .in('provider_identifier', chunk.map((cuit) => `tax:${cuit}`));
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ provider_identifier: string | null; decision: string | null }>) {
          const cuit = row.provider_identifier?.startsWith('tax:') ? row.provider_identifier.slice(4) : null;
          if (!cuit) continue;
          const sighting: ArRnsPriorSighting =
            row.decision && DEFINITIVE_RESCUE_DECISIONS.has(row.decision) ? 'definitive_discard' : 'discard';
          out.set(cuit, strongest(out.get(cuit), sighting));
        }
      }
    } catch {
      /* fail-open */
    }
  }
  return out;
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
      const readLimit = Math.min(limit * AR_DISCOVERY_READ_OVERSAMPLE, AR_DISCOVERY_READ_CAP);
      const perSource = await Promise.all(
        AR_DISCOVERY_SOURCES.map(({ sourceKey, origin }) =>
          readOne(sourceKey, origin, macroIndustryKey, readLimit),
        ),
      );
      const rows = perSource.flat();
      const cuits = [...new Set(rows.map((row) => row.cuit).filter((c): c is string => Boolean(c)))];
      const sightings = cuits.length > 0 ? await readPriorSightings(client, cuits) : new Map();
      return rows.map((row) => ({ ...row, prior_sighting: (row.cuit && sightings.get(row.cuit)) || null }));
    },
  };
}
