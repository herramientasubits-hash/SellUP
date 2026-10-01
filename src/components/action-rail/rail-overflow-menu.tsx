"use client";

import * as React from "react";
import { ChevronRight, MoreHorizontal } from "@/icons";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { railIconButtonClass } from "./rail-button";
import { useRailIsVertical, useRailPopoutSide } from "./rail-preferences";
import { RAIL_POPOVER_CLASS } from "./rail-settings-menu";

export interface RailOverflowSubItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "danger";
  /** Explica por qué el ítem no está disponible; con valor, la fila se apaga. */
  blockedReason?: string | null;
}

export interface RailOverflowItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "danger";
  /** Explica por qué el ítem no está disponible; con valor, la fila se apaga. */
  blockedReason?: string | null;
  /**
   * Con valor, la fila se abre hacia estos en vez de ejecutar `onClick`:
   * «Exportar» pasa a ser «Exportar CSV» / «Exportar a HubSpot» en lugar de
   * una sola suposición sobre lo que se quería.
   */
  subItems?: readonly RailOverflowSubItem[];
}

const ROW_CLASS =
  "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

function RowBody({
  icon,
  label,
  tone = "default",
  hasSubItems = false,
  hint = null,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "danger";
  hasSubItems?: boolean;
  /** Por qué está apagada: se lee bajo el rótulo, sin depender del cursor. */
  hint?: string | null;
}) {
  return (
    <>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:size-4",
          tone === "danger"
            ? "bg-destructive/10 text-destructive"
            : "bg-nav-foreground/5 text-nav-foreground/70 group-hover:bg-nav-foreground/10 group-hover:text-nav-foreground",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "text-sm font-semibold tracking-tight",
            tone === "danger" ? "text-destructive" : "text-nav-foreground",
          )}
        >
          {label}
        </span>
        {hint && <span className="text-xs font-medium text-nav-foreground/70">{hint}</span>}
      </span>
      {hasSubItems && (
        <ChevronRight className="ml-auto size-4 shrink-0 text-nav-foreground/40" strokeWidth={2} />
      )}
    </>
  );
}

/**
 * Las acciones que no cupieron en la barra, detrás de un «⋯».
 *
 * Conservan el orden que tenían en la lista completa en vez de reordenarse por
 * importancia: quien sabe que una acción va después de otra la encuentra en el
 * mismo sitio, haya caído en la barra o aquí. Los rótulos van escritos, porque
 * la razón de plegarlas es que un sexto icono deja de reconocerse a la vista.
 *
 * @example
 * <RailOverflowMenu
 *   items={[
 *     { id: "columns", label: "Configurar columnas", icon: <Columns3 />, onClick: openColumns },
 *     { id: "archive", label: "Archivar", icon: <Archive />, tone: "danger", onClick: archive },
 *   ]}
 * />
 */
export function RailOverflowMenu({
  items,
  label = "Más acciones",
  icon,
  onOpenChange,
}: {
  items: readonly RailOverflowItem[];
  label?: string;
  /**
   * El icono del disparador. Por defecto el «⋯» de «Más acciones»; un menú que
   * agrupa un solo tema dice más con el icono de ese tema que con los tres
   * puntos.
   */
  icon?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const isVertical = useRailIsVertical();
  const side = useRailPopoutSide();

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  if (items.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button type="button" aria-label={label} className={railIconButtonClass("default", open)}>
                  {icon ?? <MoreHorizontal strokeWidth={2} />}
                </button>
              }
            />
          }
        />
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>

      <PopoverContent
        align={isVertical ? "center" : "end"}
        side={side}
        sideOffset={16}
        className={cn("w-64", RAIL_POPOVER_CLASS)}
      >
        {items.map((item) => {
          const isBlocked = item.blockedReason != null;
          const rowClassName = cn(
            ROW_CLASS,
            item.tone === "danger" ? "hover:bg-destructive/15" : "hover:bg-nav-foreground/5",
          );

          if (item.subItems) {
            return (
              <Popover key={item.id}>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      disabled={isBlocked}
                      aria-label={item.label}
                      className={rowClassName}
                    >
                      <RowBody icon={item.icon} label={item.label} tone={item.tone} hint={item.blockedReason} hasSubItems />
                    </button>
                  }
                />
                <PopoverContent
                  align="start"
                  side={isVertical ? "left" : "right"}
                  sideOffset={8}
                  className={cn("w-56", RAIL_POPOVER_CLASS)}
                >
                  {item.subItems.map((subItem) => (
                    <button
                      key={subItem.id}
                      type="button"
                      disabled={subItem.blockedReason != null}
                      aria-label={subItem.label}
                      title={subItem.blockedReason ?? undefined}
                      onClick={() => {
                        handleOpenChange(false);
                        subItem.onClick();
                      }}
                      className={cn(
                        ROW_CLASS,
                        subItem.tone === "danger" ? "hover:bg-destructive/15" : "hover:bg-nav-foreground/5",
                      )}
                    >
                      <RowBody icon={subItem.icon} label={subItem.label} tone={subItem.tone} hint={subItem.blockedReason} />
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              disabled={isBlocked}
              aria-label={item.label}
              title={item.blockedReason ?? undefined}
              onClick={() => {
                handleOpenChange(false);
                item.onClick();
              }}
              className={rowClassName}
            >
              <RowBody icon={item.icon} label={item.label} tone={item.tone} hint={item.blockedReason} />
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
