/**
 * Agente 3 · Primera llamada — dependencias reales (sólo servidor).
 *
 * Reutiliza lo que ya existe: alcance comercial de la empresa (`getAccountById`),
 * modelo activo y credencial de Configuración → IA, tope de «Presupuesto y
 * créditos», descarga segura de páginas, HubSpot en sólo lectura, listas curadas,
 * árbol de empresas y el registro común de `provider_usage_logs`.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { getAccountById } from '@/modules/accounts/actions';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { getTavilyApiKey } from '@/server/services/tavily-connection';
import { runAnthropicConversation } from '../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '../prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { CLAUDE_PAGE_MAX_HTML_BYTES } from '../prospecting-toolkit/claude-classifier/page-text';
import { checkHubSpotCompanyCommercialStatus } from '../prospecting-toolkit/hubspot-commercial-checker';
import { fetchSafePageHtml } from '../prospecting-toolkit/website-verifier';
import { normalizeLatamCuratedName } from '@/server/source-catalog/connectors/latam-curated/latam-curated-rows';
import type { CorporateRelation, HubSpotRelation, InternalContext } from './internal-facts';
import { runTavilyNewsSearch } from './news-search';
import { curatedListLabels, mapBriefRow, readPriorClassification } from './row-mappers';
import type { BriefPatch, FirstCallContext, PackInsert, RunFirstCallDeps, UsageLogInput } from './run-first-call';
import { AGENT3_USAGE_AGENT_KEY, AGENT3_VERSION, type FirstCallRequest } from './types';

/** Sitios del Estado y de clínicas responden lento (mismo tope que el clasificador). */
const PAGE_TIMEOUT_MS = 15_000;
/** Por petición a Claude; el recorrido entero cabe en los 300 s de la ruta. */
const ANTHROPIC_TIMEOUT_MS = 90_000;
/** Una investigación que no se movió en este tiempo se da por caída. */
export const RESEARCH_RUNNING_STALE_MS = 5 * 60 * 1000;
/**
 * Tope de TODAS las llamadas a Claude de una corrida, desde que empieza: deja margen
 * para guardar antes de los 300 s de la ruta. Pasado, la conversación se corta
 * (`deadline_exceeded`) y la ficha o el paquete quedan con ese error, nunca colgados.
 */
const RUN_DEADLINE_MS = 250_000;

const CURATED_SOURCE_KEY = 'latam_curated_directory';

async function readCuratedLists(account: { name: string; domain: string | null; country_code: string | null }): Promise<string[]> {
  if (!account.country_code) return [];
  const admin = createSupabaseAdminClient();
  const base = () =>
    admin
      .from('source_company_snapshots')
      .select('raw_data')
      .eq('source_key', CURATED_SOURCE_KEY)
      .eq('country_code', account.country_code!.toUpperCase())
      .limit(3);
  const queries = [base().eq('normalized_legal_name', normalizeLatamCuratedName(account.name))];
  if (account.domain) queries.push(base().eq('raw_data->>website_domain', account.domain.replace(/^www\./, '')));
  try {
    const results = await Promise.all(queries);
    const labels = results.flatMap((r) => (r.data ?? []).flatMap((row) => curatedListLabels((row as { raw_data: unknown }).raw_data)));
    return [...new Set(labels)];
  } catch {
    return [];
  }
}

async function readRelations(accountId: string): Promise<CorporateRelation[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('agent1_company_relationships')
    .select('related_name, relation_type, related_country_code')
    .eq('root_account_id', accountId)
    .limit(20);
  if (error || !data) return [];
  return (data as Array<{ related_name: string; relation_type: CorporateRelation['relationType']; related_country_code: string | null }>).map(
    (r) => ({ name: r.related_name, relationType: r.relation_type, countryCode: r.related_country_code }),
  );
}

async function readOriginClassification(accountId: string, metadata: Record<string, unknown>) {
  const admin = createSupabaseAdminClient();
  const byConversion = await admin
    .from('prospect_candidates')
    .select('metadata')
    .eq('converted_account_id', accountId)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (byConversion.data) return readPriorClassification((byConversion.data as { metadata: unknown }).metadata);
  const fallbackId = typeof metadata.converted_from_candidate_id === 'string' ? metadata.converted_from_candidate_id : null;
  if (!fallbackId) return null;
  const byId = await admin.from('prospect_candidates').select('metadata').eq('id', fallbackId).maybeSingle();
  return byId.data ? readPriorClassification((byId.data as { metadata: unknown }).metadata) : null;
}

