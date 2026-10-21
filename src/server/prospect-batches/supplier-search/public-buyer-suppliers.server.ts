/**
 * AGENT1-SUPPLIER-SEARCH-PUBLIC-1 — dependencias vivas del paso de compras públicas de
 * «Proveedores de una empresa». Las consultas de cada país (entidad, proveedores, web,
 * trabajadores) vienen del registro `countries/` (AGENT1-SUPPLIER-SEARCH-ALL-1); aquí
 * sólo se agregan las escrituras del lote, con el cliente de la sesión, como el árbol.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { persistDiscardedDispositionRows } from '@/modules/prospect-discards/pipeline-writer.server';
import { persistCountrySourceCandidates } from '@/server/prospect-batches/country-source-discovery/persist-country-source-candidates';
import { buildUnverifiedFreeDispositionRows } from '@/server/prospect-batches/country-source-discovery/free-source-unverified';
import type { FrequentPublicStepDeps, PublicBuyerStepDeps, TaggableCandidate } from './public-buyer-suppliers';
import { publicBuyerCountryLookups } from './countries/index.server';

function logError(step: string, error: unknown): void {
  console.error(`[supplier-public-buyer] ${step}:`, error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error));
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
}): PublicBuyerStepDeps & { listFrequentSuppliers?: FrequentPublicStepDeps['listFrequentSuppliers'] } {
  const writers: Pick<PublicBuyerStepDeps, 'writeWithWebsite' | 'recordWithoutWebsite'> = {
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
      // AGENT1-SUPPLIER-AUDIT-NOW-1 — el escritor no lanza: un fallo total se convierte en
      // error (el paso lo marca); uno parcial se registra.
      if (recorded.failed > 0) logError(`record without website (lote ${params.batchId})`, recorded.errors.join(' | '));
      if (recorded.failed > 0 && recorded.persisted === 0) {
        throw new Error(`record_without_website_failed:${recorded.errors[0] ?? 'unknown'}`.slice(0, 200));
      }
      return recorded.persisted;
    },
  };
  // AGENT1-SUPPLIER-SEARCH-ALL-1 — cada país da sus consultas (registro en countries/).
  const lookups = publicBuyerCountryLookups(params.countryCode, params.serviceClient);
  if (!lookups) throw new Error(`public_buyer_country_not_supported:${params.countryCode}`);
  return { ...lookups, ...writers };
}

/**
 * AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — las mismas escrituras, con la lectura de «frecuentes»
 * del país (sólo países con compras cargadas). `null` = el país no la tiene.
 */
export function buildLiveFrequentPublicStepDeps(
  params: Parameters<typeof buildLivePublicBuyerStepDeps>[0],
): FrequentPublicStepDeps | null {
  const deps = buildLivePublicBuyerStepDeps(params);
  if (!deps.listFrequentSuppliers) return null;
  return {
    sourceKey: deps.sourceKey,
    taxIdentifierType: deps.taxIdentifierType,
    listPublicOnlyTaxIds: deps.listPublicOnlyTaxIds,
    findDomainsByTaxId: deps.findDomainsByTaxId,
    writeWithWebsite: deps.writeWithWebsite,
    recordWithoutWebsite: deps.recordWithoutWebsite,
    listFrequentSuppliers: deps.listFrequentSuppliers,
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
    // AGENT1-SUPPLIER-AUDIT-NOW-1 — relee la metadata justo antes de escribir y sólo agrega
    // `relationship`: así no pisa lo que el rescate escribió mientras tanto, ni una
    // relación «Proveedor de» que llegó en el intervalo.
    updateRelationship: async (candidateId: string, relationship: Record<string, unknown>): Promise<boolean> => {
      const { data, error: readError } = await sessionClient
        .from('prospect_candidates')
        .select('metadata')
        .eq('id', candidateId)
        .maybeSingle();
      if (readError) {
        logError('tag candidate (read)', readError);
        return false;
      }
      const fresh = ((data as { metadata?: Record<string, unknown> | null } | null)?.metadata ?? {}) as Record<string, unknown>;
      const existing = fresh.relationship as { kind?: unknown } | undefined;
      if (existing && typeof existing === 'object' && existing.kind === 'supplier_of') return false;
      const { error } = await sessionClient
        .from('prospect_candidates')
        .update({ metadata: { ...fresh, relationship } })
        .eq('id', candidateId);
      if (error) logError('tag candidate', error);
      return !error;
    },
  };
}
