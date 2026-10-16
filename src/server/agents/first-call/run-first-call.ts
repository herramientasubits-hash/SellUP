/**
 * Agente 3 · Primera llamada — orquestador (sin E/S propia: todo entra por `deps`).
 *
 *   1. Controles: empresa visible, presupuesto, sin otra investigación en curso.
 *   2. Ficha: si hay una vigente se reusa; si no, se investiga en cascada
 *      (SellUp → sitio oficial → noticias → búsqueda web de Claude) y se verifica.
 *   3. Paquete: Claude redacta con la ficha y la biblioteca; un verificador sin IA
 *      revisa cifras, largo y frases; si falla, se corrige una vez.
 *   4. Todo queda guardado con su costo y en Uso de IA como «Agente 3».
 */

import {
  AnthropicApiError,
  EMPTY_USAGE,
  type AnthropicConversationResult,
  type AnthropicRequestBody,
  type AnthropicUsageTotals,
} from '../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { forceSubmission } from '../prospecting-toolkit/claude-classifier/classify-company';
import { estimateClassifierCost } from '../prospecting-toolkit/claude-classifier/cost';
import {
  canonicalUrl,
  extractCitedTextsByUrl,
  extractSearchResultUrls,
} from '../prospecting-toolkit/claude-classifier/evidence-verifier';
import { extractVisibleText } from '../prospecting-toolkit/claude-classifier/page-text';
import type { SafePageFetchResult } from '../prospecting-toolkit/website-verifier';
import { buildInternalFacts, buildRequestFacts, hubspotWarning, type InternalContext } from './internal-facts';
import { verifyPack, extractWriterSubmission, parsePackSubmission } from './pack-verifier';
import {
  RESEARCH_MAX_OUTPUT_TOKENS,
  RESEARCH_SUBMIT_TOOL,
  buildResearchSubmitTool,
  buildResearchSystemPrompt,
  buildResearchUserMessage,
  buildResearchWebSearchTool,
  type ResearchDocument,
} from './research-prompt';
import { newsToDocuments, numberDocuments, readOfficialSite, type NewsSearchOutput } from './research-documents';
import {
  extractResearchSubmission,
  isResearchSufficient,
  unverifiedSearchUrls,
  verifyResearch,
  type VerifiedResearch,
} from './research-verifier';
import {
  RESEARCH_BRIEF_TTL_DAYS,
  type FirstCallPackContent,
  type FirstCallPackStatus,
  type FirstCallRequest,
  type ResearchBrief,
  type ResearchBriefStatus,
  type ResearchFact,
  type ResearchProgressStage,
  type ResearchSource,
} from './types';
import { addressFormFor, roleFocusFor } from './ubits-messaging-library';
import { WRITER_MAX_OUTPUT_TOKENS, WRITER_SUBMIT_TOOL, buildWriterSubmitTool, buildWriterSystemPrompt, buildWriterUserMessage } from './writer-prompt';

/** Páginas de búsqueda que se descargan para comprobar citas que no se pudieron ver. */
const MAX_VERIFY_FETCHES = 3;

export interface FirstCallContext {
  internal: InternalContext;
  sellerName: string | null;
  /** Ficha vigente (no vencida, no fallida), o null. */
  currentBrief: ResearchBrief | null;
  /** ¿Hay otra investigación de esta empresa corriendo ahora? */
  researchRunning: boolean;
}

export interface UsageLogInput {
  providerKey: 'anthropic' | 'tavily';
  operationKey: string;
  agentStep: string;
  model: string | null;
  usage: AnthropicUsageTotals | null;
  costUsd: number | null;
  credits: number | null;
  status: 'success' | 'error';
  errorCode: string | null;
  durationMs: number;
  metadata: Record<string, unknown>;
}

export interface BriefPatch {
  status?: ResearchBriefStatus;
  progressStage?: ResearchProgressStage | null;
  summary?: string | null;
  facts?: ResearchFact[];
  hypotheses?: VerifiedResearch['hypotheses'];
  gaps?: string[];
  sources?: ResearchSource[];
  rejectedFacts?: number;
  costUsd?: number;
  model?: string | null;
  errorCode?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
}

export interface PackInsert {
  accountId: string;
  briefId: string | null;
  contactId: string | null;
  targetName: string | null;
  targetTitle: string | null;
  channel: FirstCallRequest['channel'];
  goal: FirstCallRequest['goal'];
  productFocus: string | null;
  content: FirstCallPackContent | null;
  /** Los hechos con los que se escribió (sus IDs son los que cita el paquete). */
  facts: ResearchFact[];
  status: FirstCallPackStatus;
  verifierIssues: string[];
  regeneratedFromId: string | null;
  regenerationReason: string | null;
  costUsd: number;
  model: string | null;
  errorCode: string | null;
}

