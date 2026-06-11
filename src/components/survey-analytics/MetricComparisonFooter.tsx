"use client";

import { cn } from "@/lib/utils";
import { DeltaPill } from "./DeltaPill";
import type { MetricComparisonFooterProps } from "./surveyAnalyticsTypes";

/**
 * MetricComparisonFooter - High-density comparison section for analytic cards.
 */
export function MetricComparisonFooter({
  items,
  columns = 3,
  className,
}: MetricComparisonFooterProps) {
  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
  }[columns];

  return (
    <div className={cn(
      "grid gap-4 py-4 border-t border-border/40",
      gridCols,
      className
    )}>
      {items.map((item, index) => (
        <div key={index} className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground truncate">
            {item.label}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">
              {item.value}
            </span>
            {(item.delta !== undefined || item.deltaLabel) && (
              <DeltaPill
                value={item.delta}
                label={item.deltaLabel}
                tone={item.tone}
                size="sm"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}