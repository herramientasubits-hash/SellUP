import 'server-only';

// Agente 2A — Cableado del paso posterior a «Buscar contactos» (ver contact-search-follow-up-core.ts).
// Lo llaman la ruta de búsqueda y la acción del servidor, ambas con la sesión del vendedor: la
// aprobación automática es la MISMA `approveContactCandidate` del botón «Aprobar».

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { approveContactCandidate } from './actions';
import type { RunAutomaticContactEnrichmentForRequestResult } from './automatic-routing-action-core';
import { isContactRunInScope } from './candidate-scope';
import { resolveCandidateScopeIds } from './candidate-scope.server';
import { runContactSearchFollowUp, type FollowUpPendingCandidate } from './contact-search-follow-up-core';

/** Corridas históricas por empresa que se miran como mucho (misma cota que el reúso local). */
const COMPANY_RUN_LIMIT = 200;
const RUN_ID_CHUNK = 200;

interface RunRow {
  id: string;
  triggered_by: string | null;
  account: unknown;
}

function scopeFacts(row: RunRow) {
  const raw = Array.isArray(row.account) ? row.account[0] : row.account;
  const account = (raw ?? null) as { owner_id?: string | null; created_by?: string | null } | null;
  return {
    triggered_by: row.triggered_by ?? null,
    account_owner_id: account?.owner_id ?? null,
    account_created_by: account?.created_by ?? null,
  };
}

async function loadEarlierCompanyRunIds(requestId: string, currentRunIds: readonly string[]): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const { data: request, error } = await admin
    .from('contact_enrichment_requests')
    .select('account_id, hubspot_company_id')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const accountId = (request?.account_id as string | null | undefined)?.trim() || null;
  const hubspotCompanyId = (request?.hubspot_company_id as string | null | undefined)?.trim() || null;
  if (!accountId && !hubspotCompanyId) return [];

  const select = 'id, triggered_by, account:accounts ( owner_id, created_by )';
  const legs = await Promise.all([
    accountId
      ? admin.from('contact_enrichment_runs').select(select).eq('account_id', accountId).limit(COMPANY_RUN_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    hubspotCompanyId
      ? admin
          .from('contact_enrichment_runs')
          .select(select)
          .eq('hubspot_company_id', hubspotCompanyId)
          .limit(COMPANY_RUN_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const leg of legs) if (leg.error) throw new Error(leg.error.message);

  // Lo que el vendedor ve en «Por revisar»: el mismo alcance comercial de la lista.
  const scopeIds = await resolveCandidateScopeIds();
  const current = new Set(currentRunIds);
  const ids = new Set<string>();
  for (const leg of legs) {
    for (const row of (leg.data ?? []) as RunRow[]) {
      if (!row?.id || current.has(row.id)) continue;
      if (isContactRunInScope(scopeFacts(row), scopeIds)) ids.add(row.id);
    }
  }
  return [...ids];
}

async function loadPendingCandidates(runIds: readonly string[]): Promise<FollowUpPendingCandidate[]> {
  const admin = createSupabaseAdminClient();
  const rows: FollowUpPendingCandidate[] = [];
  for (let i = 0; i < runIds.length; i += RUN_ID_CHUNK) {
    const chunk = runIds.slice(i, i + RUN_ID_CHUNK);
    const { data, error } = await admin
      .from('contact_enrichment_candidates')
      .select('id, source, email, phone, linkedin_url, enrichment_run_id')
      .in('enrichment_run_id', chunk)
      .eq('status', 'pending_review');
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as FollowUpPendingCandidate[]));
  }
  return rows;
}

/**
 * Después de la búsqueda: pasa a Contactos los contactos de HubSpot completos y cuenta lo que
 * sigue en «Por revisar» de búsquedas anteriores. Nunca lanza.
 */
export async function completeContactSearch(
  requestId: string,
  result: RunAutomaticContactEnrichmentForRequestResult,
): Promise<RunAutomaticContactEnrichmentForRequestResult> {
  try {
    return await runContactSearchFollowUp(requestId, result, {
      loadEarlierCompanyRunIds,
      loadPendingCandidates,
      approveCandidate: (candidateId) => approveContactCandidate(candidateId),
    });
  } catch (err) {
    console.error('[contact-search-follow-up] failed', { requestId, error: err });
    return result;
  }
}
