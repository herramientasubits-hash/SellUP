"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

export interface RangeSliderProps {
  /** Selected range value [min, max] */
  value?: [number, number];
  /** Callback when range changes */
  onChange?: (value: [number, number]) => void;
  /** Minimum selectable value */
  min?: number;
  /** Maximum selectable value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Whether the slider is disabled */
  disabled?: boolean;
  /** Label for accessibility and UI */
  label?: string;
  /** Helper text below the input */
  description?: string;
  /** Error message - shows error state if present */
  error?: string;
  /** Whether to show the current values above the slider */
  showValue?: boolean;
  /** Function to format the displayed values */
  valueFormatter?: (value: number) => string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * RangeSlider - UBITS wrapper for range selection.
 * Built on top of Base UI Slider base.
 */
export const RangeSlider = React.forwardRef<
  HTMLDivElement,
  RangeSliderProps
>(({
  value = [0, 100],
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  label,
  description,
  error,
  showValue = true,
  valueFormatter = (val) => val.toString(),
  className,
}, ref) => {
  const id = React.useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  const handleValueChange = (newValues: number | readonly number[]) => {
    const values = Array.isArray(newValues) ? newValues : [newValues];
    if (values.length === 2) {
      onChange?.([values[0], values[1]]);
    }
  };

  const hasError = !!error;

  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-2.5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        {label && (
          <label
            id={labelId}
            htmlFor={id}
            className={cn(
              "text-sm font-medium text-foreground",
              disabled && "opacity-50"
            )}
          >
            {label}
          </label>
        )}
        {showValue && (
          <span
            className={cn(
              "text-xs font-medium text-muted-foreground",
              disabled && "opacity-50"
            )}
          >
            {valueFormatter(value[0])} — {valueFormatter(value[1])}
          </span>
        )}
      </div>

      <div className="relative py-2 px-1.5">
        <Slider
          id={id}
          value={value}
          onValueChange={handleValueChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className={cn(
            hasError && "[&_[data-slot=slider-range]]:!bg-destructive [&_[data-slot=slider-thumb]]:!border-destructive"
          )}
          aria-labelledby={label ? labelId : undefined}
          aria-describedby={
            cn(
              description && descriptionId,
              error && errorId
            ) || undefined
          }
        />
      </div>

      {description && !error && (
        <p
          id={descriptionId}
          className="text-xs text-muted-foreground"
        >
          {description}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          className="text-xs text-destructive font-medium"
        >
          {error}
        </p>
      )}
    </div>
  );
});

RangeSlider.displayName = "RangeSlider";