export interface RunFirstCallDeps {
  loadContext: (request: FirstCallRequest) => Promise<FirstCallContext | null>;
  resolveModels: () => Promise<{ apiKey: string; writerModel: string; extractionModel: string } | { error: string }>;
  checkBudget: (providerKey: 'anthropic' | 'tavily') => Promise<{ allowed: boolean; reason?: string | null }>;
  fetchPage: (url: string) => Promise<SafePageFetchResult>;
  searchNews: (input: { query: string; countryCode: string | null; topic: 'news' | 'general' }) => Promise<NewsSearchOutput>;
  runConversation: (body: AnthropicRequestBody, apiKey: string) => Promise<AnthropicConversationResult>;
  /** Reserva la investigación de la empresa; `null` si otra ya está en curso (índice único). */
  createBrief: (accountId: string) => Promise<string | null>;
  updateBrief: (briefId: string, patch: BriefPatch) => Promise<void>;
  insertPack: (pack: PackInsert) => Promise<string>;
  logUsage: (entry: UsageLogInput) => Promise<void>;
  now: () => number;
}

export type RunFirstCallResult =
  | { ok: true; briefId: string; packId: string; packStatus: FirstCallPackStatus; reusedBrief: boolean }
  | { ok: false; code: 'not_found' | 'budget_blocked' | 'model_unavailable' | 'already_running' | 'writer_failed'; message: string };

const MESSAGES = {
  not_found: 'No encontramos esa empresa o no está en tu cartera.',
  budget_blocked: 'No hay presupuesto de IA disponible este mes. Pídele a un administrador que lo revise.',
  model_unavailable: 'La IA no está configurada. Revisa Configuración → IA.',
  already_running: 'Ya hay una investigación de esta empresa en curso. Espera a que termine.',
  writer_failed: 'No pudimos escribir la preparación. Vuelve a intentarlo en un momento.',
} as const;

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function costOf(usage: AnthropicUsageTotals, model: string): number {
  return estimateClassifierCost(usage, model).usd;
}

function sumUsage(a: AnthropicUsageTotals, b: AnthropicUsageTotals): AnthropicUsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    webFetchRequests: a.webFetchRequests + b.webFetchRequests,
  };
}

function numberInternalFacts(context: InternalContext): ResearchFact[] {
  return buildInternalFacts(context).map((fact, i) => ({ id: `F${i + 1}`, ...fact }));
}

function sourcesFrom(documents: readonly ResearchDocument[], facts: readonly ResearchFact[]): ResearchSource[] {
  const byUrl = new Map<string, ResearchSource>();
  for (const doc of documents) byUrl.set(doc.url, { url: doc.url, label: doc.label, kind: doc.kind });
  for (const fact of facts) {
    if (fact.sourceUrl && !byUrl.has(fact.sourceUrl)) {
      byUrl.set(fact.sourceUrl, { url: fact.sourceUrl, label: fact.sourceLabel, kind: fact.sourceKind });
    }
  }
  return [...byUrl.values()];
}

// ── Investigación ────────────────────────────────────────────────────────────

async function gatherNews(context: InternalContext, deps: RunFirstCallDeps): Promise<{ documents: ResearchDocument[]; credits: number }> {
  const budget = await deps.checkBudget('tavily');
  if (!budget.allowed) return { documents: [], credits: 0 };
  const { account } = context;
  const name = account.name;
  const queries: Array<{ query: string; topic: 'news' | 'general'; step: string }> = [
    { query: `"${name}" ${account.country ?? ''}`.trim(), topic: 'news', step: 'noticias' },
    { query: `"${name}" empleo formación talento cultura`, topic: 'general', step: 'talento' },
  ];
  const outputs = await Promise.all(
    queries.map(async (q) => {
      const startedAt = deps.now();
      const output = await deps.searchNews({ query: q.query, countryCode: account.countryCode, topic: q.topic });
      // Sin llave de Tavily no hubo consulta: nada que registrar.
      if (output.skipped) return output;
      await deps.logUsage({
        providerKey: 'tavily',
        operationKey: q.topic === 'news' ? 'account_research_news' : 'account_research_talent',
        agentStep: q.step,
        model: null,
        usage: null,
        costUsd: null,
        credits: output.credits,
        status: output.error ? 'error' : 'success',
        errorCode: output.error,
        durationMs: deps.now() - startedAt,
        metadata: { account_id: account.id, results: output.results.length, skipped: output.skipped },
      });
      return output;
    }),
  );
  return {
    documents: newsToDocuments(outputs.flatMap((o) => o.results), account.domain),
    credits: outputs.reduce((sum, o) => sum + (o.credits ?? 0), 0),
  };
}

