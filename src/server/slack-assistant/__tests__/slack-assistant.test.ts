import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSlackSignature, isValidSlackSignature } from '../signature';
import { cleanSlackText, parseSlackEvent } from '../events';
import { runAssistantTool, type AssistantDataSource } from '../tools';
import { answerQuestion, buildAssistantSystemPrompt, MAX_TOOL_ROUNDS } from '../run';
import { scopeLabelFor } from '../copy';
import { ilikePattern, scopeOwnerIds, usagePeriodStart } from '../data-source.server';
import {
  AnthropicApiError,
  EMPTY_USAGE,
  type AnthropicConversationResult,
  type AnthropicRequestBody,
} from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';

// ── Firma ────────────────────────────────────────────────────────────────────

describe('firma de Slack', () => {
  const secret = 'shh';
  const body = '{"type":"event_callback"}';
  const now = 1_700_000_000;
  const ts = String(now);
  const signature = computeSlackSignature(secret, ts, body);

  it('acepta un mensaje firmado y reciente', () => {
    assert.equal(isValidSlackSignature({ signingSecret: secret, timestamp: ts, signature, rawBody: body, nowSeconds: now }), true);
  });

  it('🔴 rechaza firma ajena, cuerpo cambiado, mensaje viejo o sin secreto', () => {
    const base = { signingSecret: secret, timestamp: ts, signature, rawBody: body, nowSeconds: now };
    assert.equal(isValidSlackSignature({ ...base, signature: computeSlackSignature('otro', ts, body) }), false);
    assert.equal(isValidSlackSignature({ ...base, rawBody: body + ' ' }), false);
    assert.equal(isValidSlackSignature({ ...base, nowSeconds: now + 301 }), false);
    assert.equal(isValidSlackSignature({ ...base, signingSecret: undefined }), false);
    assert.equal(isValidSlackSignature({ ...base, timestamp: 'abc' }), false);
    assert.equal(isValidSlackSignature({ ...base, signature: 'v0=corta' }), false);
  });
});

// ── Eventos ──────────────────────────────────────────────────────────────────

const callback = (event: Record<string, unknown>) => ({ type: 'event_callback', event_id: 'Ev1', event });

