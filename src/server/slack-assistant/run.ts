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
import { ASSISTANT_TOOLS, runAssistantTool, type AssistantDataSource } from './tools';

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
  asker: AssistantAsker;
  model: string;
  apiKey: string;
  /** Fecha de hoy (AAAA-MM-DD), para que «hoy» y «este mes» tengan sentido. */
  today: string;
  loginUrl: string;
}

export interface AnswerQuestionDeps {
  runConversation: (body: AnthropicRequestBody, apiKey: string) => Promise<AnthropicConversationResult>;
  data: AssistantDataSource;
}

export interface AnswerQuestionResult {
  answer: string;
  usage: AnthropicUsageTotals;
  requests: number;
  toolCalls: string[];
  status: 'success' | 'error';
  errorCode: string | null;
}

export function buildAssistantSystemPrompt(input: Pick<AnswerQuestionInput, 'asker' | 'today' | 'loginUrl'>): string {
  const who = input.asker.name ? `${input.asker.name} (${input.asker.roleLabel})` : input.asker.roleLabel;
  return [
    'Eres el asistente de SellUp, la plataforma de prospección comercial de UBITS, y respondes por Slack.',
    `Hoy es ${input.today}. Te escribe ${who}. Con sus permisos ve ${input.asker.scopeLabel}.`,
    '',
    'Cómo responder:',
    '- En español, claro y corto: primero la respuesta, después el detalle que haga falta.',
    '- Para datos de SellUp usa SIEMPRE las herramientas. Nunca inventes cifras, nombres ni contactos.',
    '- Si una herramienta no trae nada, dilo así («no encontré…») y sugiere cómo buscar de otra forma.',
    '- Sólo puedes CONSULTAR. Si te piden crear, cambiar, aprobar, descartar, asignar o buscar empresas nuevas, explica que eso se hace en SellUp y comparte el enlace ' + input.loginUrl + '.',
    '- Si preguntan por algo fuera de sus permisos, explica que sólo ves lo que su rol puede ver.',
    '- Preguntas generales (cómo usar SellUp, ideas de prospección) puedes contestarlas sin herramientas, breve.',
    '- Formato de Slack: *negrita* con un asterisco, listas con «•», sin tablas ni títulos con #. Máximo ~15 líneas.',
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
  let messages: AnthropicRequestBody['messages'] = [{ role: 'user', content: input.question }];
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
          tools: [...ASSISTANT_TOOLS],
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
        const output = await runAssistantTool(deps.data, name, block.input);
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
