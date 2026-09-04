'use client';

// AGENT1-DISCARDED-TAB-PARITY-1 — extracted verbatim from
// `prospects-data-table-client.tsx` (where it was a file-private component
// typed to that file's `Row`) so the "Descartadas" table renders the SAME
// "Fecha" header — sort + date-range filter — as "Candidatos por revisar".
// Generic over the row type; behaviour and markup unchanged.

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { ArrowUp, ArrowDown, ChevronsUpDown, ListFilter, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

export interface DateRangeFilterValue {
  from?: string;
  to?: string;
}

export function DateRangeColumnHeader<TData>({
  column,
  title,
}: {
  column: Column<TData, unknown>;
  title: string;
}) {
  const filterValue = (column.getFilterValue() as DateRangeFilterValue | undefined) ?? {};
  const sorted = column.getIsSorted();
  const isFiltered = !!filterValue.from || !!filterValue.to;

  const setFrom = (value: string) => {
    const next: DateRangeFilterValue = { ...filterValue, from: value || undefined };
    column.setFilterValue(Object.keys(next).length ? next : undefined);
  };

  const setTo = (value: string) => {
    const next: DateRangeFilterValue = { ...filterValue, to: value || undefined };
    column.setFilterValue(Object.keys(next).length ? next : undefined);
  };

  const clear = () => {
    column.setFilterValue(undefined);
    column.clearSorting();
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="group inline-flex items-center gap-1.5 -mx-1.5 px-1.5 py-1 rounded-md hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={`Opciones de columna ${title}`}
          >
            <span className="text-[11px] font-semibold tracking-wider uppercase text-foreground">
              {title}
            </span>
            {sorted === 'asc' && <ArrowUp className="h-3 w-3 text-foreground" strokeWidth={2.5} />}
            {sorted === 'desc' && <ArrowDown className="h-3 w-3 text-foreground" strokeWidth={2.5} />}
            {sorted === false && !isFiltered && (
              <ChevronsUpDown className="h-3 w-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
            )}
            {isFiltered && <ListFilter className="h-3 w-3 text-primary" strokeWidth={2.5} />}
          </button>
        }
      />
      <PopoverContent align="start" sideOffset={6} className="w-64 p-0 rounded-xl border border-border/40 shadow-lg">
        <div className="px-5 pt-3.5 pb-1.5 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
          Fecha de creación
        </div>

        <div className="px-5 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
          Ordenar
        </div>
        <div className="px-4 pb-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => column.toggleSorting(false)}
            aria-pressed={sorted === 'asc'}
            className={`flex-1 h-7 rounded-lg text-xs inline-flex items-center justify-center gap-1.5 border transition-colors ${sorted === 'asc' ? 'bg-foreground text-background border-foreground' : 'border-border hover:bg-muted/40 text-foreground'}`}
          >
            <ArrowUp className="h-3 w-3" />
            Asc
          </button>
          <button
            type="button"
            onClick={() => column.toggleSorting(true)}
            aria-pressed={sorted === 'desc'}
            className={`flex-1 h-7 rounded-lg text-xs inline-flex items-center justify-center gap-1.5 border transition-colors ${sorted === 'desc' ? 'bg-foreground text-background border-foreground' : 'border-border hover:bg-muted/40 text-foreground'}`}
          >
            <ArrowDown className="h-3 w-3" />
            Desc
          </button>
        </div>

        <Separator className="mx-4" />

        <div className="px-5 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
          Filtrar por fecha
        </div>
        <div className="px-4 pb-3 space-y-2">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium">Desde</label>
            <input
              type="date"
              value={filterValue.from ?? ''}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring/40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium">Hasta</label>
            <input
              type="date"
              value={filterValue.to ?? ''}
              onChange={(e) => setTo(e.target.value)}
              className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring/40"
            />
          </div>
        </div>

        {(isFiltered || sorted !== false) && (
          <>
            <Separator className="mx-4" />
            <div className="px-4 py-2.5">
              <button
                type="button"
                onClick={clear}
                className="w-full h-7 text-xs text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1.5 rounded-md hover:bg-muted/40 transition-colors"
              >
                <X className="h-3 w-3" />
                Limpiar filtros
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
