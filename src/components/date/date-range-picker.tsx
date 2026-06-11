"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateRange, isValidDate, isDateInRange } from "./dateUtils";

export interface DateRangePickerProps {
  /** Selected date range value */
  value?: { from?: Date; to?: Date } | null;
  /** Callback when date range changes */
  onChange?: (range: { from?: Date; to?: Date } | undefined) => void;
  /** Placeholder text when no range is selected */
  placeholder?: string;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Label for accessibility and UI */
  label?: string;
  /** Helper text below the input */
  description?: string;
  /** Error message - shows error state if present */
  error?: string;
  /** Minimum selectable date (inclusive) */
  minDate?: Date;
  /** Maximum selectable date (inclusive) */
  maxDate?: Date;
  /** Additional CSS classes */
  className?: string;
  /** Locale for date formatting (default: 'es-CO') */
  locale?: string;
}

/**
 * DateRangePicker - UBITS wrapper for date range selection.
 * Combines Popover and Calendar for a date range input experience.
 * Uses native Date and Intl.DateTimeFormat.
 *
 * @example
 * ```tsx
 * const [range, setRange] = React.useState<{ from?: Date; to?: Date }>()
 * return (
 *   <DateRangePicker
 *     value={range}
 *     onChange={setRange}
 *     label="Pick a date range"
 *     placeholder="Select a range"
 *   />
 * )
 * ```
 */
export const DateRangePicker = React.forwardRef<
  HTMLDivElement,
  DateRangePickerProps
>(({
  value,
  onChange,
  placeholder = "Seleccionar rango",
  disabled = false,
  label,
  description,
  error,
  minDate,
  maxDate,
  className,
  locale = "es-CO",
}, ref) => {
  const [open, setOpen] = React.useState(false);

  // Validate range values
  const isValidFrom = value?.from ? isValidDate(value.from) : false;
  const isValidTo = value?.to ? isValidDate(value.to) : false;
  const hasRange = isValidFrom || isValidTo;

  // Check if dates are selectable
  const isFromSelectable = isValidFrom && value?.from
    ? isDateInRange(value.from, minDate, maxDate)
    : true;
  const isToSelectable = isValidTo && value?.to
    ? isDateInRange(value.to, minDate, maxDate)
    : true;

  // Format display text
  const displayText = hasRange && isFromSelectable && isToSelectable
    ? formatDateRange(value?.from, value?.to, locale)
    : placeholder;

  // Generate unique ID for accessibility
  const pickerId = React.useId();
  const labelId = label ? `${pickerId}-label` : undefined;
  const descriptionId = description ? `${pickerId}-description` : undefined;
  const errorId = error ? `${pickerId}-error` : undefined;

  const handleRangeChange = (range: DateRange | undefined) => {
    // Validate dates against constraints
    if (range?.from && !isDateInRange(range.from, minDate, maxDate)) {
      return;
    }
    if (range?.to && !isDateInRange(range.to, minDate, maxDate)) {
      return;
    }

    onChange?.(range ? { from: range.from, to: range.to } : undefined);

    // Close popover only when both dates are selected
    if (range?.from && range?.to) {
      setOpen(false);
    }
  };

  const hasError = !!error;

  return (
    <div ref={ref} className={cn("flex flex-col gap-2", className)}>
      {label && (
        <label
          id={labelId}
          htmlFor={pickerId}
          className={cn(
            "text-sm font-medium text-foreground",
            disabled && "opacity-50"
          )}
        >
          {label}
        </label>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={pickerId}
              variant="outline"
              disabled={disabled}
              className={cn(
                "w-full justify-start text-left font-normal",
                !hasRange && "text-muted-foreground",
                hasError && "border-destructive text-destructive focus-visible:ring-destructive"
              )}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
              aria-labelledby={labelId}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {displayText}
            </Button>
          }
        />
        <PopoverContent
          className="w-auto p-0"
          align="start"
          sideOffset={8}
        >
          <Calendar
            mode="range"
            selected={
              value?.from || value?.to
                ? { from: value.from, to: value.to }
                : undefined
            }
            onSelect={handleRangeChange}
            disabled={(date: Date) => {
              // Disable dates outside min/max range
              if (minDate && date < minDate) return true;
              if (maxDate && date > maxDate) return true;
              return false;
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>

      {description && (
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
          className="text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
});

DateRangePicker.displayName = "DateRangePicker";