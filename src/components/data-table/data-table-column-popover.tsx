"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DataTableColumnFilterOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export type DataTableColumnMeta = {
  /** Visible label in the view-options menu. */
  label?: string;
  /** Title for the filter popover. Defaults to header label. */
  popoverTitle?: string;
  /** Static filter options (preferred for known enums). */
  filterOptions?: DataTableColumnFilterOption[];
  /** Override the default filter function with multi-value select. */
  enableMultiSelectFilter?: boolean;
  /** Hide the search input within the popover. */
  disablePopoverSearch?: boolean;
  /** Disable the sort section entirely. */
  disableSort?: boolean;
  /** Disable the filter section entirely. */
  disableFilter?: boolean;
};

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface ColumnMeta<TData extends RowData, TValue> extends DataTableColumnMeta {}
}

import type { RowData } from "@tanstack/react-table";

interface DataTableColumnPopoverProps<TData, TValue> {
  column: Column<TData, TValue>;
  /** What to render inside the trigger (the column header content). */
  children: React.ReactNode;
  /** Whether the column is sortable. */
  sortable?: boolean;
  /** Whether the column is filterable. */
  filterable?: boolean;
}

/**
 * The per-column popover that holds sort + search + filter controls.
 * Render this as the <PopoverTrigger> in DataTableColumnHeader.
 */
export function DataTableColumnPopover<TData, TValue>({
  column,
  children,
  sortable = true,
  filterable = true,
}: DataTableColumnPopoverProps<TData, TValue>) {
  const meta = (column.columnDef.meta ?? {}) as DataTableColumnMeta;
  const disableSort = meta.disableSort === true;
  const disableFilter = meta.disableFilter === true;
  const disableSearch = meta.disablePopoverSearch === true;
  const title = meta.popoverTitle ?? meta.label;

  const [search, setSearch] = React.useState("");

  const sortDirection = column.getIsSorted();

  // Get filterable values: prefer static meta options, else faceted unique values.
  const staticOptions = meta.filterOptions;
  const facetedValues = React.useMemo(() => {
    if (staticOptions) return null;
    const map = column.getFacetedUniqueValues();
    if (!map) return null;
    return Array.from(map.entries())
      .filter(([value]) => value !== null && value !== undefined && value !== "")
      .map(([value, count]) => ({
        label: String(value),
        value: String(value),
        count,
      }));
  }, [column, staticOptions]);

  const allOptions: Array<DataTableColumnFilterOption & { count?: number }> = React.useMemo(() => {
    if (staticOptions) return staticOptions;
    if (facetedValues) return facetedValues;
    return [];
  }, [staticOptions, facetedValues]);

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return allOptions;
    const q = search.toLowerCase();
    return allOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [allOptions, search]);

  // Current multi-select filter value (array of strings).
  const currentFilter = (column.getFilterValue() as string[] | undefined) ?? [];

  const toggleFilterValue = (value: string) => {
    const next = currentFilter.includes(value)
      ? currentFilter.filter((v) => v !== value)
      : [...currentFilter, value];
    column.setFilterValue(next.length ? next : undefined);
  };

  const clearAll = () => {
    column.setFilterValue(undefined);
    column.clearSorting();
  };

  const hasActiveFilter = currentFilter.length > 0;
  const hasActiveSort = sortDirection !== false;

  return (
    <Popover>
      <PopoverTrigger render={children as React.ReactElement} />
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 p-0 rounded-xl border border-border/40 shadow-lg"
      >
        {title && (
          <div className="px-5 pt-3.5 pb-1.5 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
            {title}
          </div>
        )}

        {sortable && !disableSort && (
          <>
            <div className="px-5 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
              Ordenar
            </div>
            <div className="px-4 pb-2.5 flex items-center gap-1.5">
              <Button
                variant={sortDirection === "asc" ? "default" : "outline"}
                size="sm"
                className="flex-1 h-7 rounded-lg text-xs"
                onClick={() => column.toggleSorting(false)}
                aria-pressed={sortDirection === "asc"}
              >
                <ArrowUp className="h-3 w-3" />
                Asc
              </Button>
              <Button
                variant={sortDirection === "desc" ? "default" : "outline"}
                size="sm"
                className="flex-1 h-7 rounded-lg text-xs"
                onClick={() => column.toggleSorting(true)}
                aria-pressed={sortDirection === "desc"}
              >
                <ArrowDown className="h-3 w-3" />
                Desc
              </Button>
            </div>
          </>
        )}

        {filterable && !disableFilter && allOptions.length > 0 && (
          <>
            {sortable && !disableSort && <Separator className="mx-4" />}
            <div className="px-5 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
              Buscar
            </div>
            {!disableSearch && (
              <div className="px-4 pb-2.5 relative">
                <Search className="absolute left-6 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="h-7 pl-7 text-xs"
                />
              </div>
            )}
            <div className="px-5 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
              Filtrar
            </div>
            <div className="max-h-56 overflow-y-auto px-4 pb-3">
              {filteredOptions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-2 px-1">Sin opciones.</p>
              ) : (
                <ul className="space-y-0.5">
                  {filteredOptions.map((opt) => {
                    const checked = currentFilter.includes(opt.value);
                    return (
                      <li key={opt.value}>
                        <label
                          className={cn(
                            "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs cursor-pointer",
                            "hover:bg-muted/60",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleFilterValue(opt.value)}
                          />
                          <span className="flex-1 truncate text-foreground">{opt.label}</span>
                          {typeof opt.count === "number" && (
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {opt.count}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {(hasActiveFilter || hasActiveSort) && (
          <>
            <Separator className="mx-4" />
            <div className="px-4 py-2.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs justify-center text-muted-foreground"
                onClick={clearAll}
              >
                <X className="h-3 w-3" />
                Limpiar filtros
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
