/**
 * Agente 1 · Búsqueda en árbol — dependencias reales de la corrida (sólo servidor).
 *
 * AGENT1-CORPORATE-TREE-2: todo por las piezas que ya usa el Agente 1, sin copias:
 *  - lote: `reserveWizardExecutionSlot` (lote `agent_1` con `client_request_id` desde
 *    el primer instante: Búsquedas, Centro de procesos y Uso de IA lo ven);
 *  - gratis: `source_company_snapshots` (registros oficiales) y `agent1_company_bank`;
 *  - registros con web: `persistCountrySourceCandidates` (capa gratuita), con HubSpot;
 *  - Claude y banco con web: `buildProspectingPipelineCandidate` + `withOfficialIdentity`
 *    + `writeProspectingCandidates` (escritor del Agente 1, mismas compuertas);
 *  - sin web: `persistDiscardedDispositionRows` (como la capa gratuita) y el rescate.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { persistDiscardedDispositionRows } from '@/modules/prospect-discards/pipeline-writer.server';
import {
  reserveWizardExecutionSlot,
  type IdempotencyDbClient,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-idempotency';
import { composeFreeOnlyTerminalBatchMetadata } from '@/modules/prospect-batches/chat-wizard-execution/free-only-terminal-publication';
import {
  CORPORATE_TREE_BATCH_INDUSTRY,
  CORPORATE_TREE_LIMITS,
  corporateTreeBatchName,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import { runAnthropicConversation } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { CLAUDE_PAGE_MAX_HTML_BYTES } from '@/server/agents/prospecting-toolkit/claude-classifier/page-text';
import {
  CLAUDE_CLASSIFIER_CONTRACT_VERSION,
  CLAUDE_CLASSIFIER_PROVIDER_KEY,
} from '@/server/agents/prospecting-toolkit/claude-classifier/types';
import { CLAUDE_COMPANY_SEARCH_OPERATION_KEY } from '@/server/agents/prospecting-toolkit/claude-classifier/company-search-run';
import { withOfficialIdentity } from '@/server/agents/prospecting-toolkit/claude-classifier/company-search-run.server';
import { scheduleClaudeRescueAfterWizardRun } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/schedule-rescue.server';
import { fetchSafePageHtml } from '@/server/agents/prospecting-toolkit/website-verifier';
import { checkHubSpotDuplicates } from '@/server/agents/prospecting-toolkit/hubspot-duplicate-checker';
import { checkSellUpDuplicates } from '@/server/agents/prospecting-toolkit/sellup-duplicate-checker';
import { buildProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/prospecting-pipeline';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import { writeProspectingCandidates } from '@/server/agents/prospecting-toolkit/candidate-writer';
import type { ProspectingPipelineCandidate, WebSearchResult } from '@/server/agents/prospecting-toolkit/types';
import { buildBankPipelineOutput } from '@/server/prospect-batches/company-bank/prepaid-bank-draw.server';
import { readBankPipelineCandidate } from '@/server/prospect-batches/company-bank/pipeline-candidate-bank-payload';
import { persistCountrySourceCandidates } from '@/server/prospect-batches/country-source-discovery/persist-country-source-candidates';
import { buildUnverifiedFreeDispositionRows } from '@/server/prospect-batches/country-source-discovery/free-source-unverified';
import { durableCandidatesFromCount, resolveBatchTerminalStatusDecision } from '@/server/prospect-batches/batch-durable-candidates';
import { searchCorporateTreeBranch, type CorporateTreeNode, type CorporateTreeSearchOutcome, type TreeCountry } from './corporate-tree-search';
import {
  escapeLikePrefix,
  findCorporateTreeFreeHits,
  prefixUpperBound,
  type FreeBankRow,
  type FreeSnapshotRow,
} from './corporate-tree-free-lookup';
import {
  pickKnownCompany,
  type CorporateTreeApolloSubsidiary,
  type CorporateTreeWebItem,
} from './corporate-tree-plan';
import { CORPORATE_TREE_POSSIBLE_HUBSPOT_REASON } from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';
import { APOLLO_COUNTRY_LOCATION_BY_CODE } from '@/server/agents/prospecting-toolkit/apollo-country-location';
import { isAgent1CorporateTreeApolloEnabled } from '@/lib/feature-flags.server';
import { enrichApolloOrganization } from '@/server/integrations/apollo-client';
import { APOLLO_PRICING_METADATA_KEY, toApolloPricingMetadata } from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import { buildColombiaOfficialSourceResolvers } from '@/server/prospect-batches/official-source-resolvers';
import {
  buildCountrySourceOfficialTaxIdLookup,
  fillMissingOfficialTaxIds,
} from '@/server/prospect-batches/country-source-discovery/country-source-official-tax-id';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import type { CorporateTreeBatchCandidate, CorporateTreeRunDeps, CorporateTreeStage } from './corporate-tree-run';

const RELATIONSHIPS_TABLE = 'agent1_company_relationships';
/** Flujo en Uso de IA: la operación es la de «Claude busca empresas» (agente 1, mismo paso). */
export const CORPORATE_TREE_USAGE_FLOW = 'corporate_tree_search';
/** Motivo en «Descartadas» de las que parecen ya estar en HubSpot (el rescate no las toma). */
export const CORPORATE_TREE_POSSIBLE_HUBSPOT_DUPLICATE_REASON = CORPORATE_TREE_POSSIBLE_HUBSPOT_REASON;

