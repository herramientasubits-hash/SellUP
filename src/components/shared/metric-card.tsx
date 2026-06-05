import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DeltaPill, type DeltaDirection, type DeltaTone } from "./delta-pill";

interface MetricCardProps {
  title: string;
  description?: string;
  value: ReactNode;
  subtitle?: ReactNode;
  delta?: number;
  deltaLabel?: string;
  deltaTone?: DeltaTone;
  trendDirection?: DeltaDirection;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  error?: string;
  className?: string;
  valueClassName?: string;
}

function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/40 bg-card p-5 shadow-sm",
        className,
      )}
    >
      <div className="space-y-2">
        <div className="h-3 w-1/2 rounded-md bg-muted/60" />
        <div className="h-3 w-3/4 rounded-md bg-muted/40" />
      </div>
      <div className="mt-5 flex items-baseline gap-2">
        <div className="h-9 w-24 rounded-md bg-muted/60" />
        <div className="h-3 w-12 rounded-md bg-muted/40" />
      </div>
    </div>
  );
}

export function MetricCard({
  title,
  description,
  value,
  subtitle,
  delta,
  deltaLabel,
  deltaTone,
  trendDirection,
  icon,
  actions,
  footer,
  loading = false,
  error,
  className,
  valueClassName,
}: MetricCardProps) {
  if (loading) return <MetricCardSkeleton className={className} />;

  if (error) {
    return (
      <div
        className={cn(
          "flex h-full flex-col rounded-2xl border border-border/40 bg-card p-5 shadow-sm",
          className,
        )}
      >
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
          {title}
        </p>
        <p className="mt-4 text-xs text-destructive">{error}</p>
      </div>
    );
  }

  const hasDelta = delta !== undefined || deltaLabel !== undefined;

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
            {title}
          </p>
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {icon}
          {actions}
        </div>
      </div>

      <div className="flex-1 px-5 pb-5 pt-4">
        <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
          <span
            className={cn(
              "text-3xl font-bold tracking-tight text-foreground tabular-nums",
              valueClassName,
            )}
          >
            {value}
          </span>
          {subtitle && (
            <span className="text-xs font-medium text-muted-foreground">{subtitle}</span>
          )}
          {hasDelta && (
            <DeltaPill
              value={delta}
              label={deltaLabel}
              tone={deltaTone}
              direction={trendDirection}
              className="ml-auto sm:ml-0"
            />
          )}
        </div>
      </div>

      {footer && (
        <div className="border-t border-border/40 bg-muted/20 px-5 py-2.5 text-[11px] text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}