async function readHubSpot(account: {
  name: string;
  domain: string | null;
  tax_identifier: string | null;
  country_code: string | null;
}): Promise<HubSpotRelation | null> {
  try {
    const check = await checkHubSpotCompanyCommercialStatus({
      name: account.name,
      domain: account.domain,
      taxId: account.tax_identifier,
      countryCode: account.country_code,
    });
    if (!check.connected) return { status: 'not_connected', lifecycleStage: null, lastActivityDate: null, numberOfDeals: null };
    return {
      status: check.commercialStatus,
      lifecycleStage: check.match?.lifecycleStage ?? null,
      lastActivityDate: check.match?.lastActivityDate ?? null,
      numberOfDeals: check.match?.numberOfDeals ?? null,
    };
  } catch {
    return null;
  }
}

async function readDecisionMaker(accountId: string, contactId: string | null) {
  if (!contactId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('contacts')
    .select('id, full_name, first_name, last_name, job_title, department')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; full_name: string | null; first_name: string | null; last_name: string | null; job_title: string | null; department: string | null };
  const name = row.full_name ?? [row.first_name, row.last_name].filter(Boolean).join(' ');
  return { id: row.id, name: name || 'Contacto', title: row.job_title, department: row.department };
}

async function readBriefState(accountId: string, nowMs: number) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('account_research_briefs')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(5);
  const rows = (data ?? []) as Record<string, unknown>[];
  const researchRunning = rows.some(
    (r) => r.status === 'running' && nowMs - Date.parse(r.created_at as string) < RESEARCH_RUNNING_STALE_MS,
  );
  const fresh = rows.find(
    (r) =>
      (r.status === 'sufficient' || r.status === 'partial') &&
      typeof r.expires_at === 'string' &&
      Date.parse(r.expires_at) > nowMs,
  );
  return { currentBrief: fresh ? mapBriefRow(fresh) : null, researchRunning };
}

function packRow(pack: PackInsert, userId: string): Record<string, unknown> {
  return {
    account_id: pack.accountId,
    brief_id: pack.briefId,
    contact_id: pack.contactId,
    target_name: pack.targetName,
    target_title: pack.targetTitle,
    channel: pack.channel,
    goal: pack.goal,
    product_focus: pack.productFocus,
    // Los hechos van con el paquete: sus IDs (F1…) son los que el texto cita, aunque la
    // empresa se vuelva a investigar y la ficha nueva numere distinto.
    pack: pack.content ? { ...pack.content, facts: pack.facts } : { facts: pack.facts },
    status: pack.status,
    verifier_issues: pack.verifierIssues,
    regenerated_from_id: pack.regeneratedFromId,
    regeneration_reason: pack.regenerationReason,
    cost_usd: pack.costUsd,
    model: pack.model,
    agent_version: AGENT3_VERSION,
    error_code: pack.errorCode,
    created_by: userId,
  };
}

function briefPatchRow(patch: BriefPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.progressStage !== undefined) row.progress_stage = patch.progressStage;
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.facts !== undefined) row.facts = patch.facts;
  if (patch.hypotheses !== undefined) row.hypotheses = patch.hypotheses;
  if (patch.gaps !== undefined) row.gaps = patch.gaps;
  if (patch.sources !== undefined) row.sources = patch.sources;
  if (patch.rejectedFacts !== undefined) row.rejected_facts = patch.rejectedFacts;
  if (patch.costUsd !== undefined) row.cost_usd = patch.costUsd;
  if (patch.model !== undefined) row.model = patch.model;
  if (patch.errorCode !== undefined) row.error_code = patch.errorCode;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt;
  return row;
}

async function logUsage(entry: UsageLogInput, userId: string): Promise<void> {
  await logProviderUsage({
    provider_key: entry.providerKey,
    operation_key: entry.operationKey,
    agent_key: AGENT3_USAGE_AGENT_KEY,
    agent_step: entry.agentStep,
    ...(entry.model ? { model: entry.model } : {}),
    input_tokens: entry.usage?.inputTokens ?? 0,
    output_tokens: entry.usage?.outputTokens ?? 0,
    ...(entry.credits !== null ? { credits_used: entry.credits } : {}),
    estimated_cost_usd: entry.costUsd,
    status: entry.status,
    ...(entry.errorCode ? { error_code: entry.errorCode } : {}),
    duration_ms: entry.durationMs,
    triggered_by: userId,
    metadata: {
      ...entry.metadata,
      flow: 'agent3_first_call',
      agent_version: AGENT3_VERSION,
      ...(entry.usage
        ? {
            cache_read_input_tokens: entry.usage.cacheReadInputTokens,
            cache_creation_input_tokens: entry.usage.cacheCreationInputTokens,
            web_search_requests: entry.usage.webSearchRequests,
          }
        : {}),
    },
  });
}

