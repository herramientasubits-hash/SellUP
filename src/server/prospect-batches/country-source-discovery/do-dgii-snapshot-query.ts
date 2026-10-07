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
 * SOURCES-DO-NO-RECYCLE-1: además marca, por RNC, lo que SellUp ya vio
 * (candidatas de cualquier lote y descartes de la capa gratuita) para que el
 * adapter no repita lo de corridas anteriores.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío: sin filas
 * no hay candidatos (fail-closed hacia el proveedor de pago).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por
 * la factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DO_DGII_SIZE_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/dgii-rd/do-size-registry-rows';
import type { DoDgiiActiveRow, DoDgiiDiscoveryReads, DoDgiiPriorSighting } from './do-dgii-discovery-adapter';
import {
  isUnsearchedFreeLayerDiscard,
  PRIOR_SIGHTING_DISPOSITION_COLUMNS,
  type PriorSightingDispositionRow,
} from './country-source-prior-sightings';

/** RNC por consulta al marcar lo ya visto (la URL de PostgREST tiene límite). */
export const DO_SIGHTING_CHUNK = 150;

/** Decisiones del rescate de Claude que cierran el caso de una empresa descartada. */
const DEFINITIVE_RESCUE_DECISIONS: ReadonlySet<string> = new Set(['discard', 'duplicate']);

const SIGHTING_RANK: Record<DoDgiiPriorSighting, number> = {
  candidate: 3,
  definitive_discard: 2,
  discard: 1,
};

function strongest(a: DoDgiiPriorSighting | undefined, b: DoDgiiPriorSighting): DoDgiiPriorSighting {
  return a !== undefined && SIGHTING_RANK[a] >= SIGHTING_RANK[b] ? a : b;
}

/**
 * SOURCES-DO-NO-RECYCLE-1 — RNC → lo que SellUp ya sabe de él: candidata en algún
 * lote, descartada de forma definitiva o descartada sin cierre. Sólo lectura. Si
 * una consulta falla, esa parte no marca nada y la fila se ofrece como antes
 * (fail-open, igual que el resto de la capa gratuita).
 */
async function readPriorSightings(
  client: SupabaseClient,
  rncs: readonly string[],
): Promise<Map<string, DoDgiiPriorSighting>> {
  const out = new Map<string, DoDgiiPriorSighting>();
  for (let i = 0; i < rncs.length; i += DO_SIGHTING_CHUNK) {
    const chunk = rncs.slice(i, i + DO_SIGHTING_CHUNK);
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
        .select(PRIOR_SIGHTING_DISPOSITION_COLUMNS)
        .eq('source_primary', 'public_source')
        .in('provider_identifier', chunk.map((rnc) => `tax:${rnc}`));
      if (!error && Array.isArray(data)) {
        // AGENT1-FREE-LAYER-OVERFLOW-STAYS-IN-SOURCE-1 — la sin web que el rescate nunca buscó vuelve.
        const nowMs = Date.now();
        for (const row of data as PriorSightingDispositionRow[]) {
          const rnc = row.provider_identifier?.startsWith('tax:') ? row.provider_identifier.slice(4) : null;
          if (!rnc || isUnsearchedFreeLayerDiscard(row, nowMs)) continue;
          const sighting: DoDgiiPriorSighting =
            row.decision && DEFINITIVE_RESCUE_DECISIONS.has(row.decision) ? 'definitive_discard' : 'discard';
          out.set(rnc, strongest(out.get(rnc), sighting));
        }
      }
    } catch {
      /* fail-open */
    }
  }
  return out;
}

type SnapshotSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: string | null;
  size_tier: unknown;
  website_domain: unknown;
};

const SELECTED_COLUMNS =
  'record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, sector, ' +
  'size_tier:raw_data->size_tier, website_domain:raw_data->>website_domain';

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
    website_domain: typeof row.website_domain === 'string' ? row.website_domain : null,
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
        const rows = (data as unknown as SnapshotSelectRow[]).map(toRow);
        const rncs = [...new Set(rows.map((row) => row.rnc).filter((r): r is string => Boolean(r)))];
        const sightings = rncs.length > 0 ? await readPriorSightings(client, rncs) : new Map();
        return rows.map((row) => ({ ...row, prior_sighting: (row.rnc && sightings.get(row.rnc)) || null }));
      } catch {
        return [];
      }
    },
  };
}
