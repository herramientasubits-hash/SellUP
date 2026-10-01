"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { railButtonClass } from "./confirm-action-popover";

interface DrawerActionRailProps {
  /** Dónde está el paso ahora mismo, en una línea. */
  hint?: React.ReactNode;
  /** Acciones puntuales del paso: recalcular, resolver un conflicto. */
  tools?: React.ReactNode;
  /**
   * Lo que cierra el paso: continuar, guardar. `null` cuando las acciones
   * dependen de una selección y no hay nada marcado: el grupo y su divisoria
   * se caen del todo en vez de quedarse montados y apagados.
   */
  actions: React.ReactNode;
  /**
   * En Thema mantiene la barra abierta pese al auto-ocultar. SellUp no porta
   * el auto-ocultar; se acepta solo por paridad de props.
   */
  keepOpen?: boolean;
  /** Recoge y bloquea la barra: no hay nada seguro que hacer todavía. */
  isBlocked?: boolean;
  /**
   * Deja solo `actions` en la barra: sin pista ni herramientas. Para cuando lo
   * único seguro es decidir entre esas acciones, como al revisar una propuesta
   * de IA.
   */
  minimal?: boolean;
}

function Divider() {
  return <div aria-hidden className="mx-1 my-2 w-px self-stretch bg-nav-foreground/10" />;
}

/**
 * La barra flotante del drawer.
 *
 * Un pie fijo con dos botones deja de leerse como un pie cuando el paso crece
 * y pide más: recalcular, resolver un conflicto, volver atrás. Esas acciones
 * pasan al mismo dock oscuro que usa la pantalla por detrás, porque para quien
 * lo usa es la misma barra.
 *
 * Vive en la franja del pie y no encima del contenido: así nada queda tapado.
 * Se monta como último hijo del cuerpo del drawer (no usa portal).
 *
 * @example
 * <DrawerShell open={open} onOpenChange={setOpen} title="Revisar prospecto">
 *   <div className="flex-1 overflow-y-auto">…</div>
 *   <DrawerActionRail
 *     hint="3 de 12 por revisar"
 *     actions={
 *       <>
 *         <DrawerRailButton icon={X} label="Descartar" variant="danger" onClick={discard} />
 *         <DrawerRailButton icon={Check} label="Aprobar" variant="primary" onClick={approve} />
 *       </>
 *     }
 *   />
 * </DrawerShell>
 */
export function DrawerActionRail({
  hint,
  tools,
  actions,
  isBlocked = false,
  minimal = false,
}: DrawerActionRailProps) {
  const hasHint = !minimal && Boolean(hint);
  const hasTools = !minimal && Boolean(tools);
  const hasActions = actions != null;

  return (
    <div className="pointer-events-none relative flex h-18 shrink-0 items-end justify-center bg-linear-to-t from-background via-background/90 to-transparent px-4 pb-3">
      {isBlocked ? (
        <div aria-hidden className="h-1.5 w-16 rounded-full bg-border shadow-card" />
      ) : (
        <div
          role="toolbar"
          aria-label="Acciones del panel"
          className="pointer-events-auto flex h-14 w-max max-w-full items-center gap-2 rounded-3xl bg-nav px-3 text-nav-foreground shadow-rail ring-1 ring-white/10"
        >
          {hasHint && (
            <span className="max-w-[34ch] truncate px-1 text-xs font-medium text-nav-foreground/70">{hint}</span>
          )}

          {hasTools && (
            <>
              {hasHint && <Divider />}
              <div className="flex items-center gap-1.5">{tools}</div>
            </>
          )}

          {hasActions && (hasHint || hasTools) && <Divider />}
          {hasActions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Un botón de la barra del drawer: mismo lenguaje oscuro que el dock de la
 * pantalla.
 *
 * `iconOnly` lo reduce a un cuadrado con el rótulo movido a un tooltip en vez
 * de perderse: sigue siendo el mismo botón, solo que sin sitio para la palabra.
 *
 * @example
 * <DrawerRailButton icon={Check} label="Aprobar" variant="primary" onClick={approve} />
 */
export function DrawerRailButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = "ghost",
  iconOnly = false,
}: {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "ghost" | "primary" | "warning" | "danger";
  iconOnly?: boolean;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={railButtonClass(variant, iconOnly)}
    >
      {Icon && <Icon className="size-4" strokeWidth={2.2} aria-hidden="true" />}
      {!iconOnly && label}
    </button>
  );

  if (!iconOnly) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
