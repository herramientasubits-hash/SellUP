"use client";

import * as React from "react";

import { Clock, Minimize2, Plus, X } from "@/icons";
import { AiAgentDrawer } from "@/components/ai/ai-agent-drawer";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/typography";

import { ChatMark, type ChatMarkProps } from "./chat-mark";
import { t } from "./messages";

export interface ChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Por defecto «Agente IA». */
  title?: string;
  subtitle?: string;
  /** Cómo se mueve la marca de la cabecera. Thema: `breathing` en reposo, `still` con hilo. */
  markMotion?: ChatMarkProps["motion"];
  /**
   * «Historial». Thema lo abre siempre; en SellUp solo se pinta si quien monta
   * el panel tiene conversaciones guardadas que enseñar.
   */
  onHistory?: () => void;
  /** El historial está a la vista (el botón queda marcado). */
  historyActive?: boolean;
  /** «Nueva conversación». Sin esto no hay botón. */
  onNewConversation?: () => void;
  /** Nombre del botón de empezar de nuevo. Por defecto «Nueva conversación». */
  newConversationLabel?: string;
  /** No se puede empezar otra ahora mismo (hay una en curso). */
  newConversationDisabled?: boolean;
  /** No se puede cerrar ahora mismo (hay una ejecución en curso). */
  closeDisabled?: boolean;
  /** «Minimizar»: cierra el panel dejando lo que corre en la bandeja flotante. */
  onMinimize?: () => void;
  /** El cuerpo del panel: el hilo, la caja, lo que el asistente necesite. */
  children: React.ReactNode;
}

/**
 * El chat como panel lateral (Thema · `ChatPanel`). Se porta al ancla que el
 * shell reserva junto a la columna de contenido, así abrirlo estrecha la
 * pantalla en vez de taparla, y flota a 12px del borde como el resto de paneles.
 *
 * La cabecera es la de Thema: la marca, el título, el subtítulo y las puertas
 * de siempre (Historial, Nueva conversación, Cerrar). Thema saca la
 * conversación de su almacén; SellUp no tiene uno, así que el cuerpo lo trae
 * cada asistente como `children` (su hilo arriba, su caja abajo).
 */
export function ChatPanel({
  open,
  onOpenChange,
  title,
  subtitle,
  markMotion = "breathing",
  onHistory,
  historyActive = false,
  onNewConversation,
  newConversationLabel,
  newConversationDisabled = false,
  closeDisabled = false,
  onMinimize,
  children,
}: ChatPanelProps) {
  const heading = title ?? t("chat.title");
  const newLabel = newConversationLabel ?? t("chat.newConversation");
  const titleId = React.useId();

  return (
    <AiAgentDrawer
      open={open}
      onOpenChange={(next) => {
        if (!next && closeDisabled) return;
        onOpenChange(next);
      }}
      context="custom"
      customPanel={
        <aside
          aria-labelledby={titleId}
          data-testid="chat-panel"
          className="ai-mesh-agent flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-border/20 px-4 py-3">
            <ChatMark size="md" motion={markMotion} />
            <div className="min-w-0 flex-1">
              <Text as="h2" id={titleId} size="sm" weight="semibold" className="leading-tight">
                {heading}
              </Text>
              <Text size="xs" tone="muted" truncate>
                {subtitle ?? t("chat.subtitle")}
              </Text>
            </div>
            {onHistory && (
              <Button
                type="button"
                variant={historyActive ? "secondary" : "ghost"}
                size="icon-sm"
                onClick={onHistory}
                aria-label={t("chat.history")}
                title={t("chat.history")}
                aria-pressed={historyActive}
                data-testid="chat-panel-history"
              >
                <Clock aria-hidden />
              </Button>
            )}
            {onNewConversation && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onNewConversation}
                disabled={newConversationDisabled}
                aria-label={newLabel}
                title={newLabel}
                data-testid="chat-panel-new"
              >
                <Plus aria-hidden />
              </Button>
            )}
            {onMinimize && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onMinimize}
                aria-label={t("chat.minimize")}
                title={t("chat.minimize")}
                data-testid="chat-panel-minimize"
              >
                <Minimize2 aria-hidden />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              disabled={closeDisabled}
              aria-label={t("common.close")}
              title={t("common.close")}
              data-testid="chat-panel-close"
            >
              <X aria-hidden />
            </Button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </aside>
      }
    />
  );
}
