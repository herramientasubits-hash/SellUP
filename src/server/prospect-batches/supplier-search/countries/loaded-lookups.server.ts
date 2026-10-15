/**
 * AGENT1-SUPPLIER-SEARCH-ALL-1 — consultas genéricas de un país «loaded»: la entidad y sus
 * proveedores salen de `public_procurement_supplier_links` (sólo service_role); la web y
 * los trabajadores, de las fuentes del país en `source_company_snapshots`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWebsiteHost } from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import { buyersFromLinks, suppliersFromLinks, type StoredProcurementLink } from '../procurement-links';
import type { PublicBuyerStepDeps } from '../public-buyer-suppliers';
import type { LoadedCountrySource } from './types';

export const PROCUREMENT_LINKS_TABLE = 'public_procurement_supplier_links';
/** Filas de compradores que se leen para reconocer la referencia. */
const BUYER_QUERY_LIMIT = 200;
/** Proveedores de la entidad que se leen (los de más monto). */
const SUPPLIER_QUERY_LIMIT = 200;

export type CountryLookups = Omit<PublicBuyerStepDeps, 'writeWithWebsite' | 'recordWithoutWebsite'>;

/** Ganchos de servidor opcionales de un país «loaded». */
export type LoadedCountryServerHooks = {
  /** Industria por la actividad oficial del proveedor (CIIU de su ficha), por número fiscal. */
  activityMacroByTaxId?: (serviceClient: SupabaseClient, taxIds: readonly string[]) => Promise<Map<string, string>>;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function logError(country: string, step: string, error: unknown): void {
  console.error(`[supplier-public-buyer:${country}] ${step}:`, (error as { message?: string })?.message ?? String(error));
}

/** Filtro PostgREST «tax_id o normalized_tax_id en las formas dadas». */
function taxIdFilter(forms: readonly string[]): string {
  const list = forms.map((f) => `"${f.replace(/"/g, '')}"`).join(',');
  return `tax_id.in.(${list}),normalized_tax_id.in.(${list})`;
}

type SnapshotRow = { tax_id: string | null; normalized_tax_id: string | null; source_key: string; raw_data: Record<string, unknown> | null; source_year?: number | null };

/** A qué número fiscal del proveedor corresponde una fila de la foto. */
function ownerOf(row: SnapshotRow, taxIds: readonly string[], formsOf: (t: string) => string[]): string | undefined {
  return taxIds.find((t) => formsOf(t).some((f) => f === row.tax_id || f === row.normalized_tax_id));
}

export function buildLoadedLinksLookups(
  country: LoadedCountrySource,
  serviceClient: SupabaseClient,
  hooks: LoadedCountryServerHooks = {},
): CountryLookups {
  const links = () => serviceClient.from(PROCUREMENT_LINKS_TABLE);
  const formsOf = (taxId: string) => country.snapshotTaxIdForms?.(taxId) ?? [taxId];

  const workersByTaxId = async (taxIds: readonly string[]) => {
    const out = new Map<string, { workers: number; year: number | null; sourceLabel: string }>();
    if (country.workersSourceKeys.length === 0 || taxIds.length === 0) return out;
    const { data, error } = await serviceClient
      .from('source_company_snapshots')
      .select('tax_id, normalized_tax_id, source_key, raw_data, source_year')
      .eq('country_code', country.countryCode)
      .in('source_key', [...country.workersSourceKeys])
      .or(taxIdFilter(taxIds.flatMap(formsOf)));
    if (error) {
      logError(country.countryCode, 'workers', error);
      return out;
    }
    for (const row of (data ?? []) as SnapshotRow[]) {
      const owner = ownerOf(row, taxIds, formsOf);
      const workers = Number(row.raw_data?.workers);
      if (!owner || !Number.isInteger(workers) || workers < 1 || out.has(owner)) continue;
      const year = Number(row.raw_data?.metrics_year ?? row.source_year);
      out.set(owner, { workers, year: Number.isInteger(year) ? year : null, sourceLabel: country.workersSourceLabel ?? row.source_key });
    }
    return out;
  };

  return {
    sourceKey: country.sourceKey,
    taxIdentifierType: country.taxIdentifierType,
    normalizeName: country.normalizeBuyerName,

    findPublicEntities: async (normalizedName) => {
      const { data, error } = await links()
        .select('buyer_code, buyer_name_normalized')
        .eq('country_code', country.countryCode)
        .eq('source_key', country.sourceKey)
        .like('buyer_name_normalized', `${normalizedName.replace(/[%_]/g, '')}%`)
        .limit(BUYER_QUERY_LIMIT);
      if (error) {
        logError(country.countryCode, 'find buyers', error);
        return [];
      }
      return buyersFromLinks((data ?? []) as Array<Pick<StoredProcurementLink, 'buyer_code' | 'buyer_name_normalized'>>);
    },

    listSuppliers: async ({ buyerTaxId, macroIndustryKey }) => {
      const { data, error } = await links()
        .select('buyer_code, buyer_name_normalized, supplier_tax_id, supplier_name, total_amount, order_count, amount_by_family, last_order_on, top_order_url, window_start')
        .eq('country_code', country.countryCode)
        .eq('source_key', country.sourceKey)
        .eq('buyer_code', buyerTaxId)
        .order('total_amount', { ascending: false })
        .limit(SUPPLIER_QUERY_LIMIT);
      if (error) {
        logError(country.countryCode, 'suppliers', error);
        return { ok: false, reason: 'source_unavailable' };
      }
      const rows = (data ?? []) as StoredProcurementLink[];
      const macroByTaxId =
        country.industryByActivity && hooks.activityMacroByTaxId
          ? await hooks.activityMacroByTaxId(serviceClient, rows.map((r) => r.supplier_tax_id)).catch(() => new Map<string, string>())
          : undefined;
      const listed = suppliersFromLinks(rows, macroIndustryKey, country.classifier, macroByTaxId);
      if (!listed.ok || listed.suppliers.length === 0) return listed;
      const workers = await workersByTaxId(listed.suppliers.map((s) => s.taxId));
      return {
        ...listed,
        suppliers: listed.suppliers.map((s) => (workers.has(s.taxId) ? { ...s, officialWorkers: workers.get(s.taxId) } : s)),
      };
    },

    // Las entidades públicas ya quedaron fuera al cargar (el lector sólo entrega empresas).
    listPublicOnlyTaxIds: async () => new Set<string>(),

    findDomainsByTaxId: async (taxIds) => {
      const domains = new Map<string, string>();
      if (country.domainSourceKeys.length === 0 || taxIds.length === 0) return domains;
      const { data, error } = await serviceClient
        .from('source_company_snapshots')
        .select('tax_id, normalized_tax_id, source_key, raw_data')
        .eq('country_code', country.countryCode)
        .in('source_key', [...country.domainSourceKeys])
        .or(taxIdFilter(taxIds.flatMap(formsOf)));
      if (error) {
        logError(country.countryCode, 'domains', error);
        return domains;
      }
      // El orden de `domainSourceKeys` manda: la primera fuente con web gana.
      const rows = (data ?? []) as SnapshotRow[];
      for (const sourceKey of country.domainSourceKeys) {
        for (const row of rows.filter((r) => r.source_key === sourceKey)) {
          const owner = ownerOf(row, taxIds, formsOf);
          const host = normalizeWebsiteHost(text(row.raw_data?.website_domain) ?? text(row.raw_data?.website));
          if (owner && host && !domains.has(owner)) domains.set(owner, host);
        }
      }
      return domains;
    },
  };
}
