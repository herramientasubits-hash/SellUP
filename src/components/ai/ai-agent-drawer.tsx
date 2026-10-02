"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { ShellAgentPanelSlot } from "@/components/layout/shell-agent-panel-slot";

import {
  AGENT_PANEL_DURATION_MS,
  AGENT_PANEL_OUTER_WIDTH,
  AGENT_PANEL_WIDTH,
  OVERLAY_INSET,
  agentPanelTransition,
} from "./agent-panel-motion";

/**
 * Thema trae cuatro contextos de demostración de su producto de encuestas
 * (`dashboard`, `builder`, `results`, `demographics`), con una caja que no
 * envía nada. SellUp solo usa el panel a medida.
 */
export type AiAgentContext = "custom";

export interface AiAgentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: AiAgentContext;
  /**
   * El panel que ocupa el hueco. El drawer solo se ocupa de abrir y cerrar ese
   * hueco al lado de la página; lo de dentro lo trae quien lo usa (`ChatPanel`
   * pone la cabecera, la malla y el hilo).
   */
  customPanel?: React.ReactNode;
}

/**
 * El hueco del Agente IA (Thema · `AiAgentDrawer`).
 *
 * No es un drawer modal: se porta al ancla que el shell reserva junto a la
 * columna de contenido, así abrirlo ESTRECHA la página en vez de taparla, sin
 * velo, y flota a `OVERLAY_INSET` del borde. El ancho es `min(400px, 45vw)`.
 *
 * El contenido se desmonta al terminar de cerrarse, igual que el de un drawer:
 * un asistente reabierto empieza de cero.
 */
export function AiAgentDrawer({ open, onOpenChange, customPanel }: AiAgentDrawerProps) {
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  // Lo de dentro sigue pintado mientras el hueco se cierra y se va al terminar.
  const [present, setPresent] = React.useState(open);
  if (open && !present) setPresent(true);
  React.useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setPresent(false), AGENT_PANEL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Escape cierra, como el resto de paneles, pero solo si se pulsa con el foco
  // dentro del panel: un desplegable abierto (que vive en su propio portal)
  // cierra el desplegable, no el asistente.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const surface = surfaceRef.current;
      if (!surface || !(event.target instanceof Node) || !surface.contains(event.target)) return;
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <ShellAgentPanelSlot>
      {/* El envoltorio es lo que se anima: al crecer estrecha la columna de
          contenido y recorta el panel de ancho fijo mientras se abre. */}
      <div
        className="h-full shrink-0 overflow-hidden"
        data-agent-panel-open={open || undefined}
        data-testid="agent-panel-slot"
        style={{ width: open ? AGENT_PANEL_OUTER_WIDTH : 0, transition: agentPanelTransition("width") }}
      >
        {/* El panel flota: margen arriba, abajo y a la derecha, no pegado a la ventana. */}
        <div
          className="h-full"
          data-agent-panel-frame
          style={{
            width: AGENT_PANEL_OUTER_WIDTH,
            padding: `${OVERLAY_INSET}px ${OVERLAY_INSET}px ${OVERLAY_INSET}px 0`,
          }}
        >
          <div
            ref={surfaceRef}
            data-agent-panel-surface
            className={cn("h-full", !open && "invisible")}
            style={{
              width: AGENT_PANEL_WIDTH,
              // Sin retraso: el contenido aparece mientras el hueco se abre, no después.
              opacity: open ? 1 : 0,
              transition: agentPanelTransition("opacity"),
            }}
            aria-hidden={!open}
          >
            {present ? customPanel : null}
          </div>
        </div>
      </div>
    </ShellAgentPanelSlot>
  );
}
