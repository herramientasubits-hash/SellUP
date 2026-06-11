export type DeltaTone = "positive" | "negative" | "neutral";
export type DeltaDirection = "up" | "down" | "flat";

export interface ComparisonItem {
  /** Label for the comparison (e.g. "VS Q1") */
  label: string;
  /** The value being compared */
  value: string | number;
  /** Optional delta value */
  delta?: number;
  /** Optional custom delta label (e.g. "+5%") */
  deltaLabel?: string;
  /** Tone of the comparison */
  tone?: DeltaTone;
}

export type LegendTone = "primary" | "positive" | "negative" | "warning" | "neutral" | "info";

export interface LegendItem {
  /** Label for the legend item */
  label: string;
  /** Optional value to display */
  value?: string | number;
  /** Tone for the visual indicator */
  tone?: LegendTone;
  /** Optional secondary description */
  description?: string;
}

export interface DeltaPillProps {
  /** Numeric value for the delta */
  value?: number;
  /** Custom label to display instead of value */
  label?: string;
  /** Explicit direction icon */
  direction?: DeltaDirection;
  /** Tone of the pill */
  tone?: DeltaTone;
  /** Whether to show the direction icon (default: true) */
  showIcon?: boolean;
  /** Size of the pill */
  size?: "sm" | "md";
  /** Additional CSS classes */
  className?: string;
}

export interface InlineLegendProps {
  /** Items to display in the legend */
  items: LegendItem[];
  /** Layout orientation */
  orientation?: "horizontal" | "vertical";
  /** Visual size */
  size?: "sm" | "md";
  /** Additional CSS classes */
  className?: string;
}

export interface MetricComparisonFooterProps {
  /** Comparison items to display */
  items: ComparisonItem[];
  /** Grid columns for distribution */
  columns?: 2 | 3 | 4;
  /** Additional CSS classes */
  className?: string;
}

export interface SurveyMetricCardProps {
  /** Title for the card */
  title?: string;
  /** Secondary description */
  description?: string;
  /** Main numeric or text value */
  value: string | number;
  /** Subtitle or unit for the value */
  subtitle?: string;
  /** Optional delta value for comparison */
  delta?: number;
  /** Custom label for the delta (e.g. "+5%") */
  deltaLabel?: string;
  /** Tone for the delta pill */
  deltaTone?: DeltaTone;
  /** Explicit direction for the delta */
  trendDirection?: DeltaDirection;
  /** Comparison items for the footer */
  comparisonItems?: ComparisonItem[];
  /** Custom actions in header */
  actions?: React.ReactNode;
  /** Custom footer content */
  footer?: React.ReactNode;
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string;
  /** Additional CSS classes */
  className?: string;
}