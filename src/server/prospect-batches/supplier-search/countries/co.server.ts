/**
 * Colombia — consultas en vivo de «Proveedores de una empresa»: SECOP II por datos.gov.co
 * (GET con tiempo máximo; `SOCRATA_APP_TOKEN` opcional como `X-App-Token`) y entidades,
 * entidades públicas y webs desde `source_company_snapshots` (sólo service_role).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWebsiteHost } from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import { CO_SECOP_SUPPLIERS_SOURCE_KEY, fetchCoSecopSuppliers } from '../co-secop-suppliers';
import type { PublicEntityRow } from '../public-buyer-suppliers';
import type { CountryLookups } from './loaded-lookups.server';

const SECOP_TIMEOUT_MS = 12_000;
const ENTITY_QUERY_LIMIT = 25;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function logError(step: string, error: unknown): void {
  console.error(`[supplier-public-buyer:CO] ${step}:`, (error as { message?: string })?.message ?? String(error));
}

async function fetchSecopJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SECOP_TIMEOUT_MS);
  try {
    const token = process.env.SOCRATA_APP_TOKEN?.trim();
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SellUp/0.1 supplier-search',
        ...(token ? { 'X-App-Token': token } : {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Colombia: SECOP II en vivo; entidades, públicas y webs desde las fotos de fuentes. */
export function buildCoLookups(serviceClient: SupabaseClient): CountryLookups {
  const snapshots = () => serviceClient.from('source_company_snapshots');
  return {
    sourceKey: CO_SECOP_SUPPLIERS_SOURCE_KEY,
    taxIdentifierType: 'NIT',

    findPublicEntities: async (normalizedName) => {
      const { data, error } = await snapshots()
        .select('tax_id, normalized_legal_name, raw_data')
        .eq('source_key', 'co_public_entities')
        .like('normalized_legal_name', `${normalizedName.replace(/[%_]/g, '')}%`)
        .limit(ENTITY_QUERY_LIMIT);
      if (error) {
        logError('find entities', error);
        return [];
      }
      return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row): PublicEntityRow[] => {
        const taxId = text(row.tax_id);
        const name = text(row.normalized_legal_name);
        if (!taxId || !name) return [];
        const raw = (row.raw_data ?? {}) as Record<string, unknown>;
        return [{ taxId, normalizedLegalName: name, shortName: text(raw.chip_name), isHead: raw.entity_head === true }];
      });
    },

    listSuppliers: (input) => fetchCoSecopSuppliers(input, fetchSecopJson),

    listPublicOnlyTaxIds: async (taxIds) => {
      const { data, error } = await snapshots()
        .select('source_key, tax_id')
        .in('source_key', ['co_public_entities', 'co_siis'])
        .in('tax_id', [...taxIds]);
      if (error) {
        logError('public tax ids', error);
        return new Set<string>();
      }
      const rows = (data ?? []) as Array<{ source_key: string; tax_id: string }>;
      const inRegistry = new Set(rows.filter((r) => r.source_key === 'co_siis').map((r) => r.tax_id));
      // Entidad pública que NO está en el registro de sociedades (las mixtas como UNE o
      // Emtelco están en los dos y sí son proveedoras).
      return new Set(rows.filter((r) => r.source_key === 'co_public_entities' && !inRegistry.has(r.tax_id)).map((r) => r.tax_id));
    },

    findDomainsByTaxId: async (taxIds) => {
      const { data, error } = await snapshots()
        .select('source_key, tax_id, raw_data')
        .in('source_key', ['co_siis', 'co_public_entities'])
        .in('tax_id', [...taxIds]);
      if (error) {
        logError('domains', error);
        return new Map<string, string>();
      }
      const rows = (data ?? []) as Array<{ source_key: string; tax_id: string; raw_data: Record<string, unknown> | null }>;
      const domains = new Map<string, string>();
      // El registro de sociedades manda; la web de la entidad, sólo si no hay otra.
      for (const sourceKey of ['co_siis', 'co_public_entities']) {
        for (const row of rows.filter((r) => r.source_key === sourceKey)) {
          const host = normalizeWebsiteHost(text(row.raw_data?.website_domain));
          if (host && !domains.has(row.tax_id)) domains.set(row.tax_id, host);
        }
      }
      return domains;
    },
  };
}

