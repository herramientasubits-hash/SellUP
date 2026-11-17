"use client";

/**
 * Las cabeceras de columna con embudo de texto o de fecha. Misma anatomía que
 * `FilterSortHeader` (Thema): la etiqueta ordena y el embudo, aparte y siempre
 * a la vista, abre el filtro; con filtro puesto se enciende.
 *
 * - Texto: «Contiene…» y «Con dato / Sin dato».
 * - Fecha: rango en el calendario del sistema, atajos y «Sin fecha».
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import { appDayKey } from "@/lib/format-date";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/date";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  HeaderFilterButton,
  HeaderSortButton,
  type HeaderSort,
} from "@/components/data-display/table-header-controls";
import {
  datePresetsFor,
  normalizeDateFilter,
  normalizeTextFilter,
  type DateFilterValue,
  type TextFilterValue,
} from "./data-table-filters";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-09-03` → ese día a medianoche en la zona de quien mira (para el calendario). */
function parseIsoDay(value: string | undefined): Date | undefined {
  const match = value ? ISO_DAY.exec(value) : null;
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** El día de `date`, en su propia zona, como `2026-09-03`. */
function toIsoDay(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** El menú del embudo vive dentro de una cabecera que se arrastra: que no la mueva. */
const stopDrag = {
  onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
  onTouchStart: (event: React.TouchEvent) => event.stopPropagation(),
};

interface FilterHeaderShellProps {
  label: string;
  filterLabel: string;
  active: boolean;
  sort: HeaderSort;
  onSort?: () => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}

function FilterHeaderShell({ label, filterLabel, active, sort, onSort, align = "left", className, children }: FilterHeaderShellProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-0.5", align === "right" && "justify-end", className)}>
      {onSort ? (
        <HeaderSortButton label={label} sort={sort} onSort={onSort} />
      ) : (
        <span className="truncate text-xs font-semibold text-muted-foreground">{label}</span>
      )}
      <Popover>
        <PopoverTrigger render={<HeaderFilterButton filterLabel={filterLabel} activeCount={active ? 1 : 0} />} />
        <PopoverContent align="start" sideOffset={6} className="w-64 max-w-[calc(100vw-2rem)] p-0" {...stopDrag}>
          <p className="border-b border-border/60 px-4 py-3 text-sm font-semibold text-foreground">{filterLabel}</p>
          {children}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** «Limpiar filtro», arriba como en el embudo de casillas. */
function ClearFilterButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="border-b border-border/60 p-1.5">
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        Limpiar filtro
      </button>
    </div>
  );
}

interface CheckRowProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

function CheckRow({ label, checked, onToggle }: CheckRowProps) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-muted">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
    </label>
  );
}

// ── Texto ──────────────────────────────────────────────────────

export interface TextFilterSortHeaderProps {
  label: string;
  filterLabel?: string;
  value: TextFilterValue | undefined;
  onChange: (next: TextFilterValue | undefined) => void;
  sort: HeaderSort;
  onSort?: () => void;
  align?: "left" | "right";
  className?: string;
}

export function TextFilterSortHeader({
  label,
  filterLabel,
  value,
  onChange,
  sort,
  onSort,
  align,
  className,
}: TextFilterSortHeaderProps) {
  const current = value ?? {};
  const active = !!normalizeTextFilter(current);
  const update = (patch: Partial<TextFilterValue>) => onChange(normalizeTextFilter({ ...current, ...patch }));
  const togglePresence = (presence: "filled" | "empty") =>
    update({ presence: current.presence === presence ? undefined : presence });
  const name = filterLabel ?? label;

  return (
    <FilterHeaderShell label={label} filterLabel={name} active={active} sort={sort} onSort={onSort} align={align} className={className}>
      {active && <ClearFilterButton onClick={() => onChange(undefined)} />}
      <div className="px-4 py-3">
        <Input
          value={current.contains ?? ""}
          onChange={(event) => update({ contains: event.target.value })}
          placeholder="Contiene…"
          aria-label={`${name} contiene`}
          inputSize="sm"
          disabled={current.presence === "empty"}
        />
      </div>
      <div className="border-t border-border/60 p-1.5">
        <CheckRow label="Con dato" checked={current.presence === "filled"} onToggle={() => togglePresence("filled")} />
        <CheckRow label="Sin dato" checked={current.presence === "empty"} onToggle={() => togglePresence("empty")} />
      </div>
    </FilterHeaderShell>
  );
}

// ── Fecha ──────────────────────────────────────────────────────

export interface DateFilterSortHeaderProps {
  label: string;
  filterLabel?: string;
  value: DateFilterValue | undefined;
  onChange: (next: DateFilterValue | undefined) => void;
  presets?: "past" | "future";
  sort: HeaderSort;
  onSort?: () => void;
  align?: "left" | "right";
  className?: string;
  /** Hoy (`AAAA-MM-DD`). Inyectable para pruebas. */
  today?: string;
}

export function DateFilterSortHeader({
  label,
  filterLabel,
  value,
  onChange,
  presets,
  sort,
  onSort,
  align,
  className,
  today,
}: DateFilterSortHeaderProps) {
  const current = value ?? {};
  const active = !!normalizeDateFilter(current);
  const name = filterLabel ?? label;
  const presetOptions = datePresetsFor(presets);

  const applyPreset = (id: string) => {
    if (current.preset === id) return onChange(undefined);
    const preset = presetOptions.find((option) => option.id === id);
    if (!preset) return;
    const day = today ?? appDayKey(new Date()) ?? toIsoDay(new Date())!;
    onChange(normalizeDateFilter({ ...preset.range(day), preset: id }));
  };

  return (
    <FilterHeaderShell label={label} filterLabel={name} active={active} sort={sort} onSort={onSort} align={align} className={className}>
      {active && <ClearFilterButton onClick={() => onChange(undefined)} />}
      <div className="p-1.5">
        {presetOptions.map((preset) => (
          <CheckRow
            key={preset.id}
            label={preset.label}
            checked={current.preset === preset.id}
            onToggle={() => applyPreset(preset.id)}
          />
        ))}
        <CheckRow
          label="Sin fecha"
          checked={current.empty === true}
          onToggle={() => onChange(current.empty ? undefined : { empty: true })}
        />
      </div>
      {/* El rango se elige en el calendario del sistema; el filtro guarda los días como `AAAA-MM-DD`. */}
      <div className="border-t border-border/60 px-4 py-3">
        <DateRangePicker
          label="Rango"
          placeholder="Elige el rango"
          value={current.empty || current.preset ? undefined : { from: parseIsoDay(current.from), to: parseIsoDay(current.to) }}
          onChange={(range) => onChange(normalizeDateFilter({ from: toIsoDay(range?.from), to: toIsoDay(range?.to) }))}
        />
      </div>
    </FilterHeaderShell>
  );
}
