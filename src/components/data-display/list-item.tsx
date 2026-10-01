"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const ListItemGroupContext = React.createContext(false);

export type ListItemGroupProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * ListItemGroup
 *
 * Contenedor de filas: cada fila es su propia tarjeta (borde + radio),
 * separadas por espacio en vez de un divisor pegado — se leen como filas
 * independientes incluso en listas largas.
 *
 * El grupo no pone padding lateral: las tarjetas llegan hasta donde llegue su
 * contenedor. Quien quiera margen lo pone por fuera.
 */
export function ListItemGroup({ className, children, ...props }: ListItemGroupProps) {
  return (
    <ListItemGroupContext.Provider value={true}>
      <div role="list" data-slot="list-item-group" className={cn("flex flex-col gap-2", className)} {...props}>
        {children}
      </div>
    </ListItemGroupContext.Provider>
  );
}

export interface ListItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "onClick"> {
  /** Avatar o icono a la izquierda. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Texto corto alineado a la derecha: una fecha, un contador. */
  meta?: React.ReactNode;
  /** Botones a la derecha. Quedan fuera del área clicable de la fila. */
  actions?: React.ReactNode;
  /** Convierte la fila en un enlace (`next/link`). */
  href?: string;
  /** Convierte la fila en un botón. Si hay `href`, gana el enlace. */
  onClick?: React.MouseEventHandler<HTMLElement>;
  selected?: boolean;
  size?: "sm" | "default";
}

const SIZE_CLASSES = {
  default: { row: "gap-3 py-3", padX: "px-4" },
  sm: { row: "gap-3 py-2", padX: "px-3" },
} as const;

const TRIGGER_CLASSES =
  "flex min-w-0 flex-1 items-center gap-3 text-left outline-none after:absolute after:inset-0 after:content-['']";

/**
 * ListItem
 *
 * Fila de lista con `leading`, título, descripción, `meta` y acciones. Con `href`
 * u `onClick` la fila entera es clicable (enlace estirado) sin anidar controles:
 * las acciones quedan por encima del área del enlace.
 *
 * @example
 * <ListItemGroup>
 *   <ListItem
 *     href={`/accounts/${account.id}`}
 *     leading={<Avatar>…</Avatar>}
 *     title={account.name}
 *     description={account.industry}
 *     meta="hace 2 h"
 *   />
 * </ListItemGroup>
 */
export function ListItem({
  leading,
  title,
  description,
  meta,
  actions,
  href,
  onClick,
  selected = false,
  size = "default",
  className,
  ...props
}: ListItemProps) {
  const isInGroup = React.useContext(ListItemGroupContext);
  const isInteractive = Boolean(href || onClick);
  const sizing = SIZE_CLASSES[size];

  const text = (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="truncate text-sm leading-tight font-medium text-foreground">{title}</span>
      {description && <span className="truncate text-xs text-muted-foreground">{description}</span>}
    </span>
  );

  return (
    <div
      role={isInGroup ? "listitem" : undefined}
      data-slot="list-item"
      data-selected={selected || undefined}
      data-interactive={isInteractive || undefined}
      className={cn(
        "group/list-item relative flex items-center bg-card transition-colors",
        sizing.row,
        sizing.padX,
        isInGroup && "rounded-lg border border-border/60",
        isInteractive &&
          "hover:border-border hover:bg-surface-subtle has-[[data-slot=list-item-trigger]:focus-visible]:ring-3 has-[[data-slot=list-item-trigger]:focus-visible]:ring-ring/40 has-[[data-slot=list-item-trigger]:focus-visible]:ring-inset",
        selected &&
          "bg-primary/5 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
        className,
      )}
      {...props}
    >
      {href ? (
        <Link
          href={href}
          data-slot="list-item-trigger"
          aria-current={selected ? "true" : undefined}
          onClick={onClick}
          className={TRIGGER_CLASSES}
        >
          {leading}
          {text}
        </Link>
      ) : onClick ? (
        <button
          type="button"
          data-slot="list-item-trigger"
          aria-pressed={selected || undefined}
          onClick={onClick}
          className={TRIGGER_CLASSES}
        >
          {leading}
          {text}
        </button>
      ) : (
        <>
          {leading}
          {text}
        </>
      )}
      {meta && <span className="relative z-10 shrink-0 text-xs tabular-nums text-text-muted">{meta}</span>}
      {actions && <span className="relative z-10 flex shrink-0 items-center gap-1">{actions}</span>}
    </div>
  );
}
