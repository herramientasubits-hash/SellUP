// Celdas compartidas por las tablas «Por agente», «Por país», «Por rol y grupo»
// y «Por búsqueda». Sólo presentación: las cifras llegan ya calculadas (y, a
// quien no ve dólares, sin importes) desde el servidor.

import type { ColumnDef } from '@tanstack/react-table';
import { DataTableColumnHeader } from '@/components/data-table';
import { CostValue } from '@/components/shared/cost-value';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import { formatCount, formatUsd } from './usage-labels';

export const NUMBER_CLASS = 'whitespace-nowrap text-sm tabular-nums text-muted-foreground';

export function Dash({ label = 'Sin dato' }: { label?: string }) {
  return (
    <span className="text-xs text-text-muted">
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function CountCell({ value }: { value: number }) {
  return <span className={NUMBER_CLASS}>{formatCount(value)}</span>;
}

/** Un importe en USD. NULL con costo desconocido = «sin tarifa», nunca $0. */
export function MoneyCell({ usd, unknown = false, decimals = 2 }: { usd: number | null; unknown?: boolean; decimals?: number }) {
  if (usd === null) return <Dash />;
  return (
    <span className={NUMBER_CLASS}>
      <CostValue
        display={resolveCostDisplay({
          valueUsd: usd,
          costTruth: toCostTruth(unknown),
          formatUsd: (value) => formatUsd(value, decimals),
        })}
      />
    </span>
  );
}

/** Columna numérica ordenable, sin embudo. */
export function countColumn<T>(id: string, title: string, read: (row: T) => number, size = 120): ColumnDef<T, unknown> {
  return {
    id,
    accessorFn: read,
    header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
    cell: ({ getValue }) => <CountCell value={getValue<number>()} />,
    sortDescFirst: true,
    size,
    meta: { label: title, disableFilter: true },
  };
}

/** Columna en dólares: sólo existe si quien mira ve dinero. */
export function moneyColumn<T>(
  id: string,
  title: string,
  read: (row: T) => number | null,
  unknown: (row: T) => boolean = () => false,
  decimals = 2,
  size = 140,
): ColumnDef<T, unknown> {
  return {
    id,
    accessorFn: (row) => read(row) ?? -1,
    header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
    cell: ({ row }) => <MoneyCell usd={read(row.original)} unknown={unknown(row.original)} decimals={decimals} />,
    sortDescFirst: true,
    size,
    meta: { label: title, disableFilter: true },
  };
}

/** Opciones del embudo a partir de valores con su etiqueta. */
export function filterOptions(values: readonly string[], label: (value: string) => string) {
  return [...new Set(values)]
    .map((value) => ({ value, label: label(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}
