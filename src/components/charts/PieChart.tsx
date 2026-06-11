"use client";

import * as React from "react";
import { ChartCard } from "./ChartCard";
import type { EChartsOption, EChartsInstance } from "./types";

export interface PieChartData {
  /** Category label */
  label: string;
  /** Numeric value */
  value: number;
}

export interface PieChartProps {
  /** Chart title — required for accessible header */
  title: string;
  /** Optional subtitle */
  description?: string;
  /** Data array: { label, value } */
  data: PieChartData[];
  /** Series name for the chart */
  seriesName?: string;
  /** Chart height in px or CSS string. Defaults to 300. */
  height?: number | string;
  /** Whether to show as donut (true) or pie (false). Defaults to true. */
  donut?: boolean;
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
 * PieChart
 *
 * Preset for Apache ECharts pie/donut visualizations.
 * Supports donut mode with center label.
 *
 * Uses ChartCard for structural layout (header, meta, actions, filters).
 * Delegates ECharts rendering to the ChartCard → ChartShell → EChart pipeline.
 *
 * @example
 * <PieChart
 *   title="Distribución por Tipo"
 *   data={[
 *     { label: "Tipo A", value: 420 },
 *     { label: "Tipo B", value: 310 },
 *     { label: "Tipo C", value: 250 },
 *   ]}
 *   donut={true}
 *   height={300}
 * />
 */
export function PieChart({
  title,
  description,
  data,
  seriesName = "Valor",
  height = 300,
  donut = true,
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
}: PieChartProps) {
  // Build ECharts option
  const option: EChartsOption = React.useMemo(() => {
    if (!data || data.length === 0) {
      return {};
    }

    return {
      series: [
        {
          data: data.map((d) => ({ name: d.label, value: d.value })),
          type: "pie",
          name: seriesName,
          radius: donut ? ["50%", "70%"] : [0, "70%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: "transparent",
            borderWidth: 0,
          },
          label: {
            show: false,
            position: "center",
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 18,
              fontWeight: "bold",
            },
          },
        },
      ],
      legend: {
        orient: "vertical",
        left: "right",
        top: "center",
      },
    };
  }, [data, seriesName, donut]);

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