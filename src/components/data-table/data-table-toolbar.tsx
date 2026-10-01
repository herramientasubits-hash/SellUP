"use client";

import * as React from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  onGlobalFilterChange: (next: string) => void;
  /** Optional: hide the global search input (controlled by settings drawer). */
  showGlobalSearch?: boolean;
  /** Optional: right-aligned action buttons (e.g. "Descargar Reporte (CSV)"). */
  actions?: React.ReactNode;
  /** Optional: open the settings drawer from the toolbar. */
  onOpenSettings?: () => void;
  className?: string;
}

/**
 * Toolbar sits at the top of the DataTable card. Layout:
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Title + count   [search btn] [settings] [actions]           │
 * │ Description                                                  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Column visibility and other table settings live in a side drawer
 * (DataTableSettingsDrawer), not a popover.
 */
export function DataTableToolbar<TData>({
  table,
  globalFilter,
  onGlobalFilterChange,
  showGlobalSearch = true,
  actions,
  onOpenSettings,
  className,
}: DataTableToolbarProps<TData>) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return (
    <div
      className={cn(
        "shrink-0 flex flex-col gap-2 px-6 py-4 border-b border-border/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Thema (TableShell): el título de la lista con su total al lado.
              El contador va fuera del h3 para no alterar el texto del título. */}
          {table.options.meta?.title != null && (
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-base font-semibold leading-tight tracking-tight text-foreground">
                {table.options.meta.title as React.ReactNode}
              </h3>
              {typeof table.options.meta.count === "number" && (
                <Badge variant="neutral" aria-hidden className="tabular-nums">
                  {table.options.meta.count.toLocaleString("es-CO")}
                </Badge>
              )}
            </div>
          )}
          {table.options.meta?.description != null && (
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              {table.options.meta.description as React.ReactNode}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {showGlobalSearch && (
            <div
              className={cn(
                "flex items-center transition-all",
                searchOpen ? "w-56" : "w-9",
              )}
            >
              {searchOpen ? (
                <div className="relative w-full">
                  <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={searchInputRef}
                    value={globalFilter}
                    onChange={(e) => onGlobalFilterChange(e.target.value)}
                    onBlur={() => {
                      if (!globalFilter) setSearchOpen(false);
                    }}
                    placeholder="Buscar..."
                    inputSize="sm"
                    className="pl-7 pr-2"
                  />
                </div>
              ) : (
                <TooltipIconButton
                  variant="outline"
                  icon={<Search className="h-3.5 w-3.5" />}
                  label="Buscar"
                  onClick={() => setSearchOpen(true)}
                />
              )}
            </div>
          )}

          {onOpenSettings && (
            <TooltipIconButton
              variant="outline"
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              label="Ajustes de tabla"
              onClick={onOpenSettings}
            />
          )}

          {actions}
        </div>
      </div>
    </div>
  );
}
