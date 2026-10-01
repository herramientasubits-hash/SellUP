/**
 * El gesto de abrir el Agente IA, en un solo sitio (Thema · `agentPanelMotion`).
 *
 * Abrir el panel mueve varias cosas a la vez: el panel entra por la derecha y
 * lo que convive con él (un drawer, su velo) se corre para dejarle sitio. Si
 * cada una lleva su propia duración o su propia curva se leen como animaciones
 * sueltas. Por eso esto se pasa como estilo en línea y no como clases: es la
 * única forma de que el número que se lee aquí sea el que de verdad corre.
 */

import type * as React from "react";

/**
 * Lo que mide el panel abierto. No son 400 px a secas: en una ventana angosta
 * reservarlos dejaría la página sin sitio. Con el tope en proporción, el panel
 * cede cuando no hay sitio y los dos siguen cabiendo.
 */
export const AGENT_PANEL_WIDTH = "min(400px, 45vw)";

/** El aire que queda a la izquierda de un drawer cuando el panel está abierto. */
export const AGENT_PANEL_GUTTER = 32;

/**
 * El margen exterior de todo lo que flota sobre la página: el panel del Agente
 * IA y los `Sheet`. Coincide con `3` de Tailwind (0.75rem), lo que usa `sheet.tsx`.
 */
export const OVERLAY_INSET = 12;

/** Lo que ocupa el panel en la fila del shell: su ancho más el margen del borde derecho. */
export const AGENT_PANEL_OUTER_WIDTH = `calc(${AGENT_PANEL_WIDTH} + ${OVERLAY_INSET}px)`;

/** Lo que un drawer descuenta además del ancho del panel para quedar *junto* a él. */
export const AGENT_PANEL_SHELL_FRAME = OVERLAY_INSET * 2;

export const AGENT_PANEL_DURATION_MS = 320;
export const AGENT_PANEL_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

/** `transition` para las propiedades que se muevan con el panel. */
export const agentPanelTransition = (...properties: string[]): string =>
  properties.map((property) => `${property} ${AGENT_PANEL_DURATION_MS}ms ${AGENT_PANEL_EASING}`).join(", ");

/**
 * Cómo se corre un drawer —y su velo— para dejarle sitio al panel. Se pasa a
 * `DrawerShell` como `contentStyle` y `overlayStyle`.
 */
export function agentPanelShift(open: boolean): {
  content: React.CSSProperties;
  overlay: React.CSSProperties;
} {
  // Cerrado no vuelve a 0: el drawer flota a `OVERLAY_INSET` del borde, como sin el panel.
  const right = open ? `calc(${AGENT_PANEL_WIDTH} + ${AGENT_PANEL_SHELL_FRAME}px)` : `${OVERLAY_INSET}px`;
  return {
    content: {
      right,
      maxWidth: open
        ? `calc(100vw - ${AGENT_PANEL_WIDTH} - ${AGENT_PANEL_SHELL_FRAME + AGENT_PANEL_GUTTER}px)`
        : `min(1280px, calc(100vw - ${OVERLAY_INSET * 2}px))`,
      transition: agentPanelTransition("right", "max-width"),
    },
    // El velo llega hasta el borde izquierdo del panel (abierto) o hasta la ventana (cerrado).
    overlay: { right: open ? AGENT_PANEL_OUTER_WIDTH : 0, transition: agentPanelTransition("right") },
  };
}