/** El nombre para buscar en Apollo: sin forma societaria («CITIGROUP CHILE SPA» ⇒ «citigroup chile»). */
/**
 * Las filiales de la ficha de Apollo (`suborganizations`; Apollo Support 15-10). Defensivo:
 * no está documentado qué trae cada una, así que se toma lo que haya (nombre, web, LinkedIn,
 * país de la sede) y se descarta lo que no tenga nombre.
 */
export function readApolloSubsidiaries(organization: unknown): CorporateTreeApolloSubsidiary[] {
  const record = organization && typeof organization === 'object' ? (organization as Record<string, unknown>) : null;
  const list = Array.isArray(record?.['suborganizations']) ? (record!['suborganizations'] as unknown[]) : [];
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const out: CorporateTreeApolloSubsidiary[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const sub = entry as Record<string, unknown>;
    const name = text(sub['name']);
    if (!name) continue;
    const website = text(sub['website_url']);
    const domain = text(sub['primary_domain']) ?? text(sub['domain']) ?? (website ? normalizeDomain(website) : null);
    const country = text(sub['country']) ?? text(sub['organization_country']) ?? text(sub['hq_country']);
    const countryCode =
      (country && Object.entries(APOLLO_COUNTRY_LOCATION_BY_CODE).find(([, en]) => en.toLowerCase() === country.toLowerCase())?.[0]) ??
      (country && country.length === 2 ? country.toUpperCase() : null);
    out.push({ name, domain, website, linkedinUrl: text(sub['linkedin_url']), countryCode });
  }
  return out;
}

/**
 * Tiempo de CADA rama de Claude (van en paralelo), contando la segunda llamada que
 * fuerza la entrega. Deja el resto de los 300 s a lo gratis, la escritura y el rescate.
 */
export const CORPORATE_TREE_BRANCH_BUDGET_MS = 100_000;
const MIN_CALL_MS = 10_000;
const OUTSIDE_SEARCH_PAGE_TIMEOUT_MS = 8_000;
/** Consultas gratis a la vez (registros por país × fuente). */
const FREE_LOOKUP_CONCURRENCY = 8;
const SNAPSHOT_COLUMNS =
  'source_key, country_code, legal_name, normalized_legal_name, tax_id, normalized_tax_id, city, region, record_identity_key, raw_data';

function logError(scope: string, error: unknown): void {
  console.error(`[corporate-tree] ${scope}:`, error instanceof Error ? error.message : error);
}

/** Uso de IA: misma operación que «Claude busca empresas», con el lote y la forma «árbol». */
export function buildCorporateTreeUsageLog(
  outcome: CorporateTreeSearchOutcome,
  context: { runId: string; batchId: string; triggeredBy: string; rootName: string },
): Parameters<typeof logProviderUsage>[0] | null {
  if (!outcome.usage) return null;
  const isError = outcome.errorCode !== null;
  return {
    batch_id: context.batchId,
    usage_key: `${CLAUDE_COMPANY_SEARCH_OPERATION_KEY}:${context.runId}:${outcome.branch}`,
    provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
    operation_key: CLAUDE_COMPANY_SEARCH_OPERATION_KEY,
    model: outcome.usage.model,
    input_tokens: outcome.usage.inputTokens,
    output_tokens: outcome.usage.outputTokens,
    results_returned: outcome.nodes.length,
    estimated_cost_usd: outcome.usage.estimatedCostUsd,
    status: isError && outcome.errorCode === 'rate_limited' ? 'rate_limited' : isError ? 'error' : 'success',
    error_code: outcome.errorCode ?? undefined,
    triggered_by: context.triggeredBy,
    metadata: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      flow: CORPORATE_TREE_USAGE_FLOW,
      search_mode: 'corporate_tree',
      run_id: context.runId,
      branch: outcome.branch,
      root_name: context.rootName,
      proposed: outcome.proposed,
      rejected: outcome.rejected,
      web_search_requests: outcome.usage.webSearchRequests,
      pricing_source: outcome.usage.pricingSource,
    },
  };
}

