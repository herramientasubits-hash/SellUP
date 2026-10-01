"use client";

import { cn } from "@/lib/utils";
import { Field } from "@/components/forms/field";
import type { SelectionOption, SegmentedControlVariant, SegmentedControlSize } from "./selectionTypes";

export interface SegmentedControlProps {
  /** Array of options to display */
  options: SelectionOption[];
  /** Current selected value */
  value?: string;
  /** Callback when selection changes */
  onChange?: (value: string) => void;
  /** Visual style of the control */
  variant?: SegmentedControlVariant;
  /** Vertical size of the segments */
  size?: SegmentedControlSize;
  /** Whether the control occupies the full container width */
  fullWidth?: boolean;
  /** Whether the entire control is disabled */
  disabled?: boolean;
  /** Label for the control group */
  label?: string;
  /** Description for the control group */
  description?: string;
  /** Error message to display */
  error?: string;
  /** Accessible label for the control group */
  ariaLabel?: string;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * SegmentedControl - UBITS component for toggling between compact options.
 * Ideal for view switchers, status toggles, or period selection.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  variant = "solid",
  size = "md",
  fullWidth = false,
  disabled = false,
  label,
  description,
  error,
  ariaLabel,
  className,
}: SegmentedControlProps) {
  const containerStyles = {
    solid: "p-1 bg-surface-muted rounded-lg border border-border/60",
    outline: "p-0.5 border border-border/60 rounded-lg",
    underline: "p-0 border-b border-border rounded-none bg-transparent",
  }[variant];

  const segmentBase = cn(
    "relative flex items-center justify-center transition-all duration-200 outline-none focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/40",
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-xs",
    fullWidth ? "flex-1" : "flex-initial min-w-[80px]"
  );

  return (
    <Field
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      className={className}
    >
      <div
        role="radiogroup"
        aria-label={ariaLabel || label}
        className={cn("inline-flex items-center", fullWidth && "flex w-full", containerStyles)}
      >
        {options.map((option) => {
          const isActive = value === option.value;
          const isDisabled = disabled || option.disabled;
          const Icon = option.icon;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={isDisabled}
              onClick={() => onChange?.(option.value)}
              className={cn(
                segmentBase,
                "font-semibold",

                // Solid Variant logic
                variant === "solid" && cn(
                  "rounded-md",
                  isActive
                    ? "bg-card text-primary shadow-card ring-1 ring-border/60"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-muted"
                ),

                // Outline Variant logic
                variant === "outline" && cn(
                  "rounded-md",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface-muted"
                ),

                // Underline Variant logic
                variant === "underline" && cn(
                  "rounded-none border-b-2 border-transparent",
                  isActive
                    ? "border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                ),

                isDisabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                {Icon && <Icon className={cn("h-3.5 w-3.5", isActive ? "opacity-100" : "opacity-60")} />}
                <span className="truncate">{option.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Field>
  );
}