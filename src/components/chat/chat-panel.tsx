"use client";

import * as React from "react";

import { Activity, Clock, Minus, Plus, X } from "@/icons";
import { AiAgentDrawer } from "@/components/ai/ai-agent-drawer";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { Text } from "@/components/typography";

import { ChatMark, type ChatMarkProps } from "./chat-mark";
import { t } from "./messages";

function runsLabel(inProgress: number): string {
  if (inProgress <= 0) return t("chat.runs");
  return inProgress === 1 ? "Ver búsquedas · 1 en curso" : `Ver búsquedas · ${inProgress} en curso`;
}

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
  /**
   * «Búsquedas»: abre la página de búsquedas en curso e historial. Sin esto no hay
   * botón. `runsInProgress` > 0 lo marca y lo cuenta.
   */
  onRuns?: () => void;
  runsInProgress?: number;
  /** «Minimizar»: cierra el panel dejando lo que corre en el Centro de procesos. */
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
  onRuns,
  runsInProgress = 0,
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
            {/* Cada botón de la cabecera es sólo un icono: el tooltip dice qué hace. */}
            {onHistory && (
              <TooltipIconButton
                icon={<Clock aria-hidden />}
                label={t("chat.history")}
                variant={historyActive ? "secondary" : "ghost"}
                onClick={onHistory}
                aria-pressed={historyActive}
                data-testid="chat-panel-history"
              />
            )}
            {onRuns && (
              <TooltipIconButton
                icon={
                  <>
                    <Activity aria-hidden />
                    {runsInProgress > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold leading-none text-primary-foreground">
                        {runsInProgress}
                      </span>
                    )}
                  </>
                }
                label={runsLabel(runsInProgress)}
                variant={runsInProgress > 0 ? "secondary" : "ghost"}
                onClick={onRuns}
                data-testid="chat-panel-runs"
                className="relative"
              />
            )}
            {onNewConversation && (
              <TooltipIconButton
                icon={<Plus aria-hidden />}
                label={newLabel}
                onClick={onNewConversation}
                disabled={newConversationDisabled}
                data-testid="chat-panel-new"
              />
            )}
            {onMinimize && (
              <TooltipIconButton
                icon={<Minus aria-hidden />}
                label={t("chat.minimize")}
                onClick={onMinimize}
                data-testid="chat-panel-minimize"
              />
            )}
            <TooltipIconButton
              icon={<X aria-hidden />}
              label={t("common.close")}
              onClick={() => onOpenChange(false)}
              disabled={closeDisabled}
              data-testid="chat-panel-close"
            />
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </aside>
      }
    />
  );
}
