"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { railIconButtonClass } from "./rail-button";
import { useRailPopoutSide } from "./rail-preferences";

export type ConfirmTone = "destructive" | "warning" | "primary";

/**
 * El sí/no de una acción de la barra, anclado al botón que la pide.
 *
 * Para una decisión sobre lo que ya está marcado —el contexto está bajo el
 * dedo que la pidió— un diálogo centrado con velo es más caja de la que la
 * pregunta necesita. Un popover se abre pegado al botón, no le quita la vista
 * a la tabla que explica la decisión, y se cierra como cualquier otro popover:
 * clic afuera, Escape o su propio botón.
 *
 * Vive aquí y no dentro de una barra concreta porque todas tienen que
 * preguntar igual: dos confirmaciones con distinta forma sobre la misma acción
 * se leen como dos acciones distintas. Para lo irreversible de verdad sigue
 * estando `ConfirmDialog` (`@/components/shared/confirm-dialog`).
 *
 * @example
 * <ConfirmActionPopover
 *   open={isAsking}
 *   onOpenChange={setIsAsking}
 *   trigger={<button type="button" className={railButtonClass("danger", false)}>Descartar</button>}
 *   title="¿Descartar 3 prospectos?"
 *   description="Pasan a Descartadas y dejan de contar para la meta."
 *   confirmLabel="Descartar"
 *   tone="destructive"
 *   onConfirm={discard}
 * />
 */
export function ConfirmActionPopover({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  tone,
  onConfirm,
  side,
  tooltip,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El botón al que se ancla. Un solo elemento: va por `render`. */
  trigger: React.ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  tone: ConfirmTone;
  onConfirm: () => void;
  /** Por defecto, hacia donde la barra tenga sitio. */
  side?: "top" | "right" | "bottom" | "left";
  /** Lo que dice el botón al pasar por encima, cuando es un icono desnudo. */
  tooltip?: React.ReactNode;
}) {
  const railSide = useRailPopoutSide();
  const popoutSide = side ?? railSide;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {tooltip === undefined ? (
        <PopoverTrigger render={trigger} />
      ) : (
        <Tooltip>
          <TooltipTrigger render={<PopoverTrigger render={trigger} />} />
          <TooltipContent side={popoutSide} className="max-w-56">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      )}
      <PopoverContent
        align="center"
        side={popoutSide}
        sideOffset={10}
        className="w-72 rounded-2xl border-primary/15 bg-nav p-3.5 text-nav-foreground shadow-rail"
      >
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-nav-foreground/70">{description}</p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-nav-foreground/70 transition-colors hover:bg-nav-foreground/10 hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30",
              tone === "destructive" && "bg-destructive/15 text-destructive hover:bg-destructive/25",
              tone === "warning" && "bg-warning/15 text-warning hover:bg-warning/25",
              tone === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Las mismas clases del botón del pie de un drawer (`DrawerRailButton`), para
 * el `<button>` crudo que hace de disparador de un popover.
 */
export function railButtonClass(
  variant: "ghost" | "primary" | "warning" | "danger",
  iconOnly: boolean,
): string {
  return cn(
    "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl text-xs font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30 disabled:pointer-events-none disabled:opacity-40",
    iconOnly ? "w-9 justify-center" : "px-3",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
    variant === "warning" && "bg-warning/15 text-warning hover:bg-warning/25",
    variant === "danger" && "bg-destructive/15 text-destructive hover:bg-destructive/25",
    variant === "ghost" && "text-nav-foreground/85 hover:bg-nav-foreground/10 hover:text-nav-foreground",
  );
}

/**
 * Un `RailButton` que en vez de actuar pregunta primero, con la respuesta
 * pegada a él.
 *
 * El disparador lleva tooltip y popover sobre el mismo `<button>`: un botón de
 * la barra es un icono desnudo, y sin su tooltip dejaría de decir qué hace.
 *
 * @example
 * <RailConfirmButton
 *   icon={<Trash2 />}
 *   label="Eliminar"
 *   tone="danger"
 *   open={isAsking}
 *   onOpenChange={setIsAsking}
 *   title="¿Eliminar el lote?"
 *   description="No se puede deshacer."
 *   confirmLabel="Eliminar"
 *   confirmTone="destructive"
 *   onConfirm={remove}
 * />
 */
export function RailConfirmButton({
  icon,
  label,
  tone = "default",
  blockedReason = null,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmTone,
  onConfirm,
}: {
  icon: React.ReactNode;
  label: string;
  /** El color del botón en la barra, no el de la confirmación. */
  tone?: "default" | "danger";
  blockedReason?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone: ConfirmTone;
  onConfirm: () => void;
}) {
  const isBlocked = blockedReason != null;
  const isOpen = open && !isBlocked;

  return (
    <ConfirmActionPopover
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (isBlocked && nextOpen) return;
        onOpenChange(nextOpen);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={confirmTone}
      onConfirm={onConfirm}
      tooltip={blockedReason ?? label}
      trigger={
        <button
          type="button"
          aria-disabled={isBlocked || undefined}
          aria-label={label}
          className={railIconButtonClass(tone, isOpen)}
        >
          {icon}
        </button>
      }
    />
  );
}
