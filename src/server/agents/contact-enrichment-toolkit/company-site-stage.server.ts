// AGENT2-COMPANY-SITE-PEOPLE-1 — personas del sitio web de la empresa (etapa de servidor)
//
// Corre sólo cuando Apollo no dejó ningún candidato. Lee la portada y hasta cuatro páginas
// del sitio oficial (equipo, «nosotros», sostenibilidad, prensa), le pide a Claude quién está
// nombrado con su cargo, verifica cada persona contra el texto y deja a las del perfil de UBITS
// como candidatos `pending_review` de la MISMA corrida, sin correo ni teléfono.
//
// Costo: descargar el sitio es gratis; la lectura con Claude se registra en Uso de IA y
// respeta el tope de «Presupuesto y créditos» (sin presupuesto, no se llama). Falla ABIERTO:
// cualquier error devuelve «no se encontró nada» y el resto de la búsqueda sigue igual.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import {
  runAnthropicConversation,
  type AnthropicConversationResult,
  type AnthropicRequestBody,
  type AnthropicUsageTotals,
} from '../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '../prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { estimateClassifierCost } from '../prospecting-toolkit/claude-classifier/cost';
import { CLAUDE_PAGE_MAX_HTML_BYTES, extractVisibleText } from '../prospecting-toolkit/claude-classifier/page-text';
import { CLAUDE_CLASSIFIER_PROVIDER_KEY } from '../prospecting-toolkit/claude-classifier/types';
import { fetchSafePageHtml, type SafePageFetchResult } from '../prospecting-toolkit/website-verifier';
import {
  COMPANY_SITE_PEOPLE_TOOL,
  PEOPLE_PAGE_TEXT_MAX_CHARS,
  buildCompanyPeopleSystemPrompt,
  buildCompanyPeopleTool,
  buildCompanyPeopleUserMessage,
  pickPeoplePages,
  sitePeopleSubmission,
  toCompanySiteRows,
  verifySitePeople,
  type CompanySiteCandidateRow,
  type CompanySiteDocument,
} from './company-site-people-core';

const PAGE_TIMEOUT_MS = 15_000;
const CLAUDE_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 1_500;
/** Menos texto que esto = página vacía o bloqueada. */
const MIN_DOC_TEXT_CHARS = 200;

export interface CompanySiteRun {
  accountId: string | null;
  companyName: string;
  companyDomain: string | null;
  countryCode: string | null;
  status: string;
}

export interface CompanySiteUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: 'success' | 'error';
  errorCode: string | null;
  durationMs: number;
}

export interface CompanySiteStageDeps {
  loadRun?: (attemptId: string) => Promise<CompanySiteRun | null>;
  isBudgetAvailable?: () => Promise<boolean>;
  resolveModel?: () => Promise<{ apiKey: string; model: string } | { error: string }>;
  fetchPage?: (url: string) => Promise<SafePageFetchResult>;
  runConversation?: (body: AnthropicRequestBody, apiKey: string) => Promise<AnthropicConversationResult>;
  loadKnownNames?: (accountId: string | null, attemptId: string) => Promise<string[]>;
  insertRows?: (attemptId: string, rows: CompanySiteCandidateRow[]) => Promise<{ error?: string }>;
  recordOnRun?: (attemptId: string, block: Record<string, unknown>, inserted: number) => Promise<void>;
  logUsage?: (usage: CompanySiteUsage, run: CompanySiteRun, triggeredBy: string) => Promise<void>;
  now?: () => number;
}

export type CompanySiteStageResult =
  | {
      // `site_no_text`: la portada respondió pero sin texto legible (sitios armados sólo con
      // JavaScript, como covemex.com el 20-10): no hay nada que leer sin un navegador.
      status: 'no_domain' | 'budget_blocked' | 'site_unreachable' | 'site_no_text' | 'no_model' | 'error';
      inserted: 0;
      detail?: string;
    }
  | { status: 'done'; inserted: number; pagesRead: number; peopleFound: number };

function usable(page: SafePageFetchResult): page is SafePageFetchResult & { html: string } {
  return !!page.html && (page.httpStatus ?? 0) < 400;
}

/**
 * Por dónde probar la portada: el dominio tal cual y, si no empieza por «www.», también con
 * «www.» (almagro.com.ec sólo responde como www.almagro.com.ec, medido el 20-10).
 */
