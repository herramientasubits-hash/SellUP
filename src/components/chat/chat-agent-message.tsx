"use client";

import * as React from "react";

import { ArrowRight, Check, Copy, File as FileIcon, MoreHorizontal, RefreshCw, Sparkles, Square, ThumbsDown, ThumbsUp } from "@/icons";
import type { LucideIcon } from "@/icons";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ai/chip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Text } from "@/components/typography";

import { ChatCardView } from "./chat-card-view";
import { ChatFeedbackForm, type ChatFeedbackPayload } from "./chat-feedback-form";
import { ChatMark } from "./chat-mark";
import { ChatMarkdown } from "./chat-markdown";
import { ChatQuestionCard } from "./chat-question-card";
import { ChatThinking } from "./chat-thinking";
import { t } from "./messages";
import type { ChatMessage } from "./types";
import { useStreamedText } from "./use-streamed-text";

export interface ChatAgentMessageProps {
  message: ChatMessage;
  /** La última respuesta: acciones siempre a la vista, sugerencias y pregunta activas. */
  isLast: boolean;
  /** Detener la respuesta mientras se escribe. Sin esto no hay botón «Detener». */
  onStop?: (shownText: string) => void;
  onFinish?: () => void;
  onProgress?: () => void;
  /** «Útil» / «No útil». Sin esto no se pintan: SellUp no guarda esa opinión todavía. */
  onFeedback?: (value: "up" | "down" | undefined, detail?: ChatFeedbackPayload) => void;
  /** «Regenerar» y el «Reintentar» del error. Sin esto no hay botón. */
  onRegenerate?: () => void;
  onFollowup?: (text: string) => void;
  onAnswer?: (option: string) => void;
  onNavigate?: (href: string) => void;
  /** «Más»: compartir, crear tarea, reportar. Sin esto no hay menú. */
  onMore?: (action: "share" | "task" | "report") => void;
  /** Rótulo del estado «pensando» de esta respuesta. Por defecto «Razonando…». */
  thinkingLabel?: string;
  /** Texto del error. Por defecto «No pude responder. Inténtalo de nuevo.». */
  errorText?: string;
  /**
   * Lo que la respuesta trae además del texto y que no cabe en `card`,
   * `question` o `link` (extensión de SellUp: un selector, un resumen propio).
   */
  children?: React.ReactNode;
  className?: string;
}

const ACTION_BUTTON =
  "flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

function ActionButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(ACTION_BUTTON, active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/**
 * Una respuesta del agente (Thema · `ChatAgentMessage`). Sin burbuja: el
 * destello a la izquierda y el texto al lado. Se escribe sola y se puede
 * detener; al terminar enseña de dónde salió, lo que trae (una tarjeta, una
 * pregunta, un enlace) y las acciones. Las sugerencias para seguir salen solo
 * en la última.
 *
 * De Thema no se porta «Leer en voz alta» (SellUp no tiene voz). «Útil / No
 * útil», «Regenerar», «Detener» y «Más» solo se pintan si quien monta la
 * respuesta pasa su manejador: no hay botones que no hagan nada.
 */
export function ChatAgentMessage({
  message,
  isLast,
  onStop,
  onFinish,
  onProgress,
  onFeedback,
  onRegenerate,
  onFollowup,
  onAnswer,
  onNavigate,
  onMore,
  thinkingLabel,
  errorText,
  children,
  className,
}: ChatAgentMessageProps) {
  const streaming = message.status === "streaming";
  const { shown, done } = useStreamedText(message.text, streaming, { onDone: onFinish, onProgress });
  const shownRef = React.useRef(shown);
  React.useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  const [copied, setCopied] = React.useState(false);
  const [askingWhy, setAskingWhy] = React.useState(false);

  if (message.status === "pending") {
    return (
      <div className={cn("flex items-start gap-3", className)} data-testid="chat-agent" data-status="pending">
        <ChatThinking since={message.createdAt} label={thinkingLabel} />
      </div>
    );
  }

  const finished = done && !streaming;
  const settled = message.status === "done" || message.status === "stopped" || message.status === "error";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin portapapeles (contexto inseguro): no hay nada que avisar.
    }
  };

  return (
    <div
      className={cn("group/agent flex items-start gap-3", className)}
      data-testid="chat-agent"
      data-status={message.status}
    >
      <ChatMark size="sm" className="mt-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {message.status === "error" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
          >
            <Text size="sm" tone="negative">
              {errorText ?? (message.text || t("chat.error"))}
            </Text>
            {onRegenerate && (
              <Button type="button" variant="outline" size="sm" onClick={onRegenerate}>
                {t("common.retry")}
              </Button>
            )}
          </div>
        ) : (
          message.text !== "" && (
            <>
              <div aria-label={t("chat.agentMessage")} className={cn(streaming && !done && "chat-caret")}>
                <ChatMarkdown text={shown} onNavigate={onNavigate} />
              </div>
              {/* Lo que se lee de una vez, para quien escucha: el texto entero cuando terminó de
                  escribirse. Solo si la respuesta se escribe sola (quien la monta pasa `onFinish`);
                  una que llega ya terminada se lee tal cual y repetirla la anunciaría dos veces. */}
              {finished && message.status === "done" && onFinish && (
                <span className="sr-only" role="status">
                  {message.text}
                </span>
              )}
            </>
          )
        )}

        {streaming && !done && onStop && (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onStop(shownRef.current)}>
            <Square aria-hidden />
            {t("chat.stop")}
          </Button>
        )}

        {message.status === "stopped" && (
          <Text size="xs" tone="muted">
            {t("chat.stopped")}
          </Text>
        )}

        {settled && message.card && <ChatCardView card={message.card} />}

        {settled && message.question && onAnswer && (
          <ChatQuestionCard question={message.question} active={isLast} onAnswer={onAnswer} />
        )}

        {settled && children}

        {settled && message.link && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => onNavigate?.(message.link!.href)}
          >
            {message.link.label}
            <ArrowRight aria-hidden />
          </Button>
        )}

        {settled && message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Text size="xs" tone="muted" className="mr-1">
              {t("chat.sources")}
            </Text>
            {message.sources.map((source) => (
              <Tooltip key={source.label}>
                <TooltipTrigger
                  render={
                    <span className="inline-flex cursor-default items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-0.5 text-xs text-muted-foreground" />
                  }
                >
                  <FileIcon className="size-3.5 text-text-muted" aria-hidden />
                  {source.label}
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 text-xs">
                  {source.detail && <p className="mb-1 font-medium">{source.detail}</p>}
                  <p>{t("chat.sourcesHint")}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {settled && message.status !== "error" && message.text !== "" && (
          <div
            className={cn(
              "flex items-center gap-0.5 transition-opacity",
              !isLast && "opacity-0 focus-within:opacity-100 group-hover/agent:opacity-100",
            )}
            data-testid="chat-agent-actions"
          >
            <ActionButton
              label={copied ? t("chat.copied") : t("chat.copy")}
              icon={copied ? Check : Copy}
              onClick={copy}
            />
            {onFeedback && (
              <>
                <ActionButton
                  label={t("chat.useful")}
                  icon={ThumbsUp}
                  active={message.feedback === "up"}
                  onClick={() => {
                    setAskingWhy(false);
                    onFeedback(message.feedback === "up" ? undefined : "up");
                  }}
                />
                <ActionButton
                  label={t("chat.notUseful")}
                  icon={ThumbsDown}
                  active={message.feedback === "down"}
                  onClick={() => {
                    const next = message.feedback === "down" ? undefined : "down";
                    onFeedback(next);
                    setAskingWhy(next === "down");
                  }}
                />
              </>
            )}
            {onRegenerate && isLast && (
              <ActionButton label={t("chat.regenerate")} icon={RefreshCw} onClick={onRegenerate} />
            )}
            {onMore && (
              <DropdownMenu>
                <DropdownMenuTrigger aria-label={t("chat.more")} title={t("chat.more")} className={ACTION_BUTTON}>
                  <MoreHorizontal className="size-3.5" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-auto rounded-xl">
                  <DropdownMenuItem onClick={() => onMore("share")}>{t("chat.shareMessage")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onMore("task")}>{t("chat.createTask")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onMore("report")}>{t("chat.report")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        {askingWhy && onFeedback && (
          <ChatFeedbackForm onSubmit={(detail) => onFeedback("down", detail)} onCancel={() => setAskingWhy(false)} />
        )}

        {isLast &&
          message.status === "done" &&
          finished &&
          onFollowup &&
          message.followups &&
          message.followups.length > 0 &&
          !message.question && (
            <div className="chat-rise flex flex-wrap gap-2" aria-label={t("chat.followups")} data-testid="chat-followups">
              {message.followups.map((followup) => (
                <Chip key={followup} label={followup} icon={Sparkles} size="md" onClick={() => onFollowup(followup)} />
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
