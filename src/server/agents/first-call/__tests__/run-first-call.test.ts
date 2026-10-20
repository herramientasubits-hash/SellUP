/**
 * AGENT3-FIRST-CALL-1 — el recorrido completo del Agente 3 con dependencias falsas:
 * investiga en cascada, verifica, redacta, corrige una vez y deja todo registrado.
 *
 * Sin red, sin base de datos y sin gasto: cada dependencia se inyecta.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AnthropicConversationResult, AnthropicRequestBody } from '../../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { AnthropicApiError, EMPTY_USAGE } from '../../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import type { SafePageFetchResult } from '../../prospecting-toolkit/website-verifier';
import type { InternalContext } from '../internal-facts';
import { RESEARCH_SUBMIT_TOOL } from '../research-prompt';
import { runFirstCall, type BriefPatch, type FirstCallContext, type PackInsert, type RunFirstCallDeps, type UsageLogInput } from '../run-first-call';
import type { FirstCallRequest, ResearchBrief } from '../types';
import { WRITER_SUBMIT_TOOL } from '../writer-prompt';
import { TRANSLATION_SUBMIT_TOOL } from '../pack-translation';

const ACCOUNT_ID = '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f';
const NOW = Date.parse('2026-10-16T15:00:00Z');

const REQUEST: FirstCallRequest = {
  accountId: ACCOUNT_ID,
  contactIds: ['c1'],
  channels: ['call'],
  goals: ['book_meeting'],
  productKeys: [],
  approaches: [],
  referralNote: null,
  refreshResearch: false,
  regenerateFromPackId: null,
  regenerationReason: null,
};

const INTERNAL: InternalContext = {
  account: {
    id: ACCOUNT_ID,
    name: 'Distribuidora Andina',
    legalName: null,
    website: 'https://andina.example',
    domain: 'andina.example',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail',
    companySize: '1001-5000',
    taxIdentifier: null,
    taxIdentifierType: null,
    hubspotCompanyId: null,
  },
  classification: null,
  curatedLists: [],
  relations: [],
  hubspot: { status: 'no_match', lifecycleStage: null, lastActivityDate: null, numberOfDeals: null },
  decisionMaker: { id: 'c1', name: 'María Pérez', title: 'Gerente de Talento', department: null },
};

const HOME_HTML = `<html><body><h1>Distribuidora Andina</h1>
  <p>${'Somos una cadena de tiendas de consumo masivo con presencia en 12 ciudades de Colombia. '.repeat(4)}</p>
  <a href="/trabaja-con-nosotros">Trabaja con nosotros</a></body></html>`;
const CAREERS_HTML = `<html><body><p>${'Buscamos 40 asesores de tienda para nuestras nuevas sedes en Cali y Medellín. '.repeat(4)}</p></body></html>`;

function page(url: string, html: string | null, status = 200): SafePageFetchResult {
  return { requestedUrl: url, finalUrl: url, httpStatus: html ? status : null, redirected: false, html, error: html ? null : 'fetch_failed' };
}

function usage(input = 1_000, output = 500) {
  return { ...EMPTY_USAGE, inputTokens: input, outputTokens: output };
}

function toolUse(name: string, input: unknown): AnthropicConversationResult {
  return { content: [{ type: 'tool_use', id: `tu_${name}`, name, input }], stopReason: 'tool_use', usage: usage(), requests: 1 };
}

/** Los textos que llegan al traductor: `[clave]` y el texto debajo. */
function segmentsOf(body: AnthropicRequestBody): Array<{ id: string; text: string }> {
  const message = body.messages[0].content as string;
  return [...message.matchAll(/\n\[([a-z0-9_]+)\]\n([\s\S]*?)(?=\n\n\[[a-z0-9_]+\]\n|$)/g)].map((m) => ({ id: m[1], text: m[2] }));
}

/** «Inglés» de mentira: cada palabra al revés (no repite las del español, conserva las cifras). */
const fakeEnglish = (text: string) => `EN ${text.replace(/\p{L}{3,}/gu, (w) => [...w].reverse().join(''))}`;

/** Un traductor falso que devuelve cada texto transformado, con su misma clave. */
function translatedEcho(body: AnthropicRequestBody, transform: (text: string, id: string) => string): AnthropicConversationResult {
  return toolUse(TRANSLATION_SUBMIT_TOOL, { segments: segmentsOf(body).map((s) => ({ id: s.id, text: transform(s.text, s.id) })) });
}

const RESEARCH_SUBMISSION = {
  summary: 'Cadena de tiendas en 12 ciudades que está contratando para nuevas sedes.',
  facts: [
    { ref: 'W1', topic: 'business', statement: 'Es una cadena de tiendas de consumo masivo.', quote: 'Somos una cadena de tiendas de consumo masivo', doc_id: 'D1', source_url: null, published_on: null },
    { ref: 'W2', topic: 'talent', statement: 'Busca 40 asesores para nuevas sedes.', quote: 'Buscamos 40 asesores de tienda para nuestras nuevas sedes', doc_id: 'D2', source_url: null, published_on: null },
    { ref: 'W3', topic: 'recent_signal', statement: 'Abrió sedes nuevas.', quote: 'Distribuidora Andina inauguró dos sedes en la costa', doc_id: 'D3', source_url: null, published_on: null },
  ],
  hypotheses: [{ text: 'Podría necesitar onboarding para el personal nuevo.', product_key: 'onboarding', fact_refs: ['W2'] }],
  gaps: ['No se sabe si tienen plataforma de formación.'],
};

const SCRIPT = `Hola María, soy Ana de UBITS. Le llamo porque vi que están buscando 40 asesores para sus nuevas sedes en Cali y Medellín. ${'Cuando una cadena crece así suele ser difícil que cada persona nueva llegue lista. '.repeat(5)}¿Cómo lo están resolviendo hoy? Si le parece, lo conversamos 20 minutos la próxima semana.`;

const GOOD_PACK = {
  reason_to_call: { text: 'Están buscando 40 asesores para nuevas sedes.', fact_refs: ['F5'] },
  angle: 'Que cada asesor nuevo llegue listo.',
  call_script: { text: SCRIPT, fact_refs: ['F5'] },
  short_message: { text: 'Hola María, vi que están contratando para sus nuevas sedes. ¿Conversamos 20 minutos?', fact_refs: ['F5'] },
  questions: ['¿Cómo forman hoy a los asesores nuevos?', '¿Quién define la inducción?', '¿Cómo saben si llegó a todos?'],
  objections: [{ library_key: 'send_info', objection: 'Mándame información.', response: 'Con gusto, ¿cuál es hoy el reto principal?' }],
  next_step: 'Agendar 20 minutos la próxima semana.',
  meeting_ask: '¿Le parece si lo vemos 20 minutos el martes a las 10 o el jueves a las 4? Le muestro casos de su sector.',
  if_no: 'Si no es momento, preguntar si le escribo el próximo trimestre y dejar esa fecha.',
  confirmation: 'Quedamos el martes a las 10. Agenda: su reto con los líderes nuevos y casos de su sector.',
  cautions: ['Que la formación sea un problema es una hipótesis.'],
};