describe('eventos de Slack', () => {
  it('responde la verificación de la dirección', () => {
    assert.deepEqual(parseSlackEvent({ type: 'url_verification', challenge: 'abc' }), { kind: 'url_verification', challenge: 'abc' });
  });

  it('mensaje directo: pregunta sin hilo (responde en la conversación)', () => {
    const action = parseSlackEvent(callback({ type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', ts: '1.1', text: '¿cuántas empresas tengo?' }));
    assert.equal(action.kind, 'question');
    if (action.kind !== 'question') return;
    assert.equal(action.source, 'direct_message');
    assert.equal(action.threadTs, null);
    assert.equal(action.text, '¿cuántas empresas tengo?');
    assert.equal(action.eventId, 'Ev1');
  });

  it('mención en canal: responde en hilo y sin la mención', () => {
    const action = parseSlackEvent(callback({ type: 'app_mention', user: 'U1', channel: 'C1', ts: '2.2', text: '<@UBOT> mis búsquedas' }));
    assert.equal(action.kind, 'question');
    if (action.kind !== 'question') return;
    assert.equal(action.threadTs, '2.2');
    assert.equal(action.text, 'mis búsquedas');
  });

  it('🔴 ignora mensajes de bots, ediciones, canales normales y texto vacío', () => {
    assert.equal(parseSlackEvent(callback({ type: 'message', channel_type: 'im', bot_id: 'B1', user: 'U1', channel: 'D1', ts: '1', text: 'x' })).kind, 'ignore');
    assert.equal(parseSlackEvent(callback({ type: 'message', subtype: 'message_changed', channel_type: 'im', channel: 'D1', ts: '1' })).kind, 'ignore');
    assert.equal(parseSlackEvent(callback({ type: 'message', channel_type: 'channel', user: 'U1', channel: 'C1', ts: '1', text: 'hola' })).kind, 'ignore');
    assert.equal(parseSlackEvent(callback({ type: 'app_mention', user: 'U1', channel: 'C1', ts: '1', text: '<@UBOT>' })).kind, 'ignore');
    assert.equal(parseSlackEvent({ type: 'otro' }).kind, 'ignore');
    assert.equal(parseSlackEvent(null).kind, 'ignore');
  });

  it('limpia enlaces y entidades de Slack', () => {
    assert.equal(cleanSlackText('mira <https://acme.com|acme.com> &amp; <https://x.co>'), 'mira acme.com & https://x.co');
  });
});

// ── Herramientas ─────────────────────────────────────────────────────────────

function fakeData(overrides: Partial<AssistantDataSource> = {}): AssistantDataSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    summary: async () => {
      calls.push('summary');
      return { empresasActivas: 3, empresasPorEstado: { Nueva: 3 }, prospectosPorRevisar: 5, busquedasEnCurso: 1, contactos: 9 };
    },
    searchAccounts: async (text, limit) => {
      calls.push(`search:${text}:${limit}`);
      return [];
    },
    accountContacts: async (text, limit) => {
      calls.push(`contacts:${text}:${limit}`);
      return { empresa: null, contactos: [] };
    },
    recentSearches: async (limit) => {
      calls.push(`searches:${limit}`);
      return [];
    },
    aiUsage: async (period) => {
      calls.push(`usage:${period}`);
      return { periodo: period, desde: '2026-11-01', consultas: 0, errores: 0, costoUsd: 0, porProveedor: [] };
    },
    ...overrides,
  };
}

describe('herramientas de sólo lectura', () => {
  it('recorta límites y normaliza el periodo', async () => {
    const data = fakeData();
    await runAssistantTool(data, 'buscar_empresas', { texto: ' Acme ', limite: 999 });
    await runAssistantTool(data, 'ultimas_busquedas', {});
    await runAssistantTool(data, 'uso_de_ia', { periodo: 'año' });
    assert.deepEqual(data.calls, ['search:Acme:15', 'searches:5', 'usage:mes']);
  });

  it('sin texto, herramienta desconocida o error de lectura: vuelve un error, no lanza', async () => {
    const data = fakeData({ summary: async () => { throw new Error('caída'); } });
    assert.equal((await runAssistantTool(data, 'buscar_empresas', {})).isError, true);
    assert.equal((await runAssistantTool(data, 'borrar_todo', {})).isError, true);
    const failed = await runAssistantTool(data, 'mi_resumen', {});
    assert.equal(failed.isError, true);
    assert.match(failed.content, /No se pudo leer: caída/);
  });
});

// ── Conversación ─────────────────────────────────────────────────────────────

const USAGE = { ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20 };

function scripted(responses: AnthropicConversationResult[]) {
  const bodies: AnthropicRequestBody[] = [];
  return {
    bodies,
    run: async (body: AnthropicRequestBody) => {
      bodies.push(structuredClone(body));
      const next = responses.shift();
      if (!next) throw new Error('sin más respuestas');
      return next;
    },
  };
}

const INPUT = {
  question: '¿cuántos prospectos tengo por revisar?',
  asker: { name: 'Carla', roleLabel: 'Vendedor', scopeLabel: 'sólo sus propias empresas' },
  model: 'claude-sonnet-4-5',
  apiKey: 'k',
  today: '2026-11-11',
  loginUrl: 'https://sellup.example/login',
};

describe('conversación con Claude', () => {
  it('usa la herramienta, devuelve el resultado y responde con el texto final', async () => {
    const script = scripted([
      { content: [{ type: 'tool_use', id: 't1', name: 'mi_resumen', input: {} }], stopReason: 'tool_use', usage: USAGE, requests: 1 },
      { content: [{ type: 'text', text: 'Tienes *5* prospectos por revisar.' }], stopReason: 'end_turn', usage: USAGE, requests: 1 },
    ]);
    const data = fakeData();
    const result = await answerQuestion(INPUT, { runConversation: script.run, data });

    assert.equal(result.answer, 'Tienes *5* prospectos por revisar.');
    assert.equal(result.status, 'success');
    assert.deepEqual(result.toolCalls, ['mi_resumen']);
    assert.equal(result.usage.inputTokens, 200);
    assert.equal(result.requests, 2);
    const second = script.bodies[1].messages;
    const toolResult = (second[2].content as Array<Record<string, unknown>>)[0];
    assert.equal(toolResult.type, 'tool_result');
    assert.equal(toolResult.tool_use_id, 't1');
    assert.match(String(toolResult.content), /"prospectosPorRevisar":5/);
  });

  it('🔴 Claude sin créditos: la respuesta lo dice claro', async () => {
    const result = await answerQuestion(INPUT, {
      runConversation: async () => { throw new AnthropicApiError(400, 'credits_exhausted', 'x', EMPTY_USAGE); },
      data: fakeData(),
    });
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'credits_exhausted');
    assert.match(result.answer, /^No pude responder\. Claude se quedó sin créditos/);
  });

  it('no se queda dando vueltas: corta tras el tope de herramientas', async () => {
    const loop: AnthropicConversationResult = {
      content: [{ type: 'tool_use', id: 't', name: 'mi_resumen', input: {} }],
      stopReason: 'tool_use',
      usage: USAGE,
      requests: 1,
    };
    const script = scripted(Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => loop));
    const result = await answerQuestion(INPUT, { runConversation: script.run, data: fakeData() });
    assert.equal(result.errorCode, 'too_many_rounds');
    assert.equal(script.bodies.length, MAX_TOOL_ROUNDS + 1);
  });

  it('el sistema dice quién pregunta, qué ve, que sólo consulta y la fecha', () => {
    const prompt = buildAssistantSystemPrompt(INPUT);
    assert.match(prompt, /Carla \(Vendedor\)/);
    assert.match(prompt, /sólo sus propias empresas/);
    assert.match(prompt, /Sólo puedes CONSULTAR/);
    assert.match(prompt, /2026-11-11/);
  });
});

