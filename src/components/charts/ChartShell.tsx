"use client";

import * as React from "react";
import { EChart } from "./EChart";
import { cn } from "@/lib/utils";
import type { EChartsOption, EChartsInstance } from "./types";

export interface ChartShellProps {
  /** ECharts option — ignored when children are provided */
  option?: EChartsOption;
  /** Chart height in px. Defaults to 300. */
  height?: number | string;
  /** Shows Skeleton overlay while data is loading */
  loading?: boolean;
  /** Shows inline empty state when there is no data to display */
  empty?: boolean;
  /** Shows inline error state with the given message */
  error?: string | null;
  /** Accessible label for the chart region (role="img" aria-label) */
  ariaLabel?: string;
  /** Screen-reader-only data summary (e.g. a hidden table or caption) */
  summary?: React.ReactNode;
  /** Content rendered below the chart area (footnotes, legend, etc.) */
  footer?: React.ReactNode;
  /** Optional children — overrides EChart rendering */
  children?: React.ReactNode;
  className?: string;
  onChartReady?: (instance: EChartsInstance) => void;
}

/**
 * ChartShell
 *
 * Structural container that manages all chart states: loading, empty, error, and data.
 * Renders EChart by default; pass children to replace the chart with custom content.
 *
 * Accessibility:
 * - Root is a <section> element scoped to the chart area.
 * - The chart region carries role="img" and aria-label.
 * - summary prop renders sr-only text for screen-reader data access.
 *
 * Empty and error states are inline divs — not the EmptyState Card component —
 * to avoid nested Card borders within ChartCard.
 *
 * @example
 * <ChartShell
 *   option={barOption}
 *   height={260}
 *   ariaLabel="Distribución por categoría"
 *   loading={isFetching}
 * />
 */
export function ChartShell({
  option,
  height = 300,
  loading = false,
  empty = false,
  error = null,
  ariaLabel = "Gráfico",
  summary,
  footer,
  children,
  className,
  onChartReady,
}: ChartShellProps) {
  const labelId = React.useId();

  return (
    <section className={cn("flex flex-col gap-3", className)} aria-labelledby={labelId}>
      {/* sr-only label anchors aria-labelledby — visible title lives in ChartCard */}
      <span id={labelId} className="sr-only">
        {ariaLabel}
      </span>

      {/* sr-only summary for screen readers to access chart data without canvas */}
      {summary && <div className="sr-only">{summary}</div>}

      {/* Chart region */}
      <div role="img" aria-label={ariaLabel} style={{ height }}>
        {error ? (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5"
            style={{ height }}
          >
            <span className="text-sm font-medium text-destructive">Error al cargar el gráfico</span>
            <span className="text-xs text-muted-foreground">{error}</span>
          </div>
        ) : children ? (
          <div className="w-full h-full" style={{ height }}>
            {children}
          </div>
        ) : (
          <EChart
            option={option ?? {}}
            height={height}
            loading={loading}
            empty={empty}
            onChartReady={onChartReady}
          />
        )}
      </div>

      {footer && (
        <div className="text-xs text-muted-foreground">{footer}</div>
      )}
    </section>
  );
}