interface Harness {
  deps: RunFirstCallDeps;
  calls: {
    fetched: string[];
    news: string[];
    conversations: AnthropicRequestBody[];
    briefPatches: BriefPatch[];
    packs: PackInsert[];
    logs: UsageLogInput[];
    briefsCreated: number;
    statuses: string[];
  };
}

function harness(options: {
  context?: Partial<FirstCallContext> | null;
  budget?: { anthropic: boolean; tavily: boolean };
  research?: (body: AnthropicRequestBody) => Promise<AnthropicConversationResult>;
  writer?: Array<unknown>;
  briefLocked?: boolean;
  translator?: (body: AnthropicRequestBody) => Promise<AnthropicConversationResult>;
} = {}): Harness {
  const calls: Harness['calls'] = { fetched: [], news: [], conversations: [], briefPatches: [], packs: [], logs: [], briefsCreated: 0, statuses: [] };
  const writerAnswers = [...(options.writer ?? [GOOD_PACK])];
  const context: FirstCallContext | null =
    options.context === null
      ? null
      : {
          internal: INTERNAL,
          decisionMakers: [INTERNAL.decisionMaker!],
          sellerName: 'Ana',
          currentBrief: null,
          researchRunning: false,
          ...options.context,
        };
  const deps: RunFirstCallDeps = {
    loadContext: async () => context,
    resolveModels: async () => ({ apiKey: 'k', writerModel: 'claude-sonnet-4-6', extractionModel: 'claude-sonnet-4-6' }),
    checkBudget: async (provider) => ({ allowed: options.budget ? options.budget[provider] : true }),
    fetchPage: async (url) => {
      calls.fetched.push(url);
      if (url === 'https://andina.example') return page(url, HOME_HTML);
      if (url === 'https://andina.example/trabaja-con-nosotros') return page(url, CAREERS_HTML);
      return page(url, null);
    },
    searchNews: async ({ query, topic }) => {
      calls.news.push(`${topic}:${query}`);
      return topic === 'news'
        ? {
            results: [
              {
                url: 'https://diario.example/andina',
                title: 'Andina crece',
                content: 'Distribuidora Andina inauguró dos sedes en la costa y prevé seguir creciendo este año.',
                publishedOn: '2026-07-10',
              },
            ],
            credits: 1,
            skipped: false,
            error: null,
          }
        : { results: [], credits: 1, skipped: false, error: null };
    },
    runConversation: async (body) => {
      calls.conversations.push(body);
      const submitTool = (body.tools as Array<{ name?: string }>).find((t) => t.name === RESEARCH_SUBMIT_TOOL || t.name === WRITER_SUBMIT_TOOL);
      if (submitTool?.name === RESEARCH_SUBMIT_TOOL) {
        return options.research ? options.research(body) : toolUse(RESEARCH_SUBMIT_TOOL, RESEARCH_SUBMISSION);
      }
      if ((body.tools as Array<{ name?: string }>).some((t) => t.name === TRANSLATION_SUBMIT_TOOL)) {
        return options.translator ? options.translator(body) : translatedEcho(body, fakeEnglish);
      }
      const answer = writerAnswers.shift() ?? GOOD_PACK;
      return toolUse(WRITER_SUBMIT_TOOL, answer);
    },
    createBrief: async () => {
      if (options.briefLocked) return null;
      calls.briefsCreated += 1;
      return 'brief-1';
    },
    updateBrief: async (_id, patch) => {
      calls.briefPatches.push(patch);
    },
    insertPack: async (pack) => {
      calls.packs.push(pack);
      return `pack-${calls.packs.length}`;
    },
    advanceAccountStatus: async (_accountId, target) => {
      calls.statuses.push(target);
    },
    logUsage: async (entry) => {
      calls.logs.push(entry);
    },
    now: () => NOW,
  };
  return { deps, calls };
}

