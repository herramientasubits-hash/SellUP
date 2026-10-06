'use client';

/**
 * Arrastrar y soltar la bandeja de búsquedas (AGENT1-PARALLEL-RUNS-PHASE2-1).
 *
 * La posición se guarda en el navegador (`sellup:agent-runs-tray:position`) como
 * esquina superior izquierda y se encaja SIEMPRE dentro de la ventana, también al
 * cambiar de tamaño: una bandeja fuera de pantalla sería una corrida invisible.
 * Doble clic en el asa = volver a la esquina de siempre.
 */

import * as React from 'react';

export type TrayPosition = { x: number; y: number };

export const TRAY_POSITION_STORAGE_KEY = 'sellup:agent-runs-tray:position';
/** Margen mínimo contra los bordes de la ventana. */
export const TRAY_EDGE_MARGIN = 8;

/** Encaja la bandeja dentro de la ventana. Puro: para probarlo sin navegador. */
export function clampTrayPosition(
  position: TrayPosition,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): TrayPosition {
  const maxX = Math.max(TRAY_EDGE_MARGIN, viewport.width - size.width - TRAY_EDGE_MARGIN);
  const maxY = Math.max(TRAY_EDGE_MARGIN, viewport.height - size.height - TRAY_EDGE_MARGIN);
  return {
    x: Math.min(Math.max(position.x, TRAY_EDGE_MARGIN), maxX),
    y: Math.min(Math.max(position.y, TRAY_EDGE_MARGIN), maxY),
  };
}

export function parseStoredTrayPosition(raw: string | null): TrayPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TrayPosition>;
    return typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y)
      ? { x: value.x, y: value.y }
      : null;
  } catch {
    return null;
  }
}

function readStored(): TrayPosition | null {
  try {
    return parseStoredTrayPosition(window.localStorage.getItem(TRAY_POSITION_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(position: TrayPosition | null): void {
  try {
    if (position) window.localStorage.setItem(TRAY_POSITION_STORAGE_KEY, JSON.stringify(position));
    else window.localStorage.removeItem(TRAY_POSITION_STORAGE_KEY);
  } catch {
    // Sin almacenamiento: la posición vive sólo en esta pestaña.
  }
}

export function useDraggableTray() {
  const ref = React.useRef<HTMLElement | null>(null);
  const [position, setPosition] = React.useState<TrayPosition | null>(() =>
    typeof window === 'undefined' ? null : readStored(),
  );
  const [dragging, setDragging] = React.useState(false);
  const offset = React.useRef<{ x: number; y: number } | null>(null);

  const clampToViewport = React.useCallback((next: TrayPosition): TrayPosition => {
    const rect = ref.current?.getBoundingClientRect();
    return clampTrayPosition(next, { width: rect?.width ?? 0, height: rect?.height ?? 0 }, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }, []);

  React.useEffect(() => {
    if (!position) return undefined;
    const onResize = () => setPosition((current) => (current ? clampToViewport(current) : current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [position, clampToViewport]);

  const handlers = {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      if (event.button !== 0 || !ref.current) return;
      // Los botones de la cabecera (minimizar, cerrar, abrir) no arrastran.
      if ((event.target as HTMLElement).closest('button, a')) return;
      const rect = ref.current.getBoundingClientRect();
      offset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      if (!offset.current) return;
      setPosition(clampToViewport({ x: event.clientX - offset.current.x, y: event.clientY - offset.current.y }));
    },
    onPointerUp(event: React.PointerEvent<HTMLElement>) {
      if (!offset.current) return;
      offset.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setPosition((current) => {
        writeStored(current);
        return current;
      });
    },
    onDoubleClick(event: React.MouseEvent<HTMLElement>) {
      if ((event.target as HTMLElement).closest('button, a')) return;
      writeStored(null);
      setPosition(null);
    },
  };

  return { ref, position, dragging, handlers };
}
