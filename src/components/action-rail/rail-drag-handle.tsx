"use client";

import * as React from "react";
import { GripHorizontal, GripVertical } from "@/icons";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRailIsVertical, useRailPopoutSide } from "./rail-preferences";

interface RailDragHandleProps {
  isDragging: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
}

/**
 * El asa de la barra flotante: aparece siempre que la barra está abierta.
 * Arrastrarla la mueve a cualquier punto de la pantalla; un doble clic la
 * devuelve a su sitio.
 *
 * @example
 * const { isDragging, gripHandlers } = useDraggableRail();
 * <RailDragHandle isDragging={isDragging} {...gripHandlers} />
 */
export function RailDragHandle({
  isDragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
}: RailDragHandleProps) {
  const isVertical = useRailIsVertical();
  const side = useRailPopoutSide();
  // Las barras del asa cruzan la barra, no la siguen: como un tirador de
  // verdad, que va atravesado a lo que mueve.
  const GripIcon = isVertical ? GripHorizontal : GripVertical;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Mover barra de acciones"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={onDoubleClick}
            style={{ touchAction: "none" }}
            className={cn(
              "su-dock-item flex h-10 w-10 shrink-0 cursor-grab select-none items-center justify-center rounded-xl text-nav-foreground/40 hover:bg-nav-foreground/10 hover:text-nav-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30 active:cursor-grabbing",
              isDragging && "cursor-grabbing bg-nav-foreground/10 text-nav-foreground/70",
            )}
          >
            <GripIcon className="size-5" strokeWidth={2} aria-hidden="true" />
          </button>
        }
      />
      <TooltipContent side={side}>Arrastra para mover · doble clic para volver a su sitio</TooltipContent>
    </Tooltip>
  );
}
