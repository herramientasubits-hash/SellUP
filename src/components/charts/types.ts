import type { ECharts, EChartsCoreOption } from "echarts/core";

/**
 * ECharts Base Types
 */
export type EChartsOption = EChartsCoreOption;
export type EChartsInstance = ECharts;

export interface EChartProps {
  /** The chart configuration option object */
  option: EChartsOption;
  /** Fixed height or CSS height string. Defaults to 300. */
  height?: number | string;
  /** Whether the chart is in a loading state */
  loading?: boolean;
  /** Whether the chart has no data to display */
  empty?: boolean;
  /** Additional CSS classes for the container */
  className?: string;
  /** Inline styles for the container */
  style?: React.CSSProperties;
  /** Callback triggered when the chart instance is initialized */
  onChartReady?: (instance: EChartsInstance) => void;
}