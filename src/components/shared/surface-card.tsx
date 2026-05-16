import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SurfaceCardProps {
  children: ReactNode;
  className?: string;
  /** Fondo elevado — útil para cards anidadas o highlights */
  elevated?: boolean;
  /** Sin padding interno */
  noPadding?: boolean;
}

export function SurfaceCard({
  children,
  className,
  elevated = false,
  noPadding = false,
}: SurfaceCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border transition-all duration-200",
        elevated
          ? "border-su-border-strong/60 bg-su-surface-elevated shadow-md shadow-black/[0.05]"
          : "border-border/50 bg-card shadow-[0_1px_3px_0_rgb(0_0_0/0.03),0_1px_2px_-1px_rgb(0_0_0/0.03)]",
        "hover:shadow-[0_4px_12px_0_rgb(0_0_0/0.05),0_1px_3px_-1px_rgb(0_0_0/0.04)]",
        "hover:border-border/70",
        !noPadding && "p-5",
        className,
      )}
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
        <h2 className="text-[0.8125rem] font-semibold leading-none text-foreground font-heading">
          {title}
        </h2>
        {description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
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