describe('runFirstCall — investigar y preparar', () => {
  it('investiga en cascada, verifica cada dato y deja un paquete listo', async () => {
    const { deps, calls } = harness();
    const result = await runFirstCall(REQUEST, deps);

    assert.equal(result.ok, true);
    assert.deepEqual(calls.fetched, ['https://andina.example', 'https://andina.example/trabaja-con-nosotros']);
    assert.equal(calls.news.length, 4, 'noticias, talento y dos del decisor');
    assert.ok(calls.news.includes('general:"María Pérez" "Distribuidora Andina"'), 'la del decisor va con su nombre y la empresa');
    // Con noticias y página de empleo, la investigación no necesita búsqueda web pagada.
    const researchBody = calls.conversations[0];
    assert.equal((researchBody.tools as Array<{ type?: string }>).some((t) => t.type === 'web_search_20250305'), false);

    const final = calls.briefPatches.find((p) => p.status !== undefined)!;
    assert.equal(final.status, 'sufficient');
    // 5 hechos internos (industria, tamaño, país, HubSpot, decisor) y 3 de la web.
    assert.equal(final.facts!.filter((f) => f.sourceKind !== 'sellup').length, 3);
    assert.equal(final.facts!.find((f) => f.topic === 'recent_signal')!.publishedOn, '2026-07-10');
    assert.equal(final.hypotheses!.length, 1);

    assert.equal(calls.packs.length, 1);
    assert.equal(calls.packs[0].status, 'draft');
    assert.deepEqual(calls.packs[0].verifierIssues, []);
    assert.equal(calls.packs[0].contactId, 'c1');

    const steps = calls.logs.map((l) => `${l.providerKey}:${l.agentStep}`).sort();
    // La búsqueda del decisor no nombró a María: no hace falta pedirle nada a Claude.
    assert.deepEqual(steps, ['anthropic:investigar_empresa', 'anthropic:redactar_llamada', 'tavily:contacto_busqueda', 'tavily:noticias', 'tavily:talento']);
    assert.ok(calls.logs.every((l) => l.status === 'success'));
    // El gasto se filtra por país en Uso de IA: todas las filas llevan el de la empresa.
    assert.ok(calls.logs.every((l) => l.countryCode === 'CO'));
    assert.equal(calls.briefPatches.at(-1)!.progressStage, 'done');
  });

  it('el redactor recibe la ficha, el decisor y el tratamiento del país', async () => {
    const { deps, calls } = harness();
    await runFirstCall(REQUEST, deps);
    const writerBody = calls.conversations.at(-1)!;
    const message = writerBody.messages[0].content as string;
    assert.match(message, /María Pérez, Gerente de Talento/);
    assert.match(message, /Tratamiento: usted/);
    assert.match(message, /Buscamos 40 asesores/);
    assert.deepEqual(writerBody.tool_choice, { type: 'tool', name: WRITER_SUBMIT_TOOL });
  });

  it('reusa una ficha vigente: no lee el sitio ni gasta en noticias', async () => {
    const brief: ResearchBrief = {
      id: 'brief-old',
      accountId: ACCOUNT_ID,
      status: 'sufficient',
      progressStage: 'done',
      summary: 'x',
      facts: [{ id: 'F5', topic: 'talent', statement: 'Busca 40 asesores.', quote: 'Buscamos 40 asesores', sourceKind: 'official_site', sourceUrl: 'https://andina.example', sourceLabel: 'Sitio', publishedOn: null }],
      hypotheses: [],
      gaps: [],
      sources: [],
      rejectedFacts: 0,
      costUsd: 0.05,
      model: 'm',
      createdAt: '2026-10-10T00:00:00Z',
      completedAt: '2026-10-10T00:00:00Z',
      expiresAt: '2026-11-09T00:00:00Z',
      errorCode: null,
    };
    const { deps, calls } = harness({ context: { currentBrief: brief } });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok && result.reusedBrief, true);
    assert.equal(calls.briefsCreated, 0);
    assert.deepEqual(calls.fetched, []);
    // Ni el sitio ni las noticias de la empresa: sólo las dos búsquedas del decisor.
    assert.equal(calls.news.length, 2);
    assert.ok(calls.news.every((q) => q.includes('"María Pérez"')));
    assert.equal(calls.conversations.length, 1);
    assert.equal(calls.packs[0].briefId, 'brief-old');
  });

  it('sin presupuesto de IA no gasta nada', async () => {
    const { deps, calls } = harness({ budget: { anthropic: false, tavily: true } });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, 'budget_blocked');
    assert.equal(calls.conversations.length + calls.fetched.length + calls.news.length, 0);
  });

  it('sin presupuesto de Tavily investiga sin noticias y habilita la búsqueda web de Claude', async () => {
    const { deps, calls } = harness({ budget: { anthropic: true, tavily: false } });
    await runFirstCall(REQUEST, deps);
    assert.deepEqual(calls.news, []);
    const researchBody = calls.conversations[0];
    assert.equal((researchBody.tools as Array<{ type?: string }>).some((t) => t.type === 'web_search_20250305'), true);
  });

  it('no arranca otra investigación si ya hay una en curso', async () => {
    const { deps, calls } = harness({ context: { researchRunning: true } });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(!result.ok && result.code, 'already_running');
    assert.equal(calls.briefsCreated, 0);
  });

  it('empresa fuera de la cartera: no hace nada', async () => {
    const { deps, calls } = harness({ context: null });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(!result.ok && result.code, 'not_found');
    assert.equal(calls.conversations.length, 0);
  });

  it('si la investigación con Claude falla, la ficha queda parcial con lo de SellUp y el paquete igual se escribe', async () => {
    const { deps, calls } = harness({
      research: async () => {
        throw new AnthropicApiError(429, 'rate_limited', 'x', usage(10, 0));
      },
    });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok, true);
    const final = calls.briefPatches.find((p) => p.status !== undefined)!;
    assert.equal(final.status, 'partial');
    assert.equal(final.errorCode, 'rate_limited');
    assert.ok(final.facts!.every((f) => f.sourceKind === 'sellup'));
    assert.ok(calls.logs.some((l) => l.agentStep === 'investigar_empresa' && l.status === 'error'));
  });
});

describe('runFirstCall — correcciones de la revisión', () => {
  it('si otra investigación de la empresa ganó la carrera, no se paga una segunda', async () => {
    const { deps, calls } = harness({ briefLocked: true });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(!result.ok && result.code, 'already_running');
    assert.deepEqual(calls.fetched, []);
    assert.equal(calls.conversations.length, 0);
  });

  it('el decisor y HubSpot no se guardan en la ficha, pero sí van al redactor y al paquete', async () => {
    const { deps, calls } = harness();
    await runFirstCall(REQUEST, deps);
    const stored = calls.briefPatches.find((p) => p.facts)!.facts!;
    assert.equal(stored.some((f) => f.topic === 'decision_maker' || f.topic === 'ubits_relation'), false);
    const researchMessage = calls.conversations[0].messages[0].content as string;
    assert.equal(researchMessage.includes('María Pérez'), false, 'el nombre del decisor no va a la investigación web');
    const packFacts = calls.packs[0].facts;
    const dm = packFacts.find((f) => f.topic === 'decision_maker')!;
    assert.match(dm.statement, /María Pérez/);
    assert.equal(new Set(packFacts.map((f) => f.id)).size, packFacts.length, 'IDs únicos y seguidos');
    assert.match(calls.conversations.at(-1)!.messages[0].content as string, new RegExp(`${dm.id} \\[Decisor\\]`));
  });

  it('sólo descarga para verificar URLs que devolvió la búsqueda web, no las que escribe el modelo', async () => {
    const { deps, calls } = harness({
      budget: { anthropic: true, tavily: false },
      research: async () => ({
        content: [
          {
            type: 'web_search_tool_result',
            content: [{ type: 'web_search_result', url: 'https://premios.example/gptw', title: 'x' }],
          },
          {
            type: 'tool_use',
            id: 'tu_r',
            name: RESEARCH_SUBMIT_TOOL,
            input: {
              facts: [
                { ref: 'W1', topic: 'talent', statement: 'Ganó un premio de clima.', quote: 'Distribuidora Andina ganó el premio de clima laboral', doc_id: null, source_url: 'https://premios.example/gptw' },
                { ref: 'W2', topic: 'talent', statement: 'Tiene academia.', quote: 'la academia Andina forma a todos sus líderes', doc_id: null, source_url: 'http://169.254.169.254/latest/meta-data' },
              ],
            },
          },
        ],
        stopReason: 'tool_use',
        usage: usage(),
        requests: 1,
      }),
    });
    await runFirstCall(REQUEST, deps);
    assert.ok(calls.fetched.includes('https://premios.example/gptw'));
    assert.equal(calls.fetched.some((u) => u.includes('169.254')), false);
  });

  it('si la corrección del redactor falla, el primer borrador queda «para revisar» en vez de perderse', async () => {
    const { deps, calls } = harness({ writer: [{ ...GOOD_PACK, reason_to_call: { text: 'Crecieron 35% este año.', fact_refs: ['F5'] } }] });
    const original = deps.runConversation;
    let writerCalls = 0;
    deps.runConversation = async (body, key) => {
      const isWriter = (body.tools as Array<{ name?: string }>).some((t) => t.name === WRITER_SUBMIT_TOOL);
      if (isWriter && ++writerCalls === 2) throw new AnthropicApiError(529, 'http_529', 'overloaded', usage(5, 0));
      return original(body, key);
    };
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok && result.packStatuses[0], 'needs_review');
    assert.ok(calls.packs[0].content);
    assert.equal(calls.packs[0].errorCode, 'http_529');
  });
});

