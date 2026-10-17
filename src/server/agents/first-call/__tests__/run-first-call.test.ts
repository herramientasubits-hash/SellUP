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
    assert.equal(calls.news.length, 2, 'una búsqueda de noticias y una de talento');
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
    assert.deepEqual(steps, ['anthropic:investigar_empresa', 'anthropic:redactar_llamada', 'tavily:noticias', 'tavily:talento']);
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
    assert.deepEqual(calls.news, []);
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

describe('runFirstCall — créditos de Tavily', () => {
  it('si Tavily no informa créditos, cada búsqueda básica cuenta 1 (nunca queda vacío)', async () => {
    const { deps, calls } = harness();
    deps.searchNews = async () => ({ results: [], credits: null, skipped: false, error: null });
    await runFirstCall(REQUEST, deps);
    const tavily = calls.logs.filter((l) => l.providerKey === 'tavily');
    assert.equal(tavily.length, 2);
    assert.ok(tavily.every((l) => l.credits === 1), 'créditos con respaldo');
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

  it('investiga una vez, redacta una vez por decisor y guarda una preparación por decisor y canal', async () => {
    const { deps, calls } = harness({ context: { decisionMakers: [INTERNAL.decisionMaker!, SECOND] }, writer: [MULTI, MULTI] });
    const result = await runFirstCall({ ...REQUEST, contactIds: ['c1', 'c2'], channels: ['call', 'email'] }, deps);
    assert.equal(result.ok, true);
    assert.equal(calls.briefsCreated, 1);
    const writerCalls = calls.conversations.filter((b) => (b.tools as Array<{ name?: string }>).some((t) => t.name === WRITER_SUBMIT_TOOL));
    assert.equal(writerCalls.length, 2);
    assert.deepEqual(
      calls.packs.map((p) => `${p.contactId}:${p.channel}`).sort(),
      ['c1:call', 'c1:email', 'c2:call', 'c2:email'],
    );
    assert.equal(calls.packs.find((p) => p.contactId === 'c2')?.targetTitle, 'Gerente General');
    assert.equal(calls.packs.find((p) => p.channel === 'email')?.content?.callScript.text, '');
    assert.equal(result.ok && result.packIds.length, 4);
    // El costo de cada llamada al redactor se reparte entre sus canales.
    const writerLogs = calls.logs.filter((l) => l.operationKey === 'first_call_pack');
    assert.equal(writerLogs.length, 2);
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
    const { deps, calls } = harness({ writer: [{}, {}] });
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