// ── Alcance y fechas ─────────────────────────────────────────────────────────

describe('alcance y periodos', () => {
  it('admin sin filtro; el resto, sólo sus responsables', () => {
    assert.equal(scopeOwnerIds({ canViewAll: true, allowedUserIds: [] }), null);
    assert.deepEqual(scopeOwnerIds({ canViewAll: false, allowedUserIds: ['a', 'b'] }), ['a', 'b']);
    assert.match(scopeLabelFor({ canViewAll: false, isRestrictedToSelf: false, allowedUserIds: ['a', 'b', 'c'] }), /su equipo \(3 personas\)/);
    assert.match(scopeLabelFor({ canViewAll: false, isRestrictedToSelf: true, allowedUserIds: ['a'] }), /sólo sus propias/);
  });

  it('hoy, semana y mes se cuentan en hora de Bogotá', () => {
    const now = new Date('2026-11-11T03:00:00Z'); // 10 nov, 10 p. m. en Bogotá
    assert.equal(usagePeriodStart('hoy', now), '2026-11-10T05:00:00.000Z');
    assert.equal(usagePeriodStart('semana', now), '2026-11-04T05:00:00.000Z');
    assert.equal(usagePeriodStart('mes', now), '2026-11-01T05:00:00.000Z');
  });

  it('el texto de búsqueda no rompe el filtro (comodines, comas, paréntesis)', () => {
    assert.equal(ilikePattern('50%_a,b(c)'), '%50\\%\\_a b c%');
  });
});
