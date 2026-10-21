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
import { loadActiveTavilyMultiQueryPricing } from '@/modules/usage-tracking/provider-pricing';
import { evaluateTavilyBudgetAlertOnly } from '@/modules/budgets/tavily-budget-alert';
import { getTavilyApiKey } from '@/server/services/tavily-connection';
import { runAnthropicConversation } from '../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '../prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { CLAUDE_PAGE_MAX_HTML_BYTES } from '../prospecting-toolkit/claude-classifier/page-text';
import { checkHubSpotCompanyCommercialStatus } from '../prospecting-toolkit/hubspot-commercial-checker';
import { fetchSafePageHtml } from '../prospecting-toolkit/website-verifier';
import { normalizeLatamCuratedName } from '@/server/source-catalog/connectors/latam-curated/latam-curated-rows';
import { curatedCoreName, curatedNamesMatch, isDistinctiveCore } from './curated-match';
import type { PipelineStatus } from '@/modules/accounts/types';
import { nextAgent3Status, type Agent3StatusTarget } from './account-status';
import { FREQUENT_PUBLIC_SUPPLIER_COUNTRY_CODES } from '@/server/prospect-batches/supplier-search/countries/codes';
import { publicBuyerCountry } from '@/server/prospect-batches/supplier-search/countries';
import {
  PUBLIC_SALES_SOURCE_LABELS,
  publicSalesTaxIdForms,
  readSupplierRelationship,
  summarizePublicSales,
  type PublicSalesRow,
  type PublicSalesSummary,
} from './public-sales';
import type { CorporateRelation, HubSpotRelation, InternalContext } from './internal-facts';
import { runTavilyNewsSearch } from './news-search';
import { cachedContactResearch } from './contact-research';
import { curatedListLabels, mapBriefRow, mapPackRow, readPriorClassification } from './row-mappers';
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

/** La búsqueda ampliada sólo se apaga a propósito: `off`, `false` o `0`. */
export function isAgent3ExtendedResearchEnabled(value: string | undefined): boolean {
  return !/^(off|false|0|no)$/i.test(value?.trim() ?? '');
}
/** Preparaciones recientes del decisor que se revisan para reutilizar lo investigado. */
const CACHED_CONTACT_PACKS_READ = 8;

