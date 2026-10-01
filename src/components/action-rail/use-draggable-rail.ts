"use client";

import * as React from "react";

import { useRailPosition, type RailPosition } from "./rail-preferences";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Deja coger la barra flotante por su asa y soltarla en cualquier punto de la
 * pantalla. Quien la usa debe mantener la barra abierta mientras `isDragging`
 * sea cierto, para que el asa no desaparezca bajo el cursor a mitad de gesto.
 *
 * `barRef` va en el elemento cuya caja se recoloca: el mismo al que se le
 * aplica `position` con `left`/`top` cuando deja de ser `null`.
 */
export function useDraggableRail() {
  const [storedPosition, setStoredPosition] = useRailPosition();
  const [dragPosition, setDragPosition] = React.useState<RailPosition | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const barRef = React.useRef<HTMLDivElement>(null);
  const dragOffsetRef = React.useRef<{ x: number; y: number } | null>(null);
  const lastDragRef = React.useRef<RailPosition | null>(null);

  const position = dragPosition ?? storedPosition;

  // Mantiene en pantalla una barra arrastrada si la ventana encoge por debajo
  // de ella. `x` es el centro, así que el tope deja dentro la mitad del ancho.
  React.useEffect(() => {
    if (!storedPosition) return;
    const clampToViewport = () => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const halfWidth = rect.width / 2;
      const maxX = Math.max(window.innerWidth - halfWidth, halfWidth);
      const maxY = Math.max(window.innerHeight - rect.height, 0);
      const next = {
        x: clamp(storedPosition.x, halfWidth, maxX),
        y: clamp(storedPosition.y, 0, maxY),
      };
      if (next.x !== storedPosition.x || next.y !== storedPosition.y) {
        setStoredPosition(next);
      }
    };
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [storedPosition, setStoredPosition]);

  const onGripPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    lastDragRef.current = null;
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onGripPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const offset = dragOffsetRef.current;
    if (!offset) return;
    const width = barRef.current?.offsetWidth ?? 0;
    const height = barRef.current?.offsetHeight ?? 0;
    const maxX = Math.max(window.innerWidth - width, 0);
    const maxY = Math.max(window.innerHeight - height, 0);
    // La barra está abierta durante todo el gesto, así que `width` es su ancho
    // desplegado: el borde izquierdo que da la cuenta, pasado al centro.
    const next = {
      x: clamp(event.clientX - offset.x, 0, maxX) + width / 2,
      y: clamp(event.clientY - offset.y, 0, maxY),
    };
    lastDragRef.current = next;
    setDragPosition(next);
  };

  const endGripDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragOffsetRef.current) return;
    dragOffsetRef.current = null;
    setIsDragging(false);
    // Solo se guarda si de verdad se movió: un clic en el asa no la despega.
    if (lastDragRef.current) setStoredPosition(lastDragRef.current);
    lastDragRef.current = null;
    setDragPosition(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resetPosition = React.useCallback(() => {
    dragOffsetRef.current = null;
    lastDragRef.current = null;
    setDragPosition(null);
    setStoredPosition(null);
  }, [setStoredPosition]);

  return {
    barRef,
    position,
    isDragging,
    resetPosition,
    gripHandlers: {
      onPointerDown: onGripPointerDown,
      onPointerMove: onGripPointerMove,
      onPointerUp: endGripDrag,
      onPointerCancel: endGripDrag,
      onDoubleClick: resetPosition,
    },
  } as const;
}
