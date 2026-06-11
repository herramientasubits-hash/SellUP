"use client";

import * as React from "react";
import { Search, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type ActiveFilter = {
  id: string;
  label: string;
  value?: string;
  onRemove?: () => void;
};

export type FilterBarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  activeFilters?: ActiveFilter[];
  onClearFilters?: () => void;
  className?: string;
};

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  filters,
  actions,
  activeFilters = [],
  onClearFilters,
  className,
}: FilterBarProps) {
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-5 border border-border/10 rounded-2xl shadow-sm">
        <div className="flex flex-1 flex-col md:flex-row md:items-center gap-4">
          {onSearchChange && (
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9 h-10"
              />
            </div>
          )}
          {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {(hasActiveFilters || onClearFilters) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {activeFilters.map((filter) => (
            <Badge
              key={filter.id}
              variant="secondary"
              className="flex items-center gap-1 pl-2 pr-1 py-1 h-7 border-border/10 bg-secondary/50"
            >
              <span className="text-muted-foreground mr-1">{filter.label}:</span>
              <span className="font-medium">{filter.value}</span>
              <button
                type="button"
                aria-label={`Remover filtro ${filter.label}`}
                title={`Remover filtro ${filter.label}`}
                onClick={filter.onRemove}
                className="ml-1 rounded-full outline-none hover:bg-muted p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {onClearFilters && hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="h-7 px-2 text-xs font-semibold text-su-brand hover:text-su-brand hover:bg-su-brand/5 transition-colors flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Limpiar filtros
            </Button>
          )}
        </div>
      )}
    </div>
  );
}