'use client';

import * as React from 'react';
import { AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { AgentChatOrb } from './agent-chat-orb';
import type { AgentChatMessage } from './agent-chat-types';

// ── Conversation timeline ─────────────────────────────────────────────────────
// Renders the message history (assistant / user / system bubbles) plus a typing
// indicator. Visual language matches the Agente 1 conversation, kept neutral so
// any conversational agent wizard can reuse it.

interface AgentChatTimelineProps {
  messages: AgentChatMessage[];
  /** How many messages are currently revealed. Defaults to all. */
  visibleCount?: number;
  /** Show the typing indicator at the bottom (reveal in progress or loading). */
  isTyping?: boolean;
  /** Label shown next to the typing indicator. */
  typingLabel?: string;
}

export function AgentChatTimeline({
  messages,
  visibleCount,
  isTyping = false,
  typingLabel = 'escribiendo',
}: AgentChatTimelineProps) {
  const effectiveVisible = visibleCount ?? messages.length;
  const visibleMessages = messages.slice(0, effectiveVisible);

  return (
    <div
      role="log"
      aria-label="Historial de la conversación"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      className="space-y-3"
    >
      {visibleMessages.map((message) => {
        if (message.role === 'assistant') {
          return <AssistantMessage key={message.id} message={message} />;
        }
        if (message.role === 'user') {
          return <UserMessage key={message.id} message={message} />;
        }
        if (message.tone === 'warning') {
          return <WarningMessage key={message.id} message={message} />;
        }
        if (message.tone === 'error') {
          return <ErrorMessage key={message.id} message={message} />;
        }
        return <SystemMessage key={message.id} message={message} />;
      })}

      {isTyping && (
        <div className="flex items-start gap-2.5 animate-su-fade-in">
          <AgentChatOrb size="sm" className="mt-0.5" />
          <div className="flex items-center gap-1.5 rounded-xl rounded-tl-sm bg-surface-subtle px-4 py-3">
            <Loader2 className="h-3 w-3 animate-spin text-primary" aria-hidden />
            <span className="text-sm text-muted-foreground animate-pulse">
              {typingLabel}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message bubbles ───────────────────────────────────────────────────────────

function AssistantMessage({ message }: { message: AgentChatMessage }) {
  return (
    <div className="flex items-start gap-2.5 animate-su-fade-in">
      <AgentChatOrb size="sm" className="mt-0.5" />
      <div className="max-w-[85%] min-w-0 whitespace-pre-line break-words rounded-xl rounded-tl-sm bg-surface-muted px-4 py-2.5 text-sm text-foreground">
        {message.content}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: AgentChatMessage }) {
  return (
    <div className="flex items-end justify-end animate-su-fade-in">
      <div className="max-w-[80%] min-w-0 whitespace-pre-line break-words rounded-xl rounded-tr-sm bg-primary/10 px-4 py-2.5 text-sm text-foreground">
        {message.content}
      </div>
    </div>
  );
}

function SystemMessage({ message }: { message: AgentChatMessage }) {
  return (
    <div className="rounded-lg bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
      {message.content}
    </div>
  );
}

function WarningMessage({ message }: { message: AgentChatMessage }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/15 px-3 py-2.5 text-xs text-warning"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{message.content}</span>
    </div>
  );
}

function ErrorMessage({ message }: { message: AgentChatMessage }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
    >
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{message.content}</span>
    </div>
  );
}
