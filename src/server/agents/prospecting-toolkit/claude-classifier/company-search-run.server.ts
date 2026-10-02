/**
 * Agente 1 · «Claude busca empresas» — dependencias reales (sólo servidor).
 *
 * Lecturas: el lote origen y los dominios ya vistos para el mismo país × industria.
 * Escritura: SÓLO por `writeProspectingCandidates` (lote nuevo, mismas compuertas que
 * Tavily) y el registro de uso. 0 escrituras en HubSpot (los duplicados se LEEN).
 */

import { randomUUID } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { resolveMaxDeliveredCandidates } from '@/modules/prospect-batches/delivery-cap';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { writeProspectingCandidates } from '../candidate-writer';
import { runProspectingPipeline } from '../prospecting-pipeline';
import { resolveTavilyCountryRegions } from '../tavily-country-regions';
import type { ProspectingPipelineOutput } from '../types';
import { withClaudeSearchContext, type ClaudeSearchRunContext } from '../web-search-providers/claude-web-search-provider';
import { resolveActiveAnthropicModel } from './classify-batch-candidates.server';
import {
  CLAUDE_COMPANY_SEARCH_METADATA_KEY,
  CLAUDE_COMPANY_SEARCH_RESULTS_PER_QUERY,
  CLAUDE_COMPANY_SEARCH_TARGET,
  type ClaudeCompanySearchDeps,
  type SourceBatch,
} from './company-search-run';
import { CLAUDE_CLASSIFIER_PROVIDER_KEY } from './types';

/** Dominios recientes por tabla: lo más nuevo pesa más (Claude ve los primeros 80). */
const EXCLUSION_LOOKUP_LIMIT = 300;

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
}

async function loadSourceBatch(batchId: string): Promise<SourceBatch | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('prospect_batches')
    .select('id, country, country_code, industry, source, metadata')
    .eq('id', batchId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id: string;
    country: string | null;
    country_code: string | null;
    industry: string | null;
    source: string | null;
    metadata: Record<string, unknown> | null;
  };
  if (row.source !== 'agent_1' || !row.country || !row.country_code || !row.industry) return null;
  const metadata = row.metadata ?? {};
  const taxonomy = (metadata.apollo_discovery_taxonomy ?? {}) as {
    requested_subindustries?: unknown;
    macro_industry_key?: unknown;
  };
  const pilot = (metadata[CLAUDE_COMPANY_SEARCH_METADATA_KEY] ?? {}) as { macro_industry_key?: unknown };
  const macroIndustryKey =
    typeof taxonomy.macro_industry_key === 'string'
      ? taxonomy.macro_industry_key
      : typeof pilot.macro_industry_key === 'string'
        ? pilot.macro_industry_key
        : null;
  const subindustries = stringList(metadata.subindustries);
  return {
    id: row.id,
    country: row.country,
    countryCode: row.country_code,
    industry: row.industry,
    industryId: typeof metadata.industry_id === 'string' ? metadata.industry_id : null,
    macroIndustryKey,
    subindustries: subindustries.length > 0 ? subindustries : stringList(taxonomy.requested_subindustries),
    additionalCriteria: typeof metadata.additional_criteria === 'string' ? metadata.additional_criteria : null,
  };
}

/**
 * Dominios del banco de empresas (migración 142) para el mismo país × macro.
 * Fail-OPEN: si la tabla no existe todavía (142 sin aplicar) o la lectura falla, la
 * corrida sigue con candidatos + descartadas, que son la lista principal.
 */
async function loadBankDomains(countryCode: string, macroIndustryKey: string | null): Promise<string[]> {
  if (!macroIndustryKey) return [];
  const { data, error } = await createSupabaseAdminClient()
    .from('agent1_company_bank')
    .select('claim_domain')
    .eq('country_code', countryCode)
    .eq('macro_industry_key', macroIndustryKey)
    .in('status', ['banked', 'reserved'])
    .not('claim_domain', 'is', null)
    .limit(EXCLUSION_LOOKUP_LIMIT);
  if (error) {
    console.warn('[claude-company-search] company bank unavailable:', error.message);
    return [];
  }
  return (data ?? []).map((r) => (r as { claim_domain: string | null }).claim_domain).filter((d): d is string => !!d);
}