describe('runFirstCall — respaldo cuando Tavily no está', () => {
  it('sin presupuesto de Tavily (o sin créditos del mes): Claude hace el trabajo de Tavily (dueña 19-10)', async () => {
    const { deps, calls } = harness({ budget: { tavily: false, anthropic: true } });
    await runFirstCall(REQUEST, deps);
    assert.deepEqual(calls.news, [], 'no se llama a Tavily');
    const researchBody = calls.conversations[0];
    const tools = researchBody.tools as Array<{ type?: string; max_uses?: number; blocked_domains?: string[] }>;
    const web = tools.find((t) => t.type === 'web_search_20250305');
    assert.equal(web?.max_uses, 5, 'las mismas preguntas que Tavily');
    assert.ok(web?.blocked_domains?.includes('computrabajo.com'), 'sin portales de empleo ni redes');
    const fetchTool = tools.find((t) => t.type === 'web_fetch_20250910');
    assert.equal(fetchTool?.max_uses, 5, 'lee los mejores artículos enteros para citarlos');
    assert.match(researchBody.messages[0].content as string, /escribe en texto, en pocas líneas, lo que encontraste/);
    const message = researchBody.messages[0].content as string;
    assert.match(message, /no respondió hoy/);
    // Colombia y Retail: los medios del país orientan las búsquedas.
    assert.match(message, /larepublica\.co/);
    assert.match(message, /Merco OR "Great Place to Work"/);
    const research = calls.logs.find((l) => l.agentStep === 'investigar_empresa');
    assert.equal(research?.metadata.tavily_unavailable, true);
  });

  it('Tavily con error en todas las búsquedas cuenta como no disponible', async () => {
    const { deps, calls } = harness();
    deps.searchNews = async () => ({ results: [], credits: null, skipped: false, error: 'tavily_http_432' });
    await runFirstCall(REQUEST, deps);
    const web = (calls.conversations[0].tools as Array<{ type?: string; max_uses?: number }>).find((t) => t.type === 'web_search_20250305');
    assert.equal(web?.max_uses, 5);
  });

  it('con Tavily funcionando, Claude busca un poco y puede leer 2 artículos para comprobar sus citas (Anex Tour, 20-10)', async () => {
    const { deps, calls } = harness({ context: { internal: { ...INTERNAL, account: { ...INTERNAL.account, website: null, domain: null } } } });
    await runFirstCall(REQUEST, deps);
    const tools = calls.conversations[0].tools as Array<{ type?: string; max_uses?: number }>;
    assert.equal(tools.find((t) => t.type === 'web_search_20250305')?.max_uses, 2);
    assert.equal(tools.find((t) => t.type === 'web_fetch_20250910')?.max_uses, 2);
    assert.match(calls.conversations[0].messages[0].content as string, /escribe en texto, en pocas líneas, lo que encontraste/);
  });

  it('si la investigación termina sin entrega (pausa en la búsqueda web), se le pide (O’Reilly, 20-10)', async () => {
    let call = 0;
    const { deps, calls } = harness({
      research: async () => {
        call += 1;
        return call === 1
          ? { content: [{ type: 'text', text: 'Sigo buscando…' }], stopReason: 'pause_turn', usage: usage(), requests: 1 }
          : toolUse(RESEARCH_SUBMIT_TOOL, RESEARCH_SUBMISSION);
      },
    });
    await runFirstCall(REQUEST, deps);
    assert.equal(call, 2, 'un segundo turno pidiendo la entrega');
    const final = calls.briefPatches.find((p) => p.status !== undefined)!;
    assert.ok(final.facts!.some((f) => f.sourceKind !== 'sellup'));
  });

  it('una cita de un artículo que Claude leyó entero se verifica contra ese texto, con la fecha del resultado', async () => {
    const { deps, calls } = harness({
      budget: { tavily: false, anthropic: true },
      research: async () => ({
        content: [
          {
            type: 'web_search_tool_result',
            tool_use_id: 'ws1',
            content: [{ type: 'web_search_result', url: 'https://www.larepublica.co/andina', title: 'Andina', page_age: 'September 20, 2026', encrypted_content: 'x' }],
          },
          {
            type: 'web_fetch_tool_result',
            tool_use_id: 'wf1',
            content: {
              type: 'web_fetch_result',
              url: 'https://www.larepublica.co/andina',
              content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Distribuidora Andina abrirá 15 tiendas en la costa durante el próximo año, anunció su gerente.' } },
            },
          },
          {
            type: 'tool_use',
            id: 'tu_r',
            name: RESEARCH_SUBMIT_TOOL,
            input: {
              summary: 'x',
              facts: [
                { ref: 'W1', topic: 'recent_signal', statement: 'Abrirá 15 tiendas en la costa.', quote: 'Distribuidora Andina abrirá 15 tiendas en la costa', doc_id: null, source_url: 'https://www.larepublica.co/andina', published_on: null },
              ],
              hypotheses: [],
              gaps: [],
            },
          },
        ] as never,
        stopReason: 'tool_use',
        usage: usage(),
        requests: 1,
      }),
    });
    await runFirstCall(REQUEST, deps);
    const final = calls.briefPatches.find((p) => p.status !== undefined)!;
    const fact = final.facts!.find((f) => f.sourceUrl === 'https://www.larepublica.co/andina');
    assert.ok(fact, 'la cita está en lo que Claude leyó');
    assert.equal(fact!.publishedOn, '2026-09-20', 'la fecha sale del resultado de la búsqueda');
  });
});

