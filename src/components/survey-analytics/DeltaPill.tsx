"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
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
    positive: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    negative: "bg-destructive/10 text-destructive border-destructive/20",
    neutral: "bg-muted/20 text-muted-foreground border-border/50",
  }[resolvedTone];

  const sizeClasses = {
    sm: "px-1.5 py-0.5 text-[10px] gap-1",
    md: "px-2 py-1 text-[11px] gap-1.5",
  }[size];

  return (
    <div className={cn(
      "inline-flex items-center font-bold rounded-full border whitespace-nowrap",
      toneClasses,
      sizeClasses,
      className
    )}>
      {showIcon && <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />}
      <span>{label || (value !== undefined ? `${value > 0 ? "+" : ""}${value}%` : "")}</span>
    </div>
  );
}