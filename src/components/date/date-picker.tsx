"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDate, isValidDate, isDateInRange } from "./dateUtils";

export interface DatePickerProps {
  /** Selected date value */
  value?: Date | null;
  /** Callback when date selection changes */
  onChange?: (date: Date | undefined) => void;
  /** Placeholder text when no date is selected */
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
 * DatePicker - UBITS wrapper for single date selection.
 * Combines Popover and Calendar for a date input experience.
 * Uses native Date and Intl.DateTimeFormat.
 *
 * @example
 * ```tsx
 * const [date, setDate] = React.useState<Date>()
 * return (
 *   <DatePicker
 *     value={date}
 *     onChange={setDate}
 *     label="Pick a date"
 *     placeholder="Select a date"
 *   />
 * )
 * ```
 */
export const DatePicker = React.forwardRef<
  HTMLDivElement,
  DatePickerProps
>(({
  value,
  onChange,
  placeholder = "Seleccionar fecha",
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

  // Determine if value is valid and selectable
  const isValidValue = value && isValidDate(value);
  const isValueSelectable = isValidValue
    ? isDateInRange(value, minDate, maxDate)
    : true;

  // Format display text
  const displayText = isValidValue && isValueSelectable
    ? formatDate(value, locale)
    : placeholder;

  // Generate unique ID for accessibility
  const pickerId = React.useId();
  const labelId = label ? `${pickerId}-label` : undefined;
  const descriptionId = description ? `${pickerId}-description` : undefined;
  const errorId = error ? `${pickerId}-error` : undefined;

  const handleDateSelect = (date: Date | undefined) => {
    // Validate against min/max constraints
    if (date && !isDateInRange(date, minDate, maxDate)) {
      return;
    }
    onChange?.(date);
    setOpen(false);
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
                !isValidValue && "text-muted-foreground",
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
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={isValidValue ? value : undefined}
            onSelect={handleDateSelect}
            disabled={(date: Date) => {
              // Disable dates outside min/max range
              if (minDate && date < minDate) return true;
              if (maxDate && date > maxDate) return true;
              return false;
            }}
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

DatePicker.displayName = "DatePicker";