'use client';

// AGENT1-DISCARDED-TAB-PARITY-1 — encabezado «Fecha» compartido por
// «Candidatos por revisar» y «Descartadas»: orden + filtro por rango.
// Genérico sobre el tipo de fila.
//
// Misma anatomía que el resto de cabeceras (Thema · FilterSortHeader): la
// etiqueta ordena con un clic y el embudo, aparte y siempre a la vista, abre
// el rango de fechas. Con rango puesto el embudo se enciende.

import type { Column } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/date';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HeaderFilterButton, HeaderSortButton } from '@/components/data-display';
import { cycleColumnSort } from '@/components/data-table';

export interface DateRangeFilterValue {
  from?: string;
  to?: string;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-09-03` → ese día a medianoche en la zona de quien mira. */
export function parseIsoDay(value: string | undefined): Date | undefined {
  const match = value ? ISO_DAY.exec(value) : null;
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** El día de `date`, en su propia zona, como `2026-09-03`. */
export function toIsoDay(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
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

          {/* El rango se elige en el calendario del sistema; el filtro sigue
              guardando los días como `AAAA-MM-DD`. */}
          <div className="px-4 py-3">
            <DateRangePicker
              label="Rango"
              placeholder="Elige el rango"
              value={{ from: parseIsoDay(filterValue.from), to: parseIsoDay(filterValue.to) }}
              onChange={(range) => setRange({ from: toIsoDay(range?.from), to: toIsoDay(range?.to) })}
            />
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