export function homeUrlCandidates(domain: string): string[] {
  const trimmed = domain.trim();
  if (/^https?:\/\//i.test(trimmed)) return [trimmed];
  const bare = trimmed.replace(/^www\./i, '');
  return [`https://${bare}`, `https://www.${bare}`];
}

export interface PeoplePagesRead {
  documents: CompanySiteDocument[];
  /** La portada respondió (con o sin texto legible). */
  homeReachable: boolean;
}

/** Portada + páginas con más probabilidad de nombrar personas. Nunca lanza. */
export async function readPeoplePages(
  domain: string,
  fetchPage: (url: string) => Promise<SafePageFetchResult>,
): Promise<PeoplePagesRead> {
  let home: (SafePageFetchResult & { html: string }) | null = null;
  for (const url of homeUrlCandidates(domain)) {
    try {
      const page = await fetchPage(url);
      if (usable(page)) {
        home = page;
        break;
      }
    } catch {
      // Se prueba la siguiente forma del dominio.
    }
  }
  if (!home) return { documents: [], homeReachable: false };
  const homeUrl = home.finalUrl ?? home.requestedUrl;
  const texts: Array<{ url: string; text: string }> = [{ url: homeUrl, text: extractVisibleText(home.html, PEOPLE_PAGE_TEXT_MAX_CHARS) }];
  const pages = await Promise.all(
    pickPeoplePages(home.html, homeUrl).map(async (url) => {
      try {
        const page = await fetchPage(url);
        return usable(page) ? { url: page.finalUrl ?? url, text: extractVisibleText(page.html, PEOPLE_PAGE_TEXT_MAX_CHARS) } : null;
      } catch {
        return null;
      }
    }),
  );
  for (const page of pages) if (page) texts.push(page);
  return {
    homeReachable: true,
    documents: texts
      .filter((t) => t.text.length >= MIN_DOC_TEXT_CHARS)
      .map((t, i) => ({ docId: `D${i + 1}`, url: t.url, text: t.text })),
  };
}

// ── Lecturas y escrituras por defecto (service role) ────────────────────────────

async function defaultLoadRun(attemptId: string): Promise<CompanySiteRun | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_runs')
    .select('account_id, company_name, company_domain, company_country_code, status')
    .eq('id', attemptId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    accountId: (data.account_id as string | null) ?? null,
    companyName: String(data.company_name ?? ''),
    companyDomain: (data.company_domain as string | null) ?? null,
    countryCode: (data.company_country_code as string | null) ?? null,
    status: String(data.status ?? ''),
  };
}

async function defaultIsBudgetAvailable(): Promise<boolean> {
  try {
    return (await checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY)).allowed;
  } catch {
    // Sin poder leer el presupuesto no se gasta.
    return false;
  }
}

async function defaultResolveModel(): Promise<{ apiKey: string; model: string } | { error: string }> {
  const active = await resolveActiveAnthropicModel();
  if ('error' in active) return { error: active.error };
  return { apiKey: active.apiKey, model: process.env.AGENT3_EXTRACTION_MODEL?.trim() || active.model };
}

async function defaultLoadKnownNames(accountId: string | null, attemptId: string): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const names: string[] = [];
  if (accountId) {
    const { data, error } = await admin.from('contacts').select('full_name').eq('account_id', accountId).limit(500);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (row.full_name) names.push(String(row.full_name));
    const runs = await admin.from('contact_enrichment_runs').select('id').eq('account_id', accountId).limit(500);
    if (runs.error) throw new Error(runs.error.message);
    const runIds = [...new Set([attemptId, ...(runs.data ?? []).map((r) => String(r.id))])];
    const { data: candidates, error: candError } = await admin
      .from('contact_enrichment_candidates')
      .select('full_name')
      .in('enrichment_run_id', runIds)
      .limit(1500);
    if (candError) throw new Error(candError.message);
    for (const row of candidates ?? []) if (row.full_name) names.push(String(row.full_name));
  } else {
    const { data, error } = await admin.from('contact_enrichment_candidates').select('full_name').eq('enrichment_run_id', attemptId);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (row.full_name) names.push(String(row.full_name));
  }
  return names;
}

async function defaultInsertRows(attemptId: string, rows: CompanySiteCandidateRow[]): Promise<{ error?: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('contact_enrichment_candidates').insert(rows.map((row) => ({ ...row, enrichment_run_id: attemptId })));
  return { error: error?.message };
}