async function runResearchConversation(params: {
  body: AnthropicRequestBody;
  apiKey: string;
  deps: RunFirstCallDeps;
}): Promise<{ conversation: AnthropicConversationResult | null; usage: AnthropicUsageTotals; errorCode: string | null }> {
  const run = (body: AnthropicRequestBody) => params.deps.runConversation(body, params.apiKey);
  try {
    let conversation = await run(params.body);
    if (!extractResearchSubmission(conversation.content) && conversation.stopReason === 'end_turn') {
      conversation = await forceSubmission(
        params.body,
        conversation,
        { runConversation: run },
        RESEARCH_SUBMIT_TOOL,
        `Entrega ahora tu resultado con ${RESEARCH_SUBMIT_TOOL}. Sin cita, el dato no va.`,
      );
    }
    return { conversation, usage: conversation.usage, errorCode: null };
  } catch (err) {
    const apiError = err instanceof AnthropicApiError ? err : null;
    return { conversation: null, usage: apiError?.partialUsage ?? EMPTY_USAGE, errorCode: apiError?.code ?? 'unexpected_error' };
  }
}

async function research(
  context: FirstCallContext,
  models: { apiKey: string; extractionModel: string },
  deps: RunFirstCallDeps,
  briefId: string,
): Promise<WritableBrief> {
  const { internal } = context;
  const { account } = internal;
  const progress = (stage: ResearchProgressStage) => deps.updateBrief(briefId, { progressStage: stage });

  try {
    await progress('reading_sellup');
    const internalFacts = numberInternalFacts(internal);

    await progress('reading_site');
    const site = await readOfficialSite(account.website ?? account.domain, deps.fetchPage);

    await progress('reading_news');
    const news = await gatherNews(internal, deps);

    const documents = numberDocuments([...site.documents, ...news.documents]);
    const hasNews = news.documents.length > 0;
    const hasTalentPage = site.pageKinds.includes('careers');
    const webSearchAllowed = !(hasNews && hasTalentPage);

    await progress('extracting');
    const today = isoDay(deps.now());
    const body: AnthropicRequestBody = {
      model: models.extractionModel,
      max_tokens: RESEARCH_MAX_OUTPUT_TOKENS,
      system: [{ type: 'text', text: buildResearchSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      tools: webSearchAllowed ? [buildResearchWebSearchTool(), buildResearchSubmitTool()] : [buildResearchSubmitTool()],
      messages: [
        {
          role: 'user',
          content: buildResearchUserMessage({
            companyName: account.name,
            countryName: account.country,
            website: account.website ?? account.domain,
            decisionMakerTitle: internal.decisionMaker?.title ?? null,
            today,
            internalFacts,
            documents,
            webSearchAllowed,
          }),
        },
      ],
    };
    const startedAt = deps.now();
    const run = await runResearchConversation({ body, apiKey: models.apiKey, deps });
    const costUsd = costOf(run.usage, models.extractionModel);
    await deps.logUsage({
      providerKey: 'anthropic',
      operationKey: 'account_research',
      agentStep: 'investigar_empresa',
      model: models.extractionModel,
      usage: run.usage,
      costUsd,
      credits: null,
      status: run.errorCode ? 'error' : 'success',
      errorCode: run.errorCode,
      durationMs: deps.now() - startedAt,
      metadata: {
        account_id: account.id,
        brief_id: briefId,
        documents: documents.length,
        site_pages: site.pagesRead,
        news_documents: news.documents.length,
        web_search_allowed: webSearchAllowed,
      },
    });

    const submission = run.conversation ? extractResearchSubmission(run.conversation.content) : null;
    const citedTextsByUrl = run.conversation ? extractCitedTextsByUrl(run.conversation.content) : new Map<string, string[]>();
    const baseSources = { documents, citedTextsByUrl, fetchedTexts: new Map<string, string>() };

    // Una cita de búsqueda que no se pudo ver: la descargamos NOSOTROS y volvemos a mirar.
    // Sólo URLs que DEVOLVIÓ la búsqueda web (nunca una que el modelo escribió por su
    // cuenta), en paralelo para no comerse el tiempo de la ruta.
    const searchResultKeys = new Set(
      (run.conversation ? extractSearchResultUrls(run.conversation.content) : [])
        .map((url) => canonicalUrl(url))
        .filter((key): key is string => key !== null),
    );
    const toFetch = unverifiedSearchUrls(submission, baseSources)
      .filter((url) => {
        const key = canonicalUrl(url);
        return key !== null && searchResultKeys.has(key);
      })
      .slice(0, MAX_VERIFY_FETCHES);
    const fetchedTexts = new Map<string, string>();
    await Promise.all(
      toFetch.map(async (url) => {
        try {
          const page = await deps.fetchPage(url);
          if (page.html && (page.httpStatus ?? 0) < 400) fetchedTexts.set(canonicalUrl(url)!, extractVisibleText(page.html));
        } catch {
          // Fuente no descargable: el hecho queda fuera.
        }
      }),
    );

    const verified = verifyResearch({
      submission,
      internalFacts,
      sources: { ...baseSources, fetchedTexts },
      today,
    });
    const status: ResearchBriefStatus = isResearchSufficient(verified.facts) ? 'sufficient' : 'partial';
    const completedAt = new Date(deps.now()).toISOString();
    await deps.updateBrief(briefId, {
      status,
      progressStage: 'writing',
      summary: verified.summary,
      facts: verified.facts,
      hypotheses: verified.hypotheses,
      gaps: verified.gaps,
      sources: sourcesFrom(documents, verified.facts),
      rejectedFacts: verified.rejected.length,
      costUsd,
      model: models.extractionModel,
      errorCode: run.errorCode,
      completedAt,
      expiresAt: new Date(deps.now() + RESEARCH_BRIEF_TTL_DAYS * 86_400_000).toISOString(),
    });
    return {
      id: briefId,
      status,
      summary: verified.summary,
      facts: verified.facts,
      hypotheses: verified.hypotheses,
      gaps: verified.gaps,
    };
  } catch (err) {
    await deps.updateBrief(briefId, {
      status: 'failed',
      progressStage: null,
      errorCode: err instanceof Error ? err.message.slice(0, 120) : 'unexpected_error',
      completedAt: new Date(deps.now()).toISOString(),
    });
    throw err;
  }
}

// ── Redacción ────────────────────────────────────────────────────────────────

type WritableBrief = Pick<ResearchBrief, 'id' | 'status' | 'summary' | 'facts' | 'hypotheses' | 'gaps'>;

/** Los hechos de la ficha más los de esta solicitud (decisor y HubSpot de hoy), numerados seguidos. */
export function factsForWriting(briefFacts: readonly ResearchFact[], internal: InternalContext): ResearchFact[] {
  const used = briefFacts
    .map((f) => Number(f.id.replace(/^F/, '')))
    .filter((n) => Number.isFinite(n));
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  return [...briefFacts, ...buildRequestFacts(internal).map((fact, i) => ({ id: `F${next + i}`, ...fact }))];
}

async function writePack(params: {
  request: FirstCallRequest;
  context: FirstCallContext;
  brief: WritableBrief;
  models: { apiKey: string; writerModel: string };
  deps: RunFirstCallDeps;
}): Promise<{
  content: FirstCallPackContent | null;
  facts: ResearchFact[];
  issues: string[];
  usage: AnthropicUsageTotals;
  errorCode: string | null;
}> {
  const { request, context, brief, models, deps } = params;
  const { internal } = context;
  const dm = internal.decisionMaker;
  const facts = factsForWriting(brief.facts, internal);
  const body: AnthropicRequestBody = {
    model: models.writerModel,
    max_tokens: WRITER_MAX_OUTPUT_TOKENS,
    system: [{ type: 'text', text: buildWriterSystemPrompt(), cache_control: { type: 'ephemeral' } }],
    tools: [buildWriterSubmitTool()],
    tool_choice: { type: 'tool', name: WRITER_SUBMIT_TOOL },
    messages: [
      {
        role: 'user',
        content: buildWriterUserMessage({
          companyName: internal.account.name,
          countryName: internal.account.country,
          addressForm: addressFormFor(internal.account.countryCode),
          sellerName: context.sellerName,
          decisionMaker: { name: dm?.name ?? null, title: dm?.title ?? null, roleFocus: roleFocusFor(dm?.title) },
          channel: request.channel,
          goal: request.goal,
          productFocus: request.productFocus,
          briefStatus: brief.status,
          summary: brief.summary,
          facts,
          hypotheses: brief.hypotheses,
          gaps: brief.gaps,
          hubspotWarning: hubspotWarning(internal.hubspot),
          regenerationReason: request.regenerationReason,
        }),
      },
    ],
  };

  let usage = EMPTY_USAGE;
  let content: FirstCallPackContent | null = null;
  let issues: string[] = [];
  try {
    const first = await deps.runConversation(body, models.apiKey);
    usage = first.usage;
    const raw = extractWriterSubmission(first.content);
    if (!raw) return { content: null, facts, issues: [], usage, errorCode: 'no_submission' };
    content = parsePackSubmission(raw);
    issues = verifyPack(content, facts, request.channel);
    if (issues.length === 0) return { content, facts, issues, usage, errorCode: null };

    const second = await deps.runConversation(
      {
        ...body,
        messages: [
          ...body.messages,
          { role: 'assistant', content: first.content },
          {
            role: 'user',
            content: [
              ...first.content
                .filter((b) => b.type === 'tool_use')
                .map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: 'Revisado: hay que corregirlo.' })),
              {
                type: 'text',
                text: `Corrige estos problemas y entrega de nuevo con ${WRITER_SUBMIT_TOOL}:\n- ${issues.join('\n- ')}`,
              },
            ],
          },
        ],
      },
      models.apiKey,
    );
    usage = sumUsage(usage, second.usage);
    const retried = extractWriterSubmission(second.content);
    if (retried) {
      content = parsePackSubmission(retried);
      issues = verifyPack(content, facts, request.channel);
    }
    return { content, facts, issues, usage, errorCode: null };
  } catch (err) {
    const apiError = err instanceof AnthropicApiError ? err : null;
    const errorCode = apiError?.code ?? 'unexpected_error';
    usage = sumUsage(usage, apiError?.partialUsage ?? EMPTY_USAGE);
    // Si falló la CORRECCIÓN, el primer borrador sigue sirviendo: queda para revisar.
    if (content) return { content, facts, issues, usage, errorCode };
    return { content: null, facts, issues: [], usage, errorCode };
  }
}

