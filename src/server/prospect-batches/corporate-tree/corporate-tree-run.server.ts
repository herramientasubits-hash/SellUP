/**
 * Agente 1 · Búsqueda en árbol — dependencias reales de la corrida (sólo servidor).
 *
 * Las filas entran por la MISMA ruta de importación que usa «Importar archivo»
 * (`create-import-batch`), llamada dentro de esta petición: así la sesión del
 * vendedor, las compuertas y el rescate en segundo plano son exactamente los de
 * siempre, sin una copia que pueda divergir.
 */

import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { runAnthropicConversation } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { CLAUDE_PAGE_MAX_HTML_BYTES } from '@/server/agents/prospecting-toolkit/claude-classifier/page-text';
import {
  CLAUDE_CLASSIFIER_CONTRACT_VERSION,
  CLAUDE_CLASSIFIER_PROVIDER_KEY,
} from '@/server/agents/prospecting-toolkit/claude-classifier/types';
import { fetchSafePageHtml } from '@/server/agents/prospecting-toolkit/website-verifier';
import { POST as createImportBatch } from '@/app/api/prospect-batches/create-import-batch/route';
import { searchCorporateTreeBranch, type CorporateTreeSearchOutcome } from './corporate-tree-search';
import type { CorporateTreeImportCandidate } from './corporate-tree-plan';
import { runWithImportActionStartedAt } from '../import-action-started-at';
import type { CorporateTreeBatchCandidate, CorporateTreeRunDeps, CorporateTreeStage } from './corporate-tree-run';

export const CORPORATE_TREE_OPERATION_KEY = 'corporate_tree_search';
const RELATIONSHIPS_TABLE = 'agent1_company_relationships';
/**
 * Tiempo de CADA rama (las ramas van en paralelo), contando la segunda llamada
 * que fuerza la entrega: con 6 búsquedas web Claude tarda 30–90 s. Deja el resto
 * de los 300 s de Vercel para la importación y su rescate.
 */
export const CORPORATE_TREE_BRANCH_BUDGET_MS = 110_000;
/** Por debajo de esto no se empieza otra llamada a Claude. */
const MIN_CALL_MS = 10_000;
const OUTSIDE_SEARCH_PAGE_TIMEOUT_MS = 8_000;

function logError(scope: string, error: unknown): void {
  console.error(`[corporate-tree] ${scope}:`, error instanceof Error ? error.message : error);
}

