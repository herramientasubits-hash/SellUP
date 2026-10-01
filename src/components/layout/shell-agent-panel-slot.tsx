"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * El ancla del panel del Agente IA (Thema · `shellAgentPanelSlot`), al lado de
 * la columna de contenido del shell y no encima. Quien abre el asistente lo
 * pinta donde le toque en el árbol, pero el panel tiene que ser hermano de la
 * columna de contenido para que abrirlo la estreche en vez de taparla.
 *
 * `undefined` = no hay shell por encima (una pantalla suelta, una prueba);
 * `null` = hay shell pero su ancla todavía no se ha montado.
 */
const ShellAgentPanelSlotContext = React.createContext<HTMLElement | null | undefined>(undefined);

export const ShellAgentPanelSlotProvider = ShellAgentPanelSlotContext.Provider;

/** Si hay un shell por encima con ancla para el panel del agente. */
export function useHasShellAgentPanelSlot(): boolean {
  return React.useContext(ShellAgentPanelSlotContext) !== undefined;
}

/** Pinta a sus hijos en el ancla lateral del shell, junto a la columna de contenido. */
export function ShellAgentPanelSlot({ children }: { children: React.ReactNode }) {
  const host = React.useContext(ShellAgentPanelSlotContext);
  if (host === null) return null;
  if (host === undefined) {
    // Sin shell no hay columna que estrechar: el panel flota a la derecha de la
    // ventana, sin velo, para que el asistente siga funcionando fuera de la app.
    return (
      <div data-agent-panel-floating className="fixed inset-y-0 right-0 z-50 flex h-dvh">
        {children}
      </div>
    );
  }
  return createPortal(children, host);
}
