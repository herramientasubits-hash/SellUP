/**
 * AGENT1-SUPPLIER-SEARCH-ALL-1 — consultas genéricas de un país «loaded»: la entidad y sus
 * proveedores salen de `public_procurement_supplier_links` (sólo service_role); la web y
 * los trabajadores, de las fuentes del país en `source_company_snapshots`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWebsiteHost } from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import { buyersFromLinks, suppliersFromLinks, type StoredProcurementLink } from '../procurement-links';
import { indexWebsitesByName, matchWebsitesByName, type NamedWebsite } from '../website-by-name';
import {
  PUBLIC_BUYER_MAX_SUPPLIERS,
  type FrequentPublicStepDeps,
  type PublicBuyerStepDeps,
  type PublicBuyerSupplier,
  type PublicEntityLookup,
} from '../public-buyer-suppliers';
import type { LoadedCountrySource } from './types';

export const PROCUREMENT_LINKS_TABLE = 'public_procurement_supplier_links';
/**
 * Filas por página al buscar la entidad. Cada entidad tiene MUCHAS filas (una por
 * proveedor): se pagina por código de comprador saltando la entidad ya vista.
 */
export const BUYER_PAGE_SIZE = 200;
/** Entidades distintas que se aceptan como candidatas; más ⇒ lista cortada ⇒ ambigua. */
export const BUYER_CANDIDATE_LIMIT = 25;
/** Páginas como mucho al buscar la entidad (sin terminar ⇒ lista cortada ⇒ ambigua). */
export const BUYER_MAX_PAGES = 5;
/** Proveedores de la entidad por página (de más a menos monto). */
export const SUPPLIER_PAGE_SIZE = 200;
/** Páginas como mucho de proveedores: 1.000 filas por entidad. */
export const SUPPLIER_MAX_PAGES = 5;
/**
 * La industria se decide en JS (regla del 50 % o actividad oficial), DESPUÉS de leer: la
 * tabla no tiene columna de industria. Se sigue leyendo hasta tener estos proveedores en
 * la industria pedida (el paso ofrece 12; holgura para chicas y consorcios que saca).
 */
export const SUPPLIER_TARGET_IN_INDUSTRY = PUBLIC_BUYER_MAX_SUPPLIERS * 5;

export type CountryLookups = Omit<PublicBuyerStepDeps, 'writeWithWebsite' | 'recordWithoutWebsite'> & {
  /** AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — sólo países «loaded» (la tabla tiene a todas las entidades). */
  listFrequentSuppliers?: FrequentPublicStepDeps['listFrequentSuppliers'];
};

/** AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — filas que pide a la función 154 (más entidades primero). */
export const FREQUENT_SUPPLIER_MAX_ROWS = 3000;
/**
 * AGENT1-SUPPLIER-WEB-BY-NAME-1 — fichas con web del país que se leen para cruzar por
 * nombre (páginas de 1.000; medido 21-10: el país con más, Argentina, ~2.400).
 */
export const NAMED_WEBSITE_PAGE_SIZE = 1000;
export const NAMED_WEBSITE_MAX_PAGES = 10;
/** Números fiscales por consulta a las fichas (actividad, trabajadores): la URL tiene límite. */
export const SNAPSHOT_LOOKUP_CHUNK = 150;

