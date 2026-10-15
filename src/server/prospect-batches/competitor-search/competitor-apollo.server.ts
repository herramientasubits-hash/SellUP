/**
 * Agente 1 · «Competidores de una empresa» — Apollo como último recurso, con sus
 * dependencias reales (sólo servidor).
 *
 * Las mismas piezas que ya usa el Agente 1, sin copias de su lógica:
 *  - Apollo: `searchApolloOrganizationsPage` + `normalizeApolloOrganizationsResponse`
 *    (como el árbol), detrás de `isApolloCompanySearchEnabled` y la cuota de Apollo;
 *    las tres páginas posibles (ID de la referencia, parecidas, palabras clave) van
 *    por el mismo cliente;
 *  - registro de uso: `logProviderUsage`, una fila por página (1 crédito si trajo
 *    resultados), con `flow` distinto según la página;
 *  - juez: `buildLiveCompetitorJudge` (fuente `apollo`);
 *  - escritura: `buildProspectingPipelineCandidate` + `withOfficialIdentity` +
 *    `writeProspectingCandidates` en el lote de la corrida, reabriéndolo como la
 *    ronda de Claude (`reopenClosedBatch`). Las no elegidas no se escriben ni van
 *    al banco: no se sabe si son de la industria.
 *
 * Nunca lanza (ver `runCompetitorApolloStep`).
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isApolloCompanySearchEnabled } from '@/lib/feature-flags.server';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { buildCompetitorBatchName } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import { resolveMaxDeliveredCandidates } from '@/modules/prospect-batches/delivery-cap';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import type { CompetitorApolloRequest } from '@/modules/prospect-batches/chat-wizard-execution/wizard-competitor-run';
import { resolveApolloCountryLocation } from '@/server/agents/prospecting-toolkit/apollo-country-location';
import { APOLLO_PRICING_METADATA_KEY, toApolloPricingMetadata } from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';
import {
  normalizeApolloOrganizationsResponse,
  type ApolloOrganizationsRawPayload,
  type NormalizedApolloOrganization,
} from '@/server/agents/prospecting-toolkit/apollo-organizations-response-normalizer';
import { writeProspectingCandidates } from '@/server/agents/prospecting-toolkit/candidate-writer';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import {
  reopenClosedBatch,
  restoreClosedBatch,
  withOfficialIdentity,
} from '@/server/agents/prospecting-toolkit/claude-classifier/company-search-run.server';
import { buildLiveCompetitorJudge } from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge.server';
import { buildProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/prospecting-pipeline';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import {
  mapApolloOrganizationToSearchResult,
  type ApolloOrganizationInput,
} from '@/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider';
import { searchApolloOrganizationsPage } from '@/server/integrations/apollo-client';
import { buildBankPipelineOutput } from '@/server/prospect-batches/company-bank/prepaid-bank-draw.server';
import {
  COMPETITOR_APOLLO_PER_PAGE,
  runCompetitorApolloStep,
  type CompetitorApolloOutcome,
  type CompetitorApolloPage,
  type CompetitorApolloPagePurpose,
  type CompetitorApolloPick,
  type CompetitorApolloWriteResult,
} from './competitor-apollo';

/** `flow` del registro de uso (y prefijo de su clave) según para qué fue la página. */
const COMPETITOR_APOLLO_FLOW_BY_PURPOSE: Record<CompetitorApolloPagePurpose, string> = {
  resolve: 'competitor_apollo_resolve',
  lookalikes: 'competitor_apollo_lookalikes',
  // La de siempre: mismo `flow` y misma clave que antes de las parecidas.
  keywords: 'competitor_apollo',
};

/** Dominios recientes del mismo país × industria que se excluyen de la consulta. */
const EXCLUSION_LOOKUP_LIMIT = 300;

/** La organización normalizada en la forma que entiende el mapeo de Apollo del Agente 1. */
export function toCompetitorApolloOrganization(org: NormalizedApolloOrganization): ApolloOrganizationInput | null {
  if (!org.name?.trim()) return null;
  return {
    id: org.providerReference.providerOrganizationId,
    name: org.name,
    website_url: org.websiteUrl,
    primary_domain: org.primaryDomain,
    all_domains: org.normalizedDomains,
    linkedin_url: org.linkedinUrl,
    industry: org.industry,
    industries: org.industries,
    estimated_num_employees: org.estimatedNumEmployees,
    city: org.city,
    country: org.country,
    short_description: org.shortDescription,
    seo_description: org.seoDescription,
    description: org.description,
    keywords: org.keywords,
    organization_keywords: org.organizationKeywords,
  };
}

