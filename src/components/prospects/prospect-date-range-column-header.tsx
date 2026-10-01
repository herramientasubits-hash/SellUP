'use client';

// AGENT1-DISCARDED-TAB-PARITY-1 — encabezado «Fecha» compartido por
// «Candidatos por revisar» y «Descartadas»: orden + filtro por rango.
// Genérico sobre el tipo de fila.
//
// Misma anatomía que el resto de cabeceras (Thema · FilterSortHeader): la
// etiqueta ordena con un clic y el embudo, aparte y siempre a la vista, abre
// el rango de fechas. Con rango puesto el embudo se enciende.

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HeaderFilterButton, HeaderSortButton } from '@/components/data-display';
import { cycleColumnSort } from '@/components/data-table';

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
  const isFiltered = !!filterValue.from || !!filterValue.to;
  const fieldId = React.useId();

  const setRange = (next: DateRangeFilterValue) => {
    column.setFilterValue(next.from || next.to ? next : undefined);
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <HeaderSortButton label={title} sort={column.getIsSorted()} onSort={() => cycleColumnSort(column)} />

      <Popover>
        <PopoverTrigger
          render={<HeaderFilterButton filterLabel="fecha de creación" activeCount={isFiltered ? 1 : 0} />}
        />
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-64 max-w-[calc(100vw-2rem)] p-0"
          // La celda de cabecera se puede arrastrar: sin esto, arrastrar
          // dentro del menú movería la columna.
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <p className="border-b border-border/60 px-4 py-3 text-sm font-semibold text-foreground">
            Fecha de creación
          </p>

          <div className="space-y-2 px-4 py-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-from`} className="text-xs text-muted-foreground">
                Desde
              </Label>
              <Input
                id={`${fieldId}-from`}
                type="date"
                inputSize="sm"
                value={filterValue.from ?? ''}
                onChange={(e) => setRange({ ...filterValue, from: e.target.value || undefined })}
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
                onChange={(e) => setRange({ ...filterValue, to: e.target.value || undefined })}
              />
            </div>
          </div>

          {isFiltered && (
            <div className="border-t border-border/60 p-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => column.setFilterValue(undefined)}
                className="w-full justify-start text-primary"
              >
                Limpiar el rango
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
