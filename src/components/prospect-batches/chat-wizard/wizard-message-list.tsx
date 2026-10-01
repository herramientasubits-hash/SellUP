'use client';

import * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChatAgentMessage, ChatThinking, ChatThread, ChatUserMessage, type ChatMessage } from '@/components/chat';
import type {
  DerivedWizardMessage,
  EditableWizardStep,
} from '@/modules/prospect-batches/chat-wizard';

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardMessageListProps = {
  messages: DerivedWizardMessage[];
  visibleCount?: number;
  isTyping?: boolean;
  currentStep: string;
  onEditStep: (step: EditableWizardStep) => void;
};

const EDITABLE_STEPS = new Set<string>([
  'search_type',
  'country',
  'industry',
  'subindustries',
  'additional_criteria',
  'requested_count',
]);

// Q3F-5BB.3F — Once the conversation reaches the review/final phase, the inline
// per-message "Editar" links clutter the transcript. Editing is offered instead
// by the summary rows and the single "Editar búsqueda" action in the final
// panel, so we suppress the inline links across all review-phase steps.
const REVIEW_PHASE_STEPS = new Set<string>([
  'summary',
  'validating',
  'validated',
  'submitting',
  'success',
  'blocked',
  'error',
]);

/**
 * El mensaje derivado del asistente, en la forma que pide el hilo de Thema.
 * `createdAt` va en 0 a propósito: los mensajes se derivan del estado en cada
 * render y no tienen hora propia; nada del hilo la enseña.
 */
function toChatMessage(message: DerivedWizardMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role === 'user' ? 'user' : 'agent',
    text: message.content,
    createdAt: 0,
    status: 'done',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * El hilo del asistente, con las piezas de chat de Thema: las respuestas del
 * agente van sin burbuja y con la marca (`ChatAgentMessage`), lo que eligió la
 * persona va en su burbuja a la derecha con copiar y editar (`ChatUserMessage`),
 * los avisos son `Alert` y «escribiendo» es `ChatThinking`.
 */
export function WizardMessageList({
  messages,
  visibleCount,
  isTyping = false,
  currentStep,
  onEditStep,
}: WizardMessageListProps) {
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
        const msg = byId.get(chatMessage.id);
        if (!msg) return null;
        if (msg.role === 'assistant') {
          // Ninguna respuesta del asistente es «la última» para las acciones: son
          // preguntas del flujo, y copiar se ofrece al pasar o al enfocar.
          return <ChatAgentMessage message={chatMessage} isLast={false} />;
        }
        if (msg.role === 'user') {
          const canEdit =
            EDITABLE_STEPS.has(msg.step) &&
            msg.step !== currentStep &&
            !REVIEW_PHASE_STEPS.has(currentStep);
          return (
            <ChatUserMessage
              message={chatMessage}
              onEditRequest={canEdit ? () => onEditStep(msg.step as EditableWizardStep) : undefined}
              editLabel={`Editar respuesta: ${msg.content}`}
            />
          );
        }
        if (msg.messageType === 'warning') {
          return (
            <Alert variant="warning" role="status">
              <AlertDescription className="min-w-0 break-words text-xs">{msg.content}</AlertDescription>
            </Alert>
          );
        }
        return (
          <Alert variant="destructive">
            <AlertDescription className="min-w-0 break-words text-xs">{msg.content}</AlertDescription>
          </Alert>
        );
      }}
    >
      {/* El agente está escribiendo el siguiente mensaje. */}
      {isTyping && effectiveVisible < messages.length && <ChatThinking label="Escribiendo…" />}
    </ChatThread>
  );
}