/** `organizations[]` es la fuente y `accounts[]` sólo completa (ver el árbol, Prod 15-10). */
export function readCompetitorApolloPage(payload: unknown): Pick<CompetitorApolloPage, 'organizations' | 'rawCount'> {
  const raw = (payload && typeof payload === 'object' ? payload : null) as ApolloOrganizationsRawPayload;
  const rawCount =
    (Array.isArray(raw?.organizations) ? raw!.organizations!.length : 0) + (Array.isArray(raw?.accounts) ? raw!.accounts!.length : 0);
  const organizations = normalizeApolloOrganizationsResponse(raw)
    .organizations.map(toCompetitorApolloOrganization)
    .filter((org): org is ApolloOrganizationInput => org !== null);
  return { organizations, rawCount };
}

async function apolloCreditUnitCost(): Promise<number | null> {
  const { data } = await createSupabaseAdminClient()
    .from('provider_pricing_config')
    .select('unit_cost_usd')
    .eq('provider_key', 'apollo')
    .eq('operation_key', 'credit')
    .eq('is_active', true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number(data.unit_cost_usd) : null;
}

/** Dominios del lote (candidatos y descartadas) y recientes del país × industria. */
async function loadCompetitorExcludedDomains(input: CompetitorApolloRequest): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const [batchRows, discarded, recent] = await Promise.all([
    admin.from('prospect_candidates').select('domain').eq('batch_id', input.batchId).not('domain', 'is', null),
    admin.from('prospect_discarded_dispositions').select('domain').eq('batch_id', input.batchId).not('domain', 'is', null),
    admin
      .from('prospect_candidates')
      .select('domain')
      .eq('country_code', input.countryCode)
      .eq('industry', input.industryName)
      .not('domain', 'is', null)
      .order('created_at', { ascending: false })
      .limit(EXCLUSION_LOOKUP_LIMIT),
  ]);
  // Fallo de lectura ⇒ se lanza: no se paga una búsqueda sin la lista de ya vistas.
  for (const read of [batchRows, discarded, recent]) {
    if (read.error) throw new Error(`competitor_apollo_exclusion_read_failed:${read.error.message}`);
  }
  return [...(batchRows.data ?? []), ...(discarded.data ?? []), ...(recent.data ?? [])]
    .map((row) => (row as { domain: string | null }).domain)
    .filter((domain): domain is string => !!domain);
}

async function buildCompetitorApolloCandidates(
  input: CompetitorApolloRequest,
  picks: readonly CompetitorApolloPick[],
): Promise<ProspectingPipelineCandidate[]> {
  const catalogContext = getCatalogContext({
    country: input.countryName,
    countryCode: input.countryCode,
    industry: input.industryName,
    searchDepth: 'standard',
  });
  const built = await Promise.all(
    picks.map(async (pick, index) => {
      const { candidate, nameQualityFiltered } = await buildProspectingPipelineCandidate(
        mapApolloOrganizationToSearchResult(pick.organization, index + 1),
        {
          country: input.countryName,
          countryCode: input.countryCode,
          industry: input.industryName,
          catalogContext,
          provider: 'apollo_organizations',
          fallbackQueryText: 'competitor_apollo',
        },
      );
      if (nameQualityFiltered) return null;
      return {
        ...candidate,
        relationshipEvidence: {
          kind: 'competitor_of' as const,
          referenceCompanyName: input.reference.name,
          evidenceUrl: null,
          evidence: pick.reason,
        },
      };
    }),
  );
  return built.filter((c): c is NonNullable<typeof c> => c !== null);
}