/** Deja el rastro en el summary y, si hubo candidatos, la corrida pasa a revisión. */
async function defaultRecordOnRun(attemptId: string, block: Record<string, unknown>, inserted: number): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('contact_enrichment_runs').select('summary, status').eq('id', attemptId).maybeSingle();
  const summary = ((data?.summary as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const update: Record<string, unknown> = { summary: { ...summary, company_site: block } };
  if (inserted > 0 && data?.status === 'completed') update.status = 'ready_for_review';
  await admin.from('contact_enrichment_runs').update(update).eq('id', attemptId);
}

async function defaultLogUsage(usage: CompanySiteUsage, run: CompanySiteRun, triggeredBy: string): Promise<void> {
  await logProviderUsage({
    provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
    operation_key: 'company_site_people',
    agent_key: 'agent2a',
    agent_step: 'leer_sitio_empresa',
    model: usage.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    estimated_cost_usd: usage.costUsd,
    status: usage.status,
    ...(usage.errorCode ? { error_code: usage.errorCode } : {}),
    duration_ms: usage.durationMs,
    ...(run.countryCode ? { country_code: run.countryCode } : {}),
    triggered_by: triggeredBy,
    metadata: { flow: 'agent2a_company_site_people', company_name: run.companyName, company_domain: run.companyDomain },
  });
}

// ── Etapa ───────────────────────────────────────────────────────────────────────

export async function runCompanySiteStage(
  input: { attemptId: string; triggeredBy: string },
  deps: CompanySiteStageDeps = {},
): Promise<CompanySiteStageResult> {
  const {
    loadRun = defaultLoadRun,
    isBudgetAvailable = defaultIsBudgetAvailable,
    resolveModel = defaultResolveModel,
    fetchPage = (url) => fetchSafePageHtml(url, PAGE_TIMEOUT_MS, CLAUDE_PAGE_MAX_HTML_BYTES),
    runConversation = (body, apiKey) => runAnthropicConversation({ apiKey, body, timeoutMs: CLAUDE_TIMEOUT_MS }),
    loadKnownNames = defaultLoadKnownNames,
    insertRows = defaultInsertRows,
    recordOnRun = defaultRecordOnRun,
    logUsage = defaultLogUsage,
    now = Date.now,
  } = deps;

  try {
    const run = await loadRun(input.attemptId);
    const domain = run?.companyDomain?.trim();
    if (!run || !domain) return { status: 'no_domain', inserted: 0 };
    if (!(await isBudgetAvailable())) return { status: 'budget_blocked', inserted: 0 };

    const { documents, homeReachable } = await readPeoplePages(domain, fetchPage);
    if (documents.length === 0) {
      const status = homeReachable ? 'site_no_text' : 'site_unreachable';
      await recordOnRun(input.attemptId, { status }, 0);
      return { status, inserted: 0 };
    }

    const models = await resolveModel();
    if ('error' in models) return { status: 'no_model', inserted: 0, detail: models.error };

    const startedAt = now();
    let conversation: AnthropicConversationResult;
    try {
      conversation = await runConversation(
        {
          model: models.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: [{ type: 'text', text: buildCompanyPeopleSystemPrompt() }],
          tools: [buildCompanyPeopleTool()],
          tool_choice: { type: 'tool', name: COMPANY_SITE_PEOPLE_TOOL },
          messages: [{ role: 'user', content: buildCompanyPeopleUserMessage(run.companyName, documents) }],
        } as AnthropicRequestBody,
        models.apiKey,
      );
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'unexpected_error';
      // Un error a mitad de camino trae lo que ya se gastó: se registra, nunca un US$0 inventado.
      const partial = err && typeof err === 'object' && 'partialUsage' in err ? (err as { partialUsage: AnthropicUsageTotals | null }).partialUsage : null;
      await logUsage(
        {
          model: models.model,
          inputTokens: partial?.inputTokens ?? 0,
          outputTokens: partial?.outputTokens ?? 0,
          costUsd: partial ? estimateClassifierCost(partial, models.model).usd : 0,
          status: 'error',
          errorCode: code,
          durationMs: now() - startedAt,
        },
        run,
        input.triggeredBy,
      ).catch(() => undefined);
      return { status: 'error', inserted: 0, detail: code };
    }

    const costUsd = estimateClassifierCost(conversation.usage, models.model).usd;
    await logUsage(
      {
        model: models.model,
        inputTokens: conversation.usage.inputTokens,
        outputTokens: conversation.usage.outputTokens,
        costUsd,
        status: 'success',
        errorCode: null,
        durationMs: now() - startedAt,
      },
      run,
      input.triggeredBy,
    ).catch(() => undefined);

    const verified = verifySitePeople(sitePeopleSubmission(conversation.content), documents);
    const rows = toCompanySiteRows(verified.people, await loadKnownNames(run.accountId, input.attemptId));
    if (rows.length > 0) {
      const { error } = await insertRows(input.attemptId, rows);
      if (error) return { status: 'error', inserted: 0, detail: error };
    }
    await recordOnRun(
      input.attemptId,
      {
        status: 'done',
        pages_read: documents.length,
        people_found: verified.people.length,
        candidates_inserted: rows.length,
        rejected: verified.rejected,
        cost_usd: costUsd,
      },
      rows.length,
    );
    return { status: 'done', inserted: rows.length, pagesRead: documents.length, peopleFound: verified.people.length };
  } catch (err) {
    return { status: 'error', inserted: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}
