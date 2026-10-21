/**
 * ec-scvs-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Ecuador.
 *
 * SOURCES-EC-FREE-DISCOVERY-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `ec_scvs_directory` / `EC` y a la macro pedida, ordenado por empleados
 * (`priority_score`, percentil 0-100) y, en los empates, por RUC para que dos
 * corridas idénticas lean las mismas filas.
 *
 * Además marca, por RUC, lo que SellUp ya vio (candidatas y descartes) para que
 * el adapter no lo vuelva a proponer (`country-source-prior-sightings.ts`).
 *
 * AUDIT-A1-WS7 — y lee por páginas (mismo orden) saltando en la LECTURA lo que
 * SellUp ya conoce por RUC o web (`country-source-fresh-window.ts`): la ventana ×3
 * fija se agotaba tras pocas corridas. Sólo cambia QUÉ filas del snapshot se leen;
 * no toca el conector EC-SCVS ni su piloto en vivo.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EcScvsDirectoryDiscoveryReads,
  EcScvsDirectorySnapshotReadRow,
} from './ec-scvs-directory-discovery-adapter';
import { readCountrySourcePriorSightings } from './country-source-prior-sightings';
import {
  buildReadKnownSnapshotIdentities,
  readFreshSnapshotWindow,
  snapshotWebsiteDomain,
} from './country-source-fresh-window';
import { classifyEcPublicEntity } from '@/server/source-catalog/connectors/ec-scvs/ec-public-entity-classifier';

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

function toRow(row: SnapshotSelectRow): EcScvsDirectorySnapshotReadRow {
  const code = row.raw_data?.['ciiu_code'];
  return {
    record_identity_key: row.record_identity_key,
    ruc: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    ciiu_code: typeof code === 'string' ? code : null,
    employees: toInteger(row.raw_data?.['workers']),
    metrics_year: toInteger(row.raw_data?.['metrics_year']),
    priority_score: toNumber(row.priority_score),
    website_domain: typeof row.raw_data?.['website_domain'] === 'string' ? row.raw_data['website_domain'] : null,
  };
}

/**
 * SOURCES-EC-CLOSE-1 — cuántas filas se leen por cada una que se pide: el adapter
 * salta lo que SellUp ya vio, así que se lee de más para seguir llenando el tope
 * con empresas nuevas (mismo criterio que Argentina).
 */
export const EC_DISCOVERY_READ_OVERSAMPLE = 3;
/** Techo de filas leídas por consulta. */
export const EC_DISCOVERY_READ_CAP = 600;

/**
 * SOURCES-EC-PUBLIC-ENTITIES-1 — entidades públicas (RUC con tercer dígito 6) del
 * catastro del SRI: ~3.200 filas, leídas en páginas y clasificadas por TIPO
 * (`classifyEcPublicEntity`). Sólo para Gobierno y Salud.
 */
const PUBLIC_ENTITY_PAGE = 1000;
const PUBLIC_ENTITY_MAX_ROWS = 6000;

