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
 * AUDIT-A1-WS7 — las dos por páginas (mismo orden) saltando en la LECTURA lo que
 * SellUp ya conoce por NIT o web (`country-source-fresh-window.ts`): la ventana
 * ×3 fija se agotaba tras pocas corridas.
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
import {
  buildReadKnownSnapshotIdentities,
  readFreshSnapshotWindow,
  snapshotWebsiteDomain,
} from './country-source-fresh-window';

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

/**
 * Lee `sourceKey` de la macro pedida por páginas, saltando lo ya conocido. `tieBreak`
 * es la columna que desempata (y fija el orden de las páginas). Lanza si la primera
 * página falla; el llamador degrada a vacío.
 */
function readFreshBoRows(
  client: SupabaseClient,
  input: { sourceKey: string; macroIndustryKey: string; limit: number; tieBreak: string; renewedOnly: boolean },
): Promise<SnapshotSelectRow[]> {
  const readLimit = Math.min(input.limit * BO_DISCOVERY_READ_OVERSAMPLE, BO_DISCOVERY_READ_CAP);
  // Una consulta NUEVA por página: un builder de PostgREST no se reutiliza.
  const buildQuery = () => {
    const base = client
      .from('source_company_snapshots')
      .select(SELECTED_COLUMNS)
      .eq('source_key', input.sourceKey)
      .eq('country_code', 'BO')
      .eq('raw_data->>macro_industry_key', input.macroIndustryKey);
    return (input.renewedOnly ? base.eq('raw_data->>matricula_renewed', 'true') : base)
      .order('priority_score', { ascending: false })
      .order(input.tieBreak, { ascending: true });
  };
  return readFreshSnapshotWindow<SnapshotSelectRow>({
    size: readLimit,
    countryCode: 'BO',
    readKnown: buildReadKnownSnapshotIdentities(client),
    taxIdOf: (row) => row.normalized_tax_id,
    domainOf: (row) => snapshotWebsiteDomain(row.raw_data),
    readRange: async (from, to) => {
      const query = buildQuery();
      const { data, error } = await (from === 0 ? query.limit(readLimit) : query.range(from, to));
      if (error || !Array.isArray(data)) throw new Error('bo_snapshot_read_failed');
      return data as unknown as SnapshotSelectRow[];
    },
  });
}

/** Adapta un cliente (de `service_role`) a las lecturas de descubrimiento de Bolivia. */
export function buildBoOfficialDiscoveryReads(client: SupabaseClient): BoOfficialDiscoveryReads {
  return {
    async readLargeTaxpayersByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const rows = (
          await readFreshBoRows(client, {
            sourceKey: 'bo_large_taxpayers',
            macroIndustryKey,
            limit,
            tieBreak: 'normalized_tax_id',
            renewedOnly: true,
          })
        ).map(toTaxpayer);
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
        return (
          await readFreshBoRows(client, {
            sourceKey: 'bo_public_entities',
            macroIndustryKey,
            limit,
            tieBreak: 'record_identity_key',
            renewedOnly: false,
          })
        ).map(toEntity);
      } catch {
        return [];
      }
    },
  };
}
