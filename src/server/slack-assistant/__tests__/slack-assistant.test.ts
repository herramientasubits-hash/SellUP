import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSlackSignature, isValidSlackSignature } from '../signature';
import { cleanSlackText, parseSlackEvent } from '../events';
import { runAssistantTool, toolsForRole, type AssistantAdminDataSource, type AssistantDataSource } from '../tools';
import { buildConversationTurns } from '../conversation';
import { accountLink, pendingProspectsLink, searchesLink } from '../links';
import { answerQuestion, buildAssistantSystemPrompt, MAX_TOOL_ROUNDS } from '../run';
import { scopeLabelFor } from '../copy';
import { accountLookup, accountScopeClause, combineOr, countryFilter, createdSince, ilikePattern, scopeOwnerIds, usagePeriodStart } from '../query-helpers';
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
    assert.equal(action.messageTs, '2.2');
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

const USAGE_RESULT = {
  periodo: 'mes' as const,
  desde: '2026-11-01',
  alcance: 'x',
  consultas: 0,
  errores: 0,
  creditos: 0,
  costoUsd: 0,
  porProveedor: [],
  porPersona: [],
  enlace: 'u',
};

function fakeData(overrides: Partial<AssistantDataSource> = {}): AssistantDataSource & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    summary: async () => {
      calls.push('summary');
      return {
        alcance: 'toda la plataforma',
        empresasActivas: 3,
        empresasPorEstado: { Nueva: 3 },
        prospectosPorRevisar: 5,
        busquedasEnCurso: 1,
        contactos: 9,
        enlaces: { empresas: 'e', porRevisar: 'p', busquedas: 'b' },
      };
    },
    prospects: async (filters, limit) => {
      calls.push({ tool: 'prospects', filters, limit });
      return { estado: filters.estado, total: 0, mostrados: 0, enlace: 'p', prospectos: [] };
    },
    accounts: async (filters, limit) => {
      calls.push({ tool: 'accounts', filters, limit });
      return { total: 0, mostradas: 0, empresas: [] };
    },
    accountDetail: async (query) => {
      calls.push({ tool: 'detail', query });
      return { encontrada: false, otrasCoincidencias: [] };
    },
    contacts: async (filters, limit) => {
      calls.push({ tool: 'contacts', filters, limit });
      return { total: 0, mostrados: 0, contactos: [] };
    },
    searches: async (filters, limit) => {
      calls.push({ tool: 'searches', filters, limit });
      return [];
    },
    aiUsage: async (period, responsable) => {
      calls.push({ tool: 'usage', period, responsable });
      return { ...USAGE_RESULT, periodo: period };
    },
    help: (query) => {
      calls.push({ tool: 'help', query });
      return { encontrada: false, fichas: [], temasDisponibles: [], nota: '' };
    },
    ...overrides,
  };
}

function fakeAdmin(): AssistantAdminDataSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    users: async () => { calls.push('users'); return { total: 0, porEstado: {}, usuarios: [], enlace: 'u' }; },
    sourceCatalog: async () => { calls.push('sources'); return { total: 0, porEstado: {}, fuentes: [], enlace: 's' }; },
    industryCatalog: async () => { calls.push('industries'); return { version: null, industrias: [] }; },
    budget: async () => { calls.push('budget'); return { mes: '2026-11', proveedores: [], reglasActivas: [], enlace: 'b' }; },
  };
}

