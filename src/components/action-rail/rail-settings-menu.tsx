"use client";

import * as React from "react";
import { Check, Minimize2, PanelBottom, PanelRight, Pin, RotateCcw, Settings } from "@/icons";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { railIconButtonClass } from "./rail-button";
import {
  useRailAutoHide,
  useRailOrientation,
  useRailPopoutSide,
  useRailPosition,
} from "./rail-preferences";

/** El panel oscuro que despliegan los menús de la barra. */
export const RAIL_POPOVER_CLASS =
  "rounded-2xl border-primary/15 bg-nav p-2 text-nav-foreground shadow-rail";

/**
 * Las preferencias de la propia barra —cómo se comporta y hacia dónde se
 * tiende— detrás de un solo botón.
 *
 * Van agrupadas en vez de sueltas porque no son acciones sobre el contenido de
 * la pantalla: nada de aquí toca una empresa ni un contacto. Así la barra no
 * gasta dos de sus pocos huecos en ajustes, y cada opción tiene sitio para un
 * rótulo.
 *
 * Lo elegido se recuerda en este navegador y vale para todas las pantallas.
 *
 * @example
 * <RailSettingsMenu onOpenChange={setIsSettingsOpen} />
 */
export function RailSettingsMenu({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [autoHide, setAutoHide] = useRailAutoHide();
  const [orientation, setOrientation] = useRailOrientation();
  const [position, setPosition] = useRailPosition();
  const [open, setOpen] = React.useState(false);
  const side = useRailPopoutSide();

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button type="button" aria-label="Ajustes de la barra" className={railIconButtonClass("default", open)}>
                  <Settings strokeWidth={2} aria-hidden="true" />
                </button>
              }
            />
          }
        />
        <TooltipContent side={side}>Ajustes de la barra</TooltipContent>
      </Tooltip>

      <PopoverContent align="center" side={side} sideOffset={16} className={cn("w-60", RAIL_POPOVER_CLASS)}>
        <SettingGroup label="Orientación">
          <ChoiceRow
            icon={<PanelBottom strokeWidth={2} />}
            label="Horizontal"
            isActive={orientation === "horizontal"}
            onClick={() => setOrientation("horizontal")}
          />
          <ChoiceRow
            icon={<PanelRight strokeWidth={2} />}
            label="Vertical"
            isActive={orientation === "vertical"}
            onClick={() => setOrientation("vertical")}
          />
        </SettingGroup>

        <SettingGroup label="Visibilidad" className="mt-1.5">
          <ChoiceRow
            icon={<Pin strokeWidth={2} />}
            label="Mantener abierta"
            isActive={!autoHide}
            onClick={() => setAutoHide(false)}
          />
          <ChoiceRow
            icon={<Minimize2 strokeWidth={2} />}
            label="Ocultar sola"
            isActive={autoHide}
            onClick={() => setAutoHide(true)}
          />
        </SettingGroup>

        <SettingGroup label="Posición" className="mt-1.5">
          <button
            type="button"
            disabled={position === null}
            onClick={() => {
              setPosition(null);
              handleOpenChange(false);
            }}
            className={cn(ROW_CLASS, "hover:bg-nav-foreground/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent")}
          >
            <span className={cn(TILE_CLASS, "bg-nav-foreground/5 text-nav-foreground/70")}>
              <RotateCcw strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-nav-foreground/80">Volver a su sitio</span>
          </button>
        </SettingGroup>
      </PopoverContent>
    </Popover>
  );
}

const ROW_CLASS =
  "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30";

const TILE_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:size-4";

function SettingGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={className}>
      <p className="px-2.5 pb-1 pt-1 text-xs font-semibold text-nav-foreground/50">{label}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

/**
 * Una opción de una elección entre dos, con la misma anatomía de fila que el
 * menú «más acciones». Las dos quedan a la vista con la elegida marcada, en
 * vez de un botón que cambia de significado al pulsarlo.
 */
function ChoiceRow({
  icon,
  label,
  isActive,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(ROW_CLASS, isActive ? "bg-nav-foreground/5" : "hover:bg-nav-foreground/5")}
    >
      <span
        className={cn(
          TILE_CLASS,
          isActive
            ? "bg-primary/25 text-nav-foreground"
            : "bg-nav-foreground/5 text-nav-foreground/70 group-hover:bg-nav-foreground/10 group-hover:text-nav-foreground",
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "text-sm font-semibold tracking-tight",
          isActive ? "text-nav-foreground" : "text-nav-foreground/70",
        )}
      >
        {label}
      </span>
      {isActive && <Check className="ml-auto size-4 shrink-0 text-nav-foreground" strokeWidth={2.5} aria-hidden="true" />}
    </button>
  );
}