describe('runFirstCall — créditos de Tavily', () => {
  it('si Tavily no informa créditos, cada búsqueda básica cuenta 1 (nunca queda vacío)', async () => {
    const { deps, calls } = harness();
    deps.searchNews = async () => ({ results: [], credits: null, skipped: false, error: null });
    await runFirstCall(REQUEST, deps);
    const tavily = calls.logs.filter((l) => l.providerKey === 'tavily');
    assert.equal(tavily.length, 3, 'noticias, talento y el decisor (una fila por sus dos búsquedas)');
    assert.ok(tavily.filter((l) => l.agentStep !== 'contacto_busqueda').every((l) => l.credits === 1), 'créditos con respaldo');
    assert.equal(tavily.find((l) => l.agentStep === 'contacto_busqueda')?.credits, 2);
    assert.ok(tavily.every((l) => l.costUsd === null), 'el costo en dólares lo pone la capa real con la tarifa (null = desconocido)');
  });

  it('una búsqueda que falló no cobra créditos que no consta que se cobraron', async () => {
    const { deps, calls } = harness();
    deps.searchNews = async () => ({ results: [], credits: null, skipped: false, error: 'tavily_http_500' });
    await runFirstCall(REQUEST, deps);
    const tavily = calls.logs.filter((l) => l.providerKey === 'tavily');
    assert.ok(tavily.every((l) => l.status === 'error' && l.credits === 0 && l.errorCode === 'tavily_http_500'));
  });

  it('sin llave de Tavily no hubo consulta: nada que registrar', async () => {
    const { deps, calls } = harness();
    deps.searchNews = async () => ({ results: [], credits: null, skipped: true, error: null });
    await runFirstCall(REQUEST, deps);
    assert.equal(calls.logs.filter((l) => l.providerKey === 'tavily').length, 0);
  });
});

describe('runFirstCall — verificación del paquete', () => {
  const BAD_PACK = { ...GOOD_PACK, reason_to_call: { text: 'Crecieron 35% este año.', fact_refs: ['F5'] } };

  it('un paquete con cifras inventadas vuelve una vez al redactor y queda listo si lo corrige', async () => {
    const { deps, calls } = harness({ writer: [BAD_PACK, GOOD_PACK] });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok && result.packStatuses[0], 'draft');
    const writerCalls = calls.conversations.filter((b) => (b.tools as Array<{ name?: string }>).some((t) => t.name === WRITER_SUBMIT_TOOL));
    assert.equal(writerCalls.length, 2);
    const retry = writerCalls[1].messages.at(-1)!.content as Array<{ type: string; text?: string }>;
    assert.ok(retry.some((b) => b.type === 'tool_result'), 'responde al tool_use anterior');
    assert.ok(retry.some((b) => b.type === 'text' && b.text!.includes('35%')));
  });

  it('si sigue mal, queda «para revisar» con los motivos', async () => {
    const { deps, calls } = harness({ writer: [BAD_PACK, BAD_PACK] });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok && result.packStatuses[0], 'needs_review');
    assert.ok(calls.packs[0].verifierIssues.some((i) => i.includes('35%')));
  });

  it('si el redactor no entrega nada, el paquete queda fallido y se avisa', async () => {
    const { deps, calls } = harness();
    const original = deps.runConversation;
    deps.runConversation = async (body, key) => {
      const isWriter = (body.tools as Array<{ name?: string }>).some((t) => t.name === WRITER_SUBMIT_TOOL);
      if (!isWriter) return original(body, key);
      calls.conversations.push(body);
      return { content: [{ type: 'text', text: 'no sé' }], stopReason: 'end_turn', usage: usage(), requests: 1 };
    };
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(!result.ok && result.code, 'writer_failed');
    assert.equal(calls.packs[0].status, 'failed');
  });
});

describe('runFirstCall — cascada con varias selecciones', () => {
  const SECOND = { id: 'c2', name: 'Jorge Ruiz', title: 'Gerente General', department: null };
  const MULTI = {
    ...GOOD_PACK,
    messages: [
      { channel: 'call', text: 'María, le dejo este mensaje por las nuevas sedes. ¿Lo vemos 20 minutos?', fact_refs: ['F5'] },
      { channel: 'email', text: 'Asunto: Asesores para las nuevas sedes\nMaría, vi que están contratando. ¿Conversamos?', fact_refs: ['F5'] },
    ],
  };

  it('investiga una vez, redacta una vez por decisor y canal (en paralelo) y guarda una preparación por decisor y canal', async () => {
    const { deps, calls } = harness({ context: { decisionMakers: [INTERNAL.decisionMaker!, SECOND] }, writer: [MULTI, MULTI, MULTI, MULTI] });
    const result = await runFirstCall({ ...REQUEST, contactIds: ['c1', 'c2'], channels: ['call', 'email'] }, deps);
    assert.equal(result.ok, true);
    assert.equal(calls.briefsCreated, 1);
    const writerCalls = calls.conversations.filter((b) => (b.tools as Array<{ name?: string }>).some((t) => t.name === WRITER_SUBMIT_TOOL));
    // Davivienda (19-10): un redactor por canal, para que ninguna respuesta se corte.
    assert.equal(writerCalls.length, 4);
    for (const call of writerCalls) {
      const tool = (call.tools as Array<{ name?: string; input_schema?: { properties?: { messages?: { items?: { properties?: { channel?: { enum?: string[] } } } } } } }>)
        .find((t) => t.name === WRITER_SUBMIT_TOOL);
      assert.equal(tool?.input_schema?.properties?.messages?.items?.properties?.channel?.enum?.length, 1);
    }
    assert.deepEqual(
      calls.packs.map((p) => `${p.contactId}:${p.channel}`).sort(),
      ['c1:call', 'c1:email', 'c2:call', 'c2:email'],
    );
    assert.equal(calls.packs.find((p) => p.contactId === 'c2')?.targetTitle, 'Gerente General');
    assert.equal(calls.packs.find((p) => p.channel === 'email')?.content?.callScript.text, '');
    assert.equal(result.ok && result.packIds.length, 4);
    // Un registro de uso por decisor (suma sus canales), repartido entre sus preparaciones.
    const writerLogs = calls.logs.filter((l) => l.operationKey === 'first_call_pack');
    assert.equal(writerLogs.length, 2);
    assert.equal(writerLogs[0].metadata.writer_calls, 2);
    assert.deepEqual(Object.keys(writerLogs[0].metadata.stop_reasons as object).sort(), ['call', 'email']);
    const c1Cost = calls.packs.filter((p) => p.contactId === 'c1').reduce((sum, p) => sum + p.costUsd, 0);
    assert.ok(Math.abs(c1Cost - (writerLogs[0].costUsd ?? 0)) < 1e-9);
  });

  it('sin decisor escribe una vez y deja la preparación sin contacto', async () => {
    const { deps, calls } = harness({ context: { decisionMakers: [] } });
    const result = await runFirstCall({ ...REQUEST, contactIds: [] }, deps);
    assert.equal(result.ok, true);
    assert.equal(calls.packs.length, 1);
    assert.equal(calls.packs[0].contactId, null);
  });

  it('con una preparación lista, la empresa pasa a «Lista para contacto»', async () => {
    const { deps, calls } = harness();
    await runFirstCall(REQUEST, deps);
    assert.deepEqual(calls.statuses, ['ready_for_outreach']);
  });

  it('si no sale ninguna preparación, el estado no cambia (no queda «en curso» para siempre)', async () => {
    // Entrega y corrección, y el intento simple con su corrección: todas vacías.
    const { deps, calls } = harness({ writer: [{}, {}, {}, {}] });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok, false);
    assert.deepEqual(calls.statuses, []);
  });

  it('si los decisores pedidos ya no están en la empresa, no escribe «sin decisor» ni gasta', async () => {
    const { deps, calls } = harness({ context: { decisionMakers: [] } });
    const result = await runFirstCall({ ...REQUEST, contactIds: ['c-borrado'] }, deps);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, 'contacts_not_found');
    assert.equal(calls.conversations.length, 0);
    assert.equal(calls.packs.length, 0);
  });

  it('si guardar falla para un decisor, los demás siguen y la ficha termina en «done»', async () => {
    const { deps, calls } = harness({ context: { decisionMakers: [INTERNAL.decisionMaker!, SECOND] }, writer: [MULTI, MULTI] });
    const insert = deps.insertPack;
    deps.insertPack = async (pack) => {
      if (pack.contactId === 'c2') throw new Error('db down');
      return insert(pack);
    };
    const result = await runFirstCall({ ...REQUEST, contactIds: ['c1', 'c2'], channels: ['call', 'email'] }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.packIds.length, 2);
    assert.equal(calls.briefPatches.at(-1)?.progressStage, 'done');
  });

  it('con productos pedidos, se guarda el que eligió el redactor', async () => {
    const { deps, calls } = harness({ writer: [{ ...GOOD_PACK, product_key: 'desempeno_360' }] });
    await runFirstCall({ ...REQUEST, productKeys: ['desempeno_360', 'aprendizaje_planes'] }, deps);
    assert.equal(calls.packs[0].productFocus, 'desempeno_360');
  });
});

