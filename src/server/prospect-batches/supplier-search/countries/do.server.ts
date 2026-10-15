/**
 * República Dominicana — consultas en vivo de «Proveedores de una empresa»: la API de
 * datos abiertos de la DGCP (GET con tiempo máximo y `User-Agent`, sin llave) y el RNC
 * y la web desde `source_company_snapshots` (sólo service_role).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWebsiteHost } from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import type { PublicEntityRow } from '../public-buyer-suppliers';
import { DO_DGCP_SUPPLIERS_SOURCE_KEY, doUrls, fetchDoSuppliers, isDoCompanyRnc, matchDoBuyingUnits, parseDoBuyingUnits } from './do';
import type { CountryLookups } from './loaded-lookups.server';

const DGCP_TIMEOUT_MS = 10_000;
/** Las unidades de compra casi no cambian: se guardan en memoria del proceso. */
const UNITS_TTL_MS = 6 * 60 * 60 * 1000;
const RUBRO_TTL_MS = 24 * 60 * 60 * 1000;
const RUBRO_CACHE_MAX = 5_000;
const RPE_CHUNK = 150;
const ENTITY_MATCH_LIMIT = 25;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function logError(step: string, error: unknown): void {
  console.error(`[supplier-public-buyer:DO] ${step}:`, (error as { message?: string })?.message ?? String(error));
}

export async function fetchDgcpJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DGCP_TIMEOUT_MS);
  try {
    // Sin `User-Agent` la API responde 403.
    const response = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'SellUp/0.1 supplier-search' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

let unitsCache: { at: number; rows: PublicEntityRow[] } | null = null;
const rubroCache = new Map<string, { at: number; families: string[] }>();

async function buyingUnits(fetchJson: (url: string) => Promise<unknown>): Promise<PublicEntityRow[]> {
  if (unitsCache && Date.now() - unitsCache.at < UNITS_TTL_MS) return unitsCache.rows;
  const rows = parseDoBuyingUnits(await fetchJson(doUrls.units()));
  if (rows.length > 0) unitsCache = { at: Date.now(), rows };
  return rows;
}

/** República Dominicana: DGCP en vivo; RNC desde `do_dgcp`, web desde el registro DGII. */
export function buildDoLookups(serviceClient: SupabaseClient, fetchJson: (url: string) => Promise<unknown> = fetchDgcpJson): CountryLookups {
  const snapshots = () => serviceClient.from('source_company_snapshots');

  const rncByRpe = async (rpes: readonly string[]) => {
    const out = new Map<string, string>();
    for (let i = 0; i < rpes.length; i += RPE_CHUNK) {
      const { data, error } = await snapshots()
        .select('tax_id, rpe:raw_data->>rpe')
        .eq('country_code', 'DO')
        .eq('source_key', 'do_dgcp')
        .in('raw_data->>rpe', rpes.slice(i, i + RPE_CHUNK));
      if (error) {
        logError('rnc by rpe', error);
        continue;
      }
      for (const row of (data ?? []) as Array<{ tax_id: string | null; rpe: string | null }>) {
        if (row.rpe && isDoCompanyRnc(row.tax_id) && !out.has(row.rpe)) out.set(row.rpe, row.tax_id!.trim());
      }
    }
    return out;
  };

  return {
    sourceKey: DO_DGCP_SUPPLIERS_SOURCE_KEY,
    taxIdentifierType: 'RNC',

    findPublicEntities: async (normalizedName) => {
      try {
        return matchDoBuyingUnits(await buyingUnits(fetchJson), normalizedName).slice(0, ENTITY_MATCH_LIMIT);
      } catch (error) {
        logError('buying units', error);
        return [];
      }
    },

    listSuppliers: (input) =>
      fetchDoSuppliers(input, {
        fetchJson,
        rncByRpe,
        publicEntityNames: async () => new Set((await buyingUnits(fetchJson)).map((u) => u.normalizedLegalName)),
        cachedRubro: (rpe) => {
          const hit = rubroCache.get(rpe);
          return hit && Date.now() - hit.at < RUBRO_TTL_MS ? hit.families : undefined;
        },
        rememberRubro: (rpe, families) => {
          if (rubroCache.size >= RUBRO_CACHE_MAX) rubroCache.clear();
          rubroCache.set(rpe, { at: Date.now(), families });
        },
        nowMs: () => Date.now(),
      }),

    // Las otras entidades públicas ya quedaron fuera (nombre de unidad de compra o sin RNC).
    listPublicOnlyTaxIds: async () => new Set<string>(),

    findDomainsByTaxId: async (taxIds) => {
      const domains = new Map<string, string>();
      if (taxIds.length === 0) return domains;
      const { data, error } = await snapshots()
        .select('tax_id, raw_data')
        .eq('country_code', 'DO')
        .eq('source_key', 'do_dgii_size_registry')
        .in('tax_id', [...taxIds]);
      if (error) {
        logError('domains', error);
        return domains;
      }
      for (const row of (data ?? []) as Array<{ tax_id: string; raw_data: Record<string, unknown> | null }>) {
        const host = normalizeWebsiteHost(text(row.raw_data?.website_domain));
        if (host && !domains.has(row.tax_id)) domains.set(row.tax_id, host);
      }
      return domains;
    },
  };
}
