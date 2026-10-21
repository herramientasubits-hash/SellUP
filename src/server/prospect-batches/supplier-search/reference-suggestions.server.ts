/**
 * AGENT1-SUPPLIER-REFERENCE-SUGGEST-1 — dependencias vivas de las entidades sugeridas.
 * Ambas tablas son sólo de service_role (RLS sin políticas): se leen con ese cliente,
 * después de que la ruta comprobó la sesión.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoEntityMatch, LoadedBuyerMatch, SupplierReferenceSuggestDeps } from './reference-suggestions';

function logError(step: string, error: { message?: string } | null): void {
  console.error(`[supplier-reference-suggest] ${step}:`, error?.message ?? String(error));
}

export function buildLiveSupplierReferenceSuggestDeps(serviceClient: SupabaseClient): SupplierReferenceSuggestDeps {
  return {
    searchLoadedBuyers: async (normalizedQuery, limit) => {
      const { data, error } = await serviceClient.rpc('suggest_public_procurement_buyers', {
        p_query: normalizedQuery,
        p_country_code: null,
        p_limit: limit,
      });
      // Sin la función (154 no aplicada) o con error: no hay sugerencias, escribir sigue funcionando.
      if (error) {
        logError('loaded buyers', error);
        return [];
      }
      return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row): LoadedBuyerMatch[] => {
        const countryCode = typeof row.country_code === 'string' ? row.country_code : null;
        const buyerName = typeof row.buyer_name === 'string' ? row.buyer_name : null;
        const buyerNameNormalized = typeof row.buyer_name_normalized === 'string' ? row.buyer_name_normalized : null;
        const supplierCount = Number(row.supplier_count);
        if (!countryCode || !buyerName || !buyerNameNormalized || !Number.isFinite(supplierCount)) return [];
        return [{ countryCode, buyerName, buyerNameNormalized, supplierCount }];
      });
    },

    searchCoEntities: async (normalizedQuery, limit) => {
      const { data, error } = await serviceClient
        .from('source_company_snapshots')
        .select('legal_name, normalized_legal_name')
        .eq('source_key', 'co_public_entities')
        .like('normalized_legal_name', `%${normalizedQuery.replace(/[%_]/g, '')}%`)
        .order('normalized_legal_name', { ascending: true })
        .limit(limit);
      if (error) {
        logError('co entities', error);
        return [];
      }
      return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row): CoEntityMatch[] => {
        const legalName = typeof row.legal_name === 'string' ? row.legal_name : null;
        const normalizedLegalName = typeof row.normalized_legal_name === 'string' ? row.normalized_legal_name : null;
        return legalName && normalizedLegalName ? [{ legalName, normalizedLegalName }] : [];
      });
    },
  };
}