/** Contexto de la empresa para quien la pide. `null` si no existe o está fuera de su cartera. */
export async function loadFirstCallContext(request: FirstCallRequest, userId: string): Promise<FirstCallContext | null> {
  const account = await getAccountById(request.accountId);
  if (!account || account.pipeline_status === 'archived') return null;
  const metadata =
    account.metadata && typeof account.metadata === 'object' && !Array.isArray(account.metadata)
      ? (account.metadata as Record<string, unknown>)
      : {};

  const admin = createSupabaseAdminClient();
  const [classification, curatedLists, relations, hubspot, decisionMaker, seller, briefState] = await Promise.all([
    readOriginClassification(account.id, metadata).catch(() => null),
    readCuratedLists(account),
    readRelations(account.id),
    readHubSpot(account),
    readDecisionMaker(account.id, request.contactId),
    admin.from('internal_users').select('full_name').eq('id', userId).maybeSingle(),
    readBriefState(account.id, Date.now()),
  ]);

  const internal: InternalContext = {
    account: {
      id: account.id,
      name: account.name,
      legalName: account.legal_name,
      website: account.website,
      domain: account.domain,
      country: account.country,
      countryCode: account.country_code,
      industry: account.industry,
      companySize: account.company_size,
      taxIdentifier: account.tax_identifier,
      taxIdentifierType: account.tax_identifier_type,
      hubspotCompanyId: account.hubspot_company_id,
    },
    classification,
    curatedLists,
    relations,
    hubspot,
    decisionMaker,
  };
  const fullName = (seller.data as { full_name: string | null } | null)?.full_name ?? null;
  return {
    internal,
    sellerName: fullName ? fullName.split(/\s+/)[0] : null,
    currentBrief: briefState.currentBrief,
    researchRunning: briefState.researchRunning,
  };
}

export function buildLiveFirstCallDeps(userId: string): RunFirstCallDeps {
  const admin = createSupabaseAdminClient();
  const deadlineAtMs = Date.now() + RUN_DEADLINE_MS;
  return {
    loadContext: (request) => loadFirstCallContext(request, userId),
    resolveModels: async () => {
      const active = await resolveActiveAnthropicModel();
      if ('error' in active) return { error: active.error };
      const extractionModel = process.env.AGENT3_EXTRACTION_MODEL?.trim() || active.model;
      return { apiKey: active.apiKey, writerModel: active.model, extractionModel };
    },
    checkBudget: async (providerKey) => {
      try {
        const quota = await checkProviderQuotaAvailable(providerKey);
        return { allowed: quota.allowed };
      } catch {
        // Sin poder leer el presupuesto no se gasta.
        return { allowed: false, reason: 'quota_read_failed' };
      }
    },
    fetchPage: (url) => fetchSafePageHtml(url, PAGE_TIMEOUT_MS, CLAUDE_PAGE_MAX_HTML_BYTES),
    searchNews: async (input) => runTavilyNewsSearch(input, await getTavilyApiKey()),
    runConversation: (body, apiKey) =>
      runAnthropicConversation({ apiKey, body, timeoutMs: ANTHROPIC_TIMEOUT_MS, deadlineAtMs }),
    createBrief: async (accountId) => {
      // Una investigación «en curso» de hace más de 5 minutos se cayó: se cierra para
      // que no bloquee la nueva (el índice único sólo deja una «running» por empresa).
      await admin
        .from('account_research_briefs')
        .update({ status: 'failed', progress_stage: null, error_code: 'stale_running', completed_at: new Date().toISOString() })
        .eq('account_id', accountId)
        .eq('status', 'running')
        .lt('created_at', new Date(Date.now() - RESEARCH_RUNNING_STALE_MS).toISOString());
      const { data, error } = await admin
        .from('account_research_briefs')
        .insert({ account_id: accountId, status: 'running', progress_stage: 'reading_sellup', agent_version: AGENT3_VERSION, created_by: userId })
        .select('id')
        .single();
      // 23505: otra investigación de esta empresa ganó la carrera (dos clics a la vez).
      if (error?.code === '23505') return null;
      if (error || !data) throw new Error(`brief_insert_failed:${error?.message ?? 'no_row'}`);
      return (data as { id: string }).id;
    },
    updateBrief: async (briefId, patch) => {
      const { error } = await admin.from('account_research_briefs').update(briefPatchRow(patch)).eq('id', briefId);
      if (error) console.error('[agent3] brief update failed:', error.message);
    },
    insertPack: async (pack) => {
      // El paquete que se rehace tiene que ser de la MISMA empresa; si no, no se enlaza.
      if (pack.regeneratedFromId) {
        const { data: previous } = await admin
          .from('first_call_packs')
          .select('account_id')
          .eq('id', pack.regeneratedFromId)
          .maybeSingle();
        if ((previous as { account_id: string } | null)?.account_id !== pack.accountId) {
          pack = { ...pack, regeneratedFromId: null };
        }
      }
      const { data, error } = await admin.from('first_call_packs').insert(packRow(pack, userId)).select('id').single();
      if (error || !data) throw new Error(`pack_insert_failed:${error?.message ?? 'no_row'}`);
      return (data as { id: string }).id;
    },
    logUsage: (entry) => logUsage(entry, userId),
    now: () => Date.now(),
  };
}