describe('herramientas de sólo lectura', () => {
  it('prospectos: estado por defecto «por revisar», filtros y límite recortado', async () => {
    const data = fakeData();
    await runAssistantTool(data, null, 'prospectos', { pais: ' CL ', periodo: 'hoy', busqueda: 'Copec', limite: 999, otro: 'x' });
    assert.deepEqual(data.calls[0], {
      tool: 'prospects',
      filters: { texto: undefined, pais: 'CL', industria: undefined, responsable: undefined, periodo: 'hoy', busqueda: 'Copec', estado: 'por_revisar' },
      limit: 50,
    });
    await runAssistantTool(data, null, 'prospectos', { estado: 'descartados' });
    assert.equal((data.calls[1] as { filters: { estado: string } }).filters.estado, 'descartados');
    await runAssistantTool(data, null, 'prospectos', { estado: 'borrados' });
    assert.equal((data.calls[2] as { filters: { estado: string } }).filters.estado, 'por_revisar');
  });

  it('empresas: estado desconocido se ignora; periodo inválido = todo', async () => {
    const data = fakeData();
    await runAssistantTool(data, null, 'empresas', { estado: 'borrada', periodo: 'año', responsable: 'Pedro' });
    const call = data.calls[0] as { filters: Record<string, unknown>; limit: number };
    assert.equal(call.filters.estado, undefined);
    assert.equal(call.filters.periodo, 'todo');
    assert.equal(call.filters.responsable, 'Pedro');
    assert.equal(call.limit, 15);
  });

  it('ficha y contactos piden algo que buscar', async () => {
    const data = fakeData();
    assert.equal((await runAssistantTool(data, null, 'ficha_empresa', {})).isError, true);
    assert.equal((await runAssistantTool(data, null, 'contactos', {})).isError, true);
    await runAssistantTool(data, null, 'ficha_empresa', { consulta: '900123456' });
    await runAssistantTool(data, null, 'contactos', { cargo: 'talento', pais: 'CL' });
    assert.deepEqual(data.calls, [
      { tool: 'detail', query: '900123456' },
      { tool: 'contacts', filters: { texto: undefined, empresa: undefined, cargo: 'talento', pais: 'CL' }, limit: 15 },
    ]);
  });

  it('uso de IA es de todos los roles (con su alcance); búsquedas con sus valores por defecto', async () => {
    const data = fakeData();
    await runAssistantTool(data, null, 'busquedas', {});
    await runAssistantTool(data, null, 'uso_de_ia', { periodo: 'año', responsable: 'Ana' });
    assert.equal((data.calls[0] as { limit: number }).limit, 5);
    assert.deepEqual(data.calls[1], { tool: 'usage', period: 'mes', responsable: { responsable: 'Ana' } });
  });

  it('herramienta desconocida o error de lectura: vuelve un error, no lanza', async () => {
    const data = fakeData({ summary: async () => { throw new Error('caída'); } });
    assert.equal((await runAssistantTool(data, null, 'borrar_todo', {})).isError, true);
    const failed = await runAssistantTool(data, null, 'mi_resumen', {});
    assert.equal(failed.isError, true);
    assert.match(failed.content, /No se pudo leer: caída/);
  });

  it('🔴 usuarios, catálogos y presupuesto: sin admin responden «sin permiso» aunque Claude los pida', async () => {
    for (const name of ['usuarios', 'catalogo_de_fuentes', 'catalogo_de_industrias', 'presupuesto']) {
      const result = await runAssistantTool(fakeData(), null, name, {});
      assert.equal(result.isError, true, name);
      assert.match(result.content, /sólo la ven los administradores/);
    }
    const admin = fakeAdmin();
    for (const name of ['usuarios', 'catalogo_de_fuentes', 'catalogo_de_industrias', 'presupuesto']) {
      assert.equal((await runAssistantTool(fakeData(), admin, name, {})).isError, false, name);
    }
    assert.deepEqual(admin.calls, ['users', 'sources', 'industries', 'budget']);
  });

  it('🔴 a un no-admin ni siquiera se le ofrecen las de administración', () => {
    const commercial = toolsForRole(false).map((t) => t.name);
    assert.deepEqual(commercial, [
      'mi_resumen', 'prospectos', 'empresas', 'ficha_empresa', 'contactos', 'busquedas', 'uso_de_ia', 'ayuda_sellup',
      'proponer_aprobar', 'proponer_descartar', 'proponer_asignar', 'proponer_recordatorio', 'proponer_etapa', 'proponer_nota',
      'proponer_rumbo', 'proponer_buscar_contactos',
    ]);
    assert.deepEqual(
      toolsForRole(true).map((t) => t.name),
      [...commercial, 'proponer_acceso', 'usuarios', 'catalogo_de_fuentes', 'catalogo_de_industrias', 'presupuesto'],
    );
  });
});

