"use client";

import * as React from "react";
import { ChevronDown, type LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";
import {
  DRAWER_SECTION_TONE_CHIP,
  type DrawerSectionTone,
} from "@/components/shared/drawer-section";

interface CollapsibleDrawerSectionProps {
  title: string;
  icon?: LucideIcon;
  tone?: DrawerSectionTone;
  /**
   * Una línea que dice qué hay dentro («acme.co · con LinkedIn · 250
   * empleados»). Se lee con la sección plegada: es lo que permite decidir si
   * vale la pena abrirla.
   */
  summary?: React.ReactNode;
  /** Para qué sirve el grupo. Se lee con la sección abierta. */
  hint?: string;
  /** Un contador de lo que hay dentro (p. ej. `3`). */
  badge?: React.ReactNode;
  /** Abierta de entrada. Por defecto, plegada. */
  defaultOpen?: boolean;
  /** Solo layout: cómo participa la tarjeta en su panel. */
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

/**
 * CollapsibleDrawerSection — una `DrawerSection` que se pliega. Misma tarjeta,
 * mismo chip de icono y mismo título; la cabecera entera es el botón que la
 * abre y la cierra.
 *
 * Sustituye al patrón «rótulo plegable + tarjeta con el mismo título dentro»,
 * que enseñaba el nombre de la sección dos veces. Aquí hay UN título, y la
 * sección plegada no es una fila muda: su `summary` (o su contador) adelanta
 * lo que contiene.
 *
 * El contenido solo se monta cuando está abierta.
 *
 * @example
 * <CollapsibleDrawerSection
 *   title="Datos comerciales y web"
 *   icon={Globe}
 *   summary="acme.co · con LinkedIn · 250 empleados"
 *   defaultOpen={hasWebsite}
 * >
 *   …
 * </CollapsibleDrawerSection>
 */
export function CollapsibleDrawerSection({
  title,
  icon: Icon,
  tone = "brand",
  summary,
  hint,
  badge,
  defaultOpen = false,
  className,
  contentClassName,
  children,
}: CollapsibleDrawerSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const contentId = React.useId();
  // Plegada manda el resumen; abierta, la explicación. Si solo hay uno de los
  // dos, se usa ese en los dos estados.
  const line = open ? (hint ?? null) : (summary ?? hint ?? null);

  return (
    <section
      data-slot="collapsible-drawer-section"
      data-state={open ? "open" : "closed"}
      className={cn("rounded-2xl border border-border/60 bg-card shadow-card", className)}
    >
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-start gap-2.5 rounded-2xl p-4 text-left outline-none transition-colors hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {Icon && (
            <span
              aria-hidden
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-border/40",
                DRAWER_SECTION_TONE_CHIP[tone],
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold leading-tight tracking-tight text-foreground">
                {title}
              </span>
              {badge !== undefined && badge !== null && (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                  {badge}
                </span>
              )}
            </span>
            {line && (
              <span
                data-slot="collapsible-drawer-section-line"
                className={cn(
                  "mt-0.5 block text-xs font-normal leading-relaxed text-muted-foreground",
                  !open && "truncate",
                )}
              >
                {line}
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "mt-1 size-4 shrink-0 text-text-muted transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </h3>
      {open && (
        <div id={contentId} className={cn("border-t border-border/50 px-4 pb-4 pt-3.5", contentClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
