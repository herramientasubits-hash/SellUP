// ============================================================
// Asistente de Slack — conversación con Claude (puro, dependencias inyectadas).
// Claude recibe la pregunta, pide las herramientas que necesita (sólo
// lectura, ya filtradas por el alcance de quien pregunta) y responde en
// español con formato de Slack.
// ============================================================

import {
  AnthropicApiError,
  EMPTY_USAGE,
  type AnthropicContentBlock,
  type AnthropicConversationResult,
  type AnthropicRequestBody,
  type AnthropicUsageTotals,
} from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { providerFailureNotice } from '@/modules/usage-tracking/provider-failure';
import {
  runAssistantTool,
  toolsForRole,
  type AssistantActionContext,
  type AssistantAdminDataSource,
  type AssistantDataSource,
} from './tools';
import type { ConversationTurn } from './conversation';

/** Vueltas de herramientas como máximo antes de pedir la respuesta final. */
export const MAX_TOOL_ROUNDS = 5;
export const ASSISTANT_MAX_TOKENS = 1200;

export interface AssistantAsker {
  name: string | null;
  /** «Administrador», «Líder comercial», «Vendedor»… */
  roleLabel: string;
  /** Qué ve: «toda la plataforma», «tu equipo», «tus empresas». */
  scopeLabel: string;
}

export interface AnswerQuestionInput {
  question: string;
  /**
   * La conversación hasta aquí, terminando en la pregunta actual (ver
   * `buildConversationTurns`). Sin ella, sólo la pregunta.
   */
  conversation?: readonly ConversationTurn[];
  asker: AssistantAsker;
  model: string;
  apiKey: string;
  /** Fecha de hoy (AAAA-MM-DD), para que «hoy» y «este mes» tengan sentido. */
  today: string;
  /** Página principal de SellUp (para remitir lo que no se hace por Slack). */
  appUrl: string;
}

export interface AnswerQuestionDeps {
  runConversation: (body: AnthropicRequestBody, apiKey: string) => Promise<AnthropicConversationResult>;
  data: AssistantDataSource;
  /** Sólo para administradores; `null` = no se le ofrecen ni se ejecutan esas herramientas. */
  adminData?: AssistantAdminDataSource | null;
  /** Acciones con confirmación (proponer aprobar/descartar/asignar). */
  actions?: AssistantActionContext | null;
}

export interface AnswerQuestionResult {
  answer: string;
  usage: AnthropicUsageTotals;
  requests: number;
  toolCalls: string[];
  status: 'success' | 'error';
  errorCode: string | null;
}

export function buildAssistantSystemPrompt(input: Pick<AnswerQuestionInput, 'asker' | 'today' | 'appUrl'>): string {
  const who = input.asker.name ? `${input.asker.name} (${input.asker.roleLabel})` : input.asker.roleLabel;
  return [
    'Eres el asistente de SellUp, la plataforma de prospección comercial de UBITS, y respondes por Slack.',
    `Hoy es ${input.today} (hora de Bogotá). Te escribe ${who}. Con sus permisos ve ${input.asker.scopeLabel}.`,
    '',
    'Vocabulario de SellUp:',
    '- «Por revisar» / prospectos / candidatas: empresas que encontró una búsqueda y esperan que alguien las apruebe o descarte → herramienta prospectos_por_revisar.',
    '- «Empresas»: las ya aprobadas, con responsable y contactos → herramienta empresas.',
    '- «Búsquedas»: los lotes de prospección que las encontraron → herramienta busquedas.',
    '- Una empresa en concreto (por nombre, NIT, dominio o ID) → ficha_empresa, aunque todavía esté por revisar o sea el nombre de un contacto (la ficha también busca ahí). Personas → contactos.',
    '- Todo lo que respondes sale de SellUp: nunca digas que consultas HubSpot ni ofrezcas buscar allá; un ID de HubSpot sólo sirve para encontrar la empresa en SellUp.',
    '',
    'De quién son los datos (siempre dentro de lo que su rol puede ver):',
    '- «mío», «mis», «tengo», «mi resumen», «lo mío» → de=mio (sólo quien pregunta).',
    '- «mi equipo», «mis vendedores», «mi gente» → de=mi_equipo (quien pregunta y su gente a cargo, en cascada).',
    '- «de Carla», «lo de Luis» → responsable con ese nombre (sirve nombre parcial o correo); «el equipo de Carla» → responsable + equipo=true.',
    '- «general», «de todos», «toda la operación», o si no dice de quién → de=todo.',
    '- Di en una línea de quién son los datos (campo `alcance`) y, si fue sólo lo suyo y tiene equipo, ofrece «¿quieres el de tu equipo?».',
    '- Descartadas, aprobadas o duplicadas → prospectos con ese estado.',
    '- «Uso de IA», consumo, costos → uso_de_ia (admin ve todo; líder su equipo en cascada; vendedor lo suyo; sólo admin y líderes ven dólares).',
    '- Usuarios, catálogo de fuentes, catálogo de industrias y presupuesto son sólo para administradores: si no tienes esas herramientas, explica que esa información la ve un administrador en SellUp.',
    '',
    'Cómo responder:',
    '- Ve directo a la respuesta. Nada de saludos, emojis ni frases de relleno.',
    '- Usa la conversación anterior para entender preguntas cortas («¿cuáles son?», «¿y de México?»): retoma los filtros que se venían usando.',
    '- Si piden «cuáles», LISTA los nombres. Nunca respondas sólo con totales si hay una herramienta que da el listado.',
    '- Ante una pregunta ambigua, elige la lectura más probable, respóndela y di en una línea qué supusiste. Sólo pregunta si de verdad no se puede responder.',
    '- Para datos de SellUp usa SIEMPRE las herramientas, con los filtros que correspondan (país en código ISO de 2 letras: Chile = CL). Nunca inventes cifras, nombres ni contactos.',
    '- Si el resultado trae más de lo que muestras, di cuántos hay en total y comparte el `enlace` que trae la herramienta para ver el resto filtrado en SellUp.',
    '- Si no hay resultados, dilo en una línea y sugiere ampliar el filtro (otro periodo, otro país).',
    '- Acciones: SÍ puedes PROPONER (herramientas proponer_*): aprobar o descartar prospectos, asignar prospectos o empresas, mover empresas de etapa o dejarles una nota, mandarle un recordatorio a alguien de tu equipo, que Rumbo prepare el primer contacto de una empresa, buscar contactos de empresas y (sólo administradores) activar o desactivar accesos. Nunca se ejecutan solas: queda un botón «Confirmar» que la persona pulsa. Di qué quedará hecho al confirmar y si gasta créditos; jamás digas que ya se hizo.',
    '- Para descartar hace falta un motivo: si no lo dijeron, pregúntalo antes de proponer. Una propuesta por respuesta.',
    '- Lanzar búsquedas de empresas nuevas y pedir teléfonos todavía no se hacen por Slack: explica cómo hacerlo en SellUp (usa ayuda_sellup) y comparte el enlace (o ' + input.appUrl + ').',
    '- Si preguntan por algo fuera de sus permisos, explica que sólo ves lo que su rol puede ver.',
    '- Preguntas de «cómo se hace» en SellUp (importar, buscar, Rumbo, contactos, aprobar, presupuesto…): usa SIEMPRE ayuda_sellup y responde sólo con lo que traiga, con sus pasos y nombres tal cual, y su enlace. Si la guía no lo cubre, dilo; nunca inventes pasos, botones ni pantallas.',
    '- Ideas generales de prospección (sin pasos de la plataforma) puedes darlas breves, aclarando que son sugerencias.',
    '- Formato de Slack: *negrita* con un asterisco, listas con «•», enlaces como <url|texto>. Sin tablas ni títulos con #. Listas de hasta ~20 líneas.',
    '- Dinero en dólares con 2 decimales (US$1,25). Fechas como «11 nov».',
  ].join('\n');
}

