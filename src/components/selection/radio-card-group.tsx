"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/forms/field";
import type { SelectionOption, SelectionColumns } from "./selectionTypes";

export interface RadioCardGroupProps {
  /** Array of selectable options */
  options: SelectionOption[];
  /** Current selected value */
  value?: string;
  /** Callback when selection changes */
  onChange?: (value: string) => void;
  /** Name for the radio group form field */
  name?: string;
  /** Number of columns in the grid */
  columns?: SelectionColumns;
  /** Whether the entire control is disabled */
  disabled?: boolean;
  /** Label for the control group */
  label?: string;
  /** Description for the control group */
  description?: string;
  /** Error message to display */
  error?: string;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * RadioCardGroup - UBITS component for choosing one option from a set of cards.
 * Native radio group implementation for accessibility and keyboard navigation.
 */
export function RadioCardGroup({
  options,
  value,
  onChange,
  name,
  columns = 2,
  disabled = false,
  label,
  description,
  error,
  className,
}: RadioCardGroupProps) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  }[columns];

  const generatedId = React.useId();
  const groupName = name || `radio-group-${generatedId}`;

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
        aria-label={label}
        className={cn("grid gap-4 mt-2", gridCols)}
      >
        {options.map((option) => {
          const isDisabled = disabled || option.disabled;
          const isSelected = value === option.value;
          const Icon = option.icon;

          return (
            <label
              key={option.value}
              className="group relative flex flex-col p-0 rounded-xl outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-su-brand focus-visible:ring-offset-2 data-[state=checked]:z-10"
            >
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={isSelected}
                onChange={() => onChange?.(option.value)}
                disabled={isDisabled}
                className="sr-only"
                aria-checked={isSelected}
              />
              <Card className={cn(
                "flex flex-col w-full h-full p-5 border-2 transition-all duration-200",
                "group-data-[state=checked]:border-su-brand group-data-[state=checked]:bg-su-brand/[0.02] group-data-[state=checked]:ring-1 group-data-[state=checked]:ring-su-brand/20",
                "group-data-[state=unchecked]:border-border/50 group-data-[state=unchecked]:bg-card group-data-[state=unchecked]:hover:border-su-brand/30",
                isDisabled && "opacity-50 grayscale-[0.5] hover:border-border/50"
              )}>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className={cn(
                    "p-2.5 rounded-xl border transition-colors",
                    "group-data-[state=checked]:bg-su-brand group-data-[state=checked]:text-su-brand-foreground group-data-[state=checked]:border-su-brand",
                    "group-data-[state=unchecked]:bg-muted/50 group-data-[state=unchecked]:text-muted-foreground group-data-[state=unchecked]:border-border/50 group-hover:group-data-[state=unchecked]:bg-su-brand/5 group-hover:group-data-[state=unchecked]:text-su-brand group-hover:group-data-[state=unchecked]:border-su-brand/20"
                  )}>
                    {Icon ? <Icon className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5 opacity-20 group-data-[state=checked]:opacity-100" />}
                  </div>
                  {option.badge && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-bold uppercase tracking-wider text-[9px]",
                        "group-data-[state=checked]:bg-su-brand group-data-[state=checked]:text-su-brand-foreground group-data-[state=checked]:border-transparent"
                      )}
                    >
                      {option.badge}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-col min-w-0 flex-1">
                  {option.eyebrow && (
                    <span className="text-[10px] font-bold text-su-brand/70 uppercase tracking-widest mb-1">
                      {option.eyebrow}
                    </span>
                  )}
                  <h4 className="text-sm font-bold truncate leading-snug">
                    {option.label}
                  </h4>
                  {option.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed line-clamp-2">
                      {option.description}
                    </p>
                  )}
                </div>

                <div className={cn(
                  "absolute top-2 right-2 flex items-center justify-center h-5 w-5 bg-su-brand rounded-full text-su-brand-foreground shadow-sm scale-0 transition-transform duration-200",
                  "group-data-[state=checked]:scale-100"
                )}>
                  <CheckCircle2 className="h-3 w-3" />
                </div>
              </Card>
            </label>
          );
        })}
      </div>
    </Field>
  );
}