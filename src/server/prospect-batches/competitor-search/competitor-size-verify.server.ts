/**
 * Agente 1 · «Competidores de una empresa» — el tamaño según Apollo (1 crédito
 * cuando encuentra la empresa, 0 si no; sólo servidor). Nunca lanza.
 */

import { isApolloCompanySearchEnabled } from '@/lib/feature-flags.server';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { creditCostUsd } from '@/modules/usage-tracking/provider-credit-cost';
import { APOLLO_PRICING_METADATA_KEY, toApolloPricingMetadata } from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';
import { enrichApolloOrganization } from '@/server/integrations/apollo-client';
import { apolloCreditUnitCost } from './competitor-apollo.server';

const SIZE_VERIFY_TIMEOUT_MS = 15_000;

export type ApolloSizeLookup =
  | { ok: true; found: boolean; employees: number | null }
  | { ok: false; reason: 'apollo_disabled' | 'apollo_quota_unavailable' | 'apollo_failed' };

export async function lookupApolloEmployeeCount(input: {
  domain: string;
  name: string;
  batchId: string;
  candidateId: string;
  usageKey: string;
  userId: string;
}): Promise<ApolloSizeLookup> {
  if (!isApolloCompanySearchEnabled()) return { ok: false, reason: 'apollo_disabled' };
  if (!(await checkProviderQuotaAvailable('apollo').catch(() => ({ allowed: false }))).allowed) {
    return { ok: false, reason: 'apollo_quota_unavailable' };
  }
  const startedAt = Date.now();
  let timedOut = false;
  const result = await Promise.race([
    enrichApolloOrganization({ domain: input.domain, name: input.name }).catch(() => null),
    new Promise<null>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve(null);
      }, SIZE_VERIFY_TIMEOUT_MS),
    ),
  ]);
  const organization = result && result.success ? (result.data ?? null) : null;
  // Sin respuesta ⇒ cobro desconocido (NULL), como el árbol; encontrada ⇒ 1; no ⇒ 0.
  const credits = timedOut || result === null ? undefined : organization ? 1 : 0;
  const unitCostUsd = await apolloCreditUnitCost().catch(() => null);
  await logProviderUsage({
    batch_id: input.batchId,
    usage_key: input.usageKey,
    provider_key: 'apollo',
    operation_key: 'organization_enrichment',
    credits_used: credits,
    results_returned: organization ? 1 : 0,
    estimated_cost_usd: creditCostUsd(credits, unitCostUsd),
    status: result && result.success ? 'success' : 'error',
    duration_ms: Date.now() - startedAt,
    triggered_by: input.userId,
    search_mode: 'competitors',
    metadata: {
      flow: 'competitor_size_verify',
      trigger: 'manual',
      candidate_id: input.candidateId,
      domain: input.domain,
      employees: organization?.estimated_num_employees ?? null,
      [APOLLO_PRICING_METADATA_KEY]: toApolloPricingMetadata('organization_enrichment'),
    },
  }).catch(() => false);
  if (!result || !result.success) return { ok: false, reason: 'apollo_failed' };
  return { ok: true, found: organization !== null, employees: organization?.estimated_num_employees ?? null };
}
