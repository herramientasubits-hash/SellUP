"use client";

import * as React from "react";

import { Check, Copy, Pencil } from "@/icons";
import type { LucideIcon } from "@/icons";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/typography";

import { t } from "./messages";
import type { ChatMessage } from "./types";

export interface ChatUserMessageProps {
  message: ChatMessage;
  /** Corregir el mensaje en línea: lo que venía después se descarta. Sin esto no hay botón. */
  onEdit?: (text: string) => void;
  /**
   * Extensión de SellUp: cuando la respuesta no es texto libre sino una
   * elección (un país, una industria), «Editar» no abre un campo: devuelve a
   * la persona al paso donde eligió. Si se pasa, gana sobre `onEdit`.
   */
  onEditRequest?: () => void;
  /** Nombre accesible del botón de editar. Por defecto «Editar». */
  editLabel?: string;
}

function IconAction({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/** Lo que dijo la persona (Thema · `ChatUserMessage`): una burbuja a la derecha, con copiar y editar al pasar. */
export function ChatUserMessage({ message, onEdit, onEditRequest, editLabel }: ChatUserMessageProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(message.text);
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin portapapeles (contexto inseguro): no hay nada que avisar.
    }
  };

  const confirm = () => {
    const text = draft.trim();
    if (!text || text === message.text) {
      setEditing(false);
      return;
    }
    onEdit?.(text);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2 self-end" data-testid="chat-user-edit">
        <textarea
          autoFocus
          value={draft}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              confirm();
            }
            if (event.key === "Escape") setEditing(false);
          }}
          aria-label={t("chat.editMessage")}
          className="w-72 max-w-full resize-none rounded-2xl border border-primary/40 bg-card px-4 py-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <div className="flex items-center justify-end gap-2">
          <Text size="xs" tone="muted" className="mr-auto">
            {t("chat.editHint")}
          </Text>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={confirm}>
            {t("chat.send")}
          </Button>
        </div>
      </div>
    );
  }

  const canEdit = Boolean(onEditRequest ?? onEdit);

  return (
    <div className="group/user flex max-w-[85%] flex-col items-end gap-1 self-end" data-testid="chat-user">
      <p
        aria-label={t("chat.yourMessage")}
        className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 text-sm text-foreground"
      >
        {message.text}
      </p>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/user:opacity-100">
        <IconAction label={copied ? t("chat.copied") : t("chat.copy")} icon={copied ? Check : Copy} onClick={copy} />
        {canEdit && (
          <IconAction
            label={editLabel ?? t("chat.editMessage")}
            icon={Pencil}
            onClick={() => {
              if (onEditRequest) {
                onEditRequest();
                return;
              }
              setDraft(message.text);
              setEditing(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