describe('runFirstCall — entrega incompleta del redactor (Grupo Ciisa, 18-10)', () => {
  it('una llamada con guion queda «para revisar» aunque falte el mensaje de voz; los otros canales sin mensaje fallan y el registro dice qué faltó', async () => {
    const incomplete = { ...GOOD_PACK, short_message: undefined, messages: [] };
    // Por canal: entrega + corrección, y el intento simple del canal que siga sin mensaje.
    const { deps, calls } = harness({ writer: [incomplete, incomplete, incomplete, incomplete, incomplete, incomplete] });
    const result = await runFirstCall({ ...REQUEST, channels: ['call', 'email'] }, deps);
    assert.equal(result.ok, true);
    const call = calls.packs.find((p) => p.channel === 'call')!;
    const email = calls.packs.find((p) => p.channel === 'email')!;
    assert.equal(call.status, 'needs_review');
    assert.ok(call.content?.callScript.text);
    assert.equal(email.status, 'failed');
    const log = calls.logs.find((l) => l.operationKey === 'first_call_pack')!;
    assert.deepEqual(log.metadata.missing_channels, ['call', 'email']);
    const shapes = log.metadata.submission_shape as Record<string, Record<string, string>>;
    assert.equal(shapes.call.messages, 'array(0)');
    assert.equal(shapes.email.messages, 'array(0)');
  });
});

describe('runFirstCall — intento simple cuando un canal queda sin mensaje (Davivienda, 19-10)', () => {
  // Lo que entregó Haiku en Prod, dos veces seguidas: el enfoque y el motivo, nada más.
  const FOUR_FIELDS = { approach: 'problem', approach_reason: 'Por el problema', reason_to_call: 'Integración', fact_refs: ['F5'] };

  it('reintenta ese canal con SOLO la versión principal y deja una preparación usable', async () => {
    const { deps, calls } = harness({ writer: [FOUR_FIELDS, FOUR_FIELDS, GOOD_PACK] });
    const result = await runFirstCall({ ...REQUEST, channels: ['call'], approaches: [] }, deps);
    assert.equal(result.ok, true);
    const writerCalls = calls.conversations.filter((b) => (b.tools as Array<{ name?: string }>).some((t) => t.name === WRITER_SUBMIT_TOOL));
    assert.equal(writerCalls.length, 3);
    // El intento simple no pide las versiones de los otros enfoques.
    const lastTool = (writerCalls[2].tools as Array<{ name?: string; input_schema?: { properties?: Record<string, unknown> } }>).find((t) => t.name === WRITER_SUBMIT_TOOL);
    assert.equal(lastTool?.input_schema?.properties?.call_script_variants, undefined);
    assert.notEqual(calls.packs[0].status, 'failed');
    const log = calls.logs.find((l) => l.operationKey === 'first_call_pack')!;
    assert.deepEqual(log.metadata.fallback_channels, ['call']);
    assert.equal(log.metadata.missing_channels, undefined);
  });

  it('si tampoco sale, queda fallida y el registro guarda el comienzo de lo que entregó Claude', async () => {
    const { deps, calls } = harness({ writer: [FOUR_FIELDS, FOUR_FIELDS, FOUR_FIELDS, FOUR_FIELDS] });
    await runFirstCall({ ...REQUEST, channels: ['linkedin'] }, deps);
    assert.equal(calls.packs[0].status, 'failed');
    const log = calls.logs.find((l) => l.operationKey === 'first_call_pack')!;
    assert.deepEqual(log.metadata.missing_channels, ['linkedin']);
    const preview = (log.metadata.raw_preview as Record<string, string>).linkedin;
    assert.match(preview, /^tool_use /);
    assert.match(preview, /reason_to_call/);
  });
});