async function loadExcludedDomains(source: SourceBatch): Promise<string[]> {
  const { countryCode, industry } = source;
  const admin = createSupabaseAdminClient();
  const [candidates, dispositions, bankDomains] = await Promise.all([
    admin
      .from('prospect_candidates')
      .select('domain')
      .eq('country_code', countryCode)
      .eq('industry', industry)
      .not('domain', 'is', null)
      .order('created_at', { ascending: false })
      .limit(EXCLUSION_LOOKUP_LIMIT),
    admin
      .from('prospect_discarded_dispositions')
      .select('domain')
      .eq('country_code', countryCode)
      .eq('industry', industry)
      .not('domain', 'is', null)
      .order('created_at', { ascending: false })
      .limit(EXCLUSION_LOOKUP_LIMIT),
    loadBankDomains(countryCode, source.macroIndustryKey).catch(() => []),
  ]);
  // Fallo de lectura ⇒ se lanza: la corrida NO busca sin la lista de ya conocidas.
  if (candidates.error) throw new Error(`exclusion_candidates_read_failed:${candidates.error.message}`);
  if (dispositions.error) throw new Error(`exclusion_dispositions_read_failed:${dispositions.error.message}`);
  const domains = [...(candidates.data ?? []), ...(dispositions.data ?? [])]
    .map((r) => (r as { domain: string | null }).domain)
    .filter((d): d is string => !!d);
  return [...new Set([...domains, ...bankDomains])];
}

async function countPreviousRuns(countryCode: string, industry: string): Promise<number> {
  const { count, error } = await createSupabaseAdminClient()
    .from('prospect_batches')
    .select('id', { count: 'exact', head: true })
    .eq('country_code', countryCode)
    .eq('industry', industry)
    .not(`metadata->${CLAUDE_COMPANY_SEARCH_METADATA_KEY}`, 'is', null);
  if (error) throw new Error(`previous_runs_read_failed:${error.message}`);
  return count ?? 0;
}

export function buildLiveClaudeCompanySearchDeps(userId: string): ClaudeCompanySearchDeps {
  return {
    loadSourceBatch,
    loadExcludedDomains,
    countPreviousRuns,
    resolveRegions: resolveTavilyCountryRegions,
    resolveActiveModel: resolveActiveAnthropicModel,
    checkQuota: () => checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY),
    runSearch: async ({ source, queries, excludeDomains, active, deadlineAtMs, onCall }) => {
      const context: ClaudeSearchRunContext = {
        model: active.model,
        apiKey: active.apiKey,
        countryName: source.country,
        industryName: source.industry,
        subindustries: source.subindustries,
        additionalCriteria: source.additionalCriteria,
        excludeDomains: [...excludeDomains],
        calls: [],
        deadlineAtMs,
        onCall,
      };
      const pipelineOutput = await withClaudeSearchContext(context, () =>
        runProspectingPipeline({
          country: source.country,
          countryCode: source.countryCode,
          industry: source.industry,
          webSearchProvider: 'claude',
          mode: 'multi_query',
          queryOverrides: queries,
          maxResultsPerQuery: CLAUDE_COMPANY_SEARCH_RESULTS_PER_QUERY,
          targetCount: CLAUDE_COMPANY_SEARCH_TARGET,
          excludeDomains,
          ...(source.subindustries.length > 0 ? { subindustries: source.subindustries } : {}),
        }),
      );
      return { pipelineOutput, calls: context.calls };
    },
    writeCandidates: async ({ pipelineOutput, metadata, existingBatchId }) => {
      const output = await writeProspectingCandidates({
        pipelineOutput: pipelineOutput as ProspectingPipelineOutput,
        triggeredByUserId: userId,
        ownerId: userId,
        source: 'agent_1',
        dryRun: false,
        targetPersistibleCandidates: CLAUDE_COMPANY_SEARCH_TARGET,
        maxDeliveredCandidates: resolveMaxDeliveredCandidates(),
        extraBatchMetadata: metadata,
        // Paso del asistente: escribe en el lote de la corrida y NO sella su estado
        // (lo decide la finalización del asistente, como con el banco).
        ...(existingBatchId ? { existingBatchId, holdBatchStatus: true } : {}),
      });
      return {
        batchId: output.status === 'failed' ? null : output.batchId,
        candidatesCreated: output.candidatesCreated,
        completeValidCandidates: output.persistence?.completeValidCandidates ?? null,
        acceptedCandidateIds: output.persistence?.acceptedCandidateIds ?? [],
        errors: output.errors,
      };
    },
    logUsage: logProviderUsage,
    newRunId: () => randomUUID(),
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}
