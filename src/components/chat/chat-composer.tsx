"use client";

import * as React from "react";

import { File as FileIcon, SendHorizonal, Sparkles, Wand, X } from "@/icons";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ai/chip";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { MovingBorderBeam } from "@/components/ui/moving-border-beam";
import { Text } from "@/components/typography";

import { ChatAttachMenu } from "./chat-attach-menu";
import { t } from "./messages";
import type { ChatConnector, ChatNews } from "./types";

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Se llama con el texto ya recortado y los archivos adjuntos; la caja se vacía sola. */
  onSend: (text: string, files: readonly File[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Una fila y menos aire: para el pie de un hilo. */
  compact?: boolean;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  /** El aviso de novedad encima del texto («Nuevo · Ya ejecuta acciones en…»). */
  news?: ChatNews;
  /** El objeto sobre el que responde el agente, como pastilla. */
  contextChip?: string;
  onRemoveContext?: () => void;
  /**
   * El menú «+» (conectores y archivos). En SellUp ningún asistente recibe
   * adjuntos todavía, así que va apagado salvo que quien monta la caja lo pida.
   */
  attach?: boolean;
  connectors?: readonly ChatConnector[];
  onToggleConnector?: (id: string, connected: boolean) => void;
  onAddConnectors?: () => void;
  /** Preguntas para arrancar, como chips encima de la caja. */
  chips?: readonly string[];
  onChip?: (text: string) => void;
  /** «El agente puede cometer errores…» debajo. */
  disclaimer?: boolean;
  maxFiles?: number;
  maxSizeMb?: number;
  /**
   * Tope de caracteres (extensión de SellUp: los criterios del asistente tienen
   * límite). Con él aparece el contador al escribir y, pasado el tope, no se envía.
   */
  maxLength?: number;
  className?: string;
}

const MB = 1024 * 1024;

/** `**negrita**` en una línea, sin montar Markdown entero. */
function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") ? (
          <strong key={index} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

const ROUND_ICON_BUTTON =
  "rounded-full p-0.5 text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * La caja de escribir del chat (Thema · `ChatComposer`).
 *
 * Es la misma en el panel y en la pantalla completa: el borde que recorre y la
 * malla se encienden al enfocar, Enter envía y Shift+Enter baja de línea, y el
 * botón de enviar lleva un halo que se enciende cuando hay algo que enviar.
 * El botón «Voz» de Thema no se porta: SellUp no tiene modo voz.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  placeholder,
  disabled = false,
  compact = false,
  autoFocus = false,
  inputRef,
  news,
  contextChip,
  onRemoveContext,
  attach = false,
  connectors,
  onToggleConnector,
  onAddConnectors,
  chips,
  onChip,
  disclaimer = true,
  maxFiles = 10,
  maxSizeMb = 25,
  maxLength,
  className,
}: ChatComposerProps) {
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [files, setFiles] = React.useState<readonly File[]>([]);
  const [newsDismissed, setNewsDismissed] = React.useState(false);
  const trimmed = value.trim();
  const overLimit = maxLength !== undefined && value.length > maxLength;
  const canSend = !disabled && !overLimit && (trimmed.length > 0 || files.length > 0);
  const counterId = React.useId();

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed, files);
    onChange("");
    setFiles([]);
  };

  const pickFiles = () => fileInput.current?.click();

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = Array.from(list).filter((file) => file.size <= maxSizeMb * MB);
    setFiles((previous) => [...previous, ...accepted].slice(0, maxFiles));
  };

  const showNews = news && !newsDismissed;
  const showCounter = maxLength !== undefined && !disabled && value.length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {chips && chips.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="chat-chips">
          {chips.map((chip) => (
            <Chip key={chip} label={chip} size="md" disabled={disabled} onClick={() => onChip?.(chip)} />
          ))}
        </div>
      )}

      <div
        className={cn(
          "chat-composer group relative isolate overflow-hidden border border-border/60 bg-card shadow-card transition-shadow focus-within:shadow-drawer",
          disabled && "bg-surface-subtle shadow-none",
        )}
        onKeyDown={(event) => {
          if (attach && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "u") {
            event.preventDefault();
            pickFiles();
          }
        }}
        data-testid="chat-composer"
        data-disabled={disabled || undefined}
      >
        {!disabled && <MovingBorderBeam duration={6000} borderWidth={1.5} />}
        <div aria-hidden className="chat-composer-wash pointer-events-none absolute inset-0 z-0" />

        <div className="relative z-10 flex flex-col">
          {showNews && (
            <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2" data-testid="chat-news">
              <Wand className="size-3.5 shrink-0 text-text-muted" aria-hidden />
              <Badge>{t("chat.new")}</Badge>
              <Text size="sm" tone="secondary" className="min-w-0 flex-1 truncate">
                <InlineBold text={news.text} />
              </Text>
              {news.onOpen && (
                <button
                  type="button"
                  onClick={news.onOpen}
                  className="shrink-0 text-sm font-medium text-primary hover:underline"
                >
                  {t("chat.newsSeeWhatChanged")}
                </button>
              )}
              <button
                type="button"
                aria-label={t("chat.newsDismiss")}
                onClick={() => {
                  setNewsDismissed(true);
                  news.onDismiss?.();
                }}
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          )}

          {contextChip && (
            <div className="flex items-center gap-2 border-b border-border/50 bg-surface-muted px-4 py-2">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 py-0.5 pl-2 pr-1 text-xs font-medium text-foreground">
                <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="truncate">{contextChip}</span>
                {onRemoveContext && (
                  <button
                    type="button"
                    aria-label={t("chat.contextRemove")}
                    onClick={onRemoveContext}
                    className={ROUND_ICON_BUTTON}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </span>
              <Text size="xs" tone="muted" className="truncate">
                {t("chat.contextNote")}
              </Text>
            </div>
          )}

          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-4 pt-3" aria-label={t("chat.attachFiles")}>
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-muted py-1 pl-2.5 pr-1 text-xs text-foreground"
                >
                  <FileIcon className="size-3.5 text-text-muted" aria-hidden />
                  <span className="max-w-40 truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={t("chat.attachmentRemove")}
                    onClick={() => setFiles((previous) => previous.filter((_, position) => position !== index))}
                    className={ROUND_ICON_BUTTON}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <textarea
            ref={inputRef}
            rows={compact ? 1 : 2}
            value={value}
            disabled={disabled}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder ?? t("chat.placeholder.new")}
            aria-label={t("chat.messageLabel")}
            aria-describedby={showCounter ? counterId : undefined}
            data-testid="chat-input"
            className={cn(
              "w-full resize-none bg-transparent px-4 text-base leading-normal text-foreground outline-none placeholder:text-text-muted disabled:cursor-default disabled:opacity-60",
              compact ? "min-h-8 pb-1 pt-3 text-sm" : "min-h-16 pb-2 pt-4",
            )}
          />

          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="flex min-w-0 items-center gap-2">
              {attach && (
                <>
                  <ChatAttachMenu
                    connectors={connectors}
                    onToggleConnector={onToggleConnector}
                    onAddConnectors={onAddConnectors}
                    onPickFiles={pickFiles}
                    maxFiles={maxFiles}
                    maxSizeMb={maxSizeMb}
                    disabled={disabled}
                  />
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept=".pdf,.xls,.xlsx,.csv"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(event) => {
                      addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </>
              )}
              {!compact && !disabled && (
                <Text size="xs" tone="muted" className="inline-flex items-center gap-1.5 max-sm:hidden">
                  <Kbd>Enter</Kbd>
                  {t("chat.enterToSend")}
                </Text>
              )}
            </div>
            <div className="flex items-center gap-2">
              {showCounter && (
                <span
                  id={counterId}
                  aria-live="polite"
                  aria-atomic="true"
                  data-testid="chat-counter"
                  className={cn(
                    "text-xs tabular-nums",
                    overLimit ? "font-medium text-destructive" : "text-text-muted",
                  )}
                >
                  {value.length}/{maxLength}
                </span>
              )}
              <span className="relative inline-flex">
                <span aria-hidden className={cn("chat-send-halo", canSend && "chat-send-halo--on")} />
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  aria-label={t("chat.send")}
                  data-testid="chat-send"
                  className="relative flex size-9 items-center justify-center rounded-full bg-ai-gradient text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
                >
                  <SendHorizonal className="size-4" aria-hidden />
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>

      {disclaimer && (
        <Text size="xs" tone="muted" className="text-center">
          {t("chat.disclaimer")}
        </Text>
      )}
    </div>
  );
}
