// ============================================================
// Asistente de Slack — atender una pregunta de punta a punta (dueña 11-11).
// 1) quién escribe (correo de Slack → persona activa de SellUp),
// 2) qué puede ver (alcance comercial por rol),
// 3) Claude responde con herramientas de sólo lectura,
// 4) la respuesta vuelve a Slack y la consulta queda en Uso de IA.
// Mención en un canal (dueña 13-11): la respuesta y los botones van por mensaje
// directo a quien preguntó; en el hilo del canal sólo una nota neutra.
// Nunca lanza: cualquier falla se le explica a la persona en Slack.
// ============================================================

import { randomUUID } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveCommercialScopeForUser } from '@/modules/access/commercial-scope-core.server';
import { roleLabelFor } from '@/modules/access/role-labels';
import { sellupLoginUrl } from '@/modules/access/slack-invitation.server';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import {
  getSlackConversationHistory,
  getSlackUserEmail,
  openSlackDirectChannel,
  postSlackMessage,
} from '@/server/services/slack-connection';
import { runAnthropicConversation } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { estimateClassifierCost } from '@/server/agents/prospecting-toolkit/claude-classifier/cost';
import { createAssistantDataSource } from './data-source.server';
import { createAssistantAdminDataSource } from './admin-data-source.server';
import { canSeeMoney } from '@/modules/ai-usage/money-visibility';
import { answerQuestion } from './run';
import { buildConversationTurns, HISTORY_MAX_MESSAGES } from './conversation';
import { scopeLabelFor, SLACK_ASSISTANT_COPY } from './copy';
import { createAssistantActionResolver } from './action-resolver.server';
import { lookupHelp } from './help/lookup';
import { HELP_TOPICS } from './help/topics';
import { ACTION_TTL_SECONDS, proposalBlocks } from './action-proposal';
import type { ProposedAction } from './tools';
import { findInternalUserBySlackEmail } from './asker-lookup.server';
import { planSlackDelivery } from './delivery';
import { createTeamScopeResolver } from './team-scope.server';

export const SLACK_ASSISTANT_AGENT_KEY = 'slack_assistant';
export const SLACK_ASSISTANT_STEP = 'responder_pregunta';
export const SLACK_ASSISTANT_OPERATION = 'slack_question';
/** Tope de una respuesta completa (varias vueltas de herramientas incluidas). */
const ANSWER_DEADLINE_MS = 50_000;

export interface SlackQuestion {
  slackUserId: string;
  channel: string;
  threadTs: string | null;
  messageTs: string;
  text: string;
  source: 'direct_message' | 'mention';
  eventId: string | null;
  /** App de Slack del evento (para no tomar como propios mensajes de otros bots). */
  apiAppId?: string | null;
}

interface AskerRow {
  id: string;
  email: string | null;
  full_name: string | null;
  group_id: string | null;
  auth_user_id: string | null;
  access_status: string;
  roles: { key: string } | null;
}

