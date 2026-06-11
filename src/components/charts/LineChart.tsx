"use client";

import * as React from "react";
import { ChartCard } from "./ChartCard";
import type { EChartsOption, EChartsInstance } from "./types";

export interface LineChartData {
  /** Category label (typically time-based) */
  label: string;
  /** Numeric value */
  value: number;
}

export interface LineChartProps {
  /** Chart title — required for accessible header */
  title: string;
  /** Optional subtitle */
  description?: string;
  /** Data array: { label, value } */
  data: LineChartData[];
  /** Series name for the chart */
  seriesName?: string;
  /** Chart height in px or CSS string. Defaults to 300. */
  height?: number | string;
  /** Whether to smooth the line curve. Defaults to true. */
  smooth?: boolean;
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
 * LineChart
 *
 * Preset for Apache ECharts line visualizations.
 * Primarily for trend analysis and time-series data.
 *
 * Uses ChartCard for structural layout (header, meta, actions, filters).
 * Delegates ECharts rendering to the ChartCard → ChartShell → EChart pipeline.
 *
 * @example
 * <LineChart
 *   title="Actividad Semanal"
 *   data={[
 *     { label: "Lun", value: 15 },
 *     { label: "Mar", value: 23 },
 *     { label: "Mié", value: 20 },
 *   ]}
 *   seriesName="Actividad"
 *   smooth={true}
 *   height={300}
 * />
 */
export function LineChart({
  title,
  description,
  data,
  seriesName = "Valor",
  height = 300,
  smooth = true,
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
}: LineChartProps) {
  // Build ECharts option
  const option: EChartsOption = React.useMemo(() => {
    if (!data || data.length === 0) {
      return {};
    }

    const labels = data.map((d) => d.label);
    const values = data.map((d) => d.value);

    return {
      xAxis: { type: "category", data: labels },
      yAxis: { type: "value" },
      series: [
        {
          data: values,
          type: "line",
          name: seriesName,
          smooth: smooth,
          symbol: "circle",
          symbolSize: 4,
        },
      ],
    };
  }, [data, seriesName, smooth]);

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