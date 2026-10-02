"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "@/icons";
import type { DeltaPillProps } from "./surveyAnalyticsTypes";

/**
 * DeltaPill - Small indicator for metric changes (deltas).
 * Used in dashboards and cards to show progress or comparison.
 */
export function DeltaPill({
  value,
  label,
  direction,
  tone,
  showIcon = true,
  size = "md",
  className,
}: DeltaPillProps) {
  // Resolve tone if not provided
  const resolvedTone = tone || (value !== undefined
    ? (value > 0 ? "positive" : value < 0 ? "negative" : "neutral")
    : "neutral");

  // Resolve direction if not provided
  const resolvedDirection = direction || (value !== undefined
    ? (value > 0 ? "up" : value < 0 ? "down" : "flat")
    : "flat");

  const Icon = {
    up: TrendingUp,
    down: TrendingDown,
    flat: Minus,
  }[resolvedDirection];

  const toneClasses = {
    positive: "bg-success/10 text-success border-success/20",
    negative: "bg-destructive/10 text-destructive border-destructive/20",
    neutral: "bg-surface-subtle text-muted-foreground border-border/60",
  }[resolvedTone];

  const sizeClasses = {
    sm: "px-1.5 py-0.5 text-xs gap-1",
    md: "px-2 py-1 text-xs gap-1.5",
  }[size];

  return (
    <div className={cn(
      "inline-flex items-center font-semibold tabular-nums rounded-md border whitespace-nowrap",
      toneClasses,
      sizeClasses,
      className
    )}>
      {showIcon && <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} aria-hidden="true" />}
      <span>{label || (value !== undefined ? `${value > 0 ? "+" : ""}${value}%` : "")}</span>
    </div>
  );
}