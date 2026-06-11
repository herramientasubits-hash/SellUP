import type { ComponentType } from "react";

export interface SelectionOption {
  /** Technical value for the option */
  value: string;
  /** Main display text */
  label: string;
  /** Optional secondary description */
  description?: string;
  /** Optional small text above the label */
  eyebrow?: string;
  /** Optional text to display in a badge */
  badge?: string;
  /** Optional icon component */
  icon?: ComponentType<{ className?: string }>;
  /** Whether the specific option is disabled */
  disabled?: boolean;
}

export type SelectionColumns = 1 | 2 | 3 | 4;

export type SegmentedControlVariant = "solid" | "outline" | "underline";
export type SegmentedControlSize = "sm" | "md";