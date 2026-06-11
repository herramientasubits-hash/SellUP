"use client";

import * as React from "react";
import { EChart } from "./EChart";
import { cn } from "@/lib/utils";
import type { EChartsOption } from "./types";

export interface SparklineDatum {
  /** Category label (typically time-based) */
  label: string;
  /** Numeric value */
  value: number;
}

export interface SparklineChartProps {
  /** Data array: { label, value } */
  data: SparklineDatum[];
  /** Chart height in px or CSS string. Defaults to 32. */
  height?: number | string;
  /** Trend direction. Used for styling hints only. */
  trend?: "positive" | "negative" | "neutral";
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Empty state */
  empty?: boolean;
  /** Accessible label for the chart region */
  ariaLabel?: string;
  /** Screen-reader-only data summary */
  summary?: React.ReactNode;
  /** Optional CSS classes */
  className?: string;
}

/**
 * SparklineChart
 *
 * Ultra-compact line chart for inline context, KPIs, and dashboard metrics.
 * No axes, no gridlines, no legend by default — just the line.
 *
 * Usage:
 * - Inline with numerical values (e.g., "Last 30 days: [sparkline]")
 * - Table rows for trend context
 * - KPI cards for visual accent
 *
 * Trend prop is for semantic intent only (positive = green hint, etc.);
 * actual color comes from theme.
 *
 * Note: Sparklines should NEVER be the sole source of information.
 * Always pair with a text label or number.
 *
 * @example
 * <SparklineChart
 *   data={[
 *     { label: "Day 1", value: 100 },
 *     { label: "Day 2", value: 150 },
 *     { label: "Day 3", value: 140 },
 *   ]}
 *   height={32}
 *   trend="positive"
 *   showTooltip={true}
 * />
 */
export function SparklineChart({
  data,
  height = 32,
  trend,
  showTooltip = false,
  loading = false,
  empty = false,
  ariaLabel = "Gráfico de tendencias",
  summary,
  className,
}: SparklineChartProps) {
  // Build ECharts option
  const option: EChartsOption = React.useMemo(() => {
    if (!data || data.length === 0) {
      return {};
    }

    const labels = data.map((d) => d.label);
    const values = data.map((d) => d.value);

    // Trend color hints (CSS variables resolved via canvas theme)
    // These are semantic hints; actual colors come from the theme
    const trendOpacity = trend ? 0.15 : 0.05;

    return {
      xAxis: { type: "category", data: labels, show: false },
      yAxis: { type: "value", show: false },
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      series: [
        {
          data: values,
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: {
            width: 1,
          },
          areaStyle: {
            opacity: trendOpacity,
          },
        },
      ],
      ...(showTooltip && {
        tooltip: {
          trigger: "axis",
        },
      }),
    };
  }, [data, showTooltip, trend]);

  return (
    <div className={cn("flex items-center justify-center", className)}>
      {summary && <div className="sr-only">{summary}</div>}
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ height, width: "100%" }}
      >
        <EChart
          option={option}
          height={height}
          loading={loading}
          empty={empty}
        />
      </div>
    </div>
  );
}