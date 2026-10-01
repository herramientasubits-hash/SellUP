"use client";

import * as React from "react";
import type { LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { railButtonClass } from "./confirm-action-popover";
import { RailOrientationContext, useRailAutoHide } from "./rail-preferences";
import { RailSettingsMenu } from "./rail-settings-menu";

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
   * Mantiene la barra abierta pese a la preferencia de auto-ocultar. Los pasos
   * lo encienden cuando hay algo pendiente que solo se arregla desde aquí: un
   * aviso que desaparece mientras alguien alarga la mano hacia él no es un
   * aviso.
   */
  keepOpen?: boolean;
  /** Recoge y bloquea la barra: no hay nada seguro que hacer todavía. */
  isBlocked?: boolean;
  /**
   * Deja solo `actions` en la barra: sin ajustes, sin pista ni herramientas.
   * Para cuando lo único seguro es decidir entre esas acciones, como al
   * revisar una propuesta de IA.
   */
  minimal?: boolean;
}

/** Margen antes de recogerse, para que un roce fuera del borde no la cierre. */
const COLLAPSE_DELAY_MS = 150;

function Divider() {
  return <div aria-hidden className="mx-1 my-2 w-px self-stretch bg-nav-foreground/10" />;
}

/**
 * La barra flotante del drawer.
 *
 * Un pie fijo con dos botones deja de leerse como un pie cuando el paso crece
 * y pide más: recalcular, resolver un conflicto, volver atrás. Esas acciones
 * pasan al mismo dock oscuro que usa la pantalla por detrás: se recoge en una
 * pastilla cuando no se usa, vuelve al pasar el cursor y respeta la misma
 * preferencia de auto-ocultar que la barra de la pantalla, porque para quien
 * la usa es la misma barra.
 *
 * Vive en la franja del pie y no encima del contenido: así nada queda tapado
 * y la altura de la lista no salta cuando la barra se recoge. Se monta como
 * último hijo del cuerpo del drawer (no usa portal).
 *
 * Diferencia con Thema: aquí no lleva asa de arrastre. El panel de SellUp
 * entra con `transform`, que ancla `position: fixed` al propio panel; una
 * posición guardada en coordenadas de la ventana dejaría la barra fuera de él.
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
  keepOpen = false,
  isBlocked = false,
  minimal = false,
}: DrawerActionRailProps) {
  const [autoHide] = useRailAutoHide();
  const [isHovered, setIsHovered] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const collapseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  if (isBlocked && isHovered) setIsHovered(false);

  const clearCollapseTimer = React.useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = null;
  }, []);

  React.useEffect(() => clearCollapseTimer, [clearCollapseTimer]);

  const expand = () => {
    if (isBlocked) return;
    clearCollapseTimer();
    setIsHovered(true);
  };

  const scheduleCollapse = () => {
    clearCollapseTimer();
    collapseTimer.current = setTimeout(() => setIsHovered(false), COLLAPSE_DELAY_MS);
  };

  const isExpanded = !isBlocked && (!autoHide || keepOpen || isHovered || isSettingsOpen);

  const hasHint = !minimal && Boolean(hint);
  const hasTools = !minimal && Boolean(tools);
  const hasActions = actions != null;
  const pillClass = "block h-1.5 w-16 shrink-0 rounded-full bg-border-strong shadow-card";

  return (
    <RailOrientationContext.Provider value="horizontal">
      <div
        data-slot="drawer-action-rail"
        data-state={isBlocked ? "blocked" : isExpanded ? "expanded" : "collapsed"}
        className="pointer-events-none relative flex h-18 shrink-0 items-end justify-center bg-linear-to-t from-background via-background/90 to-transparent px-4 pb-3"
      >
        <div
          className={cn(
            "relative flex flex-col items-center justify-end",
            isBlocked ? "pointer-events-none" : "pointer-events-auto",
          )}
          onMouseEnter={expand}
          onMouseLeave={scheduleCollapse}
          onFocus={expand}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) scheduleCollapse();
          }}
        >
          {!isExpanded &&
            (isBlocked ? (
              <div aria-hidden className={pillClass} />
            ) : (
              <button
                type="button"
                aria-label="Mostrar la barra de acciones"
                onClick={expand}
                className={cn(
                  pillClass,
                  "animate-su-scale-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:animate-none",
                )}
              />
            ))}

          <div className={cn(isExpanded ? "relative" : "pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2")}>
            <div
              role="toolbar"
              aria-label="Acciones del panel"
              aria-hidden={isExpanded ? undefined : true}
              inert={!isExpanded}
              data-state={isExpanded ? "expanded" : "collapsed"}
              data-orientation="horizontal"
              className="su-rail-bar flex h-14 w-max max-w-full items-center gap-2 rounded-3xl border border-primary/15 bg-nav px-3 text-nav-foreground shadow-rail"
            >
              {!minimal && (
                <>
                  <RailSettingsMenu onOpenChange={setIsSettingsOpen} />
                  {(hasHint || hasTools || hasActions) && <Divider />}
                </>
              )}

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
          </div>
        </div>
      </div>
    </RailOrientationContext.Provider>
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
