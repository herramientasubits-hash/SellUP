import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DeltaPill, type DeltaDirection, type DeltaTone } from "./delta-pill";

export type MetricCardIconPosition = "right" | "top" | "left-large";

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
  iconPosition?: MetricCardIconPosition;
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
        "rounded-2xl bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] dark:shadow-[0_1px_2px_0_rgb(255_255_255/0.04)]",
        className,
      )}
    >
      <div className="space-y-2">
        <div className="h-3.5 w-1/2 rounded-md bg-muted/60" />
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
  iconPosition = "right",
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
          "flex h-full flex-col rounded-2xl bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] dark:shadow-[0_1px_2px_0_rgb(255_255_255/0.04)]",
          className,
        )}
      >
        <p className="text-sm font-semibold text-foreground/80">{title}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground/70 line-clamp-1">{description}</p>
        )}
        <p className="mt-4 text-xs text-destructive">{error}</p>
      </div>
    );
  }

  const hasDelta = delta !== undefined || deltaLabel !== undefined;

  const containerCls = cn(
    "flex h-full overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] dark:shadow-[0_1px_2px_0_rgb(255_255_255/0.04)]",
    iconPosition === "left-large" ? "flex-row items-center gap-4 p-5" : "flex-col",
    className,
  );

  if (iconPosition === "left-large") {
    return (
      <div className={containerCls}>
        {icon && <div className="flex shrink-0 items-center justify-center">{icon}</div>}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-2xl font-semibold text-foreground leading-none tabular-nums">
            {value}
          </p>
          <p className="text-sm text-muted-foreground">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground/70 line-clamp-1">{description}</p>
          )}
        </div>
      </div>
    );
  }

  if (iconPosition === "top") {
    return (
      <div className={containerCls}>
        {icon && <div className="px-5 pt-5">{icon}</div>}
        <div className="flex flex-1 flex-col px-5 pb-5 pt-3">
          <p className="text-sm font-semibold text-foreground/80">{title}</p>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground/70 line-clamp-1">{description}</p>
          )}
          <div className="mt-3 flex items-baseline flex-wrap gap-x-2 gap-y-1">
            <span
              className={cn(
                "text-3xl font-bold tracking-tight text-foreground tabular-nums",
                valueClassName,
              )}
            >
              {value}
            </span>
            {subtitle && (
              <span className="text-sm font-medium text-muted-foreground/70">{subtitle}</span>
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

  return (
    <div className={containerCls}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-foreground/80">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground/70 line-clamp-1">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {icon}
          {actions}
        </div>
      </div>

      <div className="flex-1 px-5 pb-5 pt-4">
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1">
          <span
            className={cn(
              "text-3xl font-bold tracking-tight text-foreground tabular-nums",
              valueClassName,
            )}
          >
            {value}
          </span>
          {subtitle && (
            <span className="text-sm font-medium text-muted-foreground/70">{subtitle}</span>
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
