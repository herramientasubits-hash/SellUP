"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface PeriodSelectorOption {
  label: string;
  value: string;
  description?: string;
}

export interface PeriodSelectorProps {
  /** El periodo elegido. */
  value?: string;
  onChange?: (value: string) => void;
  /** Los periodos entre los que se elige. Por defecto, `DEFAULT_PERIOD_OPTIONS`. */
  options?: readonly PeriodSelectorOption[];
  disabled?: boolean;
  /** Rótulo visible sobre el control. Sin él, se usa como nombre accesible `ariaLabel`. */
  label?: string;
  /** Nombre accesible cuando no hay rótulo visible. */
  ariaLabel?: string;
  /** Texto de ayuda bajo el control. */
  description?: string;
  /** Mensaje de error: pinta el estado de error. */
  error?: string;
  placeholder?: string;
  className?: string;
}

export const DEFAULT_PERIOD_OPTIONS: readonly PeriodSelectorOption[] = [
  { label: "Hoy", value: "today" },
  { label: "Ayer", value: "yesterday" },
  { label: "Últimos 7 días", value: "last_7_days" },
  { label: "Últimos 30 días", value: "last_30_days" },
  { label: "Este mes", value: "this_month" },
  { label: "Mes pasado", value: "last_month" },
  { label: "Este trimestre", value: "this_quarter" },
  { label: "Este año", value: "this_year" },
  { label: "Rango personalizado", value: "custom" },
];

/**
 * PeriodSelector — port de Thema `date/PeriodSelector.tsx`.
 *
 * El selector de periodos predefinidos de un tablero («Últimos 30 días», «Este
 * mes»…). Es un `Select` del sistema con su rótulo, su ayuda y su error; quien
 * lo usa decide qué significa cada valor.
 *
 * @example
 * <PeriodSelector label="Periodo" value={period} onChange={setPeriod} />
 */
export function PeriodSelector({
  value,
  onChange,
  options = DEFAULT_PERIOD_OPTIONS,
  disabled = false,
  label,
  ariaLabel,
  description,
  error,
  placeholder = "Elige un periodo",
  className,
}: PeriodSelectorProps) {
  const id = React.useId();
  const hasError = Boolean(error);
  const selected = options.find((option) => option.value === value);
  const hintId = error ? `${id}-error` : description ? `${id}-description` : undefined;

  return (
    <div data-slot="period-selector" className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          id={`${id}-label`}
          htmlFor={id}
          className={cn("text-sm font-medium text-foreground", disabled && "opacity-50")}
        >
          {label}
        </label>
      )}

      <Select
        value={value ?? null}
        onValueChange={(next) => {
          if (typeof next === "string") onChange?.(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          aria-label={label ? undefined : (ariaLabel ?? "Periodo")}
          aria-labelledby={label ? `${id}-label` : undefined}
          aria-invalid={hasError || undefined}
          aria-describedby={hintId}
          className="w-full"
        >
          <SelectValue>{selected?.label ?? placeholder}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex flex-col gap-0.5">
                <span>{option.label}</span>
                {option.description && (
                  <span className="text-xs leading-none text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {description && !error && (
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
