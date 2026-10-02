"use client";

import * as React from "react";

import { Plus, X } from "@/icons";
import { cn } from "@/lib/utils";

import { t, type ChatMessageKey } from "./messages";
import type { Conversation } from "./types";

export type ConversationGroupKey = "today" | "yesterday" | "week" | "older";

const GROUP_KEY: Record<ConversationGroupKey, ChatMessageKey> = {
  today: "chat.history.today",
  yesterday: "chat.history.yesterday",
  week: "chat.history.week",
  older: "chat.history.older",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Agrupa por cuándo se tocaron: hoy, ayer, últimos 7 días, anteriores. La más reciente, primero. */
export function groupConversations(
  conversations: readonly Conversation[],
  now: number = Date.now(),
): { key: ConversationGroupKey; items: Conversation[] }[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const buckets: Record<ConversationGroupKey, Conversation[]> = { today: [], yesterday: [], week: [], older: [] };
  for (const conversation of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const at = conversation.updatedAt;
    if (at >= today) buckets.today.push(conversation);
    else if (at >= today - DAY_MS) buckets.yesterday.push(conversation);
    else if (at >= today - 7 * DAY_MS) buckets.week.push(conversation);
    else buckets.older.push(conversation);
  }
  return (Object.keys(buckets) as ConversationGroupKey[])
    .map((key) => ({ key, items: buckets[key] }))
    .filter((group) => group.items.length > 0);
}

function isThinking(conversation: Conversation): boolean {
  return conversation.messages.at(-1)?.status === "pending";
}

/** Un punto que dice si hay respuesta sin leer o si el agente sigue escribiendo. */
export function ChatStatusDot({ conversation }: { conversation: Conversation }) {
  if (isThinking(conversation)) {
    return (
      <span
        aria-label={t("chat.status.thinking")}
        role="img"
        className="size-2.5 shrink-0 animate-pulse rounded-full bg-ai-gradient motion-reduce:animate-none"
      />
    );
  }
  if (conversation.unread) {
    return (
      <span
        aria-label={t("chat.status.unread")}
        role="img"
        className="size-2 shrink-0 rounded-full bg-primary ring-4 ring-primary/20"
      />
    );
  }
  return <span aria-hidden className="size-2 shrink-0 rounded-full border border-border" />;
}

export interface ChatHistoryListProps {
  /** Thema las lee de su almacén; en SellUp las pasa quien tenga un historial que enseñar. */
  conversations: readonly Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRemove?: (id: string) => void;
  className?: string;
}

/**
 * Las conversaciones por cuándo se tocaron, con «Nueva conversación» arriba
 * (Thema · `ChatHistoryList`). Ningún asistente de SellUp guarda conversaciones
 * todavía: la pieza queda lista para cuando haya de dónde leerlas.
 */
export function ChatHistoryList({ conversations, activeId, onSelect, onNew, onRemove, className }: ChatHistoryListProps) {
  const groups = React.useMemo(() => groupConversations(conversations), [conversations]);

  return (
    <nav aria-label={t("chat.history")} className={cn("flex flex-col gap-1", className)} data-testid="chat-history">
      <button
        type="button"
        onClick={onNew}
        className={cn(
          "mb-2 flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:bg-surface-muted hover:text-primary",
          activeId === null && "border-primary/50 text-primary",
        )}
      >
        <Plus className="size-3.5" aria-hidden />
        {t("chat.newConversation")}
      </button>
      {groups.length === 0 && <p className="px-2 py-3 text-xs text-text-muted">{t("chat.history.empty")}</p>}
      {groups.map((group) => (
        <React.Fragment key={group.key}>
          <div className="shrink-0 px-2 pb-1 pt-3 text-xs font-semibold text-text-muted">{t(GROUP_KEY[group.key])}</div>
          {group.items.map((conversation) => {
            const active = conversation.id === activeId;
            return (
              <div key={conversation.id} className="group/row relative flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
                    active && "bg-surface-muted font-semibold text-primary hover:bg-surface-muted hover:text-primary",
                    conversation.unread && !active && "text-foreground",
                  )}
                >
                  <ChatStatusDot conversation={conversation} />
                  <span className="truncate">{conversation.title}</span>
                </button>
                {onRemove && (
                  <button
                    type="button"
                    aria-label={t("chat.deleteConversation")}
                    title={t("chat.deleteConversation")}
                    onClick={() => onRemove(conversation.id)}
                    className="absolute right-1 flex size-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:bg-surface-muted hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </nav>
  );
}