function textOf(blocks: readonly AnthropicContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b.text as string).trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function addUsage(a: AnthropicUsageTotals, b: AnthropicUsageTotals): AnthropicUsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    webFetchRequests: a.webFetchRequests + b.webFetchRequests,
  };
}

export const ASSISTANT_GENERIC_ERROR =
  'No pude responder en este momento. Vuelve a intentarlo en unos minutos; si sigue pasando, avísale a un administrador de SellUp.';

/** Responde una pregunta. Nunca lanza: si Claude falla, la respuesta dice por qué. */
export async function answerQuestion(input: AnswerQuestionInput, deps: AnswerQuestionDeps): Promise<AnswerQuestionResult> {
  const system = buildAssistantSystemPrompt(input);
  let messages: AnthropicRequestBody['messages'] =
    input.conversation && input.conversation.length > 0
      ? input.conversation.map((turn) => ({ role: turn.role, content: turn.content }))
      : [{ role: 'user', content: input.question }];
  let usage = EMPTY_USAGE;
  let requests = 0;
  const toolCalls: string[] = [];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await deps.runConversation(
        {
          model: input.model,
          max_tokens: ASSISTANT_MAX_TOKENS,
          system,
          tools: [...toolsForRole(Boolean(deps.adminData))],
          messages,
        },
        input.apiKey,
      );
      usage = addUsage(usage, result.usage);
      requests += result.requests;

      const toolUses = result.content.filter((b) => b.type === 'tool_use');
      if (result.stopReason !== 'tool_use' || toolUses.length === 0) {
        const answer = textOf(result.content);
        return {
          answer: answer || ASSISTANT_GENERIC_ERROR,
          usage,
          requests,
          toolCalls,
          status: answer ? 'success' : 'error',
          errorCode: answer ? null : 'empty_answer',
        };
      }

      const toolResults = [];
      for (const block of toolUses) {
        const name = String(block.name ?? '');
        toolCalls.push(name);
        const output = await runAssistantTool(deps.data, deps.adminData ?? null, name, block.input, deps.actions ?? null);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: output.content, is_error: output.isError });
      }
      messages = [...messages, { role: 'assistant', content: result.content }, { role: 'user', content: toolResults }];
    }
    return { answer: ASSISTANT_GENERIC_ERROR, usage, requests, toolCalls, status: 'error', errorCode: 'too_many_rounds' };
  } catch (error) {
    const code = error instanceof AnthropicApiError ? error.code : 'unexpected_error';
    const partial = error instanceof AnthropicApiError ? addUsage(usage, error.partialUsage) : usage;
    const notice = providerFailureNotice([code]);
    return {
      answer: notice ? `No pude responder. ${notice}` : ASSISTANT_GENERIC_ERROR,
      usage: partial,
      requests,
      toolCalls,
      status: 'error',
      errorCode: code,
    };
  }
}