export function buildCorporateTreeUsageLog(
  outcome: CorporateTreeSearchOutcome,
  context: { runId: string; triggeredBy: string; rootName: string },
): Parameters<typeof logProviderUsage>[0] | null {
  if (!outcome.usage) return null;
  const isError = outcome.errorCode !== null;
  return {
    usage_key: `${CORPORATE_TREE_OPERATION_KEY}:${context.runId}:${outcome.branch}`,
    provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
    operation_key: CORPORATE_TREE_OPERATION_KEY,
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
      flow: 'corporate_tree_search',
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

type ImportRouteBody = { batchId?: string; candidatesCreated?: number; error?: string; code?: string; message?: string };

/** Manda las filas por la ruta de importación, dentro de esta misma petición. */
async function importThroughExistingRoute(
  requestUrl: string,
  candidates: CorporateTreeImportCandidate[],
): Promise<{ ok: true; batchId: string; candidatesCreated: number } | { ok: false; message: string }> {
  const body = {
    import_type: 'paste',
    candidates,
    recognized_columns: ['company_name', 'country', 'country_code', 'website', 'linkedin_url', 'source_url', 'source_evidence', 'notes'],
    unrecognized_columns: [],
    total_rows: candidates.length,
    valid_rows: candidates.length,
    invalid_rows: 0,
    warning_rows: 0,
  };
  // Un cambio de versión del catálogo a mitad de camino se reintenta una vez.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await createImportBatch(
      new NextRequest(new URL('/api/prospect-batches/create-import-batch', requestUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const json = (await response.json().catch(() => ({}))) as ImportRouteBody;
    if (response.ok && json.batchId) return { ok: true, batchId: json.batchId, candidatesCreated: json.candidatesCreated ?? 0 };
    if (response.status === 409 && attempt === 0) continue;
    logError('import', `${response.status} ${json.code ?? json.error ?? ''}`);
    return { ok: false, message: 'No se pudieron guardar las empresas encontradas. Inténtalo de nuevo.' };
  }
  return { ok: false, message: 'No se pudieron guardar las empresas encontradas. Inténtalo de nuevo.' };
}

async function loadExistingRoot(
  supabase: SupabaseClient,
  ref: { candidateId: string | null; accountId: string | null },
): Promise<{ name: string; website: string | null; countryCode: string | null; candidateId: string | null; accountId: string | null } | null> {
  if (ref.candidateId) {
    const { data } = await supabase
      .from('prospect_candidates')
      .select('id, name, website, country_code')
      .eq('id', ref.candidateId)
      .maybeSingle();
    if (data) {
      return { name: data.name as string, website: (data.website as string | null) ?? null, countryCode: (data.country_code as string | null) ?? null, candidateId: data.id as string, accountId: null };
    }
  }
  if (ref.accountId) {
    const { data } = await supabase
      .from('accounts')
      .select('id, name, website, country_code')
      .eq('id', ref.accountId)
      .maybeSingle();
    if (data) {
      return { name: data.name as string, website: (data.website as string | null) ?? null, countryCode: (data.country_code as string | null) ?? null, candidateId: null, accountId: data.id as string };
    }
  }
  return null;
}

export function buildLiveCorporateTreeDeps(params: {
  /** Sesión del vendedor (lectura de la empresa de partida y del lote). */
  supabase: SupabaseClient;
  internalUserId: string;
  requestUrl: string;
  /** Inicio de la petición: el rescate de la importación reparte desde aquí. */
  actionStartedAtMs: number;
  rootNameForLogs: () => string;
  report: (stage: CorporateTreeStage) => void;
}): CorporateTreeRunDeps {
  let admin: SupabaseClient | null = null;
  const adminClient = () => (admin ??= createSupabaseAdminClient());
  return {
    loadExistingRoot: (ref) => loadExistingRoot(params.supabase, ref),
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
    logBranchUsage: async (outcome, runId) => {
      const log = buildCorporateTreeUsageLog(outcome, { runId, triggeredBy: params.internalUserId, rootName: params.rootNameForLogs() });
      if (log) await logProviderUsage(log);
    },
    importRows: (candidates) =>
      runWithImportActionStartedAt(params.actionStartedAtMs, () => importThroughExistingRoute(params.requestUrl, candidates)),
    markBatch: async (batchId, { name, clientRequestId, metadata }) => {
      const { data } = await params.supabase.from('prospect_batches').select('metadata').eq('id', batchId).single();
      const { error } = await params.supabase
        .from('prospect_batches')
        .update({
          name,
          description: 'Empresas relacionadas encontradas por la búsqueda en árbol del Agente IA.',
          client_request_id: clientRequestId,
          metadata: { ...((data?.metadata as Record<string, unknown> | null) ?? {}), ...metadata },
        })
        .eq('id', batchId);
      if (error) logError('mark batch', error);
    },
    loadBatchCandidates: async (batchId) => {
      const { data, error } = await params.supabase
        .from('prospect_candidates')
        .select('id, name, country_code, status, matched_hubspot_company_id, metadata')
        .eq('batch_id', batchId);
      if (error) logError('load candidates', error);
      return (data ?? []) as CorporateTreeBatchCandidate[];
    },
    tagCandidate: async (candidateId, metadata) => {
      const { error } = await params.supabase.from('prospect_candidates').update({ metadata }).eq('id', candidateId);
      if (error) logError('tag candidate', error);
    },
    insertRelationships: async (rows) => {
      if (rows.length === 0) return true;
      const { error } = await adminClient().from(RELATIONSHIPS_TABLE).insert(rows);
      if (error) {
        // Sin la migración 148 la corrida sigue: el lote y la metadata ya cuentan el árbol.
        logError('insert relationships', error);
        return false;
      }
      return true;
    },
    report: params.report,
    newRunId: () => randomUUID(),
    nowIso: () => new Date().toISOString(),
  };
}