// ── Entrada ──────────────────────────────────────────────────────────────────

export async function runFirstCall(request: FirstCallRequest, deps: RunFirstCallDeps): Promise<RunFirstCallResult> {
  const context = await deps.loadContext(request);
  if (!context) return { ok: false, code: 'not_found', message: MESSAGES.not_found };

  const budget = await deps.checkBudget('anthropic');
  if (!budget.allowed) return { ok: false, code: 'budget_blocked', message: MESSAGES.budget_blocked };

  const models = await deps.resolveModels();
  if ('error' in models) return { ok: false, code: 'model_unavailable', message: MESSAGES.model_unavailable };

  const reuse = context.currentBrief !== null && !request.refreshResearch;
  if (!reuse && context.researchRunning) return { ok: false, code: 'already_running', message: MESSAGES.already_running };

  let brief: WritableBrief;
  if (reuse) {
    brief = context.currentBrief!;
  } else {
    const reserved = await deps.createBrief(request.accountId);
    if (!reserved) return { ok: false, code: 'already_running', message: MESSAGES.already_running };
    brief = await research(context, models, deps, reserved);
  }
  const briefId = brief.id;
  if (reuse) await deps.updateBrief(briefId, { progressStage: 'writing' });
  const startedAt = deps.now();
  const written = await writePack({ request, context, brief, models, deps });
  const costUsd = costOf(written.usage, models.writerModel);
  await deps.logUsage({
    providerKey: 'anthropic',
    operationKey: 'first_call_pack',
    agentStep: 'redactar_llamada',
    model: models.writerModel,
    usage: written.usage,
    costUsd,
    credits: null,
    status: written.errorCode ? 'error' : 'success',
    errorCode: written.errorCode,
    durationMs: deps.now() - startedAt,
    metadata: {
      account_id: request.accountId,
      brief_id: briefId,
      channel: request.channel,
      regeneration: request.regenerateFromPackId !== null,
    },
  });

  const status: FirstCallPackStatus = !written.content ? 'failed' : written.issues.length > 0 ? 'needs_review' : 'draft';
  const dm = context.internal.decisionMaker;
  const packId = await deps.insertPack({
    accountId: request.accountId,
    briefId,
    contactId: dm?.id ?? null,
    targetName: dm?.name ?? null,
    targetTitle: dm?.title ?? null,
    channel: request.channel,
    goal: request.goal,
    productFocus: request.productFocus,
    content: written.content,
    facts: written.facts,
    status,
    verifierIssues: written.issues,
    regeneratedFromId: request.regenerateFromPackId,
    regenerationReason: request.regenerationReason,
    costUsd,
    model: models.writerModel,
    errorCode: written.errorCode,
  });
  await deps.updateBrief(briefId, { progressStage: 'done' });

  if (status === 'failed') return { ok: false, code: 'writer_failed', message: MESSAGES.writer_failed };
  return { ok: true, briefId, packId, packStatus: status, reusedBrief: reuse };
}