describe('runFirstCall — lo investigado del decisor se reutiliza (dueña 19-10)', () => {
  const CACHED = {
    facts: [
      {
        topic: 'decision_maker' as const,
        statement: 'Asumió la gerencia de talento en agosto.',
        quote: 'María Pérez asumió la gerencia de talento',
        sourceKind: 'news' as const,
        sourceUrl: 'https://diario.example/maria',
        sourceLabel: 'Web · diario.example',
        publishedOn: '2026-08-02',
        category: 'new_in_role' as const,
      },
    ],
    insight: { hook: 'Llegó hace poco al cargo.', priorities: [], unknowns: [], leadsTraining: 'yes' as const },
    researchedAt: '2026-10-08T10:00:00.000Z',
  };

  it('con algo reciente de la persona no la vuelve a buscar y el redactor lo recibe', async () => {
    const { deps, calls } = harness();
    const asked: string[] = [];
    deps.readCachedContactResearch = async (accountId, contactId, sinceIso) => {
      asked.push(`${accountId}:${contactId}:${sinceIso.slice(0, 10)}`);
      return CACHED;
    };
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok, true);
    assert.deepEqual(asked, [`${ACCOUNT_ID}:c1:2026-10-02`], 'mira los últimos 14 días');
    assert.equal(calls.news.some((q) => q.includes('"María Pérez"')), false, 'no gasta en buscar a la persona');
    assert.equal(calls.logs.some((l) => l.agentStep === 'contacto_busqueda' || l.agentStep === 'investigar_contacto'), false);
    const writerMessage = calls.conversations.at(-1)!.messages[0].content as string;
    assert.match(writerMessage, /asumió la gerencia de talento/);
    assert.deepEqual((calls.packs[0].content as { contactInsight?: unknown }).contactInsight, CACHED.insight);
    // Se vuelve a guardar con la fecha ORIGINAL: los 14 días no se renuevan solos.
    assert.equal((calls.packs[0].content as { contactResearch?: { researchedAt: string } }).contactResearch?.researchedAt, CACHED.researchedAt);
  });

  it('lo que se investiga hoy se guarda aparte, con su fecha, para reutilizarlo', async () => {
    const { deps, calls } = harness();
    deps.searchNews = async (input) =>
      input.query.includes('"María Pérez"')
        ? {
            results: [{ url: 'https://diario.example/maria', title: 'Nombramiento', content: 'Distribuidora Andina nombró a María Pérez gerente de talento en agosto de 2026.', publishedOn: '2026-08-02' }],
            credits: 1,
            skipped: false,
            error: null,
          }
        : { results: [], credits: 1, skipped: false, error: null };
    const base = deps.runConversation;
    deps.runConversation = async (body, key) => {
      const tool = (body.tools as Array<{ name?: string }>).find((t) => t.name === 'submit_contact_findings');
      if (!tool) return base(body, key);
      return {
        content: [
          {
            type: 'tool_use',
            id: 'c1',
            name: 'submit_contact_findings',
            input: {
              facts: [{ category: 'new_in_role', doc_id: 'D1', source_url: null, quote: 'Distribuidora Andina nombró a María Pérez gerente de talento', statement: 'Es gerente de talento desde agosto.', published_on: '2026-08-02' }],
              leads_training: 'yes',
              best_hook: 'Llegó hace poco.',
              likely_priorities: [],
              unknowns: [],
            },
          } as never,
        ],
        stopReason: 'tool_use',
        usage: usage(),
        requests: 1,
      };
    };
    await runFirstCall(REQUEST, deps);
    const saved = (calls.packs[0].content as { contactResearch?: { facts: unknown[]; researchedAt: string } }).contactResearch;
    assert.equal(saved?.facts.length, 1);
    assert.equal(saved?.researchedAt, new Date(NOW).toISOString());
  });

  it('«Investigar de nuevo» la vuelve a buscar aunque haya algo guardado', async () => {
    const { deps, calls } = harness();
    let read = 0;
    deps.readCachedContactResearch = async () => {
      read += 1;
      return CACHED;
    };
    await runFirstCall({ ...REQUEST, refreshResearch: true }, deps);
    assert.equal(read, 0);
    assert.ok(calls.news.some((q) => q.includes('"María Pérez"')));
  });

  it('si leer lo guardado falla, investiga como siempre', async () => {
    const { deps, calls } = harness();
    deps.readCachedContactResearch = async () => {
      throw new Error('db down');
    };
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok, true);
    assert.ok(calls.news.some((q) => q.includes('"María Pérez"')));
  });
});

describe('runFirstCall — búsqueda ampliada por país, industria y fuentes propias (dueña 19-10)', () => {
  it('busca en las fuentes elegidas, registra cada búsqueda aparte con sus sitios y junta los resultados sin repetir', async () => {
    const { deps, calls } = harness();
    const inputs: Array<{ query: string; includeDomains?: readonly string[] }> = [];
    const base = deps.searchNews;
    deps.extendedResearch = true;
    deps.searchNews = async (input) => {
      inputs.push(input);
      if (input.includeDomains?.includes('linkedin.com')) {
        return {
          results: [{ url: 'https://www.linkedin.com/company/andina/', title: 'Distribuidora Andina', content: 'Distribuidora Andina abrió su academia de líderes de tienda para 300 supervisores.', publishedOn: null }],
          credits: 1,
          skipped: false,
          error: null,
        };
      }
      if (input.includeDomains?.includes('larepublica.co')) {
        // La misma nota que trae la búsqueda de noticias: entra una vez.
        return base({ ...input, topic: 'news' });
      }
      return base(input);
    };
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok, true);
    const companySteps = calls.logs.filter((l) => l.providerKey === 'tavily' && l.agentStep !== 'contacto_busqueda').map((l) => l.agentStep);
    assert.deepEqual(companySteps.sort(), ['linkedin', 'medios_talento', 'noticias', 'prensa', 'sitio_propio', 'talento']);
    const press = calls.logs.find((l) => l.agentStep === 'prensa')!;
    assert.equal(press.operationKey, 'account_research_press');
    assert.deepEqual(press.metadata.hosts, ['diario.example']);
    assert.ok((press.metadata.include_domains as number) > 0);
    assert.ok(inputs.some((i) => i.includeDomains?.length === 1 && i.includeDomains[0] === 'andina.example'), 'busca en su propio sitio');
    const message = calls.conversations[0].messages[0].content as string;
    assert.equal(message.split('https://diario.example/andina').length - 1, 1, 'la nota repetida va una sola vez');
    assert.match(message, /LinkedIn · fragmento del buscador/);
  });
});

describe('runFirstCall — un canal sin lo común lo toma de otro del mismo decisor (Davivienda Prod, 19-10)', () => {
  it('el LinkedIn que llegó sólo con el mensaje queda con preguntas, objeciones y cierre', async () => {
    const MINIMAL = {
      reason_to_call: { text: 'Están buscando 40 asesores para nuevas sedes.', fact_refs: ['F5'] },
      angle: 'Que cada asesor nuevo llegue listo.',
      short_message: { text: 'María, vi que están contratando 40 asesores para sus nuevas sedes. Me gustaría seguir lo que publica sobre talento.', fact_refs: ['F5'] },
    };
    const { deps, calls } = harness({ writer: [GOOD_PACK, MINIMAL, MINIMAL, MINIMAL, MINIMAL] });
    await runFirstCall({ ...REQUEST, channels: ['call', 'linkedin'] }, deps);
    const linkedin = calls.packs.find((p) => p.channel === 'linkedin')!;
    const content = linkedin.content as { questions: string[]; objections: unknown[]; nextStep: string };
    assert.ok(content.questions.length >= 3, 'preguntas del otro canal');
    assert.ok(content.objections.length > 0, 'objeciones del otro canal');
    assert.ok(content.nextStep, 'cierre del otro canal');
    assert.equal(linkedin.verifierIssues.some((i) => /preguntas|objeciones|siguiente paso/.test(i)), false, linkedin.verifierIssues.join(' | '));
  });
});

