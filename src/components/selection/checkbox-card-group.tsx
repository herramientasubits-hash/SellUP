"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/forms/field";
import type { SelectionOption, SelectionColumns } from "./selectionTypes";

export interface CheckboxCardGroupProps {
  /** Array of selectable options */
  options: SelectionOption[];
  /** Array of currently selected values */
  value?: string[];
  /** Callback when selection changes */
  onChange?: (value: string[]) => void;
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
 * CheckboxCardGroup - UBITS component for multiple selection via visual cards.
 */
export function CheckboxCardGroup({
  options,
  value = [],
  onChange,
  columns = 2,
  disabled = false,
  label,
  description,
  error,
  className,
}: CheckboxCardGroupProps) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  }[columns];

  const handleToggle = (optionValue: string) => {
    if (disabled) return;

    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];

    onChange?.(newValue);
  };

  return (
    <Field
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      className={className}
    >
      <div className={cn("grid gap-4 mt-2", gridCols)}>
        {options.map((option) => {
          const isSelected = value.includes(option.value);
          const isDisabled = disabled || option.disabled;
          const Icon = option.icon;

          return (
            <div
              key={option.value}
              className={cn(
                "relative flex h-full",
                isDisabled && "cursor-not-allowed"
              )}
            >
              {/* Invisible checkbox for accessibility */}
              <Checkbox
                id={`check-${option.value}`}
                checked={isSelected}
                onCheckedChange={() => handleToggle(option.value)}
                disabled={isDisabled}
                className="absolute top-4 left-4 z-20 pointer-events-none opacity-0"
              />

              <button
                type="button"
                disabled={isDisabled}
                onClick={() => handleToggle(option.value)}
                className={cn(
                  "group flex flex-col w-full text-left p-0 rounded-xl outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-su-brand focus-visible:ring-offset-2",
                )}
              >
                <Card className={cn(
                  "flex flex-col w-full h-full p-5 border-2 transition-all duration-200",
                  isSelected
                    ? "border-su-brand bg-su-brand/[0.02] ring-1 ring-su-brand/20"
                    : "border-border/50 bg-card hover:border-su-brand/30",
                  isDisabled && "opacity-50 grayscale-[0.5] hover:border-border/50"
                )}>
                  {/* Header: Icon + Badge */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className={cn(
                      "p-2.5 rounded-xl border transition-colors",
                      isSelected
                        ? "bg-su-brand text-su-brand-foreground border-su-brand"
                        : "bg-muted/50 text-muted-foreground border-border/50 group-hover:bg-su-brand/5 group-hover:text-su-brand group-hover:border-su-brand/20"
                    )}>
                      {Icon ? <Icon className="h-5 w-5" /> : <Checkbox checked={isSelected} className="rounded" />}
                    </div>
                    {option.badge && (
                      <Badge
                        variant={isSelected ? "default" : "outline"}
                        className="font-bold uppercase tracking-wider text-[9px]"
                      >
                        {option.badge}
                      </Badge>
                    )}
                  </div>

                  {/* Content */}
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

                  {/* Multiple Selection Indicator (Visual Checkbox) */}
                  <div className={cn(
                    "absolute top-2 right-2 flex items-center justify-center h-5 w-5 rounded border-2 transition-all duration-200",
                    isSelected ? "bg-su-brand border-su-brand text-su-brand-foreground scale-100" : "bg-muted border-border/50 text-transparent scale-90 opacity-0 group-hover:opacity-100"
                  )}>
                    <svg
                      className="h-3 w-3 stroke-current"
                      viewBox="0 0 24 24"
                      fill="none"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </Card>
              </button>
            </div>
          );
        })}
      </div>
    </Field>
  );
}