/** Limita cuántas promesas corren a la vez. */
function limiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

/** Un nodo de Claude como resultado de «Claude busca empresas»: el constructor de siempre lo convierte. */
export function corporateTreeNodeToSearchResult(node: CorporateTreeNode, rank: number): WebSearchResult {
  return {
    title: node.name,
    url: node.website ?? '',
    snippet: node.relationDetail,
    source: 'claude_web_search',
    rank,
    provider: 'claude',
    confidence: null,
    metadata: {
      claude_company_search: true,
      corporate_tree_relation: node.branch,
      evidence_source_url: node.evidenceUrl,
      ...(node.websiteUnverified ? { website_unverified: true } : {}),
      ...(node.linkedinUrl ? { linkedin_url: node.linkedinUrl } : {}),
    },
  };
}

async function loadExistingRoot(
  supabase: SupabaseClient,
  ref: { candidateId: string | null; accountId: string | null },
): Promise<{ name: string; website: string | null; countryCode: string | null } | null> {
  if (ref.candidateId) {
    const { data } = await supabase.from('prospect_candidates').select('name, website, country_code').eq('id', ref.candidateId).maybeSingle();
    if (data) return { name: data.name as string, website: (data.website as string | null) ?? null, countryCode: (data.country_code as string | null) ?? null };
  }
  if (ref.accountId) {
    const { data } = await supabase.from('accounts').select('name, website, country_code').eq('id', ref.accountId).maybeSingle();
    if (data) return { name: data.name as string, website: (data.website as string | null) ?? null, countryCode: (data.country_code as string | null) ?? null };
  }
  return null;
}

async function buildWebCandidates(country: TreeCountry, items: readonly CorporateTreeWebItem[]): Promise<ProspectingPipelineCandidate[]> {
  const catalogContext = getCatalogContext({
    country: country.name,
    countryCode: country.code,
    industry: CORPORATE_TREE_BATCH_INDUSTRY,
    searchDepth: 'standard',
  });
  const built = await Promise.all(
    items.map(async (item, index) => {
      if (item.bankCandidate) return item.bankCandidate;
      if (!item.node?.website) return null;
      const { candidate, nameQualityFiltered } = await buildProspectingPipelineCandidate(
        corporateTreeNodeToSearchResult(item.node, index + 1),
        {
          country: country.name,
          countryCode: country.code,
          industry: CORPORATE_TREE_BATCH_INDUSTRY,
          catalogContext,
          provider: 'claude',
          fallbackQueryText: 'corporate_tree',
        },
      );
      // El nombre es el que Claude leyó en la fuente, no uno inferido del título.
      return nameQualityFiltered ? null : { ...candidate, name: item.node.name };
    }),
  );
  return built.filter((c): c is ProspectingPipelineCandidate => c !== null);
}

