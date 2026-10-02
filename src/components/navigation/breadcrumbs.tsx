"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "@/icons";

import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  /** A dónde lleva este tramo (`next/link`). */
  href?: string;
  /** Alternativa a `href` cuando el tramo no es una ruta (cerrar un panel,
   *  volver a un paso). Si hay `href`, gana el enlace. */
  onClick?: () => void;
  /** Marca este tramo como la página actual. Por defecto lo es el último. */
  active?: boolean;
}

export interface BreadcrumbsProps extends Omit<React.HTMLAttributes<HTMLElement>, "onClick"> {
  /** De la raíz a la página actual. Un string es un tramo sin destino —una
   *  sección sin pantalla propia— y se queda como texto; para que navegue,
   *  pasa `{ label, href }` o `{ label, onClick }`. El tramo actual nunca es
   *  clicable —es la página en la que ya se está—, aunque traiga destino. */
  items: readonly (string | BreadcrumbItem)[];
}

const LINK_CLASSES =
  "rounded-xs text-text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40";

/**
 * Breadcrumbs
 *
 * La ruta de la pantalla dentro del producto, de la raíz a la página actual.
 *
 * @example
 * <Breadcrumbs
 *   items={[
 *     { label: "Catálogo de fuentes", href: "/source-catalog" },
 *     source.name,
 *   ]}
 * />
 */
const Breadcrumbs = React.forwardRef<HTMLElement, BreadcrumbsProps>(
  ({ items, className, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        aria-label="Breadcrumb"
        data-slot="breadcrumbs"
        className={cn("flex flex-wrap items-center gap-1 text-xs", className)}
        {...props}
      >
        {items.map((raw, index) => {
          const item: BreadcrumbItem = typeof raw === "string" ? { label: raw } : raw;
          const isLast = index === items.length - 1;
          const isActive = item.active ?? isLast;

          return (
            <React.Fragment key={`${index}-${item.label}`}>
              {item.href && !isActive ? (
                <Link href={item.href} className={LINK_CLASSES}>
                  {item.label}
                </Link>
              ) : item.onClick && !isActive ? (
                <button type="button" onClick={item.onClick} className={LINK_CLASSES}>
                  {item.label}
                </button>
              ) : (
                <span
                  aria-current={isActive ? "page" : undefined}
                  className={isActive ? "font-medium text-foreground" : "text-text-muted"}
                >
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRight className="size-3 shrink-0 text-text-muted" aria-hidden="true" />}
            </React.Fragment>
          );
        })}
      </nav>
    );
  },
);

Breadcrumbs.displayName = "Breadcrumbs";

export { Breadcrumbs };
