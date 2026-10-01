"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Retardo entre una acción y la siguiente al entrar escalonadas. */
const STAGGER_STEP_MS = 60;

/** Clases del botón-icono de la barra; las comparte `RailConfirmButton`. */
export function railIconButtonClass(tone: "default" | "danger", isActive = false): string {
  return cn(
    "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors [&_svg]:size-5",
    "focus-visible:outline-none focus-visible:ring-2",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent",
    tone === "danger"
      ? "text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/40"
      : "text-nav-foreground/70 hover:bg-nav-foreground/10 hover:text-nav-foreground focus-visible:ring-nav-foreground/30",
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
      <TooltipContent side="top">{blockedReason ?? label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Una entrada del popover de creación de la barra: icono, título y una línea
 * de por qué.
 *
 * @example
 * <RailCreateOption icon={<Upload />} title="Importar" description="Desde un archivo CSV" onClick={openImport} />
 */
export function RailCreateOption({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-md p-2.5 text-left transition-colors hover:bg-nav-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-nav-foreground/5 text-nav-foreground/70 transition-colors group-hover:bg-nav-foreground/10 group-hover:text-nav-foreground [&_svg]:size-5">
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
 * Entrada escalonada de una acción contextual, que se vuelve a disparar cada
 * vez que cambia `animKey`.
 *
 * En Thema la acción además destella en el color primario al llegar
 * (`skipColorFlash` lo apaga para divisorias y rótulos). SellUp solo anima
 * `transform`/`opacity` con `animate-su-scale-in`, así que la prop se acepta
 * por paridad y no cambia nada.
 */
export function AnimatedActionItem({
  animKey,
  staggerIndex,
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
      className="flex items-center self-stretch animate-su-scale-in motion-reduce:animate-none"
      style={{ animationDelay: `${staggerIndex * STAGGER_STEP_MS}ms` }}
    >
      {children}
    </div>
  );
}

/**
 * La única llamada a la acción rellena que se permite una barra: «Nuevo lote»,
 * «Importar cuentas».
 *
 * Reenvía su ref y las props sobrantes para poder ir dentro de un
 * `PopoverTrigger render={…}`.
 *
 * @example
 * <RailPrimaryAction icon={<Plus />} label="Nuevo lote" onClick={createBatch} />
 */
export const RailPrimaryAction = React.forwardRef<
  HTMLButtonElement,
  { icon: React.ReactNode; label: string } & React.ComponentPropsWithoutRef<"button">
>(function RailPrimaryAction({ icon, label, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "relative flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform [&_svg]:size-4",
        "hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/30 active:scale-95",
        "disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      {icon}
      {label}
    </button>
  );
});
