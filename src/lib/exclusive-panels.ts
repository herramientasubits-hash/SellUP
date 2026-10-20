'use client';

/**
 * Un solo panel lateral abierto a la vez (dueña 20-10: «sólo puede existir un drawer
 * abierto: si abrí el de la empresa y le doy a Rumbo, debe cerrar el de la empresa y
 * abrir el de Rumbo»).
 *
 * Dos clases de panel:
 *  - `agent`: los de Rumbo e IA (primer contacto, buscar contactos, prospectar). Al abrirse
 *    cierra cualquier otro panel, de IA o de detalle.
 *  - `detail`: las fichas de detalle (empresa, contacto, candidato). Al abrirse cierra los
 *    de IA; no cierra otras fichas, porque una ficha puede abrir otra dentro (el contacto
 *    desde la empresa).
 *
 * Un panel de IA que trabaja no pierde nada al cerrarse: se minimiza al centro de procesos.
 */

import * as React from 'react';

export type ExclusivePanelKind = 'agent' | 'detail';

export const EXCLUSIVE_PANEL_OPEN_EVENT = 'sellup:exclusive-panel:open';

interface OpenDetail {
  id: string;
  kind: ExclusivePanelKind;
}

/** ¿El panel `mine` debe cerrarse porque se abrió `other`? */
export function shouldCloseFor(mine: ExclusivePanelKind, other: ExclusivePanelKind): boolean {
  return other === 'agent' || mine === 'agent';
}

export function useExclusivePanel(kind: ExclusivePanelKind, open: boolean, close: () => void): void {
  const id = React.useId();
  const closeRef = React.useRef(close);
  React.useEffect(() => {
    closeRef.current = close;
  }, [close]);

  React.useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenDetail>).detail;
      if (!detail || detail.id === id) return;
      if (shouldCloseFor(kind, detail.kind)) closeRef.current();
    };
    window.addEventListener(EXCLUSIVE_PANEL_OPEN_EVENT, onOpen);
    // Se avisa DESPUÉS de escuchar: los demás se cierran; éste no se cierra a sí mismo.
    window.dispatchEvent(new window.CustomEvent<OpenDetail>(EXCLUSIVE_PANEL_OPEN_EVENT, { detail: { id, kind } }));
    return () => window.removeEventListener(EXCLUSIVE_PANEL_OPEN_EVENT, onOpen);
  }, [open, id, kind]);
}
