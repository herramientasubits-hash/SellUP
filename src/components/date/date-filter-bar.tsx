"use client";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "./date-picker";
import { DateRangePicker } from "./date-range-picker";
import { PeriodSelector, type PeriodSelectorOption } from "./period-selector";

export type DateFilterMode = "period" | "date" | "range";

export interface DateFilterBarProps {
  /** El periodo elegido (modo `period`). */
  period?: string;
  onPeriodChange?: (value: string) => void;
  /** Los periodos que ofrece el modo `period`. */
  periodOptions?: readonly PeriodSelectorOption[];
  /** El día elegido (modo `date`). */
  date?: Date;
  onDateChange?: (date?: Date) => void;
  /** El rango elegido (modo `range`). */
  range?: { from?: Date; to?: Date };
  onRangeChange?: (range?: { from?: Date; to?: Date }) => void;
  /** Cómo se está filtrando ahora. */
  mode?: DateFilterMode;
  onModeChange?: (mode: DateFilterMode) => void;
  /** Los modos que se ofrecen. Con uno solo, el selector de modo no se pinta. */
  modes?: readonly DateFilterMode[];
  disabled?: boolean;
  className?: string;
}

const MODE_LABELS: Readonly<Record<DateFilterMode, string>> = {
  period: "Periodo",
  date: "Un día",
  range: "Rango",
};

const VALUE_LABELS: Readonly<Record<DateFilterMode, string>> = {
  period: "Elige el periodo",
  date: "Elige el día",
  range: "Elige el rango",
};

const ALL_MODES: readonly DateFilterMode[] = ["period", "date", "range"];

function isDateFilterMode(value: unknown): value is DateFilterMode {
  return value === "period" || value === "date" || value === "range";
}

/**
 * DateFilterBar — port de Thema `date/DateFilterBar.tsx`.
 *
 * La barra de filtro por fecha de un tablero: a la izquierda cómo se filtra
 * (un periodo predefinido, un día o un rango) y a la derecha el control que le
 * toca (`PeriodSelector`, `DatePicker` o `DateRangePicker`). Es controlada:
 * cada modo tiene su valor y su callback.
 *
 * @example
 * <DateFilterBar
 *   mode={mode} onModeChange={setMode}
 *   period={period} onPeriodChange={setPeriod}
 *   range={range} onRangeChange={setRange}
 *   modes={["period", "range"]}
 * />
 */
export function DateFilterBar({
  period,
  onPeriodChange,
  periodOptions,
  date,
  onDateChange,
  range,
  onRangeChange,
  mode = "period",
  onModeChange,
  modes = ALL_MODES,
  disabled = false,
  className,
}: DateFilterBarProps) {
  const labelClassName = cn("text-xs font-medium text-muted-foreground", disabled && "opacity-50");

  return (
    <div data-slot="date-filter-bar" className={cn("flex flex-wrap items-end gap-3", className)}>
      {modes.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className={labelClassName}>Filtrar por</span>
          <Select
            value={mode}
            onValueChange={(value) => {
              if (isDateFilterMode(value)) onModeChange?.(value);
            }}
            disabled={disabled}
          >
            <SelectTrigger aria-label="Filtrar por" className="w-32">
              <SelectValue>{MODE_LABELS[mode]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {modes.map((item) => (
                <SelectItem key={item} value={item}>
                  {MODE_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex min-w-48 flex-col gap-1">
        <span className={labelClassName}>{VALUE_LABELS[mode]}</span>

        {mode === "period" && (
          <PeriodSelector
            value={period}
            onChange={onPeriodChange}
            options={periodOptions}
            disabled={disabled}
            ariaLabel={VALUE_LABELS.period}
            className="w-full"
          />
        )}

        {mode === "date" && (
          <DatePicker
            value={date}
            onChange={onDateChange}
            disabled={disabled}
            placeholder="Elige un día"
            className="w-full"
          />
        )}

        {mode === "range" && (
          <DateRangePicker
            value={range}
            onChange={onRangeChange}
            disabled={disabled}
            placeholder="Elige un rango"
            className="w-full"
          />
        )}
      </div>
    </div>
  );
}
