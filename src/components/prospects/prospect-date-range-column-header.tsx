'use client';

// AGENT1-DISCARDED-TAB-PARITY-1 — extracted verbatim from
// `prospects-data-table-client.tsx` (where it was a file-private component
// typed to that file's `Row`) so the "Descartadas" table renders the SAME
// "Fecha" header — sort + date-range filter — as "Candidatos por revisar".
// Generic over the row type; behaviour and markup unchanged.

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { ArrowUp, ArrowDown, ChevronsUpDown, ListFilter, X } from "@/icons";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const fieldId = React.useId();

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
            className="group inline-flex items-center gap-1.5 -mx-1.5 px-1.5 py-1 rounded-md hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-surface-muted"
            aria-label={`Opciones de columna ${title}`}
          >
            <span className="text-xs font-semibold text-foreground">
              {title}
            </span>
            {sorted === 'asc' && <ArrowUp className="h-3 w-3 text-foreground" strokeWidth={2.5} />}
            {sorted === 'desc' && <ArrowDown className="h-3 w-3 text-foreground" strokeWidth={2.5} />}
            {sorted === false && !isFiltered && (
              <ChevronsUpDown className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
            )}
            {isFiltered && <ListFilter className="h-3 w-3 text-primary" strokeWidth={2.5} />}
          </button>
        }
      />
      <PopoverContent align="start" sideOffset={6} className="w-64 max-w-[calc(100vw-2rem)] p-0 rounded-xl border border-border/60 shadow-drawer">
        <div className="px-4 pt-3.5 pb-1.5 text-sm font-semibold tracking-tight text-foreground">
          Fecha de creación
        </div>

        <div className="px-4 pt-2.5 pb-1.5 text-xs font-semibold text-muted-foreground">
          Ordenar
        </div>
        <div className="px-4 pb-2.5 flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant={sorted === 'asc' ? 'default' : 'outline'}
            onClick={() => column.toggleSorting(false)}
            aria-pressed={sorted === 'asc'}
            className="flex-1"
          >
            <ArrowUp aria-hidden="true" />
            Asc
          </Button>
          <Button
            type="button"
            size="xs"
            variant={sorted === 'desc' ? 'default' : 'outline'}
            onClick={() => column.toggleSorting(true)}
            aria-pressed={sorted === 'desc'}
            className="flex-1"
          >
            <ArrowDown aria-hidden="true" />
            Desc
          </Button>
        </div>

        <Separator className="mx-4" />

        <div className="px-4 pt-2.5 pb-1.5 text-xs font-semibold text-muted-foreground">
          Filtrar por fecha
        </div>
        <div className="px-4 pb-3 space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-from`} className="text-xs text-muted-foreground">
              Desde
            </Label>
            <Input
              id={`${fieldId}-from`}
              type="date"
              inputSize="sm"
              value={filterValue.from ?? ''}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-to`} className="text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input
              id={`${fieldId}-to`}
              type="date"
              inputSize="sm"
              value={filterValue.to ?? ''}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        {(isFiltered || sorted !== false) && (
          <>
            <Separator className="mx-4" />
            <div className="px-4 py-2.5">
              <Button type="button" variant="ghost" size="xs" onClick={clear} className="w-full">
                <X aria-hidden="true" />
                Limpiar filtros
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
