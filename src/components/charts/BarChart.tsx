"use client";

import * as React from "react";
import { ChartCard } from "./ChartCard";
import type { EChartsOption, EChartsInstance } from "./types";

export interface BarChartData {
  /** Category label */
  label: string;
  /** Numeric value */
  value: number;
}

export interface BarChartProps {
  /** Chart title — required for accessible header */
  title: string;
  /** Optional subtitle */
  description?: string;
  /** Data array: { label, value } */
  data: BarChartData[];
  /** Series name for the chart */
  seriesName?: string;
  /** Chart height in px or CSS string. Defaults to 300. */
  height?: number | string;
  /** Whether to show horizontal bars. Defaults to false (vertical). */
  horizontal?: boolean;
  /** Whether to stack multiple series. Defaults to false. */
  stacked?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Empty state */
  empty?: boolean;
  /** Error message string */
  error?: string | null;
  /** Accessible label for the chart region */
  ariaLabel?: string;
  /** Screen-reader-only data summary */
  summary?: React.ReactNode;
  /** Right-aligned header actions */
  actions?: React.ReactNode;
  /** Filter controls slot */
  filters?: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Optional CSS classes */
  className?: string;
  /** Callback when chart instance is ready */
  onChartReady?: (instance: EChartsInstance) => void;
}

/**
 * BarChart
 *
 * Preset for Apache ECharts bar visualizations.
 * Supports vertical and horizontal bars, stacking, and all standard chart states.
 *
 * Uses ChartCard for structural layout (header, meta, actions, filters).
 * Delegates ECharts rendering to the ChartCard → ChartShell → EChart pipeline.
 *
 * @example
 * <BarChart
 *   title="Ventas por Región"
 *   data={[
 *     { label: "Norte", value: 420 },
 *     { label: "Sur", value: 310 },
 *     { label: "Este", value: 250 },
 *   ]}
 *   seriesName="Ingresos"
 *   height={300}
 * />
 */
export function BarChart({
  title,
  description,
  data,
  seriesName = "Valor",
  height = 300,
  horizontal = false,
  stacked = false,
  loading = false,
  empty = false,
  error = null,
  ariaLabel,
  summary,
  actions,
  filters,
  footer,
  className,
  onChartReady,
}: BarChartProps) {
  // Build ECharts option
  const option: EChartsOption = React.useMemo(() => {
    if (!data || data.length === 0) {
      return {};
    }

    const labels = data.map((d) => d.label);
    const values = data.map((d) => d.value);

    if (horizontal) {
      // Horizontal bar: swap axes
      return {
        xAxis: { type: "value" },
        yAxis: { type: "category", data: labels },
        series: [
          {
            data: values,
            type: "bar",
            name: seriesName,
            stack: stacked ? "total" : undefined,
          },
        ],
      };
    } else {
      // Vertical bar (default)
      return {
        xAxis: { type: "category", data: labels },
        yAxis: { type: "value" },
        series: [
          {
            data: values,
            type: "bar",
            name: seriesName,
            stack: stacked ? "total" : undefined,
          },
        ],
      };
    }
  }, [data, seriesName, horizontal, stacked]);

  return (
    <ChartCard
      title={title}
      description={description}
      option={option}
      height={height}
      loading={loading}
      empty={empty}
      error={error}
      ariaLabel={ariaLabel ?? title}
      summary={summary}
      actions={actions}
      filters={filters}
      footer={footer}
      className={className}
      onChartReady={onChartReady}
    />
  );
}