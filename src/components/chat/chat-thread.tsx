"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { ChatAgentMessage, type ChatAgentMessageProps } from "./chat-agent-message";
import type { ChatFeedbackPayload } from "./chat-feedback-form";
import { ChatUserMessage } from "./chat-user-message";
import { t } from "./messages";
import type { ChatMessage } from "./types";

/** A menos de esto del final, se considera que se está mirando el final. */
const STICKY_PX = 120;

function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Lo que el hilo puede hacer con un mensaje. Thema lo saca de su almacén de
 * conversaciones; SellUp no tiene uno, así que quien monta el hilo pasa solo lo
 * que de verdad sabe hacer, y lo que falte no se pinta.
 */
export interface ChatThreadActions {
  edit?: (messageId: string, text: string) => void;
  stop?: (messageId: string, shownText: string) => void;
  finish?: (messageId: string) => void;
  feedback?: (messageId: string, value: "up" | "down" | undefined, detail?: ChatFeedbackPayload) => void;
  regenerate?: () => void;
  send?: (text: string) => void;
  answer?: (messageId: string, option: string) => void;
}

export interface ChatThreadProps {
  messages: readonly ChatMessage[];
  actions?: ChatThreadActions;
  onNavigate?: (href: string) => void;
  /** El «Más» de cada respuesta; sin esto no sale el menú. */
  onMore?: (messageId: string, action: "share" | "task" | "report") => void;
  /** Para pintar un mensaje de otra forma (un aviso, un paso con su control). Devolver `undefined` deja el de siempre. */
  renderMessage?: (message: ChatMessage, defaults: { isLast: boolean }) => React.ReactNode | undefined;
  /** Lo que va al final del hilo, dentro del mismo registro (el paso activo, «pensando»). */
  children?: React.ReactNode;
  /** Nombre accesible del registro. Por defecto «Agente IA». */
  "aria-label"?: string;
  className?: string;
}

/**
 * El hilo de una conversación (Thema · `ChatThread`): las preguntas a la
 * derecha, las respuestas con el destello a la izquierda, y el final siempre a
 * la vista mientras el agente escribe.
 */
export function ChatThread({
  messages,
  actions = {},
  onNavigate,
  onMore,
  renderMessage,
  children,
  className,
  ...props
}: ChatThreadProps) {
  const endRef = React.useRef<HTMLDivElement>(null);
  const logRef = React.useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;

  const scrollToEnd = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    endRef.current?.scrollIntoView?.({ behavior, block: "end" });
  }, []);

  // Un mensaje nuevo lleva el hilo al final.
  React.useEffect(() => {
    scrollToEnd();
  }, [messages.length, scrollToEnd]);

  // Lo que aparece al terminar (una tarjeta, una pregunta, las sugerencias)
  // también hace crecer el hilo: si se estaba mirando el final, se sigue
  // mirando; si la persona subió a releer, no se le mueve.
  React.useEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const scroller = scrollParent(log);
      if (!scroller) return;
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distance < STICKY_PX) scrollToEnd("auto");
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, [scrollToEnd]);

  return (
    <div
      ref={logRef}
      role="log"
      aria-label={props["aria-label"] ?? t("chat.title")}
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      className={cn("flex flex-col gap-6", className)}
      data-testid="chat-thread"
    >
      {messages.map((message, index) => {
        const isLast = message.id === lastId;
        const custom = renderMessage?.(message, { isLast });
        if (custom !== undefined) return <React.Fragment key={message.id}>{custom}</React.Fragment>;
        if (message.role === "user") {
          const { edit } = actions;
          return (
            <ChatUserMessage
              key={message.id}
              message={message}
              onEdit={edit ? (text) => edit(message.id, text) : undefined}
            />
          );
        }
        const { stop, finish, feedback, answer } = actions;
        const agentProps: ChatAgentMessageProps = {
          message,
          isLast,
          onStop: stop ? (shown) => stop(message.id, shown) : undefined,
          onFinish: finish ? () => finish(message.id) : undefined,
          onProgress: () => scrollToEnd("auto"),
          onFeedback: feedback ? (value, detail) => feedback(message.id, value, detail) : undefined,
          onRegenerate: index === messages.length - 1 ? actions.regenerate : undefined,
          onFollowup: actions.send,
          onAnswer: answer ? (option) => answer(message.id, option) : undefined,
          onNavigate,
          onMore: onMore ? (action) => onMore(message.id, action) : undefined,
        };
        return <ChatAgentMessage key={message.id} {...agentProps} />;
      })}
      {children}
      <div ref={endRef} aria-hidden className="h-px shrink-0" />
    </div>
  );
}