async function readPublicEntitiesByMacro(
  client: SupabaseClient,
  macroIndustryKey: string,
  limit: number,
): Promise<EcScvsDirectorySnapshotReadRow[]> {
  const all: SnapshotSelectRow[] = [];
  for (let from = 0; from < PUBLIC_ENTITY_MAX_ROWS; from += PUBLIC_ENTITY_PAGE) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select(SELECTED_COLUMNS)
      .eq('source_key', 'ec_sri_registry')
      .eq('country_code', 'EC')
      .eq('raw_data->>sector_type', 'public')
      .order('normalized_tax_id', { ascending: true })
      .range(from, from + PUBLIC_ENTITY_PAGE - 1);
    if (error || !Array.isArray(data)) return [];
    all.push(...(data as unknown as SnapshotSelectRow[]));
    if (data.length < PUBLIC_ENTITY_PAGE) break;
  }
  type ClassifiedEntityRow = { row: SnapshotSelectRow; entity: ReturnType<typeof classifyEcPublicEntity> };
  const sorted: ClassifiedEntityRow[] = all
    .map((row) => ({ row, entity: classifyEcPublicEntity(row.legal_name) }))
    .filter((item) => item.entity?.macroIndustryKey === macroIndustryKey)
    // Primero lo más grande (nacional); en el empate, por RUC: dos corridas leen lo mismo.
    .sort((a, b) => (b.entity?.priority ?? 0) - (a.entity?.priority ?? 0));
  // AUDIT-A1-WS7 — la ventana fresca sobre la lista ya ordenada (en memoria): se
  // saltan las que SellUp ya conoce en vez de cortar siempre las mismas primeras.
  const classified = await readFreshSnapshotWindow<ClassifiedEntityRow>({
    size: Math.min(limit * EC_DISCOVERY_READ_OVERSAMPLE, EC_DISCOVERY_READ_CAP),
    countryCode: 'EC',
    readKnown: buildReadKnownSnapshotIdentities(client),
    taxIdOf: (item) => item.row.normalized_tax_id,
    domainOf: (item) => snapshotWebsiteDomain(item.row.raw_data),
    readRange: async (from, to) => sorted.slice(from, to + 1),
  });
  return classified.map(({ row, entity }) => ({
    ...toRow(row),
    // El catastro del SRI no trae empleados ni macro de la tabla de la Superintendencia.
    employees: null,
    metrics_year: null,
    priority_score: null,
    ciiu_code: typeof row.raw_data?.['ciiu_code'] === 'string' ? (row.raw_data['ciiu_code'] as string) : null,
    public_entity: entity,
  }));
}

async function withPriorSightings(
  client: SupabaseClient,
  rows: EcScvsDirectorySnapshotReadRow[],
): Promise<EcScvsDirectorySnapshotReadRow[]> {
  const rucs = [...new Set(rows.map((row) => row.ruc).filter((ruc): ruc is string => Boolean(ruc)))];
  const sightings = rucs.length > 0 ? await readCountrySourcePriorSightings(client, rucs) : new Map();
  return rows.map((row) => ({ ...row, prior_sighting: (row.ruc && sightings.get(row.ruc)) || null }));
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Ecuador. */
export function buildEcScvsDirectoryDiscoveryReads(client: SupabaseClient): EcScvsDirectoryDiscoveryReads {
  return {
    async readPublicEntitiesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        return await withPriorSightings(client, await readPublicEntitiesByMacro(client, macroIndustryKey, limit));
      } catch {
        return [];
      }
    },
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      const readLimit = Math.min(limit * EC_DISCOVERY_READ_OVERSAMPLE, EC_DISCOVERY_READ_CAP);
      // Una consulta NUEVA por página: un builder de PostgREST no se reutiliza.
      const buildQuery = () =>
        client
          .from('source_company_snapshots')
          .select(SELECTED_COLUMNS)
          .eq('source_key', 'ec_scvs_directory')
          .eq('country_code', 'EC')
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .order('priority_score', { ascending: false })
          .order('normalized_tax_id', { ascending: true });
      try {
        const page = await readFreshSnapshotWindow<SnapshotSelectRow>({
          size: readLimit,
          countryCode: 'EC',
          readKnown: buildReadKnownSnapshotIdentities(client),
          taxIdOf: (row) => row.normalized_tax_id,
          domainOf: (row) => snapshotWebsiteDomain(row.raw_data),
          readRange: async (from, to) => {
            const query = buildQuery();
            const { data, error } = await (from === 0 ? query.limit(readLimit) : query.range(from, to));
            if (error || !Array.isArray(data)) throw new Error('ec_scvs_directory_read_failed');
            return data as unknown as SnapshotSelectRow[];
          },
        });
        const rows = page.map(toRow);
        const rucs = [...new Set(rows.map((row) => row.ruc).filter((ruc): ruc is string => Boolean(ruc)))];
        const sightings = rucs.length > 0 ? await readCountrySourcePriorSightings(client, rucs) : new Map();
        return rows.map((row) => ({ ...row, prior_sighting: (row.ruc && sightings.get(row.ruc)) || null }));
      } catch {
        return [];
      }
    },
  };
}
