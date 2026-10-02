import type { ReactNode } from "react";
import type { LucideIcon } from "@/icons";
import { cn } from "@/lib/utils";

export type DrawerSectionTone =
  | "brand"
  | "positive"
  | "warning"
  | "negative"
  | "neutral";

/** El tinte del chip del icono por tono. Lo comparte la sección plegable. */
export const DRAWER_SECTION_TONE_CHIP: Record<DrawerSectionTone, string> = {
  brand: "bg-primary/10 text-primary",
  positive: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  negative: "bg-destructive/10 text-destructive",
  neutral: "bg-surface-muted text-muted-foreground",
};

interface DrawerSectionProps {
  title: string;
  /** Una línea que explica para qué sirve el grupo. */
  hint?: string;
  icon?: LucideIcon;
  tone?: DrawerSectionTone;
  /** Un dato al vuelo sobre lo que hay dentro (p. ej. "3 contactos"). */
  badge?: ReactNode;
  /** Acción que opera sobre el contenido, alineada a la derecha del título. */
  action?: ReactNode;
  /** Solo layout: cómo participa la tarjeta en su panel. Nunca color ni borde. */
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

/**
 * DrawerSection — un grupo de contenido de un drawer como tarjeta: el chip de
 * su icono en su tono, el título, la línea que explica para qué sirve y, bajo
 * una divisoria, lo que contenga.
 *
 * Es la unidad con la que se arman los paneles laterales (patrón Thema
 * `overlays/DrawerSection`) para que todos se lean como el mismo sistema. Lo
 * que cambia entre sitios es el icono, el tono y el texto; nunca la anatomía.
 *
 * @see docs/DESIGN_SYSTEM_FOUNDATION.md § 11 — Drawer con Tabs
 */
export function DrawerSection({
  title,
  hint,
  icon: Icon,
  tone = "brand",
  badge,
  action,
  className,
  contentClassName,
  children,
}: DrawerSectionProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border/60 bg-card p-4 shadow-card",
        className,
      )}
    >
      <header className="flex items-start gap-2.5 border-b border-border/50 pb-3">
        {Icon && (
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-border/40",
              DRAWER_SECTION_TONE_CHIP[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </h3>
            {badge && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {badge}
              </span>
            )}
          </div>
          {hint && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={cn("pt-3.5", contentClassName)}>{children}</div>
    </section>
  );
}
