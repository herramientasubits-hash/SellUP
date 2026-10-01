'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { StatusBadge, type StatusType } from '@/components/data-display/status-badge';
import { formatAppDateTime } from '@/lib/format-date';
import {
  CONNECTION_TEST_STATUS_LABELS,
  CONNECTION_TEST_STRATEGY_LABELS,
} from '@/modules/source-catalog/labels';
import type { SourceConnectionTestHistoryItem } from '@/modules/source-catalog/history-queries';
import type { SourceConnectionTestStatus } from '@/server/source-catalog/connection-test/types';

const NO_VALUE = '—';

export const CONNECTION_TEST_STATUS_TONE: Record<SourceConnectionTestStatus, StatusType> = {
  success: 'active',
  failed: 'error',
  blocked: 'error',
  requires_credentials: 'warning',
  input_required: 'warning',
  not_supported: 'neutral',
};

interface ConnectionTestHistoryTableProps {
  items: SourceConnectionTestHistoryItem[];
}

/**
 * El historial de pruebas de conexión de una fuente como lista que se recorre:
 * lo más reciente arriba, se ordena por fecha o por tiempo de respuesta y se
 * filtra por resultado o por quién probó. Los códigos técnicos van al final.
 */
export function ConnectionTestHistoryTable({ items }: ConnectionTestHistoryTableProps) {
  const columns: ColumnDef<SourceConnectionTestHistoryItem, unknown>[] = React.useMemo(() => {
    const unique = <T extends string>(values: T[]) => Array.from(new Set(values));

    return [
      {
        id: 'checkedAt',
        accessorKey: 'checkedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatAppDateTime(row.original.checkedAt)}
          </span>
        ),
        sortDescFirst: true,
        size: 180,
        enableHiding: false,
        meta: { label: 'Fecha', disableFilter: true },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Resultado" />,
        cell: ({ row }) => (
          <StatusBadge
            status={CONNECTION_TEST_STATUS_TONE[row.original.status]}
            label={CONNECTION_TEST_STATUS_LABELS[row.original.status]}
          />
        ),
        size: 190,
        meta: {
          label: 'Resultado',
          filterOptions: unique(items.map((item) => item.status)).map((status) => ({
            label: CONNECTION_TEST_STATUS_LABELS[status],
            value: status,
          })),
        },
      },
      {
        id: 'recommendation',
        accessorFn: (item) => item.recommendation ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Qué hacer" />,
        cell: ({ row }) => (
          <span
            className="block min-w-56 whitespace-normal text-sm leading-snug text-muted-foreground line-clamp-2"
            title={row.original.recommendation ?? undefined}
          >
            {row.original.recommendation ?? NO_VALUE}
          </span>
        ),
        size: 300,
        enableSorting: false,
        meta: { label: 'Qué hacer', disableFilter: true, disableSort: true },
      },
      {
        id: 'testedBy',
        accessorFn: (item) => item.testedByEmailSnapshot ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Probó" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {row.original.testedByEmailSnapshot ?? NO_VALUE}
          </span>
        ),
        size: 220,
        meta: {
          label: 'Probó',
          filterOptions: unique(items.map((item) => item.testedByEmailSnapshot ?? '')).map((email) => ({
            label: email || 'Sin registrar',
            value: email,
          })),
        },
      },
      {
        id: 'responseTime',
        accessorFn: (item) => item.responseTimeMs ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tiempo de respuesta" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm tabular-nums text-foreground">
            {row.original.responseTimeMs !== null ? `${row.original.responseTimeMs} ms` : NO_VALUE}
          </span>
        ),
        size: 170,
        meta: { label: 'Tiempo de respuesta', disableFilter: true },
      },
      {
        id: 'strategy',
        accessorKey: 'strategy',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo de prueba" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {CONNECTION_TEST_STRATEGY_LABELS[row.original.strategy]}
          </span>
        ),
        size: 220,
        meta: {
          label: 'Tipo de prueba',
          filterOptions: unique(items.map((item) => item.strategy)).map((strategy) => ({
            label: CONNECTION_TEST_STRATEGY_LABELS[strategy],
            value: strategy,
          })),
        },
      },
      {
        id: 'httpStatus',
        accessorFn: (item) => item.httpStatus ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Código de respuesta" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.httpStatus ?? NO_VALUE}
          </span>
        ),
        size: 170,
        meta: { label: 'Código de respuesta', disableFilter: true },
      },
      {
        id: 'errorCode',
        accessorFn: (item) => (item.errorCode === 'OK' ? '' : item.errorCode),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Código de error" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.errorCode === 'OK' ? NO_VALUE : row.original.errorCode}
          </span>
        ),
        size: 180,
        meta: { label: 'Código de error', disableFilter: true },
      },
    ];
  }, [items]);

  return (
    <DataTable
      tableId="settings-connection-tests"
      noun="pruebas"
      nounGender="f"
      title="Historial de pruebas"
      description="Las pruebas más recientes de esta fuente."
      count={items.length}
      columns={columns}
      data={items}
      getRowId={(item) => item.id}
      defaultRowsMode="paged"
      initialPageSize={10}
    />
  );
}