function bogotaToday(now: Date): string {
  return new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export async function handleSlackQuestion(question: SlackQuestion): Promise<void> {
  // Mención en un canal: todo lo que dice SellUp va por mensaje directo.
  const directChannel =
    question.source === 'mention' ? await openSlackDirectChannel(question.slackUserId).catch(() => null) : null;
  const plan = planSlackDelivery(question, directChannel, {
    answered: SLACK_ASSISTANT_COPY.answeredByDirectMessage,
    failed: SLACK_ASSISTANT_COPY.directMessageFailed,
  });
  const answerTo = plan.answer;
  let noteSent = false;
  const sendThreadNote = async () => {
    if (!plan.threadNote || noteSent) return;
    noteSent = true;
    await postSlackMessage({ channel: plan.threadNote.channel, threadTs: plan.threadNote.threadTs, text: plan.threadNote.text });
  };
  if (!answerTo) {
    await sendThreadNote();
    return;
  }
  const reply = async (text: string) => {
    await postSlackMessage({ channel: answerTo.channel, text, threadTs: answerTo.threadTs });
    await sendThreadNote();
  };

  try {
    const email = await getSlackUserEmail(question.slackUserId);
    if (!email) {
      await reply(SLACK_ASSISTANT_COPY.unknownSlackUser);
      return;
    }

    const admin = createSupabaseAdminClient();
    const asker = await findInternalUserBySlackEmail<AskerRow>(
      admin,
      email,
      'id, email, full_name, group_id, auth_user_id, access_status, roles(key)',
    );
    if (!asker) {
      await reply(SLACK_ASSISTANT_COPY.notInSellUp);
      return;
    }
    if (asker.access_status !== 'active') {
      await reply(SLACK_ASSISTANT_COPY.inactive);
      return;
    }

    const roleKey = asker.roles?.key ?? null;
    const scope = await resolveCommercialScopeForUser(admin, {
      id: asker.id,
      email: asker.email,
      groupId: asker.group_id,
      roleKey,
    });

    const active = await resolveActiveAnthropicModel();
    if ('error' in active) {
      console.error('[slack-assistant] modelo', active.error);
      await reply(SLACK_ASSISTANT_COPY.noModel);
      return;
    }

    // Memoria: lo que se venía hablando en el hilo o en la conversación directa.
    const history = await getSlackConversationHistory({
      channel: question.channel,
      threadTs: question.threadTs,
      beforeTs: question.messageTs,
      limit: HISTORY_MAX_MESSAGES + 4,
    });
    // Sólo lo que dijo quien pregunta y lo que respondió el asistente: en un hilo de
    // canal, lo que escribieron otras personas no es su conversación.
    const conversation = buildConversationTurns(history, question.text, question.messageTs, {
      askerSlackId: question.slackUserId,
      ownAppId: question.apiAppId ?? null,
    });
    // Sin `auth_user_id` (nunca entró a SellUp) no hay sesión con qué confirmar: no se le proponen acciones.
    const canAct = Boolean(asker.auth_user_id);
    const appUrl = sellupLoginUrl().replace(/\/login$/, '');

    let proposed: ProposedAction | null = null;
    const startedAt = Date.now();
    const deadlineAtMs = startedAt + ANSWER_DEADLINE_MS;
    const now = new Date();
    const result = await answerQuestion(
      {
        question: question.text,
        conversation,
        asker: { name: asker.full_name, roleLabel: roleLabelFor(roleKey), scopeLabel: scopeLabelFor(scope) },
        model: active.model,
        apiKey: active.apiKey,
        today: bogotaToday(now),
        appUrl,
        actionsUnavailableNote: canAct ? null : SLACK_ASSISTANT_COPY.mustSignInFirst,
      },
      {
        runConversation: (body, apiKey) => runAnthropicConversation({ apiKey, body, deadlineAtMs, timeoutMs: 40_000 }),
        data: {
          ...createAssistantDataSource(admin, scope, {
            appUrl,
            now,
            askerId: asker.id,
            moneyVisible: canSeeMoney({ viewAll: scope.canViewAll, roleKey }),
            // «mi equipo» (admin) y «el equipo de Carla»: grupo ∪ reportes, como la plataforma.
            resolveTeam: createTeamScopeResolver(admin),
          }),
          // Guía de uso: fichas escritas desde el código, filtradas por el rol.
          help: (query) => lookupHelp(HELP_TOPICS, query, { roleKey, isAdmin: scope.canViewAll, appUrl, env: process.env }),
        },
        // Aprobar, descartar y asignar: sólo se PROPONEN; la persona confirma con un botón.
        actions: canAct
          ? {
              resolver: createAssistantActionResolver(admin, scope),
              isAdmin: scope.canViewAll,
              actor: { id: asker.id, roleKey },
              propose: (proposal) => {
                proposed = proposal;
              },
            }
          : null,
        // Usuarios, catálogos y presupuesto: sólo un administrador (como en la plataforma).
        adminData: scope.canViewAll ? createAssistantAdminDataSource(admin, { appUrl, now }) : null,
      },
    );

    await reply(result.answer);
    // La propuesta va aparte, con sus botones (vale sólo para quien preguntó, 30 min),
    // en el mismo lugar que la respuesta (por mensaje directo si fue una mención).
    const proposal = proposed as ProposedAction | null;
    if (proposal && canAct && result.status === 'success') {
      const message = proposalBlocks({
        ...proposal,
        askerId: asker.id,
        askerSlackId: question.slackUserId,
        expiresAt: Math.floor(Date.now() / 1000) + ACTION_TTL_SECONDS,
        nonce: randomUUID(),
      });
      await postSlackMessage({ channel: answerTo.channel, threadTs: answerTo.threadTs, text: message.text, blocks: message.blocks });
    }

    if (result.requests > 0 || result.errorCode) {
      const cost = estimateClassifierCost(result.usage, active.model);
      await logProviderUsage({
        provider_key: 'anthropic',
        operation_key: SLACK_ASSISTANT_OPERATION,
        agent_key: SLACK_ASSISTANT_AGENT_KEY,
        agent_step: SLACK_ASSISTANT_STEP,
        model: active.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        estimated_cost_usd: cost.usd,
        results_returned: result.toolCalls.length,
        status: result.status,
        ...(result.errorCode ? { error_code: result.errorCode } : {}),
        duration_ms: Date.now() - startedAt,
        triggered_by: asker.id,
        metadata: {
          flow: 'slack_assistant',
          source: question.source,
          slack_event_id: question.eventId,
          tool_calls: result.toolCalls,
          history_turns: conversation.length - 1,
          proposed_action: (proposed as ProposedAction | null)?.kind ?? null,
          requests: result.requests,
          pricing_source: cost.pricingSource,
          cache_read_input_tokens: result.usage.cacheReadInputTokens,
          cache_creation_input_tokens: result.usage.cacheCreationInputTokens,
        },
      });
    }
  } catch (error) {
    console.error('[slack-assistant]', error instanceof Error ? error.message : 'error');
    await reply(SLACK_ASSISTANT_COPY.unexpected);
  }
}