/** Una fila de `list_frequent_public_procurement_suppliers` (migración 154). */
type FrequentSupplierRow = {
  supplier_tax_id: string;
  supplier_name: string;
  buyer_count: number | string;
  total_amount: number | string;
  order_count: number | string;
  amount_by_family: Record<string, number | string> | null;
  top_buyer_names: string[] | null;
  top_order_url: string | null;
  last_order_on: string | null;
  window_start: string;
};

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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

  // AGENT1-SUPPLIER-WEB-BY-NAME-1 — índice nombre → web del país, leído una vez por corrida.
  let websiteIndex: Promise<Map<string, string>> | null = null;
  const loadWebsiteIndex = async (): Promise<Map<string, string>> => {
    const rows: NamedWebsite[] = [];
    for (let page = 0; page < NAMED_WEBSITE_MAX_PAGES; page++) {
      const from = page * NAMED_WEBSITE_PAGE_SIZE;
      const { data, error } = await serviceClient
        .from('source_company_snapshots')
        .select('legal_name, website_domain:raw_data->>website_domain, website:raw_data->>website')
        .eq('country_code', country.countryCode)
        // Las fichas de entidades públicas no son proveedores.
        .not('source_key', 'like', '%public_entities')
        .or('raw_data->>website_domain.not.is.null,raw_data->>website.not.is.null')
        .order('id', { ascending: true })
        .range(from, from + NAMED_WEBSITE_PAGE_SIZE - 1);
      if (error) throw new Error(`named_websites_failed:${error.message}`);
      const pageRows = (data ?? []) as Array<{ legal_name: string | null; website_domain: string | null; website: string | null }>;
      for (const row of pageRows) {
        const host = normalizeWebsiteHost(text(row.website_domain) ?? text(row.website));
        if (host) rows.push({ legalName: row.legal_name, host });
      }
      if (pageRows.length < NAMED_WEBSITE_PAGE_SIZE) break;
    }
    return indexWebsitesByName(rows);
  };

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

  /**
   * Entidades DISTINTAS cuyo nombre cumple el filtro, en orden fijo por código. Se pagina
   * saltando la última entidad vista (`buyer_code > última`), así una entidad con miles de
   * proveedores no tapa a las demás. Más de `BUYER_CANDIDATE_LIMIT` o páginas sin terminar
   * ⇒ `truncated` (el paso no elige de una lista cortada). Error ⇒ `null`.
   */
  const distinctBuyers = async (filter: { op: 'eq' | 'like'; value: string }): Promise<PublicEntityLookup | null> => {
    const seen: Array<Pick<StoredProcurementLink, 'buyer_code' | 'buyer_name_normalized'>> = [];
    const codes = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < BUYER_MAX_PAGES; page++) {
      let query = links().select('buyer_code, buyer_name_normalized').eq('country_code', country.countryCode).eq('source_key', country.sourceKey);
      query = filter.op === 'eq' ? query.eq('buyer_name_normalized', filter.value) : query.like('buyer_name_normalized', filter.value);
      if (after !== null) query = query.gt('buyer_code', after);
      const { data, error } = await query.order('buyer_code', { ascending: true }).limit(BUYER_PAGE_SIZE);
      if (error) {
        logError(country.countryCode, 'find buyers', error);
        return null;
      }
      const rows = (data ?? []) as Array<Pick<StoredProcurementLink, 'buyer_code' | 'buyer_name_normalized'>>;
      for (const row of rows) {
        if (codes.has(row.buyer_code)) continue;
        codes.add(row.buyer_code);
        seen.push(row);
      }
      if (codes.size > BUYER_CANDIDATE_LIMIT) return { rows: buyersFromLinks(seen).slice(0, BUYER_CANDIDATE_LIMIT), truncated: true };
      if (rows.length < BUYER_PAGE_SIZE) return { rows: buyersFromLinks(seen), truncated: false };
      after = rows[rows.length - 1].buyer_code;
    }
    return { rows: buyersFromLinks(seen), truncated: true };
  };

  return {
    sourceKey: country.sourceKey,
    taxIdentifierType: country.taxIdentifierType,
    normalizeName: country.normalizeBuyerName,

    findPublicEntities: async (normalizedName) => {
      // Primero el nombre exacto: si existe, decide (como en `pickPublicBuyer`) y las que sólo
      // empiezan igual no importan. Si no, las que empiezan por el nombre seguido de espacio.
      // AGENT1-SUPPLIER-AUDIT-NOW-1 — un error de lectura NO es «no es entidad pública»:
      // se lanza y el paso queda `failed:…` en el lote (antes, una caída pasaba por empresa privada).
      const exact = await distinctBuyers({ op: 'eq', value: normalizedName });
      if (exact === null) throw new Error(`public_entity_lookup_failed:${country.countryCode}`);
      if (exact.truncated || exact.rows.length > 0) return exact;
      const prefix = await distinctBuyers({ op: 'like', value: `${normalizedName.replace(/[%_]/g, '')} %` });
      if (prefix === null) throw new Error(`public_entity_lookup_failed:${country.countryCode}`);
      return prefix;
    },

    listSuppliers: async ({ buyerTaxId, macroIndustryKey }) => {
      const rows: StoredProcurementLink[] = [];
      const macroByTaxId = new Map<string, string>();
      const useActivity = Boolean(country.industryByActivity && hooks.activityMacroByTaxId);
      let inIndustry = 0;
      for (let page = 0; page < SUPPLIER_MAX_PAGES; page++) {
        const from = page * SUPPLIER_PAGE_SIZE;
        const { data, error } = await links()
          .select('buyer_code, buyer_name_normalized, supplier_tax_id, supplier_name, total_amount, order_count, amount_by_family, last_order_on, top_order_url, window_start')
          .eq('country_code', country.countryCode)
          .eq('source_key', country.sourceKey)
          .eq('buyer_code', buyerTaxId)
          .order('total_amount', { ascending: false })
          // Desempate fijo (proveedor único por entidad) para que las páginas no se pisen.
          .order('supplier_tax_id', { ascending: true })
          .range(from, from + SUPPLIER_PAGE_SIZE - 1);
        if (error) {
          logError(country.countryCode, 'suppliers', error);
          // Sin la primera página no hay nada; después, lo leído es correcto (los de más monto).
          if (page === 0) return { ok: false, reason: 'source_unavailable' };
          break;
        }
        const pageRows = (data ?? []) as StoredProcurementLink[];
        if (useActivity && pageRows.length > 0) {
          const macros = await hooks.activityMacroByTaxId!(serviceClient, pageRows.map((r) => r.supplier_tax_id)).catch(() => new Map<string, string>());
          for (const [taxId, macro] of macros) macroByTaxId.set(taxId, macro);
        }
        rows.push(...pageRows);
        const pageListed = suppliersFromLinks(pageRows, macroIndustryKey, country.classifier, useActivity ? macroByTaxId : undefined);
        inIndustry += pageListed.ok ? pageListed.suppliers.length : 0;
        if (pageRows.length < SUPPLIER_PAGE_SIZE || inIndustry >= SUPPLIER_TARGET_IN_INDUSTRY) break;
      }
      const listed = suppliersFromLinks(rows, macroIndustryKey, country.classifier, useActivity ? macroByTaxId : undefined);
      if (!listed.ok || listed.suppliers.length === 0) return listed;
      const workers = await workersByTaxId(listed.suppliers.map((s) => s.taxId));
      return {
        ...listed,
        suppliers: listed.suppliers.map((s) => (workers.has(s.taxId) ? { ...s, officialWorkers: workers.get(s.taxId) } : s)),
      };
    },

    // AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — empresas que le venden a varias entidades del país.
    // La función 154 agrupa y suma los montos por familia; la industria se decide aquí con la
    // tabla aprobada del país (o la actividad oficial en EC/CR), como en `listSuppliers`.
    listFrequentSuppliers: async ({ macroIndustryKey, minBuyers }) => {
      const { data, error } = await serviceClient.rpc('list_frequent_public_procurement_suppliers', {
        p_country_code: country.countryCode,
        p_min_buyers: minBuyers,
        p_limit: FREQUENT_SUPPLIER_MAX_ROWS,
      });
      if (error) {
        logError(country.countryCode, 'frequent suppliers', error);
        return { ok: false, reason: 'source_unavailable' };
      }
      const rows = (data ?? []) as FrequentSupplierRow[];
      const byTaxId = new Map(rows.map((row) => [row.supplier_tax_id, row]));
      const asLinks: StoredProcurementLink[] = rows.map((row) => ({
        buyer_code: '*',
        buyer_name_normalized: '',
        supplier_tax_id: row.supplier_tax_id,
        supplier_name: row.supplier_name,
        total_amount: row.total_amount,
        order_count: Number(row.order_count),
        amount_by_family: row.amount_by_family,
        last_order_on: row.last_order_on,
        top_order_url: row.top_order_url,
        window_start: row.window_start,
      }));
      const useActivity = Boolean(country.industryByActivity && hooks.activityMacroByTaxId);
      // Con actividad oficial, por tandas en orden (más entidades primero) hasta llenar la industria.
      const inIndustry: PublicBuyerSupplier[] = [];
      for (const part of useActivity ? chunks(asLinks, SNAPSHOT_LOOKUP_CHUNK) : [asLinks]) {
        const macros = useActivity
          ? await hooks.activityMacroByTaxId!(serviceClient, part.map((r) => r.supplier_tax_id)).catch(() => new Map<string, string>())
          : undefined;
        const listed = suppliersFromLinks(part, macroIndustryKey, country.classifier, macros);
        if (listed.ok) inIndustry.push(...listed.suppliers);
        if (inIndustry.length >= SUPPLIER_TARGET_IN_INDUSTRY) break;
      }
      const picked = inIndustry.slice(0, SUPPLIER_TARGET_IN_INDUSTRY).map((s) => {
        const row = byTaxId.get(s.taxId);
        return { ...s, buyerCount: Number(row?.buyer_count ?? 0), topBuyerNames: row?.top_buyer_names ?? [] };
      });
      const workers = new Map<string, { workers: number; year: number | null; sourceLabel: string }>();
      for (const part of chunks(picked.map((s) => s.taxId), SNAPSHOT_LOOKUP_CHUNK)) {
        for (const [taxId, value] of await workersByTaxId(part)) workers.set(taxId, value);
      }
      return {
        ok: true,
        suppliers: picked.map((s) => (workers.has(s.taxId) ? { ...s, officialWorkers: workers.get(s.taxId) } : s)),
        read: rows.length,
        outsideIndustry: rows.length - inIndustry.length,
        tableVersion: country.classifier.tableVersion,
        ...(rows[0]?.window_start ? { sinceYear: rows[0].window_start.slice(0, 4) } : {}),
      };
    },

    // AGENT1-SUPPLIER-WEB-BY-NAME-1 — por nombre exacto en las fichas del país (un error se
    // lanza: el paso lo registra y esas empresas siguen al rescate como antes).
    findDomainsByName: async (companies) => {
      if (companies.length === 0) return new Map<string, string>();
      websiteIndex ??= loadWebsiteIndex();
      try {
        return matchWebsitesByName(companies, await websiteIndex);
      } catch (error) {
        websiteIndex = null;
        throw error;
      }
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
