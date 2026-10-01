'use client';

import * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChatAgentMessage, ChatThinking, ChatThread, ChatUserMessage, type ChatMessage } from '@/components/chat';
import type { AgentChatMessage } from './agent-chat-types';

// ── Conversation timeline ─────────────────────────────────────────────────────
// El hilo de un asistente conversacional, pintado con las piezas de chat de
// Thema: las respuestas del agente van sin burbuja y con la marca
// (`ChatAgentMessage`), lo que escribió la persona va en su burbuja a la derecha
// (`ChatUserMessage`), los avisos son `Alert` y la espera es `ChatThinking` (la
// marca que gira, el rótulo con brillo y los segundos que lleva).
//
// Este archivo solo traduce el contrato neutro `AgentChatMessage` al del hilo.

interface AgentChatTimelineProps {
  messages: AgentChatMessage[];
  /** How many messages are currently revealed. Defaults to all. */
  visibleCount?: number;
  /** Show the typing indicator at the bottom (reveal in progress or loading). */
  isTyping?: boolean;
  /** Label shown next to the typing indicator. */
  typingLabel?: string;
}

function toChatMessage(message: AgentChatMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role === 'user' ? 'user' : 'agent',
    text: message.content,
    // Los mensajes se derivan del estado y no tienen hora propia; el hilo no la enseña.
    createdAt: 0,
    status: 'done',
  };
}

export function AgentChatTimeline({
  messages,
  visibleCount,
  isTyping = false,
  typingLabel = 'Escribiendo…',
}: AgentChatTimelineProps) {
  const effectiveVisible = visibleCount ?? messages.length;
  const visibleMessages = messages.slice(0, effectiveVisible);
  const byId = React.useMemo(() => new Map(visibleMessages.map((msg) => [msg.id, msg])), [visibleMessages]);
  const chatMessages = React.useMemo(() => visibleMessages.map(toChatMessage), [visibleMessages]);

  return (
    <ChatThread
      messages={chatMessages}
      aria-label="Historial de la conversación"
      className="gap-4"
      renderMessage={(chatMessage) => {
        const message = byId.get(chatMessage.id);
        if (!message) return null;
        if (message.role === 'assistant') {
          return <ChatAgentMessage message={chatMessage} isLast={false} />;
        }
        if (message.role === 'user') {
          return <ChatUserMessage message={chatMessage} />;
        }
        if (message.tone === 'warning') {
          return (
            <Alert variant="warning" role="status">
              <AlertDescription className="min-w-0 break-words text-xs">{message.content}</AlertDescription>
            </Alert>
          );
        }
        if (message.tone === 'error') {
          return (
            <Alert variant="destructive">
              <AlertDescription className="min-w-0 break-words text-xs">{message.content}</AlertDescription>
            </Alert>
          );
        }
        return (
          <Alert role="note">
            <AlertDescription className="min-w-0 break-words text-xs">{message.content}</AlertDescription>
          </Alert>
        );
      }}
    >
      {isTyping && <ChatThinking label={typingLabel} />}
    </ChatThread>
  );
}