// ── Memoria ──────────────────────────────────────────────────────────────────

describe('memoria de la conversación', () => {
  const now = '1000000.000100';
  const at = (secondsAgo: number) => String(1_000_000 - secondsAgo);

  it('arma los turnos alternados y termina en la pregunta actual', () => {
    const turns = buildConversationTurns(
      [
        { ts: at(120), text: 'empresas de chile por revisar hoy', fromBot: false, hasActions: false },
        { ts: at(110), text: 'Hay 3 por revisar.', fromBot: true, hasActions: false },
      ],
      'cuáles son',
      now,
    );
    assert.deepEqual(turns, [
      { role: 'user', content: 'empresas de chile por revisar hoy' },
      { role: 'assistant', content: 'Hay 3 por revisar.' },
      { role: 'user', content: 'cuáles son' },
    ]);
  });

  it('descarta avisos con botones, mensajes viejos y empieza siempre por la persona', () => {
    const turns = buildConversationTurns(
      [
        { ts: at(7 * 3600), text: 'muy viejo', fromBot: false, hasActions: false },
        { ts: at(300), text: 'Elkin activó tu acceso', fromBot: true, hasActions: true },
        { ts: at(200), text: 'respuesta suelta del bot', fromBot: true, hasActions: false },
        { ts: at(100), text: 'hola', fromBot: false, hasActions: false },
      ],
      '<@UBOT> y de México?',
      now,
    );
    assert.deepEqual(turns, [{ role: 'user', content: 'hola\n\ny de México?' }]);
  });

  it('sin historia: sólo la pregunta', () => {
    assert.deepEqual(buildConversationTurns([], 'hola', now), [{ role: 'user', content: 'hola' }]);
  });
});

// ── Enlaces y filtros ────────────────────────────────────────────────────────