async function writeCompetitorApolloCandidates(
  input: CompetitorApolloRequest,
  picks: readonly CompetitorApolloPick[],
): Promise<CompetitorApolloWriteResult> {
  const candidates = await buildCompetitorApolloCandidates(input, picks);
  if (candidates.length === 0) return { persistedCount: 0, completeValidCandidates: 0, errors: [] };
  const pipelineOutput = await withOfficialIdentity(
    buildBankPipelineOutput({
      industryName: input.industryName,
      countryCode: input.countryCode,
      countryName: input.countryName,
      requestedTarget: input.target,
      candidates,
      provider: 'apollo_organizations',
    }),
  );
  // Las rondas de Claude ya cerraron el lote (`ready_for_review`) y el escritor no
  // admite lotes cerrados: se reabre JUSTO antes de escribir (como la ronda de Claude).
  const reopened = await reopenClosedBatch(input.batchId);
  try {
    const output = await writeProspectingCandidates({
      pipelineOutput,
      triggeredByUserId: input.userId,
      ownerId: input.userId,
      source: 'agent_1',
      dryRun: false,
      existingBatchId: input.batchId,
      batchName: buildCompetitorBatchName(input.reference.name, input.countryName, input.industryName),
      targetPersistibleCandidates: input.target,
      maxDeliveredCandidates: resolveMaxDeliveredCandidates(),
    });
    if (reopened && output.status === 'failed') await restoreClosedBatch(input.batchId);
    return {
      persistedCount: output.status === 'failed' ? 0 : output.candidatesCreated,
      completeValidCandidates: output.status === 'failed' ? 0 : (output.persistence?.completeValidCandidates ?? null),
      errors: output.errors,
    };
  } catch (err) {
    if (reopened) await restoreClosedBatch(input.batchId);
    throw err;
  }
}

export async function runCompetitorApolloLive(input: CompetitorApolloRequest): Promise<CompetitorApolloOutcome> {
  const judgeLive = buildLiveCompetitorJudge(input.userId);
  return runCompetitorApolloStep(input, {
    isEnabled: isApolloCompanySearchEnabled,
    checkQuota: () => checkProviderQuotaAvailable('apollo'),
    resolveLocation: resolveApolloCountryLocation,
    loadExcludedDomains: () => loadCompetitorExcludedDomains(input),
    searchPage: async (body) => {
      const result = await searchApolloOrganizationsPage(body);
      const page = readCompetitorApolloPage(result.ok ? result.payload : null);
      return { ...page, ok: result.ok, error: result.ok ? null : (result.errorBody ?? `http_${result.status ?? 'none'}`) };
    },
    logUsage: async ({ purpose, page, body, durationMs }) => {
      // 1 crédito por página con resultados (Apollo Support 29-09); una vacía no cobra.
      const credits = page.rawCount > 0 ? 1 : 0;
      const unitCostUsd = await apolloCreditUnitCost().catch(() => null);
      const flow = COMPETITOR_APOLLO_FLOW_BY_PURPOSE[purpose];
      await logProviderUsage({
        batch_id: input.batchId,
        // Una clave por página: `usage_key` es único en provider_usage_logs.
        usage_key: `${flow}:${input.clientRequestId}`,
        provider_key: 'apollo',
        operation_key: 'mixed_companies_search',
        credits_used: credits,
        results_returned: page.organizations.length,
        estimated_cost_usd: unitCostUsd === null ? 0 : credits * unitCostUsd,
        status: page.ok ? 'success' : 'error',
        error_message: page.error ?? undefined,
        duration_ms: durationMs,
        triggered_by: input.userId,
        search_mode: 'competitors',
        metadata: {
          flow,
          country_code: input.countryCode,
          non_empty_pages_charged: credits,
          keywords: body.q_organization_keyword_tags ?? null,
          lookalike_organization_ids: body.lookalike_organization_ids ?? null,
          domains_list: body.q_organization_domains_list ?? null,
          location: Array.isArray(body.organization_locations) ? body.organization_locations[0] : null,
          per_page: body.per_page ?? null,
          reference_company_name: input.reference.name,
          // Qué devolvió Apollo (sólo nombres y dominios, sin PII).
          apollo_returned: page.organizations.slice(0, COMPETITOR_APOLLO_PER_PAGE).map((o) => ({
            name: o.name,
            domain: o.primary_domain ?? null,
          })),
          pricing_source: unitCostUsd === null ? 'missing_config' : 'provider_pricing_config',
          [APOLLO_PRICING_METADATA_KEY]: toApolloPricingMetadata('organizations_search'),
        },
      });
    },
    judge: (judgeInput) => judgeLive({ ...judgeInput, batchId: input.batchId, source: 'apollo' }),
    writeCandidates: (picks) => writeCompetitorApolloCandidates(input, picks),
  });
}
