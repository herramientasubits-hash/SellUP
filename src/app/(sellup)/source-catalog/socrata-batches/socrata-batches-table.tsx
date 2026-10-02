'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Database } from "@/icons";
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { SocrataPreviewBatchListItem } from '@/modules/source-catalog/socrata-batches-queries';
import {
  BATCH_STATUS_LABELS,
  batchStatusBadgeClass,
  formatDatasetLabel,
  formatShortDate,
} from '@/modules/source-catalog/socrata-batches-labels';

type BatchKind = 'test' | 'preview' | 'regular';

const KIND_LABELS: Record<BatchKind, string> = {
  test: 'De prueba',
  preview: 'Vista previa',
  regular: 'Normal',
};

/** Un lote de prueba manda sobre «vista previa»: es lo que más importa saber. */
function batchKind(batch: SocrataPreviewBatchListItem): BatchKind {
  if (batch.smokeTest) return 'test';
  if (batch.previewMode) return 'preview';
  return 'regular';
}

const detailHref = (batch: SocrataPreviewBatchListItem) =>
  `/source-catalog/socrata-batches/${batch.id}`;

interface SocrataBatchesTableProps {
  batches: SocrataPreviewBatchListItem[];
}

/**
 * Los lotes creados desde datos abiertos, como lista que se recorre: se ordena
 * por fecha o por número de candidatos y se filtra por estado, origen y tipo.
 * Un clic en la fila abre el lote.
 */
export function SocrataBatchesTable({ batches }: SocrataBatchesTableProps) {
  const router = useRouter();

  const columns: ColumnDef<SocrataPreviewBatchListItem, unknown>[] = React.useMemo(() => {
    const unique = <T extends string>(values: T[]) => Array.from(new Set(values));

    return [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lote" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground" title={row.original.name}>
              {row.original.name}
            </p>
            {row.original.countryCode && (
              <p className="text-xs text-muted-foreground">{row.original.countryCode}</p>
            )}
          </div>
        ),
        size: 280,
        minSize: 200,
        enableHiding: false,
        meta: { label: 'Lote', disableFilter: true },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => (
          <Badge variant="outline" className={batchStatusBadgeClass(row.original.status)}>
            {BATCH_STATUS_LABELS[row.original.status] ?? row.original.status}
          </Badge>
        ),
        size: 170,
        meta: {
          label: 'Estado',
          filterOptions: unique(batches.map((b) => b.status)).map((status) => ({
            label: BATCH_STATUS_LABELS[status] ?? status,
            value: status,
          })),
        },
      },
      {
        id: 'dataset',
        accessorFn: (batch) => formatDatasetLabel(batch.dataset),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Origen de los datos" />,
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">{getValue<string>()}</span>
        ),
        size: 180,
        meta: {
          label: 'Origen de los datos',
          filterOptions: unique(batches.map((b) => formatDatasetLabel(b.dataset))).map((label) => ({
            label: label === '—' ? 'Sin origen' : label,
            value: label,
          })),
        },
      },
      {
        id: 'candidates',
        accessorKey: 'candidatesCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Candidatos" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm tabular-nums text-foreground">
            {row.original.candidatesCount}
            {row.original.targetCount ? (
              <span className="text-muted-foreground"> de {row.original.targetCount}</span>
            ) : null}
          </span>
        ),
        sortDescFirst: true,
        size: 130,
        meta: { label: 'Candidatos', disableFilter: true },
      },
      {
        id: 'kind',
        accessorFn: batchKind,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
        cell: ({ row }) => {
          const kind = batchKind(row.original);
          return (
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant={kind === 'test' ? 'info' : kind === 'preview' ? 'brand' : 'neutral'}>
                {KIND_LABELS[kind]}
              </Badge>
              {row.original.rollbackLogical && <Badge variant="neutral">Revertido</Badge>}
            </div>
          );
        },
        size: 170,
        meta: {
          label: 'Tipo',
          filterOptions: unique(batches.map(batchKind)).map((kind) => ({
            label: KIND_LABELS[kind],
            value: kind,
          })),
        },
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Creado" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatShortDate(row.original.createdAt)}
          </span>
        ),
        sortDescFirst: true,
        size: 140,
        meta: { label: 'Creado', disableFilter: true },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={(event) => {
              event.stopPropagation();
              router.push(detailHref(row.original));
            }}
          >
            Ver lote
            <ArrowRight aria-hidden />
          </Button>
        ),
        size: 110,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
        meta: { label: 'Acciones', disableFilter: true, disableSort: true },
      },
    ];
  }, [batches, router]);

  return (
    <DataTable
      tableId="settings-socrata-batches"
      noun="lotes"
      nounGender="m"
      title="Lotes"
      count={batches.length}
      columns={columns}
      data={batches}
      getRowId={(batch) => batch.id}
      getRowLabel={(batch) => batch.name}
      rowClickable
      onRowClick={(batch) => router.push(detailHref(batch))}
      emptyState={
        <EmptyState
          variant="plain"
          icon={Database}
          title="Todavía no hay lotes"
          description="Crea un lote de prueba con el botón de arriba para ver cómo llegan los candidatos desde los datos abiertos."
        />
      }
    />
  );
}
