"use client";

import * as React from "react";

/**
 * Arrastrar y soltar una columna en la lista del panel «Configurar tabla»
 * (Thema · `useColumnDrag`).
 *
 * Arrastre nativo del navegador: mover una columna es un gesto de tres
 * eventos. El tirador es el que lleva `draggable`, no toda la fila, para no
 * competir con los botones de fijar y ocultar que viven al lado.
 */

export type DropSide = "before" | "after";

export interface ColumnDrag {
  /** La columna que se está arrastrando, o null. */
  draggingId: string | null;
  /** Va en el tirador. */
  dragHandleProps: (id: string) => React.HTMLAttributes<HTMLElement> & { draggable: true };
  /** Va en la fila completa: es el blanco del soltar. */
  dropTargetProps: (id: string) => React.HTMLAttributes<HTMLElement>;
  /** Por qué lado caería ahora mismo, para pintar la guía. */
  dropSideFor: (id: string) => DropSide | null;
}

export function useColumnDrag({
  axis,
  onReorder,
}: {
  axis: "x" | "y";
  onReorder: (sourceId: string, targetId: string, before: boolean) => void;
}): ColumnDrag {
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<{ id: string; side: DropSide } | null>(null);

  const clear = () => {
    setDraggingId(null);
    setOver(null);
  };

  return {
    draggingId,

    dragHandleProps: (id) => ({
      draggable: true,
      onDragStart: (event: React.DragEvent<HTMLElement>) => {
        // jsdom y algún navegador antiguo no traen `dataTransfer`.
        const transfer = event.dataTransfer as DataTransfer | undefined;
        if (transfer) {
          transfer.effectAllowed = "move";
          transfer.setData("text/plain", id);
          const cell = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-drag-cell]");
          if (cell && typeof transfer.setDragImage === "function") {
            const box = cell.getBoundingClientRect();
            transfer.setDragImage(cell, event.clientX - box.left, event.clientY - box.top);
          }
        }
        setDraggingId(id);
      },
      onDragEnd: clear,
    }),

    dropTargetProps: (id) => ({
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        if (!draggingId || draggingId === id) return;
        event.preventDefault();
        const transfer = event.dataTransfer as DataTransfer | undefined;
        if (transfer) transfer.dropEffect = "move";
        const box = event.currentTarget.getBoundingClientRect();
        const side: DropSide =
          axis === "x"
            ? event.clientX < box.left + box.width / 2
              ? "before"
              : "after"
            : event.clientY < box.top + box.height / 2
              ? "before"
              : "after";
        setOver((current) => (current?.id === id && current.side === side ? current : { id, side }));
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        // Salir hacia un hijo no es salir: sin esto la guía parpadea.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver((current) => (current?.id === id ? null : current));
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        const source = draggingId;
        const side = over?.id === id ? over.side : "before";
        if (source && source !== id) onReorder(source, id, side === "before");
        clear();
      },
    }),

    dropSideFor: (id) => (draggingId && over?.id === id ? over.side : null),
  };
}
