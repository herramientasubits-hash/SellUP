/**
 * Agente 1 · «Competidores de una empresa» — datos del MAPA de una referencia
 * (sólo servidor). Lotes y candidatas con la sesión de la persona (RLS: ve lo que
 * puede ver); de HubSpot sólo se LEE si la competidora ya es cliente (etapa
 * «Cliente» o estado «Customer»), en lote, sin escribir nada. Nunca lanza.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import { buildCompetitorMap, type CompetitorMap, type CompetitorMapCandidate } from '@/modules/prospect-batches/competitor-search/competitor-map';
import { HUBSPOT_CUSTOMER_LIFECYCLE_VALUES } from '@/server/integrations/hubspot-free-company-policy';
import { getHubSpotToken } from '@/server/integrations/hubspot-company-create';
import { fetchHubSpotWithRetry } from '@/server/integrations/hubspot-rate-limit';

const HUBSPOT_API = 'https://api.hubapi.com';
/** HubSpot lee hasta 100 empresas por llamada en lote. */
const HUBSPOT_BATCH_READ_MAX = 100;
const HUBSPOT_TIMEOUT_MS = 8_000;
const MAP_BATCH_LIMIT = 30;
const MAP_CANDIDATE_LIMIT = 500;
const SAFE_DOMAIN = /^[a-z0-9.-]+$/;

/** Regla de «cliente» de la bolsa libre de HubSpot (la misma etapa y estado). */
export function isHubSpotCustomerProperties(properties: Record<string, unknown> | null | undefined): boolean {
  const lifecycle = typeof properties?.lifecyclestage === 'string' ? properties.lifecyclestage.trim() : '';
  const leadStatus = typeof properties?.hs_lead_status === 'string' ? properties.hs_lead_status.trim() : '';
  return (lifecycle !== '' && HUBSPOT_CUSTOMER_LIFECYCLE_VALUES.has(lifecycle)) || leadStatus === 'Customer';
}

/** IDs de HubSpot que son clientes. Fallo ⇒ conjunto vacío (el mapa sale sin la marca). */
export async function readHubSpotCustomerIds(
  ids: readonly string[],
  options: { fetchFn?: typeof fetch; resolveToken?: () => Promise<string | null> } = {},
): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((id) => /^\d+$/.test(id)))].slice(0, HUBSPOT_BATCH_READ_MAX);
  if (unique.length === 0) return new Set();
  try {
    const token = await (options.resolveToken ?? getHubSpotToken)();
    if (!token) return new Set();
    const res = await fetchHubSpotWithRetry(
      `${HUBSPOT_API}/crm/v3/objects/companies/batch/read`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: ['lifecyclestage', 'hs_lead_status'], inputs: unique.map((id) => ({ id })) }),
      },
      HUBSPOT_TIMEOUT_MS,
      options.fetchFn ? { fetchFn: options.fetchFn } : {},
    );
    if (!res.ok) return new Set();
    const body = (await res.json()) as { results?: Array<{ id?: string; properties?: Record<string, unknown> }> };
    return new Set(
      (body.results ?? []).filter((r) => r.id && isHubSpotCustomerProperties(r.properties)).map((r) => r.id as string),
    );
  } catch (err) {
    console.error('[competitor-map] HubSpot read failed (non-critical):', err instanceof Error ? err.message : err);
    return new Set();
  }
}

/** El mapa de la referencia en todas sus búsquedas (todos los países que la persona ve). */
export async function loadCompetitorMap(
  supabase: SupabaseClient,
  reference: Pick<CompetitorReference, 'name' | 'domain'>,
): Promise<CompetitorMap | null> {
  try {
    let batches = supabase.from('prospect_batches').select('id').eq('metadata->>search_mode', 'competitors');
    batches =
      reference.domain && SAFE_DOMAIN.test(reference.domain)
        ? batches.eq('metadata->competitor_search->reference->>domain', reference.domain)
        : batches.eq('metadata->competitor_search->reference->>name', reference.name);
    const { data: batchRows, error } = await batches.order('created_at', { ascending: false }).limit(MAP_BATCH_LIMIT);
    if (error || !batchRows || batchRows.length === 0) return null;
    const { data, error: candidatesError } = await supabase
      .from('prospect_candidates')
      .select('name, domain, country_code, status, matched_hubspot_company_id, metadata')
      .in('batch_id', (batchRows as Array<{ id: string }>).map((row) => row.id))
      .limit(MAP_CANDIDATE_LIMIT);
    if (candidatesError || !data) return null;
    const candidates = data as CompetitorMapCandidate[];
    const customers = await readHubSpotCustomerIds(
      candidates.map((c) => c.matched_hubspot_company_id).filter((id): id is string => !!id),
    );
    return buildCompetitorMap(candidates, customers);
  } catch (err) {
    console.error('[competitor-map] load failed (non-critical):', err instanceof Error ? err.message : err);
    return null;
  }
}