describe('enlaces directos y filtros', () => {
  it('Por revisar con país, industria y texto', () => {
    assert.equal(
      pendingProspectsLink('https://app.example/', { pais: 'cl', industria: 'Retail', texto: 'Copec' }),
      'https://app.example/accounts?tab=prospectos&country=CL&industry=Retail&search=Copec',
    );
    assert.equal(searchesLink('https://app.example', 'b1'), 'https://app.example/accounts?tab=busquedas&focus=b1');
    assert.equal(accountLink('https://app.example', 'a 1'), 'https://app.example/accounts/a%201');
  });

  it('país: 2 letras = código exacto; si no, por nombre', () => {
    assert.deepEqual(countryFilter('cl'), { column: 'country_code', value: 'CL' });
    assert.deepEqual(countryFilter('Chile'), { column: 'country', value: '%Chile%' });
    assert.equal(countryFilter('  '), null);
  });

  it('responsable Y texto viajan en un solo `or` (no dos sueltos)', () => {
    assert.equal(combineOr('assigned_to.in.(u1)', 'name.ilike.%a%'), 'and(or(assigned_to.in.(u1)),or(name.ilike.%a%))');
    assert.equal(combineOr(null, 'name.ilike.%a%'), 'name.ilike.%a%');
    assert.equal(combineOr('x.eq.1', null), 'x.eq.1');
    assert.equal(combineOr(null, null), null);
  });

  it('periodo de creación: todo = sin fecha', () => {
    const now = new Date('2026-11-11T20:00:00Z');
    assert.equal(createdSince('todo', now), null);
    assert.equal(createdSince(undefined, now), null);
    assert.equal(createdSince('hoy', now), '2026-11-11T05:00:00.000Z');
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
  appUrl: 'https://sellup.example',
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

  it('con memoria: Claude recibe la conversación anterior, no sólo la pregunta', async () => {
    const script = scripted([
      { content: [{ type: 'text', text: 'Son: Copec, Enex y Arcoprime.' }], stopReason: 'end_turn', usage: USAGE, requests: 1 },
    ]);
    await answerQuestion(
      {
        ...INPUT,
        question: 'cuáles son',
        conversation: [
          { role: 'user', content: 'empresas de chile por revisar hoy' },
          { role: 'assistant', content: 'Hay 3.' },
          { role: 'user', content: 'cuáles son' },
        ],
      },
      { runConversation: script.run, data: fakeData() },
    );
    assert.equal(script.bodies[0].messages.length, 3);
    assert.equal(script.bodies[0].messages[0].content, 'empresas de chile por revisar hoy');
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

  it('el sistema dice quién pregunta, qué ve, que propone sin ejecutar y la fecha', () => {
    const prompt = buildAssistantSystemPrompt(INPUT);
    assert.match(prompt, /Carla \(Vendedor\)/);
    assert.match(prompt, /sólo sus propias empresas/);
    assert.match(prompt, /SÍ puedes PROPONER/);
    assert.match(prompt, /jamás digas que ya se hizo/);
    assert.match(prompt, /Nada de saludos, emojis/);
    assert.match(prompt, /LISTA los nombres/);
    assert.match(prompt, /conversación anterior/);
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

  it('empresas: responsable O creador, como Empresas y Contactos en la plataforma', () => {
    assert.equal(accountScopeClause(['a', 'b']), 'owner_id.in.(a,b),created_by.in.(a,b)');
  });

  it('ficha: ID de SellUp exacto; número largo también busca el ID de HubSpot', () => {
    assert.deepEqual(accountLookup('3F2504E0-4F89-11D3-9A0C-0305E82C3301'), { kind: 'id', value: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' });
    const hubspot = accountLookup('123456789');
    assert.equal(hubspot.kind, 'text');
    assert.match(hubspot.kind === 'text' ? hubspot.clause : '', /tax_identifier\.ilike\.%123456789%,hubspot_company_id\.eq\.123456789$/);
    const name = accountLookup('Copec');
    assert.doesNotMatch(name.kind === 'text' ? name.clause : '', /hubspot/);
  });

  it('el texto de búsqueda no rompe el filtro (comodines, comas, paréntesis)', () => {
    assert.equal(ilikePattern('50%_a,b(c)'), '%50\\%\\_a b c%');
  });
});

describe('permisos 12-11: Uso de IA y asignar', () => {
  it('🔴 vendedor/Growth: ni se les ofrece uso_de_ia ni se ejecuta', async () => {
    assert.ok(!toolsForRole(false, false).some((t) => t.name === 'uso_de_ia'));
    assert.ok(toolsForRole(false, true).some((t) => t.name === 'uso_de_ia'));
    const data = fakeData({ usageVisible: false });
    const out = await runAssistantTool(data, null, 'uso_de_ia', { periodo: 'mes' });
    assert.equal(out.isError, true);
    assert.equal(data.calls.length, 0);
  });

  it('🔴 un vendedor no puede proponer asignarle a otra persona', async () => {
    let proposed = false;
    const out = await runAssistantTool(fakeData(), null, 'proponer_asignar', { tipo: 'empresas', empresas: ['Copec'], persona: 'Pedro' }, {
      actor: { id: 'yo', roleKey: 'seller_bd' },
      propose: () => {
        proposed = true;
      },
      resolver: {
        resolveActiveUser: async () => ({ user: { id: 'pedro', nombre: 'Pedro Tapia' }, opciones: [] }),
      } as never,
    });
    assert.equal(proposed, false);
    assert.match(out.content, /Solo puedes asignarte a ti/);
  });
});