export function buildLiveCorporateTreeDeps(params: {
  /** Sesión del vendedor (RLS): lote, candidatos, empresa de partida. */
  supabase: SupabaseClient;
  internalUserId: string;
  clientRequestId: string;
  actionStartedAtMs: number;
  rootNameForLogs: () => string;
  report: (stage: CorporateTreeStage) => void;
}): CorporateTreeRunDeps {
  let admin: SupabaseClient | null = null;
  const adminClient = () => (admin ??= createSupabaseAdminClient());
  const limit = limiter(FREE_LOOKUP_CONCURRENCY);
  // La cuota de Apollo se mira una vez por corrida; sin cuota no se llama.
  let apolloQuota: Promise<{ allowed: boolean }> | null = null;
  const apolloCreditUnitCost = async (): Promise<number | null> => {
    const { data } = await adminClient()
      .from('provider_pricing_config')
      .select('unit_cost_usd')
      .eq('provider_key', 'apollo')
      .eq('operation_key', 'credit')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? Number(data.unit_cost_usd) : null;
  };

  return {
    loadExistingRoot: (ref) => loadExistingRoot(params.supabase, ref),

    reserveBatch: ({ root, batchCountry, branches, countryCodes }) =>
      reserveWizardExecutionSlot(
        {
          userId: params.internalUserId,
          clientRequestId: params.clientRequestId,
          initialBatchPayload: {
            requestSource: 'chat_wizard',
            catalogVersionId: null,
            industryId: null,
            subindustryIds: [],
            countryCode: batchCountry.code,
            additionalCriteria: null,
            targetCount: CORPORATE_TREE_LIMITS.maxRows,
            country: batchCountry.name,
            industry: CORPORATE_TREE_BATCH_INDUSTRY,
            searchDepth: 'standard',
            corporateTree: {
              rootName: root.name,
              rootCountryCode: root.countryCode,
              branches,
              countryCodes,
              rootCandidateId: root.candidateId,
              rootAccountId: root.accountId,
            },
          },
        },
        params.supabase as unknown as IdempotencyDbClient,
      ),

    findFreeHits: (input) =>
      findCorporateTreeFreeHits(input, {
        querySnapshotsByPrefix: (sourceKey, prefix, max) =>
          limit(async () => {
            const { data, error } = await adminClient()
              .from('source_company_snapshots')
              .select(SNAPSHOT_COLUMNS)
              .eq('source_key', sourceKey)
              .gte('normalized_legal_name', prefix)
              .lt('normalized_legal_name', prefixUpperBound(prefix))
              .limit(max);
            if (error) throw error;
            return (data ?? []) as unknown as FreeSnapshotRow[];
          }),
        queryBankByNamePrefix: (countryCodes, prefix, max) =>
          limit(async () => {
            const { data, error } = await adminClient()
              .from('agent1_company_bank')
              .select('id, country_code, source_provider, payload')
              .in('country_code', [...countryCodes])
              .eq('status', 'banked')
              .ilike('payload->candidate->>name', `${escapeLikePrefix(prefix)}%`)
              .limit(max);
            if (error) throw error;
            return (data ?? []) as unknown as FreeBankRow[];
          }),
        readBankCandidate: readBankPipelineCandidate,
      }),

    resolveActiveModel: resolveActiveAnthropicModel,
    checkQuota: () => checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY),
    searchBranch: (input, model, apiKey) => {
      const deadlineMs = Date.now() + CORPORATE_TREE_BRANCH_BUDGET_MS;
      return searchCorporateTreeBranch(input, model, {
        runConversation: (body) => {
          const remainingMs = deadlineMs - Date.now();
          if (remainingMs < MIN_CALL_MS) return Promise.reject(new Error('corporate_tree_time_budget'));
          return runAnthropicConversation({ apiKey, body, timeoutMs: remainingMs });
        },
        fetchPage: (url) => fetchSafePageHtml(url, OUTSIDE_SEARCH_PAGE_TIMEOUT_MS, CLAUDE_PAGE_MAX_HTML_BYTES),
      });
    },
    logBranchUsage: async (outcome, ctx) => {
      const log = buildCorporateTreeUsageLog(outcome, { ...ctx, triggeredBy: params.internalUserId, rootName: params.rootNameForLogs() });
      if (log) await logProviderUsage(log);
    },

    fillOfficialTaxIds: async (companies) => {
      const lookUp = buildCountrySourceOfficialTaxIdLookup(buildColombiaOfficialSourceResolvers());
      return fillMissingOfficialTaxIds(companies, lookUp);
    },

    findApolloFamily: isAgent1CorporateTreeApolloEnabled()
      ? async ({ rootDomain, rootName }, ctx) => {
          apolloQuota ??= checkProviderQuotaAvailable('apollo').catch(() => ({ allowed: false }));
          if (!(await apolloQuota).allowed) return null;
          const unitCostUsd = await apolloCreditUnitCost();
          const startedAt = Date.now();
          const result = await enrichApolloOrganization({ domain: rootDomain, name: rootName });
          const organization = result.success ? result.data ?? null : null;
          const subsidiaries = readApolloSubsidiaries(organization);
          const rawSubs = (organization as Record<string, unknown> | null)?.['suborganizations'];
          // 1 crédito por empresa encontrada; sin coincidencia, 0 (Apollo Support 01-10 y 15-10).
          const credits = organization ? 1 : 0;
          await logProviderUsage({
            batch_id: ctx.batchId,
            usage_key: `corporate_tree_apollo_family:${params.clientRequestId}`,
            provider_key: 'apollo',
            operation_key: 'organization_enrichment',
            credits_used: credits,
            results_returned: subsidiaries.length,
            estimated_cost_usd: unitCostUsd === null ? 0 : credits * unitCostUsd,
            status: result.success ? 'success' : 'error',
            error_message: result.success ? undefined : result.error?.message,
            duration_ms: Date.now() - startedAt,
            triggered_by: params.internalUserId,
            metadata: {
              flow: CORPORATE_TREE_USAGE_FLOW,
              search_mode: 'corporate_tree',
              root_domain: rootDomain,
              // Lo que trae cada filial (no está documentado): para ajustar el paso con datos reales.
              suborganization_count: Array.isArray(rawSubs) ? rawSubs.length : 0,
              suborganization_fields:
                Array.isArray(rawSubs) && rawSubs[0] && typeof rawSubs[0] === 'object' ? Object.keys(rawSubs[0] as object).slice(0, 40) : [],
              suborganizations_sample: subsidiaries.slice(0, 15),
              ultimate_parent: (organization as Record<string, unknown> | null)?.['ultimate_parent_organization'] ?? null,
              pricing_source: unitCostUsd === null ? 'missing_config' : 'provider_pricing_config',
              [APOLLO_PRICING_METADATA_KEY]: toApolloPricingMetadata('organization_enrichment'),
            },
          }).catch(() => undefined);
          return organization ? subsidiaries : null;
        }
      : undefined,

    writeFreeCatalog: async (batchId, country, companies) => {
      const result = await persistCountrySourceCandidates(params.supabase, {
        companies,
        countryCode: country.code,
        countryName: country.name,
        macroIndustryKey: '',
        requestedByUserId: params.internalUserId,
        batchId,
        runHubspotCheck: true,
        metadata: {},
      });
      return { written: result.writtenCount, failed: result.failed };
    },

    writeWeb: async (batchId, country, items) => {
      const candidates = await buildWebCandidates(country, items);
      if (candidates.length === 0) return { written: 0, errors: [] };
      const pipelineOutput = await withOfficialIdentity(
        buildBankPipelineOutput({
          industryName: CORPORATE_TREE_BATCH_INDUSTRY,
          countryCode: country.code,
          countryName: country.name,
          requestedTarget: candidates.length,
          candidates,
          provider: 'tavily',
        }),
      );
      const output = await writeProspectingCandidates({
        pipelineOutput,
        triggeredByUserId: params.internalUserId,
        ownerId: params.internalUserId,
        source: 'agent_1',
        dryRun: false,
        existingBatchId: batchId,
        // La adopción recalcula el nombre en cada escritura: se le pasa el del árbol.
        batchName: corporateTreeBatchName(params.rootNameForLogs()),
        // El lote lo sella la corrida al final (escribe varias veces, una por país).
        holdBatchStatus: true,
        targetPersistibleCandidates: CORPORATE_TREE_LIMITS.maxRows,
        // El tope de 10 por vendedor es de «Empresas por criterios»: el árbol entrega su familia.
        maxDeliveredCandidates: null,
      });
      return { written: output.status === 'failed' ? 0 : output.candidatesCreated, errors: output.errors };
    },

    findKnownCompany: async ({ name, countryCode }) => {
      const countryName = LATAM_COUNTRIES.find((c) => c.code === countryCode)?.name ?? null;
      const input = { name, countryCode, country: countryName };
      const [hubspot, sellup] = await Promise.all([
        checkHubSpotDuplicates(input).catch(() => ({ connected: false as const, skipped: true as const, matches: [] as [] })),
        checkSellUpDuplicates(input).catch(() => []),
      ]);
      const sellupMatches = sellup.filter((m) => m.status === 'existing_in_sellup' && !!m.matchedId);
      const hubspotIdByAccount = new Map<string, string | null>();
      if (sellupMatches.length > 0) {
        const { data } = await params.supabase
          .from('accounts')
          .select('id, hubspot_company_id')
          .in('id', sellupMatches.map((m) => m.matchedId as string));
        for (const row of data ?? []) hubspotIdByAccount.set(row.id as string, (row.hubspot_company_id as string | null) ?? null);
      }
      return pickKnownCompany({
        hubspot: hubspot.matches,
        sellup: sellupMatches,
        countryCode,
        countryName,
        countryAliases: countryCode && APOLLO_COUNTRY_LOCATION_BY_CODE[countryCode] ? [APOLLO_COUNTRY_LOCATION_BY_CODE[countryCode]] : [],
        accountHubspotId: (id) => hubspotIdByAccount.get(id) ?? null,
      });
    },

    recordPossibleDuplicates: async (batchId, countryCode, items) => {
      const byKey = new Map(items.map((item) => [item.company.recordIdentityKey, item.matchedName]));
      const rows = buildUnverifiedFreeDispositionRows({ batchId, countryCode, companies: items.map((i) => i.company) }).map((row) => {
        const matchedName = byKey.get(row.providerIdentifier ?? '') ?? null;
        return {
          ...row,
          disposition: 'hubspot_duplicate' as const,
          reasonCode: CORPORATE_TREE_POSSIBLE_HUBSPOT_DUPLICATE_REASON,
          reasonDetail: matchedName
            ? `Posible duplicado en HubSpot: «${matchedName}» (mismo país). No se buscó su web; rescátala si no es la misma empresa.`
            : 'Posible duplicado en HubSpot (mismo país). No se buscó su web; rescátala si no es la misma empresa.',
        };
      });
      const recorded = await persistDiscardedDispositionRows(rows);
      return recorded.persisted;
    },

    recordWithoutWebsite: async (batchId, countryCode, companies) => {
      const recorded = await persistDiscardedDispositionRows(
        buildUnverifiedFreeDispositionRows({ batchId, countryCode, companies }),
      );
      return recorded.persisted;
    },

    loadBatchCandidates: async (batchId) => {
      const { data, error } = await params.supabase
        .from('prospect_candidates')
        .select('id, name, country_code, domain, industry, status, matched_hubspot_company_id, metadata')
        .eq('batch_id', batchId);
      if (error) {
        logError('load candidates', error);
        return null;
      }
      return (data ?? []) as CorporateTreeBatchCandidate[];
    },
    tagCandidate: async (candidateId, metadata) => {
      const { error } = await params.supabase.from('prospect_candidates').update({ metadata }).eq('id', candidateId);
      if (error) logError('tag candidate', error);
    },
    clearBatchIndustryLabel: async (batchId) => {
      // La etiqueta sólo servía para escribir: la empresa queda SIN industria pedida y el
      // rescate la clasifica por lo que es (una filial de otro sector no se descarta).
      const { error } = await params.supabase
        .from('prospect_candidates')
        .update({ industry: null })
        .eq('batch_id', batchId)
        .eq('industry', CORPORATE_TREE_BATCH_INDUSTRY);
      if (error) logError('clear industry label', error);
    },
    insertRelationships: async (rows) => {
      if (rows.length === 0) return true;
      const { error } = await adminClient().from(RELATIONSHIPS_TABLE).insert(rows);
      if (error) {
        logError('insert relationships', error);
        return false;
      }
      return true;
    },

    sealBatch: async (batchId, { persisted, failed, metadata, country }) => {
      const decision = resolveBatchTerminalStatusDecision({
        preExisting: durableCandidatesFromCount(0),
        persistedCandidates: persisted,
        persistenceFailureCount: failed ? 1 : 0,
      });
      const { data: current } = await params.supabase.from('prospect_batches').select('metadata').eq('id', batchId).maybeSingle();
      const { error } = await params.supabase
        .from('prospect_batches')
        .update({
          ...(decision.action === 'write' ? { status: decision.status } : {}),
          ...(country ? { country: country.name, country_code: country.code } : {}),
          name: corporateTreeBatchName(params.rootNameForLogs()),
          metadata: composeFreeOnlyTerminalBatchMetadata(current?.metadata, metadata),
        })
        .eq('id', batchId);
      if (error) logError('seal batch', error);
    },

    scheduleRescue: (batchId) =>
      scheduleClaudeRescueAfterWizardRun({ ok: true, batchId }, async () => params.internalUserId, params.actionStartedAtMs, {
        includeUnassessed: true,
      }),

    report: params.report,
    newRunId: () => randomUUID(),
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}
