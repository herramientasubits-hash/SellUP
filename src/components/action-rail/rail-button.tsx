"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRailIsVertical, useRailPopoutSide } from "./rail-preferences";

/** Retardo entre una acción y la siguiente al entrar escalonadas. */
const STAGGER_STEP_MS = 100;

/** Clases del botón-icono de la barra (40×40); las comparten todos sus botones. */
export function railIconButtonClass(tone: "default" | "danger", isActive = false): string {
  return cn(
    "su-dock-item relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5",
    "focus-visible:outline-none focus-visible:ring-2",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent",
    tone === "danger"
      ? "text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/40"
      : "text-nav-foreground/60 hover:bg-nav-foreground/10 hover:text-nav-foreground focus-visible:ring-nav-foreground/30 aria-disabled:hover:text-nav-foreground/60",
    isActive && (tone === "danger" ? "bg-destructive/15" : "bg-nav-foreground/10 text-nav-foreground"),
  );
}

/**
 * Una acción de icono dentro de la barra flotante.
 *
 * La comparten todas las barras para que un botón sea el mismo objeto en
 * cualquier pantalla: una acción que se ve o se apaga distinto según la barra
 * que la contiene es un defecto que el ojo pilla antes que el código.
 *
 * Bloqueada no usa `disabled` sino `aria-disabled`: así sigue recibiendo el
 * cursor y el tooltip puede explicar por qué no se puede ahora.
 *
 * @example
 * <RailButton icon={<Download />} label="Exportar" onClick={exportRows} />
 */
export function RailButton({
  icon,
  label,
  onClick,
  blockedReason = null,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  /** Explica por qué la acción no está disponible; con valor, el botón se apaga. */
  blockedReason?: string | null;
  tone?: "default" | "danger";
}) {
  const isBlocked = blockedReason != null;
  const side = useRailPopoutSide();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={isBlocked ? undefined : onClick}
            aria-disabled={isBlocked || undefined}
            aria-label={label}
            className={railIconButtonClass(tone)}
          >
            {icon}
          </button>
        }
      />
      <TooltipContent side={side} className="max-w-56">
        {blockedReason ?? label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Una entrada del popover de creación de la barra: icono, título y una línea
 * de por qué. `variant="ai"` pinta su icono con el degradado de marca de IA.
 *
 * @example
 * <RailCreateOption icon={<Upload />} title="Importar archivo" description="Sube un CSV o Excel" onClick={openImport} />
 */
export function RailCreateOption({
  icon,
  title,
  description,
  onClick,
  variant = "default",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  variant?: "default" | "ai";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-nav-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30"
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors [&_svg]:size-5",
          variant === "ai"
            ? "su-ai-gradient"
            : "bg-nav-foreground/5 text-nav-foreground/60 group-hover:bg-nav-foreground/10 group-hover:text-nav-foreground",
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-bold tracking-tight text-nav-foreground">{title}</span>
        <span className="text-xs font-medium text-nav-foreground/60">{description}</span>
      </span>
    </button>
  );
}

/**
 * Entrada escalonada de una acción, que se vuelve a disparar cada vez que
 * cambia `animKey` (la barra cambió de contexto). Además de entrar, la acción
 * destella en el color de marca; `skipColorFlash` lo apaga para divisorias y
 * rótulos, que no deben brillar al llegar.
 *
 * Con «reducir movimiento» no hay entrada ni destello.
 */
export function AnimatedActionItem({
  animKey,
  staggerIndex,
  skipColorFlash = false,
  children,
}: {
  animKey: number;
  staggerIndex: number;
  skipColorFlash?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      key={animKey}
      className={cn(
        "flex items-center rounded-xl",
        skipColorFlash ? "su-rail-item self-stretch" : "su-rail-item su-rail-item-flash",
      )}
      style={{ "--su-rail-delay": `${staggerIndex * STAGGER_STEP_MS}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

interface RailPrimaryActionProps extends React.ComponentPropsWithoutRef<"button"> {
  icon: React.ReactNode;
  label: string;
  /** `ai` conserva el degradado de marca de las acciones de IA. */
  variant?: "default" | "ai";
  /** Explica por qué no se puede ahora; con valor, el botón se apaga. */
  blockedReason?: string | null;
}

/**
 * La única llamada a la acción rellena que se permite una barra: «Crear
 * empresa», «Buscar contactos con IA».
 *
 * De pie, la barra mide un icono de ancho y las palabras no caben: el rótulo
 * pasa a un tooltip y el botón queda cuadrado como sus vecinos. Sigue siendo
 * del color primario: perder el rótulo no debe hacer perder a qué botón
 * apunta la pantalla.
 *
 * Reenvía su ref y las props sobrantes para poder ir dentro de un
 * `PopoverTrigger render={…}`.
 *
 * @example
 * <RailPrimaryAction icon={<Plus />} label="Crear empresa" onClick={openCreate} />
 */
export const RailPrimaryAction = React.forwardRef<HTMLButtonElement, RailPrimaryActionProps>(
  function RailPrimaryAction(
    { icon, label, variant = "default", blockedReason = null, className, onClick, ...props },
    ref,
  ) {
    const isVertical = useRailIsVertical();
    const side = useRailPopoutSide();
    const isBlocked = blockedReason != null;

    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-disabled={isBlocked || undefined}
        data-variant={variant}
        onClick={isBlocked ? undefined : onClick}
        className={cn(
          "relative flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-transform [&_svg]:size-4",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/30 active:scale-95",
          "aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:active:scale-100 motion-reduce:transition-none",
          variant === "ai" ? "su-ai-gradient" : "bg-primary text-primary-foreground hover:bg-primary/90",
          isVertical ? "w-10 px-0" : "px-4",
          className,
        )}
        {...props}
      >
        {icon}
        {!isVertical && label}
      </button>
    );

    if (!isVertical && !isBlocked) return button;

    return (
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent side={side} className="max-w-56">
          {blockedReason ?? label}
        </TooltipContent>
      </Tooltip>
    );
  },
);
