/**
 * AGENT1-SUPPLIER-SEARCH-PUBLIC-1 — dependencias vivas del paso de compras públicas de
 * «Proveedores de una empresa» (Colombia, SECOP II).
 *
 *  - `source_company_snapshots` es sólo para service_role: lecturas con el cliente de
 *    la factoría aprobada (entidad, NIT públicos, web por NIT).
 *  - SECOP: GET a datos.gov.co con tiempo máximo; `SOCRATA_APP_TOKEN` opcional
 *    (`X-App-Token`) para no depender del cupo anónimo.
 *  - Las escrituras del lote van con el cliente de la sesión, como el árbol.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { persistDiscardedDispositionRows } from '@/modules/prospect-discards/pipeline-writer.server';
import { persistCountrySourceCandidates } from '@/server/prospect-batches/country-source-discovery/persist-country-source-candidates';
import { buildUnverifiedFreeDispositionRows } from '@/server/prospect-batches/country-source-discovery/free-source-unverified';
import { normalizeWebsiteHost } from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import { CO_SECOP_SUPPLIERS_SOURCE_KEY, fetchCoSecopSuppliers } from './co-secop-suppliers';
import type { PublicBuyerStepDeps, PublicEntityRow, TaggableCandidate } from './public-buyer-suppliers';

const SECOP_TIMEOUT_MS = 12_000;
const ENTITY_QUERY_LIMIT = 25;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function logError(step: string, error: unknown): void {
  console.error(`[supplier-public-buyer] ${step}:`, error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error));
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

export function buildLivePublicBuyerStepDeps(params: {
  /** Cliente de la sesión del asistente (escrituras del lote, RLS). */
  sessionClient: SupabaseClient;
  /** Cliente de service_role (lecturas de `source_company_snapshots`). */
  serviceClient: SupabaseClient;
  batchId: string;
  countryCode: string;
  countryName: string;
  macroIndustryKey: string;
  requestedByUserId: string;
}): PublicBuyerStepDeps {
  const snapshots = () => params.serviceClient.from('source_company_snapshots');
  return {
    sourceKey: CO_SECOP_SUPPLIERS_SOURCE_KEY,

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

    writeWithWebsite: async (companies) => {
      const result = await persistCountrySourceCandidates(params.sessionClient, {
        companies,
        countryCode: params.countryCode,
        countryName: params.countryName,
        macroIndustryKey: params.macroIndustryKey,
        requestedByUserId: params.requestedByUserId,
        batchId: params.batchId,
        runHubspotCheck: true,
        metadata: {},
      });
      return { written: result.writtenCount, failed: result.failed };
    },

    recordWithoutWebsite: async (companies) => {
      const recorded = await persistDiscardedDispositionRows(
        buildUnverifiedFreeDispositionRows({ batchId: params.batchId, countryCode: params.countryCode, companies }),
      );
      return recorded.persisted;
    },
  };
}

/** Lectura y etiquetado de los candidatos del lote (cliente de la sesión). */
export function buildLivePublicBuyerTagDeps(sessionClient: SupabaseClient) {
  return {
    loadCandidates: async (batchId: string): Promise<TaggableCandidate[]> => {
      const { data, error } = await sessionClient
        .from('prospect_candidates')
        .select('id, tax_identifier, metadata')
        .eq('batch_id', batchId);
      if (error) {
        logError('load candidates', error);
        return [];
      }
      return ((data ?? []) as Array<{ id: string; tax_identifier: string | null; metadata: Record<string, unknown> | null }>).map((row) => ({
        id: row.id,
        taxIdentifier: row.tax_identifier,
        metadata: row.metadata,
      }));
    },
    updateMetadata: async (candidateId: string, metadata: Record<string, unknown>): Promise<boolean> => {
      const { error } = await sessionClient.from('prospect_candidates').update({ metadata }).eq('id', candidateId);
      if (error) logError('tag candidate', error);
      return !error;
    },
  };
}
