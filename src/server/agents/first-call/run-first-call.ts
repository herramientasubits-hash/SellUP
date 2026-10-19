/**
 * Agente 3 · Primera llamada — orquestador (sin E/S propia: todo entra por `deps`).
 *
 *   1. Controles: empresa visible, presupuesto, sin otra investigación en curso.
 *   2. Ficha: si hay una vigente se reusa; si no, se investiga en cascada
 *      (SellUp → sitio oficial → noticias → búsqueda web de Claude) y se verifica.
 *   3. Cascada de redacción: una llamada al redactor por decisor elegido (su ángulo
 *      según el cargo), con un mensaje por cada canal pedido. Cada decisor × canal
 *      queda guardado como una preparación. Un verificador sin IA revisa cifras,
 *      largo, frases y afirmaciones; si falla, se corrige una vez.
 *   4. Todo queda guardado con su costo y en Uso de IA como «Agente 3».
 */

import {
  AnthropicApiError,
  EMPTY_USAGE,
  type AnthropicContentBlock,
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
import type { Agent3StatusTarget } from './account-status';
import { allApplicableApproaches, recommendApproach } from './approaches';
import { CONTACT_RESEARCH_TTL_DAYS, researchContact } from './contact-research';
import type { ContactInsight } from './types';
import { RECENT_SIGNAL_MAX_DAYS } from './pack-verifier';
import { buildInternalFacts, buildRequestFacts, hubspotWarning, type DecisionMaker, type InternalContext } from './internal-facts';
import {
  contentForChannel,
  describeSubmissionShape,
  extractWriterSubmission,
  parseWriterSubmission,
  verifyPack,
  type WriterSubmission,
} from './pack-verifier';
import {
  RESEARCH_MAX_OUTPUT_TOKENS,
  RESEARCH_SUBMIT_TOOL,
  buildResearchSubmitTool,
  buildResearchSystemPrompt,
  buildResearchUserMessage,
  buildResearchWebSearchTool,
  RESEARCH_MAX_WEB_SEARCHES_WITHOUT_TAVILY,
  type ResearchDocument,
} from './research-prompt';
import { firstOfEachUrl, hostOfUrl, newsToDocuments, numberDocuments, readOfficialSite, type NewsSearchOutput } from './research-documents';
import type { NewsSearchInput } from './news-search';
import { buildResearchSearchPlan, decisionMakerSourcesFor } from './research-catalog';
import {
  extractResearchSubmission,
  isResearchSufficient,
  unverifiedSearchUrls,
  verifyResearch,
  type VerifiedResearch,
} from './research-verifier';
import {
  FIRST_CALL_CHANNEL_LABELS,
  RESEARCH_BRIEF_TTL_DAYS,
  type FirstCallChannel,
  type FirstCallGoal,
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

/** Tavily cobra 1 crédito por búsqueda básica (la que usa el agente). */
export const TAVILY_BASIC_SEARCH_CREDITS = 1;

/** Páginas de búsqueda que se descargan para comprobar citas que no se pudieron ver. */
const MAX_VERIFY_FETCHES = 3;
/** Documentos de búsqueda por consulta y en total para la investigación (banco 19-10). */
export const DOCS_PER_SEARCH = 6;
export const MAX_SEARCH_DOCUMENTS = 24;

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** De qué tipo de fuente era un dato descartado («Prensa», «Sitio oficial», «web»…). */
function sourceGroupOf(url: string | null, documents: readonly ResearchDocument[]): string {
  if (!url) return 'sin_fuente';
  const doc = documents.find((d) => d.url === url);
  return doc ? doc.label.split(' · ')[0] : 'web';
}

export interface FirstCallContext {
  internal: InternalContext;
  /** Los decisores pedidos que existen en la empresa (en el orden pedido). */
  decisionMakers: DecisionMaker[];
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
  /** País de la empresa (ISO-2): el gasto del agente se filtra por país en Uso de IA. */
  countryCode: string | null;
  /** Cuántos resultados o datos produjo la consulta. */
  resultsReturned?: number;
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
  channel: FirstCallChannel;
  goals: FirstCallGoal[];
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
  searchNews: (input: NewsSearchInput) => Promise<NewsSearchOutput>;
  /**
   * Buscar también en las fuentes elegidas por país e industria, en el sitio propio y en
   * la página de LinkedIn (dueña 19-10). Sin él, las dos búsquedas abiertas de siempre.
   */
  extendedResearch?: boolean;
  runConversation: (body: AnthropicRequestBody, apiKey: string) => Promise<AnthropicConversationResult>;
  /** Reserva la investigación de la empresa; `null` si otra ya está en curso (índice único). */
  createBrief: (accountId: string) => Promise<string | null>;
  updateBrief: (briefId: string, patch: BriefPatch) => Promise<void>;
  insertPack: (pack: PackInsert) => Promise<string>;
  /** Avanza el estado de la empresa (nunca retrocede; ver `nextAgent3Status`). */
  advanceAccountStatus: (accountId: string, target: Agent3StatusTarget) => Promise<void>;
  logUsage: (entry: UsageLogInput) => Promise<void>;
  /**
   * Lo investigado de este decisor en una preparación desde `sinceIso` (o `null`).
   * Opcional: sin él siempre se investiga.
   */
  readCachedContactResearch?: (
    accountId: string,
    contactId: string,
    sinceIso: string,
  ) => Promise<{ facts: Array<Omit<ResearchFact, 'id'>>; insight: ContactInsight; researchedAt: string } | null>;
  now: () => number;
}

export type RunFirstCallResult =
  | { ok: true; briefId: string; packIds: string[]; packStatuses: FirstCallPackStatus[]; reusedBrief: boolean }
  | {
      ok: false;
      code: 'not_found' | 'contacts_not_found' | 'budget_blocked' | 'model_unavailable' | 'already_running' | 'writer_failed';
      message: string;
    };

const MESSAGES = {
  not_found: 'No encontramos esa empresa o no está en tu cartera.',
  contacts_not_found: 'Los decisores elegidos ya no están en esta empresa. Vuelve a elegirlos.',
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

async function gatherNews(
  context: InternalContext,
  deps: RunFirstCallDeps,
): Promise<{ documents: ResearchDocument[]; credits: number; tavilyUnavailable: boolean }> {
  const budget = await deps.checkBudget('tavily');
  if (!budget.allowed) return { documents: [], credits: 0, tavilyUnavailable: true };
  const { account } = context;
  const queries = buildResearchSearchPlan({
    name: account.name,
    country: account.country,
    countryCode: account.countryCode,
    industry: account.industry,
    domain: account.domain ?? account.website,
    extended: deps.extendedResearch === true,
  });
  const outputs = await Promise.all(
    queries.map(async (q) => {
      const startedAt = deps.now();
      const output = await deps.searchNews({
        query: q.query,
        countryCode: account.countryCode,
        topic: q.topic,
        ...(q.includeDomains ? { includeDomains: q.includeDomains } : {}),
        ...(q.excludeDomains ? { excludeDomains: q.excludeDomains } : {}),
        ...(q.maxResults ? { maxResults: q.maxResults } : {}),
      });
      // Sin llave de Tavily no hubo consulta: nada que registrar.
      if (output.skipped) return output;
      await deps.logUsage({
        providerKey: 'tavily',
        operationKey: q.operationKey,
        agentStep: q.step,
        model: null,
        usage: null,
        // El costo en dólares lo resuelve la capa real con la tarifa vigente (null = desconocido,
        // nunca un 0 inventado). Los créditos: lo que Tavily informó o, si no, 1 por búsqueda básica.
        costUsd: null,
        credits: output.error ? (output.credits ?? 0) : (output.credits ?? TAVILY_BASIC_SEARCH_CREDITS),
        status: output.error ? 'error' : 'success',
        errorCode: output.error,
        durationMs: deps.now() - startedAt,
        countryCode: account.countryCode,
        resultsReturned: output.results.length,
        metadata: {
          account_id: account.id,
          results: output.results.length,
          skipped: output.skipped,
          // Diagnóstico (dueña 19-10): de qué sitios y de qué fecha salió cada resultado.
          hosts: output.results.map((r) => hostOfUrl(r.url)).filter((h): h is string => !!h),
          dated: output.results.filter((r) => !!r.publishedOn).length,
          ...(q.includeDomains ? { include_domains: q.includeDomains.length } : {}),
        },
      });
      return output;
    }),
  );
  return {
    // Tope por búsqueda y en total: más documentos no dieron más datos y sí más descartes (banco 19-10).
    documents: queries
      .flatMap((q, i) => newsToDocuments(outputs[i].results, account.domain, q.step).slice(0, DOCS_PER_SEARCH))
      .filter(firstOfEachUrl())
      .slice(0, MAX_SEARCH_DOCUMENTS),
    credits: outputs.reduce((sum, o) => sum + (o.credits ?? 0), 0),
    // Sin llave o con todas las búsquedas en error (p. ej. sin créditos del mes): va el respaldo.
    tavilyUnavailable: outputs.every((o) => o.skipped || !!o.error),
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
    // Lo que cuenta es una noticia CON FECHA: un fragmento sin fecha no es una señal reciente.
    const hasNews = news.documents.some((d) => !!d.publishedOn);
    const hasTalentPage = site.pageKinds.includes('careers');
    const webSearchAllowed = !(hasNews && hasTalentPage);

    await progress('extracting');
    const today = isoDay(deps.now());
    const body: AnthropicRequestBody = {
      model: models.extractionModel,
      max_tokens: RESEARCH_MAX_OUTPUT_TOKENS,
      system: [{ type: 'text', text: buildResearchSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      tools: webSearchAllowed
        ? [
            buildResearchWebSearchTool(news.tavilyUnavailable ? RESEARCH_MAX_WEB_SEARCHES_WITHOUT_TAVILY : undefined),
            buildResearchSubmitTool(),
          ]
        : [buildResearchSubmitTool()],
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
            tavilyUnavailable: news.tavilyUnavailable,
          }),
        },
      ],
    };
    const startedAt = deps.now();
    const run = await runResearchConversation({ body, apiKey: models.apiKey, deps });
    const costUsd = costOf(run.usage, models.extractionModel);
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
      countryCode: account.countryCode,
      metadata: {
        account_id: account.id,
        brief_id: briefId,
        documents: documents.length,
        site_pages: site.pagesRead,
        news_documents: news.documents.length,
        dated_news_documents: news.documents.filter((d) => !!d.publishedOn).length,
        web_search_allowed: webSearchAllowed,
        tavily_unavailable: news.tavilyUnavailable,
        // Diagnóstico (dueña 19-10): cuántos datos propuso Claude y por qué se descartaron, y de qué fuente.
        proposed_facts: Array.isArray(submission?.facts) ? submission!.facts.length : 0,
        rejected_by_reason: countBy(verified.rejected.map((r) => r.reason)),
        rejected_by_source: countBy(verified.rejected.map((r) => sourceGroupOf(r.sourceUrl, documents))),
        verified_by_source: countBy(verified.facts.filter((f) => f.sourceKind !== 'sellup').map((f) => f.sourceLabel.split(' · ')[0])),
      },
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

/** Los datos del decisor van después de los de la ficha, con ids que siguen la numeración. */
export function withContactFacts(facts: readonly ResearchFact[], contactFacts: ReadonlyArray<Omit<ResearchFact, 'id'>>): ResearchFact[] {
  const used = facts.map((f) => Number(f.id.replace(/^F/, ''))).filter((n) => Number.isFinite(n));
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  return [...facts, ...contactFacts.map((fact, i) => ({ id: `F${next + i}`, ...fact }))];
}

/**
 * ¿Hay una señal reciente con fecha de los últimos 90 días? (para recomendar el enfoque)
 * También cuenta un dato fechado del decisor (llegó hace poco al cargo).
 */
export function hasRecentSignal(facts: readonly ResearchFact[], nowMs: number): boolean {
  return facts.some(
    (f) =>
      (f.topic === 'recent_signal' || (f.topic === 'decision_maker' && f.sourceKind !== 'sellup')) &&
      !!f.publishedOn &&
      nowMs - Date.parse(`${f.publishedOn}T12:00:00Z`) <= RECENT_SIGNAL_MAX_DAYS * 24 * 60 * 60 * 1000,
  );
}

/** Cuántos decisores se redactan a la vez (cada uno es una llamada al redactor). */
const WRITER_CONCURRENCY = 2;

interface WrittenForTarget {
  submission: WriterSubmission | null;
  facts: ResearchFact[];
  issuesByChannel: Partial<Record<FirstCallChannel, string[]>>;
  usage: AnthropicUsageTotals;
  errorCode: string | null;
  /** Qué campos trajo la última entrega y de qué tipo (sin contenido), para diagnosticar. */
  shape: Record<string, string>;
  /** Por qué terminó Claude cada respuesta (`end_turn`, `max_tokens`…), para diagnosticar. */
  stopReasons: string[];
  /** Si faltó el mensaje: el comienzo de lo que entregó Claude (para ver la causa). */
  rawPreview?: string;
  /** Salió del intento simple (solo la versión principal). */
  fallback?: boolean;
}

function verifyAll(
  submission: WriterSubmission,
  facts: readonly ResearchFact[],
  channels: readonly FirstCallChannel[],
  decisionMakerName: string | null,
  nowMs: number,
  countryCode: string | null,
  companyName: string | null,
): Partial<Record<FirstCallChannel, string[]>> {
  const result: Partial<Record<FirstCallChannel, string[]>> = {};
  for (const channel of channels) {
    result[channel] = verifyPack(contentForChannel(submission, channel), facts, channel, { decisionMakerName, nowMs, countryCode, companyName });
  }
  return result;
}

/** Los problemas de todos los canales, sin repetir, para pedir UNA corrección. */
function combinedIssues(byChannel: Partial<Record<FirstCallChannel, string[]>>, channels: readonly FirstCallChannel[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const channel of channels) {
    for (const issue of byChannel[channel] ?? []) {
      const line = channels.length > 1 ? `${FIRST_CALL_CHANNEL_LABELS[channel]}: ${issue}` : issue;
      if (!seen.has(line)) {
        seen.add(line);
        out.push(line);
      }
    }
  }
  return out;
}

/** Tope de lo que se guarda de una entrega sin mensaje, para diagnosticar. */
const RAW_PREVIEW_MAX_CHARS = 1_500;

/** El comienzo de lo que entregó Claude: los bloques y la entrega del formulario. */
export function writerRawPreview(content: readonly AnthropicContentBlock[]): string {
  const parts = content.map((block) =>
    block.type === 'tool_use'
      ? `tool_use ${JSON.stringify((block as { input?: unknown }).input ?? null)}`
      : block.type === 'text'
        ? `text ${String((block as { text?: unknown }).text ?? '')}`
        : block.type,
  );
  return parts.join(' | ').slice(0, RAW_PREVIEW_MAX_CHARS);
}

/**
 * Una llamada al redactor para un decisor (o sin decisor) y los canales que se le pasen.
 * Quien la usa la llama una vez POR CANAL (ver `writeEachChannel`).
 */
async function writeForTarget(params: {
  request: FirstCallRequest;
  context: FirstCallContext;
  target: DecisionMaker | null;
  brief: WritableBrief;
  models: { apiKey: string; writerModel: string };
  deps: RunFirstCallDeps;
  /** Lo verificado del decisor (investigación del contacto), sin ids. */
  contactFacts?: ReadonlyArray<Omit<ResearchFact, 'id'>>;
  /** Gancho, prioridades probables y lo que no se confirmó del decisor. */
  contactInsight?: ContactInsight | null;
  /** Intento simple: sólo la versión principal, sin las de los otros enfoques. */
  singleVersion?: boolean;
}): Promise<WrittenForTarget> {
  const { request, context, target, brief, models, deps } = params;
  const internal: InternalContext = { ...context.internal, decisionMaker: target };
  const channels = request.channels;
  // Un dato del vendedor sobre OTRO decisor no entra en la preparación de éste.
  const briefFacts = brief.facts.filter((f) => !f.contactId || f.contactId === target?.id);
  const facts = withContactFacts(factsForWriting(briefFacts, internal), params.contactFacts ?? []);
  const nowMs = deps.now();
  // Un nombramiento reciente del decisor también es un evento para abrir.
  const recentSignal = hasRecentSignal(facts, nowMs);
  const recommendedApproach = recommendApproach({
    title: target?.title ?? null,
    hasRecentSignal: recentSignal,
    hasDecisionMaker: target !== null,
    countryCode: internal.account.countryCode,
  });
  // Sin enfoques elegidos: una versión con cada uno que aplique, el recomendado como principal.
  const allApproaches =
    request.approaches.length > 0
      ? request.approaches
      : allApplicableApproaches(recommendedApproach, {
          hasRecentSignal: recentSignal,
          hasReferral: !!request.referralNote,
          countryCode: internal.account.countryCode,
        });
  const approaches = params.singleVersion ? allApproaches.slice(0, 1) : allApproaches;
  // En la llamada cada versión es el guion completo más el mensaje de voz (pesa como tres mensajes).
  const extraVersions = Math.max(0, approaches.length - 1) * (channels.length + (channels.includes('call') ? 2 : 0));
  const body: AnthropicRequestBody = {
    model: models.writerModel,
    max_tokens: WRITER_MAX_OUTPUT_TOKENS + 400 * Math.max(0, channels.length - 1) + 250 * extraVersions,
    system: [{ type: 'text', text: buildWriterSystemPrompt(), cache_control: { type: 'ephemeral' } }],
    tools: [buildWriterSubmitTool(channels, approaches)],
    tool_choice: { type: 'tool', name: WRITER_SUBMIT_TOOL },
    messages: [
      {
        role: 'user',
        content: buildWriterUserMessage({
          companyName: internal.account.name,
          countryName: internal.account.country,
          addressForm: addressFormFor(internal.account.countryCode),
          sellerName: context.sellerName,
          decisionMaker: { name: target?.name ?? null, title: target?.title ?? null, roleFocus: roleFocusFor(target?.title) },
          channels,
          goals: request.goals,
          productKeys: request.productKeys,
          approaches,
          recommendedApproach,
          referralNote: request.referralNote,
          countryCode: internal.account.countryCode,
          briefStatus: brief.status,
          summary: brief.summary,
          facts,
          hypotheses: brief.hypotheses,
          gaps: brief.gaps,
          hubspotWarning: hubspotWarning(internal.hubspot),
          regenerationReason: request.regenerationReason,
          contactInsight: params.contactInsight ?? null,
        }),
      },
    ],
  };

  const dmName = target?.name ?? null;
  const countryCode = internal.account.countryCode;
  let usage = EMPTY_USAGE;
  let shape: Record<string, string> = {};
  let submission: WriterSubmission | null = null;
  let issuesByChannel: Partial<Record<FirstCallChannel, string[]>> = {};
  const stopReasons: string[] = [];
  let lastContent: readonly AnthropicContentBlock[] = [];
  const preview = () => (lastContent.length > 0 ? writerRawPreview(lastContent) : undefined);
  try {
    const first = await deps.runConversation(body, models.apiKey);
    usage = first.usage;
    lastContent = first.content;
    stopReasons.push(first.stopReason ?? 'unknown');
    const raw = extractWriterSubmission(first.content);
    shape = describeSubmissionShape(raw);
    if (!raw) return { submission: null, facts, issuesByChannel: {}, usage, errorCode: 'no_submission', shape, stopReasons, rawPreview: preview() };
    submission = parseWriterSubmission(raw, channels);
    issuesByChannel = verifyAll(submission, facts, channels, dmName, nowMs, countryCode, internal.account.name);
    const issues = combinedIssues(issuesByChannel, channels);
    if (issues.length === 0) return { submission, facts, issuesByChannel, usage, errorCode: null, shape, stopReasons, rawPreview: preview() };

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
    stopReasons.push(second.stopReason ?? 'unknown');
    lastContent = second.content;
    const retried = extractWriterSubmission(second.content);
    if (retried) shape = describeSubmissionShape(retried);
    if (retried) {
      submission = parseWriterSubmission(retried, channels);
      issuesByChannel = verifyAll(submission, facts, channels, dmName, nowMs, countryCode, internal.account.name);
    }
    return { submission, facts, issuesByChannel, usage, errorCode: null, shape, stopReasons, rawPreview: preview() };
  } catch (err) {
    const apiError = err instanceof AnthropicApiError ? err : null;
    const errorCode = apiError?.code ?? 'unexpected_error';
    usage = sumUsage(usage, apiError?.partialUsage ?? EMPTY_USAGE);
    // Si falló la CORRECCIÓN, el primer borrador sigue sirviendo: queda para revisar.
    if (submission) return { submission, facts, issuesByChannel, usage, errorCode, shape, stopReasons, rawPreview: preview() };
    return { submission: null, facts, issuesByChannel: {}, usage, errorCode, shape, stopReasons, rawPreview: preview() };
  }
}

/** La preparación con lo investigado del decisor: su gancho y, si encontró datos, esos datos con su fecha. */
function withContactResearch(
  content: FirstCallPackContent,
  contact: { facts: ReadonlyArray<Omit<ResearchFact, 'id'>>; insight: ContactInsight | null; researchedAt: string },
): FirstCallPackContent {
  return {
    ...content,
    ...(contact.insight ? { contactInsight: contact.insight } : {}),
    ...(contact.facts.length > 0 && contact.researchedAt
      ? { contactResearch: { facts: contact.facts.map((fact, i) => ({ id: `C${i + 1}`, ...fact })), researchedAt: contact.researchedAt } }
      : {}),
  };
}

/** Corre `task` sobre cada elemento con un tope de tareas a la vez, conservando el orden. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Un redactor por canal, en paralelo (Prod 19-10, Davivienda): pedir los 4 canales con
 * los 8 tipos de mensaje en UNA respuesta era demasiado para Haiku. A veces cortaba solo
 * tras el enfoque (507 tokens, sin mensajes) y la corrección, que rehacía todo, pasaba
 * los 11.000 tokens y no se podía leer. Por canal cada respuesta pesa ~3.000 tokens y el
 * total termina antes. Cada canal trae su propia entrega; los consumos se suman.
 */
async function writeEachChannel(
  params: Parameters<typeof writeForTarget>[0],
): Promise<Partial<Record<FirstCallChannel, WrittenForTarget>>> {
  const channels = params.request.channels;
  const forChannel = (channel: FirstCallChannel, singleVersion = false) =>
    writeForTarget({ ...params, singleVersion, request: { ...params.request, channels: [channel] } });
  const results = await Promise.all(channels.map((channel) => forChannel(channel)));
  // Davivienda (19-10, ya por canal): Haiku a veces entrega sólo el enfoque y el motivo
  // (4 campos, `tool_use`), también al corregir. Un canal sin mensaje se intenta una
  // vez más, simple: sólo la versión principal. Mejor una versión usable que ninguna.
  const retried = await Promise.all(
    channels.map(async (channel, i) => {
      const first = results[i];
      if (writtenHasContent(first, channel)) return first;
      const simple = await forChannel(channel, true);
      return {
        ...(writtenHasContent(simple, channel) ? simple : first),
        usage: sumUsage(first.usage, simple.usage),
        stopReasons: [...first.stopReasons, ...simple.stopReasons],
        fallback: writtenHasContent(simple, channel),
        rawPreview: first.rawPreview,
      };
    }),
  );
  return Object.fromEntries(channels.map((channel, i) => [channel, retried[i]])) as Partial<Record<FirstCallChannel, WrittenForTarget>>;
}

/** ¿Hay algo usable para ese canal? (La llamada vale con el guion aunque falte el mensaje de voz.) */
function writtenHasContent(written: WrittenForTarget, channel: FirstCallChannel): boolean {
  const submission = written.submission;
  if (!submission) return false;
  return !!submission.messages[channel]?.text || (channel === 'call' && !!submission.shared.callScript.text);
}

// ── Entrada ──────────────────────────────────────────────────────────────────

export async function runFirstCall(request: FirstCallRequest, deps: RunFirstCallDeps): Promise<RunFirstCallResult> {
  const context = await deps.loadContext(request);
  if (!context) return { ok: false, code: 'not_found', message: MESSAGES.not_found };
  // Si se pidieron decisores y ninguno sigue en la empresa, no se cambia en silencio a «sin decisor».
  if (request.contactIds.length > 0 && context.decisionMakers.length === 0) {
    return { ok: false, code: 'contacts_not_found', message: MESSAGES.contacts_not_found };
  }

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

  const targets: Array<DecisionMaker | null> = context.decisionMakers.length > 0 ? context.decisionMakers : [null];
  const account = context.internal.account;
  // La investigación del decisor (Tavily, o Claude si Tavily no está): nunca rompe la preparación.
  const researchAndLogContact = async (
    target: DecisionMaker,
  ): Promise<{ facts: Array<Omit<ResearchFact, 'id'>>; insight: ContactInsight | null; researchedAt: string }> => {
    // Lo de la persona de los últimos días se reutiliza, salvo «Investigar de nuevo». Los
    // días se cuentan desde que se investigó, no desde la última preparación.
    if (!request.refreshResearch && deps.readCachedContactResearch) {
      const since = new Date(deps.now() - CONTACT_RESEARCH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const cached = await deps.readCachedContactResearch(account.id, target.id, since).catch(() => null);
      if (cached) return { facts: cached.facts, insight: cached.insight, researchedAt: cached.researchedAt };
    }
    const startedAt = deps.now();
    const found = await researchContact({
      target,
      companyName: account.name,
      countryName: account.country,
      countryCode: account.countryCode,
      apiKey: models.apiKey,
      model: models.extractionModel,
      today: isoDay(deps.now()),
      sourceDomains: deps.extendedResearch === true ? decisionMakerSourcesFor(account.countryCode) : [],
      deps,
    });
    if (found.tavily.ran) {
      await deps.logUsage({
        providerKey: 'tavily',
        operationKey: 'contact_research_search',
        agentStep: 'contacto_busqueda',
        model: null,
        usage: null,
        costUsd: null,
        credits: found.tavily.credits,
        status: found.tavily.error ? 'error' : 'success',
        errorCode: found.tavily.error,
        durationMs: deps.now() - startedAt,
        countryCode: account.countryCode,
        resultsReturned: found.tavily.results,
        metadata: { account_id: account.id, contact_id: target.id },
      });
    }
    if (found.usage) {
      await deps.logUsage({
        providerKey: 'anthropic',
        operationKey: 'contact_research',
        agentStep: 'investigar_contacto',
        model: models.extractionModel,
        usage: found.usage,
        costUsd: costOf(found.usage, models.extractionModel),
        credits: null,
        status: found.errorCode ? 'error' : 'success',
        errorCode: found.errorCode,
        durationMs: deps.now() - startedAt,
        countryCode: account.countryCode,
        resultsReturned: found.facts.length,
        metadata: {
          account_id: account.id,
          contact_id: target.id,
          source: found.source,
          leads_training: found.insight.leadsTraining,
          has_hook: found.insight.hook !== null,
          // Diagnóstico: qué le llegó a Claude y cuánto se descartó (homónimos, citas que no estaban).
          documents: found.documents,
          rejected_facts: found.rejected,
          has_linkedin: !!target.linkedinUrl,
          // El respaldo: Tavily no respondió (sin llave, sin presupuesto o sin créditos).
          tavily_unavailable: !found.tavily.ran || !!found.tavily.error,
        },
      });
    }
    // Sin datos ni nada que decir del decisor, la tarjeta no muestra la pestaña.
    const hasInsight = found.facts.length > 0 || found.insight.priorities.length > 0 || found.insight.unknowns.length > 0;
    return { facts: found.facts, insight: hasInsight ? found.insight : null, researchedAt: new Date(startedAt).toISOString() };
  };
  // Lo que se escribe y se guarda para un decisor (aquí `context` y `models` ya están comprobados).
  const writeAndSaveForTarget = async (target: DecisionMaker | null): Promise<Array<{ id: string; status: FirstCallPackStatus }>> => {
    const contact = target ? await researchAndLogContact(target) : { facts: [], insight: null, researchedAt: '' };
    const startedAt = deps.now();
    const byChannel = await writeEachChannel({ request, context, target, brief, models, deps, contactFacts: contact.facts, contactInsight: contact.insight });
    const writtenList = request.channels.map((c) => byChannel[c]).filter((w): w is WrittenForTarget => !!w);
    const usage = writtenList.reduce((acc, w) => sumUsage(acc, w.usage), EMPTY_USAGE);
    const costUsd = costOf(usage, models.writerModel);
    const errorCode = writtenList.find((w) => w.errorCode)?.errorCode ?? null;
    const missingChannels = request.channels.filter((c) => !byChannel[c]?.submission?.messages[c]?.text);
    await deps.logUsage({
      providerKey: 'anthropic',
      operationKey: 'first_call_pack',
      agentStep: 'redactar_llamada',
      model: models.writerModel,
      usage,
      costUsd,
      credits: null,
      status: errorCode && missingChannels.length === request.channels.length ? 'error' : 'success',
      errorCode,
      durationMs: deps.now() - startedAt,
      countryCode: context.internal.account.countryCode,
      resultsReturned: request.channels.length - missingChannels.length,
      metadata: {
        account_id: request.accountId,
        brief_id: briefId,
        contact_id: target?.id ?? null,
        channels: request.channels,
        product_keys: request.productKeys,
        regeneration: request.regenerateFromPackId !== null,
        // Un redactor por canal: por qué terminó cada respuesta (`max_tokens` = se cortó).
        writer_calls: request.channels.length,
        // Canales que salieron del intento simple (sólo la versión principal).
        fallback_channels: request.channels.filter((c) => byChannel[c]?.fallback),
        stop_reasons: Object.fromEntries(request.channels.map((c) => [c, byChannel[c]?.stopReasons ?? []])),
        // Sólo si algún canal quedó sin mensaje: qué trajo esa entrega (campos y tipos, sin texto).
        ...(missingChannels.length > 0
          ? {
              missing_channels: missingChannels,
              submission_shape: Object.fromEntries(missingChannels.map((c) => [c, byChannel[c]?.shape ?? {}])),
              raw_preview: Object.fromEntries(missingChannels.map((c) => [c, byChannel[c]?.rawPreview ?? null])),
            }
          : {}),
      },
    });

    // El costo de la llamada se reparte entre las preparaciones que produjo.
    const share = costUsd / request.channels.length;
    const inserted: Array<{ id: string; status: FirstCallPackStatus }> = [];
    for (const channel of request.channels) {
      const written = byChannel[channel];
      const content = written?.submission ? contentForChannel(written.submission, channel) : null;
      const issues = written?.issuesByChannel[channel] ?? [];
      // Una llamada con guion sirve aunque falte el mensaje de voz: queda «para revisar».
      const usable = !!content && (!!content.shortMessage.text || (channel === 'call' && !!content.callScript.text));
      const status: FirstCallPackStatus = !usable ? 'failed' : issues.length > 0 ? 'needs_review' : 'draft';
      const id = await deps.insertPack({
        accountId: request.accountId,
        briefId,
        contactId: target?.id ?? null,
        targetName: target?.name ?? null,
        targetTitle: target?.title ?? null,
        channel,
        goals: request.goals,
        productFocus: content?.productKey ?? (request.productKeys.length > 0 ? request.productKeys.join(',') : null),
        content: status === 'failed' || !content ? null : withContactResearch(content, contact),
        facts: written?.facts ?? [],
        status,
        verifierIssues: issues,
        regeneratedFromId: request.regenerateFromPackId,
        regenerationReason: request.regenerationReason,
        costUsd: share,
        model: models.writerModel,
        errorCode: written?.errorCode ?? (status === 'failed' ? 'no_message_for_channel' : null),
      });
      inserted.push({ id, status });
    }
    return inserted;
  };

  // Un decisor que falla (red, base de datos) no tumba a los demás, y la ficha siempre
  // termina en «done»: si no, la investigación quedaría «escribiendo» para siempre.
  let perTarget: Array<Array<{ id: string; status: FirstCallPackStatus }>> = [];
  try {
    perTarget = await mapWithConcurrency(targets, WRITER_CONCURRENCY, (target) =>
      writeAndSaveForTarget(target).catch(() => [] as Array<{ id: string; status: FirstCallPackStatus }>),
    );
  } finally {
    await deps.updateBrief(briefId, { progressStage: 'done' });
  }


  const packs = perTarget.flat();
  const usable = packs.filter((p) => p.status !== 'failed');
  if (usable.length === 0) return { ok: false, code: 'writer_failed', message: MESSAGES.writer_failed };
  await deps.advanceAccountStatus(request.accountId, 'ready_for_outreach');
  return {
    ok: true,
    briefId,
    packIds: usable.map((p) => p.id),
    packStatuses: usable.map((p) => p.status),
    reusedBrief: reuse,
  };
}

