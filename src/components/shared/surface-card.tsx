import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SurfaceCardProps {
  children: ReactNode;
  className?: string;
  /** Fondo elevado — útil para cards anidadas o highlights */
  elevated?: boolean;
  /** Sin padding interno */
  noPadding?: boolean;
  onClick?: () => void;
}

export function SurfaceCard({
  children,
  className,
  elevated = false,
  noPadding = false,
  onClick,
}: SurfaceCardProps) {
  return (
    <div
      className={cn(
        // Thema: una card es una superficie en reposo. Radio 2xl, borde al 60 %
        // y la sombra `card`. Solo se eleva al pasar el puntero si es pulsable:
        // una card estática que reacciona promete una acción que no existe.
        "min-w-0 rounded-2xl border transition-[box-shadow,border-color] duration-200",
        elevated
          ? "border-border bg-su-surface-elevated shadow-drawer"
          : "border-border/60 bg-card shadow-card",
        onClick &&
          "cursor-pointer hover:border-primary/30 hover:shadow-drawer focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        !noPadding && "p-6",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

interface SurfaceCardHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function SurfaceCardHeader({
  title,
  description,
  actions,
  className,
}: SurfaceCardHeaderProps) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0 space-y-1">
        <h2 className="text-base font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