describe('runFirstCall — entrega de la investigación cortada (Grupo LALA, banco 20-10)', () => {
  it('una entrega sin lista de datos (se cortó) se vuelve a pedir, sin la entrega cortada', async () => {
    const bodies: AnthropicRequestBody[] = [];
    let call = 0;
    const { deps, calls } = harness({
      research: async (body) => {
        bodies.push(body);
        call += 1;
        return call === 1
          ? {
              content: [
                { type: 'text', text: 'Encontré esto…' },
                { type: 'tool_use', id: 'cut', name: RESEARCH_SUBMIT_TOOL, input: {} },
              ],
              stopReason: 'max_tokens',
              usage: usage(),
              requests: 1,
            }
          : toolUse(RESEARCH_SUBMIT_TOOL, RESEARCH_SUBMISSION);
      },
    });
    await runFirstCall(REQUEST, deps);
    assert.equal(call, 2);
    const retry = JSON.stringify(bodies[1].messages);
    assert.equal(retry.includes('"id":"cut"'), false, 'la entrega cortada no se reenvía');
    const final = calls.briefPatches.find((p) => p.status !== undefined)!;
    assert.ok(final.facts!.some((f) => f.sourceKind !== 'sellup'));
    const log = calls.logs.find((l) => l.agentStep === 'investigar_empresa')!;
    assert.deepEqual(log.metadata.stop_reasons, ['max_tokens', 'tool_use']);
    assert.equal(log.metadata.forced_submission, true);
  });
});

describe('runFirstCall — Brasil y EE. UU.: también en el idioma del país', () => {
  const usContext = (): Partial<FirstCallContext> => ({
    internal: { ...INTERNAL, account: { ...INTERNAL.account, country: 'Estados Unidos', countryCode: 'US' } },
  });

  it('en Colombia no se escribe otra versión', async () => {
    const { deps, calls } = harness();
    await runFirstCall(REQUEST, deps);
    assert.equal(calls.conversations.some((b) => (b.tools as Array<{ name?: string }>).some((t) => t.name === TRANSLATION_SUBMIT_TOOL)), false);
    assert.equal((calls.packs[0].content as { localVersion?: unknown }).localVersion, undefined);
  });

  it('en EE. UU. la preparación queda en español y en inglés, con su costo en Uso de IA', async () => {
    const { deps, calls } = harness({ context: usContext() });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok, true);
    const pack = calls.packs[0];
    const content = pack.content!;
    assert.match(content.callScript.text, /^Hola/, 'la versión principal sigue en español');
    assert.equal(content.localVersion?.language, 'en-US');
    assert.equal(content.localVersion?.callScript, fakeEnglish(content.callScript.text));
    assert.equal(content.localVersion?.questions.length, content.questions.length);
    assert.equal(content.localVersion?.objections[0].response, fakeEnglish(content.objections[0].response));
    assert.equal(content.localVersion?.meetingAsk, fakeEnglish(content.meetingAsk!));
    assert.equal(pack.status, 'draft');
    const log = calls.logs.find((l) => l.agentStep === 'version_idioma_pais')!;
    assert.equal(log.status, 'success');
    assert.equal(log.metadata.language, 'en-US');
    assert.equal(log.countryCode, 'US');
    const translatorBody = calls.conversations.find((b) => (b.tools as Array<{ name?: string }>).some((t) => t.name === TRANSLATION_SUBMIT_TOOL))!;
    assert.match((translatorBody.system as Array<{ text: string }>)[0].text, /Inglés de Estados Unidos/);
  });

  it('una cifra que no estaba en español se corrige una vez y, si sigue, queda para revisar', async () => {
    let calls = 0;
    const { deps, calls: seen } = harness({
      context: usContext(),
      translator: async (body) => {
        calls += 1;
        return translatedEcho(body, (t, id) => (id === 'meeting' ? `${fakeEnglish(t)} We train 5000 people.` : fakeEnglish(t)));
      },
    });
    await runFirstCall(REQUEST, deps);
    assert.equal(calls, 2, 'se pidió una corrección');
    const pack = seen.packs[0];
    assert.equal(pack.status, 'needs_review');
    assert.ok(pack.verifierIssues.some((i) => /^En inglés, el pedido de reunión trae cifras que no están en español \(5000\)/.test(i)));
    assert.ok(pack.content!.localVersion, 'la versión se guarda igual, con el aviso');
  });

  it('si la versión en inglés falla, la de español sigue sirviendo y el aviso lo dice', async () => {
    const { deps, calls } = harness({
      context: usContext(),
      translator: async () => {
        throw new AnthropicApiError(529, 'overloaded', 'Claude está ocupado', EMPTY_USAGE);
      },
    });
    const result = await runFirstCall(REQUEST, deps);
    assert.equal(result.ok, true);
    const pack = calls.packs[0];
    assert.equal(pack.content!.localVersion, undefined);
    assert.equal(pack.status, 'needs_review');
    assert.deepEqual(pack.verifierIssues, ['No se pudo escribir la versión en inglés: usa la de español o pide otra versión.']);
    assert.equal(calls.logs.find((l) => l.agentStep === 'version_idioma_pais')!.status, 'error');
  });
});

describe('runFirstCall — «Por un evento reciente» sin noticia fresca (SoftExpert, Prod 20-10)', () => {
  it('sin una noticia de los últimos 90 días escribe con el enfoque recomendado y lo dice en «Cuidado»', async () => {
    // La noticia del arnés es del 10-07 y hoy es 16-10: 98 días.
    const { deps, calls } = harness();
    await runFirstCall({ ...REQUEST, approaches: ['trigger'] }, deps);
    const writerBody = calls.conversations.find((b) => (b.tools as Array<{ name?: string }>).some((t) => t.name === WRITER_SUBMIT_TOOL))!;
    assert.equal(JSON.stringify(writerBody.tools).includes('"trigger"'), false, 'el redactor ya no recibe ese enfoque');
    assert.equal(
      calls.packs[0].content!.cautions[0],
      'Pediste «Por un evento reciente», pero no hay una noticia de los últimos 90 días: se escribió con «Por el problema».',
    );
  });

  it('con una noticia fresca respeta lo que pidió el vendedor', async () => {
    const { deps, calls } = harness();
    await runFirstCall({ ...REQUEST, approaches: ['trigger'] }, { ...deps, now: () => Date.parse('2026-08-01T15:00:00Z') });
    assert.equal(calls.packs[0].content!.cautions.some((c) => c.startsWith('Pediste')), false);
  });
});