export async function readCuratedLists(account: { name: string; domain: string | null; country_code: string | null }): Promise<string[]> {
  if (!account.country_code) return [];
  const admin = createSupabaseAdminClient();
  const base = () =>
    admin
      .from('source_company_snapshots')
      .select('raw_data, normalized_legal_name')
      .eq('source_key', CURATED_SOURCE_KEY)
      .eq('country_code', account.country_code!.toUpperCase());
  const queries = [base().eq('normalized_legal_name', normalizeLatamCuratedName(account.name)).limit(3)];
  if (account.domain) queries.push(base().eq('raw_data->>website_domain', account.domain.replace(/^www\./, '')).limit(3));
  // Por el núcleo del nombre («Davivienda Colombia» = «BANCO DAVIVIENDA»): se traen los que
  // lo contienen y se quedan sólo los que tienen el MISMO núcleo (ver curated-match.ts).
  const core = curatedCoreName(account.name);
  if (isDistinctiveCore(core)) queries.push(base().ilike('normalized_legal_name', `%${core}%`).limit(25));
  try {
    const results = await Promise.all(queries);
    const labels = results.flatMap((r, i) =>
      ((r.data ?? []) as Array<{ raw_data: unknown; normalized_legal_name: string | null }>)
        .filter((row) => i < queries.length - 1 || !isDistinctiveCore(core) || curatedNamesMatch(account.name, row.normalized_legal_name))
        .flatMap((row) => curatedListLabels(row.raw_data)),
    );
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

/** La metadata de la candidata de la que salió la cuenta (`null` si no hay). */
async function readOriginCandidateMetadata(accountId: string, metadata: Record<string, unknown>): Promise<unknown> {
  const admin = createSupabaseAdminClient();
  const byConversion = await admin
    .from('prospect_candidates')
    .select('metadata')
    .eq('converted_account_id', accountId)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (byConversion.data) return (byConversion.data as { metadata: unknown }).metadata;
  const fallbackId = typeof metadata.converted_from_candidate_id === 'string' ? metadata.converted_from_candidate_id : null;
  if (!fallbackId) return null;
  const byId = await admin.from('prospect_candidates').select('metadata').eq('id', fallbackId).maybeSingle();
  return byId.data ? (byId.data as { metadata: unknown }).metadata : null;
}

/** Filas de compras públicas que se leen por cuenta (una por entidad compradora). */
const PUBLIC_SALES_MAX_ROWS = 1000;

/**
 * AGENT3-PUBLIC-SALES-1 — lo que la cuenta le vende al Estado, por su número fiscal, en los
 * países con compras públicas cargadas. Sin número fiscal, en otro país o con error: `null`
 * (la ficha sigue sin ese hecho).
 */
export async function readPublicSales(account: {
  tax_identifier: string | null;
  country_code: string | null;
  country: string | null;
}): Promise<PublicSalesSummary | null> {
  const countryCode = account.country_code?.toUpperCase() ?? null;
  if (!account.tax_identifier || !countryCode || !FREQUENT_PUBLIC_SUPPLIER_COUNTRY_CODES.includes(countryCode)) return null;
  const country = publicBuyerCountry(countryCode);
  if (!country) return null;
  const { data, error } = await createSupabaseAdminClient()
    .from('public_procurement_supplier_links')
    .select('buyer_code, buyer_name, total_amount, currency, order_count, first_order_on, last_order_on, top_order_url, top_order_amount')
    .eq('country_code', countryCode)
    .eq('source_key', country.sourceKey)
    .in('supplier_tax_id', publicSalesTaxIdForms(account.tax_identifier, countryCode))
    .limit(PUBLIC_SALES_MAX_ROWS);
  if (error) {
    console.error('[agent3] public sales:', error.message);
    return null;
  }
  return summarizePublicSales((data ?? []) as PublicSalesRow[], {
    countryName: account.country ?? countryCode,
    sourceLabel: PUBLIC_SALES_SOURCE_LABELS[country.sourceKey] ?? 'compras públicas',
  });
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

/** Los decisores pedidos que pertenecen a la empresa, en el orden pedido (los demás se ignoran). */
async function readDecisionMakers(accountId: string, contactIds: readonly string[]) {
  if (contactIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('contacts')
    .select('id, full_name, first_name, last_name, job_title, department, linkedin_url')
    .in('id', [...contactIds])
    .eq('account_id', accountId);
  type Row = {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    department: string | null;
    linkedin_url: string | null;
  };
  const byId = new Map(((data ?? []) as Row[]).map((row) => [row.id, row]));
  return contactIds
    .map((id) => byId.get(id))
    .filter((row): row is Row => row !== undefined)
    .map((row) => {
      const name = row.full_name ?? [row.first_name, row.last_name].filter(Boolean).join(' ');
      return { id: row.id, name: name || 'Contacto', title: row.job_title, department: row.department, linkedinUrl: row.linkedin_url };
    });
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
    // Varios objetivos en la misma columna, en orden («book_meeting,validate_owner»).
    goal: pack.goals.join(','),
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

/**
 * Costo en dólares de una consulta de Tavily: créditos × tarifa vigente. Sin tarifa
 * activa devuelve `null` (costo DESCONOCIDO, nunca un 0 fabricado), como el resto de
 * las consultas de Tavily.
 */
async function tavilyCostUsd(credits: number | null): Promise<number | null> {
  if (credits === null) return null;
  const pricing = await loadActiveTavilyMultiQueryPricing();
  return pricing ? Math.round(credits * pricing.unitCostUsd * 1_000_000) / 1_000_000 : null;
}

async function logUsage(entry: UsageLogInput, userId: string): Promise<void> {
  const isTavily = entry.providerKey === 'tavily';
  const costUsd = isTavily && entry.costUsd === null ? await tavilyCostUsd(entry.credits) : entry.costUsd;
  // Misma verificación de presupuesto «sólo avisa» que el resto de Tavily: queda en la fila
  // y la página de Presupuesto y créditos la muestra en su actividad.
  const budgetCheck = isTavily ? await evaluateTavilyBudgetAlertOnly(userId, entry.credits ?? 0, entry.operationKey) : null;
  await logProviderUsage({
    provider_key: entry.providerKey,
    operation_key: entry.operationKey,
    agent_key: AGENT3_USAGE_AGENT_KEY,
    agent_step: entry.agentStep,
    ...(entry.model ? { model: entry.model } : {}),
    input_tokens: entry.usage?.inputTokens ?? 0,
    output_tokens: entry.usage?.outputTokens ?? 0,
    ...(entry.credits !== null ? { credits_used: entry.credits } : {}),
    estimated_cost_usd: costUsd,
    results_returned: entry.resultsReturned ?? 0,
    ...(entry.countryCode ? { country_code: entry.countryCode } : {}),
    status: entry.status,
    ...(entry.errorCode ? { error_code: entry.errorCode } : {}),
    duration_ms: entry.durationMs,
    triggered_by: userId,
    metadata: {
      ...entry.metadata,
      flow: 'agent3_first_call',
      agent_version: AGENT3_VERSION,
      ...(budgetCheck ? { budget_check: budgetCheck } : {}),
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

/** Cómo se lee la empresa: con la sesión de quien pide (la app) o directo (el banco de evaluación). */
export interface FirstCallContextOptions {
  readAccount?: (accountId: string) => Promise<Awaited<ReturnType<typeof getAccountById>>>;
  /** El banco de evaluación no consulta HubSpot. */
  skipHubSpot?: boolean;
}

/** Contexto de la empresa para quien la pide. `null` si no existe o está fuera de su cartera. */
export async function loadFirstCallContext(
  request: FirstCallRequest,
  userId: string,
  options: FirstCallContextOptions = {},
): Promise<FirstCallContext | null> {
  const account = await (options.readAccount ?? getAccountById)(request.accountId);
  if (!account || account.pipeline_status === 'archived') return null;
  const metadata =
    account.metadata && typeof account.metadata === 'object' && !Array.isArray(account.metadata)
      ? (account.metadata as Record<string, unknown>)
      : {};

  const admin = createSupabaseAdminClient();
  const [originMetadata, curatedLists, relations, hubspot, decisionMakers, seller, briefState, publicSales] = await Promise.all([
    readOriginCandidateMetadata(account.id, metadata).catch(() => null),
    readCuratedLists(account),
    readRelations(account.id),
    options.skipHubSpot ? Promise.resolve(null) : readHubSpot(account),
    readDecisionMakers(account.id, request.contactIds),
    admin.from('internal_users').select('full_name').eq('id', userId).maybeSingle(),
    readBriefState(account.id, Date.now()),
    readPublicSales(account).catch(() => null),
  ]);
  const classification = originMetadata ? readPriorClassification(originMetadata) : null;

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
    publicSales,
    supplierRelationship: originMetadata ? readSupplierRelationship(originMetadata) : null,
    // Cada decisor se agrega al redactar (uno por llamada al redactor).
    decisionMaker: null,
  };
  const fullName = (seller.data as { full_name: string | null } | null)?.full_name ?? null;
  return {
    internal,
    decisionMakers,
    sellerName: fullName ? fullName.split(/\s+/)[0] : null,
    currentBrief: briefState.currentBrief,
    researchRunning: briefState.researchRunning,
  };
}

/**
 * Avanza el estado de la empresa por el agente y lo deja en el historial como un cambio
 * de estado de quien lo pidió (con `by: 'agent3'`). Sin carrera: sólo escribe si el
 * estado no cambió desde que se leyó. Un fallo no detiene la preparación.
 */
async function advanceAccountStatus(accountId: string, target: Agent3StatusTarget, userId: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from('accounts').select('pipeline_status').eq('id', accountId).maybeSingle();
    const current = ((data as { pipeline_status: PipelineStatus } | null)?.pipeline_status ?? null) as PipelineStatus | null;
    const next = nextAgent3Status(current, target);
    if (!next || !current) return;
    const { data: updated, error: updateError } = await admin
      .from('accounts')
      .update({ pipeline_status: next, updated_by: userId })
      .eq('id', accountId)
      .eq('pipeline_status', current)
      .select('id');
    if (updateError) {
      console.error('[agent3] status advance failed:', updateError.message);
      return;
    }
    if (!updated || updated.length === 0) return;
    const audit = await admin.from('account_audit').insert({
      account_id: accountId,
      actor_user_id: userId,
      action_type: 'account_status_changed',
      details: { from: current, to: next, by: 'agent3' },
    });
    if (audit.error) console.error('[agent3] status audit insert failed:', audit.error.message);
  } catch (err) {
    console.error('[agent3] status advance failed:', err instanceof Error ? err.message : err);
  }
}

export function buildLiveFirstCallDeps(userId: string): RunFirstCallDeps {
  const admin = createSupabaseAdminClient();
  const deadlineAtMs = Date.now() + RUN_DEADLINE_MS;
  return {
    loadContext: (request) => loadFirstCallContext(request, userId),
    advanceAccountStatus: (accountId, target) => advanceAccountStatus(accountId, target, userId),
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
    // Encendida por defecto (dueña 19-10); `AGENT3_EXTENDED_RESEARCH=off` vuelve a las dos búsquedas de antes.
    extendedResearch: isAgent3ExtendedResearchEnabled(process.env.AGENT3_EXTENDED_RESEARCH),
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
    readCachedContactResearch: async (accountId, contactId, sinceIso) => {
      const { data, error } = await admin
        .from('first_call_packs')
        .select('pack, status')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .neq('status', 'failed')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(CACHED_CONTACT_PACKS_READ);
      if (error || !data) return null;
      for (const row of data as Array<Record<string, unknown>>) {
        const cached = cachedContactResearch(mapPackRow({ ...row, id: '', account_id: accountId, created_at: sinceIso }).content, sinceIso);
        if (cached) return cached;
      }
      return null;
    },
    now: () => Date.now(),
  };
}
